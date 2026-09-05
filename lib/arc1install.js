'use strict';

// ---------------------------------------------------------------------------
// Instalacao gerenciada do ARC-1 no userData.
//
// POR QUE existe: o default `npx -y arc-1@latest` custa 6-18s a CADA start do
// server MCP (medido) e ainda troca a versao embaixo do usuario sem avisar. Com
// o pacote instalado localmente e chamado por `node <entrypoint>`, o start cai
// pra ~3,1s constantes e a versao passa a ser uma decisao explicita.
//
// POR QUE NAO vem no instalador: sao 83 MB de pacote + 87 MB de runtime Node.
// Somados, 8,5x o Python do bridge que ja embarcamos -- e ainda faria cada
// correcao do ARC-1 esperar uma release nossa.
//
// POR QUE NAO roda no Node do Electron: o Electron 31 traz Node 20.18 e o ARC-1
// exige >=22.19. Mesmo atualizando, o `better-sqlite3` dele traz prebuilds do
// ABI do Node padrao, nao do Electron -- nao carregaria. O truque que funciona
// com o Python do bridge nao se repete aqui.
//
// LAYOUT (uma pasta por versao, ponteiro a parte):
//   <userData>/engines/arc1/
//     active.json        {"version":"1.1.2"}
//     1.1.2/node_modules/arc-1/bin/arc1.js
//
// Pasta por versao deixa a troca ATOMICA: o install acontece numa pasta
// temporaria e so vira versao de verdade no rename final. Se cair a rede no
// meio, o que ja funcionava continua intacto, e voltar atras e so reapontar o
// ponteiro.
// ---------------------------------------------------------------------------

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { spawnSync, spawn } = require('child_process');

const PACOTE = 'arc-1';
const NODE_MINIMO = [22, 19];   // engines.node do arc-1: >=22.19
const MANTER_VERSOES = 2;       // a ativa + 1 anterior, pra dar rollback

// A home fica fora do Electron de proposito: os engines sao carregados tambem
// pelos testes, que nao tem app.getPath. O main passa `arc1_home` quando quer
// mandar noutro lugar; sem isso, cai no mesmo caminho que o Electron usaria.
function home(settings) {
  const dado = String((settings && settings.arc1_home) || '').trim();
  if (dado) return dado;
  const base = process.env.APPDATA || path.join(os.homedir(), '.config');
  return path.join(base, 'sap-mcp-cockpit', 'engines', 'arc1');
}

// ---- Node da maquina -------------------------------------------------------
function comparaVersao(v, minimo) {
  const p = String(v || '').replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  if (p[0] !== minimo[0]) return p[0] - minimo[0];
  return (p[1] || 0) - minimo[1];
}

// Onde procurar o node. `node_path` nas Configuracoes vence; senao o do PATH.
function nodeInfo(settings) {
  const manual = String((settings && settings.node_path) || '').trim();
  const bin = manual || 'node';
  try {
    const r = spawnSync(bin, ['-p', 'process.execPath + "|" + process.versions.node'], {
      encoding: 'utf8', timeout: 15000, shell: false
    });
    if (r.error || r.status !== 0) return { ok: false, motivo: 'notFound', bin };
    const [execPath, versao] = String(r.stdout || '').trim().split('|');
    const suficiente = comparaVersao(versao, NODE_MINIMO) >= 0;
    return {
      ok: suficiente,
      motivo: suficiente ? null : 'tooOld',
      bin: execPath || bin,
      version: versao,
      minimo: NODE_MINIMO.join('.')
    };
  } catch (e) {
    return { ok: false, motivo: 'notFound', bin };
  }
}

// O npm (e o npx) vem junto com o node. Chamamos o <nome>.js pelo node em vez
// do `.cmd`: .cmd no Windows obriga shell:true, e com shell os argumentos viram
// uma string nao escapada -- um caminho com espaco ja quebraria o comando.
function cliJuntoDoNode(nodeBin, nome) {
  const dir = path.dirname(nodeBin);
  const candidatos = [
    path.join(dir, 'node_modules', 'npm', 'bin', nome),
    path.join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', nome)
  ];
  for (const c of candidatos) { try { if (fs.existsSync(c)) return c; } catch (e) {} }
  return null;
}

function npmCli(nodeBin) { return cliJuntoDoNode(nodeBin, 'npm-cli.js'); }

// Traduz um launch em algo que o `spawn` (shell:false) consegue executar.
//
// Existe por causa do fallback `npx`: no Windows ele e `npx.cmd`, e spawn sem
// shell devolve ENOENT. Ligar shell:true resolveria o ENOENT e criaria coisa
// pior -- os argumentos viram uma string nao escapada, e o `--cookie-file` com
// espaco no caminho quebraria calado. Entao fazemos com o npx o mesmo que ja
// fazemos com o npm: rodar o npx-cli.js pelo node.
//
// So o Cockpit precisa disto. O `~/.claude.json` continua gravando `npx` puro
// porque quem sobe aquilo e o host MCP, que resolve .cmd por conta propria.
function spawnavel(settings, command, args) {
  if (process.platform !== 'win32') return { command, args };
  const nome = path.basename(String(command || '')).toLowerCase().replace(/\.(cmd|exe|bat)$/, '');
  if (nome !== 'npx') return { command, args };
  const node = nodeInfo(settings);
  const cli = node.ok ? cliJuntoDoNode(node.bin, 'npx-cli.js') : null;
  if (!cli) return { command, args };  // sem npx-cli: deixa falhar com o erro real
  return { command: node.bin, args: [cli].concat(args) };
}

// ---- estado da instalacao --------------------------------------------------
function entrypointDe(dir) {
  return path.join(dir, 'node_modules', PACOTE, 'bin', 'arc1.js');
}

// Versoes com entrypoint de verdade no disco. Uma pasta que sobrou de um
// install interrompido nao conta como instalada.
function instaladas(settings) {
  const raiz = home(settings);
  let itens = [];
  try { itens = fs.readdirSync(raiz, { withFileTypes: true }); } catch (e) { return []; }
  return itens
    .filter(d => d.isDirectory() && /^\d+\.\d+\.\d+/.test(d.name))
    .map(d => d.name)
    .filter(v => { try { return fs.existsSync(entrypointDe(path.join(raiz, v))); } catch (e) { return false; } })
    .sort(ordenaVersaoDesc);
}

function ordenaVersaoDesc(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pb[i] || 0) !== (pa[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
  return 0;
}

function ativa(settings) {
  const raiz = home(settings);
  const disponiveis = instaladas(settings);
  if (!disponiveis.length) return null;
  try {
    const j = JSON.parse(fs.readFileSync(path.join(raiz, 'active.json'), 'utf8'));
    if (j && disponiveis.includes(j.version)) return j.version;
  } catch (e) { /* sem ponteiro: cai na mais nova */ }
  return disponiveis[0];
}

function ativar(settings, versao) {
  const raiz = home(settings);
  fs.mkdirSync(raiz, { recursive: true });
  fs.writeFileSync(path.join(raiz, 'active.json'), JSON.stringify({ version: versao }, null, 2), 'utf8');
}

// Como o ARC-1 deve ser executado agora. E a UNICA fonte da verdade disso:
// tanto o engine (pra montar o launch) quanto a UI (pra mostrar o status) leem
// daqui, senao a tela diria uma coisa e o server rodaria outra.
//
//   manual -> o usuario preencheu comando/args nas Configuracoes; vence sempre
//   local  -> instalacao gerenciada + node compativel; e o caminho rapido
//   npx    -> fallback: funciona em qualquer maquina, so que lento
function runtime(settings) {
  const manualCmd = String((settings && settings.arc1_cmd) || '').trim();
  if (manualCmd) {
    const bruto = String((settings && settings.arc1_args) || '').trim();
    const args = bruto ? (bruto.match(/"[^"]*"|\S+/g) || []).map(s => s.replace(/^"|"$/g, '')) : [];
    return { mode: 'manual', command: manualCmd, args };
  }
  const versao = ativa(settings);
  if (versao) {
    const node = nodeInfo(settings);
    if (node.ok) {
      return {
        mode: 'local', command: node.bin,
        args: [entrypointDe(path.join(home(settings), versao))],
        version: versao, nodeVersion: node.version
      };
    }
  }
  return { mode: 'npx', command: 'npx', args: ['-y', PACOTE + '@latest'] };
}

// ---- registry --------------------------------------------------------------
// Consultado SO sob acao explicita do usuario (botao "Verificar atualizacao").
// Nada aqui roda em background: uma chamada de rede silenciosa num app que
// guarda credencial de cliente e o tipo de surpresa que ninguem quer.
function ultimaVersao(timeoutMs) {
  return new Promise((resolve) => {
    const req = https.get('https://registry.npmjs.org/' + PACOTE + '/latest', {
      headers: { accept: 'application/vnd.npm.install-v1+json', 'user-agent': 'sap-mcp-cockpit' },
      timeout: timeoutMs || 15000
    }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return resolve({ ok: false, key: 'be.arc1RegistryFail', args: [String(res.statusCode)] }); }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', d => { body += d; if (body.length > 200000) req.destroy(); });
      res.on('end', () => {
        try { resolve({ ok: true, version: JSON.parse(body).version }); }
        catch (e) { resolve({ ok: false, key: 'be.arc1RegistryFail', args: ['JSON'] }); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, key: 'be.arc1RegistryFail', args: ['timeout'] }); });
    req.on('error', (e) => resolve({ ok: false, key: 'be.arc1RegistryFail', args: [e.message] }));
  });
}

// ---- instalacao ------------------------------------------------------------
function rmrf(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} }

// Instala `versao` (ou a mais recente) numa pasta propria e a torna ativa.
// Resolve { ok, version } ou { ok:false, key, args, log }.
function instalar(settings, versaoPedida, onLog) {
  return new Promise((resolve) => {
    const node = nodeInfo(settings);
    if (!node.ok) {
      return resolve({ ok: false, key: node.motivo === 'tooOld' ? 'be.arc1NodeOld' : 'be.arc1NoNode',
        args: [node.version || node.bin, NODE_MINIMO.join('.')] });
    }
    const cli = npmCli(node.bin);
    if (!cli) return resolve({ ok: false, key: 'be.arc1NoNpm', args: [path.dirname(node.bin)] });

    const raiz = home(settings);
    const alvoSpec = PACOTE + '@' + (versaoPedida || 'latest');
    const tmp = path.join(raiz, '.tmp-' + Date.now());
    try {
      fs.mkdirSync(tmp, { recursive: true });
      // package.json proprio: sem ele o npm sobe na arvore procurando um e pode
      // instalar na pasta errada.
      fs.writeFileSync(path.join(tmp, 'package.json'),
        JSON.stringify({ name: 'arc1-host', version: '0.0.0', private: true }, null, 2), 'utf8');
    } catch (e) {
      rmrf(tmp);
      return resolve({ ok: false, key: 'be.arc1InstallFail', args: [e.message] });
    }

    const args = [cli, 'install', alvoSpec, '--prefix', tmp,
      '--no-audit', '--no-fund', '--omit=dev', '--loglevel=error'];
    let log = '';
    let proc;
    try {
      proc = spawn(node.bin, args, { cwd: tmp, shell: false });
    } catch (e) {
      rmrf(tmp);
      return resolve({ ok: false, key: 'be.arc1InstallFail', args: [e.message] });
    }
    const junta = (d) => { const s = d.toString(); log += s; if (onLog) onLog(s); };
    proc.stdout.on('data', junta);
    proc.stderr.on('data', junta);
    proc.on('error', (e) => { rmrf(tmp); resolve({ ok: false, key: 'be.arc1InstallFail', args: [e.message], log }); });

    proc.on('exit', (code) => {
      if (code !== 0 || !fs.existsSync(entrypointDe(tmp))) {
        rmrf(tmp);
        return resolve({ ok: false, key: 'be.arc1InstallFail', args: ['npm exit ' + code], log });
      }
      // versao REAL instalada (pediram 'latest': so o package.json sabe qual veio)
      let versao;
      try {
        versao = JSON.parse(fs.readFileSync(
          path.join(tmp, 'node_modules', PACOTE, 'package.json'), 'utf8')).version;
      } catch (e) {
        rmrf(tmp);
        return resolve({ ok: false, key: 'be.arc1InstallFail', args: ['package.json ilegivel'], log });
      }

      const destino = path.join(raiz, versao);
      try {
        rmrf(destino);              // reinstalar a mesma versao tem que sobrescrever
        fs.renameSync(tmp, destino); // <- o unico ponto em que a versao passa a existir
      } catch (e) {
        rmrf(tmp);
        return resolve({ ok: false, key: 'be.arc1InstallFail', args: [e.message], log });
      }
      ativar(settings, versao);
      podar(settings, versao);
      resolve({ ok: true, key: 'be.arc1Installed', args: [versao], version: versao, log });
    });
  });
}

// Mantem a ativa + as MANTER_VERSOES-1 mais novas. As antigas sao 83 MB cada;
// guardar todas encheria o perfil do usuario sem nenhum ganho.
function podar(settings, manter) {
  const raiz = home(settings);
  const todas = instaladas(settings);
  const guardar = new Set([manter].concat(todas.slice(0, MANTER_VERSOES)));
  for (const v of todas) if (!guardar.has(v)) rmrf(path.join(raiz, v));
}

// Status completo, sem tocar na rede.
function status(settings) {
  const node = nodeInfo(settings);
  const rt = runtime(settings);
  return {
    home: home(settings),
    node: { ok: node.ok, motivo: node.motivo, version: node.version || null, minimo: NODE_MINIMO.join('.') },
    installed: instaladas(settings),
    active: ativa(settings),
    mode: rt.mode,
    command: rt.command,
    args: rt.args
  };
}

module.exports = {
  PACOTE, NODE_MINIMO,
  home, nodeInfo, instaladas, ativa, ativar, runtime, status, spawnavel,
  ultimaVersao, instalar, entrypointDe
};
