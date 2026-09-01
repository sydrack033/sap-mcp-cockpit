'use strict';

// ---------------------------------------------------------------------------
// Helpers compartilhados entre o main e os engines (lib/engines/*).
//
// Vivem fora do main.js por uma razao pratica: os engines precisam deles, e se
// ficassem no main o require viraria circular (main -> engine -> main). Aqui
// nada depende de electron nem de estado do app -- so fs/path e o objeto da
// conexao -- entao qualquer lado pode importar sem ordem definida.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');

const BRIDGE_PORT_BASE = 8410;

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

// Caminho do arquivo de cookie de um ambiente Cloud na pasta do projeto.
// Fica aqui e nao no engine porque o formato e Netscape cookie jar (o mesmo do
// curl) -- vsp e ARC-1 leem os dois o mesmo arquivo.
function cookieFileFor(projectPath, env) {
  return path.join(projectPath, `cookies-${envIdOf(env)}.txt`);
}

// Estado do cookie de um ambiente Cloud.
//
// O jar tem uma coluna de expiracao em epoch:
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

// A pasta de uma conexao. O renderer manda ela junto no payload (campo
// transiente `folder`), porque quem conhece o mapa cliente->pasta e ele.
function folderOfEnv(e, fallback) {
  return (e && e.folder) || fallback || '';
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

module.exports = {
  BRIDGE_PORT_BASE,
  readJson, writeJson,
  slug, envIdOf,
  cookieFileFor, cookieStatusOf, cookieExists, purgeCookie,
  folderOfEnv, bridgePortOf, urlOf
};
