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
      // Also intercept addEventListener so visibilitychange can be triggered when needed
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

      // Check unread status from document.title, DOM unread attributes, or section indicators
      let lastReportedUnread = -1;
      let cleanTitleCountdown = 0;

      function checkUnreadDOM() {
        try {
          const title = (document.title || '').trim();
          const match = title.match(/\\(([0-9]+)\\)/);
          const hasStar = title.startsWith('*');

          let count = 0;
          if (match) {
            count = parseInt(match[1], 10);
            cleanTitleCountdown = 0;
          } else if (hasStar) {
            count = 1;
            cleanTitleCountdown = 0;
          } else {
            // Check Google Chat unread section count (excluding shortcuts/drafts)
            // Section types in Google Chat:
            // "1" = Direct messages
            // "2" = Spaces
            // "10" = Shortcuts (includes Drafts, Mentions, etc. - drafts MUST NOT count as unread!)
            try {
              const sectionEls = document.querySelectorAll('div[data-section-type="1"], div[data-section-type="2"]');
              for (let i = 0; i < sectionEls.length; i++) {
                const toggle = sectionEls[i].querySelector('[aria-labelledby]');
                if (toggle) {
                  const labelledBy = toggle.getAttribute('aria-labelledby') || '';
                  const ids = labelledBy.trim().split(/\s+/);
                  if (ids.length >= 2) {
                    const countEl = document.getElementById(ids[1]);
                    if (countEl && countEl.textContent) {
                      const c = parseInt(countEl.textContent.trim(), 10);
                      if (!isNaN(c) && c > 0) {
                        count += c;
                      }
                    }
                  }
                }
              }
            } catch (_) {}

            // Also check for individual unread items in Chat/Gmail (e.g. data-is-unread="true")
            if (count === 0) {
              try {
                const unreadItems = document.querySelectorAll('[data-is-unread="true"]');
                if (unreadItems.length > 0) {
                  count = unreadItems.length;
                }
              } catch (_) {}
            }

            // If count is 0 and title has no unread marks, verify over 2 consecutive cycles (~2 seconds)
            // to guard against transient title flips before reporting count 0
            if (count === 0) {
              cleanTitleCountdown++;
              if (cleanTitleCountdown < 2 && lastReportedUnread > 0) {
                return;
              }
            } else {
              cleanTitleCountdown = 0;
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
          observer.observe(document.head, { subtree: true, characterData: true, childList: true, attributes: true });
        }
        if (document.body) {
          observer.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['aria-labelledby', 'data-section-type', 'data-is-unread'] });
        } else {
          document.addEventListener('DOMContentLoaded', () => {
            if (document.body) {
              observer.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['aria-labelledby', 'data-section-type', 'data-is-unread'] });
            }
          });
        }
        setInterval(checkUnreadDOM, 1000);
      } catch (_) {}
    })();
  `);
} catch (err) {
  console.warn('Failed to inject notification handler:', err);
}
