'use strict';

// ---------------------------------------------------------------------------
// Registry de engines.
//
// Um "engine" e o cliente ADT que vira servidor MCP. Hoje so existe o `vsp`;
// a ideia e que somar o ARC-1 seja criar `arc1.js` do lado e registrar aqui --
// sem `if (engine === ...)` espalhado pelo main.
//
// Escolha por conexao, com heranca:
//   env.engine              -> 'vsp' | 'arc1' (undefined = herda)
//   settings.default_engine -> default do app (undefined = 'vsp')
// Conexoes antigas nao tem nenhum dos dois e caem no 'vsp': zero migracao.
// ---------------------------------------------------------------------------

const vsp = require('./vsp');
const arc1 = require('./arc1');

const DEFAULT_ENGINE_ID = 'vsp';

const ENGINES = {
  [vsp.id]: vsp,
  [arc1.id]: arc1
};

function list() {
  return Object.values(ENGINES);
}

function byId(id) {
  return ENGINES[id] || ENGINES[DEFAULT_ENGINE_ID];
}

// O engine de uma conexao. Aceita env nulo (cai no default do app).
function engineOf(settings, env) {
  return byId((env && env.engine) || (settings && settings.default_engine) || DEFAULT_ENGINE_ID);
}

// Descricao serializavel dos engines pro renderer (ele nao consegue require em
// lib/, entao isto viaja por IPC). E o que faz o seletor da UI se adaptar.
function describe() {
  return list().map(e => ({ id: e.id, label: e.label, caps: e.caps }));
}

// Qual engine gerou uma entrada de server MCP que ja esta no ~/.claude.json.
//
// E INFERENCIA, nao um campo gravado: de proposito nao sujamos o arquivo do
// usuario com metadado nosso. Serve pra UI avisar "a config registrada nao e a
// do engine selecionado" e oferecer a re-sincronizacao.
//
// Nas conexoes RFC o comando e o Python (launcher) e o cliente real fica em
// env.ADT_CLIENT -- por isso ele entra na busca.
function engineOfEntry(entry) {
  if (!entry) return null;
  const args = Array.isArray(entry.args) ? entry.args : [];
  const alvo = [entry.command || '', args.join(' '), (entry.env && entry.env.ADT_CLIENT) || ''].join(' ');
  if (/arc-?1/i.test(alvo) || args.includes('--server-name')) return ENGINES.arc1 || null;
  return ENGINES[DEFAULT_ENGINE_ID] || null;
}

// Agrupa as conexoes por engine, preservando a ordem de entrada. Usado onde um
// artefato e da PASTA e nao da conexao (CLAUDE.md/AGENTS.md), porque uma pasta
// pode acabar com conexoes de engines diferentes.
// Devolve [{ engine, envs }]; com um engine so, e um grupo unico.
function groupByEngine(settings, envs) {
  const grupos = new Map();
  for (const e of (envs || [])) {
    const eng = engineOf(settings, e);
    if (!grupos.has(eng.id)) grupos.set(eng.id, { engine: eng, envs: [] });
    grupos.get(eng.id).envs.push(e);
  }
  return [...grupos.values()];
}

// Derruba os processos de TODOS os engines registrados.
//
// De proposito nao filtra pelas conexoes em uso: quem chama isto ("Gerar
// configs", "Remover") acabou de mexer na config, e um processo de qualquer
// engine que tenha sobrado segura a versao antiga em memoria.
//
// Mantem a convencao do killed: numero quando da pra contar, null quando o
// backend (pkill) so diz "matei algo".
function killAll(settings) {
  let total = 0;
  let indefinido = false;
  for (const eng of list()) {
    const r = eng.kill(settings) || {};
    if (r.killed === null) indefinido = true;
    else total += (r.killed || 0);
  }
  return { killed: (indefinido && total === 0) ? null : total };
}

module.exports = {
  DEFAULT_ENGINE_ID, ENGINES,
  list, byId, engineOf, describe, engineOfEntry, groupByEngine, killAll
};
