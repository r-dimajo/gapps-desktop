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
    sendAvatar: (data) => ipcRenderer.send('gmail-avatar', data),
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
    const swNotificationTargets = new Map(); // sw notification id -> Chat conversation id
    const gmailNotificationTargets = new Map(); // gmail notification id -> legacy thread id

    // -------------------------------------------------------------------------
    // Google Chat: work out which conversation a notification belongs to (DM,
    // group chat or space) from the sidebar, and collect the images Chat itself
    // uses for it, so the desktop notification can show the same picture.
    // -------------------------------------------------------------------------
    const IS_CHAT = (location.hostname || '').toLowerCase() === 'chat.google.com';
    const CHAT_ITEM_SELECTOR = 'span[role=listitem][data-group-id]';

    function upsizeImageUrl(url) {
      const u = String(url || '');
      if (!u) return '';
      if (/^https:\/\/fonts\.gstatic\.com\/s\/e\/notoemoji\//.test(u)) {
        return u.replace(/\/\d+\.png(\?.*)?$/, '/128.png');
      }
      if (/^https:\/\/[^/]*googleusercontent\.com\//.test(u)) {
        return u.replace(/=s\d+(-w\d+)?(-h\d+)?/, '=s128-w128-h128');
      }
      return u;
    }

    function findChatConversation(opts) {
      if (!IS_CHAT) return null;
      let data = '';
      if (typeof opts.data === 'string') {
        data = opts.data;
      } else if (opts.data != null) {
        try {
          data = JSON.stringify(opts.data);
        } catch (_) {}
      }
      const haystack = String(opts.tag || '') + ' ' + data;
      if (!haystack.trim()) return null;
      let best = null;
      const items = document.querySelectorAll(CHAT_ITEM_SELECTOR);
      for (let i = 0; i < items.length; i++) {
        const groupId = items[i].getAttribute('data-group-id') || '';
        const slash = groupId.indexOf('/');
        const raw = slash >= 0 ? groupId.slice(slash + 1) : '';
        if (raw.length < 6 || haystack.indexOf(raw) === -1) continue;
        if (!best || raw.length > best.raw.length) best = { groupId: groupId, raw: raw, item: items[i] };
      }
      return best;
    }

    function getChatConversationIcon(opts) {
      const conv = findChatConversation(opts);
      if (!conv) return null;
      const imgs = Array.prototype.slice
        .call(conv.item.querySelectorAll('img'))
        .map(function (img) {
          return img.currentSrc || img.src || '';
        })
        .filter(function (src) {
          return /^https:\/\//.test(src);
        });
      const sender = opts.icon ? String(opts.icon) : '';
      const info = { groupId: conv.groupId, kind: 'unknown', base: '', grid: [], badge: '', emoji: false };
      if (conv.groupId.indexOf('dm/') === 0) {
        info.kind = 'dm';
        info.base = sender || upsizeImageUrl(imgs[0]);
      } else if (imgs.length >= 2) {
        // Unnamed group chat: Chat shows a grid of participant avatars
        info.kind = 'group';
        info.grid = imgs.slice(0, 4).map(upsizeImageUrl);
        info.badge = sender;
      } else if (imgs.length === 1) {
        // Space: emoji (Noto emoji PNG) or custom/default space image
        info.kind = 'space';
        info.base = upsizeImageUrl(imgs[0]);
        info.emoji = imgs[0].indexOf('/notoemoji/') !== -1;
        info.badge = sender;
      } else {
        info.base = sender;
      }
      return info;
    }

    function openChatConversation(groupId) {
      if (!IS_CHAT || !groupId) return;
      const items = document.querySelectorAll(CHAT_ITEM_SELECTOR);
      for (let i = 0; i < items.length; i++) {
        if (items[i].getAttribute('data-group-id') === groupId) {
          items[i].click();
          return;
        }
      }
      const raw = groupId.slice(groupId.indexOf('/') + 1);
      if (raw) location.assign('/app/chat/' + encodeURIComponent(raw));
    }
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
        if (type === 'click' && gmailNotificationTargets.has(id)) {
          try {
            window.focus();
          } catch (_) {}
          const threadId = gmailNotificationTargets.get(id);
          location.hash = threadId ? '#inbox/' + encodeURIComponent(threadId) : '#inbox';
          return;
        }
        if (type === 'click' && swNotificationTargets.has(id)) {
          const groupId = swNotificationTargets.get(id);
          try {
            window.focus();
          } catch (_) {}
          openChatConversation(groupId);
          return;
        }
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
    // notifications shown from inside the service worker itself are not reachable here).
    // Google Chat uses this path: title "Sender" (DM) or "Sender (Group)", icon = sender
    // avatar, data = serialized message id containing the conversation id.
    if (typeof ServiceWorkerRegistration !== 'undefined' && ServiceWorkerRegistration.prototype) {
      ServiceWorkerRegistration.prototype.showNotification = function (title, options) {
        const opts = options || {};
        const id = 'sw' + Date.now().toString(36) + '_' + ++notifSeq;
        let chat = null;
        try {
          chat = getChatConversationIcon(opts);
        } catch (_) {}
        if (chat && chat.groupId) {
          swNotificationTargets.set(id, chat.groupId);
          if (swNotificationTargets.size > MAX_LIVE) {
            swNotificationTargets.delete(swNotificationTargets.keys().next().value);
          }
        }
        try {
          bridge.send({
            id: id,
            title: String(title || ''),
            body: opts.body ? String(opts.body) : '',
            icon: opts.icon ? String(opts.icon) : '',
            tag: opts.tag ? String(opts.tag) : '',
            silent: Boolean(opts.silent),
            requireInteraction: Boolean(opts.requireInteraction),
            chat: chat
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
    // Gmail: one desktop notification per new email, read from the inbox list
    // (works even when Gmail's own desktop notifications are disabled).
    //   - baseline at first scan: already-unread mail is not notified
    //   - only the Primary inbox list (#inbox, #inbox/<thread>) is considered
    //   - icon: sender photo if seen before in an open conversation (cached by
    //     main), otherwise a Gmail-style letter avatar drawn here
    // ---------------------------------------------------------------------------
    const host = (location.hostname || '').toLowerCase();
    if (host === 'mail.google.com') {
      const GMAIL_SCAN_MS = 2000;
      const GMAIL_BATCH_LIMIT = 3; // more new mails at once -> one summary notification
      const knownUnread = new Map(); // legacy thread id -> signature
      let inboxList = null;
      let baselineDone = false;
      const sentAvatars = new Set();

      const LETTER_COLORS = [
        '#e8453c', '#f4511e', '#f9a825', '#7cb342', '#43a047', '#00897b',
        '#1e88e5', '#3949ab', '#8e24aa', '#d81b60', '#6d4c41', '#546e7a'
      ];

      const letterAvatar = function (name, email) {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 128;
          const ctx = canvas.getContext('2d');
          const key = String(email || name || '?').toLowerCase();
          let hash = 0;
          for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
          ctx.fillStyle = LETTER_COLORS[hash % LETTER_COLORS.length];
          ctx.beginPath();
          ctx.arc(64, 64, 64, 0, Math.PI * 2);
          ctx.fill();
          const letter = (Array.from(String(name || email || '?').trim())[0] || '?').toUpperCase();
          ctx.fillStyle = '#ffffff';
          ctx.font = '500 64px "Google Sans", Roboto, Arial, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(letter, 64, 68);
          return canvas.toDataURL('image/png');
        } catch (_) {
          return '';
        }
      };

      const isInboxHash = function () {
        const h = location.hash || '';
        return h === '#inbox' || h === '' || h.indexOf('#inbox/') === 0 || h.indexOf('#inbox?') === 0;
      };

      // The Primary inbox list container: acquired while it is the visible list
      const acquireInboxList = function () {
        if (inboxList && inboxList.isConnected) return inboxList;
        inboxList = null;
        const h = location.hash || '';
        if (h !== '#inbox' && h !== '') return null;
        const rows = document.querySelectorAll('tr.zA');
        for (let i = 0; i < rows.length; i++) {
          if (rows[i].offsetParent) {
            inboxList = rows[i].closest('table') || null;
            break;
          }
        }
        return inboxList;
      };

      const readRow = function (row) {
        const tidEl = row.querySelector('[data-legacy-thread-id]');
        const threadId = tidEl ? tidEl.getAttribute('data-legacy-thread-id') : '';
        if (!threadId) return null;
        // Bold names (.zF) are the senders with unread messages; take the latest one
        const senders = row.querySelectorAll('span.zF[email]');
        const senderEl = senders.length ? senders[senders.length - 1] : row.querySelector('span[email]');
        const email = senderEl ? senderEl.getAttribute('email') || '' : '';
        const name = senderEl ? senderEl.getAttribute('name') || senderEl.textContent || email : '';
        const subjectEl = row.querySelector('span.bog');
        const snippetEl = row.querySelector('span.y2');
        const subject = subjectEl ? subjectEl.textContent.trim() : '';
        const snippet = snippetEl ? snippetEl.textContent.replace(/^\s*-\s*/, '').trim() : '';
        return { threadId: threadId, email: email, name: name.trim(), subject: subject, snippet: snippet };
      };

      const notifyMail = function (mail) {
        const id = 'gm' + Date.now().toString(36) + '_' + ++notifSeq;
        gmailNotificationTargets.set(id, mail.threadId);
        if (gmailNotificationTargets.size > MAX_LIVE) {
          gmailNotificationTargets.delete(gmailNotificationTargets.keys().next().value);
        }
        const body = [mail.subject || '(nessun oggetto)', mail.snippet].filter(Boolean).join('\n');
        try {
          bridge.send({
            id: id,
            title: mail.name || mail.email || 'Nuova email',
            body: body.slice(0, 600),
            icon: letterAvatar(mail.name, mail.email),
            tag: 'gmail-thread-' + mail.threadId,
            silent: false,
            gmail: { threadId: mail.threadId, email: mail.email, name: mail.name, subject: mail.subject }
          });
        } catch (_) {}
      };

      // One notification for many mails: bursts of new mail, and the startup recap
      // of mail that was already unread (main shows the recap once per app run)
      const notifySummary = function (mails, title, tag, recap) {
        const names = [];
        mails.forEach(function (m) {
          const n = m.name || m.email;
          if (n && names.indexOf(n) === -1) names.push(n);
        });
        const id = 'gm' + Date.now().toString(36) + '_' + ++notifSeq;
        gmailNotificationTargets.set(id, '');
        try {
          bridge.send({
            id: id,
            title: title,
            body: 'Da: ' + names.slice(0, 5).join(', ') + (names.length > 5 ? '…' : ''),
            icon: '',
            tag: tag,
            silent: false,
            gmail: { threadId: '', email: '', name: '', subject: '', recap: Boolean(recap) }
          });
        } catch (_) {}
      };

      const titleUnreadCount = function () {
        const m = (document.title || '').match(/\((\d+)\)/);
        return m ? parseInt(m[1], 10) || 0 : 0;
      };

      const scanInbox = function () {
        if (!isInboxHash()) return;
        const list = acquireInboxList();
        if (!list) return;
        const current = new Map();
        const rows = list.querySelectorAll('tr.zA.zE');
        for (let i = 0; i < rows.length; i++) {
          const mail = readRow(rows[i]);
          if (mail) current.set(mail.threadId, mail);
        }
        const fresh = [];
        current.forEach(function (mail, threadId) {
          const signature = mail.email + '|' + mail.subject + '|' + mail.snippet;
          if (baselineDone && knownUnread.get(threadId) !== signature) fresh.push(mail);
          knownUnread.set(threadId, signature);
        });
        // Read threads leave the set, so a later reply notifies again
        knownUnread.forEach(function (_sig, threadId) {
          if (!current.has(threadId)) knownUnread.delete(threadId);
        });
        if (!baselineDone) {
          // Startup: mail already unread is summarized once, never notified one by one
          baselineDone = true;
          if (current.size > 0) {
            const total = Math.max(current.size, titleUnreadCount());
            notifySummary(Array.from(current.values()), total === 1 ? '1 email non letta' : total + ' email non lette', 'gmail-recap', true);
          }
          return;
        }
        if (fresh.length > GMAIL_BATCH_LIMIT) notifySummary(fresh, fresh.length + ' nuove email', 'gmail-batch', false);
        else fresh.forEach(notifyMail);
      };

      // Sender photos are only shown inside an open conversation: remember them
      const harvestAvatars = function () {
        const imgs = document.querySelectorAll('img.ajn');
        for (let i = 0; i < imgs.length; i++) {
          const img = imgs[i];
          if (!img.offsetParent) continue; // hidden views keep stale DOM
          const src = img.currentSrc || img.src || '';
          if (!/^https:\/\/[^/]*googleusercontent\.com\//.test(src)) continue;
          // Walk up to the nearest block that contains sender names; accept it only
          // if it names exactly one sender, so a photo is never attached to the
          // wrong person (e.g. the user's own avatar next to the reply box)
          let email = '';
          let el = img.parentElement;
          for (let depth = 0; el && depth < 6; depth++, el = el.parentElement) {
            const senders = el.querySelectorAll('span.gD[email]');
            if (!senders.length) continue;
            const distinct = new Set();
            for (let k = 0; k < senders.length; k++) distinct.add((senders[k].getAttribute('email') || '').toLowerCase());
            if (distinct.size === 1) email = senders[0].getAttribute('email') || '';
            break;
          }
          if (!email) continue;
          const url = src.replace(/=s\d+/, '=s128');
          const key = email.toLowerCase() + ' ' + url;
          if (sentAvatars.has(key)) continue;
          sentAvatars.add(key);
          try {
            bridge.sendAvatar({ email: email.toLowerCase(), url: url });
          } catch (_) {}
        }
      };

      setInterval(function () {
        try {
          scanInbox();
        } catch (_) {}
        try {
          harvestAvatars();
        } catch (_) {}
      }, GMAIL_SCAN_MS);
    }

    // ---------------------------------------------------------------------------
    // Unread counter (single source of truth for tab badges). Only for apps that
    // expose an unread count: Gmail and Chat. Other apps (Docs "Report (2)") must
    // not produce badges from their title.
    // ---------------------------------------------------------------------------
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
