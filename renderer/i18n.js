'use strict';

// ---------------------------------------------------------------------------
// i18n simples: dicionario en/pt + helpers. Aplica nos elementos com
// data-i18n (textContent), data-i18n-html (innerHTML), data-i18n-ph
// (placeholder) e data-i18n-title (title). Strings dinamicas usam t(key, ...args).
//
// IIFE: mantem I18N/t/applyI18n/setLang/getLang PRIVADOS. Sem isso, como i18n.js e
// app.js sao scripts classicos no mesmo escopo global, o `function t` daqui colide
// com o `const t` do app.js (SyntaxError -> app.js inteiro nao carrega). So `window.i18n` vaza.
// ---------------------------------------------------------------------------
(function () {

const I18N = {
  en: {
    'sub': 'SAP environments · vsp · Claude Code / Codex',


    'settings.title': 'Settings',
    'btn.openIn': 'Open in',
    'mcp.enable': 'Enable MCP',
    'mcp.enable.title': 'Makes this connection visible to Claude Code / Codex.',
    'mcp.global': 'Global',
    'mcp.local': 'Local',
    'mcp.clickDisable': 'click to disable',
    'mcp.noFolder': '(no folder yet)',
    'mcp.global.desc': 'Registers it in <code>~/.claude.json</code> and in the Codex global config. Works in <b>any folder</b>, in <b>both</b> Claude Code and Codex.',
    'mcp.local.desc': 'Writes <code>.mcp.json</code> into <code>{0}</code>, together with every other connection that shares this folder. Works <b>only inside that folder</b>, and <b>only in Claude Code</b> — Codex reads MCP from its global config only.',
    'be.localEnabled': 'MCP enabled in {0} ({1} connection(s)).',
    'be.localDisabled': 'MCP disabled in {0} (.mcp.json removed).',
    'be.localNotThere': 'No .mcp.json in {0}.',
    'be.noFolderForConn': 'This connection has no workspace folder yet. Set one on the client in the sidebar.',
    'confirm.localRemove': 'Remove .mcp.json from {0}? The other files (CLAUDE.md, .env, .vsp.json) stay.',
    'settings.folders.hint': 'The workspace folder is set <b>per client</b>, in the sidebar — there is no single project folder anymore.',
    'settings.vsp': 'Path to vsp.exe',
    'browse': 'Browse…',
    'settings.chrome': 'Chrome path (browser-auth)',
    'settings.vscode': 'VSCode command',
    'settings.vscode.hint': "Command that opens VSCode. Leave <code>code</code> if it's on PATH; otherwise point to <code>Code.exe</code>.",
    'settings.codex': 'Codex command',
    'settings.codex.hint': 'Codex is a CLI: <b>Open in</b> starts it in a new terminal at the project folder. Leave <code>codex</code> if it is on PATH, or point to the full path. <b>Claude Code</b> needs no command — it opens the desktop app.',
    'settings.save': 'Save settings',
    'settings.save.title': "Saves only these app preferences (paths + command). Does NOT generate the project files — use 'Generate configs' for that.",

    'nav.conns': 'Connections',
    'nav.settings': 'Settings',

    'envs.title': 'Connections',
    'envs.new': '+ Connection',
    'envs.newGroup': '+ Client',
    'envs.newGroup.title': 'Creates an empty client folder so you can add connections to it.',
    'envs.import': 'Import',
    'envs.import.title': 'Reads the SAP GUI system list (SAPUILandscape.xml) and prefills a connection from it.',
    'envs.search': 'Filter…',
    'envs.empty': 'No connection yet. Click <b>+ Connection</b>.',
    'envs.noMatch': 'Nothing matches your search.',
    'envs.noClient': '(no client)',
    'envs.addTo': 'New connection in {0}',
    'envs.collapseAll': 'Collapse all clients',
    'envs.onlyGlobal': 'Only enabled',
    'envs.expandAll': 'Expand all clients',

    'conn.none': 'Pick a connection on the left, or create one with <b>+ Connection</b>.',
    'detail.flags': 'Flags',
    'detail.noFolder': 'not set yet',

    'group.newTitle': 'New client',
    'group.newLabel': 'Client name (becomes a folder in the sidebar):',
    'group.dup': 'Client "{0}" already exists.',
    'group.created': 'Client "{0}" created. Use + on the folder to add a connection.',
    'group.createdWithFolder': 'Client "{0}" created at {1}.',
    'group.folderIs': 'Workspace folder: {0} — click to change.',
    'group.folderNone': 'No workspace folder — click to pick one.',

    'import.title': 'Import from SAP GUI',
    'import.search': 'Filter systems…',
    'import.loading': 'Reading the SAP GUI system list…',
    'import.source': '{0} — {1} system(s). Pick one to prefill a new connection.',
    'import.noUrl': 'no URL',
    'import.check': 'Derived from the SAP GUI port {0}: {1}. Confirm the URL and fill in the SAP client.',
    'import.noPort': 'Could not derive the HTTP port from {0} — type the URL by hand.',

    'status.ready': 'Ready.',
    'log.view': 'View log',

    'modal.new': 'New connection',
    'modal.edit': 'Edit connection',
    'f.client': 'Client *',
    'f.env': 'Environment *',
    'f.folder': 'Workspace folder',
    'f.folder.ph': 'C:/Users/You/Projects/client',
    'f.folder.hint': 'The folder belongs to the <b>client</b>, not to this single connection.',
    'f.folder.shared': 'The folder belongs to the client <b>{0}</b> — changing it here also changes it for its other {1} connection(s).',
    'f.auth': 'Authentication type',
    'auth.onprem': 'Private',
    'auth.cloud': 'Public',
    'f.url': 'URL *',
    'f.sapclient': 'SAP client *',
    'f.user': 'SAP user *',
    'f.pass': 'Password',
    'f.insecure': 'Self-signed certificate server (--insecure)',
    'f.insecure.hint': 'Most private servers use a self-signed certificate — keep this on unless you know the cert is valid.',
    'f.mode': 'Mode',
    'f.mode.hint': 'focused covers read/search. To create/edit objects (LockObject/UpdateSource flow), pick expert.',
    'f.lang': 'Language (optional)',
    'f.readonly': 'Read-only (blocks writes)',
    'f.transpedit': 'Allow transportable edits',
    'f.transp': 'Enable transports',
    'modal.cancel': 'Cancel',
    'modal.save': 'Save connection',
    'log.title': 'Log',

    'card.login': 'SSO Login',
    'card.loginOk': '✓ Logged in',
    'card.logging': 'Logging in…',
    'card.test': 'Test',
    'card.testing': 'Testing…',
    'card.edit': 'Edit',
    'card.duplicate': 'Duplicate',
    'card.globalBadge': 'Global: registered in ~/.claude.json — works in any folder.',
    'card.localBadge': 'Local: .mcp.json in {0} — works inside that folder only.',
    'card.openInDir': 'Opens {0}',
    'card.openInAsk': 'No folder set for {0} yet — you will be asked to pick one.',
    'card.copySuffix': 'copy',
    'card.remove': 'Remove',
    'tag.cloud': 'Public',
    'tag.onprem': 'Private',
    'tag.ro': 'RO',
    'meta.client': 'client',

    'dlg.ok': 'OK',
    'dlg.cancel': 'Cancel',
    'dlg.attention': 'Attention',
    'dlg.confirm': 'Confirm',

    'msg.settingsSaved': 'Settings saved.',
    'msg.envRemoved': 'Connection removed.',
    'confirm.remove': 'Remove the connection "{0}"?',
    'alert.required': 'Fill in Client, Environment, URL and SAP client.',
    'alert.onpremUser': 'Private requires a SAP user.',
    'alert.dup': 'A connection with the same identifier "{0}" already exists. Change the client or environment name.',
    'msg.envSaved': 'Connection "{0}" saved.',
    'err.noEnvs': 'Register at least one connection.',
    'msg.vspKilled': '{0} stale vsp process(es) stopped — restart the MCP host.',
    'msg.vspKilledSome': 'Stale vsp processes stopped — restart the MCP host.',
    'msg.openingIn': 'Opening {0} at {1}…',
    'msg.folderSet': 'Folder for {0}: {1}',
    'msg.folderNeeded': 'Pick a folder for {0} to open it.',
    'msg.loginStart': 'SSO login for {0} — finish in the browser…',

    'be.genError': 'Error generating configs: {0}',
    'be.vspNotFound': 'vsp.exe not found: {0}',
    'be.vspStartFail': 'Failed to start vsp: {0}',
    'be.loginOk': 'Login OK — cookie saved ({0}).',
    'be.loginFail': 'Login failed (exit {0}). Check the log.',
    'be.error': 'Error: {0}',
    'be.loginTimeout': 'Login timed out (5 min). Try again.',
    'be.vscodeNoFolder': 'Project folder does not exist. Generate the configs first.',
    'be.openFail': 'Failed to open: {0}',
    'be.openUnknown': 'Unknown target: {0}.',
    'be.openNotFound': '"{0}" not found on PATH. Install the {1} CLI, or set its full path in Settings.',
    'be.openedClaude': 'Claude opened on the Code tab at {0} — confirm the folder in the app.',
    'be.openNoClaudeApp': 'Could not open the Claude desktop app. Is it installed? ({0})',
    'be.openedCodex': 'Codex started in a terminal at {0}.',
    'be.openedVscode': 'VSCode opened at {0}.',
    'be.folderMissing': 'Folder does not exist.',
    'be.testOk': 'Connection OK to {0}.',
    'be.testTls': '{0}: invalid/expired TLS certificate. Enable --insecure on the environment.',
    'be.testForbidden': '{0}: 403 — reachable, but ADT is not active in SICF (SAP side).',
    'be.testAuth': '{0}: authentication failed (password/cookie).',
    'be.testNoCookie': '{0}: no SSO cookie yet — run SSO Login first.',
    'be.testNoPassword': '{0}: no password set for this Private connection.',
    'be.testFail': '{0}: connection test failed. See the log.',
    'be.updateDevMode': 'Auto-update only works in the installed app (not when running from source).',
    'be.globalAdded': '{0} registered globally in {1}.',
    'be.globalRemoved': '{0} removed from the global config ({1}).',
    'be.globalNotThere': '{0} is not in the global config.',
    'confirm.globalRemove': 'Remove "{0}" from Claude Code\'s global scope? It stops working outside the project folder.',
    'be.globalUpdated': '{0} updated in the global config ({1}).',
    'be.globalNoEnv': 'No connection selected.',
    'be.globalBadJson': '{0} is not valid JSON — nothing was written. Fix the file first.',
    'be.globalFail': 'Failed to write the global config: {0}',
    'be.landscapeMissing': 'SAP GUI system list not found at {0}. Is SAP GUI for Windows installed for this user?',
    'be.landscapeEmpty': 'No system found in {0}.',
    'be.landscapeError': 'Failed to read the SAP GUI system list: {0}',
    'msg.duplicating': 'Duplicating {0} — adjust what you need and save.',

    'update.checking': 'Checking for updates…',
    'update.downloading': 'Downloading {0} — {1}%',
    'update.ready': 'Version {0} ready to install.',
    'update.error': 'Update check failed — you are still on the current version.',
    'update.restart': 'Restart now',
    'update.checkNow': 'Click to check for updates',

    'pick.vsp': 'Select vsp.exe',
    'pick.browser': 'Select browser',
    'pick.clientFolder': 'Select the workspace folder for {0}',
    'file.exe': 'Executable',
    'file.all': 'All'
  },

  pt: {
    'sub': 'Ambientes SAP · vsp · Claude Code / Codex',


    'settings.title': 'Configurações',
    'btn.openIn': 'Abrir em',
    'mcp.enable': 'Habilitar MCP',
    'mcp.enable.title': 'Faz esta conexão aparecer no Claude Code / Codex.',
    'mcp.global': 'Global',
    'mcp.local': 'Local',
    'mcp.clickDisable': 'clique pra desabilitar',
    'mcp.noFolder': '(sem pasta ainda)',
    'mcp.global.desc': 'Registra no <code>~/.claude.json</code> e na config global do Codex. Vale em <b>qualquer pasta</b>, nos <b>dois</b> — Claude Code e Codex.',
    'mcp.local.desc': 'Grava o <code>.mcp.json</code> em <code>{0}</code>, junto com todas as outras conexões que dividem essa pasta. Vale <b>só dentro dela</b>, e <b>só no Claude Code</b> — o Codex lê MCP apenas da config global dele.',
    'be.localEnabled': 'MCP habilitado em {0} ({1} conexão(ões)).',
    'be.localDisabled': 'MCP desabilitado em {0} (.mcp.json removido).',
    'be.localNotThere': 'Nenhum .mcp.json em {0}.',
    'be.noFolderForConn': 'Esta conexão ainda não tem pasta de workspace. Defina uma no cliente, na barra lateral.',
    'confirm.localRemove': 'Remover o .mcp.json de {0}? Os outros arquivos (CLAUDE.md, .env, .vsp.json) ficam.',
    'settings.folders.hint': 'A pasta do workspace é definida <b>por cliente</b>, na barra lateral — não existe mais uma pasta única de projeto.',
    'settings.vsp': 'Caminho do vsp.exe',
    'browse': 'Procurar…',
    'settings.chrome': 'Caminho do Chrome (browser-auth)',
    'settings.vscode': 'Comando do VSCode',
    'settings.vscode.hint': 'Comando que abre o VSCode. Deixe <code>code</code> se ele está no PATH; senão aponte pro <code>Code.exe</code>.',
    'settings.codex': 'Comando do Codex',
    'settings.codex.hint': 'Codex é uma CLI: o <b>Abrir em</b> sobe ele num terminal novo já na pasta do projeto. Deixe <code>codex</code> se estiver no PATH, ou aponte o caminho completo. O <b>Claude Code</b> não precisa de comando — ele abre o app desktop.',
    'settings.save': 'Salvar configurações',
    'settings.save.title': "Salva apenas estas preferências do app (caminhos + comando). NÃO gera os arquivos do projeto — pra isso use 'Gerar configs'.",

    'nav.conns': 'Conexões',
    'nav.settings': 'Configurações',

    'envs.title': 'Conexões',
    'envs.new': '+ Conexão',
    'envs.newGroup': '+ Cliente',
    'envs.newGroup.title': 'Cria uma pasta de cliente vazia, pra você pendurar conexões nela.',
    'envs.import': 'Importar',
    'envs.import.title': 'Lê a lista de sistemas do SAP GUI (SAPUILandscape.xml) e pré-preenche uma conexão a partir dela.',
    'envs.search': 'Filtrar…',
    'envs.empty': 'Nenhuma conexão ainda. Clique em <b>+ Conexão</b>.',
    'envs.noMatch': 'Nada corresponde à busca.',
    'envs.noClient': '(sem cliente)',
    'envs.addTo': 'Nova conexão em {0}',
    'envs.collapseAll': 'Recolher todos os clientes',
    'envs.onlyGlobal': 'Só habilitadas',
    'envs.expandAll': 'Expandir todos os clientes',

    'conn.none': 'Escolha uma conexão à esquerda, ou crie uma em <b>+ Conexão</b>.',
    'detail.flags': 'Flags',
    'detail.noFolder': 'ainda não definida',

    'group.newTitle': 'Novo cliente',
    'group.newLabel': 'Nome do cliente (vira uma pasta na barra lateral):',
    'group.dup': 'O cliente "{0}" já existe.',
    'group.created': 'Cliente "{0}" criado. Use o + na pasta pra adicionar uma conexão.',
    'group.createdWithFolder': 'Cliente "{0}" criado em {1}.',
    'group.folderIs': 'Pasta do workspace: {0} — clique pra trocar.',
    'group.folderNone': 'Sem pasta de workspace — clique pra escolher.',

    'import.title': 'Importar do SAP GUI',
    'import.search': 'Filtrar sistemas…',
    'import.loading': 'Lendo a lista de sistemas do SAP GUI…',
    'import.source': '{0} — {1} sistema(s). Escolha um pra pré-preencher uma conexão nova.',
    'import.noUrl': 'sem URL',
    'import.check': 'Derivada da porta do SAP GUI {0}: {1}. Confirme a URL e preencha o client SAP.',
    'import.noPort': 'Não deu pra derivar a porta HTTP de {0} — digite a URL na mão.',

    'status.ready': 'Pronto.',
    'log.view': 'Ver log',

    'modal.new': 'Nova conexão',
    'modal.edit': 'Editar conexão',
    'f.client': 'Cliente *',
    'f.env': 'Ambiente *',
    'f.folder': 'Pasta do workspace',
    'f.folder.ph': 'C:/Users/Voce/Projects/cliente',
    'f.folder.hint': 'A pasta pertence ao <b>cliente</b>, não só a esta conexão.',
    'f.folder.shared': 'A pasta pertence ao cliente <b>{0}</b> — mudar aqui muda também para as outras {1} conexão(ões) dele.',
    'f.auth': 'Tipo de autenticação',
    'auth.onprem': 'Private',
    'auth.cloud': 'Public',
    'f.url': 'URL *',
    'f.sapclient': 'Client SAP *',
    'f.user': 'Usuário SAP *',
    'f.pass': 'Senha',
    'f.insecure': 'Servidor com certificado self-signed (--insecure)',
    'f.insecure.hint': 'A maioria dos servidores private usa certificado self-signed — deixe ligado, a menos que saiba que o cert é válido.',
    'f.mode': 'Mode',
    'f.mode.hint': 'focused cobre leitura/busca. Para criar/editar objeto (fluxo LockObject/UpdateSource), escolha expert.',
    'f.lang': 'Idioma (opcional)',
    'f.readonly': 'Read-only (bloqueia escrita)',
    'f.transpedit': 'Permitir edits transportáveis',
    'f.transp': 'Habilitar transports',
    'modal.cancel': 'Cancelar',
    'modal.save': 'Salvar conexão',
    'log.title': 'Log',

    'card.login': 'Login SSO',
    'card.loginOk': '✓ Login OK',
    'card.logging': 'Logando…',
    'card.test': 'Testar',
    'card.testing': 'Testando…',
    'card.edit': 'Editar',
    'card.duplicate': 'Duplicar',
    'card.globalBadge': 'Global: registrada no ~/.claude.json — vale em qualquer pasta.',
    'card.localBadge': 'Local: .mcp.json em {0} — vale só dentro dessa pasta.',
    'card.openInDir': 'Abre {0}',
    'card.openInAsk': 'Sem pasta definida para {0} ainda — vai pedir na hora.',
    'card.copySuffix': 'cópia',
    'card.remove': 'Remover',
    'tag.cloud': 'Public',
    'tag.onprem': 'Private',
    'tag.ro': 'RO',
    'meta.client': 'client',

    'dlg.ok': 'OK',
    'dlg.cancel': 'Cancelar',
    'dlg.attention': 'Atenção',
    'dlg.confirm': 'Confirmar',

    'msg.settingsSaved': 'Configurações salvas.',
    'msg.envRemoved': 'Conexão removida.',
    'confirm.remove': 'Remover a conexão "{0}"?',
    'alert.required': 'Preencha Cliente, Ambiente, URL e Client SAP.',
    'alert.onpremUser': 'Private exige Usuário SAP.',
    'alert.dup': 'Já existe uma conexão com o mesmo identificador "{0}". Mude o nome do cliente ou do ambiente.',
    'msg.envSaved': 'Conexão "{0}" salva.',
    'err.noEnvs': 'Cadastre ao menos uma conexão.',
    'msg.vspKilled': '{0} processo(s) vsp antigo(s) encerrado(s) — reinicie o host MCP.',
    'msg.vspKilledSome': 'Processos vsp antigos encerrados — reinicie o host MCP.',
    'msg.openingIn': 'Abrindo {0} em {1}…',
    'msg.folderSet': 'Pasta de {0}: {1}',
    'msg.folderNeeded': 'Escolha uma pasta para {0} para poder abrir.',
    'msg.loginStart': 'Login SSO de {0} — conclua no navegador…',

    'be.genError': 'Erro ao gerar configs: {0}',
    'be.vspNotFound': 'vsp.exe não encontrado: {0}',
    'be.vspStartFail': 'Falha ao iniciar vsp: {0}',
    'be.loginOk': 'Login OK — cookie salvo ({0}).',
    'be.loginFail': 'Login falhou (exit {0}). Veja o log.',
    'be.error': 'Erro: {0}',
    'be.loginTimeout': 'Login expirou (timeout 5 min). Tente de novo.',
    'be.vscodeNoFolder': 'Pasta do projeto não existe. Gere as configs primeiro.',
    'be.openFail': 'Falha ao abrir: {0}',
    'be.openUnknown': 'Destino desconhecido: {0}.',
    'be.openNotFound': '"{0}" não encontrado no PATH. Instale a CLI do {1}, ou aponte o caminho completo em Configurações.',
    'be.openedClaude': 'Claude aberto na aba Code em {0} — confirme a pasta no app.',
    'be.openNoClaudeApp': 'Não deu pra abrir o app desktop do Claude. Ele está instalado? ({0})',
    'be.openedCodex': 'Codex iniciado num terminal em {0}.',
    'be.openedVscode': 'VSCode aberto em {0}.',
    'be.folderMissing': 'Pasta não existe.',
    'be.testOk': 'Conexão OK com {0}.',
    'be.testTls': '{0}: certificado TLS inválido/expirado. Marque --insecure no ambiente.',
    'be.testForbidden': '{0}: 403 — alcançável, mas ADT não está ativo na SICF (lado SAP).',
    'be.testAuth': '{0}: falha de autenticação (senha/cookie).',
    'be.testNoCookie': '{0}: sem cookie SSO ainda — faça o Login SSO primeiro.',
    'be.testNoPassword': '{0}: sem senha definida para esta conexão Private.',
    'be.testFail': '{0}: teste de conexão falhou. Veja o log.',
    'be.updateDevMode': 'Auto-update só funciona no app instalado (não rodando pelo código-fonte).',
    'be.globalAdded': '{0} registrado globalmente em {1}.',
    'be.globalRemoved': '{0} removido da config global ({1}).',
    'be.globalNotThere': '{0} não está na config global.',
    'confirm.globalRemove': 'Remover "{0}" do escopo global do Claude Code? Ela deixa de funcionar fora da pasta do projeto.',
    'be.globalUpdated': '{0} atualizado na config global ({1}).',
    'be.globalNoEnv': 'Nenhuma conexão selecionada.',
    'be.globalBadJson': '{0} não é JSON válido — nada foi gravado. Corrija o arquivo antes.',
    'be.globalFail': 'Falha ao gravar a config global: {0}',
    'be.landscapeMissing': 'Lista de sistemas do SAP GUI não encontrada em {0}. O SAP GUI for Windows está instalado neste usuário?',
    'be.landscapeEmpty': 'Nenhum sistema encontrado em {0}.',
    'be.landscapeError': 'Falha ao ler a lista de sistemas do SAP GUI: {0}',
    'msg.duplicating': 'Duplicando {0} — ajuste o que precisar e salve.',

    'update.checking': 'Procurando atualizações…',
    'update.downloading': 'Baixando {0} — {1}%',
    'update.ready': 'Versão {0} pronta pra instalar.',
    'update.error': 'Falha ao checar atualização — você segue na versão atual.',
    'update.restart': 'Reiniciar agora',
    'update.checkNow': 'Clique pra checar atualizações',

    'pick.vsp': 'Selecionar vsp.exe',
    'pick.browser': 'Selecionar navegador',
    'pick.clientFolder': 'Selecionar a pasta de workspace de {0}',
    'file.exe': 'Executável',
    'file.all': 'Todos'
  }
};

let currentLang = 'en';

function t(key) {
  const dict = I18N[currentLang] || I18N.en;
  let s = dict[key];
  if (s == null) s = (I18N.en[key] != null ? I18N.en[key] : key);
  // substitui {0}, {1}, ... pelos argumentos extras
  for (let i = 1; i < arguments.length; i++) {
    s = s.replace('{' + (i - 1) + '}', arguments[i]);
  }
  return s;
}

function applyI18n() {
  document.documentElement.lang = currentLang === 'pt' ? 'pt-BR' : 'en';
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    el.innerHTML = t(el.getAttribute('data-i18n-html'));
  });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => {
    el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph')));
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
  });
  // reflete a bandeira selecionada
  document.querySelectorAll('.flag').forEach(f => {
    f.classList.toggle('active', f.getAttribute('data-lang') === currentLang);
  });
}

function setLang(lang) {
  currentLang = (lang === 'pt') ? 'pt' : 'en';
  applyI18n();
}
function getLang() { return currentLang; }

window.i18n = { t, applyI18n, setLang, getLang };

})();
