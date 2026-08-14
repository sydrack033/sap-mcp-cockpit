'use strict';

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------
let settings = {};
let clients = { environments: [], groups: [] };
let editIndex = -1; // -1 = novo
const loggedIn = new Set();     // profile ids com login SSO OK nesta sessao
let selectedId = null;          // profile id da conexao aberta no detalhe
const collapsed = new Set();    // nomes de cliente com o grupo fechado (so nesta sessao)
let landscapeCache = null;      // arvore do SAPUILandscape.xml, carregada sob demanda
const globalProfiles = new Set(); // profile ids registrados no ~/.claude.json
const localFolders = new Set();   // pastas que ja tem .mcp.json

const $ = (id) => document.getElementById(id);
const t = (...args) => window.i18n.t(...args);

// Resolve a resposta do backend: prefere a chave i18n (+args); cai pro message cru.
function msgOf(res) {
  if (res && res.key) return t(res.key, ...(res.args || []));
  return (res && res.message) || '';
}

// Troca o idioma da UI, persiste e re-renderiza as partes dinamicas.
async function changeLang(lang) {
  window.i18n.setLang(lang);
  settings.lang = window.i18n.getLang();
  await window.api.saveSettings(settings);
  render();
  renderUpdate(); // a pilula de update e montada em JS, o data-i18n nao a alcanca
  if (!$('modal').classList.contains('hidden')) {
    $('modal-title').textContent = (editIndex >= 0) ? t('modal.edit') : t('modal.new');
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function slug(text) {
  return String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
function profileId(e) { return slug(e.client_name) + '-' + slug(e.env_name); }

function setStatus(msg, kind) {
  const bar = document.querySelector('.statusbar');
  bar.classList.remove('ok', 'err');
  if (kind) bar.classList.add(kind);
  const el = $('status');
  el.textContent = msg;
  // re-dispara a animacao de entrada (fade + slide) da mensagem
  el.classList.remove('flash');
  void el.offsetWidth; // forca reflow pra reiniciar a animacao
  el.classList.add('flash');
}

let lastLog = '';
function showLog(text) {
  lastLog = text || '(vazio)';
  $('logbox').textContent = lastLog;
  $('logmodal').classList.remove('hidden');
}

// ---------------------------------------------------------------------------
// Dialogo in-app (alert / confirm)
// Substitui window.alert / window.confirm de proposito: os dialogs NATIVOS do
// Electron roubam o foco do teclado da janela e, ao fechar, os inputs de texto
// param de aceitar digitacao ate reiniciar o app (bug conhecido do Chromium/
// Electron no Windows). Este dialogo e 100% HTML, entao o foco nunca sai do
// webContents. Retorna Promise<boolean> (OK=true, Cancelar/fechar=false).
// ---------------------------------------------------------------------------
function appDialog({ message, title, okText, cancelText, showCancel, prompt }) {
  return new Promise((resolve) => {
    const modal = $('confirmmodal');
    $('confirm-title').textContent = title || '';
    $('confirm-msg').textContent = message || '';
    const okBtn = $('confirm-ok');
    const cancelBtn = $('confirm-cancel');
    const input = $('confirm-input');
    okBtn.textContent = okText || t('dlg.ok');
    cancelBtn.textContent = cancelText || t('dlg.cancel');
    cancelBtn.classList.toggle('hidden', !showCancel);
    input.classList.toggle('hidden', !prompt);
    input.value = '';

    let done = false;
    const close = (val) => {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey, true);
      modal.classList.add('hidden');
      okBtn.onclick = cancelBtn.onclick = modal.onclick = null;
      // no modo prompt, OK devolve o texto digitado (vazio = cancelou)
      resolve(prompt ? (val ? input.value.trim() : '') : val);
    };
    // Enter confirma; Esc cancela (num alert, ambos apenas fecham).
    const onKey = (ev) => {
      if (ev.key === 'Enter')       { ev.preventDefault(); close(true); }
      else if (ev.key === 'Escape') { ev.preventDefault(); close(showCancel ? false : true); }
    };
    okBtn.onclick     = () => close(true);
    cancelBtn.onclick = () => close(false);
    modal.onclick     = (ev) => { if (ev.target === modal) close(showCancel ? false : true); };
    document.addEventListener('keydown', onKey, true);

    modal.classList.remove('hidden');
    if (prompt) $('confirm-input').focus(); else okBtn.focus();
  });
}
function appAlert(message, title) {
  return appDialog({ message, title: title || t('dlg.attention'), showCancel: false });
}
function appConfirm(message, title) {
  return appDialog({ message, title: title || t('dlg.confirm'), showCancel: true });
}
// Devolve o texto digitado, ou '' se cancelou.
function appPrompt(title, message) {
  return appDialog({ message, title, showCancel: true, prompt: true });
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
function fillSettings() {
  $('set-vsp').value     = settings.vsp_path || '';
  $('set-chrome').value  = settings.chrome_path || '';
  $('set-vscode').value  = settings.vscode_cmd || 'code';
  $('set-codex').value   = settings.codex_cmd || 'codex';
}
function readSettingsFromForm() {
  settings.vsp_path     = $('set-vsp').value.trim();
  settings.chrome_path  = $('set-chrome').value.trim();
  settings.vscode_cmd   = $('set-vscode').value.trim() || 'code';
  settings.codex_cmd    = $('set-codex').value.trim() || 'codex';
}

async function saveSettings() {
  readSettingsFromForm();
  await window.api.saveSettings(settings);
  setStatus(t('msg.settingsSaved'), 'ok');
}

// ---------------------------------------------------------------------------
// Navegacao entre as views (Conexoes / Configuracoes)
// ---------------------------------------------------------------------------
function switchView(name) {
  document.querySelectorAll('.nav-item').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-view') === name);
  });
  $('view-conns').classList.toggle('hidden', name !== 'conns');
  $('view-settings').classList.toggle('hidden', name !== 'settings');
}

// ---------------------------------------------------------------------------
// Arvore de conexoes: um grupo por cliente.
// Os grupos saem do proprio client_name das conexoes; clients.groups guarda so
// os clientes criados a mao que ainda nao tem conexao nenhuma (senao eles
// sumiriam da arvore ate a primeira conexao existir).
// ---------------------------------------------------------------------------
function groupedEnvs() {
  const map = new Map();
  const get = (name) => {
    if (!map.has(name)) map.set(name, { name, items: [] });
    return map.get(name);
  };
  for (const g of (clients.groups || [])) get(g);
  (clients.environments || []).forEach((e, idx) => get(e.client_name || '').items.push({ e, idx }));
  return [...map.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

function findByIdx() {
  return (clients.environments || []).findIndex(e => profileId(e) === selectedId);
}

// ---------------------------------------------------------------------------
// Pasta por cliente
// Cada cliente pode ter a sua pasta de workspace (clients.folders, mapa
// client_name -> caminho). Sem pasta definida, cai na pasta padrao das
// Configuracoes — assim quem ja usava o app continua funcionando igual.
// ---------------------------------------------------------------------------
function folderOf(clientName) {
  return (clients.folders && clients.folders[clientName]) || '';
}

async function setFolderOf(clientName, dir) {
  if (!clients.folders) clients.folders = {};
  if (dir) clients.folders[clientName] = dir;
  else delete clients.folders[clientName];
  await persistClients();
}

// Devolve a pasta do cliente, pedindo na primeira vez. '' = usuario cancelou.
async function ensureFolder(clientName) {
  const atual = folderOf(clientName);
  if (atual) return atual;
  const dir = await window.api.pickFolder({ title: t('pick.clientFolder', clientName) });
  if (!dir) return '';
  await setFolderOf(clientName, dir);
  render();
  setStatus(t('msg.folderSet', clientName, dir), 'ok');
  return dir;
}

// Recolher/expandir todos de uma vez. Um botao so: se sobrou algum grupo
// aberto, fecha tudo; se ja esta tudo fechado, abre tudo.
function toggleAllGroups() {
  const names = groupedEnvs().map(g => g.name);
  const anyOpen = names.some(n => !collapsed.has(n));
  collapsed.clear();
  if (anyOpen) for (const n of names) collapsed.add(n);
  renderTree();
}

// Deixa o botao mostrando a acao que ele VAI fazer, nao o estado atual.
function syncToggleAll() {
  const btn = $('btn-toggle-all');
  if (!btn) return;
  const names = groupedEnvs().map(g => g.name);
  const willCollapse = names.some(n => !collapsed.has(n));
  btn.textContent = willCollapse ? '⊟' : '⊞';
  btn.title = t(willCollapse ? 'envs.collapseAll' : 'envs.expandAll');
  btn.disabled = !names.length;
}

function renderTree() {
  const tree = $('env-tree');
  const all = clients.environments || [];
  tree.innerHTML = '';
  $('env-count').textContent = all.length;

  const q = ($('env-search') && $('env-search').value || '').trim().toLowerCase();
  const onlyGlobal = $('filter-global') && $('filter-global').checked;
  const matches = (e) => !q ||
    `${e.client_name} ${e.env_name} ${e.url || ''} ${profileId(e)}`.toLowerCase().includes(q);

  let shown = 0;
  for (const g of groupedEnvs()) {
    // com filtro ativo, o nome do cliente tambem conta como match do grupo todo
    const groupHit = q && g.name.toLowerCase().includes(q);
    const items = g.items
      .filter(({ e }) => groupHit || matches(e))
      .filter(({ e }) => !onlyGlobal ||
        globalProfiles.has(profileId(e)) || localFolders.has(folderOf(e.client_name)));
    // grupo sem nada a mostrar some quando ha filtro (busca ou "so globais")
    if ((q || onlyGlobal) && !items.length) continue;

    const box = document.createElement('div');
    box.className = 'group';
    // durante a busca os grupos abrem sozinhos, senao o resultado ficaria escondido
    if (collapsed.has(g.name) && !q) box.classList.add('collapsed');

    const head = document.createElement('div');
    head.className = 'group-head';

    const chev = document.createElement('span');
    chev.className = 'chev';
    chev.textContent = '▼';

    const nameEl = document.createElement('span');
    nameEl.className = 'group-name';
    nameEl.textContent = g.name || t('envs.noClient');

    const count = document.createElement('span');
    count.className = 'pill';
    count.textContent = g.items.length;

    const add = document.createElement('button');
    add.className = 'group-add';
    add.textContent = '+';
    add.title = t('envs.addTo', g.name || t('envs.noClient'));
    add.onclick = (ev) => {
      ev.stopPropagation(); // senao o clique tambem colapsa o grupo
      openModal(-1, { prefill: { client_name: g.name } });
    };

    // pasta do cliente: acende quando definida, e o title mostra o caminho
    const dir = folderOf(g.name);
    const fold = document.createElement('button');
    fold.className = 'group-add group-folder' + (dir ? ' set' : '');
    fold.textContent = '🗀';
    fold.title = dir ? t('group.folderIs', dir) : t('group.folderNone');
    fold.onclick = async (ev) => {
      ev.stopPropagation(); // senao o clique tambem colapsa o grupo
      const escolhida = await window.api.pickFolder({ title: t('pick.clientFolder', g.name || t('envs.noClient')) });
      if (!escolhida) return;
      await setFolderOf(g.name, escolhida);
      render();
      setStatus(t('msg.folderSet', g.name, escolhida), 'ok');
    };

    head.append(chev, nameEl, count, fold, add);
    head.onclick = () => {
      if (collapsed.has(g.name)) collapsed.delete(g.name); else collapsed.add(g.name);
      renderTree();
    };

    const itemsBox = document.createElement('div');
    itemsBox.className = 'group-items';
    for (const { e, idx } of items) {
      shown++;
      const id = profileId(e);
      const row = document.createElement('div');
      row.className = 'conn' + (id === selectedId ? ' selected' : '');

      const dot = document.createElement('span');
      dot.className = 'dot ' + (e.auth_type === 'cloud'
        ? (loggedIn.has(id) ? 'ok' : 'cloud')
        : 'onprem');

      const label = document.createElement('span');
      label.className = 'conn-name';
      label.textContent = e.env_name;
      label.title = `${id} · ${e.url || ''}`;

      row.append(dot, label);

      // selos de onde o MCP esta habilitado: G = global, L = na pasta
      if (globalProfiles.has(id)) {
        const b = document.createElement('span');
        b.className = 'global-badge';
        b.textContent = 'G';
        b.title = t('card.globalBadge');
        row.appendChild(b);
      }
      if (localFolders.has(folderOf(e.client_name))) {
        const b = document.createElement('span');
        b.className = 'global-badge local';
        b.textContent = 'L';
        b.title = t('card.localBadge', folderOf(e.client_name));
        row.appendChild(b);
      }
      row.onclick = () => selectEnv(idx);
      itemsBox.appendChild(row);
    }

    box.append(head, itemsBox);
    tree.appendChild(box);
  }

  const empty = $('env-empty');
  if (!all.length && !(clients.groups || []).length) {
    empty.innerHTML = t('envs.empty');
    empty.classList.remove('hidden');
  } else if (q && !shown) {
    empty.textContent = t('envs.noMatch');
    empty.classList.remove('hidden');
  } else {
    empty.classList.add('hidden');
  }

  syncToggleAll();
}

// ---------------------------------------------------------------------------
// Detalhe da conexao selecionada (painel da direita)
// ---------------------------------------------------------------------------
function selectEnv(idx) {
  const e = (clients.environments || [])[idx];
  selectedId = e ? profileId(e) : null;
  switchView('conns');
  render();
}

function renderDetail() {
  const box = $('conn-detail');
  const none = $('conn-none');
  box.innerHTML = '';

  const idx = findByIdx();
  const e = idx >= 0 ? clients.environments[idx] : null;
  if (!e) {
    none.innerHTML = t('conn.none');
    none.classList.remove('hidden');
    return;
  }
  none.classList.add('hidden');

  const id = profileId(e);
  const panel = document.createElement('div');
  panel.className = 'panel';

  const head = document.createElement('div');
  head.className = 'panel-head static detail-head';

  const titleBox = document.createElement('div');
  const h = document.createElement('h2');
  h.textContent = `${e.client_name} · ${e.env_name}`;
  const sub = document.createElement('span');
  sub.className = 'profile-id';
  sub.textContent = id;
  titleBox.append(h, sub);

  const actions = document.createElement('div');
  actions.className = 'detail-actions';

  if (e.auth_type === 'cloud') {
    const loginBtn = document.createElement('button');
    loginBtn.className = 'btn btn-sm' + (loggedIn.has(id) ? ' btn-ok' : '');
    loginBtn.textContent = loggedIn.has(id) ? t('card.loginOk') : t('card.login');
    loginBtn.onclick = () => doLogin(e, loginBtn);
    actions.appendChild(loginBtn);
  }

  const mk = (label, cls, fn) => {
    const b = document.createElement('button');
    b.className = 'btn btn-sm' + (cls ? ' ' + cls : '');
    b.textContent = label;
    b.onclick = fn;
    actions.appendChild(b);
    return b;
  };

  // "Abrir em" da conexao: abre a pasta DO CLIENTE, nao a pasta padrao.
  // Na primeira vez pede a pasta e guarda no cliente.
  const openBox = document.createElement('span');
  openBox.className = 'dropdown';
  const oBtn = document.createElement('button');
  oBtn.className = 'btn btn-sm';
  oBtn.textContent = t('btn.openIn') + ' ▾';
  const dir = folderOf(e.client_name);
  oBtn.title = dir ? t('card.openInDir', dir) : t('card.openInAsk', e.client_name);
  const menu = document.createElement('div');
  menu.className = 'menu hidden';
  for (const [target, label] of Object.entries(OPEN_LABELS)) {
    const mi = document.createElement('button');
    mi.className = 'menu-item';
    mi.textContent = label;
    mi.onclick = () => openConnIn(e, target);
    menu.appendChild(mi);
  }
  oBtn.onclick = (ev) => { ev.stopPropagation(); closeMenus(menu); menu.classList.toggle('hidden'); };
  openBox.append(oBtn, menu);
  actions.appendChild(openBox);

  mk(t('card.test'), '', function () { doTest(e, this); });
  mk(t('card.edit'), '', () => openModal(idx));
  mk(t('card.duplicate'), '', () => duplicateEnv(idx));

  // "Habilitar MCP": menu com Global e Local, cada um com a descricao do que
  // faz. O item ja habilitado vira a acao de desabilitar.
  const isGlobal = globalProfiles.has(id);
  const dirDaConn = folderOf(e.client_name);
  const isLocal = !!(dirDaConn && localFolders.has(dirDaConn));

  const mcpBox = document.createElement('span');
  mcpBox.className = 'dropdown';
  const mBtn = document.createElement('button');
  mBtn.className = 'btn btn-sm' + (isGlobal || isLocal ? ' btn-ok' : '');
  const marcas = [isGlobal && t('mcp.global'), isLocal && t('mcp.local')].filter(Boolean);
  mBtn.textContent = (marcas.length ? '✓ ' + marcas.join(' + ') : t('mcp.enable')) + ' ▾';
  mBtn.title = t('mcp.enable.title');

  const mMenu = document.createElement('div');
  mMenu.className = 'menu menu-wide hidden';
  for (const escopo of ['global', 'local']) {
    const ativo = escopo === 'global' ? isGlobal : isLocal;
    const item = document.createElement('button');
    item.className = 'menu-item mcp-opt' + (ativo ? ' on' : '');
    const titulo = document.createElement('span');
    titulo.className = 'mcp-opt-title';
    titulo.textContent = (ativo ? '✓ ' : '') + t('mcp.' + escopo) +
      (ativo ? ' — ' + t('mcp.clickDisable') : '');
    const desc = document.createElement('span');
    desc.className = 'mcp-opt-desc';
    desc.innerHTML = t('mcp.' + escopo + '.desc', dirDaConn || t('mcp.noFolder'));
    item.append(titulo, desc);
    item.onclick = () => toggleMcp(e, escopo, ativo);
    mMenu.appendChild(item);
  }
  mBtn.onclick = (ev) => { ev.stopPropagation(); closeMenus(mMenu); mMenu.classList.toggle('hidden'); };
  mcpBox.append(mBtn, mMenu);
  actions.appendChild(mcpBox);

  mk(t('card.remove'), 'btn-ghost', () => removeEnv(idx));

  head.append(titleBox, actions);

  const body = document.createElement('div');
  body.className = 'panel-body';
  const dl = document.createElement('dl');
  dl.className = 'detail-grid';
  // os rotulos vem do formulario, onde o " *" marca campo obrigatorio; aqui e
  // so leitura, entao o asterisco sai
  const lbl = (key) => t(key).replace(/\s*\*$/, '');
  const rows = [
    [lbl('f.auth'), e.auth_type === 'cloud' ? t('auth.cloud') : t('auth.onprem')],
    [lbl('f.url'), e.url || '—'],
    [lbl('f.sapclient'), e.sap_client || '—'],
    [lbl('f.user'), e.auth_type === 'onprem' ? (e.user || '—') : '—'],
    [lbl('f.mode'), e.mode || 'focused'],
    [lbl('f.lang'), e.language || '—'],
    [lbl('detail.flags'), [
      e.read_only && t('f.readonly'),
      e.insecure && t('f.insecure'),
      e.allow_transportable_edits && t('f.transpedit'),
      e.enable_transports && t('f.transp')
    ].filter(Boolean).join(' · ') || '—']
  ];
  for (const [k, v] of rows) {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    dl.append(dt, dd);
  }
  body.appendChild(dl);

  panel.append(head, body);
  box.appendChild(panel);
}

function render() {
  renderTree();
  renderDetail();
}

async function persistClients() {
  await window.api.saveClients(clients);
}

async function removeEnv(idx) {
  const e = clients.environments[idx];
  if (!(await appConfirm(t('confirm.remove', `${e.client_name} · ${e.env_name}`)))) return;
  const wasSelected = profileId(e) === selectedId;
  // mantem o cliente como grupo vazio, senao ele sumiria ao remover a ultima conexao
  const client = e.client_name;
  clients.environments.splice(idx, 1);
  if (client && !clients.environments.some(x => x.client_name === client)) {
    if (!clients.groups) clients.groups = [];
    if (!clients.groups.includes(client)) clients.groups.push(client);
  }
  if (wasSelected) selectedId = null;
  await persistClients();
  render();
  setStatus(t('msg.envRemoved'), 'ok');
}

// Cria um cliente (grupo) vazio, pra poder pendurar conexoes nele depois.
async function newGroup() {
  const name = await appPrompt(t('group.newTitle'), t('group.newLabel'));
  if (!name) return;
  if (!clients.groups) clients.groups = [];
  const exists = clients.groups.some(g => slug(g) === slug(name)) ||
    (clients.environments || []).some(e => slug(e.client_name) === slug(name));
  if (exists) { appAlert(t('group.dup', name)); return; }
  clients.groups.push(name);
  await persistClients();
  render();

  // ja pergunta a pasta do cliente — opcional, da pra definir depois no grupo
  const dir = await window.api.pickFolder({ title: t('pick.clientFolder', name) });
  if (dir) await setFolderOf(name, dir);
  render();
  setStatus(dir ? t('group.createdWithFolder', name, dir) : t('group.created', name), 'ok');
}

// Duplicar: abre o MESMO modal, mas em modo "novo", ja preenchido com a conexao
// de origem. O nome do ambiente ganha um sufixo livre pra nao colidir o profile
// id — que e a chave do server MCP e nao pode repetir.
function duplicateEnv(idx) {
  const src = clients.environments[idx];
  if (!src) return;
  const copy = Object.assign({}, src, { env_name: uniqueEnvName(src.client_name, src.env_name) });
  openModal(-1, { prefill: copy, focus: 'f-env' });
  setStatus(t('msg.duplicating', `${src.client_name} · ${src.env_name}`));
}

function uniqueEnvName(client, base) {
  const taken = (name) => (clients.environments || [])
    .some(e => profileId(e) === slug(client) + '-' + slug(name));
  let name = `${base} ${t('card.copySuffix')}`;
  for (let n = 2; taken(name); n++) name = `${base} ${t('card.copySuffix')} ${n}`;
  return name;
}

// ---------------------------------------------------------------------------
// Modal cadastro / edicao
// ---------------------------------------------------------------------------
function setAuthType(type) {
  document.querySelector(`input[name=auth][value=${type}]`).checked = true;
  $('onprem-fields').classList.toggle('hidden', type !== 'onprem');
}
function currentAuthType() {
  return document.querySelector('input[name=auth]:checked').value;
}

// idx >= 0 edita; idx = -1 cria. `opts.prefill` alimenta o formulario sem sair
// do modo "novo" — e o que faz duplicar, importar do SAP GUI e "+" no grupo
// reaproveitarem este mesmo modal.
function openModal(idx, opts) {
  editIndex = (typeof idx === 'number') ? idx : -1;
  const o = opts || {};
  const e = editIndex >= 0 ? clients.environments[editIndex] : (o.prefill || null);
  const isNew = editIndex < 0;

  $('modal-title').textContent = isNew ? t('modal.new') : t('modal.edit');
  $('f-client').value    = e ? (e.client_name || '') : '';
  $('f-env').value       = e ? (e.env_name || '') : '';
  $('f-url').value       = e ? (e.url || '') : '';
  $('f-sapclient').value = e ? (e.sap_client || '') : '100';
  $('f-user').value      = e ? (e.user || '') : '';
  $('f-pass').value      = e ? (e.password || '') : '';
  // on-prem self-signed e a regra → liga por padrao em conexao nova
  $('f-insecure').checked = e ? !!e.insecure : true;
  $('f-mode').value      = e ? (e.mode || 'focused') : 'focused';
  $('f-lang').value      = e ? (e.language || '') : '';
  $('f-readonly').checked    = e ? !!e.read_only : false;
  $('f-transp-edit').checked = e ? (e.allow_transportable_edits !== false) : true;
  $('f-transp').checked      = e ? (e.enable_transports !== false) : true;

  // a pasta e do CLIENTE, nao da conexao: mostra a que ja existe pra ele
  $('f-folder').value = folderOf($('f-client').value.trim());
  syncFolderHint();

  setAuthType((e && e.auth_type) || 'onprem');
  $('modal').classList.remove('hidden');

  const focus = $(o.focus || (e && e.client_name ? 'f-env' : 'f-client'));
  if (focus) { focus.focus(); if (focus.select) focus.select(); }
}

function closeModal() { $('modal').classList.add('hidden'); }

// Trocar o cliente no formulario troca a pasta mostrada: ela pertence ao
// cliente, entao digitar outro nome tem que refletir a pasta DELE.
function onClientChanged() {
  const cliente = $('f-client').value.trim();
  const atual = $('f-folder').value.trim();
  const doCliente = folderOf(cliente);
  // so sobrescreve se o campo estiver vazio ou com a pasta de outro cliente —
  // senao apagaria uma pasta que o usuario acabou de escolher a mao
  if (!atual || Object.values(clients.folders || {}).includes(atual)) {
    $('f-folder').value = doCliente;
  }
  syncFolderHint();
}

// Avisa quantas outras conexoes do mesmo cliente compartilham essa pasta.
function syncFolderHint() {
  const cliente = $('f-client').value.trim();
  const irmas = (clients.environments || [])
    .filter(x => x.client_name === cliente && profileId(x) !== selectedId).length;
  $('f-folder-hint').innerHTML = irmas
    ? t('f.folder.shared', cliente, irmas)
    : t('f.folder.hint');
}

async function saveEnv() {
  const authType = currentAuthType();
  const e = {
    client_name: $('f-client').value.trim(),
    env_name:    $('f-env').value.trim(),
    auth_type:   authType,
    url:         $('f-url').value.trim(),
    sap_client:  $('f-sapclient').value.trim(),
    user:        $('f-user').value.trim(),
    password:    $('f-pass').value,
    insecure:    $('f-insecure').checked,
    mode:        $('f-mode').value,
    language:    $('f-lang').value.trim(),
    read_only:                 $('f-readonly').checked,
    allow_transportable_edits: $('f-transp-edit').checked,
    enable_transports:         $('f-transp').checked
  };

  // validacao
  if (!e.client_name || !e.env_name || !e.url || !e.sap_client) {
    appAlert(t('alert.required')).then(() => {
      const first = ['f-client', 'f-env', 'f-url', 'f-sapclient'].find(id2 => !$(id2).value.trim());
      if (first) $(first).focus();
    });
    return;
  }
  if (authType === 'onprem' && !e.user) {
    appAlert(t('alert.onpremUser')).then(() => $('f-user').focus());
    return;
  }

  // checa profile id duplicado
  const id = profileId(e);
  const dup = clients.environments.findIndex((x, i) => profileId(x) === id && i !== editIndex);
  if (dup >= 0) {
    appAlert(t('alert.dup', id)).then(() => $('f-client').focus());
    return;
  }

  if (editIndex >= 0) {
    clients.environments[editIndex] = e;
  } else {
    clients.environments.push(e);
  }
  // o cliente agora tem conexao: sai da lista de grupos vazios
  if (clients.groups) clients.groups = clients.groups.filter(g => g !== e.client_name);

  // a pasta do formulario e a do CLIENTE — vale pras outras conexoes dele tambem
  const pasta = $('f-folder').value.trim();
  if (!clients.folders) clients.folders = {};
  if (pasta) clients.folders[e.client_name] = pasta;
  else delete clients.folders[e.client_name];

  selectedId = id; // abre a conexao recem-salva no detalhe
  await persistClients();
  render();
  closeModal();
  setStatus(t('msg.envSaved', id), 'ok');
}

// ---------------------------------------------------------------------------
// Import do SAP GUI (SAPUILandscape.xml)
// O arquivo so tem conexao DIAG: nao existe URL HTTP nem mandante ali. Dai o
// import preencher cliente/ambiente/URL sugerida e mandar o usuario conferir no
// formulario, em vez de gravar direto.
// ---------------------------------------------------------------------------
async function openImport() {
  setStatus(t('import.loading'));
  const res = await window.api.sapLandscape();
  if (!res.ok) { setStatus('✗ ' + msgOf(res), 'err'); return; }
  landscapeCache = res;
  $('import-source').textContent = t('import.source', res.file, res.count);
  $('import-search').value = '';
  renderImport();
  $('importmodal').classList.remove('hidden');
  $('import-search').focus();
  setStatus(t('status.ready'));
}

function renderImport() {
  const box = $('import-list');
  box.innerHTML = '';
  if (!landscapeCache) return;
  const q = ($('import-search').value || '').trim().toLowerCase();

  let shown = 0;
  for (const g of landscapeCache.groups) {
    const hit = (s) => !q ||
      `${g.name} ${s.name} ${s.systemid} ${s.server}`.toLowerCase().includes(q);
    const items = g.services.filter(hit);
    if (!items.length) continue;

    const gh = document.createElement('div');
    gh.className = 'import-group';
    gh.textContent = `${g.name || t('envs.noClient')} (${items.length})`;
    box.appendChild(gh);

    for (const s of items) {
      shown++;
      const row = document.createElement('div');
      row.className = 'import-item';

      const left = document.createElement('div');
      const name = document.createElement('div');
      name.textContent = s.name;
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = `${s.systemid || '?'} · ${s.server}` + (s.router ? ` · router ${s.router}` : '');
      left.append(name, meta);

      const url = document.createElement('span');
      url.className = 'meta';
      url.textContent = s.url || t('import.noUrl');

      row.append(left, url);
      row.onclick = () => pickImport(g, s);
      box.appendChild(row);
    }
  }
  if (!shown) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = t('envs.noMatch');
    box.appendChild(p);
  }
}

function pickImport(group, svc) {
  $('importmodal').classList.add('hidden');
  openModal(-1, {
    prefill: {
      client_name: group.name || '',
      env_name: svc.name || svc.systemid || '',
      auth_type: 'onprem',
      url: svc.url || '',
      sap_client: '',
      insecure: true
    },
    focus: 'f-sapclient' // o mandante e o campo que o arquivo do SAP nao tem
  });
  // a URL e derivada da porta DIAG por convencao (32NN -> 80NN): avisa pra conferir
  setStatus(svc.url
    ? t('import.check', svc.server, svc.url)
    : t('import.noPort', svc.server), 'warn');
}

// ---------------------------------------------------------------------------
// Acoes principais
// ---------------------------------------------------------------------------
// Sufixo do status contando os processos vsp derrubados.
// vspKilled: numero derrubado; null = derrubou mas nao da pra contar (pkill).
function killedNote(res) {
  if (!res || !res.ok) return '';
  if (res.vspKilled === null) return ' — ' + t('msg.vspKilledSome');
  if (res.vspKilled > 0) return ' — ' + t('msg.vspKilled', res.vspKilled);
  return '';
}

const OPEN_LABELS = { vscode: 'VSCode', claude: 'Claude Code', codex: 'Codex' };

// Fecha todo menu aberto, menos o que estiver sendo alternado agora.
function closeMenus(exceto) {
  document.querySelectorAll('.menu').forEach(m => { if (m !== exceto) m.classList.add('hidden'); });
}
// Abrir em, a partir da conexao: usa a pasta do cliente (pedindo se faltar).
async function openConnIn(env, target) {
  closeMenus();
  const dir = await ensureFolder(env.client_name);
  if (!dir) { setStatus(t('msg.folderNeeded', env.client_name), 'warn'); return; }
  readSettingsFromForm();
  await window.api.saveSettings(settings);
  setStatus(t('msg.openingIn', OPEN_LABELS[target] || target, dir));
  const res = await window.api.openIn({ settings, target, projectPath: dir });
  setStatus((res.ok ? '✓ ' : '✗ ') + msgOf(res), res.ok ? 'ok' : 'err');
}

// Registra ESTA conexao no escopo global do Claude Code (~/.claude.json),
// pra ela valer fora da pasta do projeto.
// Anexa a pasta do cliente na conexao. O main precisa dela pra saber onde fica
// o cookie e onde gravar — quem conhece o mapa cliente->pasta e o renderer.
function withFolder(e) {
  return Object.assign({}, e, { folder: folderOf(e.client_name) });
}

// Liga/desliga o MCP da conexao no escopo escolhido.
async function toggleMcp(env, escopo, jaAtivo) {
  closeMenus();
  readSettingsFromForm();
  await window.api.saveSettings(settings);

  // as duas pontas precisam da pasta: o global pro cookie, o local pra gravar
  const dir = await ensureFolder(env.client_name);
  if (!dir) { setStatus(t('msg.folderNeeded', env.client_name), 'warn'); return; }

  let res;
  if (escopo === 'global') {
    res = jaAtivo
      ? (await appConfirm(t('confirm.globalRemove', profileId(env))))
        ? await window.api.removeGlobal({ settings, env: withFolder(env) })
        : null
      : await window.api.generateGlobal({ settings, env: withFolder(env) });
    // Codex so le do config global: acompanha o escopo global, nunca o local
    if (res && res.ok) {
      const todas = (clients.environments || []).filter(x => globalProfiles.has(profileId(x)) || profileId(x) === profileId(env));
      await window.api.syncCodex({ settings, envs: todas.map(withFolder) });
    }
  } else {
    if (jaAtivo) {
      res = (await appConfirm(t('confirm.localRemove', dir)))
        ? await window.api.disableLocal({ settings, folder: dir })
        : null;
    } else {
      // TODAS as conexoes que dividem esta pasta: gravar so a clicada apagaria
      // as outras do .mcp.json
      const daPasta = (clients.environments || []).filter(x => folderOf(x.client_name) === dir);
      res = await window.api.enableLocal({ settings, folder: dir, envs: daPasta.map(withFolder) });
    }
  }
  if (!res) return; // usuario cancelou a confirmacao
  setStatus((res.ok ? '✓ ' : '✗ ') + msgOf(res) + killedNote(res), res.ok ? 'ok' : 'err');
  await refreshMcpStatus();
}

// Onde cada conexao esta habilitada: global (~/.claude.json) e/ou local
// (.mcp.json na pasta). Alimenta os selos, o filtro e o menu do detalhe.
async function refreshMcpStatus() {
  try {
    const res = await window.api.globalStatus();
    globalProfiles.clear();
    for (const p of (res.profiles || [])) globalProfiles.add(p);
  } catch (e) { /* sem status: segue sem selo */ }

  try {
    const pastas = [...new Set(Object.values(clients.folders || {}))].filter(Boolean);
    const res = await window.api.localStatus(pastas);
    localFolders.clear();
    for (const [dir, tem] of Object.entries((res && res.folders) || {})) if (tem) localFolders.add(dir);
  } catch (e) { /* idem */ }

  // conta so as conexoes DAQUI — o ~/.claude.json pode ter servers de terceiros
  const meus = (clients.environments || []).filter(e =>
    globalProfiles.has(profileId(e)) || localFolders.has(folderOf(e.client_name))).length;
  const badge = $('global-count');
  if (badge) badge.textContent = meus;
  render();
}

async function doTest(env, btn) {
  readSettingsFromForm();
  await window.api.saveSettings(settings);
  const label = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = t('card.testing'); }
  setStatus(`${t('card.testing')} ${profileId(env)}`);
  const res = await window.api.vspTest({ settings, env: withFolder(env) });
  setStatus((res.ok ? '✓ ' : '✗ ') + msgOf(res), res.ok ? 'ok' : 'err');
  if (res.log) lastLog = res.log;
  if (btn) { btn.disabled = false; btn.textContent = label || t('card.test'); }
}

async function doLogin(env, btn) {
  readSettingsFromForm();
  await window.api.saveSettings(settings);
  setStatus(t('msg.loginStart', profileId(env)));
  if (btn) { btn.disabled = true; btn.textContent = t('card.logging'); }
  const res = await window.api.vspLogin({ settings, env: withFolder(env) });
  setStatus((res.ok ? '✓ ' : '✗ ') + msgOf(res), res.ok ? 'ok' : 'err');
  if (res.log) lastLog = res.log;

  const id = profileId(env);
  if (res.ok) loggedIn.add(id); else loggedIn.delete(id);
  if (btn) {
    btn.disabled = false;
    btn.classList.toggle('btn-ok', res.ok);
    btn.textContent = res.ok ? t('card.loginOk') : t('card.login');
  }
}

// ---------------------------------------------------------------------------
// Pick file/folder
// ---------------------------------------------------------------------------
async function pick(kind) {
  const exeFilters = [{ name: t('file.exe'), extensions: ['exe'] }, { name: t('file.all'), extensions: ['*'] }];
  if (kind === 'vsp') {
    const p = await window.api.pickFile({ title: t('pick.vsp'), filters: exeFilters });
    if (p) $('set-vsp').value = p;
  } else if (kind === 'chrome') {
    const p = await window.api.pickFile({ title: t('pick.browser'), filters: exeFilters });
    if (p) $('set-chrome').value = p;
  } else if (kind === 'folder') {
    const cliente = $('f-client').value.trim();
    const p = await window.api.pickFolder({ title: t('pick.clientFolder', cliente || '…') });
    if (p) $('f-folder').value = p;
  }
}

// ---------------------------------------------------------------------------
// Bind de eventos
// ---------------------------------------------------------------------------
function bind() {
  // bandeiras de idioma
  document.querySelectorAll('.flag').forEach(f => {
    f.onclick = () => changeLang(f.getAttribute('data-lang'));
  });

  // topbar
  // fecha qualquer menu ao clicar fora ou apertar Esc
  document.addEventListener('click', () => closeMenus());
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeMenus(); });

  // navegacao entre Conexoes e Configuracoes
  document.querySelectorAll('.nav-item').forEach(b => {
    b.onclick = () => switchView(b.getAttribute('data-view'));
  });

  // settings
  $('btn-save-settings').onclick = saveSettings;
  document.querySelectorAll('[data-pick]').forEach(btn => {
    btn.onclick = () => pick(btn.getAttribute('data-pick'));
  });

  // conexoes
  $('btn-new').onclick       = () => openModal(-1);
  $('btn-new-group').onclick = newGroup;
  $('btn-import').onclick    = openImport;
  $('btn-toggle-all').onclick = toggleAllGroups;
  $('env-search').oninput    = renderTree;
  $('filter-global').onchange = renderTree;

  // import
  $('import-search').oninput = renderImport;
  $('importmodal-close').onclick = () => $('importmodal').classList.add('hidden');
  $('importmodal').addEventListener('click', (ev) => {
    if (ev.target === $('importmodal')) $('importmodal').classList.add('hidden');
  });

  // modal
  $('modal-close').onclick  = closeModal;
  $('modal-cancel').onclick = closeModal;
  $('modal-save').onclick   = saveEnv;
  document.querySelectorAll('input[name=auth]').forEach(r => {
    r.onchange = () => setAuthType(currentAuthType());
  });
  $('f-client').oninput = onClientChanged;

  // log
  $('btn-log').onclick = () => showLog(lastLog);
  $('logmodal-close').onclick = () => $('logmodal').classList.add('hidden');

  // fechar o visualizador de log clicando fora (o modal de ambiente NAO fecha
  // clicando fora — so pelo X ou Cancelar, pra nao perder o que foi digitado)
  $('logmodal').addEventListener('click', (ev) => {
    if (ev.target === $('logmodal')) $('logmodal').classList.add('hidden');
  });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
// Pergunta ao main quais ambientes Cloud ja tem cookie salvo e marca como logados.
async function refreshCookieStatus() {
  try {
    const status = await window.api.cookiesStatus({ settings, envs: (clients.environments||[]).map(withFolder) });
    for (const [id, has] of Object.entries(status || {})) {
      if (has) loggedIn.add(id); else loggedIn.delete(id);
    }
    render();
  } catch (e) { /* ignora */ }
}

// ---------------------------------------------------------------------------
// Auto-update: pilula na statusbar. So aparece quando ha algo a dizer —
// 'idle'/'current'/'dev' ficam escondidos pra nao poluir a barra.
// ---------------------------------------------------------------------------
let updateLast = null;

function renderUpdate(s) {
  updateLast = s || updateLast;
  if (!updateLast) return;
  const pill = $('update-pill');
  const msg  = $('update-msg');
  const btn  = $('btn-update-install');
  const { state, version, percent } = updateLast;

  pill.classList.remove('ready', 'err');
  btn.classList.add('hidden');

  if (state === 'checking')         msg.textContent = t('update.checking');
  else if (state === 'downloading') msg.textContent = t('update.downloading', version || '', percent || 0);
  else if (state === 'ready') {
    msg.textContent = t('update.ready', version || '');
    pill.classList.add('ready');
    btn.classList.remove('hidden');
  } else if (state === 'error') {
    msg.textContent = t('update.error');
    pill.classList.add('err');
  } else {
    pill.classList.add('hidden'); // idle / current / dev
    return;
  }
  pill.classList.remove('hidden');
}

async function initUpdates() {
  // Nada aqui pode derrubar o boot: sem updater o app tem que abrir igual.
  try {
    window.api.onUpdateStatus(renderUpdate);
    $('btn-update-install').onclick = () => window.api.updateInstall();
    const s = await window.api.updateState();
    const v = $('app-version');
    v.textContent = 'v' + (s.appVersion || '?');
    v.title = t('update.checkNow');
    // clique na versao = checar agora (util quando o check do boot falhou)
    v.style.cursor = 'pointer';
    v.onclick = async () => {
      const r = await window.api.updateCheck();
      if (!r.ok) setStatus('✗ ' + (r.key ? t(r.key) : r.message), 'err');
    };
    renderUpdate(s);
  } catch (e) { /* sem updater: segue sem a pilula */ }
}

async function init() {
  bind();
  settings = await window.api.loadSettings();
  clients  = await window.api.loadClients();
  if (!clients.environments) clients.environments = [];
  window.i18n.setLang(settings.lang || 'en'); // ingles por padrao
  fillSettings();
  render();
  await refreshCookieStatus();
  await refreshMcpStatus();
  await initUpdates();
  setStatus(t('status.ready'));
}

init();
