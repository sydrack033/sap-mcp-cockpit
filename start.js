'use strict';

// Launcher robusto: alguns ambientes (VSCode, terminais integrados) deixam
// ELECTRON_RUN_AS_NODE=1 no ambiente, o que faz o electron.exe rodar como
// Node puro e quebrar com "Cannot read properties of undefined (reading 'getPath')".
// Aqui limpamos a variavel e iniciamos o Electron normalmente.

const { spawn } = require('child_process');
const electron = require('electron'); // caminho do binario do Electron
const path = require('path');

const env = Object.assign({}, process.env);
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, [path.join(__dirname, '.')], {
  stdio: 'inherit',
  env
});

child.on('close', (code) => process.exit(code === null ? 0 : code));
