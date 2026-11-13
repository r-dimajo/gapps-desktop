const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gapps', {
  getState: () => ipcRenderer.invoke('get-state'),
  activateTab: (id) => ipcRenderer.invoke('activate-tab', id),
  closeTab: (id) => ipcRenderer.invoke('close-tab', id),
  reloadActive: () => ipcRenderer.invoke('reload-active'),
  showAppMenu: () => ipcRenderer.invoke('show-app-menu'),
  showTabMenu: (id) => ipcRenderer.invoke('show-tab-menu', id),
  showSettingsMenu: () => ipcRenderer.invoke('show-settings-menu'),
  onState: (callback) => {
    ipcRenderer.on('state-update', (_e, state) => callback(state));
  }
});
