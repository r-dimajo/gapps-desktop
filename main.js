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
  desktopCapturer
} = require('electron');
const path = require('path');
const fs = require('fs');
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
  start_minimized: false
};

// Map of tabId -> WebContentsView
const tabViews = new Map();

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
        state.tabs = data.tabs;
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
  state.tabs = [{ id, app: defaultApp.id, title: defaultApp.title, url: defaultApp.url }];
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
            tabs: state.tabs.map((t) => ({ id: t.id, app: t.app, title: t.title, url: t.url })),
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
      tabs: state.tabs.map((t) => ({ id: t.id, app: t.app, title: t.title, url: t.url })),
      active: state.active,
      apps: APPS
    });
  }
}

function updateBounds() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const [width, height] = mainWindow.getContentSize();

  if (tabbarView) {
    tabbarView.setBounds({ x: 0, y: 0, width, height: TABBAR_HEIGHT });
  }

  if (state.active && tabViews.has(state.active)) {
    const activeView = tabViews.get(state.active);
    activeView.setBounds({
      x: 0,
      y: TABBAR_HEIGHT,
      width,
      height: Math.max(0, height - TABBAR_HEIGHT)
    });
  }
}

function createTabView(tab) {
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
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
    const detected = detectApp(url);
    if (detected && detected.id !== tab.app) {
      tab.app = detected.id;
    }
    saveState();
    broadcastState();
  });

  // Update tab title
  view.webContents.on('page-title-updated', (event, title) => {
    event.preventDefault();
    if (title) {
      tab.title = title;
      if (tab.id === state.active && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setTitle(`${title} — Google Suite`);
      }
      saveState();
      broadcastState();
    }
  });

  view.webContents.loadURL(tab.url);
  return view;
}

function createTab(url, appId = null, activate = true) {
  const appDef = appId ? byId(appId) : (detectApp(url) || APPS[0]);
  const tabId = 'tab_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  const tab = {
    id: tabId,
    app: appDef.id,
    title: appDef.title,
    url: url || appDef.url
  };
  state.tabs.push(tab);

  if (activate) {
    activateTab(tabId);
  } else {
    saveState();
    broadcastState();
  }
  return tabId;
}

function activateTab(tabId) {
  const tab = state.tabs.find((t) => t.id === tabId);
  if (!tab) return;

  const prevActiveId = state.active;
  if (prevActiveId && prevActiveId !== tabId && tabViews.has(prevActiveId)) {
    const prevView = tabViews.get(prevActiveId);
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        mainWindow.contentView.removeChildView(prevView);
      } catch (_) {}
    }
  }

  // Lazy instantiate tab view
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

  if (state.tabs.length === 0) {
    createTab(APPS[0].url, APPS[0].id, true);
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
      label: 'Apri nel browser predefinito',
      click: () => {
        shell.openExternal(tab.url);
        closeTab(tabId);
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
      click: () => closeTab(tabId)
    },
    {
      label: 'Chiudi le altre schede',
      enabled: state.tabs.length > 1,
      click: () => {
        const toClose = state.tabs.filter((t) => t.id !== tabId).map((t) => t.id);
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
    { type: 'separator' },
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
  const icon = nativeImage.createFromPath(ICON_PATH);
  tray = new Tray(icon);
  tray.setToolTip('Google Suite');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Mostra / Nascondi Google Suite',
      click: toggleWindow
    },
    { type: 'separator' },
    {
      label: 'Gmail',
      click: () => showAndSwitchTo('gmail')
    },
    {
      label: 'Calendar',
      click: () => showAndSwitchTo('calendar')
    },
    {
      label: 'Drive',
      click: () => showAndSwitchTo('drive')
    },
    {
      label: 'Meet',
      click: () => showAndSwitchTo('meet')
    },
    {
      label: 'Chat',
      click: () => showAndSwitchTo('chat')
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

// IPC Handlers
ipcMain.handle('get-state', () => ({
  tabs: state.tabs.map((t) => ({ id: t.id, app: t.app, title: t.title, url: t.url })),
  active: state.active,
  apps: APPS
}));

ipcMain.handle('activate-tab', (_event, id) => activateTab(id));
ipcMain.handle('close-tab', (_event, id) => closeTab(id));
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

app.on('second-instance', (_event, commandLine) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
  handleArgv(commandLine.slice(1));
});

app.whenReady().then(() => {
  loadSettings();
  loadState();

  // Strip Electron identifier from User-Agent so Google accounts & services don't block login
  const defaultUa = session.defaultSession.getUserAgent();
  const cleanUa = defaultUa.replace(/Electron\/\S+\s?/, '').replace(/gapps\/\S+\s?/, '');
  session.defaultSession.setUserAgent(cleanUa);

  // Grant Meet & Google Suite permissions automatically
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const url = webContents.getURL();
    if (isInternal(url)) {
      const allowed = [
        'media',
        'notifications',
        'display-capture',
        'mediaKeySystem',
        'clipboard-read',
        'clipboard-sanitized-write'
      ];
      if (allowed.includes(permission)) {
        return callback(true);
      }
    }
    callback(false);
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
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 700,
    minHeight: 500,
    title: 'Google Suite',
    icon: ICON_PATH,
    autoHideMenuBar: true,
    backgroundColor: '#202124',
    show: false
  });

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

  // Attach active tab
  if (state.active) {
    activateTab(state.active);
  }

  updateBounds();
  mainWindow.on('resize', updateBounds);

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

app.on('before-quit', () => {
  app.isQuitting = true;
});
