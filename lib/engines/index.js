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

const DEFAULT_ENGINE_ID = 'vsp';

const ENGINES = {
  [vsp.id]: vsp
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

module.exports = { DEFAULT_ENGINE_ID, ENGINES, list, byId, engineOf, groupByEngine, killAll };
