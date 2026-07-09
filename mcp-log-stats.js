#!/usr/bin/env node
'use strict';

// ---------------------------------------------------------------------------
// SAP MCP Cockpit - relatorio de uso MCP + tokens.
// NAO EDITAR na pasta do projeto: este arquivo e sobrescrito no "Gerar configs".
//
// Uso: node mcp-log-stats.js [pasta-do-projeto]
//
// Junta 3 fontes:
//  1) logs/mcp-*.jsonl  - trafego MCP gravado pelo mcp-logger.js
//     (tokens ESTIMADOS: ~4 chars/token; util pra ver quanto cada tool/profile pesa)
//  2) transcripts do Claude Code (~/.claude/projects/<slug do projeto>/*.jsonl)
//     - MODELO usado e tokens REAIS cobrados (input/output/cache) por modelo
//  3) sessoes do Codex (~/.codex/sessions/**.jsonl) - best-effort
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const os = require('os');

const projectDir = path.resolve(process.argv[2] || '.');
const logsDir = path.join(projectDir, 'logs');

const fmt = (n) => (n || 0).toLocaleString('en-US');
const kb = (n) => ((n || 0) / 1024).toFixed(1) + ' KB';

function readLines(file, onObj) {
  let data;
  try { data = fs.readFileSync(file, 'utf8'); } catch (e) { return; }
  for (const line of data.split('\n')) {
    if (!line.trim()) continue;
    try { onObj(JSON.parse(line)); } catch (e) { /* linha corrompida: ignora */ }
  }
}

console.log('==================================================================');
console.log(' SAP MCP Cockpit - relatorio de chamadas MCP e tokens');
console.log(' Projeto: ' + projectDir);
console.log('==================================================================');

// ---------------------------------------------------------------------------
// 1) Trafego MCP (logs do mcp-logger.js) - tokens ESTIMADOS
// ---------------------------------------------------------------------------
console.log('\n--- 1) Trafego MCP (estimativa ~4 chars/token) -------------------');

const profiles = {}; // profile -> agregado
let mcpFiles = [];
try {
  mcpFiles = fs.readdirSync(logsDir).filter(f => /^mcp-.*\.jsonl$/.test(f));
} catch (e) {}

if (!mcpFiles.length) {
  console.log('(sem logs em ' + logsDir + ' - gere as configs com logging ligado e use o MCP)');
} else {
  for (const f of mcpFiles) {
    readLines(path.join(logsDir, f), (o) => {
      const p = o.profile || f.replace(/^mcp-(.*)-\d{4}-\d{2}-\d{2}\.jsonl$/, '$1');
      if (!profiles[p]) {
        profiles[p] = {
          in: { msgs: 0, bytes: 0, tokens: 0 }, out: { msgs: 0, bytes: 0, tokens: 0 },
          methods: {}, tools: {}, clients: new Set(), sessions: 0, errors: 0
        };
      }
      const agg = profiles[p];
      if (o.dir === 'in' || o.dir === 'out') {
        agg[o.dir].msgs++;
        agg[o.dir].bytes += o.bytes || 0;
        agg[o.dir].tokens += o.est_tokens || 0;
        const m = o.method || '(sem metodo)';
        if (!agg.methods[m]) agg.methods[m] = { calls: 0, tokens_in: 0, tokens_out: 0 };
        if (o.dir === 'in' && o.method) agg.methods[m].calls++;
        agg.methods[m][o.dir === 'in' ? 'tokens_in' : 'tokens_out'] += o.est_tokens || 0;
        if (o.tool) {
          if (!agg.tools[o.tool]) agg.tools[o.tool] = 0;
          agg.tools[o.tool]++;
        }
        if (o.is_error) agg.errors++;
        if (o.client && o.client.name) agg.clients.add(o.client.name + ' ' + (o.client.version || ''));
      } else if (o.dir === 'session_start') {
        agg.sessions++;
      } else if (o.dir === 'session_end' && o.client && o.client.name) {
        agg.clients.add(o.client.name + ' ' + (o.client.version || ''));
      }
    });
  }

  let gIn = 0, gOut = 0;
  for (const [p, a] of Object.entries(profiles)) {
    gIn += a.in.tokens; gOut += a.out.tokens;
    console.log(`\nProfile: ${p}`);
    console.log(`  sessoes: ${a.sessions}   clientes: ${[...a.clients].join(', ') || '(handshake nao logado)'}`);
    console.log(`  entrada (host->vsp): ${fmt(a.in.msgs)} msgs, ${kb(a.in.bytes)}, ~${fmt(a.in.tokens)} tokens`);
    console.log(`  saida   (vsp->host): ${fmt(a.out.msgs)} msgs, ${kb(a.out.bytes)}, ~${fmt(a.out.tokens)} tokens`);
    if (a.errors) console.log(`  respostas com erro: ${a.errors}`);

    const tools = Object.entries(a.tools).sort((x, y) => y[1] - x[1]).slice(0, 10);
    if (tools.length) {
      console.log('  tools mais chamadas:');
      for (const [t, n] of tools) console.log(`    ${t}: ${n}x`);
    }
    const methods = Object.entries(a.methods)
      .sort((x, y) => (y[1].tokens_in + y[1].tokens_out) - (x[1].tokens_in + x[1].tokens_out))
      .slice(0, 8);
    if (methods.length) {
      console.log('  metodos por volume (~tokens in/out):');
      for (const [m, s] of methods) {
        console.log(`    ${m}: ${s.calls} calls, ~${fmt(s.tokens_in)} in / ~${fmt(s.tokens_out)} out`);
      }
    }
  }
  console.log(`\nTOTAL MCP: ~${fmt(gIn)} tokens de entrada / ~${fmt(gOut)} tokens de saida (estimativa)`);
  console.log('Obs: e o que trafegou no MCP; o custo real no LLM depende do contexto todo (ver secao 2).');
}

// ---------------------------------------------------------------------------
// 2) Claude Code - MODELO usado + tokens REAIS (transcripts)
// ---------------------------------------------------------------------------
console.log('\n--- 2) Claude Code: modelo usado + tokens REAIS -------------------');

// O Claude Code guarda os transcripts em ~/.claude/projects/<caminho com tudo
// que nao e [a-zA-Z0-9] trocado por '-'>.
const claudeSlug = projectDir.replace(/[^a-zA-Z0-9]/g, '-');
const claudeDir = path.join(os.homedir(), '.claude', 'projects', claudeSlug);

let claudeFiles = [];
try { claudeFiles = fs.readdirSync(claudeDir).filter(f => f.endsWith('.jsonl')); } catch (e) {}

if (!claudeFiles.length) {
  console.log('(sem transcripts em ' + claudeDir + ')');
} else {
  const byModel = {};   // model -> usage somado
  const byMsg = new Map(); // dedupe: message.id -> { model, usage } (fica a ultima ocorrencia)
  const mcpToolCalls = {}; // servidor mcp -> chamadas

  for (const f of claudeFiles) {
    readLines(path.join(claudeDir, f), (o) => {
      if (o.type !== 'assistant' || !o.message) return;
      const msg = o.message;
      if (msg.usage && msg.model) {
        byMsg.set(msg.id || (f + ':' + Math.random()), { model: msg.model, usage: msg.usage });
      }
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'tool_use' && /^mcp__/.test(block.name || '')) {
            const server = block.name.split('__')[1] || '?';
            mcpToolCalls[server] = (mcpToolCalls[server] || 0) + 1;
          }
        }
      }
    });
  }

  for (const { model, usage } of byMsg.values()) {
    if (!byModel[model]) byModel[model] = { msgs: 0, input: 0, output: 0, cache_read: 0, cache_write: 0 };
    const m = byModel[model];
    m.msgs++;
    m.input += usage.input_tokens || 0;
    m.output += usage.output_tokens || 0;
    m.cache_read += usage.cache_read_input_tokens || 0;
    m.cache_write += usage.cache_creation_input_tokens || 0;
  }

  if (!Object.keys(byModel).length) {
    console.log('(transcripts encontrados mas sem dados de uso)');
  } else {
    for (const [model, m] of Object.entries(byModel)) {
      console.log(`\nModelo: ${model}  (${fmt(m.msgs)} respostas)`);
      console.log(`  input: ${fmt(m.input)}   output: ${fmt(m.output)}`);
      console.log(`  cache read: ${fmt(m.cache_read)}   cache write: ${fmt(m.cache_write)}`);
    }
    const calls = Object.entries(mcpToolCalls).sort((a, b) => b[1] - a[1]);
    if (calls.length) {
      console.log('\nChamadas de tool MCP por servidor (visao do Claude Code):');
      for (const [s, n] of calls) console.log(`  ${s}: ${n}x`);
    }
  }
}

// ---------------------------------------------------------------------------
// 3) Codex - best-effort
// ---------------------------------------------------------------------------
console.log('\n--- 3) Codex (best-effort) ----------------------------------------');

const codexDir = path.join(os.homedir(), '.codex', 'sessions');
const codexModels = new Set();
const codexTotal = {};
let codexFilesSeen = 0;

function walkCodex(dir, depth) {
  if (depth > 4) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const en of entries) {
    const full = path.join(dir, en.name);
    if (en.isDirectory()) walkCodex(full, depth + 1);
    else if (en.name.endsWith('.jsonl')) {
      codexFilesSeen++;
      let lastUsage = null;
      readLines(full, (o) => {
        const p = o.payload || o;
        if (p && typeof p.model === 'string') codexModels.add(p.model);
        if (p && p.info && p.info.total_token_usage) lastUsage = p.info.total_token_usage; // cumulativo: vale o ultimo
      });
      if (lastUsage) {
        for (const [k, v] of Object.entries(lastUsage)) {
          if (typeof v === 'number') codexTotal[k] = (codexTotal[k] || 0) + v;
        }
      }
    }
  }
}
walkCodex(codexDir, 0);

if (!codexFilesSeen) {
  console.log('(sem sessoes em ' + codexDir + ')');
} else {
  console.log(`Sessoes analisadas: ${codexFilesSeen}`);
  if (codexModels.size) console.log('Modelos vistos: ' + [...codexModels].join(', '));
  if (Object.keys(codexTotal).length) {
    console.log('Tokens (soma dos totais por sessao):');
    for (const [k, v] of Object.entries(codexTotal)) console.log(`  ${k}: ${fmt(v)}`);
  } else {
    console.log('(nenhum contador de tokens encontrado nas sessoes)');
  }
}

console.log('\n==================================================================');
console.log(' Legenda: secao 1 = ESTIMATIVA (~4 chars/token) do que trafegou no');
console.log(' MCP. Secao 2 = tokens reais cobrados pelo modelo (transcripts do');
console.log(' Claude Code) - e onde aparece O MODELO usado.');
console.log('==================================================================');
