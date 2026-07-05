const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('lumen', {
  getVersion: () => ipcRenderer.invoke('app-version'),
  isDark: () => ipcRenderer.invoke('is-dark-mode'),
  getPlatform: () => ipcRenderer.invoke('get-platform'),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  onAdBlocked: (fn) => ipcRenderer.on('ad-blocked', (_, n) => fn(n)),
  onPlatform: (fn) => ipcRenderer.on('platform', (_, p) => fn(p)),
  onWinMaximized: (fn) => ipcRenderer.on('win-maximized', (_, v) => fn(v)),
  createIncognitoSession: (id) => ipcRenderer.invoke('create-incognito-session', id),
  pickBgImage: () => ipcRenderer.invoke('pick-bg-image'),
  loadExtensionFolder: () => ipcRenderer.invoke('load-extension-folder'),
  getExtensions: () => ipcRenderer.invoke('get-extensions'),
  removeExtension: (id) => ipcRenderer.invoke('remove-extension', id),
  getChromeExtPath: () => ipcRenderer.invoke('get-chrome-ext-path'),
  // Window controls (Windows/Linux)
  winMinimize: () => ipcRenderer.send('win-minimize'),
  winMaximize: () => ipcRenderer.send('win-maximize'),
  winClose: () => ipcRenderer.send('win-close'),
  onUpdateReady: (fn) => ipcRenderer.on('update-ready', fn),
  installUpdate: () => ipcRenderer.send('install-update'),
  onExtInstalled: (fn) => ipcRenderer.on('ext-installed', (_, d) => fn(d)),
  onExtInstallError: (fn) => ipcRenderer.on('ext-install-error', (_, msg) => fn(msg)),
})
