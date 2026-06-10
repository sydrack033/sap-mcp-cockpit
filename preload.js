'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // settings
  loadSettings: ()         => ipcRenderer.invoke('settings:load'),
  saveSettings: (s)        => ipcRenderer.invoke('settings:save', s),

  // clients / environments
  loadClients: ()          => ipcRenderer.invoke('clients:load'),
  saveClients: (c)         => ipcRenderer.invoke('clients:save', c),

  // dialogs
  pickFile: (opts)         => ipcRenderer.invoke('dialog:pickFile', opts),
  pickFolder: (opts)       => ipcRenderer.invoke('dialog:pickFolder', opts),

  // actions
  generateConfigs: (p)     => ipcRenderer.invoke('configs:generate', p),
  vspLogin: (p)            => ipcRenderer.invoke('vsp:login', p),
  vspTest: (p)             => ipcRenderer.invoke('vsp:test', p),
  cookiesStatus: (p)       => ipcRenderer.invoke('cookies:status', p),
  openVscode: (s)          => ipcRenderer.invoke('vscode:open', s),
  openFolder: (s)          => ipcRenderer.invoke('folder:open', s)
});
