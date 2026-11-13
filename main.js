const {
  app,
  BrowserWindow,
  WebContentsView,
  Menu,
  Tray,
  nativeImage,
  shell,
  ipcMain,
  dialog,
  session,
  desktopCapturer,
  globalShortcut,
  Notification
} = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { APPS, byId, byHost, detectApp, isInternal } = require('./apps');

// Linux Wayland, sandbox, and WebRTC PipeWire hardware flags
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-setuid-sandbox');
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
  app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer,WaylandWindowDecorations');
}

// Single instance lock
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

const TABBAR_HEIGHT = 36;
const CONFIG_DIR = path.join(app.getPath('userData'));
const STATE_FILE = path.join(CONFIG_DIR, 'state.json');
const SETTINGS_FILE = path.join(CONFIG_DIR, 'settings.json');
const ICON_PATH = path.join(__dirname, 'icons', 'icon.png');
const ICONS_DIR = path.join(__dirname, 'icons', 'apps');
const NEW_TAB_URL = 'file://' + path.join(__dirname, 'newtab', 'index.html');

let mainWindow = null;
let tabbarView = null;
let tray = null;
app.isQuitting = false;

let state = {
  tabs: [],
  active: null
};

let settings = {
  open_at_startup: false,
  start_minimized: false,
  memory_saver: true
};

// Map of tabId -> WebContentsView
const tabViews = new Map();

// Generate distinct, crisp 128x128 PNG icons for all Google apps from SVG vectors
async function ensureAppIcons() {
  try {
    fs.mkdirSync(ICONS_DIR, { recursive: true });
    const { ICONS } = require('./svg-icons');

    const metaPath = path.join(ICONS_DIR, '.meta.json');
    let meta = {};
    try {
      if (fs.existsSync(metaPath)) {
        meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      }
    } catch (_) {}

    const newMeta = { ...meta };
    const keysToGenerate = [];

    for (const [key, svg] of Object.entries(ICONS)) {
      if (['audio', 'muted', 'pin', 'newtab'].includes(key)) continue;
      const pngPath = path.join(ICONS_DIR, `${key}.png`);
      const hash = crypto.createHash('md5').update(svg).digest('hex');
      if (!fs.existsSync(pngPath) || fs.statSync(pngPath).size <= 200 || meta[key] !== hash) {
        keysToGenerate.push({ key, hash });
      }
    }

    if (keysToGenerate.length === 0) return;

    // Use an offscreen BrowserWindow to render real SVG vectors into 128x128 PNGs
    const offscreenWin = new BrowserWindow({
      show: false,
      width: 128,
      height: 128,
      frame: false,
      transparent: true,
      webPreferences: {
        offscreen: true,
        contextIsolation: true
      }
    });

    for (const { key, hash } of keysToGenerate) {
      const svg = ICONS[key];
      if (!svg) continue;
      const pngPath = path.join(ICONS_DIR, `${key}.png`);

      const cleanSvg = svg
        .replace(/width="[^"]*"/, 'width="128"')
        .replace(/height="[^"]*"/, 'height="128"');

      const html = `<!DOCTYPE html><html><head><style>html,body{margin:0;padding:0;width:128px;height:128px;overflow:hidden;background:transparent;display:flex;align-items:center;justify-content:center;}</style></head><body>${cleanSvg}</body></html>`;

      try {
        await offscreenWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
        await new Promise((r) => setTimeout(r, 70));
        const image = await offscreenWin.webContents.capturePage();
        const pngBuffer = image.toPNG();
        if (pngBuffer && pngBuffer.length > 200) {
          fs.writeFileSync(pngPath, pngBuffer);
          newMeta[key] = hash;
        }
      } catch (e) {
        console.error(`Failed to rasterize SVG for ${key}:`, e);
      }
    }

    try {
      fs.writeFileSync(metaPath, JSON.stringify(newMeta, null, 2));
    } catch (_) {}

    try { offscreenWin.destroy(); } catch (_) {}
  } catch (err) {
    console.error('Failed to generate app PNG icons via offscreen window:', err);
  }
}

function getAppIconPath(appId, badged = false) {
  if (badged) {
    const badgedPath = path.join(ICONS_DIR, `${appId}_badged.png`);
    if (fs.existsSync(badgedPath) && fs.statSync(badgedPath).size > 200) {
      return badgedPath;
    }
  }
  const p = path.join(ICONS_DIR, `${appId}.png`);
  if (fs.existsSync(p) && fs.statSync(p).size > 200) {
    return p;
  }
  return ICON_PATH;
}

function getTrayIconPath() {
  const p = path.join(ICONS_DIR, 'tray.png');
  if (fs.existsSync(p) && fs.statSync(p).size > 200) {
    return p;
  }
  return ICON_PATH;
}

function getTrayBadgedIconPath() {
  const p = path.join(ICONS_DIR, 'tray_badged.png');
  if (fs.existsSync(p) && fs.statSync(p).size > 200) {
    return p;
  }
  return getTrayIconPath();
}

function ensureDesktopFile() {
  if (process.platform !== 'linux') return;
  try {
    const home = process.env.HOME || app.getPath('home');
    const appsDir = path.join(home, '.local', 'share', 'applications');
    const iconsDir = path.join(home, '.local', 'share', 'icons', 'hicolor', '128x128', 'apps');
    const targetIconPath = path.join(iconsDir, 'gapps.png');
    const targetIconPathSuite = path.join(iconsDir, 'google-suite.png');
    const sourceIcon = path.resolve(ICON_PATH);

    // 1. Install hicolor icon for both gapps and google-suite
    try {
      if (!fs.existsSync(iconsDir)) {
        fs.mkdirSync(iconsDir, { recursive: true });
      }
      fs.copyFileSync(sourceIcon, targetIconPath);
      fs.copyFileSync(sourceIcon, targetIconPathSuite);
    } catch (_) {}

    // 2. Install .desktop file for both gapps.desktop and google-suite.desktop
    if (!fs.existsSync(appsDir)) {
      fs.mkdirSync(appsDir, { recursive: true });
    }

    const desktopContent = `[Desktop Entry]
Name=Google Suite
Comment=Google Suite desktop shell for Linux
Exec=npm start --prefix ${path.resolve(__dirname)}
Icon=${sourceIcon}
Terminal=false
Type=Application
StartupWMClass=gapps
StartupNotify=true
Categories=Network;Office;Chat;
`;

    const gappsDesktop = path.join(appsDir, 'gapps.desktop');
    const suiteDesktop = path.join(appsDir, 'google-suite.desktop');

    fs.writeFileSync(gappsDesktop, desktopContent, 'utf8');
    fs.writeFileSync(suiteDesktop, desktopContent.replace('StartupWMClass=gapps', 'StartupWMClass=google-suite'), 'utf8');

    // 3. Notify desktop environment / KDE Sycoca
    try {
      const { exec } = require('child_process');
      exec('update-desktop-database ~/.local/share/applications/ 2>/dev/null; kbuildsycoca6 --noincremental 2>/dev/null || kbuildsycoca5 --noincremental 2>/dev/null');
    } catch (_) {}
  } catch (err) {
    console.warn('Could not ensure desktop integration:', err);
  }
}

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      settings = Object.assign(settings, data);
    }
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}

function saveSettings() {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save settings:', err);
  }
}

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      if (data && Array.isArray(data.tabs) && data.tabs.length > 0) {
        state.tabs = data.tabs.map((t) => ({
          ...t,
          pinned: Boolean(t.pinned),
          unreadCount: 0,
          isAudible: false,
          isMuted: false,
          lastAccessed: Date.now()
        }));
        state.active = data.active || data.tabs[0].id;
        return;
      }
    }
  } catch (err) {
    console.error('Failed to load state:', err);
  }

  // Default initial tab: Gmail
  const defaultApp = byId('gmail') || APPS[0];
  const id = 'tab_' + Date.now();
  state.tabs = [
    {
      id,
      app: defaultApp.id,
      title: defaultApp.title,
      url: defaultApp.url,
      pinned: false,
      unreadCount: 0,
      isAudible: false,
      isMuted: false,
      lastAccessed: Date.now()
    }
  ];
  state.active = id;
}

let saveStateTimer = null;
function saveState() {
  clearTimeout(saveStateTimer);
  saveStateTimer = setTimeout(() => {
    try {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      fs.writeFileSync(
        STATE_FILE,
        JSON.stringify(
          {
            tabs: state.tabs.map((t) => ({
              id: t.id,
              app: t.app,
              title: t.title,
              url: t.url,
              pinned: Boolean(t.pinned)
            })),
            active: state.active
          },
          null,
          2
        ),
        'utf8'
      );
    } catch (err) {
      console.error('Failed to save state:', err);
    }
  }, 300);
}

function broadcastState() {
  if (tabbarView && !tabbarView.webContents.isDestroyed()) {
    tabbarView.webContents.send('state-update', {
      tabs: state.tabs.map((t) => ({
        id: t.id,
        app: t.app,
        title: t.title,
        url: t.url,
        pinned: Boolean(t.pinned),
        unreadCount: t.unreadCount || 0,
        hasNotification: Boolean(t.hasNotification),
        isAudible: Boolean(t.isAudible),
        isMuted: Boolean(t.isMuted)
      })),
      active: state.active,
      apps: APPS
    });
  }
}

function updateAppBadge() {
  const totalUnread = state.tabs.reduce((sum, t) => {
    const unread = Math.max(t.unreadCount || 0, t.hasNotification ? 1 : 0);
    return sum + unread;
  }, 0);
  if (app.setBadgeCount) {
    app.setBadgeCount(totalUnread);
  }
  if (tray) {
    tray.setToolTip(totalUnread > 0 ? `Google Suite (${totalUnread} non lette)` : 'Google Suite');
    const trayIconPath = totalUnread > 0 ? getTrayBadgedIconPath() : getTrayIconPath();
    try {
      tray.setImage(nativeImage.createFromPath(trayIconPath));
    } catch (_) {}
  }
}

function updateBounds() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const [width, height] = mainWindow.getContentSize();
  if (width <= 0 || height <= 0) return;

  if (tabbarView) {
    tabbarView.setBounds({ x: 0, y: 0, width, height: TABBAR_HEIGHT });
    try {
      if (tabbarView.webContents && !tabbarView.webContents.isDestroyed()) {
        tabbarView.webContents.invalidate();
      }
    } catch (_) {}
  }

  if (state.active && tabViews.has(state.active)) {
    const activeView = tabViews.get(state.active);
    const viewHeight = Math.max(0, height - TABBAR_HEIGHT);
    activeView.setBounds({
      x: 0,
      y: TABBAR_HEIGHT,
      width,
      height: viewHeight
    });
    try {
      activeView.setVisible(true);
      if (activeView.webContents && !activeView.webContents.isDestroyed()) {
        activeView.webContents.invalidate();
      }
    } catch (_) {}
  }
}

let resizeDebounceTimer = null;
function scheduleUpdateBounds() {
  updateBounds();
  if (resizeDebounceTimer) clearTimeout(resizeDebounceTimer);
  resizeDebounceTimer = setTimeout(() => {
    updateBounds();
    setTimeout(updateBounds, 120);
  }, 40);
}

function showCustomNotification({ title, body, icon, tag, appId, tabId }) {
  if (!Notification.isSupported()) return;

  const appDef = byId(appId);
  const appName = appDef ? appDef.title : 'Google Suite';

  // Prefer badged icon (with notification red dot) when notifying, or clean app icon
  const iconPath = getAppIconPath(appId, true);
  let notifIcon = iconPath;
  try {
    const img = nativeImage.createFromPath(iconPath);
    if (!img.isEmpty()) {
      notifIcon = img;
    }
  } catch (_) {}

  // Format custom title & branding per app
  let displayTitle = title || appName;
  if (appId === 'gmail') {
    displayTitle = title ? `Gmail • ${title}` : 'Nuova email ricevuta';
  } else if (appId === 'chat') {
    displayTitle = title ? `Google Chat • ${title}` : 'Nuovo messaggio in Chat';
  } else if (appId === 'calendar') {
    displayTitle = title ? `Google Calendar • ${title}` : 'Promemoria Google Calendar';
  } else if (appId === 'meet') {
    displayTitle = title ? `Google Meet • ${title}` : 'Google Meet';
  } else if (appId === 'gemini') {
    displayTitle = title ? `Gemini • ${title}` : 'Google Gemini';
  } else if (appDef && !displayTitle.toLowerCase().includes(appDef.title.toLowerCase())) {
    displayTitle = `${appDef.title} • ${displayTitle}`;
  }

  // Set urgency to 'normal' so KDE Plasma uses its classic auto-expire countdown timer
  const notification = new Notification({
    title: displayTitle,
    body: body || '',
    icon: notifIcon,
    urgency: 'normal',
    silent: false
  });

  // KDE classic style: auto-expire after 5 seconds
  const autoCloseTimer = setTimeout(() => {
    try {
      notification.close();
    } catch (_) {}
  }, 5000);

  notification.on('click', () => {
    clearTimeout(autoCloseTimer);
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();

    if (tabId && state.tabs.some((t) => t.id === tabId)) {
      activateTab(tabId);
    } else if (appId) {
      showAndSwitchTo(appId);
    }
  });

  notification.on('close', () => {
    clearTimeout(autoCloseTimer);
  });

  try {
    notification.show();
  } catch (err) {
    console.error('Failed to show notification:', err);
  }
}

function triggerNotificationForApp(appId, title, body) {
  let targetTab = state.tabs.find((t) => t.app === appId);
  if (!targetTab && state.tabs.length > 0) {
    targetTab = state.tabs[0];
  }
  if (targetTab) {
    targetTab.hasNotification = true;
    targetTab.unreadCount = (targetTab.unreadCount || 0) + 1;
    updateAppBadge();
    broadcastState();
  } else {
    updateAppBadge();
  }
  showCustomNotification({
    title,
    body,
    appId,
    tabId: targetTab ? targetTab.id : null
  });
}

function createTabView(tab) {
  const isLocalNewTab = tab.url.startsWith('file://');

  const view = new WebContentsView({
    webPreferences: {
      preload: isLocalNewTab
        ? path.join(__dirname, 'preload.js')
        : path.join(__dirname, 'tab-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true
    }
  });

  // Link interception: internal Google URLs open inside the shell as tabs;
  // external URLs open in default system browser
  view.webContents.setWindowOpenHandler(({ url }) => {
    if (isInternal(url)) {
      createTab(url, null, true);
      return { action: 'deny' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  view.webContents.on('will-navigate', (event, url) => {
    if (!isInternal(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // Track active URL and app
  view.webContents.on('did-navigate', (_event, url) => {
    tab.url = url;
    if (url.startsWith('file://')) {
      tab.app = 'newtab';
      tab.title = 'Nuova scheda';
    } else {
      const detected = detectApp(url);
      if (detected && detected.id !== tab.app) {
        tab.app = detected.id;
      }
    }
    saveState();
    broadcastState();
  });

  // Update tab title and parse unread badges
  view.webContents.on('page-title-updated', (event, title) => {
    event.preventDefault();
    if (title) {
      tab.title = title;

      // Extract unread message count from title (e.g. "Inbox (5) - user@gmail.com" or "(3) Google Chat")
      const match = title.match(/\(([0-9]+)\)/);
      tab.unreadCount = match ? parseInt(match[1], 10) : 0;
      updateAppBadge();

      if (tab.id === state.active && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setTitle(`${title} — Google Suite`);
      }
      saveState();
      broadcastState();
    }
  });

  // Audio indicators & mute detection
  view.webContents.on('media-started-playing', () => {
    tab.isAudible = true;
    broadcastState();
  });

  view.webContents.on('media-paused', () => {
    tab.isAudible = view.webContents.isCurrentlyAudible();
    broadcastState();
  });

  view.webContents.loadURL(tab.url);
  return view;
}

function createTab(url = null, appId = null, activate = true, pinned = false) {
  const isNewTab = !url && !appId;
  const targetUrl = isNewTab ? NEW_TAB_URL : (url || (byId(appId) ? byId(appId).url : NEW_TAB_URL));
  const appDef = appId ? byId(appId) : (detectApp(targetUrl) || null);

  const tabId = 'tab_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  const tab = {
    id: tabId,
    app: isNewTab ? 'newtab' : (appDef ? appDef.id : 'web'),
    title: isNewTab ? 'Nuova scheda' : (appDef ? appDef.title : 'Google'),
    url: targetUrl,
    pinned: Boolean(pinned),
    unreadCount: 0,
    isAudible: false,
    isMuted: false,
    lastAccessed: Date.now()
  };

  if (pinned) {
    const pinnedCount = state.tabs.filter((t) => t.pinned).length;
    state.tabs.splice(pinnedCount, 0, tab);
  } else {
    state.tabs.push(tab);
  }

  if (activate) {
    activateTab(tabId);
  } else {
    // If not activating, create background view so notifications work
    try {
      const view = createTabView(tab);
      tabViews.set(tabId, view);
    } catch (_) {}
    saveState();
    broadcastState();
  }
  return tabId;
}

function openNewTab() {
  return createTab(null, null, true, false);
}

function navigateCurrentTab(url, appId = null) {
  if (!state.active) return;
  const tab = state.tabs.find((t) => t.id === state.active);
  if (!tab) return;

  const appDef = appId ? byId(appId) : (detectApp(url) || null);
  tab.url = url;
  tab.app = appDef ? appDef.id : (tab.app !== 'newtab' ? tab.app : 'web');
  tab.title = appDef ? appDef.title : 'Caricamento...';
  tab.lastAccessed = Date.now();

  let view = tabViews.get(tab.id);
  if (view) {
    // If transitioning from local newtab to remote Google app, recreate view for proper preload & sandbox
    if (view.webContents.getURL().startsWith('file://') && !url.startsWith('file://')) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        try { mainWindow.contentView.removeChildView(view); } catch (_) {}
      }
      try { view.webContents.close(); } catch (_) {}
      tabViews.delete(tab.id);

      view = createTabView(tab);
      tabViews.set(tab.id, view);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.contentView.addChildView(view);
      }
      updateBounds();
      view.webContents.focus();
    } else {
      view.webContents.loadURL(url);
    }
  }

  saveState();
  broadcastState();
}

function activateTab(tabId) {
  const tab = state.tabs.find((t) => t.id === tabId);
  if (!tab) return;

  tab.lastAccessed = Date.now();

  const prevActiveId = state.active;
  if (prevActiveId && prevActiveId !== tabId && tabViews.has(prevActiveId)) {
    const prevView = tabViews.get(prevActiveId);
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        mainWindow.contentView.removeChildView(prevView);
      } catch (_) {}
    }
  }

  // Lazy instantiate tab view if not yet loaded in background
  let view = tabViews.get(tabId);
  if (!view) {
    view = createTabView(tab);
    tabViews.set(tabId, view);
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.contentView.addChildView(view);
    } catch (_) {}
  }

  state.active = tabId;
  tab.lastAccessed = Date.now();
  if (tab.hasNotification || (tab.unreadCount && tab.unreadCount > 0)) {
    tab.hasNotification = false;
    tab.unreadCount = 0;
    updateAppBadge();
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setTitle(`${tab.title || 'Google Suite'} — Google Suite`);
  }

  updateBounds();
  try {
    view.webContents.focus();
  } catch (_) {}

  saveState();
  broadcastState();
}

function closeTab(tabId) {
  const index = state.tabs.findIndex((t) => t.id === tabId);
  if (index === -1) return;

  if (tabViews.has(tabId)) {
    const view = tabViews.get(tabId);
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        mainWindow.contentView.removeChildView(view);
      } catch (_) {}
    }
    try {
      view.webContents.close();
    } catch (_) {}
    tabViews.delete(tabId);
  }

  state.tabs.splice(index, 1);
  updateAppBadge();

  if (state.tabs.length === 0) {
    openNewTab();
    return;
  }

  if (state.active === tabId) {
    const nextIndex = Math.min(index, state.tabs.length - 1);
    activateTab(state.tabs[nextIndex].id);
  } else {
    saveState();
    broadcastState();
  }
}

function togglePinTab(tabId) {
  const tab = state.tabs.find((t) => t.id === tabId);
  if (!tab) return;

  tab.pinned = !tab.pinned;
  const currentIdx = state.tabs.findIndex((t) => t.id === tabId);
  const [moved] = state.tabs.splice(currentIdx, 1);

  if (tab.pinned) {
    const pinnedCount = state.tabs.filter((t) => t.pinned).length;
    state.tabs.splice(pinnedCount, 0, moved);
  } else {
    const pinnedCount = state.tabs.filter((t) => t.pinned).length;
    state.tabs.splice(pinnedCount, 0, moved);
  }

  saveState();
  broadcastState();
}

function toggleMuteTab(tabId) {
  const tab = state.tabs.find((t) => t.id === tabId);
  if (!tab || !tabViews.has(tabId)) return;

  const view = tabViews.get(tabId);
  const nextMuted = !view.webContents.isAudioMuted();
  view.webContents.setAudioMuted(nextMuted);
  tab.isMuted = nextMuted;
  broadcastState();
}

function showAppMenu() {
  const template = APPS.map((a) => ({
    label: a.title,
    click: () => createTab(a.url, a.id, true)
  }));
  const menu = Menu.buildFromTemplate(template);
  menu.popup({ window: mainWindow });
}

function showTabMenu(tabId) {
  const tab = state.tabs.find((t) => t.id === tabId);
  if (!tab) return;

  const template = [
    {
      label: tab.pinned ? 'Separa scheda (Unpin)' : 'Fissa scheda (Pin)',
      click: () => togglePinTab(tabId)
    },
    {
      label: tab.isMuted ? 'Riattiva audio scheda' : 'Disattiva audio scheda',
      enabled: Boolean(tab.isAudible || tab.isMuted),
      click: () => toggleMuteTab(tabId)
    },
    { type: 'separator' },
    {
      label: 'Apri nel browser predefinito',
      click: () => {
        shell.openExternal(tab.url);
        if (!tab.pinned) closeTab(tabId);
      }
    },
    {
      label: 'Ricarica scheda',
      click: () => {
        if (tabViews.has(tabId)) {
          tabViews.get(tabId).webContents.reload();
        }
      }
    },
    {
      label: 'Duplica scheda',
      click: () => createTab(tab.url, tab.app, true)
    },
    { type: 'separator' },
    {
      label: 'Chiudi scheda',
      enabled: !tab.pinned,
      click: () => closeTab(tabId)
    },
    {
      label: 'Chiudi le altre schede',
      enabled: state.tabs.filter((t) => !t.pinned).length > 1,
      click: () => {
        const toClose = state.tabs.filter((t) => t.id !== tabId && !t.pinned).map((t) => t.id);
        toClose.forEach((id) => closeTab(id));
      }
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  menu.popup({ window: mainWindow });
}

function showSettingsMenu() {
  const template = [
    {
      label: "Avvia all'avvio del sistema",
      type: 'checkbox',
      checked: settings.open_at_startup,
      click: (item) => {
        settings.open_at_startup = item.checked;
        saveSettings();
        app.setLoginItemSettings({
          openAtLogin: settings.open_at_startup
        });
      }
    },
    {
      label: 'Avvia ridotto a icona',
      type: 'checkbox',
      checked: settings.start_minimized,
      click: (item) => {
        settings.start_minimized = item.checked;
        saveSettings();
      }
    },
    {
      label: 'Risparmio memoria (sospendi schede inattive)',
      type: 'checkbox',
      checked: settings.memory_saver,
      click: (item) => {
        settings.memory_saver = item.checked;
        saveSettings();
      }
    },
    { type: 'separator' },
    {
      label: 'Test notifica Google Chat...',
      click: () => {
        triggerNotificationForApp('chat', 'Mario Rossi', 'Ciao! Notifica di prova Google Chat con timer KDE.');
      }
    },
    {
      label: 'Test notifica Gmail...',
      click: () => {
        triggerNotificationForApp('gmail', 'Google Suite Team', 'Notifica di prova Gmail con timer KDE.');
      }
    },
    {
      label: 'Test notifica Google Gemini...',
      click: () => {
        triggerNotificationForApp('gemini', 'Google Gemini', 'Notifica di prova con stella Gemini e timer KDE.');
      }
    },
    {
      label: 'Cancella cache...',
      click: async () => {
        await session.defaultSession.clearCache();
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: 'Cache',
          message: 'Cache svuotata con successo.',
          buttons: ['OK']
        });
      }
    },
    { type: 'separator' },
    {
      label: 'Esci',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  menu.popup({ window: mainWindow });
}

function toggleWindow() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

function showAndSwitchTo(appId) {
  if (!mainWindow) return;
  mainWindow.show();
  mainWindow.focus();
  const existing = state.tabs.find((t) => t.app === appId);
  if (existing) {
    activateTab(existing.id);
  } else {
    const appDef = byId(appId);
    if (appDef) createTab(appDef.url, appDef.id, true);
  }
}

function createTray() {
  const icon = nativeImage.createFromPath(getTrayIconPath());
  tray = new Tray(icon);
  tray.setToolTip('Google Suite');

  // Nested submenu with all 11 apps
  const allAppsSubmenu = APPS.map((app) => {
    const iconPath = getAppIconPath(app.id);
    let itemIcon = null;
    try {
      const img = nativeImage.createFromPath(iconPath);
      if (!img.isEmpty()) {
        itemIcon = img.resize({ width: 16, height: 16 });
      }
    } catch (_) {}

    return {
      label: `${app.title} — ${app.description}`,
      icon: itemIcon || undefined,
      click: () => showAndSwitchTo(app.id)
    };
  });

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Mostra / Nascondi Google Suite',
      click: toggleWindow
    },
    {
      label: 'Nuova scheda (Griglia app)...',
      click: () => {
        if (!mainWindow.isVisible()) mainWindow.show();
        mainWindow.focus();
        openNewTab();
      }
    },
    { type: 'separator' },
    {
      label: 'Applicazioni Google',
      submenu: allAppsSubmenu
    },
    { type: 'separator' },
    {
      label: 'Esci',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', toggleWindow);
}

function handleArgv(argv) {
  for (const arg of argv) {
    if (!arg || arg.startsWith('-')) continue;
    if (arg.startsWith('http://') || arg.startsWith('https://')) {
      createTab(arg, null, true);
      return;
    }
    if (arg.startsWith('mailto:')) {
      const email = arg.replace(/^mailto:/, '');
      const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(email)}`;
      createTab(gmailUrl, 'gmail', true);
      return;
    }
    const found = byId(arg.toLowerCase());
    if (found) {
      showAndSwitchTo(found.id);
      return;
    }
  }
}

// Background tab hibernation for memory saving (> 30 min inactive)
// Note: Communication apps (Gmail, Chat, Calendar, Meet) and pinned tabs are NEVER hibernated!
setInterval(() => {
  if (!settings.memory_saver) return;
  const now = Date.now();
  const THIRTY_MINUTES = 30 * 60 * 1000;
  const NEVER_HIBERNATE = ['gmail', 'chat', 'calendar', 'meet'];

  state.tabs.forEach((tab) => {
    if (
      tab.id !== state.active &&
      !tab.pinned &&
      !tab.isAudible &&
      !NEVER_HIBERNATE.includes(tab.app) &&
      tabViews.has(tab.id) &&
      tab.lastAccessed &&
      now - tab.lastAccessed > THIRTY_MINUTES
    ) {
      const view = tabViews.get(tab.id);
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.contentView.removeChildView(view);
        }
        view.webContents.close();
      } catch (_) {}
      tabViews.delete(tab.id);
    }
  });
}, 5 * 60 * 1000);

// IPC Handlers
ipcMain.handle('get-state', () => ({
  tabs: state.tabs.map((t) => ({
    id: t.id,
    app: t.app,
    title: t.title,
    url: t.url,
    pinned: Boolean(t.pinned),
    unreadCount: t.unreadCount || 0,
    isAudible: Boolean(t.isAudible),
    isMuted: Boolean(t.isMuted)
  })),
  active: state.active,
  apps: APPS
}));

ipcMain.handle('get-apps', () => APPS);
ipcMain.handle('open-new-tab', () => openNewTab());
ipcMain.handle('navigate-current-tab', (_event, { url, appId }) =>
  navigateCurrentTab(url, appId)
);
ipcMain.handle('activate-tab', (_event, id) => activateTab(id));
ipcMain.handle('close-tab', (_event, id) => closeTab(id));
ipcMain.handle('toggle-pin-tab', (_event, id) => togglePinTab(id));
ipcMain.handle('toggle-mute-tab', (_event, id) => toggleMuteTab(id));

ipcMain.handle('move-tab', (_event, { sourceId, targetId, dropAfter }) => {
  const sourceIndex = state.tabs.findIndex((t) => t.id === sourceId);
  const targetIndex = state.tabs.findIndex((t) => t.id === targetId);
  if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) return;

  const [movedTab] = state.tabs.splice(sourceIndex, 1);
  const newTargetIndex = state.tabs.findIndex((t) => t.id === targetId);
  const insertIndex = dropAfter ? newTargetIndex + 1 : newTargetIndex;
  state.tabs.splice(insertIndex, 0, movedTab);

  saveState();
  broadcastState();
});

ipcMain.handle('move-tab-to-end', (_event, sourceId) => {
  const sourceIndex = state.tabs.findIndex((t) => t.id === sourceId);
  if (sourceIndex === -1) return;
  const [movedTab] = state.tabs.splice(sourceIndex, 1);
  state.tabs.push(movedTab);

  saveState();
  broadcastState();
});

ipcMain.handle('reload-active', () => {
  if (state.active && tabViews.has(state.active)) {
    tabViews.get(state.active).webContents.reload();
  }
});
ipcMain.handle('show-app-menu', () => showAppMenu());
ipcMain.handle('show-tab-menu', (_event, id) => showTabMenu(id));
ipcMain.handle('show-settings-menu', () => showSettingsMenu());

// Receive notifications from web pages (Gmail, Google Chat, etc.)
ipcMain.on('tab-notification', (event, { title, body, icon, tag }) => {
  let senderTab = null;
  for (const [id, view] of tabViews.entries()) {
    if (view && !view.webContents.isDestroyed() && view.webContents.id === event.sender.id) {
      senderTab = state.tabs.find((t) => t.id === id);
      break;
    }
  }

  let appId = senderTab ? senderTab.app : null;
  if (!appId) {
    const url = event.sender.getURL();
    if (url.includes('chat.google.com') || url.includes('mail.google.com/chat')) {
      appId = 'chat';
    } else if (url.includes('mail.google.com')) {
      appId = 'gmail';
    } else if (url.includes('calendar.google.com')) {
      appId = 'calendar';
    } else if (url.includes('meet.google.com')) {
      appId = 'meet';
    } else if (url.includes('gemini.google.com')) {
      appId = 'gemini';
    } else {
      const detected = detectApp(url);
      appId = detected ? detected.id : 'gmail';
    }
  }

  const targetTab = senderTab || state.tabs.find((t) => t.app === appId);
  if (targetTab) {
    targetTab.hasNotification = true;
    targetTab.unreadCount = (targetTab.unreadCount || 0) + 1;
    updateAppBadge();
    broadcastState();
  } else {
    updateAppBadge();
  }

  showCustomNotification({
    title,
    body,
    icon,
    tag,
    appId,
    tabId: targetTab ? targetTab.id : null
  });
});

app.on('second-instance', (_event, commandLine) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
  handleArgv(commandLine.slice(1));
});

app.whenReady().then(async () => {
  app.setName('Google Suite');
  if (app.setDesktopName) {
    app.setDesktopName('gapps.desktop');
  }
  app.setAppUserModelId('gapps');
  ensureDesktopFile();
  loadSettings();
  loadState();

  // Register Global System Hotkey (Ctrl+Alt+G) to toggle Google Suite from anywhere on Linux
  try {
    globalShortcut.register('CommandOrControl+Alt+G', () => {
      toggleWindow();
    });
  } catch (err) {
    console.warn('Could not register global hotkey:', err);
  }

  // Strip Electron identifier from User-Agent so Google accounts & services don't block login
  const defaultUa = session.defaultSession.getUserAgent();
  const cleanUa = defaultUa.replace(/Electron\/\S+\s?/, '').replace(/gapps\/\S+\s?/, '');
  session.defaultSession.setUserAgent(cleanUa);

  // Grant Meet & Google Suite permissions automatically
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    if (permission === 'notifications') return true;
    if (permission === 'media') return true;
    return true;
  });

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const url = webContents.getURL();
    if (isInternal(url)) {
      const allowed = [
        'notifications',
        'media',
        'display-capture',
        'mediaKeySystem',
        'clipboard-read',
        'clipboard-sanitized-write'
      ];
      if (allowed.includes(permission)) {
        return callback(true);
      }
    }
    callback(true);
  });

  // Setup screen capturer for Google Meet under Linux Wayland/PipeWire
  if (session.defaultSession.setDisplayMediaRequestHandler) {
    session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen', 'window'] })
        .then((sources) => {
          if (sources.length > 0) {
            callback({ video: sources[0] });
          } else {
            callback({});
          }
        })
        .catch(() => callback({}));
    });
  }

  // Create main window
  const appWindowIcon = nativeImage.createFromPath(ICON_PATH);
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 700,
    minHeight: 500,
    title: 'Google Suite',
    icon: appWindowIcon,
    autoHideMenuBar: true,
    backgroundColor: '#202124',
    show: false
  });
  try {
    mainWindow.setIcon(appWindowIcon);
  } catch (_) {}

  // Create permanent 36px tab bar view at top
  tabbarView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  tabbarView.webContents.loadFile(path.join(__dirname, 'tabbar', 'index.html'));
  mainWindow.contentView.addChildView(tabbarView);

  // Attach active tab immediately for instant startup
  if (state.active) {
    activateTab(state.active);
  }

  // Preload all background tabs (Chat, Gmail, Calendar, etc.) so real-time notifications
  // and WebSockets are connected immediately at launch without needing manual clicks!
  setTimeout(() => {
    state.tabs.forEach((tab) => {
      if (tab.id !== state.active && !tabViews.has(tab.id) && !tab.url.startsWith('file://')) {
        try {
          const view = createTabView(tab);
          tabViews.set(tab.id, view);
        } catch (err) {
          console.error(`Failed to preload background tab ${tab.app}:`, err);
        }
      }
    });
  }, 1000);

  // Safely ensure app icons in the background without blocking window launch
  setTimeout(() => {
    ensureAppIcons().catch((err) => console.warn('Background icon verification:', err));
  }, 2000);

  updateBounds();
  mainWindow.on('resize', scheduleUpdateBounds);
  mainWindow.on('resized', scheduleUpdateBounds);
  mainWindow.on('maximize', scheduleUpdateBounds);
  mainWindow.on('unmaximize', scheduleUpdateBounds);
  mainWindow.on('enter-full-screen', scheduleUpdateBounds);
  mainWindow.on('leave-full-screen', scheduleUpdateBounds);
  mainWindow.on('restore', scheduleUpdateBounds);

  // Close to tray behavior
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  createTray();

  // Show window if not started minimized
  if (!settings.start_minimized) {
    mainWindow.show();
  }

  // Handle CLI args
  handleArgv(process.argv.slice(1));
});

app.on('activate', () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('before-quit', () => {
  app.isQuitting = true;
});
