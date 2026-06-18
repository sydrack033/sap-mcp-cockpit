'use strict';

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------
let settings = {};
let clients = { environments: [] };
let editIndex = -1; // -1 = novo
const loggedIn = new Set(); // profile ids com login SSO OK nesta sessao

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
  renderEnvs();
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
// Settings
// ---------------------------------------------------------------------------
function fillSettings() {
  $('set-vsp').value     = settings.vsp_path || '';
  $('set-project').value = settings.project_path || '';
  $('set-chrome').value  = settings.chrome_path || '';
  $('set-vscode').value  = settings.vscode_cmd || 'code';
}
function readSettingsFromForm() {
  settings.vsp_path     = $('set-vsp').value.trim();
  settings.project_path = $('set-project').value.trim();
  settings.chrome_path  = $('set-chrome').value.trim();
  settings.vscode_cmd   = $('set-vscode').value.trim() || 'code';
}

async function saveSettings() {
  readSettingsFromForm();
  await window.api.saveSettings(settings);
  setStatus(t('msg.settingsSaved'), 'ok');
}

// ---------------------------------------------------------------------------
// Render lista de ambientes
// ---------------------------------------------------------------------------
function renderEnvs() {
  const list = $('env-list');
  const all = clients.environments || [];
  list.innerHTML = '';
  $('env-count').textContent = all.length;

  // filtro de busca (cliente / ambiente / url / profile)
  const q = ($('env-search') && $('env-search').value || '').trim().toLowerCase();
  const matches = (e) => !q ||
    `${e.client_name} ${e.env_name} ${e.url || ''} ${profileId(e)}`.toLowerCase().includes(q);

  let shown = 0;
  // itera sobre a lista COMPLETA pra preservar o indice real (usado em editar/remover)
  all.forEach((e, idx) => {
    if (!matches(e)) return;
    shown++;
    const card = document.createElement('div');
    card.className = 'env-card';

    const info = document.createElement('div');
    info.className = 'info';

    const title = document.createElement('div');
    title.className = 'title';
    const b = document.createElement('b');
    b.textContent = `${e.client_name} · ${e.env_name}`;
    title.appendChild(b);

    const tag = document.createElement('span');
    tag.className = 'tag ' + (e.auth_type === 'cloud' ? 'cloud' : 'onprem');
    tag.textContent = e.auth_type === 'cloud' ? t('tag.cloud') : t('tag.onprem');
    title.appendChild(tag);

    if (e.read_only) {
      const ro = document.createElement('span');
      ro.className = 'tag ro';
      ro.textContent = t('tag.ro');
      title.appendChild(ro);
    }

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.innerHTML = `<span class="profile-id">${profileId(e)}</span> &middot; ${t('meta.client')} ${e.sap_client || '?'} &middot; ${e.url || ''}`;

    info.appendChild(title);
    info.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'actions';

    if (e.auth_type === 'cloud') {
      const loginBtn = document.createElement('button');
      loginBtn.className = 'btn btn-sm';
      if (loggedIn.has(profileId(e))) {
        loginBtn.classList.add('btn-ok');
        loginBtn.textContent = t('card.loginOk');
      } else {
        loginBtn.textContent = t('card.login');
      }
      loginBtn.onclick = () => doLogin(e, loginBtn);
      actions.appendChild(loginBtn);
    }

    const testBtn = document.createElement('button');
    testBtn.className = 'btn btn-sm';
    testBtn.textContent = t('card.test');
    testBtn.onclick = () => doTest(e, testBtn);
    actions.appendChild(testBtn);

    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn-sm';
    editBtn.textContent = t('card.edit');
    editBtn.onclick = () => openModal(idx);
    actions.appendChild(editBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-sm btn-ghost';
    delBtn.textContent = t('card.remove');
    delBtn.onclick = () => removeEnv(idx);
    actions.appendChild(delBtn);

    card.appendChild(info);
    card.appendChild(actions);
    list.appendChild(card);
  });

  // mensagem de vazio: nada cadastrado vs busca sem resultado
  const empty = $('env-empty');
  if (all.length === 0) {
    empty.innerHTML = t('envs.empty');
    empty.classList.remove('hidden');
  } else if (shown === 0) {
    empty.textContent = t('envs.noMatch');
    empty.classList.remove('hidden');
  } else {
    empty.classList.add('hidden');
  }
}

async function persistClients() {
  await window.api.saveClients(clients);
}

async function removeEnv(idx) {
  const e = clients.environments[idx];
  if (!confirm(t('confirm.remove', `${e.client_name} · ${e.env_name}`))) return;
  clients.environments.splice(idx, 1);
  await persistClients();
  renderEnvs();
  setStatus(t('msg.envRemoved'), 'ok');
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

function openModal(idx) {
  editIndex = (typeof idx === 'number') ? idx : -1;
  const e = editIndex >= 0 ? clients.environments[editIndex] : null;

  $('modal-title').textContent = e ? t('modal.edit') : t('modal.new');
  $('f-client').value    = e ? e.client_name : '';
  $('f-env').value       = e ? e.env_name : '';
  $('f-url').value       = e ? e.url : '';
  $('f-sapclient').value = e ? (e.sap_client || '') : '100';
  $('f-user').value      = e ? (e.user || '') : '';
  $('f-pass').value      = e ? (e.password || '') : '';
  $('f-insecure').checked = e ? !!e.insecure : true; // on-prem self-signed e a regra → liga por padrao
  $('f-mode').value      = e ? (e.mode || 'focused') : 'focused';
  $('f-lang').value      = e ? (e.language || '') : '';
  $('f-readonly').checked    = e ? !!e.read_only : false;
  $('f-transp-edit').checked = e ? !!e.allow_transportable_edits : true;
  $('f-transp').checked      = e ? !!e.enable_transports : true;

  setAuthType(e ? e.auth_type : 'onprem');
  $('modal').classList.remove('hidden');
}

function closeModal() { $('modal').classList.add('hidden'); }

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
    alert(t('alert.required'));
    return;
  }
  if (authType === 'onprem' && !e.user) {
    alert(t('alert.onpremUser'));
    return;
  }

  // checa profile id duplicado
  const id = profileId(e);
  const dup = clients.environments.findIndex((x, i) => profileId(x) === id && i !== editIndex);
  if (dup >= 0) {
    alert(t('alert.dup', id));
    return;
  }

  if (editIndex >= 0) {
    clients.environments[editIndex] = e;
  } else {
    clients.environments.push(e);
  }
  await persistClients();
  renderEnvs();
  closeModal();
  setStatus(t('msg.envSaved', id), 'ok');
}

// ---------------------------------------------------------------------------
// Acoes principais
// ---------------------------------------------------------------------------
async function generateConfigs() {
  readSettingsFromForm();
  await window.api.saveSettings(settings);
  if (!settings.project_path) { setStatus(t('err.noProject'), 'err'); return; }
  if (!clients.environments.length) { setStatus(t('err.noEnvs'), 'err'); return; }

  setStatus(t('msg.generating'));
  const res = await window.api.generateConfigs({ settings, clients });
  setStatus((res.ok ? '✓ ' : '✗ ') + msgOf(res), res.ok ? 'ok' : 'err');
}

async function openVscode() {
  readSettingsFromForm();
  await window.api.saveSettings(settings);
  setStatus(t('msg.openingVscode'));
  const res = await window.api.openVscode(settings);
  setStatus((res.ok ? '✓ ' : '✗ ') + msgOf(res), res.ok ? 'ok' : 'err');
}

async function openFolder() {
  readSettingsFromForm();
  const res = await window.api.openFolder(settings);
  if (!res.ok) setStatus('✗ ' + msgOf(res), 'err');
}

async function doTest(env, btn) {
  readSettingsFromForm();
  await window.api.saveSettings(settings);
  if (!settings.project_path) { setStatus(t('err.noProject'), 'err'); return; }
  const label = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = t('card.testing'); }
  setStatus(`${t('card.testing')} ${profileId(env)}`);
  const res = await window.api.vspTest({ settings, env });
  setStatus((res.ok ? '✓ ' : '✗ ') + msgOf(res), res.ok ? 'ok' : 'err');
  if (res.log) lastLog = res.log;
  if (btn) { btn.disabled = false; btn.textContent = label || t('card.test'); }
}

async function doLogin(env, btn) {
  readSettingsFromForm();
  await window.api.saveSettings(settings);
  if (!settings.project_path) { setStatus(t('err.loginNoProject'), 'err'); return; }
  setStatus(t('msg.loginStart', profileId(env)));
  if (btn) { btn.disabled = true; btn.textContent = t('card.logging'); }
  const res = await window.api.vspLogin({ settings, env });
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
  } else if (kind === 'project') {
    const p = await window.api.pickFolder({ title: t('pick.project') });
    if (p) $('set-project').value = p;
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
  $('btn-generate').onclick = generateConfigs;
  $('btn-vscode').onclick   = openVscode;
  $('btn-folder').onclick   = openFolder;

  // settings
  $('btn-save-settings').onclick = saveSettings;
  document.querySelectorAll('[data-pick]').forEach(btn => {
    btn.onclick = () => pick(btn.getAttribute('data-pick'));
  });

  // collapse settings panel
  document.querySelectorAll('.panel-head[data-toggle]').forEach(h => {
    h.onclick = () => {
      const body = $(h.getAttribute('data-toggle'));
      body.classList.toggle('hidden');
      h.classList.toggle('collapsed');
    };
  });

  // env
  $('btn-new').onclick = () => openModal(-1);
  $('env-search').oninput = renderEnvs;

  // modal
  $('modal-close').onclick  = closeModal;
  $('modal-cancel').onclick = closeModal;
  $('modal-save').onclick   = saveEnv;
  document.querySelectorAll('input[name=auth]').forEach(r => {
    r.onchange = () => setAuthType(currentAuthType());
  });

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
  if (!settings.project_path) return;
  try {
    const status = await window.api.cookiesStatus({ settings, envs: clients.environments });
    for (const [id, has] of Object.entries(status || {})) {
      if (has) loggedIn.add(id); else loggedIn.delete(id);
    }
    renderEnvs();
  } catch (e) { /* ignora */ }
}

async function init() {
  bind();
  settings = await window.api.loadSettings();
  clients  = await window.api.loadClients();
  if (!clients.environments) clients.environments = [];
  window.i18n.setLang(settings.lang || 'en'); // ingles por padrao
  fillSettings();
  renderEnvs();
  await refreshCookieStatus();
  setStatus(t('status.ready'));
}

init();
