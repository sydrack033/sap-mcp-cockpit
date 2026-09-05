'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // settings
  loadSettings: ()         => ipcRenderer.invoke('settings:load'),
  saveSettings: (s)        => ipcRenderer.invoke('settings:save', s),

  // clients / environments
  loadClients: ()          => ipcRenderer.invoke('clients:load'),
  saveClients: (c)         => ipcRenderer.invoke('clients:save', c),
  // levar conexoes pra outra maquina: o JSON sai SEM senha e sem caminho
  // absoluto, entao pode trafegar por Drive/e-mail sem virar vazamento
  connsExport: ()          => ipcRenderer.invoke('conns:export'),
  connsImport: ()          => ipcRenderer.invoke('conns:import'),

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
  // varredura: regrava as configs de TODAS as conexoes ja registradas (usada
  // depois de trocar o engine, que so muda o que sera gerado dali pra frente)
  resyncAll: (p)           => ipcRenderer.invoke('configs:resyncAll', p),
  // engines disponiveis (id/label/caps) pro seletor e pra adaptacao do form
  enginesList: ()          => ipcRenderer.invoke('engines:list'),
  // instalacao gerenciada do ARC-1 (evita o npx, que custa 6-18s por start)
  arc1Status: (p)          => ipcRenderer.invoke('arc1:status', p),
  arc1CheckLatest: ()      => ipcRenderer.invoke('arc1:checkLatest'),
  arc1Install: (p)         => ipcRenderer.invoke('arc1:install', p),
  onArc1Progress: (cb)     => ipcRenderer.on('arc1:progress', (_evt, linha) => cb(linha)),
  syncCodex: (p)           => ipcRenderer.invoke('mcp:syncCodex', p),
  vspLogin: (p)            => ipcRenderer.invoke('vsp:login', p),
  vspTest: (p)             => ipcRenderer.invoke('vsp:test', p),
  cookiesStatus: (p)       => ipcRenderer.invoke('cookies:status', p),
  // diagnostico dos pre-requisitos do bridge RFC (Python x64, pyrfc, NW RFC SDK)
  bridgeDiagnose: (p)      => ipcRenderer.invoke('bridge:diagnose', p),
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
