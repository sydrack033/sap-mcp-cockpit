#!/usr/bin/env node
'use strict';

// ---------------------------------------------------------------------------
// SAP MCP Cockpit - proxy de log MCP (stdio).
// NAO EDITAR na pasta do projeto: este arquivo e sobrescrito no "Gerar configs".
//
// Fica entre o host MCP (Claude Code / Codex) e o vsp.exe, repassando o trafego
// byte a byte (transparente pro protocolo) e gravando cada mensagem JSON-RPC em
// logs/mcp-<profile>-<AAAA-MM-DD>.jsonl - 1 JSON por linha com direcao, metodo,
// tamanho e estimativa de tokens (~4 chars/token; a contagem exata e do
// tokenizer do modelo e so aparece nos transcripts do proprio host).
//
// Uso: node mcp-logger.js --profile <id> --log-dir <dir> -- <vsp.exe> [args...]
// ---------------------------------------------------------------------------

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const RAW_CAP = 100000; // corpo gravado por mensagem (bytes/tokens sempre contam o total)

function parseArgs(argv) {
  const o = { profile: 'default', logDir: process.cwd(), target: null, targetArgs: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--profile') o.profile = argv[++i];
    else if (a === '--log-dir') o.logDir = argv[++i];
    else if (a === '--') { o.target = argv[i + 1]; o.targetArgs = argv.slice(i + 2); break; }
  }
  return o;
}

const opts = parseArgs(process.argv.slice(2));
if (!opts.target) {
  process.stderr.write('mcp-logger: uso: mcp-logger.js --profile <id> --log-dir <dir> -- <exe> [args]\n');
  process.exit(2);
}

try { fs.mkdirSync(opts.logDir, { recursive: true }); } catch (e) {}

function logFile() {
  const d = new Date().toISOString().slice(0, 10); // AAAA-MM-DD
  return path.join(opts.logDir, `mcp-${opts.profile}-${d}.jsonl`);
}

function writeEntry(entry) {
  try {
    entry.ts = new Date().toISOString();
    entry.profile = opts.profile;
    entry.pid = process.pid;
    fs.appendFileSync(logFile(), JSON.stringify(entry) + '\n', 'utf8');
  } catch (e) { /* log nunca pode derrubar o server */ }
}

const estTokens = (s) => Math.ceil(s.length / 4);

// Redige o valor que segue --password nos args logados (a senha tambem chega
// por env; nunca vai pro log de nenhuma forma).
function redactArgs(args) {
  return args.map((a, i) => (args[i - 1] === '--password' ? '***' : a));
}

// ---------------------------------------------------------------------------
// Estado da sessao
// ---------------------------------------------------------------------------
const startedAt = Date.now();
const pending = new Map(); // id -> { method, t }  (pra casar response com request)
const totals = {
  in:  { msgs: 0, bytes: 0, est_tokens: 0 },
  out: { msgs: 0, bytes: 0, est_tokens: 0 },
  by_method: {} // method -> { calls, est_tokens_in, est_tokens_out, errors }
};
let clientInfo = null;

function methodBucket(m) {
  if (!totals.by_method[m]) totals.by_method[m] = { calls: 0, est_tokens_in: 0, est_tokens_out: 0, errors: 0 };
  return totals.by_method[m];
}

function handleLine(dir, line) {
  const bytes = Buffer.byteLength(line, 'utf8');
  const tokens = estTokens(line);
  totals[dir].msgs++;
  totals[dir].bytes += bytes;
  totals[dir].est_tokens += tokens;

  const entry = { dir, bytes, chars: line.length, est_tokens: tokens };
  let msg = null;
  try { msg = JSON.parse(line); } catch (e) { entry.parse_error = true; }

  if (msg) {
    if (msg.id !== undefined) entry.id = msg.id;
    if (msg.method) {
      // request ou notification
      entry.method = msg.method;
      const b = methodBucket(msg.method);
      if (dir === 'in') { b.calls++; b.est_tokens_in += tokens; }
      else { b.est_tokens_out += tokens; }
      if (msg.id !== undefined && dir === 'in') pending.set(msg.id, { method: msg.method, t: Date.now() });
      // handshake: identifica o app cliente (claude-code / codex). O MODELO do
      // LLM nao trafega no MCP - so o host sabe (ver transcripts no stats).
      if (msg.method === 'initialize' && msg.params && msg.params.clientInfo) {
        clientInfo = msg.params.clientInfo;
        entry.client = clientInfo;
      }
      if (msg.method === 'tools/call' && msg.params && msg.params.name) entry.tool = msg.params.name;
    } else if (msg.id !== undefined) {
      // response: atribui ao metodo do request correspondente
      const req = pending.get(msg.id);
      if (req) {
        pending.delete(msg.id);
        entry.method = req.method;
        entry.latency_ms = Date.now() - req.t;
        const b = methodBucket(req.method);
        b.est_tokens_out += tokens;
        if (msg.error) { entry.is_error = true; b.errors++; }
      } else if (msg.error) {
        entry.is_error = true;
      }
    }
  }

  entry.raw = line.length > RAW_CAP ? line.slice(0, RAW_CAP) : line;
  if (line.length > RAW_CAP) entry.truncated = true;
  writeEntry(entry);
}

// Divide o stream em linhas (MCP stdio = 1 JSON por linha) sem mexer nos bytes
// repassados - o log observa uma copia, o forward e o chunk original.
function lineSplitter(onLine) {
  let buf = '';
  return (chunk) => {
    buf += chunk.toString('utf8');
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).replace(/\r$/, '');
      buf = buf.slice(idx + 1);
      if (line.trim()) onLine(line);
    }
  };
}

// ---------------------------------------------------------------------------
// Spawn do processo real + wiring
// ---------------------------------------------------------------------------
writeEntry({
  dir: 'session_start',
  target: opts.target,
  args: redactArgs(opts.targetArgs),
  // se o host exportar o modelo em env, registra (nem todo host faz)
  model_hint: process.env.ANTHROPIC_MODEL || process.env.CLAUDE_MODEL || process.env.OPENAI_MODEL || null
});

let child;
try {
  child = spawn(opts.target, opts.targetArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
} catch (e) {
  writeEntry({ dir: 'proxy_error', error: String(e && e.message) });
  process.exit(1);
}

const feedIn = lineSplitter((l) => handleLine('in', l));
const feedOut = lineSplitter((l) => handleLine('out', l));
const feedErr = lineSplitter((l) => writeEntry({ dir: 'err', text: l.slice(0, 4000) }));

process.stdin.on('data', (chunk) => {
  try { child.stdin.write(chunk); } catch (e) {}
  feedIn(chunk);
});
process.stdin.on('end', () => { try { child.stdin.end(); } catch (e) {} });
process.stdin.on('error', () => {});
child.stdin.on('error', () => {});

child.stdout.on('data', (chunk) => {
  try { process.stdout.write(chunk); } catch (e) {}
  feedOut(chunk);
});
child.stderr.on('data', (chunk) => {
  try { process.stderr.write(chunk); } catch (e) {}
  feedErr(chunk);
});
process.stdout.on('error', () => {});

function summary(code, signal) {
  writeEntry({
    dir: 'session_end',
    exit_code: code,
    signal: signal || null,
    duration_ms: Date.now() - startedAt,
    client: clientInfo,
    totals
  });
}

child.on('error', (e) => {
  writeEntry({ dir: 'proxy_error', error: String(e && e.message) });
  process.exit(1);
});
child.on('exit', (code, signal) => {
  summary(code, signal);
  process.exit(code === null ? 1 : code);
});

// host encerrou o proxy: derruba o filho e registra a sessao
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  try { process.on(sig, () => { try { child.kill(); } catch (e) {} }); } catch (e) {}
}
process.on('exit', () => { try { child.kill(); } catch (e) {} });
