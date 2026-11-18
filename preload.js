const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gapps', {
  getState: () => ipcRenderer.invoke('get-state'),
  getApps: () => ipcRenderer.invoke('get-apps'),
  activateTab: (id) => ipcRenderer.invoke('activate-tab', id),
  closeTab: (id) => ipcRenderer.invoke('close-tab', id),
  moveTab: (sourceId, targetId, dropAfter) =>
    ipcRenderer.invoke('move-tab', { sourceId, targetId, dropAfter }),
  moveTabToEnd: (sourceId) => ipcRenderer.invoke('move-tab-to-end', sourceId),
  openNewTab: () => ipcRenderer.invoke('open-new-tab'),
  navigateCurrentTab: (url, appId) =>
    ipcRenderer.invoke('navigate-current-tab', { url, appId }),
  toggleLockTab: (id) => ipcRenderer.invoke('toggle-lock-tab', id),
  togglePinTab: (id) => ipcRenderer.invoke('toggle-pin-tab', id),
  setTabCustomTitle: (id, customTitle) =>
    ipcRenderer.invoke('set-tab-custom-title', { id, customTitle }),
  promptRenameTab: (id) => ipcRenderer.invoke('prompt-rename-tab', id),
  toggleMuteTab: (id) => ipcRenderer.invoke('toggle-mute-tab', id),
  reloadActive: () => ipcRenderer.invoke('reload-active'),
  showAppMenu: () => ipcRenderer.invoke('show-app-menu'),
  showTabMenu: (id) => ipcRenderer.invoke('show-tab-menu', id),
  showSettingsMenu: () => ipcRenderer.invoke('show-settings-menu'),
  setTabLayout: (layout) => ipcRenderer.invoke('set-tab-layout', layout),
  toggleTabLayout: () => ipcRenderer.invoke('toggle-tab-layout'),
  setDesktopTheme: (theme) => ipcRenderer.invoke('set-desktop-theme', theme),
  onState: (callback) => {
    ipcRenderer.on('state-update', (_e, state) => callback(state));
  },
  onRequestRenameTab: (callback) => {
    ipcRenderer.on('request-tab-rename', (_e, tabId) => callback(tabId));
  }
});
