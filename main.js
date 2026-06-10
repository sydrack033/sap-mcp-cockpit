'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

// ---------------------------------------------------------------------------
// Persistencia dos dados do app (settings + clientes) no perfil do usuario.
// Fica em %APPDATA%/sap-mcp-cockpit/ no Windows.
// ---------------------------------------------------------------------------
const DATA_DIR      = app.getPath('userData');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const CLIENTS_FILE  = path.join(DATA_DIR, 'clients.json');

// Migracao do nome antigo (Steampunk Manager -> SAP MCP Cockpit): copia os dados
// de %APPDATA%/steampunk-manager se ainda nao existirem no diretorio novo.
try {
  const oldDir = path.join(app.getPath('appData'), 'steampunk-manager');
  if (oldDir !== DATA_DIR) {
    for (const f of ['settings.json', 'clients.json']) {
      const src = path.join(oldDir, f);
      const dst = path.join(DATA_DIR, f);
      if (fs.existsSync(src) && !fs.existsSync(dst)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.copyFileSync(src, dst);
      }
    }
  }
} catch (e) {
  console.error('Migracao de dados (steampunk-manager -> sap-mcp-cockpit) falhou:', e);
}

const DEFAULT_SETTINGS = {
  vsp_path: 'C:/Users/' + (process.env.USERNAME || 'user') + '/Projects/tools/vsp.exe',
  project_path: '', // vazio de proposito: o usuario escolhe a pasta (placeholder mostra o exemplo)
  chrome_path: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  vscode_cmd: 'code',
  lang: 'en' // idioma da UI: 'en' (padrao) ou 'pt'
};

function readJson(file, fallback) {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch (e) {
    console.error('readJson failed for', file, e);
  }
  return fallback;
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// Helpers de slug / nomes derivados
// ---------------------------------------------------------------------------
function slug(text) {
  return String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // tira acentos
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function envIdOf(envObj) {
  return slug(envObj.client_name) + '-' + slug(envObj.env_name);
}

// Nomes de variavel de senha que o vsp pode esperar. Este build usa o nome do system
// CRU em maiusculas (com hifen): VSP_MINERVA-DEV_PASSWORD. Geramos tambem a variante com
// underscore por seguranca. Ambas apontam pra mesma senha.
function passwordVarsOf(id) {
  const upper = id.toUpperCase();
  return [...new Set([
    'VSP_' + upper + '_PASSWORD',                    // forma crua (com hifen) - este build
    'VSP_' + upper.replace(/-/g, '_') + '_PASSWORD'  // forma com underscore (fallback)
  ])];
}

// Caminho do arquivo de cookie de um ambiente Cloud na pasta do projeto.
function cookieFileFor(projectPath, env) {
  return path.join(projectPath, `cookies-${envIdOf(env)}.txt`);
}

// Cookie "valido" = arquivo existe e nao esta vazio.
function cookieExists(projectPath, env) {
  try {
    const f = cookieFileFor(projectPath, env);
    return fs.existsSync(f) && fs.statSync(f).size > 0;
  } catch (e) {
    return false;
  }
}

// Entrada do sistema no .vsp.json (compartilhada por generateConfigs e pelo teste).
function buildSystemEntry(projectPath, e) {
  const sys = { url: e.url, client: e.sap_client || '100' };
  if (e.language) sys.language = e.language;
  if (e.auth_type === 'cloud') {
    sys.cookie_file = cookieFileFor(projectPath, e).replace(/\\/g, '/');
  } else { // onprem
    if (e.user) sys.user = e.user;
    if (e.insecure) sys.insecure = true;
  }
  return sys;
}

// Args do server MCP do vsp (Claude .mcp.json e Codex ~/.codex/config.toml).
// IMPORTANTE: no modo MCP (comando raiz) este build do vsp NAO aplica `-s <profile>`
// pra pegar URL/credencial do .vsp.json — ele exige a conexao EXPLICITA (senao morre
// com "SAP URL is required" antes do handshake). Por isso passamos tudo explicito aqui,
// deixando o server self-contained (independe de cwd / .vsp.json).
function buildMcpArgs(settings, e) {
  const args = ['--url', e.url, '--client', e.sap_client || '100'];
  if (e.language) args.push('--language', e.language);
  if (e.auth_type === 'cloud') {
    args.push('--cookie-file', cookieFileFor(settings.project_path, e).replace(/\\/g, '/'));
  } else { // onprem
    if (e.user)     args.push('--user', e.user);
    if (e.password) args.push('--password', e.password);
    if (e.insecure) args.push('--insecure');
  }
  args.push('--mode', e.mode || 'focused');
  if (e.read_only)                 args.push('--read-only');
  if (e.allow_transportable_edits) args.push('--allow-transportable-edits');
  if (e.enable_transports)         args.push('--enable-transports');
  return args;
}

// Escapa string para valor TOML basico
function tomlStr(s) {
  return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

// Conteudo de instrucoes do projeto (usado em CLAUDE.md e AGENTS.md).
// Objetivo: dar ao LLM, numa leitura so, tudo que ele precisa pra operar o workspace
// sem gastar tokens vasculhando a pasta ou tentando operacoes que falham.
function buildInstructionsMd(envs) {
  const L = [];
  L.push('# Workspace SAP MCP Cockpit — ambientes SAP via vsp (MCP)');
  L.push('');
  L.push('Este workspace **nao tem codigo de aplicacao**. Ele so configura acesso a sistemas');
  L.push('SAP pelo `vsp` (vibing-steampunk) como servidores **MCP**. **Nao vasculhe a pasta**');
  L.push('procurando codigo nem rode `glob`/`ls` recursivo: tudo que importa esta aqui.');
  L.push('');
  L.push('## Como funciona');
  L.push('- Cada ambiente abaixo e um servidor MCP de nome `<profile>`; as ferramentas dele');
  L.push('  aparecem com o prefixo `mcp__<profile>__*`.');
  L.push('- Config gerada pelo SAP MCP Cockpit (nao edite a mao): `.vsp.json` (URLs + cookie/');
  L.push('  usuario + insecure), `.mcp.json` (Claude Code), `~/.codex/config.toml` (Codex, global), `.env`.');
  L.push('  A senha on-prem ja vai no bloco `env` do server MCP — nao precisa carregar `.env` na mao.');
  L.push('- Cookies de SSO dos ambientes Cloud ficam em `cookies-<profile>.txt`.');
  L.push('- **Codex:** os servers MCP vao no seu `~/.codex/config.toml` GLOBAL (o Cockpit mantem um');
  L.push('  bloco gerenciado la). Eles so carregam ao INICIAR o Codex — se as tools `mcp__<profile>__*`');
  L.push('  nao aparecerem, REINICIE o Codex (sessao nova); elas nao surgem no meio de uma sessao.');
  L.push('');
  L.push('## Ambientes');
  L.push('| Profile (MCP) | Cliente | Ambiente | Tipo | Client SAP | URL | Obs |');
  L.push('|---|---|---|---|---|---|---|');
  for (const e of envs) {
    const obs = [];
    if (e.read_only) obs.push('read-only');
    if (e.mode && e.mode !== 'focused') obs.push(e.mode);
    L.push(`| ${envIdOf(e)} | ${e.client_name} | ${e.env_name} | ${e.auth_type} | ${e.sap_client || '?'} | ${e.url} | ${obs.join(', ') || '-'} |`);
  }
  L.push('');
  L.push('## Testar conexao (rapido, sem gastar token a toa)');
  L.push('Para provar que um ambiente conecta e autentica, faca **uma busca ADT leve** pelo');
  L.push('profile (operacao de *search* do MCP, com poucos resultados). Se voltar objetos, a');
  L.push('conexao + autenticacao estao OK.');
  L.push('- ⚠️ **Nao** use *system info* como teste de conexao: ela depende de Data Preview /');
  L.push('  `S_DEVELOP` e costuma falhar por falta de autorizacao — isso **nao** significa');
  L.push('  conexao quebrada.');
  L.push('- Cloud com erro de autenticacao = cookie SSO expirou; refaca o **Login SSO** no');
  L.push('  SAP MCP Cockpit.');
  L.push('');
  L.push('## Erros comuns (decodificador) — nao gaste tempo redescobrindo');
  L.push('- `tls: certificate has expired or is not yet valid` → cert self-signed/expirado (on-prem).');
  L.push('  Marque **--insecure** no ambiente pelo Cockpit e **Gerar configs** de novo (vira `insecure:true`');
  L.push('  no `.vsp.json`). Nao saia passando `--insecure` na mao no subcomando — ele e root-only.');
  L.push('- `403 ... Service cannot be reached` no endpoint ADT → os servicos **ADT nao estao ativos');
  L.push('  na SICF** desse client (tarefa de Basis no SAP), nao e problema de conexao/credencial.');
  L.push('- Pediu `VSP_<ID>_PASSWORD` / cookie → falta a senha/cookie. Via MCP isso ja vem no `env`');
  L.push('  do server; refaca **Gerar configs** no Cockpit se faltar.');
  L.push('- Para **editar objeto transportavel** (status "transport protection"): o ambiente precisa');
  L.push('  de **Permitir edits transportaveis** + **Habilitar transports** marcados no Cockpit. Via');
  L.push('  CLI o subcomando `source write` ignora esses opt-ins; use a tool MCP `EditSource` (replace');
  L.push('  cirurgico + syntax check + activate), passando `transport` = sua request.');
  L.push('');
  L.push('## Criar/editar objeto ABAP — SIGA EXATAMENTE (nao improvise)');
  L.push('Os helpers de alto nivel (`EditSource`/`WriteSource`/`CreateAndActivateProgram`) tem um BUG');
  L.push('neste build do vsp: ao gravar fonte em objeto **recem-criado** retornam `status 423 -');
  L.push('lock handle invalid`. NAO fique retentando esses helpers nem caia pro shell/CLI. O caminho');
  L.push('abaixo FUNCIONA — exige **mode = expert** (no `focused` faltam `LockObject`/`UpdateSource`;');
  L.push('se nao aparecerem, troque o ambiente pra expert no Cockpit e REINICIE o Codex).');
  L.push('');
  L.push('**Criar objeto novo (ex.: PROG transportavel):**');
  L.push('1. Cria o skeleton: `WriteSource` mode=create (ou `CreateAndActivateProgram`). Ele vai');
  L.push('   retornar o erro de lock no update inicial — **ignore**, o objeto FICA criado (confirme');
  L.push('   com `SearchObject`).');
  L.push('2. `LockObject` em `/sap/bc/adt/programs/programs/<NOME>` (access_mode MODIFY) → guarde o');
  L.push('   `lockHandle` (ele ja amarra na sua request).');
  L.push('3. `UpdateSource` com `object_url` (sem `/source/main`), `lock_handle`, `transport` e o fonte');
  L.push('   COMPLETO de uma vez.');
  L.push('4. `Activate` → depois `UnlockObject` com o mesmo `lock_handle`.');
  L.push('');
  L.push('**Editar objeto que JA EXISTE e esta ativo:** `EditSource` (replace cirurgico) funciona —');
  L.push('URL `.../source/main`, `old_string` anchor UNICO, `replace_all`=false, `syntax_check`=true,');
  L.push('`transport` = request. Se der lock invalid, caia pro fluxo LockObject->UpdateSource acima.');
  L.push('');
  L.push('**⚠️ Se MESMO com lock_handle valido (LockObject OK) o `UpdateSource`/`DeleteObject` der');
  L.push('`423 ... is not locked`:** PARE. Nao e o seu fluxo — e o **bug de sessao stateful do vsp em');
  L.push('SAP ECC/NetWeaver antigo** (lock e o PUT do source caem em sessoes HTTP diferentes; o');
  L.push('backend rejeita o handle valido). Sintoma do sistema: `GetConnectionInfo` sem rap/hana/');
  L.push('abapgit. NAO fique tentando MCP/CLI/HTTP bruto em loop — nenhum vai funcionar. Reporte ao');
  L.push('usuario: atualizar o vsp (issue vibing-steampunk #91) OU subir o fonte por Eclipse ADT/');
  L.push('SE38/SAP GUI (o objeto ja esta criado com skeleton; o fonte local esta pronto).');
  L.push('');
  L.push('**Regras gerais:**');
  L.push('- Objeto travado de uma tentativa anterior → `UnlockObject` (ou re-`LockObject`) ANTES de');
  L.push('  retentar; um lock_handle so vale uma vez.');
  L.push('- Operacao demorou (report grande leva minutos)? Nao mate nem retente as cegas — **releia o');
  L.push('  source primeiro**, a anterior pode ter comitado.');
  L.push('- `DeleteObject` tambem usa lock: `LockObject` -> `DeleteObject(lock_handle)`; se der lock');
  L.push('  invalid, e o mesmo bug — confirme o estado com `SearchObject` antes de insistir.');
  L.push('');
  L.push('## vsp pela CLI (so se o MCP estiver indisponivel)');
  L.push('- O binario nao esta no PATH; use o caminho configurado no Cockpit.');
  L.push('- Flags de conexao (`--url`, `--insecure`, `--cookie-file`, `--client`, ...) sao **so do');
  L.push('  comando raiz**. Use o profile: `vsp -s <profile> <subcomando>` (le `.vsp.json`).');
  L.push('- A CLI **nao** le `.env` sozinha. Carregue a senha antes (PowerShell), usando o nome');
  L.push('  exato da variavel (hifens do profile viram `_`):');
  L.push('  `$env:VSP_<ID>_PASSWORD = (Get-Content .env | Select-String "^VSP_<ID>_PASSWORD=").ToString().Split("=",2)[1]`');
  L.push('');
  return L.join('\n');
}

// ---------------------------------------------------------------------------
// Codex: o build atual le MCP SO do config global ~/.codex/config.toml (NAO do
// .codex/config.toml por projeto). Mesclamos um BLOCO GERENCIADO delimitado por
// marcadores, preservando o resto da config do usuario.
// ---------------------------------------------------------------------------
const CODEX_MARK_NAME = 'sap-mcp-cockpit';
const CODEX_MARK_START = `# >>> ${CODEX_MARK_NAME} (gerado automaticamente - nao editar a mao) >>>`;
const CODEX_MARK_END   = `# <<< ${CODEX_MARK_NAME} <<<`;
// Nomes de marcador a remover na mescla (inclui o antigo, pra migrar sem duplicar).
const CODEX_MARK_NAMES = [CODEX_MARK_NAME, 'steampunk-manager'];

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Remove qualquer bloco gerenciado nosso (marcador atual ou antigo) preservando o resto.
function stripManagedCodexBlocks(text) {
  let out = text;
  for (const n of CODEX_MARK_NAMES) {
    const re = new RegExp('\\n*# >>> ' + escapeRegExp(n) + ' [\\s\\S]*?# <<< ' + escapeRegExp(n) + ' <<<\\n*', 'g');
    out = out.replace(re, '\n');
  }
  return out.replace(/\s+$/, '');
}

function buildCodexBlock(settings, envs) {
  const lines = [CODEX_MARK_START];
  for (const e of envs) {
    const id = envIdOf(e);
    const argsToml = buildMcpArgs(settings, e).map(tomlStr).join(', ');
    lines.push(`[mcp_servers.${id}]`);
    lines.push(`command = ${tomlStr(settings.vsp_path)}`);
    lines.push(`args = [${argsToml}]`);
    if (e.auth_type === 'onprem' && e.password) {
      const envPairs = passwordVarsOf(id).map(v => `"${v}" = ${tomlStr(e.password)}`).join(', ');
      lines.push(`env = { ${envPairs} }`);
    }
    // Timeouts generosos: o default do Codex (startup 10s) corta o vsp antes de
    // ele subir conectando no SAP on-prem; e o tool default (60s) mata create/activate
    // de objeto grande, que leva minutos.
    lines.push('startup_timeout_sec = 60');
    lines.push('tool_timeout_sec = 300');
    lines.push('');
  }
  lines.push(CODEX_MARK_END);
  return lines.join('\n');
}

// Mescla o bloco gerenciado no ~/.codex/config.toml, preservando o resto da config.
// So mexe se o Codex ja existe na maquina (pasta ~/.codex presente) — assim nao criamos
// arquivo no home de quem so usa Claude Code. Retorna '' quando pula.
function mergeCodexGlobalConfig(settings, envs) {
  const dir = path.join(os.homedir(), '.codex');
  if (!fs.existsSync(dir)) return '';
  const file = path.join(dir, 'config.toml');
  let existing = '';
  try { if (fs.existsSync(file)) existing = fs.readFileSync(file, 'utf8'); } catch (e) {}
  // remove blocos gerenciados anteriores (marcador atual + antigo) e limpa espacos finais
  const base = stripManagedCodexBlocks(existing);
  const block = buildCodexBlock(settings, envs);
  const out = (base ? base + '\n\n' : '') + block + '\n';
  fs.writeFileSync(file, out, 'utf8');
  return file;
}

// ---------------------------------------------------------------------------
// Geracao dos arquivos de configuracao na pasta do projeto
// ---------------------------------------------------------------------------
function generateConfigs(settings, clients) {
  const projectPath = settings.project_path;
  if (!projectPath) {
    return { ok: false, key: 'be.noProjectDefined' };
  }
  fs.mkdirSync(projectPath, { recursive: true });

  const envs = (clients.environments || []);

  // ---- .vsp.json (fonte da verdade dos sistemas) ----
  const systems = {};
  for (const e of envs) {
    systems[envIdOf(e)] = buildSystemEntry(projectPath, e);
  }
  const vspJson = { systems };
  if (envs.length) vspJson.default = envIdOf(envs[0]);
  writeJson(path.join(projectPath, '.vsp.json'), vspJson);

  // ---- .mcp.json (Claude Code - um server por ambiente, usando -s <profile>) ----
  // A senha on-prem vai no bloco `env` do server: o host MCP (Claude/Codex) NAO
  // carrega o .env, entao sem isso o server sobe sem senha e a auth falha (zero tools).
  const mcpServers = {};
  for (const e of envs) {
    const id = envIdOf(e);
    const server = { command: settings.vsp_path, args: buildMcpArgs(settings, e) };
    if (e.auth_type === 'onprem' && e.password) {
      server.env = {};
      for (const v of passwordVarsOf(id)) server.env[v] = e.password;
    }
    mcpServers[id] = server;
  }
  writeJson(path.join(projectPath, '.mcp.json'), { mcpServers });

  // ---- Codex MCP: mesclar no ~/.codex/config.toml GLOBAL ----
  // O build atual do Codex carrega MCP SO do config global (nao do .codex/config.toml
  // por projeto). Mesclamos um bloco gerenciado, preservando o resto da config.
  let codexGlobalFile = '';
  try {
    codexGlobalFile = mergeCodexGlobalConfig(settings, envs);
  } catch (e) {
    console.error('Falha ao mesclar Codex global config:', e);
  }

  // ---- CLAUDE.md (Claude Code) + AGENTS.md (Codex) - mesmo conteudo ----
  const instructions = buildInstructionsMd(envs);
  fs.writeFileSync(path.join(projectPath, 'CLAUDE.md'), instructions, 'utf8');
  fs.writeFileSync(path.join(projectPath, 'AGENTS.md'), instructions, 'utf8');

  // ---- .env (senhas on-premise) ----
  const envLines = [
    '# Senhas dos ambientes On-Premise (basic auth).',
    '# Gerado pelo SAP MCP Cockpit. NAO versionar (esta no .gitignore).',
    '# Padrao lido pelo vsp: VSP_<SYSTEM>_PASSWORD',
    ''
  ];
  for (const e of envs) {
    if (e.auth_type === 'onprem' && e.password) {
      for (const v of passwordVarsOf(envIdOf(e))) envLines.push(`${v}=${e.password}`);
    }
  }
  fs.writeFileSync(path.join(projectPath, '.env'), envLines.join('\n') + '\n', 'utf8');

  // ---- .gitignore ----
  const gitignore = [
    '# SAP MCP Cockpit - arquivos sensiveis / locais',
    '.env',
    '.vsp.json',
    '.mcp.json',
    '.codex/',
    'codex.toml',
    'cookies*.txt',
    ''
  ].join('\n');
  fs.writeFileSync(path.join(projectPath, '.gitignore'), gitignore, 'utf8');

  return {
    ok: true,
    key: 'be.configsGenerated',
    args: [projectPath, envs.length],
    files: ['.vsp.json', '.mcp.json', '~/.codex/config.toml', '.env', '.gitignore', 'CLAUDE.md', 'AGENTS.md'],
    count: envs.length,
    codexGlobal: codexGlobalFile
  };
}

// ---------------------------------------------------------------------------
// Janela
// ---------------------------------------------------------------------------
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 820,
    minHeight: 600,
    title: 'SAP MCP Cockpit',
    backgroundColor: '#1c1712',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------
ipcMain.handle('settings:load', () => {
  return Object.assign({}, DEFAULT_SETTINGS, readJson(SETTINGS_FILE, {}));
});

ipcMain.handle('settings:save', (_evt, settings) => {
  writeJson(SETTINGS_FILE, settings);
  return { ok: true };
});

ipcMain.handle('clients:load', () => {
  return readJson(CLIENTS_FILE, { environments: [] });
});

ipcMain.handle('clients:save', (_evt, clients) => {
  writeJson(CLIENTS_FILE, clients);
  return { ok: true };
});

ipcMain.handle('dialog:pickFile', async (_evt, opts) => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: (opts && opts.title) || 'Selecionar arquivo',
    properties: ['openFile'],
    filters: (opts && opts.filters) || []
  });
  if (res.canceled || !res.filePaths.length) return null;
  return res.filePaths[0].replace(/\\/g, '/');
});

ipcMain.handle('dialog:pickFolder', async (_evt, opts) => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: (opts && opts.title) || 'Selecionar pasta',
    properties: ['openDirectory', 'createDirectory']
  });
  if (res.canceled || !res.filePaths.length) return null;
  return res.filePaths[0].replace(/\\/g, '/');
});

ipcMain.handle('configs:generate', (_evt, payload) => {
  try {
    return generateConfigs(payload.settings, payload.clients);
  } catch (e) {
    return { ok: false, key: 'be.genError', args: [e.message] };
  }
});

// Login SSO (cloud) - dispara vsp --browser-auth e salva o cookie do ambiente.
// O vsp browser-auth nem sempre encerra sozinho (fica vivo apos a captura), entao
// detectamos o SUCESSO pelo arquivo de cookie sendo salvo (estavel) e ai encerramos
// o processo - em vez de esperar o 'exit', que pode nunca disparar.
ipcMain.handle('vsp:login', (_evt, payload) => {
  return new Promise((resolve) => {
    const { settings, env } = payload;
    const projectPath = settings.project_path;

    if (!fs.existsSync(settings.vsp_path)) {
      resolve({ ok: false, key: 'be.vspNotFound', args: [settings.vsp_path] });
      return;
    }
    fs.mkdirSync(projectPath, { recursive: true });

    const cookieFile = cookieFileFor(projectPath, env);
    const startTime = Date.now();
    const args = [
      '--url', env.url,
      '--browser-auth',
      '--cookie-save', cookieFile
    ];
    if (settings.chrome_path && fs.existsSync(settings.chrome_path)) {
      args.push('--browser-exec', settings.chrome_path);
    }

    let out = '';
    let proc;
    try {
      proc = spawn(settings.vsp_path, args, { cwd: projectPath });
    } catch (e) {
      resolve({ ok: false, key: 'be.vspStartFail', args: [e.message] });
      return;
    }

    proc.stdout.on('data', d => { out += d.toString(); });
    proc.stderr.on('data', d => { out += d.toString(); });

    let done = false;
    let poll = null;
    let killTimer = null;
    const finish = (res) => {
      if (done) return;
      done = true;
      if (poll) clearInterval(poll);
      if (killTimer) clearTimeout(killTimer);
      resolve(res);
    };
    const ok = (extra) => finish({
      ok: true,
      key: 'be.loginOk',
      args: [path.basename(cookieFile)],
      log: out, ...extra
    });

    proc.on('error', e => finish({ ok: false, key: 'be.error', args: [e.message], log: out }));

    // Se o vsp encerrar sozinho, decide pelo cookie.
    proc.on('exit', code => {
      const cookieOk = fs.existsSync(cookieFile) && fs.statSync(cookieFile).mtimeMs >= startTime - 2000;
      if (cookieOk) ok();
      else finish({ ok: false, key: 'be.loginFail', args: [code], log: out });
    });

    // Detecta o cookie sendo salvo: exige que o arquivo exista, nao vazio, gravado
    // depois do inicio do login e ESTAVEL (mesmo mtime em 2 leituras ~ 1,6s) pra
    // nao declarar sucesso no meio de uma escrita.
    let lastMtime = 0, stable = 0;
    poll = setInterval(() => {
      try {
        if (!fs.existsSync(cookieFile)) return;
        const st = fs.statSync(cookieFile);
        if (st.size <= 0 || st.mtimeMs < startTime - 2000) return;
        if (st.mtimeMs === lastMtime) stable++;
        else { lastMtime = st.mtimeMs; stable = 0; }
        if (stable >= 2) {
          // cookie capturado e estavel: encerra o vsp pendurado e reporta sucesso.
          try { proc.kill(); } catch (e) {}
          ok();
        }
      } catch (e) { /* arquivo em escrita; tenta de novo */ }
    }, 800);

    // Timeout de seguranca: 5 min sem cookie -> aborta e mata o processo.
    killTimer = setTimeout(() => {
      try { proc.kill(); } catch (e) {}
      finish({ ok: false, key: 'be.loginTimeout', log: out });
    }, 300000);
  });
});

// Status dos cookies: quais ambientes Cloud ja tem cookie salvo na pasta do projeto.
// Usado ao abrir o app pra deixar verde quem ja esta logado.
ipcMain.handle('cookies:status', (_evt, payload) => {
  const { settings, envs } = payload || {};
  const result = {};
  const projectPath = settings && settings.project_path;
  if (!projectPath) return result;
  for (const e of (envs || [])) {
    if (e.auth_type !== 'cloud') continue;
    result[envIdOf(e)] = cookieExists(projectPath, e);
  }
  return result;
});

// Teste de conexao ("ping") de um ambiente - Cloud ou On-Premise.
// Faz uma busca ADT leve (search) pelo profile, que valida TLS + auth + ADT.
ipcMain.handle('vsp:test', (_evt, payload) => {
  return new Promise((resolve) => {
    const { settings, env } = payload;
    const projectPath = settings.project_path;
    const id = envIdOf(env);

    if (!fs.existsSync(settings.vsp_path)) {
      resolve({ ok: false, key: 'be.vspNotFound', args: [settings.vsp_path] });
      return;
    }
    if (!projectPath) { resolve({ ok: false, key: 'be.noProjectDefined' }); return; }
    fs.mkdirSync(projectPath, { recursive: true });

    // Pre-checagens de credencial pra dar mensagem clara.
    if (env.auth_type === 'cloud' && !cookieExists(projectPath, env)) {
      resolve({ ok: false, key: 'be.testNoCookie', args: [id] });
      return;
    }
    if (env.auth_type === 'onprem' && !env.password) {
      resolve({ ok: false, key: 'be.testNoPassword', args: [id] });
      return;
    }

    // Garante que o .vsp.json tem este sistema (o subcomando `-s` le dele).
    const vspFile = path.join(projectPath, '.vsp.json');
    let vspJson = readJson(vspFile, { systems: {} });
    if (!vspJson.systems) vspJson.systems = {};
    vspJson.systems[id] = buildSystemEntry(projectPath, env);
    if (!vspJson.default) vspJson.default = id;
    writeJson(vspFile, vspJson);

    // On-prem precisa da senha no ambiente do processo.
    const childEnv = Object.assign({}, process.env);
    if (env.auth_type === 'onprem' && env.password) {
      for (const v of passwordVarsOf(id)) childEnv[v] = env.password;
    }

    const args = ['-s', id, 'search', 'CLAS', '--max', '1'];
    let out = '';
    let proc;
    try {
      proc = spawn(settings.vsp_path, args, { cwd: projectPath, env: childEnv });
    } catch (e) {
      resolve({ ok: false, key: 'be.vspStartFail', args: [e.message] });
      return;
    }

    let done = false;
    const finish = (res) => { if (done) return; done = true; resolve(res); };

    proc.stdout.on('data', d => { out += d.toString(); });
    proc.stderr.on('data', d => { out += d.toString(); });
    proc.on('error', e => finish({ ok: false, key: 'be.error', args: [e.message], log: out }));
    proc.on('exit', code => {
      const low = out.toLowerCase();
      if (/certificate|x509|tls:/.test(low)) {
        finish({ ok: false, key: 'be.testTls', args: [id], log: out });
      } else if (/\b403\b|forbidden|service cannot be reached/.test(low)) {
        finish({ ok: false, key: 'be.testForbidden', args: [id], log: out });
      } else if (/\b401\b|unauthorized|password|credential|logon failed|cookie/.test(low)) {
        finish({ ok: false, key: 'be.testAuth', args: [id], log: out });
      } else if (code === 0) {
        finish({ ok: true, key: 'be.testOk', args: [id], log: out });
      } else {
        finish({ ok: false, key: 'be.testFail', args: [id], log: out });
      }
    });

    // Timeout de seguranca (45s).
    setTimeout(() => {
      try { proc.kill(); } catch (e) {}
      finish({ ok: false, key: 'be.testFail', args: [id], log: out });
    }, 45000);
  });
});

// Abrir a pasta do projeto no VSCode
ipcMain.handle('vscode:open', (_evt, settings) => {
  return new Promise((resolve) => {
    const projectPath = settings.project_path;
    if (!projectPath || !fs.existsSync(projectPath)) {
      resolve({ ok: false, key: 'be.vscodeNoFolder' });
      return;
    }
    const cmd = settings.vscode_cmd || 'code';
    // shell:true porque "code" no Windows e um .cmd
    const proc = spawn(cmd, [projectPath], { cwd: projectPath, shell: true, detached: true, stdio: 'ignore' });
    proc.on('error', e => resolve({ ok: false, key: 'be.vscodeFail', args: [e.message] }));
    // nao espera fechar
    proc.unref();
    setTimeout(() => resolve({ ok: true, key: 'be.vscodeOpened', args: [projectPath] }), 400);
  });
});

// Abrir a pasta do projeto no Explorer
ipcMain.handle('folder:open', (_evt, settings) => {
  if (settings.project_path && fs.existsSync(settings.project_path)) {
    shell.openPath(settings.project_path);
    return { ok: true };
  }
  return { ok: false, key: 'be.folderMissing' };
});
