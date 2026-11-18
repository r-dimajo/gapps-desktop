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
    })();
  `);
} catch (err) {
  console.warn('Failed to inject notification handler:', err);
}
