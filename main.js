'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, spawnSync } = require('child_process');
const { fileURLToPath } = require('url');
const net = require('net');

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
  chrome_path: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  vscode_cmd: 'code',
  // Conexoes RFC (via SAProuter). Os dois vazios = automatico:
  //   python_path vazio -> usa o runtime que vem junto no app (resolvePython)
  //   nwrfc_lib   vazio -> a sapnwrfc.dll ja esta na System32 (caso do SAP GUI)
  python_path: '',
  nwrfc_lib: '',
  // Claude Code nao tem comando aqui: e o app desktop, aberto por claude://
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
// Estado do cookie de um ambiente Cloud.
//
// O vsp grava no formato Netscape cookie jar (o mesmo do curl), com uma coluna
// de expiracao em epoch:
//   dominio  flag  path  secure  EXPIRACAO  nome  valor
// Nos tenants S4HC a janela e de 24h a partir do login. Expiracao 0 significa
// cookie de sessao (sem prazo) — nesse caso nao da pra dizer que venceu.
//
// Sem isso o app so olhava "arquivo existe e nao esta vazio", e marcava como
// logado um cookie de dias atras que ja nao autentica nada.
function cookieStatusOf(projectPath, env) {
  const vazio = { state: 'none', expiresAt: null };
  try {
    const f = cookieFileFor(projectPath, env);
    if (!fs.existsSync(f) || fs.statSync(f).size <= 0) return vazio;

    const prazos = fs.readFileSync(f, 'utf8')
      .split(/\r?\n/)
      .filter(l => l && !l.startsWith('#'))
      .map(l => l.split('\t'))
      .filter(c => c.length >= 7)
      .map(c => Number(c[4]) || 0)
      .filter(x => x > 0);

    if (!prazos.length) return { state: 'valid', expiresAt: null }; // so cookie de sessao
    // vale ate o PRIMEIRO vencer: dai em diante a autenticacao ja pode falhar
    const expiresAt = Math.min(...prazos);
    return { state: expiresAt * 1000 > Date.now() ? 'valid' : 'expired', expiresAt };
  } catch (e) {
    return vazio;
  }
}

// Mantido pros pontos que so querem saber se da pra tentar conectar.
function cookieExists(projectPath, env) {
  return cookieStatusOf(projectPath, env).state === 'valid';
}

// A pasta de uma conexao. O renderer manda ela junto no payload (campo
// transiente `folder`), porque quem conhece o mapa cliente->pasta e ele.
function folderOfEnv(e, fallback) {
  return (e && e.folder) || fallback || '';
}

// ---------------------------------------------------------------------------
// Conexoes RFC: o ADT-over-RFC bridge (sistemas atras de SAProuter)
//
// Um SAProuter que so libera rota NI (gateway 33xx) e nega rota crua pro ICM
// deixa o vsp -- que so fala HTTP -- sem caminho nenhum, embora o Eclipse ADT
// conecte normalmente. O Eclipse conecta porque nao usa HTTP: ele serializa cada
// request ADT e manda por RFC pra FM padrao SADT_REST_RFC_ENDPOINT.
//
// O bridge (Python + pyrfc) reproduz isso: escuta HTTP em 127.0.0.1:<porta>,
// empacota cada request na FM e devolve a resposta. Pro vsp e um ICM comum.
//
//   vsp --HTTP--> bridge --RFC(+saprouter)--> SADT_REST_RFC_ENDPOINT --> ADT
//
// LIMITE que vale repetir (esta no CLAUDE.md gerado tambem): a FM e STATELESS
// por chamada, entao ATIVAR objeto nao funciona pelo bridge -- lock e activate
// caem em sessoes diferentes. Serve pra ler/buscar/analisar.
//
// Os scripts moram no app (pasta bridge/) mas sao COPIADOS pro userData: o
// Python e um processo externo e nao consegue executar arquivo de dentro do
// app.asar. O fs do Node le do asar sem problema, entao a copia funciona.
// ---------------------------------------------------------------------------
const BRIDGE_SRC_DIR   = path.join(__dirname, 'bridge');
const BRIDGE_DIR       = path.join(DATA_DIR, 'bridge');
const BRIDGE_SCRIPT    = path.join(BRIDGE_DIR, 'adt_rfc_bridge.py');
const BRIDGE_LAUNCHER  = path.join(BRIDGE_DIR, 'bridge_launch.py');
const BRIDGE_FILES     = ['adt_rfc_bridge.py', 'bridge_launch.py', 'NOTICE.md'];
const BRIDGE_PORT_BASE = 8410;

// Copia/atualiza os scripts do bridge no userData. Regravar so quando o
// conteudo muda evita mexer no arquivo a cada boot (e deixa o usuario editar
// pra debugar sem o app desfazer na hora seguinte).
function ensureBridgeFiles() {
  try {
    fs.mkdirSync(BRIDGE_DIR, { recursive: true });
    for (const f of BRIDGE_FILES) {
      const src = path.join(BRIDGE_SRC_DIR, f);
      if (!fs.existsSync(src)) continue;
      const novo = fs.readFileSync(src);
      const dst = path.join(BRIDGE_DIR, f);
      let atual = null;
      try { atual = fs.readFileSync(dst); } catch (e) { /* ainda nao existe */ }
      if (!atual || !atual.equals(novo)) fs.writeFileSync(dst, novo);
    }
    return true;
  } catch (e) {
    console.error('Nao consegui preparar os scripts do bridge:', e);
    return false;
  }
}

// O Python que roda o bridge.
//
// O app JA VEM com um Python 3.12 embutivel + pyrfc (vendor/bridge-runtime no
// dev, resources/bridge-runtime no empacotado): sao ~20 MB e evitam pedir ao
// usuario que instale Python e rode pip. Duas coisas que valem saber:
//   - 3.12 e o TETO: o pyrfc nao publica wheel win_amd64 para 3.13/3.14.
//   - o SAP NW RFC SDK NAO vem junto (nao e redistribuivel). Ele ja costuma
//     estar na System32 de quem tem SAP GUI; se nao, o usuario aponta a pasta.
// Quem preferir o proprio Python e so preencher o caminho nas Configuracoes.
function bundledPython() {
  const base = app.isPackaged
    ? path.join(process.resourcesPath, 'bridge-runtime')
    : path.join(__dirname, 'vendor', 'bridge-runtime');
  const exe = path.join(base, 'python.exe');
  try { if (fs.existsSync(exe)) return exe; } catch (e) { /* sem runtime embutido */ }
  return '';
}

function resolvePython(settings) {
  const manual = String((settings && settings.python_path) || '').trim();
  if (manual) return manual;          // o usuario mandou usar o dele
  return bundledPython() || 'python'; // embutido, ou o do PATH como ultimo recurso
}

function bridgePortOf(e) {
  const n = parseInt((e && e.bridge_port) || '', 10);
  return (n >= 1 && n <= 65535) ? n : BRIDGE_PORT_BASE;
}

// A URL efetiva da conexao. Numa RFC ela e SEMPRE derivada da porta do bridge --
// o campo `url` do formulario nem existe nesse tipo.
function urlOf(e) {
  if (e && e.auth_type === 'rfc') return 'http://127.0.0.1:' + bridgePortOf(e);
  return (e && e.url) || '';
}

// Variaveis que o adt_rfc_bridge.py le (ele exige as obrigatorias no import e
// sai com codigo 2 se faltar alguma).
function bridgeEnvFor(settings, e) {
  const env = {
    BRIDGE_PORT:   String(bridgePortOf(e)),
    BRIDGE_SCRIPT: BRIDGE_SCRIPT,
    RFC_ASHOST:    e.ashost || '',
    RFC_SYSNR:     e.sysnr || '00',
    RFC_CLIENT:    e.sap_client || '100',
    RFC_USER:      e.user || '',
    RFC_PASSWD:    e.password || ''
  };
  // Sem router = acesso direto; o bridge so passa o parametro quando ele existe.
  if (e.saprouter) env.RFC_SAPROUTER = e.saprouter;
  return env;
}

// Onde o SDK e apontado para o pyrfc.
//
// ARMADILHA: o PATH nao resolve. Desde o Python 3.8 o carregamento de extensao C
// usa LOAD_LIBRARY_SEARCH_DEFAULT_DIRS, que cobre a pasta do app, a system32 e as
// pastas registradas por os.add_dll_directory() -- o PATH fica de fora. O proprio
// pyrfc trata isso no __init__.py dele:
//     os.add_dll_directory(os.path.join(os.environ["SAPNWRFC_HOME"], "lib"))
// Ou seja, quem manda e o SAPNWRFC_HOME. Quem tem a DLL na system32 (SAPSetup
// costuma deixar la) funciona sem nada disso; quem tem o SDK numa pasta propria
// so funciona por aqui.
//
// Aceitamos tanto a RAIZ do SDK quanto a pasta lib: o usuario sabe onde esta a
// DLL, nao a convencao de pastas da SAP.
function sdkHomeFrom(dir) {
  // sem regex aqui de proposito: separador em literal e facil de errar
  let d = String(dir || '').trim();
  while (d.endsWith('/') || d.endsWith(path.sep)) d = d.slice(0, -1);
  if (!d) return '';
  try {
    if (fs.existsSync(path.join(d, 'lib', sdkLibName()))) return d;             // raiz do SDK
    if (fs.existsSync(path.join(d, sdkLibName())))        return path.dirname(d); // pasta lib
  } catch (e) { /* caminho invalido: cai no fallback */ }
  return d; // deixa passar; o diagnostico dira se nao serve
}

function withSdkPath(settings, envMap) {
  const nativo = (x) => String(x).replace(/\//g, path.sep);
  const aplicar = (dir) => {
    const home = sdkHomeFrom(dir);
    if (home) envMap.SAPNWRFC_HOME = nativo(home); // e ISTO que o pyrfc le
    // PATH nao basta pro pyrfc, mas ajuda as ferramentas de linha de comando do SDK
    envMap.PATH = nativo(dir) + path.delimiter + (process.env.PATH || '');
    return envMap;
  };

  const conf = String((settings && settings.nwrfc_lib) || '').trim();
  if (conf) return aplicar(conf);

  // Campo vazio: procura o SDK sozinho.
  //
  // Sem isto havia um buraco feio: uma DLL que esta so no PATH (e nao na
  // System32) e ACHADA pelo diagnostico mas NAO carrega no pyrfc, porque desde o
  // Python 3.8 o PATH nao vale pra dependencia de extensao C. O usuario via
  // "SDK ok" e "pyrfc falhou" na mesma tela, sem pista do que fazer.
  const achado = findSdkLib(settings);
  if (!achado || achado.arch !== 'x64') return envMap;
  const dir = path.dirname(achado.file);
  // System32 ja entra na busca padrao de DLL: mexer no env so atrapalharia
  if (isSystemDir(dir)) return envMap;
  return aplicar(dir);
}

// System32 / SysWOW64 / a propria pasta do Windows.
function isSystemDir(dir) {
  const win = (process.env.WINDIR || 'C:' + path.sep + 'Windows').toLowerCase();
  let d = String(dir || '').toLowerCase().replace(/\//g, path.sep);
  while (d.endsWith(path.sep)) d = d.slice(0, -1); // sem literal de separador na regex
  return d === win || d === path.join(win, 'system32') || d === path.join(win, 'syswow64');
}

// Uma porta livre qualquer, cedida pelo SO. O teste de conexao sobe um bridge
// proprio nela, pra nao brigar com o bridge que o host MCP pode ter deixado no
// ar na porta oficial da conexao (que estaria com a config ANTIGA).
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const porta = srv.address().port;
      srv.close(() => resolve(porta));
    });
  });
}

// Espera a porta do bridge abrir. Usado so pelo teste de conexao -- o launcher
// tem a espera dele, em Python.
function waitForPort(port, timeoutMs) {
  const limite = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tenta = () => {
      const sock = net.connect({ host: '127.0.0.1', port }, () => {
        sock.destroy();
        resolve(true);
      });
      sock.on('error', () => {
        sock.destroy();
        if (Date.now() >= limite) resolve(false);
        else setTimeout(tenta, 200);
      });
    };
    tenta();
  });
}

// Entrada do sistema no .vsp.json (compartilhada pela geracao e pelo teste).
function buildSystemEntry(projectPath, e) {
  const sys = { url: urlOf(e), client: e.sap_client || '100' };
  if (e.language) sys.language = e.language;
  if (e.auth_type === 'cloud') {
    sys.cookie_file = cookieFileFor(projectPath, e).replace(/\\/g, '/');
  } else { // onprem | rfc
    if (e.user) sys.user = e.user;
    // RFC fala HTTP puro com o bridge no loopback: nao ha TLS pra relaxar
    if (e.insecure && e.auth_type === 'onprem') sys.insecure = true;
  }
  return sys;
}

// Args do server MCP do vsp (Claude .mcp.json e Codex ~/.codex/config.toml).
// IMPORTANTE: no modo MCP (comando raiz) este build do vsp NAO aplica `-s <profile>`
// pra pegar URL/credencial do .vsp.json — ele exige a conexao EXPLICITA (senao morre
// com "SAP URL is required" antes do handshake). Por isso passamos tudo explicito aqui,
// deixando o server self-contained (independe de cwd / .vsp.json).
function buildMcpArgs(settings, e, folder) {
  const args = ['--url', urlOf(e), '--client', e.sap_client || '100'];
  if (e.language) args.push('--language', e.language);
  if (e.auth_type === 'cloud') {
    // caminho ABSOLUTO: o server precisa achar o cookie independente do cwd
    args.push('--cookie-file', cookieFileFor(folderOfEnv(e, folder), e).replace(/\\/g, '/'));
  } else { // onprem | rfc (numa RFC a URL aponta pro bridge local)
    if (e.user)     args.push('--user', e.user);
    if (e.password) args.push('--password', e.password);
    if (e.insecure && e.auth_type === 'onprem') args.push('--insecure');
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

// Comando + args + env de um server MCP.
function buildServerLaunch(settings, e, folder) {
  // RFC: quem o host MCP sobe e o Python (launcher), nao o vsp. O launcher
  // garante o bridge no ar e so entao entrega o stdio pro vsp, repassando estes
  // mesmos args -- por isso o resto da config (modo, read-only, transports)
  // continua valendo igual as outras conexoes.
  if (e.auth_type === 'rfc') {
    const envMap = withSdkPath(settings, Object.assign(bridgeEnvFor(settings, e), {
      ADT_CLIENT: settings.vsp_path
    }));
    return {
      command: resolvePython(settings),
      args: [BRIDGE_LAUNCHER].concat(buildMcpArgs(settings, e, folder)),
      env: envMap
    };
  }
  return { command: settings.vsp_path, args: buildMcpArgs(settings, e, folder), env: {} };
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
  L.push('  usuario + insecure), `~/.claude.json` (Claude Code, global), `~/.codex/config.toml` (Codex, global), `.env`.');
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
  L.push('## Conexoes RFC (Tipo `rfc`) — LIMITE que muda o que da pra pedir');
  L.push('Nesses ambientes o vsp **nao** fala HTTP com o SAP: ele fala com um bridge local em');
  L.push('`127.0.0.1:<porta>` que tunela cada request ADT pela FM `SADT_REST_RFC_ENDPOINT` por');
  L.push('RFC, atravessando o SAProuter (mesmo caminho do Eclipse ADT). Isso e transparente pro');
  L.push('vsp em tudo, MENOS num ponto que muda o seu plano:');
  L.push('- A FM e **stateless por chamada** — nao existe sessao HTTP. Logo **ATIVAR objeto NAO');
  L.push('  FUNCIONA**: o `LockObject` e o `Activate` caem em sessoes diferentes (da `403 User is');
  L.push('  currently editing`; e se destravar antes, o activate vira **200 no-op silencioso**).');
  L.push('- Em NetWeaver 75x o lock volta `MODIFICATION_SUPPORT=NoModification` e o vsp **aborta');
  L.push('  antes de gravar**. Nao fique retentando: nao ha flag que contorne pelo MCP.');
  L.push('- Portanto, aqui conte com **ler, buscar e analisar**. Precisa gravar/ativar? Diga ao');
  L.push('  usuario pra usar Eclipse ADT (ou um caminho HTTP(S) real ate o ICM) — nao tente por aqui.');
  L.push('- Erro `502 ADT-RFC bridge error` ou conexao recusada = problema do bridge/RFC (SDK,');
  L.push('  pyrfc, credencial, router), **nao** do seu fluxo. Reporte ao usuario para ele rodar o');
  L.push('  **Diagnostico do bridge** no SAP MCP Cockpit.');
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
    const launch = buildServerLaunch(settings, e, e.folder);
    lines.push(`[mcp_servers.${id}]`);
    lines.push(`command = ${tomlStr(launch.command)}`);
    lines.push(`args = [${launch.args.map(tomlStr).join(', ')}]`);
    const envMap = Object.assign({}, launch.env);
    if (e.auth_type !== 'cloud' && e.password) {
      for (const v of passwordVarsOf(id)) envMap[v] = e.password;
    }
    if (Object.keys(envMap).length) {
      const envPairs = Object.entries(envMap).map(([k, v]) => `"${k}" = ${tomlStr(v)}`).join(', ');
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
// Encerra os processos vsp que ficaram vivos da geracao anterior.
// O host MCP (Claude/Codex) sobe o vsp como filho e ele SEGURA a config antiga
// em memoria: sem matar, o MCP continua respondendo com os profiles/cookies
// velhos e a config recem-gerada nao vale nada. Equivale ao
//   Get-Process vsp | Stop-Process -Force
// que antes precisava ser rodado na mao a cada "Gerar configs".
// Sem /T de proposito: o browser-auth abre o Chrome como filho e derrubar a
// arvore fecharia a janela do usuario.
// ---------------------------------------------------------------------------
function killVspProcesses(settings) {
  const base = path.basename((settings && settings.vsp_path) || 'vsp.exe');
  try {
    if (process.platform === 'win32') {
      const image = /\.exe$/i.test(base) ? base : base + '.exe';
      const r = spawnSync('taskkill', ['/F', '/IM', image], { timeout: 10000 });
      // taskkill sai != 0 quando nao ha processo ("not found") - isso nao e erro.
      const out = String((r.stdout || '') + (r.stderr || ''));
      const killed = (out.match(/PID/g) || []).length;
      return { killed };
    }
    const name = base.replace(/\.exe$/i, '');
    const r = spawnSync('pkill', ['-x', name], { timeout: 10000 });
    // pkill: 0 = matou algo, 1 = nada rodando. Nao da pra contar quantos.
    return { killed: r.status === 0 ? null : 0 };
  } catch (e) {
    console.error('Falha ao encerrar processos vsp:', e);
    return { killed: 0, error: e.message };
  }
}

// ---------------------------------------------------------------------------
// Encerra os bridges ADT-over-RFC que ficaram vivos.
//
// Sem isto a config nova nao vale nada nas conexoes RFC: o launcher so sobe um
// bridge quando a porta esta LIVRE. Um bridge antigo continua escutando a mesma
// porta com o ashost/usuario/senha ANTIGOS, e o vsp novo se conecta nele achando
// que esta falando com o sistema recem-configurado.
//
// Nao da pra usar taskkill /IM python.exe: derrubaria todo Python da maquina. O
// filtro e pela linha de comando conter adt_rfc_bridge.py, entao so morre o que
// e nosso.
// ---------------------------------------------------------------------------
function killBridgeProcesses() {
  try {
    if (process.platform === 'win32') {
      // Dois cuidados que parecem detalhe e nao sao:
      //   - restringir a processos 'py*' (python.exe/pythonw.exe/py.exe), senao o
      //     PROPRIO powershell entra no resultado: a string do filtro esta na
      //     linha de comando dele e ele mataria a si mesmo antes de matar o bridge;
      //   - @(...) pra contar, porque .Count num CimInstance solto volta vazio.
      const ps = [
        '$me = $PID',
        "$p = @(Get-CimInstance Win32_Process -Filter \"Name LIKE 'py%'\" | " +
          "Where-Object { $_.CommandLine -like '*adt_rfc_bridge.py*' -and $_.ProcessId -ne $me })",
        '$p | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }',
        '$p.Count'
      ].join('; ');
      const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 15000 });
      const n = parseInt(String(r.stdout || '').trim(), 10);
      return { killed: Number.isFinite(n) ? n : 0 };
    }
    const r = spawnSync('pkill', ['-f', 'adt_rfc_bridge.py'], { timeout: 10000 });
    return { killed: r.status === 0 ? null : 0 };
  } catch (e) {
    console.error('Falha ao encerrar o bridge RFC:', e);
    return { killed: 0, error: e.message };
  }
}

// ---------------------------------------------------------------------------
// Registrar UMA conexao no escopo GLOBAL (user) do Claude Code: ~/.claude.json,
// chave mcpServers do topo. Vale em qualquer pasta.
//
// Esse e o UNICO escopo que o Cockpit usa, e a razao e dura: um server
// declarado no .mcp.json da pasta (escopo de PROJETO) fica em "Pending
// approval" e nenhuma escrita em arquivo libera. Testados e reprovados no
// Claude Code 2.1.229:
//   ~/.claude.json -> projects[<pasta>].enabledMcpjsonServers
//   <pasta>/.claude/settings.local.json -> enabledMcpjsonServers
//   <pasta>/.claude/settings.local.json -> enableAllProjectMcpServers: true
// So o prompt interativo do `claude` aprova — e ele volta a perguntar sempre
// que o .mcp.json muda, ou seja, regerar a config derrubava o que funcionava.
// Prova, mesmo binario e cookie: escopo user -> Connected; projeto -> Pending.
//
// Escopo user funciona porque buildMcpArgs monta a conexao COMPLETA e com
// caminho ABSOLUTO do cookie — a entrada nao depende do cwd.
//
// Cuidado com esse arquivo: ele guarda o estado inteiro do Claude Code (dezenas
// de KB, historico por projeto, conta). Por isso: le, mexe so em mcpServers,
// e grava em temp + rename (atomico), com .bak da versao anterior.
// ---------------------------------------------------------------------------
const CLAUDE_GLOBAL = path.join(os.homedir(), '.claude.json');

function buildMcpServerEntry(settings, e, folder) {
  const launch = buildServerLaunch(settings, e, folder);
  const entry = { type: 'stdio', command: launch.command, args: launch.args };
  const envMap = Object.assign({}, launch.env);
  if (e.auth_type !== 'cloud' && e.password) {
    for (const v of passwordVarsOf(envIdOf(e))) envMap[v] = e.password;
  }
  if (Object.keys(envMap).length) entry.env = envMap;
  return entry;
}

// Le o ~/.claude.json. Devolve { json, raw } ou { error } — nunca lanca, pra
// quem chama poder decidir se recusa (na escrita) ou ignora (na leitura).
function readClaudeGlobal() {
  if (!fs.existsSync(CLAUDE_GLOBAL)) return { json: {}, raw: '' };
  const raw = fs.readFileSync(CLAUDE_GLOBAL, 'utf8');
  try {
    return { json: JSON.parse(raw), raw };
  } catch (e) {
    return { error: 'badJson', raw };
  }
}

// Grava preservando tudo: .bak da versao anterior + temp/rename atomico.
function writeClaudeGlobal(json, raw) {
  if (raw) fs.writeFileSync(CLAUDE_GLOBAL + '.bak', raw, 'utf8');
  const pretty = !raw || /^\{\s*\r?\n/.test(raw); // mantem o estilo do arquivo
  const tmp = CLAUDE_GLOBAL + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(json, null, pretty ? 2 : 0), 'utf8');
  fs.renameSync(tmp, CLAUDE_GLOBAL); // nunca deixa o arquivo pela metade
}

// ---------------------------------------------------------------------------
// Faxina do escopo de PROJETO que as versoes antigas deixaram pra tras.
//
// Ate a 2.1.1 o Cockpit gravava um .mcp.json na pasta e tentava pre-aprovar em
// ~/.claude.json. A aprovacao nunca teve efeito (ver bloco acima), e o que
// sobrou atrapalha de verdade: um server que existe nos DOIS escopos faz o
// Claude Code reclamar de "conflicting scopes", e o de projeto fica pendurado
// em "pending approval" pra sempre.
//
// Some so com o QUE E NOSSO: a chave do profile no .mcp.json (o arquivo so e
// apagado se ficar sem nenhum server) e o id nas listas de aprovacao. Server
// que o usuario tenha declarado a mao fica intacto.
//
// A chave da pasta aparece nos dois formatos no arquivo real (C:\Users\... e
// C:/Users/...) porque nos mesmos gravavamos nos dois — por isso a limpeza
// varre as duas formas.
// ---------------------------------------------------------------------------
function projectKeys(dir) {
  const nativo = path.resolve(dir);          // C:\Users\...
  const barra = nativo.replace(/\\/g, '/');  // C:\Users\... -> C:/Users/...
  return [...new Set([nativo, barra])];
}

function cleanProjectScope(dir, ids) {
  const out = { mcpJson: false, approval: false };
  if (!dir || !ids || !ids.length) return out;

  // 1. tira os profiles do .mcp.json da pasta
  try {
    const alvo = path.join(dir, '.mcp.json');
    if (fs.existsSync(alvo)) {
      const j = JSON.parse(fs.readFileSync(alvo, 'utf8'));
      const servers = j.mcpServers || {};
      let mexeu = false;
      for (const id of ids) if (Object.prototype.hasOwnProperty.call(servers, id)) { delete servers[id]; mexeu = true; }
      if (mexeu) {
        out.mcpJson = true;
        if (Object.keys(servers).length) writeJson(alvo, j);
        else fs.unlinkSync(alvo); // ficou vazio: nao deixa arquivo inutil na pasta
      }
    }
  } catch (e) { /* .mcp.json ilegivel/alheio: nao e nosso, deixa quieto */ }

  // 2. tira os ids das listas de aprovacao que gravamos antes
  try {
    const r = readClaudeGlobal();
    if (!r.error && r.json.projects) {
      let mexeu = false;
      for (const k of projectKeys(dir)) {
        const p = r.json.projects[k];
        if (!p || !Array.isArray(p.enabledMcpjsonServers)) continue;
        const filtrado = p.enabledMcpjsonServers.filter(x => !ids.includes(x));
        if (filtrado.length !== p.enabledMcpjsonServers.length) { p.enabledMcpjsonServers = filtrado; mexeu = true; }
      }
      if (mexeu) { writeClaudeGlobal(r.json, r.raw); out.approval = true; }
    }
  } catch (e) { /* idem */ }

  return out;
}

// Quais profiles ja estao no escopo global. Usado pelo indicador e pelo filtro.
ipcMain.handle('configs:globalStatus', () => {
  const r = readClaudeGlobal();
  if (r.error) return { ok: false, key: 'be.globalBadJson', args: [CLAUDE_GLOBAL], profiles: [] };
  return { ok: true, file: CLAUDE_GLOBAL, profiles: Object.keys(r.json.mcpServers || {}) };
});

// Habilitar MCP: registra a conexao no escopo global e, se ela tem pasta,
// (re)grava os arquivos de apoio do workspace. `envs` deve trazer TODAS as
// conexoes que dividem a pasta — o .vsp.json lista todas.
ipcMain.handle('configs:generateGlobal', (_evt, payload) => {
  try {
    const { settings, env, envs } = payload || {};
    if (!env) return { ok: false, key: 'be.globalNoEnv' };
    if (env.auth_type === 'cloud' && !env.folder) return { ok: false, key: 'be.noFolderForConn' };

    const id = envIdOf(env);
    const r = readClaudeGlobal();
    if (r.error) return { ok: false, key: 'be.globalBadJson', args: [CLAUDE_GLOBAL] };

    const json = r.json;
    if (!json.mcpServers || typeof json.mcpServers !== 'object') json.mcpServers = {};
    const existed = Object.prototype.hasOwnProperty.call(json.mcpServers, id);
    json.mcpServers[id] = buildMcpServerEntry(settings, env, env.folder);
    writeClaudeGlobal(json, r.raw);

    // Arquivos de apoio da pasta (sem .mcp.json): .vsp.json, CLAUDE.md, etc.
    let files = null;
    if (env.folder) {
      const daPasta = (envs && envs.length) ? envs : [env];
      const ws = generateWorkspace(settings, env.folder, daPasta);
      if (ws.ok) files = ws.files;
      // sobra de versao antiga: mesmo profile no escopo de projeto vira
      // "conflicting scopes" e fica preso em "pending approval"
      cleanProjectScope(env.folder, [id]);
    }

    // O vsp que o host subiu segura a config antiga em memoria. Sem derrubar,
    // atualizar um profile que ja era global nao teria efeito nenhum. Depois
    // da escrita, pra nao respawnar no meio.
    const vsp = killVspProcesses(settings);
    // bridge antigo segurando a porta faria o launcher reaproveitar a config velha
    const bridge = killBridgeProcesses();

    return {
      ok: true,
      key: existed ? 'be.globalUpdated' : 'be.globalAdded',
      args: [id, CLAUDE_GLOBAL],
      profile: id,
      files,
      vspKilled: vsp.killed,
      bridgeKilled: bridge.killed
    };
  } catch (e) {
    return { ok: false, key: 'be.globalFail', args: [e.message] };
  }
});

// Tira o profile do escopo global. So mexe na chave dele: qualquer outro server
// que o usuario tenha registrado a mao continua intacto.
ipcMain.handle('configs:removeGlobal', (_evt, payload) => {
  try {
    const { settings, env } = payload || {};
    if (!env) return { ok: false, key: 'be.globalNoEnv' };

    const id = envIdOf(env);
    const r = readClaudeGlobal();
    if (r.error) return { ok: false, key: 'be.globalBadJson', args: [CLAUDE_GLOBAL] };

    const json = r.json;
    if (!json.mcpServers || !Object.prototype.hasOwnProperty.call(json.mcpServers, id)) {
      return { ok: false, key: 'be.globalNotThere', args: [id] };
    }
    delete json.mcpServers[id];
    writeClaudeGlobal(json, r.raw);

    const vsp = killVspProcesses(settings || {});
    const bridge = killBridgeProcesses();
    return {
      ok: true, key: 'be.globalRemoved', args: [id, CLAUDE_GLOBAL], profile: id,
      vspKilled: vsp.killed, bridgeKilled: bridge.killed
    };
  } catch (e) {
    return { ok: false, key: 'be.globalFail', args: [e.message] };
  }
});

// ---------------------------------------------------------------------------
// Import do SAP GUI: %APPDATA%/SAP/Common/SAPUILandscape.xml
// Estrutura do arquivo: Workspace > Node (a pasta, que na pratica e o cliente)
// > Item(serviceid) -> Service (a conexao). Routers ficam a parte, referenciados
// por routerid.
//
// ATENCAO ao que o arquivo NAO tem: os Services sao type="SAPGUI" (DIAG), logo
// nao ha URL HTTP nem mandante — o SAP GUI so pergunta o client no logon. Por
// isso o import preenche o que da e o usuario completa no formulario.
// ---------------------------------------------------------------------------
const SAP_LANDSCAPE = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'SAP', 'Common', 'SAPUILandscape.xml'
);

function decodeXml(s) {
  return String(s || '')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function xmlAttrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = decodeXml(m[2]);
  return out;
}

// A porta DIAG do SAP GUI e 32<instancia> (3202 -> instancia 02). A porta HTTP
// do ICM e, por CONVENCAO, 80<instancia>. Convencao, nao garantia: o Basis pode
// ter publicado o ICM em outra porta ou so em HTTPS (443<instancia>). A URL vai
// pro formulario como sugestao — quem confirma e o usuario.
function deriveHttpUrl(server) {
  const m = String(server || '').match(/^([^:]+):(\d+)$/);
  if (!m) return { host: String(server || ''), instance: null, url: '' };
  const [, host, port] = m;
  const instance = /^32(\d\d)$/.test(port) ? port.slice(2) : null;
  return { host, diagPort: port, instance, url: instance ? `http://${host}:80${instance}` : '' };
}

// Um landscape pode estar dividido em varios arquivos: o do usuario referencia
// outros por <Include url="file:///..."/>. Numa maquina corporativa e comum
// TODAS as conexoes morarem no arquivo global incluido -- ignorar o Include
// fazia o import aparecer vazio justamente onde ele mais importa.
//
// So seguimos file:// (ou caminho relativo). Um Include http(s) apontaria pra um
// servidor que o Cockpit nao tem por que buscar.
function includedFiles(xml, base) {
  const out = [];
  for (const m of xml.matchAll(/<Include\b[^>]*\/>/g)) {
    const url = xmlAttrs(m[0]).url || '';
    if (!url) continue;
    if (/^file:/i.test(url)) {
      try { out.push(fileURLToPath(url)); } catch (e) { /* url malformada: pula */ }
    } else if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) {
      out.push(path.resolve(path.dirname(base), url)); // caminho relativo
    }
  }
  return out;
}

// Junta o arquivo raiz com tudo que ele inclui. Dedup por caminho real (um
// include pode apontar de volta pro arquivo de origem) e teto de 16 arquivos,
// pra uma cadeia circular nao virar loop infinito.
function collectLandscapeDocs(raiz) {
  const docs = [];
  const vistos = new Set();
  const fila = [raiz];
  while (fila.length && docs.length < 16) {
    const f = fila.shift();
    let chave;
    try { chave = fs.realpathSync(f).toLowerCase(); } catch (e) { chave = String(f).toLowerCase(); }
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    let xml;
    try { xml = fs.readFileSync(f, 'utf8'); } catch (e) { continue; } // include quebrado nao derruba o import
    docs.push({ file: f, xml });
    for (const inc of includedFiles(xml, f)) fila.push(inc);
  }
  return docs;
}

// Aceita a lista de documentos de collectLandscapeDocs (ou um XML solto, pros
// testes). Devolve as pastas do SAP GUI com as conexoes de cada uma.
function parseLandscape(docs) {
  const lista = Array.isArray(docs) ? docs : [{ file: '', xml: String(docs || '') }];

  // Os <Router> de um arquivo podem ser referenciados pelos <Service> de outro,
  // entao TODOS os routers sao colhidos antes de resolver qualquer servico.
  const routers = {};
  for (const d of lista) {
    for (const m of d.xml.matchAll(/<Router\b[^>]*\/>/g)) {
      const a = xmlAttrs(m[0]);
      if (a.uuid) routers[a.uuid] = a.router || a.name || '';
    }
  }

  const services = {};
  for (const d of lista) {
    for (const m of d.xml.matchAll(/<Service\b[^>]*\/>/g)) {
      const a = xmlAttrs(m[0]);
      if (!a.uuid) continue;
      services[a.uuid] = Object.assign({
        uuid: a.uuid,
        type: a.type || '',
        name: a.name || a.systemid || '',
        systemid: a.systemid || '',
        server: a.server || '',
        router: a.routerid ? (routers[a.routerid] || '') : ''
      }, deriveHttpUrl(a.server));
    }
  }

  // Node nao aninha neste formato (cada um fecha antes do proximo abrir), entao
  // o match nao-guloso e seguro.
  const groups = [];
  const used = new Set();
  const porNome = new Map();
  for (const d of lista) {
    for (const m of d.xml.matchAll(/<Node\b([^>]*)>([\s\S]*?)<\/Node>/g)) {
      const a = xmlAttrs('<Node ' + m[1] + '>');
      const items = [];
      for (const it of m[2].matchAll(/<Item\b[^>]*\/>/g)) {
        const svc = services[xmlAttrs(it[0]).serviceid];
        if (svc) { items.push(svc); used.add(svc.uuid); }
      }
      if (!items.length) continue;
      const nome = a.name || '';
      // a mesma pasta pode existir nos dois arquivos: junta em uma so
      const ja = porNome.get(nome);
      if (ja) { ja.services.push.apply(ja.services, items); continue; }
      const g = { name: nome, services: items };
      porNome.set(nome, g);
      groups.push(g);
    }
  }
  // conexoes soltas, fora de qualquer pasta
  const loose = Object.values(services).filter(s => !used.has(s.uuid));
  if (loose.length) groups.push({ name: '', services: loose });

  return groups;
}

ipcMain.handle('sap:landscape', () => {
  try {
    if (!fs.existsSync(SAP_LANDSCAPE)) {
      return { ok: false, key: 'be.landscapeMissing', args: [SAP_LANDSCAPE] };
    }
    const docs = collectLandscapeDocs(SAP_LANDSCAPE);
    const groups = parseLandscape(docs);
    const count = groups.reduce((n, g) => n + g.services.length, 0);
    if (!count) return { ok: false, key: 'be.landscapeEmpty', args: [SAP_LANDSCAPE] };
    // `files` conta quantos arquivos entraram (raiz + includes), pra UI poder dizer
    return { ok: true, file: SAP_LANDSCAPE, files: docs.map(d => d.file), groups, count };
  } catch (e) {
    return { ok: false, key: 'be.landscapeError', args: [e.message] };
  }
});

// ---------------------------------------------------------------------------
// Geracao dos arquivos de apoio de um WORKSPACE (.vsp.json, CLAUDE.md,
// AGENTS.md, .env, .gitignore). O server MCP nao esta aqui — ele e global.
//
// A unidade e a PASTA, nao a conexao: duas conexoes que apontam pra mesma pasta
// compartilham um workspace so, e o .vsp.json dela lista as duas. Por isso quem
// chama precisa passar TODAS as conexoes daquela pasta — gravar so a conexao
// clicada apagaria as outras do arquivo.
// ---------------------------------------------------------------------------
function generateWorkspace(settings, folder, envs) {
  if (!folder) return { ok: false, key: 'be.noFolderForConn' };
  fs.mkdirSync(folder, { recursive: true });

  // ---- .vsp.json (fonte da verdade dos sistemas) ----
  const systems = {};
  for (const e of envs) systems[envIdOf(e)] = buildSystemEntry(folder, e);
  const vspJson = { systems };
  if (envs.length) vspJson.default = envIdOf(envs[0]);
  writeJson(path.join(folder, '.vsp.json'), vspJson);

  // Nao existe .mcp.json aqui de proposito: server de projeto nao carrega sem
  // aprovacao interativa. O server MCP vai pro escopo global (~/.claude.json),
  // que e o que de fato conecta — inclusive dentro desta pasta.

  // ---- CLAUDE.md (Claude Code) + AGENTS.md (Codex) - mesmo conteudo ----
  const instructions = buildInstructionsMd(envs);
  fs.writeFileSync(path.join(folder, 'CLAUDE.md'), instructions, 'utf8');
  fs.writeFileSync(path.join(folder, 'AGENTS.md'), instructions, 'utf8');

  // ---- .env (senhas on-premise) ----
  const envLines = [
    '# Senhas das conexoes Private e SAProuter (RFC) - basic auth.',
    '# Gerado pelo SAP MCP Cockpit. NAO versionar (esta no .gitignore).',
    '# Padrao lido pelo vsp: VSP_<SYSTEM>_PASSWORD',
    ''
  ];
  for (const e of envs) {
    if (e.auth_type !== 'cloud' && e.password) {
      for (const v of passwordVarsOf(envIdOf(e))) envLines.push(`${v}=${e.password}`);
    }
  }
  fs.writeFileSync(path.join(folder, '.env'), envLines.join('\n') + '\n', 'utf8');

  // ---- .gitignore ----
  fs.writeFileSync(path.join(folder, '.gitignore'), [
    '# SAP MCP Cockpit - arquivos sensiveis / locais',
    '.env', '.vsp.json', '.mcp.json', '.codex/', 'codex.toml', 'cookies*.txt', ''
  ].join('\n'), 'utf8');

  return {
    ok: true,
    files: ['.vsp.json', '.env', '.gitignore', 'CLAUDE.md', 'AGENTS.md'],
    count: envs.length
  };
}

// Codex tambem so le MCP do config GLOBAL dele — nao existe equivalente por
// projeto em nenhum dos dois hosts.
ipcMain.handle('mcp:syncCodex', (_evt, payload) => {
  try {
    const { settings, envs } = payload || {};
    const file = mergeCodexGlobalConfig(settings, envs || []);
    return { ok: true, file };
  } catch (e) {
    return { ok: false, key: 'be.genError', args: [e.message] };
  }
});

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
    backgroundColor: '#0e1116', // igual ao --bg do renderer: evita flash claro no boot
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

// ---------------------------------------------------------------------------
// Auto-update (electron-updater + GitHub Releases)
// So funciona no app EMPACOTADO: em dev nao existe app-update.yml e o updater
// lanca erro. O repo e publico, entao nao precisa de token.
// O download roda em background e a troca acontece no proximo fechamento do app
// (autoInstallOnAppQuit) - ou na hora, se o usuario clicar em "Reiniciar".
// ---------------------------------------------------------------------------
let updateState = { state: 'idle', version: null, percent: 0, message: null };
let updater = null; // instancia do electron-updater; null em dev / se o require falhar

function sendUpdate(patch) {
  updateState = Object.assign({}, updateState, patch);
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update:status', updateState);
    }
  } catch (e) { /* janela indo embora */ }
}

function initAutoUpdate() {
  if (!app.isPackaged) {
    updateState = { state: 'dev', version: app.getVersion(), percent: 0, message: null };
    return;
  }
  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (e) {
    console.error('electron-updater indisponivel:', e);
    sendUpdate({ state: 'error', message: String(e.message || e) });
    return;
  }
  updater = autoUpdater;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => sendUpdate({ state: 'checking' }));
  autoUpdater.on('update-not-available', () => sendUpdate({ state: 'current' }));
  autoUpdater.on('update-available', (info) => sendUpdate({ state: 'downloading', version: info.version, percent: 0 }));
  autoUpdater.on('download-progress', (p) => sendUpdate({ state: 'downloading', percent: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', (info) => sendUpdate({ state: 'ready', version: info.version, percent: 100 }));
  autoUpdater.on('error', (err) => {
    // Sem rede / rate limit do GitHub / release sem latest.yml: nao e fatal,
    // o app continua funcionando normalmente na versao atual.
    console.error('Auto-update falhou:', err);
    sendUpdate({ state: 'error', message: String((err && err.message) || err) });
  });

  // Espera a janela existir pra nao perder os eventos iniciais.
  setTimeout(() => { autoUpdater.checkForUpdates().catch(() => {}); }, 3000);

  // E repete de tempos em tempos. Sem isso, so a checagem do boot existia: um
  // app deixado aberto nunca descobria versao nova — bastava a release sair
  // alguns segundos depois de abrir pra ele ficar cego ate o proximo restart.
  // Uma vez a cada 6h e folgado no rate limit do GitHub (5000 req/h, ~3 por
  // checagem) e nao atrapalha quem deixa o Cockpit aberto o dia todo.
  setInterval(() => {
    // 'ready' = download ja terminou e so falta reiniciar; checar de novo so
    // reiniciaria o ciclo a toa
    if (updateState.state === 'downloading' || updateState.state === 'ready') return;
    autoUpdater.checkForUpdates().catch(() => {});
  }, 6 * 60 * 60 * 1000);
}

// Handlers registrados SEMPRE (mesmo em dev, onde `updater` fica null): o
// renderer chama sem saber se o app esta empacotado.
ipcMain.handle('update:state', () => Object.assign({ appVersion: app.getVersion() }, updateState));

ipcMain.handle('update:check', () => {
  if (!updater) return { ok: false, key: 'be.updateDevMode' };
  return updater.checkForUpdates().then(
    () => ({ ok: true }),
    (e) => ({ ok: false, message: String(e.message || e) })
  );
});

ipcMain.handle('update:install', () => {
  if (!updater) return { ok: false, key: 'be.updateDevMode' };
  // Fora do handler: quitAndInstall derruba o app e o IPC junto.
  setImmediate(() => updater.quitAndInstall());
  return { ok: true };
});

app.whenReady().then(() => {
  ensureBridgeFiles(); // scripts do bridge RFC no userData (Python nao le de dentro do asar)
  createWindow();
  initAutoUpdate();
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

// Login SSO (cloud) - dispara vsp --browser-auth e salva o cookie do ambiente.
// O vsp browser-auth nem sempre encerra sozinho (fica vivo apos a captura), entao
// detectamos o SUCESSO pelo arquivo de cookie sendo salvo (estavel) e ai encerramos
// o processo - em vez de esperar o 'exit', que pode nunca disparar.
ipcMain.handle('vsp:login', (_evt, payload) => {
  return new Promise((resolve) => {
    const { settings, env } = payload;
    // a pasta vem da conexao: o cookie tem que morar no mesmo workspace que a
    // config aponta, senao o vsp procura num lugar e o login gravou noutro
    const projectPath = folderOfEnv(env);
    if (!projectPath) {
      resolve({ ok: false, key: 'be.noFolderForConn' });
      return;
    }
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
    const ok = (extra) => {
      // O cookie novo ja esta no disco, mas o vsp que o host MCP subiu ainda
      // segura o ANTIGO em memoria — relogar sem derrubar nao surte efeito
      // nenhum. A config em si NAO fica velha: ela guarda o CAMINHO do cookie,
      // e o arquivo e sempre o mesmo, sobrescrito a cada login.
      // Aqui e seguro: so chega neste ponto com o cookie ja capturado e estavel.
      const vsp = killVspProcesses(settings);
      finish({
        ok: true,
        key: 'be.loginOk',
        args: [path.basename(cookieFile)],
        log: out,
        vspKilled: vsp.killed,
        ...extra
      });
    };

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

// Apaga o cookie vencido. Ele nao autentica mais nada, e a presenca dele so
// engana: era o arquivo velho que fazia a UI mostrar "Logado".
function purgeCookie(projectPath, env) {
  try {
    fs.unlinkSync(cookieFileFor(projectPath, env));
    return true;
  } catch (e) {
    return false;
  }
}

// Status do cookie de cada ambiente Cloud: 'none' | 'valid' | 'expired', com o
// prazo quando existe. E o que decide o verde do "Logado" na UI.
// Vencidos sao apagados aqui — a varredura roda ao abrir o app e depois de cada
// acao, entao e o ponto natural pra limpeza.
ipcMain.handle('cookies:status', (_evt, payload) => {
  const { envs } = payload || {};
  const statuses = {};
  const purged = [];
  for (const e of (envs || [])) {
    if (e.auth_type !== 'cloud') continue;
    const id = envIdOf(e);
    const dir = folderOfEnv(e);
    if (!dir) { statuses[id] = { state: 'none', expiresAt: null }; continue; }

    const ck = cookieStatusOf(dir, e);
    if (ck.state === 'expired' && purgeCookie(dir, e)) {
      purged.push(id);
      // segue reportando 'expired' nesta passada, pra UI poder avisar que a
      // sessao caiu; na proxima varredura ja vira 'none'
    }
    statuses[id] = ck;
  }
  return { statuses, purged };
});

// ---------------------------------------------------------------------------
// Diagnostico do bridge RFC.
//
// A cadeia tem varias pecas que precisam CASAR em arquitetura (SDK x64 <-> Python
// x64 <-> pyrfc x64) e o sintoma de qualquer descasamento e o mesmo traceback
// ilegivel de "DLL load failed". Este handler quebra a cadeia em checagens
// separadas pra o usuario ver exatamente qual elo faltou.
// ---------------------------------------------------------------------------
function sdkLibName() {
  if (process.platform === 'win32')  return 'sapnwrfc.dll';
  if (process.platform === 'darwin') return 'libsapnwrfc.dylib';
  return 'libsapnwrfc.so';
}

// Onde o SDK costuma estar. O SAP GUI ja traz a DLL, entao na maioria das
// maquinas Windows nao ha nada a instalar - so achar.
function sdkCandidateDirs(settings) {
  const dirs = [];
  const add = (d) => { if (d && !dirs.includes(d)) dirs.push(d); };
  const conf = String((settings && settings.nwrfc_lib) || '').trim();
  add(conf);
  if (conf) add(path.join(conf, 'lib')); // o usuario pode ter apontado a RAIZ do SDK
  if (process.env.SAPNWRFC_HOME) add(path.join(process.env.SAPNWRFC_HOME, 'lib'));
  for (const d of String(process.env.PATH || '').split(path.delimiter)) add(d.trim());
  if (process.platform === 'win32') {
    const win = process.env.WINDIR || 'C:/Windows';
    add(path.join(win, 'System32'));
    // SysWOW64 de proposito: e onde o SAP GUI de 32 bits deixa a DLL. Ela nao
    // serve (nunca carrega num Python x64), mas ACHAR ela muda o diagnostico de
    // "instale o SAP GUI" -- inutil pra quem ja instalou -- para "voce tem a
    // versao 32 bits, marque o componente de 64".
    add(path.join(win, 'SysWOW64'));
    for (const raiz of ['C:/Program Files (x86)/SAP/FrontEnd/SAPgui',
                        'C:/Program Files/SAP/FrontEnd/SAPgui',
                        'C:/Program Files (x86)/SAP/FrontEnd/SAPBI',
                        'C:/nwrfcsdk/lib', 'C:/SAP/nwrfcsdk/lib']) add(raiz);
  }
  return dirs.filter(Boolean);
}

// Arquitetura de um binario Windows, lida do cabecalho PE.
// Importa porque achar a DLL nao basta: a variante 32 bits do SAP GUI deixa uma
// sapnwrfc.dll x86 na SysWOW64, e ela NUNCA vai carregar no Python x64. Sem esta
// checagem o diagnostico mostraria "SDK OK" e so o pyrfc ficaria vermelho, sem
// dizer o porque.
function peMachine(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const cab = Buffer.alloc(4);
    fs.readSync(fd, cab, 0, 4, 0x3C);       // e_lfanew: offset do cabecalho PE
    const m = Buffer.alloc(2);
    fs.readSync(fd, m, 0, 2, cab.readUInt32LE(0) + 4); // PE\0\0 + Machine
    return ({ 0x8664: 'x64', 0x14c: 'x86', 0xAA64: 'arm64' })[m.readUInt16LE(0)] || '?';
  } catch (e) {
    return '';
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (e) { /* ja fechado */ } }
  }
}

// Procura a DLL do SDK preferindo a x64. Uma x86 encontrada nao vira sucesso,
// mas e guardada: dizer "achei, mas e 32 bits" vale muito mais que "nao achei".
// Varredura de profundidade limitada nas raizes da SAP.
//
// A lista fixa de pastas nao basta: o componente de 64 bits do SAP GUI nao cai
// sempre no mesmo lugar (varia por versao e por como o Basis montou o pacote).
// Uma DLL que EXISTE mas nao e encontrada vira "instale o SAP GUI" pra quem ja
// instalou -- o pior conselho possivel. Profundidade e numero de achados sao
// limitados pra isso nao virar uma varredura de disco.
function scanSdkRoots(alvo) {
  if (process.platform !== 'win32') return [];
  const raizes = [
    'C:/Program Files/SAP',
    'C:/Program Files (x86)/SAP',
    'C:/Program Files/Common Files/SAP Shared',
    'C:/Program Files (x86)/Common Files/SAP Shared',
    'C:/SAP',
    'C:/nwrfcsdk'
  ];
  const achados = [];
  const alvoLower = alvo.toLowerCase();
  const visita = (dir, resta) => {
    if (resta < 0 || achados.length >= 8) return;
    let itens;
    try { itens = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const it of itens) {
      if (achados.length >= 8) return;
      const alvoPath = path.join(dir, it.name);
      if (it.isDirectory()) visita(alvoPath, resta - 1);
      else if (it.name.toLowerCase() === alvoLower) achados.push(alvoPath);
    }
  };
  for (const r of raizes) visita(r, 4);
  return achados;
}

function findSdkLib(settings) {
  const alvo = sdkLibName();
  const checaArch = process.platform === 'win32';
  let consolo = null;
  const candidatos = sdkCandidateDirs(settings).map(d => path.join(d, alvo));
  const avalia = (f) => {
    try {
      if (!fs.existsSync(f)) return null;
      const arch = checaArch ? peMachine(f) : 'x64';
      if (arch === 'x64') return { file: f, arch };
      if (!consolo) consolo = { file: f, arch };
    } catch (e) { /* caminho invalido: ignora */ }
    return null;
  };

  for (const f of candidatos) {
    const bom = avalia(f);
    if (bom) return bom;
  }
  // lista fixa nao deu: procura de verdade nas raizes da SAP
  for (const f of scanSdkRoots(alvo)) {
    const bom = avalia(f);
    if (bom) return bom;
  }
  return consolo;
}

ipcMain.handle('bridge:diagnose', (_evt, payload) => {
  const settings = (payload && payload.settings) || {};
  const python = resolvePython(settings);
  const embutido = bundledPython();
  const checks = [];
  // hintKey opcional: quando a MESMA checagem falha por motivos diferentes, a
  // dica generica nao ajuda (achar a DLL na arquitetura errada != nao achar).
  const push = (id, ok, detail, hintKey) => {
    const c = { id, ok, detail: String(detail || '') };
    if (hintKey) c.hintKey = hintKey;
    checks.push(c);
  };

  // 1. scripts do bridge no userData
  const scriptsOk = ensureBridgeFiles() && fs.existsSync(BRIDGE_SCRIPT) && fs.existsSync(BRIDGE_LAUNCHER);
  push('scripts', scriptsOk, BRIDGE_DIR);

  // 2. Python: existe e e 64 bits? (o SDK e x86-64 only - Python x86 nem carrega)
  let pyOk = false;
  let r = spawnSync(python, ['-c', 'import sys,struct;print(sys.version.split()[0]);print(struct.calcsize("P")*8)'],
                    { timeout: 20000, encoding: 'utf8' });
  if (r.error || r.status !== 0) {
    push('python', false, r.error ? String(r.error.message || r.error) : String(r.stderr || '').trim());
  } else {
    const [versao, bits] = String(r.stdout || '').trim().split(/\r?\n/);
    pyOk = bits === '64';
    // saber se e o embutido ou um do usuario muda o que fazer quando algo falha
    const origem = python === embutido ? ' [do app]' : ' [seu]';
    push('python', pyOk, `${python}${origem} — ${versao} (${bits} bits)`);
  }

  // 3. SDK do NW RFC (tem que ser x64)
  const lib = findSdkLib(settings);
  if (lib && lib.arch === 'x64') push('sdk', true, lib.file);
  else if (lib)                   push('sdk', false, `${lib.file} (${lib.arch})`, 'diag.sdk.hintX86');
  else                            push('sdk', false, sdkLibName());

  // 4. pyrfc: so faz sentido se o Python respondeu. Roda com a lib do SDK no
  //    PATH, que e exatamente como o server MCP vai rodar.
  if (pyOk) {
    const envPy = withSdkPath(settings, Object.assign({}, process.env));
    // ATENCAO: nao da pra confiar no exit code de `import pyrfc`. O __init__.py do
    // pyrfc envolve o import da extensao num try/except que faz `print(ex)` e
    // SEGUE -- entao com a sapnwrfc.dll faltando o import "da certo" (codigo 0) e
    // ate o __version__ responde, porque ele vem do dist-info. O unico teste
    // honesto e perguntar se a extensao exportou mesmo alguma coisa.
    const probe = 'import pyrfc,sys;'
                + 'ok=hasattr(pyrfc,"Connection");'
                + 'print(("carregado " if ok else "NAO carregou ")+getattr(pyrfc,"__version__","?"));'
                + 'sys.exit(0 if ok else 1)';
    r = spawnSync(python, ['-c', probe], { timeout: 30000, encoding: 'utf8', env: envPy });
    const saida = String((r.stdout || '') + (r.stderr || '')).trim();
    const carregou = !r.error && r.status === 0;
    // falhou por causa da DLL do SDK? entao a dica util e a do SDK, nao a de instalar pyrfc
    const porCausaDaDll = /dll load failed|cannot open shared object|_cyrfc/i.test(saida);
    push('pyrfc', carregou, saida.split(/\r?\n/).slice(-3).join(' / '),
         (!carregou && porCausaDaDll) ? 'diag.pyrfc.hintSdk' : undefined);
  } else {
    push('pyrfc', false, '');
  }

  // 5. vsp: o bridge nao serve pra nada sem o cliente ADT
  push('vsp', !!(settings.vsp_path && fs.existsSync(settings.vsp_path)), settings.vsp_path || '');

  return { ok: checks.every(c => c.ok), checks, bridgeDir: BRIDGE_DIR };
});

// Teste de conexao ("ping") de um ambiente - Cloud, On-Premise ou RFC.
// Faz uma busca ADT leve (search) pelo profile, que valida TLS + auth + ADT.
//
// Nas conexoes RFC o teste tem DOIS estagios, de proposito: o selftest do bridge
// isola o trecho RFC (SDK/pyrfc/router/credencial/FM) e da mensagem clara, e so
// depois o vsp roda por cima do bridge. Sem isso, qualquer falha do lado RFC
// chegaria disfarcada de "vsp nao conectou".
// ---------------------------------------------------------------------------

// Roda `vsp -s <id> search CLAS --max 1` e classifica o resultado.
function runVspSearch(settings, projectPath, id, childEnv) {
  return new Promise((resolve) => {
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
      } else if (/adt-rfc bridge error|connection refused|econnrefused/.test(low)) {
        finish({ ok: false, key: 'be.testBridgeDown', args: [id], log: out });
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

    setTimeout(() => {
      try { proc.kill(); } catch (e) {}
      finish({ ok: false, key: 'be.testFail', args: [id], log: out });
    }, 45000);
  });
}

// Ambiente de processo pra rodar Python do bridge (RFC_* + lib do SDK no PATH).
function bridgeChildEnv(settings, env) {
  return withSdkPath(settings, Object.assign({}, process.env, bridgeEnvFor(settings, env)));
}

ipcMain.handle('vsp:test', async (_evt, payload) => {
  const { settings, env } = payload;
  const projectPath = folderOfEnv(env);
  const id = envIdOf(env);
  if (!projectPath) return { ok: false, key: 'be.noFolderForConn' };
  if (!fs.existsSync(settings.vsp_path)) {
    return { ok: false, key: 'be.vspNotFound', args: [settings.vsp_path] };
  }
  fs.mkdirSync(projectPath, { recursive: true });

  // Pre-checagens de credencial pra dar mensagem clara.
  if (env.auth_type === 'cloud') {
    const ck = cookieStatusOf(projectPath, env);
    // separa "nunca logou" de "logou mas venceu": a acao e a mesma, mas o
    // segundo caso confunde bem mais sem a mensagem certa
    if (ck.state === 'expired') {
      purgeCookie(projectPath, env); // nao serve mais: sai da frente
      return { ok: false, key: 'be.testCookieExpired', args: [id] };
    }
    if (ck.state !== 'valid') return { ok: false, key: 'be.testNoCookie', args: [id] };
  }
  if (env.auth_type !== 'cloud' && !env.password) {
    return { ok: false, key: 'be.testNoPassword', args: [id] };
  }
  if (env.auth_type === 'rfc' && !env.ashost) {
    return { ok: false, key: 'be.testNoAshost', args: [id] };
  }

  // Garante que o .vsp.json tem este sistema (o subcomando `-s` le dele).
  const vspFile = path.join(projectPath, '.vsp.json');
  const vspJson = readJson(vspFile, { systems: {} });
  if (!vspJson.systems) vspJson.systems = {};
  vspJson.systems[id] = buildSystemEntry(projectPath, env);
  if (!vspJson.default) vspJson.default = id;
  writeJson(vspFile, vspJson);

  // On-prem/RFC precisam da senha no ambiente do processo.
  const childEnv = Object.assign({}, process.env);
  if (env.auth_type !== 'cloud' && env.password) {
    for (const v of passwordVarsOf(id)) childEnv[v] = env.password;
  }

  if (env.auth_type !== 'rfc') {
    return runVspSearch(settings, projectPath, id, childEnv);
  }

  // ---------------- RFC: selftest do bridge, depois o vsp por cima ----------
  if (!ensureBridgeFiles()) return { ok: false, key: 'be.bridgeScriptsFail' };
  const python = resolvePython(settings);
  const rfcEnv = bridgeChildEnv(settings, env);

  const st = spawnSync(python, [BRIDGE_SCRIPT, 'selftest'], {
    env: rfcEnv, timeout: 90000, encoding: 'utf8'
  });
  const stLog = String((st.stdout || '') + (st.stderr || ''));
  if (st.error && st.error.code === 'ENOENT') {
    return { ok: false, key: 'be.bridgeNoPython', args: [python] };
  }
  if (!/SELFTEST status:\s*200/.test(stLog)) {
    const low = stLog.toLowerCase();
    // Tres causas bem diferentes, que antes caiam todas na mesma mensagem.
    // Desde que o app passou a embutir Python + pyrfc, "pyrfc faltando" so
    // acontece se o usuario apontou um Python proprio -- o caso comum agora e a
    // DLL do SDK, que NAO pode vir junto no instalador.
    let key = 'be.testRfcSelftest';
    if (/dll load failed|cannot open shared object|onerror.*sapnwrfc/.test(low)) key = 'be.bridgeNoSdk';
    else if (/no module named .?pyrfc/.test(low)) key = 'be.bridgeNoPyrfc';
    return { ok: false, key, args: [id], log: stLog };
  }

  // Sobe um bridge SO pra este teste, numa porta livre qualquer, pra nao brigar
  // com o bridge que o host MCP possa ter deixado no ar na porta oficial.
  const porta = await freePort();
  const testEnv = Object.assign({}, rfcEnv, { BRIDGE_PORT: String(porta) });
  let bridge;
  try {
    bridge = spawn(python, [BRIDGE_SCRIPT], { env: testEnv, stdio: 'ignore' });
    // Obrigatorio: 'error' sem listener num ChildProcess VIRA EXCECAO e derruba o
    // main do Electron. Quem reporta a falha e o waitForPort abaixo.
    bridge.on('error', () => {});
  } catch (e) {
    return { ok: false, key: 'be.bridgeStartFail', args: [e.message], log: stLog };
  }
  try {
    if (!await waitForPort(porta, 15000)) {
      return { ok: false, key: 'be.bridgeStartFail', args: ['timeout'], log: stLog };
    }
    // o .vsp.json aponta pra porta oficial; pro teste, reescreve com a porta temporaria
    vspJson.systems[id] = buildSystemEntry(projectPath, Object.assign({}, env, { bridge_port: porta }));
    writeJson(vspFile, vspJson);
    const res = await runVspSearch(settings, projectPath, id, childEnv);
    return Object.assign({}, res, { log: stLog + '\n' + (res.log || '') });
  } finally {
    try { bridge.kill(); } catch (e) { /* ja morreu */ }
    // devolve o .vsp.json pra porta oficial da conexao
    try {
      vspJson.systems[id] = buildSystemEntry(projectPath, env);
      writeJson(vspFile, vspJson);
    } catch (e) { /* pasta sumiu no meio: nao ha o que restaurar */ }
  }
});


// Abrir a pasta do projeto no VSCode
// ---------------------------------------------------------------------------
// Abrir o projeto em VSCode / Claude Code / Codex
//
// A diferenca importante: o VSCode ABRE UMA PASTA (`code <pasta>`), enquanto
// Claude Code e Codex sao CLIs — nelas nao existe "abrir a pasta", o que existe
// e RODAR a ferramenta com o cwd na pasta. Por isso as duas sobem num terminal
// novo, e o VSCode nao.
// ---------------------------------------------------------------------------
// Deep links dos apps desktop. Ambos abrem uma sessao nova ja apontando pra
// pasta, sem passar por terminal nenhum:
//   Claude: claude://code/new?folder=<caminho absoluto url-encoded>
//   Codex : codex://new?path=<caminho absoluto url-encoded>
// Diferenca que vale saber: o Claude PEDE confirmacao da pasta antes de usar;
// o Codex abre direto.
function claudeCodeUrl(dir) {
  return 'claude://code/new?folder=' + encodeURIComponent(path.resolve(dir));
}
function codexUrl(dir) {
  return 'codex://new?path=' + encodeURIComponent(path.resolve(dir));
}

// mode:
//   folder   -> passa a pasta como argumento (`code <pasta>`)
//   deeplink -> abre o app desktop pelo protocolo dele
const OPEN_TARGETS = {
  vscode: { mode: 'folder',   setting: 'vscode_cmd', fallback: 'code', key: 'be.openedVscode', label: 'VSCode' },
  claude: { mode: 'deeplink', url: claudeCodeUrl, notFound: 'be.openNoClaudeApp', key: 'be.openedClaude', label: 'Claude Code' },
  codex:  { mode: 'deeplink', url: codexUrl,      notFound: 'be.openNoCodexApp',  key: 'be.openedCodex',  label: 'Codex' }
};

// Caminho explicito -> confere no disco. Nome solto -> procura no PATH.
// Devolve null quando nao existe, pra UI poder mandar o usuario configurar.
function resolveCommand(value) {
  const v = String(value || '').trim();
  if (!v) return null;
  if (/[\\/]/.test(v)) return fs.existsSync(v) ? v : null;
  try {
    const r = spawnSync('where', [v], { timeout: 5000 });
    if (r.status === 0) return v;
  } catch (e) { /* where indisponivel: cai no null */ }
  return null;
}

ipcMain.handle('open:in', (_evt, payload) => {
  return new Promise((resolve) => {
    const { settings, target } = payload || {};
    const spec = OPEN_TARGETS[target];
    if (!spec) { resolve({ ok: false, key: 'be.openUnknown', args: [String(target)] }); return; }

    // a pasta vem sempre da conexao
    const projectPath = payload && payload.projectPath;
    if (!projectPath || !fs.existsSync(projectPath)) {
      resolve({ ok: false, key: 'be.vscodeNoFolder' });
      return;
    }

    // Claude Code e Codex nao sao CLI aqui: sao os apps desktop, abertos pelo
    // protocolo deles.
    if (spec.mode === 'deeplink') {
      shell.openExternal(spec.url(projectPath)).then(
        () => resolve({ ok: true, key: spec.key, args: [projectPath] }),
        // cai aqui quando o protocolo nao esta registrado (app nao instalado)
        (e) => resolve({ ok: false, key: spec.notFound, args: [String((e && e.message) || e)] })
      );
      return;
    }

    const wanted = settings[spec.setting] || spec.fallback;
    const cmd = resolveCommand(wanted);
    if (!cmd) {
      resolve({ ok: false, key: 'be.openNotFound', args: [wanted, spec.label] });
      return;
    }

    let proc;
    try {
      // shell:true porque "code" no Windows e um .cmd
      proc = spawn(cmd, [projectPath], { cwd: projectPath, shell: true, detached: true, stdio: 'ignore' });
    } catch (e) {
      resolve({ ok: false, key: 'be.openFail', args: [e.message] });
      return;
    }
    proc.on('error', e => resolve({ ok: false, key: 'be.openFail', args: [e.message] }));
    proc.unref(); // nao espera fechar
    setTimeout(() => resolve({ ok: true, key: spec.key, args: [projectPath] }), 400);
  });
});

// Abrir uma pasta no Explorer (usada pelo atalho da pasta do cliente)
ipcMain.handle('folder:open', (_evt, payload) => {
  const dir = (payload && payload.folder) || '';
  if (dir && fs.existsSync(dir)) {
    shell.openPath(dir);
    return { ok: true };
  }
  return { ok: false, key: 'be.folderMissing' };
});
