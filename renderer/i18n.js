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

    'btn.generate': 'Generate configs',
    'btn.generate.title': 'Writes the config files into the project folder: .vsp.json, .mcp.json (Claude), codex.toml (Codex), .env, CLAUDE.md, AGENTS.md and .gitignore.',
    'btn.vscode': 'Open in VSCode',
    'btn.vscode.title': 'Opens the project folder in VSCode (uses the command set in Settings). Ready to run Claude Code.',
    'btn.folder': 'Open folder',
    'btn.folder.title': 'Opens the project folder in Windows Explorer.',

    'settings.title': 'Settings',
    'settings.vsp': 'Path to vsp.exe',
    'browse': 'Browse…',
    'settings.project': 'Project folder (single workspace)',
    'settings.project.ph': 'e.g.: C:/Users/YourUser/Projects/sap-workspace',
    'settings.project.hint': 'Folder where the config files will be generated. Use <b>Browse…</b> or type the path.',
    'settings.chrome': 'Chrome path (browser-auth)',
    'settings.vscode': 'VSCode command',
    'settings.vscode.hint': "Command that opens VSCode. Leave <code>code</code> if it's on PATH; otherwise point to <code>Code.exe</code>.",
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
    'envs.expandAll': 'Expand all clients',

    'conn.none': 'Pick a connection on the left, or create one with <b>+ Connection</b>.',
    'detail.flags': 'Flags',

    'group.newTitle': 'New client',
    'group.newLabel': 'Client name (becomes a folder in the sidebar):',
    'group.dup': 'Client "{0}" already exists.',
    'group.created': 'Client "{0}" created. Use + on the folder to add a connection.',

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
    'f.auth': 'Authentication type',
    'auth.onprem': 'On-Premise (basic auth)',
    'auth.cloud': 'Cloud (SSO SAML / cookie)',
    'f.url': 'URL *',
    'f.sapclient': 'SAP client *',
    'f.user': 'SAP user *',
    'f.pass': 'Password',
    'f.insecure': 'Self-signed certificate server (--insecure)',
    'f.insecure.hint': 'Most on-premise servers use a self-signed certificate — keep this on unless you know the cert is valid.',
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
    'card.copySuffix': 'copy',
    'card.remove': 'Remove',
    'tag.cloud': 'Cloud',
    'tag.onprem': 'On-Prem',
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
    'alert.onpremUser': 'On-Premise requires a SAP user.',
    'alert.dup': 'A connection with the same identifier "{0}" already exists. Change the client or environment name.',
    'msg.envSaved': 'Connection "{0}" saved.',
    'err.noProject': 'Set the project folder.',
    'err.noEnvs': 'Register at least one connection.',
    'msg.generating': 'Generating configs…',
    'msg.vspKilled': '{0} stale vsp process(es) stopped — restart the MCP host.',
    'msg.vspKilledSome': 'Stale vsp processes stopped — restart the MCP host.',
    'msg.openingVscode': 'Opening VSCode…',
    'err.loginNoProject': 'Set the project folder before logging in.',
    'msg.loginStart': 'SSO login for {0} — finish in the browser…',

    'be.noProjectDefined': 'Project folder not set in Settings.',
    'be.configsGenerated': 'Configs generated in {0} ({1} connection(s)).',
    'be.genError': 'Error generating configs: {0}',
    'be.vspNotFound': 'vsp.exe not found: {0}',
    'be.vspStartFail': 'Failed to start vsp: {0}',
    'be.loginOk': 'Login OK — cookie saved ({0}).',
    'be.loginFail': 'Login failed (exit {0}). Check the log.',
    'be.error': 'Error: {0}',
    'be.loginTimeout': 'Login timed out (5 min). Try again.',
    'be.vscodeNoFolder': 'Project folder does not exist. Generate the configs first.',
    'be.vscodeFail': 'Failed to open VSCode: {0}',
    'be.vscodeOpened': 'VSCode opened at {0}.',
    'be.folderMissing': 'Folder does not exist.',
    'be.testOk': 'Connection OK to {0}.',
    'be.testTls': '{0}: invalid/expired TLS certificate. Enable --insecure on the environment.',
    'be.testForbidden': '{0}: 403 — reachable, but ADT is not active in SICF (SAP side).',
    'be.testAuth': '{0}: authentication failed (password/cookie).',
    'be.testNoCookie': '{0}: no SSO cookie yet — run SSO Login first.',
    'be.testNoPassword': '{0}: no password set for this On-Premise environment.',
    'be.testFail': '{0}: connection test failed. See the log.',
    'be.updateDevMode': 'Auto-update only works in the installed app (not when running from source).',
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
    'pick.project': 'Select project folder',
    'file.exe': 'Executable',
    'file.all': 'All'
  },

  pt: {
    'sub': 'Ambientes SAP · vsp · Claude Code / Codex',

    'btn.generate': 'Gerar configs',
    'btn.generate.title': 'Escreve os arquivos de config na pasta do projeto: .vsp.json, .mcp.json (Claude), codex.toml (Codex), .env, CLAUDE.md, AGENTS.md e .gitignore.',
    'btn.vscode': 'Abrir no VSCode',
    'btn.vscode.title': 'Abre a pasta do projeto no VSCode (usa o comando definido em Configurações). Pronto pra rodar o Claude Code.',
    'btn.folder': 'Abrir pasta',
    'btn.folder.title': 'Abre a pasta do projeto no Explorer do Windows.',

    'settings.title': 'Configurações',
    'settings.vsp': 'Caminho do vsp.exe',
    'browse': 'Procurar…',
    'settings.project': 'Pasta do projeto (workspace único)',
    'settings.project.ph': 'ex.: C:/Users/SeuUsuario/Projects/sap-workspace',
    'settings.project.hint': 'Pasta onde os arquivos de config serão gerados. Use <b>Procurar…</b> ou digite o caminho.',
    'settings.chrome': 'Caminho do Chrome (browser-auth)',
    'settings.vscode': 'Comando do VSCode',
    'settings.vscode.hint': 'Comando que abre o VSCode. Deixe <code>code</code> se ele está no PATH; senão aponte pro <code>Code.exe</code>.',
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
    'envs.expandAll': 'Expandir todos os clientes',

    'conn.none': 'Escolha uma conexão à esquerda, ou crie uma em <b>+ Conexão</b>.',
    'detail.flags': 'Flags',

    'group.newTitle': 'Novo cliente',
    'group.newLabel': 'Nome do cliente (vira uma pasta na barra lateral):',
    'group.dup': 'O cliente "{0}" já existe.',
    'group.created': 'Cliente "{0}" criado. Use o + na pasta pra adicionar uma conexão.',

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
    'f.auth': 'Tipo de autenticação',
    'auth.onprem': 'On-Premise (basic auth)',
    'auth.cloud': 'Cloud (SSO SAML / cookie)',
    'f.url': 'URL *',
    'f.sapclient': 'Client SAP *',
    'f.user': 'Usuário SAP *',
    'f.pass': 'Senha',
    'f.insecure': 'Servidor com certificado self-signed (--insecure)',
    'f.insecure.hint': 'A maioria dos servidores on-premise usa certificado self-signed — deixe ligado, a menos que saiba que o cert é válido.',
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
    'card.copySuffix': 'cópia',
    'card.remove': 'Remover',
    'tag.cloud': 'Cloud',
    'tag.onprem': 'On-Prem',
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
    'alert.onpremUser': 'On-Premise exige Usuário SAP.',
    'alert.dup': 'Já existe uma conexão com o mesmo identificador "{0}". Mude o nome do cliente ou do ambiente.',
    'msg.envSaved': 'Conexão "{0}" salva.',
    'err.noProject': 'Defina a pasta do projeto.',
    'err.noEnvs': 'Cadastre ao menos uma conexão.',
    'msg.generating': 'Gerando configs…',
    'msg.vspKilled': '{0} processo(s) vsp antigo(s) encerrado(s) — reinicie o host MCP.',
    'msg.vspKilledSome': 'Processos vsp antigos encerrados — reinicie o host MCP.',
    'msg.openingVscode': 'Abrindo VSCode…',
    'err.loginNoProject': 'Defina a pasta do projeto antes do login.',
    'msg.loginStart': 'Login SSO de {0} — conclua no navegador…',

    'be.noProjectDefined': 'Pasta do projeto não definida nas Configurações.',
    'be.configsGenerated': 'Configs geradas em {0} ({1} conexão(ões)).',
    'be.genError': 'Erro ao gerar configs: {0}',
    'be.vspNotFound': 'vsp.exe não encontrado: {0}',
    'be.vspStartFail': 'Falha ao iniciar vsp: {0}',
    'be.loginOk': 'Login OK — cookie salvo ({0}).',
    'be.loginFail': 'Login falhou (exit {0}). Veja o log.',
    'be.error': 'Erro: {0}',
    'be.loginTimeout': 'Login expirou (timeout 5 min). Tente de novo.',
    'be.vscodeNoFolder': 'Pasta do projeto não existe. Gere as configs primeiro.',
    'be.vscodeFail': 'Falha ao abrir VSCode: {0}',
    'be.vscodeOpened': 'VSCode aberto em {0}.',
    'be.folderMissing': 'Pasta não existe.',
    'be.testOk': 'Conexão OK com {0}.',
    'be.testTls': '{0}: certificado TLS inválido/expirado. Marque --insecure no ambiente.',
    'be.testForbidden': '{0}: 403 — alcançável, mas ADT não está ativo na SICF (lado SAP).',
    'be.testAuth': '{0}: falha de autenticação (senha/cookie).',
    'be.testNoCookie': '{0}: sem cookie SSO ainda — faça o Login SSO primeiro.',
    'be.testNoPassword': '{0}: sem senha definida para este ambiente On-Premise.',
    'be.testFail': '{0}: teste de conexão falhou. Veja o log.',
    'be.updateDevMode': 'Auto-update só funciona no app instalado (não rodando pelo código-fonte).',
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
    'pick.project': 'Selecionar pasta do projeto',
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
