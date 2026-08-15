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
  // Habilitar MCP: escopo global (~/.claude.json + Codex). Escopo de projeto
  // (.mcp.json na pasta) nao existe mais — nao ha como pre-aprovar, o server
  // ficava em "pending approval" e nunca subia.
  generateGlobal: (p)      => ipcRenderer.invoke('configs:generateGlobal', p),
  removeGlobal: (p)        => ipcRenderer.invoke('configs:removeGlobal', p),
  globalStatus: ()         => ipcRenderer.invoke('configs:globalStatus'),
  syncCodex: (p)           => ipcRenderer.invoke('mcp:syncCodex', p),
  vspLogin: (p)            => ipcRenderer.invoke('vsp:login', p),
  vspTest: (p)             => ipcRenderer.invoke('vsp:test', p),
  cookiesStatus: (p)       => ipcRenderer.invoke('cookies:status', p),
  // abrir o projeto em: 'vscode' | 'claude' | 'codex'
  openIn: (p)              => ipcRenderer.invoke('open:in', p),
  openFolder: (p)          => ipcRenderer.invoke('folder:open', p),

  // import do SAP GUI (SAPUILandscape.xml no AppData)
  sapLandscape: ()         => ipcRenderer.invoke('sap:landscape'),

  // auto-update
  updateState: ()          => ipcRenderer.invoke('update:state'),
  updateCheck: ()          => ipcRenderer.invoke('update:check'),
  updateInstall: ()        => ipcRenderer.invoke('update:install'),
  // push do main -> renderer (checking / downloading / ready / error)
  onUpdateStatus: (cb)     => ipcRenderer.on('update:status', (_evt, s) => cb(s))
});
