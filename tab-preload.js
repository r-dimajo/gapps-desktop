const { contextBridge, ipcRenderer, webFrame } = require('electron');

let lastReportTime = 0;
function reportUserActive() {
  const now = Date.now();
  if (now - lastReportTime > 800) {
    lastReportTime = now;
    try {
      ipcRenderer.send('tab-user-active');
    } catch (_) {}
  }
}

// User interaction listeners inside the webview to dismiss unread indicators when active
try {
  window.addEventListener('focus', reportUserActive, true);
  window.addEventListener('click', reportUserActive, true);
  window.addEventListener('keydown', reportUserActive, true);
  window.addEventListener('touchstart', reportUserActive, true);
} catch (_) {}

// Expose safe bridge to main world
contextBridge.exposeInMainWorld('__gappsNotify', {
  send: (data) => ipcRenderer.send('tab-notification', data),
  sendUnreadCount: (data) => ipcRenderer.send('tab-unread-count', data),
  userActive: reportUserActive
});

// Inject notification proxy into main world so Gmail, Chat, and Calendar detect permission = 'granted'
try {
  webFrame.executeJavaScript(`
    (function() {
      if (window.__gapps_notification_injected) return;
      window.__gapps_notification_injected = true;

      const OriginalNotification = window.Notification;

      class GappsNotification extends EventTarget {
        constructor(title, options = {}) {
          super();
          this.title = title || '';
          this.body = (options && options.body) || '';
          this.icon = (options && options.icon) || '';
          this.tag = (options && options.tag) || '';

          if (window.__gappsNotify && window.__gappsNotify.send) {
            window.__gappsNotify.send({
              title: this.title,
              body: this.body,
              icon: this.icon,
              tag: this.tag
            });
          }
        }

        static get permission() {
          return 'granted';
        }

        static requestPermission(callback) {
          if (callback) callback('granted');
          return Promise.resolve('granted');
        }

        close() {}
      }

      GappsNotification.maxActions = 2;
      window.Notification = GappsNotification;

      // Intercept ServiceWorkerRegistration.showNotification
      if (typeof ServiceWorkerRegistration !== 'undefined' && ServiceWorkerRegistration.prototype) {
        const origShow = ServiceWorkerRegistration.prototype.showNotification;
        ServiceWorkerRegistration.prototype.showNotification = function(title, options = {}) {
          if (window.__gappsNotify && window.__gappsNotify.send) {
            window.__gappsNotify.send({
              title: title || '',
              body: (options && options.body) || '',
              icon: (options && options.icon) || '',
              tag: (options && options.tag) || ''
            });
            return Promise.resolve();
          }
          return origShow ? origShow.apply(this, arguments) : Promise.resolve();
        };
      }

      // Track user interactions to clear unread badges
      ['focus', 'click', 'keydown', 'touchstart'].forEach(function(evt) {
        try {
          window.addEventListener(evt, function() {
            if (window.__gappsNotify && window.__gappsNotify.userActive) {
              window.__gappsNotify.userActive();
            }
          }, { capture: true, passive: true });
        } catch (_) {}
      });

      // Emulate Google Docs Offline Chrome Extension presence and permissions
      // so Google Docs/Sheets/Slides grant clipboard actions and don't prompt for extension installation
      try {
        window._docs_chrome_extension_exists = true;
        window._docs_chrome_extension_features_version = 1;
        window._docs_chrome_extension_permissions = [
          'alarms',
          'clipboardRead',
          'clipboardWrite',
          'storage',
          'unlimitedStorage'
        ];
      } catch (_) {}

      // Keep background push events and WebSockets alive by pretending document is never frozen/hidden
      try {
        Object.defineProperty(document, 'hidden', {
          get: () => false,
          configurable: true
        });
        Object.defineProperty(document, 'visibilityState', {
          get: () => 'visible',
          configurable: true
        });
      } catch (_) {}

      // DOM MutationObserver for real-time unread badges (Google Chat, Gmail, etc.)
      let lastReportedUnread = 0;
      function checkUnreadDOM() {
        try {
          // Check document title e.g. "(3) Google Chat" or "* Google Chat"
          const title = document.title || '';
          const match = title.match(/\\(([0-9]+)\\)/);
          let count = match ? parseInt(match[1], 10) : 0;

          // If no count in title, check common Google Chat / Gmail unread badge DOM elements
          if (count === 0) {
            // Google Chat unread badge element or aria-label
            const chatBadges = document.querySelectorAll('[aria-label*="unread" i], [data-unread-count]');
            for (let i = 0; i < chatBadges.length; i++) {
              const el = chatBadges[i];
              const attr = el.getAttribute('data-unread-count') || el.getAttribute('aria-label') || '';
              const m = attr.match(/([0-9]+)/);
              if (m) {
                count += parseInt(m[1], 10);
              } else if (/unread/i.test(attr)) {
                count += 1;
              }
            }
          }

          if (count !== lastReportedUnread) {
            lastReportedUnread = count;
            if (window.__gappsNotify && window.__gappsNotify.sendUnreadCount) {
              window.__gappsNotify.sendUnreadCount({ count, title });
            }
          }
        } catch (_) {}
      }

      try {
        const observer = new MutationObserver(checkUnreadDOM);
        if (document.head) {
          const titleEl = document.querySelector('title');
          if (titleEl) {
            observer.observe(titleEl, { subtree: true, characterData: true, childList: true });
          }
        }
        if (document.body) {
          observer.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['aria-label', 'data-unread-count'] });
        } else {
          document.addEventListener('DOMContentLoaded', () => {
            if (document.body) {
              observer.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['aria-label', 'data-unread-count'] });
            }
          });
        }
        setInterval(checkUnreadDOM, 3000);
      } catch (_) {}
    })();
  `);
} catch (err) {
  console.warn('Failed to inject notification handler:', err);
}
