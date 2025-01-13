const { contextBridge, ipcRenderer } = require('electron');

// Utilized by the renderer (index.html) to communicate to other javascript for os and file and other system utilities
// Ordered Alphabetically
contextBridge.exposeInMainWorld('api', {
  createFaro: (modPath, modData) => ipcRenderer.invoke('create-faro', modPath, modData),
  createFile: (modPath, fileName) => ipcRenderer.invoke('create-file', modPath, fileName),
  deleteDirectory: (dirPath) => ipcRenderer.invoke('delete-directory', dirPath),
  deleteFile: (modPath, fileName) => ipcRenderer.invoke('delete-file', modPath, fileName),
  deleteSpecial: (mod) => ipcRenderer.invoke('delete-special', mod),
  fetchHash: (githubUrl, mod) => ipcRenderer.invoke('fetch-hash', githubUrl, mod),
  fetchReadme: (repoUrl) => ipcRenderer.invoke('fetch-readme', repoUrl),
  getMods: () => ipcRenderer.invoke('get-mods'),
  installMod: (mod) => ipcRenderer.invoke('install-mod', mod),
  launchGame: () => ipcRenderer.invoke('launch-game'),
  log: (message) => ipcRenderer.send('log-message', message),
  logError: (message) => ipcRenderer.send('log-error', message),
  openFileDialog: (initialDirectory) => ipcRenderer.invoke('open-file-dialog', initialDirectory),
  saveConfig: (gamePath, modPath, autoUpdate) => ipcRenderer.invoke('save-config', gamePath, modPath, autoUpdate),
  startupCheck: () => ipcRenderer.invoke('startup-check'),
  updateModlist: () => ipcRenderer.invoke('update-modlist') 
});
