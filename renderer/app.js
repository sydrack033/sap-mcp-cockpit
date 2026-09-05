'use strict';

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------
let settings = {};
let clients = { environments: [], groups: [] };
let editIndex = -1; // -1 = novo
// profile id -> { state: 'none'|'valid'|'expired', expiresAt }. So Cloud.
const cookieState = new Map();
let selectedId = null;          // profile id da conexao aberta no detalhe
const collapsed = new Set();    // nomes de cliente com o grupo fechado (so nesta sessao)
let landscapeCache = null;      // arvore do SAPUILandscape.xml, carregada sob demanda
// 'new'  = escolher um sistema CRIA uma conexao (botao Import da sidebar)
// 'form' = escolher um sistema PREENCHE o formulario aberto (botao dentro do modal)
let importMode = 'new';
const globalProfiles = new Set(); // profile ids registrados no ~/.claude.json
// profile id -> id do engine que GEROU a config registrada (inferido pelo main).
// Comparado com o engine atual da conexao, e o que denuncia config desatualizada.
const globalEngines = new Map();
// [{ id, label, caps }] — vem do main; o renderer nao consegue ler lib/engines.
let engineDefs = [];

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
    // o applyI18n repoe o rotulo pelo data-i18n ("Mostrar"), que fica errado se
    // a senha estiver a vista: reescreve pelo estado real do campo
    setPassVisible($('f-pass').type === 'text');
    // o seletor de engine e os modos sao montados em JS (sem data-i18n): o
    // applyI18n nao os alcanca, entao remonta preservando a escolha atual
    buildEngineSeg(currentEngineChoice());
    applyEngineCaps();
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

// ---------------------------------------------------------------------------
// Engines (vsp / ARC-1)
//
// A conexao pode nao escolher: `e.engine` vazio significa HERDAR o padrao do
// app. Isso mantem toda conexao antiga funcionando sem migracao e deixa a troca
// em massa ser um campo so nas Configuracoes.
// ---------------------------------------------------------------------------
function engineDefById(id) {
  return engineDefs.find(x => x.id === id) || null;
}
function defaultEngineId() {
  const id = settings.default_engine || 'vsp';
  return engineDefById(id) ? id : ((engineDefs[0] && engineDefs[0].id) || 'vsp');
}
// O engine EFETIVO da conexao (ja resolvida a heranca).
function engineIdOf(e) {
  const escolhido = (e && e.engine) || '';
  return (escolhido && engineDefById(escolhido)) ? escolhido : defaultEngineId();
}
function engineDefOf(e) {
  return engineDefById(engineIdOf(e)) || { id: 'vsp', label: 'vsp', caps: {} };
}
function engineCapsOf(e) {
  return engineDefOf(e).caps || {};
}
// Rotulo pro detalhe: deixa claro quando esta herdando em vez de ter escolhido.
function engineLabelOf(e) {
  const def = engineDefOf(e);
  return (e && e.engine) ? def.label : t('engine.inherited', def.label);
}
// A config registrada foi gerada por outro engine? (so faz sentido se registrada)
function engineDrift(e) {
  const id = profileId(e);
  if (!globalProfiles.has(id)) return null;
  const gerado = globalEngines.get(id);
  if (!gerado || gerado === engineIdOf(e)) return null;
  const def = engineDefById(gerado);
  return { from: def ? def.label : gerado, to: engineDefOf(e).label };
}

// ---------------------------------------------------------------------------
// Conexoes RFC (SAProuter)
// A URL nao e digitada: ela aponta pro bridge local, entao sai da porta.
// ---------------------------------------------------------------------------
const BRIDGE_PORT_BASE = 8410;

function bridgePortOf(e) {
  const n = parseInt((e && e.bridge_port) || '', 10);
  return (n >= 1 && n <= 65535) ? n : BRIDGE_PORT_BASE;
}

function urlOfEnv(e) {
  if (e && e.auth_type === 'rfc') return 'http://127.0.0.1:' + bridgePortOf(e);
  return (e && e.url) || '';
}

// Menor porta livre a partir da base. Duas conexoes na mesma porta seria pior do
// que parece: a segunda encontraria o bridge da PRIMEIRA ja escutando e falaria
// com o sistema errado, sem erro nenhum.
function nextBridgePort(exceptIdx) {
  const usadas = new Set((clients.environments || [])
    .filter((x, i) => x.auth_type === 'rfc' && i !== exceptIdx)
    .map(bridgePortOf));
  let porta = BRIDGE_PORT_BASE;
  while (usadas.has(porta)) porta++;
  return porta;
}

function authLabel(e) {
  if (!e) return '';
  if (e.auth_type === 'cloud') return t('auth.cloud');
  if (e.auth_type === 'rfc')   return t('auth.rfc');
  return t('auth.onprem');
}

function setStatus(msg, kind) {
  const bar = document.querySelector('.statusbar');
  // limpa TODOS os estados: se sobrar um, a proxima mensagem herda a cor errada
  // (era o caso do 'warn', que ficava grudado e pintava erro de verde)
  bar.classList.remove('ok', 'err', 'warn');
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
// Opcoes do seletor de engine padrao. Montadas em JS porque a lista de engines
// e do main — a UI nao decide quais existem.
function fillEngineSelect() {
  const sel = $('set-engine');
  if (!sel) return;
  sel.innerHTML = '';
  for (const d of engineDefs) {
    const o = document.createElement('option');
    o.value = d.id;
    o.textContent = d.label;
    sel.appendChild(o);
  }
  sel.value = defaultEngineId();
}

function fillSettings() {
  fillEngineSelect();
  $('set-vsp').value      = settings.vsp_path || '';
  $('set-arc1cmd').value  = settings.arc1_cmd || '';
  $('set-arc1args').value = settings.arc1_args || '';
  // vazio de proposito: vazio = usa o node do PATH
  $('set-node').value     = settings.node_path || '';
  $('set-chrome').value   = settings.chrome_path || '';
  $('set-vscode').value   = settings.vscode_cmd || 'code';
  // vazio de proposito: vazio = usa o Python que vem junto no app
  $('set-python').value   = settings.python_path || '';
  $('set-nwrfc').value    = settings.nwrfc_lib || '';
}
function readSettingsFromForm() {
  // o select so existe depois que a lista de engines chegou; sem ela, preserva
  if ($('set-engine') && $('set-engine').value) settings.default_engine = $('set-engine').value;
  settings.vsp_path     = $('set-vsp').value.trim();
  // vazios de proposito: vazio = `npx -y arc-1@latest` (ver lib/engines/arc1.js)
  settings.arc1_cmd     = $('set-arc1cmd').value.trim();
  settings.arc1_args    = $('set-arc1args').value.trim();
  settings.node_path    = $('set-node').value.trim();
  settings.chrome_path  = $('set-chrome').value.trim();
  settings.vscode_cmd   = $('set-vscode').value.trim() || 'code';
  settings.python_path  = $('set-python').value.trim();
  settings.nwrfc_lib    = $('set-nwrfc').value.trim();
}

async function saveSettings() {
  readSettingsFromForm();
  await window.api.saveSettings(settings);
  setStatus(t('msg.settingsSaved'), 'ok');
  renderArc1Status(); // o override manual e o node podem ter mudado o runtime
}

// ---------------------------------------------------------------------------
// ARC-1: instalacao gerenciada
//
// Sem ela o app cai em `npx -y arc-1@latest`, que custa 6-18s a CADA start do
// server MCP e ainda troca a versao sozinho. Aqui o usuario ve o que vai rodar
// de fato, fixa a versao e atualiza quando quiser.
// ---------------------------------------------------------------------------
let arc1Ultima = null; // ultima versao vista no registry (so apos clicar)

async function renderArc1Status() {
  const box = $('arc1-status');
  if (!box) return;
  const btnInst = $('btn-arc1-install');
  let s;
  try { s = await window.api.arc1Status({ settings }); } catch (e) { return; }
  if (!s || !s.ok) { box.textContent = msgOf(s) || '—'; return; }

  box.classList.remove('ok', 'warn');
  let texto;
  if (s.mode === 'manual') {
    box.classList.add('warn');
    texto = t('arc1.modeManual', s.command);
  } else if (s.mode === 'local') {
    box.classList.add('ok');
    texto = t('arc1.modeLocal', s.active, s.node.version || '?');
  } else {
    box.classList.add('warn');
    texto = s.node.ok
      ? t('arc1.modeNpx', s.node.version || '?')
      : t(s.node.motivo === 'tooOld' ? 'arc1.nodeOld' : 'arc1.noNode', s.node.version || '—', s.node.minimo);
  }
  if (arc1Ultima && s.active && arc1Ultima !== s.active) texto += ' · ' + t('arc1.updateAvail', arc1Ultima);
  box.textContent = texto;

  // Sem node compativel nao ha o que instalar — o fallback npx segue valendo.
  btnInst.disabled = !s.node.ok;
  btnInst.textContent = s.active
    ? t('settings.arc1.update', arc1Ultima && arc1Ultima !== s.active ? arc1Ultima : t('arc1.latest'))
    : t('settings.arc1.install');
}

async function doArc1CheckLatest(btn) {
  const label = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = t('settings.arc1.checking'); }
  const r = await window.api.arc1CheckLatest();
  if (btn) { btn.disabled = false; btn.textContent = label || t('settings.arc1.check'); }
  if (!r.ok) { setStatus('✗ ' + msgOf(r), 'err'); return; }
  arc1Ultima = r.version;
  const s = await window.api.arc1Status({ settings });
  const igual = s.ok && s.active === r.version;
  setStatus(igual ? '✓ ' + t('msg.arc1UpToDate', r.version) : '✓ ' + t('msg.arc1NewVersion', r.version),
    igual ? 'ok' : 'warn');
  renderArc1Status();
}

async function doArc1Install(btn) {
  readSettingsFromForm();
  await window.api.saveSettings(settings);

  const label = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = t('settings.arc1.installing'); }
  setStatus(t('msg.arc1Installing'));

  const res = await window.api.arc1Install({ settings, version: arc1Ultima || null });
  if (btn) { btn.disabled = false; btn.textContent = label; }
  if (res.log) lastLog = res.log;
  if (!res.ok) { setStatus('✗ ' + msgOf(res), 'err'); renderArc1Status(); return; }

  // A versao entra no CAMINHO do comando, entao as configs ja gravadas apontam
  // pra versao antiga. Regera so se houver conexao ARC-1 registrada — senao
  // seria uma varredura a toa.
  const precisam = (clients.environments || [])
    .filter(e => engineIdOf(e) === 'arc1' && globalProfiles.has(profileId(e)));
  let extra = '';
  if (precisam.length) {
    const rs = await window.api.resyncAll({ settings, envs: (clients.environments || []).map(withFolder) });
    extra = rs.ok
      ? ' — ' + t('msg.arc1Resynced', precisam.length) + ' ' + t('msg.engineRestart')
      : ' — ' + msgOf(rs);
  }
  setStatus('✓ ' + msgOf(res) + extra, 'ok');
  arc1Ultima = res.version;
  renderArc1Status();
  await refreshMcpStatus();
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
  // o estado do ARC-1 muda por fora do app (instalacao, node novo no PATH):
  // reconsulta ao abrir a tela em vez de confiar no que foi lido no boot
  if (name === 'settings') renderArc1Status();
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
// Cookie de SSO
// A janela e curta (24h nos tenants S4HC), entao "tem arquivo" nao quer dizer
// "esta logado" — o estado vem do prazo lido do proprio arquivo.
// ---------------------------------------------------------------------------
function cookieOf(id) {
  return cookieState.get(id) || { state: 'none', expiresAt: null };
}

// Texto humano do prazo: "expira em 5h", "expirou ha 3 dias".
function cookieHint(ck) {
  if (!ck || ck.state === 'none') return t('cookie.none');
  if (!ck.expiresAt) return t('cookie.valid');
  const seg = ck.expiresAt - Math.floor(Date.now() / 1000);
  const abs = Math.abs(seg);
  const quanto = abs < 3600 ? t('cookie.minutes', Math.max(1, Math.round(abs / 60)))
    : abs < 86400 ? t('cookie.hours', Math.round(abs / 3600))
    : t('cookie.days', Math.round(abs / 86400));
  return seg > 0 ? t('cookie.expiresIn', quanto) : t('cookie.expiredAgo', quanto);
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
      .filter(({ e }) => !onlyGlobal || globalProfiles.has(profileId(e)));
    // grupo sem nada a mostrar some quando ha filtro (busca ou "so habilitadas")
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
        ? (cookieOf(id).state === 'valid' ? 'ok' : 'cloud')
        : 'onprem');

      const label = document.createElement('span');
      label.className = 'conn-name';
      label.textContent = e.env_name;
      label.title = `${id} · ${e.url || ''}`;

      row.append(dot, label);

      // selo de MCP habilitado
      if (globalProfiles.has(id)) {
        const b = document.createElement('span');
        b.className = 'global-badge';
        b.textContent = '✓';
        b.title = t('card.globalBadge');
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
    const ck = cookieOf(id);
    loginBtn.className = 'btn btn-sm' + (ck.state === 'valid' ? ' btn-ok' : '');
    loginBtn.textContent = ck.state === 'valid' ? t('card.loginOk') : t('card.login');
    loginBtn.title = cookieHint(ck);
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

  // Chave do engine: um clique troca e ja regera a config se a conexao estiver
  // registrada. A primeira opcao e herdar o padrao do app.
  const drift = engineDrift(e);
  const engBox = document.createElement('span');
  engBox.className = 'dropdown';
  const engBtn = document.createElement('button');
  engBtn.className = 'btn btn-sm' + (drift ? ' btn-warn' : '');
  engBtn.textContent = t('detail.engineBtn', engineDefOf(e).label) + ' ▾';
  engBtn.title = drift ? t('detail.engineDrift', drift.from, drift.to) : t('detail.engineBtn.title');
  const engMenu = document.createElement('div');
  engMenu.className = 'menu hidden';
  const padraoDef = engineDefById(defaultEngineId());
  const escolhas = [{ id: '', label: t('engine.inherit', padraoDef ? padraoDef.label : defaultEngineId()) }]
    .concat(engineDefs.map(d => ({ id: d.id, label: d.label })));
  for (const c of escolhas) {
    const mi = document.createElement('button');
    mi.className = 'menu-item' + (((e.engine || '') === c.id) ? ' on' : '');
    mi.textContent = ((e.engine || '') === c.id ? '✓ ' : '') + c.label;
    mi.onclick = () => switchEngine(idx, c.id);
    engMenu.appendChild(mi);
  }
  engBtn.onclick = (ev) => { ev.stopPropagation(); closeMenus(engMenu); engMenu.classList.toggle('hidden'); };
  engBox.append(engBtn, engMenu);
  actions.appendChild(engBox);

  mk(t('card.test'), '', function () { doTest(e, this); });
  mk(t('card.edit'), '', () => openModal(idx));
  mk(t('card.duplicate'), '', () => duplicateEnv(idx));

  // "Habilitar MCP": um botao so. So existe escopo global — o de projeto nao
  // tem como ser pre-aprovado, entao nao ha escolha a oferecer.
  const isGlobal = globalProfiles.has(id);
  const mBtn = document.createElement('button');
  mBtn.className = 'btn btn-sm' + (isGlobal ? ' btn-ok' : '');
  mBtn.textContent = isGlobal ? '✓ ' + t('mcp.enabled') : t('mcp.enable');
  mBtn.title = isGlobal ? t('mcp.disable.title') : t('mcp.enable.title');
  mBtn.onclick = () => toggleMcp(e, isGlobal);
  actions.appendChild(mBtn);

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
    [lbl('f.auth'), authLabel(e)],
    // o engine decide o binario e as flags: e a primeira coisa a conferir quando
    // a conexao se comporta diferente do esperado
    [lbl('f.engine'), engineLabelOf(e) + (drift ? ' · ⚠ ' + t('detail.engineDrift', drift.from, drift.to) : '')],
    [lbl('f.url'), urlOfEnv(e) || '—'],
    [lbl('f.sapclient'), e.sap_client || '—'],
    [lbl('f.user'), e.auth_type !== 'cloud' ? (e.user || '—') : '—'],
    // a rota RFC so aparece onde existe: nas outras conexoes seriam tres linhas vazias
    ...(e.auth_type === 'rfc' ? [
      [lbl('f.ashost'), (e.ashost || '—') + ' · sysnr ' + (e.sysnr || '00')],
      [lbl('f.saprouter'), e.saprouter || t('detail.noRouter')],
      [lbl('f.bridgeport'), String(bridgePortOf(e))]
    ] : []),
    [lbl('f.mode'), e.mode || 'focused'],
    [lbl('f.lang'), e.language || '—'],
    // a pasta decide onde vao a config e o cookie: merece estar visivel aqui
    [lbl('f.folder'), folderOf(e.client_name) || t('detail.noFolder')],
    // so Cloud tem cookie; a janela e de 24h, entao o prazo importa
    ...(e.auth_type === 'cloud' ? [[t('detail.cookie'), cookieHint(cookieOf(id))]] : []),
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
  // RFC tambem autentica com usuario/senha, entao reaproveita o bloco Private —
  // menos o --insecure, que so faz sentido em HTTPS de verdade.
  $('onprem-fields').classList.toggle('hidden', type === 'cloud');
  $('insecure-box').classList.toggle('hidden', type !== 'onprem');
  $('rfc-fields').classList.toggle('hidden', type !== 'rfc');
  // numa RFC a URL e derivada da porta do bridge: nao ha o que digitar
  $('url-field').classList.toggle('hidden', type === 'rfc');
}
function currentAuthType() {
  return document.querySelector('input[name=auth]:checked').value;
}

// ---- seletor de engine do formulario --------------------------------------
// A primeira opcao e "herdar o padrao do app" (valor ''), e nao um engine. E o
// que faz trocar o padrao nas Configuracoes valer pras conexoes de uma vez.
function buildEngineSeg(escolhido) {
  const box = $('f-engine-seg');
  if (!box) return;
  box.innerHTML = '';
  const padrao = engineDefById(defaultEngineId());
  const opcoes = [{ id: '', label: t('engine.inherit', padrao ? padrao.label : defaultEngineId()) }]
    .concat(engineDefs.map(d => ({ id: d.id, label: d.label })));
  for (const o of opcoes) {
    const lab = document.createElement('label');
    lab.className = 'seg-opt';
    const inp = document.createElement('input');
    inp.type = 'radio';
    inp.name = 'engine';
    inp.value = o.id;
    inp.checked = (escolhido || '') === o.id;
    inp.onchange = applyEngineCaps;
    const sp = document.createElement('span');
    sp.textContent = o.label;
    lab.append(inp, sp);
    box.appendChild(lab);
  }
}
// '' = herdando. Use pra GRAVAR.
function currentEngineChoice() {
  const sel = document.querySelector('input[name=engine]:checked');
  return sel ? sel.value : '';
}
// O engine efetivo selecionado agora. Use pra decidir o que mostrar.
function currentEngineId() {
  return currentEngineChoice() || defaultEngineId();
}

// Ajusta o formulario ao engine escolhido: os modos nao sao os mesmos e nem todo
// engine tem "edits transportaveis". O rotulo que o usuario ve continua o mesmo
// (ex.: "somente leitura"); quem traduz pra flag do binario e o engine.
function applyEngineCaps() {
  const def = engineDefById(currentEngineId());
  const caps = (def && def.caps) || {};

  const modos = caps.modes || ['focused', 'expert', 'hyperfocused'];
  const sel = $('f-mode');
  const antes = sel.value;
  sel.innerHTML = '';
  for (const m of modos) {
    const o = document.createElement('option');
    o.value = m;
    o.textContent = t('mode.' + m);
    sel.appendChild(o);
  }
  // mantem a escolha do usuario quando o modo existe nos dois engines
  sel.value = modos.includes(antes) ? antes : modos[0];

  // sem equivalente no engine: esconder e melhor que oferecer um check morto
  const caixa = $('f-transp-edit').closest('.check');
  if (caixa) caixa.classList.toggle('hidden', caps.transportableEdits === false);

  const hint = $('f-engine-hint');
  if (hint) {
    const avisos = [];
    if (caps.browserAuth === false) avisos.push(t('engine.noBrowserAuth'));
    if (caps.cliTest === false)     avisos.push(t('engine.noCliTest'));
    hint.textContent = avisos.length
      ? def.label + ' — ' + avisos.join(' ')
      : t('f.engine.hint');
  }
}

// Seleciona um modo respeitando as opcoes do engine atual (o modo salvo pode
// nao existir no engine novo).
function setModeValue(modo) {
  const sel = $('f-mode');
  const existe = [...sel.options].some(o => o.value === modo);
  sel.value = existe ? modo : (sel.options[0] ? sel.options[0].value : '');
}

// Mostrar/esconder a senha da conexao Private. Volta pra escondida sempre que
// o modal abre — senao a senha de um cliente ficaria a vista ao editar o proximo.
function setPassVisible(mostrar) {
  const campo = $('f-pass'), btn = $('f-pass-eye');
  if (!campo || !btn) return;
  campo.type = mostrar ? 'text' : 'password';
  btn.textContent = t(mostrar ? 'f.pass.hide' : 'f.pass.show');
  btn.title = t(mostrar ? 'f.pass.hide.title' : 'f.pass.show.title');
  btn.classList.toggle('on', mostrar);
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
  setPassVisible(false); // toda vez que o modal abre a senha volta escondida
  // on-prem self-signed e a regra → liga por padrao em conexao nova
  $('f-insecure').checked = e ? !!e.insecure : true;
  $('f-ashost').value    = e ? (e.ashost || '') : '';
  $('f-sysnr').value     = e ? (e.sysnr || '') : '00';
  $('f-saprouter').value = e ? (e.saprouter || '') : '';
  // conexao nova ja nasce numa porta livre; editando, mantem a dela
  $('f-bridgeport').value = (e && e.bridge_port) ? e.bridge_port : nextBridgePort(editIndex);
  // engine ANTES do modo: as opcoes de modo dependem de qual engine esta escolhido
  buildEngineSeg(e ? (e.engine || '') : '');
  applyEngineCaps();
  setModeValue(e ? (e.mode || 'focused') : 'focused');
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
    // RFC: a URL aponta pro bridge local, derivada da porta — nao ha campo pra ela
    url:         authType === 'rfc'
      ? 'http://127.0.0.1:' + (parseInt($('f-bridgeport').value, 10) || BRIDGE_PORT_BASE)
      : $('f-url').value.trim(),
    ashost:      $('f-ashost').value.trim(),
    sysnr:       $('f-sysnr').value.trim() || '00',
    saprouter:   $('f-saprouter').value.trim(),
    bridge_port: parseInt($('f-bridgeport').value, 10) || BRIDGE_PORT_BASE,
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
  // Vazio = herda o padrao do app. Grava a CHAVE so quando o usuario escolheu,
  // pra trocar o padrao continuar valendo pra quem nunca escolheu nada.
  const engEscolhido = currentEngineChoice();
  if (engEscolhido) e.engine = engEscolhido;

  // validacao
  if (!e.client_name || !e.env_name || !e.url || !e.sap_client) {
    appAlert(t('alert.required')).then(() => {
      const campos = authType === 'rfc'
        ? ['f-client', 'f-env', 'f-sapclient']
        : ['f-client', 'f-env', 'f-url', 'f-sapclient'];
      const first = campos.find(id2 => !$(id2).value.trim());
      if (first) $(first).focus();
    });
    return;
  }
  if (authType !== 'cloud' && !e.user) {
    appAlert(t('alert.onpremUser')).then(() => $('f-user').focus());
    return;
  }
  if (authType === 'rfc') {
    if (!e.ashost) {
      appAlert(t('alert.rfcAshost')).then(() => $('f-ashost').focus());
      return;
    }
    // porta repetida faria esta conexao falar com o bridge da outra, calada
    const conflito = (clients.environments || []).find((x, i) =>
      x.auth_type === 'rfc' && i !== editIndex && bridgePortOf(x) === e.bridge_port);
    if (conflito) {
      appAlert(t('alert.rfcPort', e.bridge_port, profileId(conflito))).then(() => $('f-bridgeport').focus());
      return;
    }
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
async function openImport(mode) {
  importMode = (mode === 'form') ? 'form' : 'new';
  setStatus(t('import.loading'));
  const res = await window.api.sapLandscape();
  if (!res.ok) { setStatus('✗ ' + msgOf(res), 'err'); return; }
  landscapeCache = res;
  // com <Include> o landscape pode vir de mais de um arquivo; so vale dizer quando ha
  const extras = ((res.files || []).length - 1);
  $('import-source').textContent = extras > 0
    ? t('import.sourceMulti', res.file, res.count, extras)
    : t('import.source', res.file, res.count);
  $('import-title').textContent = t(importMode === 'form' ? 'import.titleFill' : 'import.title');
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
  // aberto de dentro do formulario: preenche a conexao atual em vez de criar outra
  if (importMode === 'form') { fillFormFrom(group, svc); return; }

  // Conexao com SAProuter no SAP GUI e justamente o caso em que o HTTP direto
  // costuma nao existir. E o arquivo do SAP ja traz TUDO que o bridge precisa:
  // a rota, o host e a instancia (derivada da porta DIAG 32NN).
  const viaRouter = !!svc.router;
  const prefill = viaRouter
    ? {
        client_name: group.name || '',
        env_name: svc.name || svc.systemid || '',
        auth_type: 'rfc',
        sap_client: '',
        ashost: svc.host || svc.server || '',
        sysnr: svc.instance || '00',
        saprouter: svc.router,
        bridge_port: nextBridgePort(-1)
      }
    : {
        client_name: group.name || '',
        env_name: svc.name || svc.systemid || '',
        auth_type: 'onprem',
        url: svc.url || '',
        sap_client: '',
        insecure: true
      };

  openModal(-1, { prefill, focus: 'f-sapclient' }); // o mandante e o que o arquivo do SAP nao tem

  if (viaRouter) {
    setStatus(t('import.router', svc.router), 'warn');
    return;
  }
  // a URL e derivada da porta DIAG por convencao (32NN -> 80NN): avisa pra conferir
  setStatus(svc.url
    ? t('import.check', svc.server, svc.url)
    : t('import.noPort', svc.server), 'warn');
}

// Preenche o formulario JA ABERTO com o sistema escolhido.
//
// So escreve o que o arquivo do SAP GUI realmente sabe: servidor, instancia e
// rota. Cliente e ambiente so entram se estiverem vazios (editando uma conexao,
// o nome que voce deu vale mais que o do SAP GUI), e usuario/senha/pasta nunca
// sao tocados.
function fillFormFrom(group, svc) {
  if (!$('f-client').value.trim() && group.name) {
    $('f-client').value = group.name;
    onClientChanged();
  }
  if (!$('f-env').value.trim()) $('f-env').value = svc.name || svc.systemid || '';

  $('f-ashost').value    = svc.host || svc.server || '';
  $('f-sysnr').value     = svc.instance || '00';
  $('f-saprouter').value = svc.router || '';
  if (svc.url) $('f-url').value = svc.url;

  const rotulo = svc.name || svc.systemid || '';
  if (svc.router) {
    // ter router e justamente o caso em que o HTTP direto costuma nao existir
    setAuthType('rfc');
    if (!$('f-bridgeport').value.trim()) $('f-bridgeport').value = nextBridgePort(editIndex);
    setStatus(t('import.filledRfc', rotulo, svc.router), 'warn');
  } else {
    // sem router NAO troca o tipo: pode ter sido escolha deliberada do usuario
    setStatus(svc.url ? t('import.filled', rotulo, svc.url) : t('import.filledNoPort', rotulo), 'warn');
  }
  syncFolderHint();
}

// ---------------------------------------------------------------------------
// Acoes principais
// ---------------------------------------------------------------------------
// Sufixo do status contando os processos vsp derrubados.
// vspKilled: numero derrubado; null = derrubou mas nao da pra contar (pkill).
function killedNote(res) {
  if (!res || !res.ok) return '';
  const notas = [];
  if (res.vspKilled === null)   notas.push(t('msg.vspKilledSome'));
  else if (res.vspKilled > 0)   notas.push(t('msg.vspKilled', res.vspKilled));
  if (res.bridgeKilled === null) notas.push(t('msg.bridgeKilledSome'));
  else if (res.bridgeKilled > 0) notas.push(t('msg.bridgeKilled', res.bridgeKilled));
  return notas.length ? ' — ' + notas.join(', ') : '';
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

// (Re)grava a config global DESTA conexao e os arquivos de apoio da pasta.
// Extraida do toggleMcp porque a troca de engine precisa do mesmo caminho: sem
// regravar, o ~/.claude.json continuaria com o comando do engine antigo.
async function regenerateGlobal(env, dir) {
  // TODAS as conexoes que dividem esta pasta: o .vsp.json lista todas, e
  // gravar so a clicada apagaria as outras do arquivo
  const daPasta = (clients.environments || []).filter(x => folderOf(x.client_name) === dir);
  const res = await window.api.generateGlobal({ settings, env: withFolder(env), envs: daPasta.map(withFolder) });
  // Codex le MCP so do config global dele: acompanha na mesma acao
  if (res.ok) {
    const todas = (clients.environments || []).filter(x => globalProfiles.has(profileId(x)) || profileId(x) === profileId(env));
    await window.api.syncCodex({ settings, envs: todas.map(withFolder) });
  }
  return res;
}

// Liga/desliga o MCP da conexao (escopo global).
async function toggleMcp(env, jaAtivo) {
  closeMenus();
  readSettingsFromForm();
  await window.api.saveSettings(settings);

  // a pasta e onde fica o cookie e os arquivos de apoio do workspace
  const dir = await ensureFolder(env.client_name);
  if (!dir) { setStatus(t('msg.folderNeeded', env.client_name), 'warn'); return; }

  let res;
  if (jaAtivo) {
    res = (await appConfirm(t('confirm.globalRemove', profileId(env))))
      ? await window.api.removeGlobal({ settings, env: withFolder(env) })
      : null;
  } else {
    res = await regenerateGlobal(env, dir);
  }
  if (!res) return; // usuario cancelou a confirmacao

  setStatus((res.ok ? '✓ ' : '✗ ') + msgOf(res) + killedNote(res), res.ok ? 'ok' : 'err');
  await refreshMcpStatus();
}

// Troca o engine de UMA conexao. '' = voltar a herdar o padrao do app.
//
// Se a conexao ja estiver registrada, regrava a config na hora — senao a troca
// ficaria so no clients.json e o host MCP continuaria subindo o engine antigo,
// que e exatamente o tipo de divergencia silenciosa que da suporte.
async function switchEngine(idx, escolha) {
  closeMenus();
  const env = (clients.environments || [])[idx];
  if (!env) return;
  if ((env.engine || '') === (escolha || '')) return; // ja e esse: nao faz nada

  const antes = engineIdOf(env);
  const cruAntes = env.engine;   // valor CRU (undefined = herdava o padrao)
  if (escolha) env.engine = escolha; else delete env.engine;
  await persistClients();
  const depois = engineIdOf(env);

  // Nao registrada: nao ha config pra corrigir, a proxima geracao ja sai certa.
  if (!globalProfiles.has(profileId(env))) {
    setStatus(t('msg.engineSet', profileId(env), engineDefOf(env).label), 'ok');
    render();
    return;
  }

  const dir = await ensureFolder(env.client_name);
  if (!dir) { setStatus(t('msg.folderNeeded', env.client_name), 'warn'); render(); return; }
  const res = await regenerateGlobal(env, dir);

  // A config foi RECUSADA (ex.: ARC-1 sem Node). Manter a escolha nova no
  // clients.json deixaria a tela dizendo um engine e o host subindo outro --
  // exatamente a divergencia silenciosa que o resto desta funcao evita. Volta
  // a escolha anterior pra tela e arquivo continuarem contando a mesma historia.
  if (!res.ok) {
    if (cruAntes === undefined) delete env.engine; else env.engine = cruAntes;
    await persistClients();
    setStatus('✗ ' + msgOf(res), 'err');
    render();
    await refreshMcpStatus();
    return;
  }

  // Trocar o COMANDO nao basta derrubar o processo: o host guarda a linha de
  // comando antiga e respawnaria o engine velho. Aqui o restart e obrigatorio.
  const nota = (antes !== depois) ? ' — ' + t('msg.engineRestart') : '';
  setStatus('✓ ' + msgOf(res) + killedNote(res) + nota, 'ok');
  await refreshMcpStatus();
}

// Exporta as conexoes num JSON sem senha, pra levar pra outra maquina.
async function doConnsExport(btn) {
  if (btn) btn.disabled = true;
  const res = await window.api.connsExport();
  if (btn) btn.disabled = false;
  // cancelar no dialogo nao e erro: nao pinta de vermelho por isso
  if (res && res.key === 'be.exportCanceled') return;
  setStatus((res.ok ? '✓ ' : '✗ ') + msgOf(res), res.ok ? 'ok' : 'err');
}

// Importa o JSON e remonta as pastas sob a raiz escolhida. Conexao que ja existe
// aqui e preservada: ela tem senha, o pacote nao.
async function doConnsImport(btn) {
  if (btn) btn.disabled = true;
  const res = await window.api.connsImport();
  if (btn) btn.disabled = false;
  if (res && res.key === 'be.importCanceled') return;
  setStatus((res.ok ? '✓ ' : '✗ ') + msgOf(res), res.ok ? 'ok' : 'err');
  if (res && res.ok) {
    clients = await window.api.loadClients();
    render();
    await refreshMcpStatus();
  }
}

// Varredura: regrava a config de TODAS as conexoes ja registradas.
// E o par do seletor de engine padrao — trocar o padrao so muda o que sera
// gerado dali pra frente; isto alcanca o que ja estava no ~/.claude.json.
async function doResyncAll(btn) {
  readSettingsFromForm();
  await window.api.saveSettings(settings);

  const envs = (clients.environments || []).map(withFolder);
  if (!envs.length) { setStatus(t('msg.resyncEmpty'), 'warn'); return; }

  const label = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = t('settings.resyncing'); }
  const res = await window.api.resyncAll({ settings, envs });

  let extra = '';
  if (res.ok && res.switched && res.switched.length) {
    extra += ' — ' + t('msg.resyncSwitched', res.switched.length) + ': ' +
      res.switched.map(s => `${s.id} (${s.from} → ${s.to})`).join(', ') +
      '. ' + t('msg.engineRestart');
  }
  if (res.ok && res.skipped && res.skipped.length) {
    extra += ' — ' + t('msg.resyncSkipped', res.skipped.join(', '));
  }
  // Fora da varredura por nao ter como rodar. Vai com o MOTIVO de cada uma:
  // so a lista de nomes deixaria o usuario adivinhando o que faltou instalar.
  if (res.ok && res.blocked && res.blocked.length) {
    extra += ' — ' + t('msg.resyncBlocked',
      res.blocked.map(b => b.id + ' (' + msgOf(b) + ')').join('; '));
  }
  setStatus((res.ok ? '✓ ' : '✗ ') + msgOf(res) + killedNote(res) + extra, res.ok ? 'ok' : 'err');
  if (btn) { btn.disabled = false; btn.textContent = label || t('settings.resync'); }
  await refreshMcpStatus();
}

// Quais conexoes estao habilitadas no escopo global (~/.claude.json).
// Alimenta o selo, o filtro e o botao do detalhe.
async function refreshMcpStatus() {
  try {
    const res = await window.api.globalStatus();
    globalProfiles.clear();
    globalEngines.clear();
    for (const p of (res.profiles || [])) globalProfiles.add(p);
    // qual engine gerou cada entrada — alimenta o aviso de config desatualizada
    for (const [p, eng] of Object.entries(res.engines || {})) globalEngines.set(p, eng);
  } catch (e) { /* sem status: segue sem selo */ }

  // conta so as conexoes DAQUI — o ~/.claude.json pode ter servers de terceiros
  const meus = (clients.environments || []).filter(e => globalProfiles.has(profileId(e))).length;
  const badge = $('global-count');
  if (badge) badge.textContent = meus;
  render();
}

async function doTest(env, btn) {
  readSettingsFromForm();
  await window.api.saveSettings(settings);

  // conexao Public le o cookie da pasta do cliente; sem ela o teste nem comeca
  if (env.auth_type === 'cloud' && !await ensureFolder(env.client_name)) {
    setStatus(t('msg.folderNeeded', env.client_name), 'warn');
    return;
  }
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

  // O cookie do SSO e gravado na pasta do cliente. Sem pasta nao ha onde
  // salvar, entao pede na hora em vez de so avisar e nao fazer nada.
  if (!await ensureFolder(env.client_name)) {
    setStatus(t('msg.folderNeeded', env.client_name), 'warn');
    return;
  }
  setStatus(t('msg.loginStart', profileId(env)));
  if (btn) { btn.disabled = true; btn.textContent = t('card.logging'); }
  const res = await window.api.vspLogin({ settings, env: withFolder(env) });
  setStatus((res.ok ? '✓ ' : '✗ ') + msgOf(res) + killedNote(res), res.ok ? 'ok' : 'err');
  if (res.log) lastLog = res.log;

  const id = profileId(env);
  if (res.ok) cookieState.set(id, { state: 'valid', expiresAt: null }); else cookieState.delete(id);
  if (btn) {
    btn.disabled = false;
    btn.classList.toggle('btn-ok', res.ok);
    btn.textContent = res.ok ? t('card.loginOk') : t('card.login');
  }

  // Nada mais a fazer: o main ja derrubou o vsp velho ao salvar o cookie, entao
  // o host sobe com o cookie novo sozinho. A config nao muda — ela guarda o
  // CAMINHO do cookie, e o arquivo e o mesmo de sempre.
}

// ---------------------------------------------------------------------------
// Diagnostico do bridge RFC
//
// A cadeia SDK x64 <-> Python x64 <-> pyrfc falha sempre com o mesmo traceback
// ilegivel. Aqui cada elo vira uma linha com o motivo e o que fazer.
// ---------------------------------------------------------------------------
const DIAG_ORDER = ['python', 'sdk', 'pyrfc', 'scripts', 'vsp'];

async function doDiagnose(btn) {
  readSettingsFromForm();
  await window.api.saveSettings(settings);

  const box = $('diag-box');
  box.classList.remove('hidden');
  box.textContent = t('diag.running');
  if (btn) btn.disabled = true;

  const res = await window.api.bridgeDiagnose({ settings });

  if (btn) btn.disabled = false;
  box.innerHTML = '';
  const checks = (res.checks || []).slice()
    .sort((a, b) => DIAG_ORDER.indexOf(a.id) - DIAG_ORDER.indexOf(b.id));

  for (const c of checks) {
    const row = document.createElement('div');
    row.className = 'diag-row ' + (c.ok ? 'ok' : 'err');

    const icon = document.createElement('span');
    icon.className = 'diag-icon';
    icon.textContent = c.ok ? '✓' : '✗';

    const txt = document.createElement('div');
    const nome = document.createElement('div');
    nome.className = 'diag-name';
    nome.textContent = t('diag.' + c.id);
    txt.appendChild(nome);

    if (c.detail) {
      const d = document.createElement('div');
      d.className = 'diag-detail';
      d.textContent = c.detail;
      txt.appendChild(d);
    }
    if (!c.ok) {
      const h = document.createElement('div');
      h.className = 'diag-hint';
      // o backend pode mandar uma dica mais especifica que a padrao do check.
      // innerHTML aqui e seguro: a dica e string do dicionario, sem interpolacao
      // de dado externo. O DETALHE, logo acima, e saida crua de subprocesso e
      // continua como textContent de proposito.
      h.innerHTML = t(c.hintKey || ('diag.' + c.id + '.hint'));
      txt.appendChild(h);
    }
    row.append(icon, txt);
    box.appendChild(row);
  }
  setStatus((res.ok ? '✓ ' : '✗ ') + t(res.ok ? 'diag.allOk' : 'diag.someFail'), res.ok ? 'ok' : 'err');
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
  } else if (kind === 'python') {
    const p = await window.api.pickFile({ title: t('pick.python'), filters: exeFilters });
    if (p) $('set-python').value = p;
  } else if (kind === 'node') {
    const p = await window.api.pickFile({ title: t('pick.node'), filters: exeFilters });
    if (p) $('set-node').value = p;
  } else if (kind === 'nwrfclib') {
    const p = await window.api.pickFolder({ title: t('pick.nwrfc') });
    if (p) $('set-nwrfc').value = p;
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
  $('btn-diagnose').onclick = function () { doDiagnose(this); };
  $('btn-resync').onclick = function () { doResyncAll(this); };
  $('btn-conns-export').onclick = function () { doConnsExport(this); };
  $('btn-conns-import').onclick = function () { doConnsImport(this); };
  $('btn-arc1-install').onclick = function () { doArc1Install(this); };
  $('btn-arc1-check').onclick   = function () { doArc1CheckLatest(this); };
  // o npm baixa ~83 MB: sem eco, o botao ficaria mudo por um minuto
  window.api.onArc1Progress((linha) => {
    const l = String(linha || '').trim().split('\n').pop();
    if (l) setStatus(t('settings.arc1.installing') + ' — ' + l.slice(0, 120));
  });
  // trocar o engine padrao muda o que as conexoes que HERDAM vao usar: o
  // detalhe precisa refletir isso na hora, mesmo antes de salvar
  $('set-engine').onchange = () => {
    settings.default_engine = $('set-engine').value;
    render();
  };
  document.querySelectorAll('[data-pick]').forEach(btn => {
    btn.onclick = () => pick(btn.getAttribute('data-pick'));
  });

  // conexoes
  $('btn-new').onclick       = () => openModal(-1);
  $('btn-new-group').onclick = newGroup;
  $('btn-import').onclick    = () => openImport('new');
  $('f-import').onclick      = () => openImport('form');
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
  $('f-pass-eye').onclick = () => setPassVisible($('f-pass').type === 'password');

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
    const res = await window.api.cookiesStatus({ settings, envs: (clients.environments || []).map(withFolder) });
    cookieState.clear();
    for (const [id, ck] of Object.entries((res && res.statuses) || {})) cookieState.set(id, ck);
    render();
    // vencidos sao apagados na varredura; avisa, senao o arquivo some calado
    const n = ((res && res.purged) || []).length;
    if (n) setStatus(t('cookie.purged', n), 'warn');
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
  // ANTES do fillSettings/render: o seletor de engine e os rotulos de "herdado"
  // dependem desta lista. Sem ela o app ainda abre, so que sem seletor.
  try {
    const r = await window.api.enginesList();
    engineDefs = (r && r.engines) || [];
  } catch (e) { engineDefs = []; }
  window.i18n.setLang(settings.lang || 'en'); // ingles por padrao
  fillSettings();
  renderArc1Status(); // sem await: nao segura o boot se o node demorar a responder
  render();
  await refreshCookieStatus();
  await refreshMcpStatus();
  await initUpdates();
  setStatus(t('status.ready'));
}

init();
