const { contextBridge, ipcRenderer, webFrame } = require('electron');

// The notification/unread bridge and page patches are only for real Google apps.
// User-hosted content (*.googleusercontent.com) and other origins loaded in a tab get nothing.
function isTrustedLocation() {
  try {
    const host = (location.hostname || '').toLowerCase();
    return location.protocol === 'https:' && (host === 'google.com' || host.endsWith('.google.com'));
  } catch (_) {
    return false;
  }
}

if (isTrustedLocation()) {

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

  // User interaction listeners (DOM events are shared between worlds, one listener is enough)
  try {
    window.addEventListener('focus', reportUserActive, true);
    window.addEventListener('click', reportUserActive, true);
    window.addEventListener('keydown', reportUserActive, true);
    window.addEventListener('touchstart', reportUserActive, true);
  } catch (_) {}

  // Real visibility of this tab as computed by the main process (active tab / split view,
  // window shown and not minimized). backgroundThrottling:false makes Chromium always report
  // "visible", which makes Google Chat believe the user is reading the open conversation:
  // it then suppresses notifications and marks incoming messages as read automatically.
  let initialVisible = true;
  try {
    initialVisible = Boolean(ipcRenderer.sendSync('gapps-get-visibility'));
  } catch (_) {}

  const visibilityListeners = [];
  let currentVisible = initialVisible;
  ipcRenderer.on('gapps-visibility', (_e, visible) => {
    currentVisible = Boolean(visible);
    visibilityListeners.forEach((cb) => {
      try {
        cb(currentVisible);
      } catch (_) {}
    });
  });

  const notificationListeners = [];
  ipcRenderer.on('gapps-notification-event', (_e, payload) => {
    if (!payload || typeof payload.id !== 'string') return;
    notificationListeners.forEach((cb) => {
      try {
        cb(payload.id, String(payload.type || ''));
      } catch (_) {}
    });
  });

  // Expose safe bridge to main world
  contextBridge.exposeInMainWorld('__gappsNotify', {
    send: (data) => ipcRenderer.send('tab-notification', data),
    sendUnreadCount: (data) => ipcRenderer.send('tab-unread-count', data),
    userActive: reportUserActive,
    isVisible: () => currentVisible,
    onVisibility: (cb) => {
      if (typeof cb === 'function') visibilityListeners.push(cb);
    },
    onNotificationEvent: (cb) => {
      if (typeof cb === 'function') notificationListeners.push(cb);
    }
  });

  // Code below runs in the page's main world. It is written as a real function and
  // stringified, so regexes/escapes are not mangled by template-literal escaping.
  function gappsMainWorld() {
    if (window.__gapps_notification_injected) return;
    window.__gapps_notification_injected = true;

    const bridge = window.__gappsNotify;
    if (!bridge) return;

    // ---------------------------------------------------------------------------
    // Page Visibility: report the real state instead of always "visible"
    // ---------------------------------------------------------------------------
    let pageVisible = true;
    try {
      pageVisible = Boolean(bridge.isVisible());
    } catch (_) {}

    try {
      Object.defineProperty(document, 'hidden', {
        get: () => !pageVisible,
        configurable: true
      });
      Object.defineProperty(document, 'visibilityState', {
        get: () => (pageVisible ? 'visible' : 'hidden'),
        configurable: true
      });
    } catch (_) {}

    try {
      bridge.onVisibility(function (visible) {
        const v = Boolean(visible);
        if (v === pageVisible) return;
        pageVisible = v;
        try {
          document.dispatchEvent(new Event('visibilitychange'));
        } catch (_) {}
      });
    } catch (_) {}

    // ---------------------------------------------------------------------------
    // Notification API proxy: route to native desktop notifications via main process,
    // keep onclick/onshow/onclose semantics so the web app can react (e.g. Chat opens
    // the right conversation on click).
    // ---------------------------------------------------------------------------
    const liveNotifications = new Map();
    const MAX_LIVE = 200;
    let notifSeq = 0;

    function fire(target, type) {
      let ev;
      try {
        ev = new Event(type, { cancelable: true });
      } catch (_) {
        return;
      }
      try {
        target.dispatchEvent(ev);
      } catch (_) {}
      const handler = target['on' + type];
      if (typeof handler === 'function') {
        try {
          handler.call(target, ev);
        } catch (err) {
          setTimeout(function () {
            throw err;
          });
        }
      }
    }

    class GappsNotification extends EventTarget {
      constructor(title, options) {
        super();
        const opts = options || {};
        this.title = String(title || '');
        this.body = opts.body ? String(opts.body) : '';
        this.icon = opts.icon ? String(opts.icon) : '';
        this.tag = opts.tag ? String(opts.tag) : '';
        this.data = opts.data !== undefined ? opts.data : null;
        this.silent = Boolean(opts.silent);
        this.requireInteraction = Boolean(opts.requireInteraction);
        this.onclick = null;
        this.onshow = null;
        this.onclose = null;
        this.onerror = null;

        const id = 'n' + Date.now().toString(36) + '_' + ++notifSeq;
        Object.defineProperty(this, '__gappsId', { value: id });

        liveNotifications.set(id, this);
        if (liveNotifications.size > MAX_LIVE) {
          liveNotifications.delete(liveNotifications.keys().next().value);
        }

        try {
          bridge.send({
            id: id,
            title: this.title,
            body: this.body,
            icon: this.icon,
            tag: this.tag,
            silent: this.silent,
            requireInteraction: this.requireInteraction
          });
        } catch (_) {}

        const self = this;
        setTimeout(function () {
          fire(self, 'show');
        }, 0);
      }

      static get permission() {
        return 'granted';
      }

      static requestPermission(callback) {
        if (typeof callback === 'function') callback('granted');
        return Promise.resolve('granted');
      }

      close() {
        const id = this.__gappsId;
        if (!liveNotifications.has(id)) return;
        liveNotifications.delete(id);
        fire(this, 'close');
      }
    }

    GappsNotification.maxActions = 2;
    window.Notification = GappsNotification;

    try {
      bridge.onNotificationEvent(function (id, type) {
        const n = liveNotifications.get(id);
        if (!n) return;
        if (type === 'click') {
          try {
            window.focus();
          } catch (_) {}
          fire(n, 'click');
        } else if (type === 'close') {
          liveNotifications.delete(id);
          fire(n, 'close');
        }
      });
    } catch (_) {}

    // Intercept ServiceWorkerRegistration.showNotification (page-side calls only;
    // notifications shown from inside the service worker itself are not reachable here)
    if (typeof ServiceWorkerRegistration !== 'undefined' && ServiceWorkerRegistration.prototype) {
      ServiceWorkerRegistration.prototype.showNotification = function (title, options) {
        const opts = options || {};
        try {
          bridge.send({
            id: 'sw' + Date.now().toString(36) + '_' + ++notifSeq,
            title: String(title || ''),
            body: opts.body ? String(opts.body) : '',
            icon: opts.icon ? String(opts.icon) : '',
            tag: opts.tag ? String(opts.tag) : '',
            silent: Boolean(opts.silent),
            requireInteraction: Boolean(opts.requireInteraction)
          });
        } catch (_) {}
        return Promise.resolve();
      };
    }

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

    // ---------------------------------------------------------------------------
    // Unread counter (single source of truth for tab badges). Only for apps that
    // expose an unread count: Gmail and Chat. Other apps (Docs "Report (2)") must
    // not produce badges from their title.
    // ---------------------------------------------------------------------------
    const host = (location.hostname || '').toLowerCase();
    if (host !== 'mail.google.com' && host !== 'chat.google.com') return;

    const ZERO_GRACE_MS = 2500; // count must stay 0 this long before clearing the badge
    const HEARTBEAT_MS = 15000; // re-send the current count so main can resync
    let lastSent = -1;
    let lastSentAt = 0;
    let zeroSince = 0;

    function computeUnread() {
      const title = (document.title || '').trim();
      const match = title.match(/\(([0-9]+)\)/);
      if (match) return parseInt(match[1], 10) || 0;
      if (title.startsWith('*')) return 1;

      let count = 0;
      // Google Chat section headers:
      // "1" = Direct messages, "2" = Spaces,
      // "10" = Shortcuts (Drafts, Mentions... drafts MUST NOT count as unread)
      try {
        const sectionEls = document.querySelectorAll('div[data-section-type="1"], div[data-section-type="2"]');
        for (let i = 0; i < sectionEls.length; i++) {
          const toggle = sectionEls[i].querySelector('[aria-labelledby]');
          if (!toggle) continue;
          const ids = (toggle.getAttribute('aria-labelledby') || '').trim().split(/\s+/);
          if (ids.length < 2) continue;
          const countEl = document.getElementById(ids[1]);
          if (countEl && countEl.textContent) {
            const c = parseInt(countEl.textContent.trim(), 10);
            if (!isNaN(c) && c > 0) count += c;
          }
        }
      } catch (_) {}

      if (count === 0) {
        try {
          count = document.querySelectorAll('[data-is-unread="true"]').length;
        } catch (_) {}
      }
      return count;
    }

    function checkUnread() {
      try {
        const now = Date.now();
        const count = computeUnread();

        if (count === 0 && lastSent > 0) {
          // Debounce on wall-clock time (not on number of calls): Chat re-renders
          // its sidebar often and transiently shows no counters.
          if (!zeroSince) zeroSince = now;
          if (now - zeroSince < ZERO_GRACE_MS) return;
        } else if (count > 0) {
          zeroSince = 0;
        }

        if (count !== lastSent || now - lastSentAt >= HEARTBEAT_MS) {
          lastSent = count;
          lastSentAt = now;
          zeroSince = 0;
          bridge.sendUnreadCount({ count: count, title: document.title || '' });
        }
      } catch (_) {}
    }

    let scheduled = null;
    function scheduleCheck() {
      if (scheduled) return;
      scheduled = setTimeout(function () {
        scheduled = null;
        checkUnread();
      }, 250);
    }

    try {
      const observer = new MutationObserver(scheduleCheck);
      const attach = function () {
        if (document.head) {
          observer.observe(document.head, { subtree: true, characterData: true, childList: true });
        }
        if (document.body) {
          observer.observe(document.body, {
            attributes: true,
            subtree: true,
            attributeFilter: ['aria-labelledby', 'data-section-type', 'data-is-unread']
          });
        }
      };
      if (document.body) {
        attach();
      } else {
        document.addEventListener('DOMContentLoaded', attach);
      }
      setInterval(checkUnread, 1000);
    } catch (_) {}
  }

  try {
    webFrame.executeJavaScript('(' + gappsMainWorld.toString() + ')();');
  } catch (err) {
    console.warn('Failed to inject notification handler:', err);
  }
}
