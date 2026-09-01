'use strict';

// ---------------------------------------------------------------------------
// Engine `vsp` (vibing-steampunk).
//
// Concentra TUDO que e especifico do binario: flags do server MCP, o arquivo
// `.vsp.json`, o nome das variaveis de senha, o teste de conexao pela CLI, o
// login SSO por browser-auth, o kill dos processos e as instrucoes do CLAUDE.md.
//
// Contrato (ver lib/engines/index.js): o main so conhece esta interface, entao
// um segundo engine (ARC-1) e um arquivo novo aqui do lado -- nao um `if` no
// meio do main.
//
// O QUE NAO ESTA AQUI, de proposito:
//   - o wrap RFC (bridge_launch.py): ele e infra compartilhada. O main pega
//     `binPath`/`binArgs` deste engine e monta o wrap por fora, entao o bridge
//     serve qualquer engine sem saber que existem dois.
//   - o formato do cookie jar: e Netscape (o mesmo do curl), comum aos dois.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const {
  readJson, writeJson, envIdOf, urlOf, cookieFileFor, folderOfEnv
} = require('../common');

// Entrada do sistema no .vsp.json (compartilhada pela geracao e pelo teste).
function buildSystemEntry(projectPath, e) {
  const sys = { url: urlOf(e), client: e.sap_client || '100' };
  if (e.language) sys.language = e.language;
  if (e.auth_type === 'cloud') {
    sys.cookie_file = cookieFileFor(projectPath, e).replace(/\\/g, '/');
  } else { // onprem | rfc
    if (e.user) sys.user = e.user;
    // RFC fala HTTP puro com o bridge no loopback: nao ha TLS pra relaxar
    if (e.insecure && e.auth_type === 'onprem') sys.insecure = true;
  }
  return sys;
}

module.exports = {
  id: 'vsp',
  label: 'vsp',

  // O que a UI liga/desliga por engine. Hoje ninguem le (o app so tem um
  // engine); e o contrato que a Fase 1 vai consumir pro modal se adaptar.
  caps: {
    browserAuth: true,          // tem `--browser-auth`: o botao Login SSO existe
    cliTest: true,              // da pra testar pela CLI (`-s <id> search`)
    transportableEdits: true,   // tem `--allow-transportable-edits`
    modes: ['focused', 'expert']
  },

  // ---- binario -------------------------------------------------------------
  binPath(settings) { return (settings && settings.vsp_path) || ''; },

  // Args fixos ANTES dos da conexao. No vsp nao ha (o binario e o comando);
  // no ARC-1 sera o caminho do entrypoint quando rodar sob node.
  binArgs() { return []; },

  // Devolve null quando esta tudo certo, ou a resposta de erro pro renderer.
  checkBin(settings) {
    const bin = this.binPath(settings);
    if (!bin || !fs.existsSync(bin)) {
      return { ok: false, key: 'be.vspNotFound', args: [bin] };
    }
    return null;
  },

  // Nomes de variavel de senha que o vsp pode esperar. Este build usa o nome do
  // system CRU em maiusculas (com hifen): VSP_MINERVA-DEV_PASSWORD. Geramos
  // tambem a variante com underscore por seguranca. Ambas apontam pra mesma senha.
  passwordVars(id) {
    const upper = id.toUpperCase();
    return [...new Set([
      'VSP_' + upper + '_PASSWORD',                    // forma crua (com hifen) - este build
      'VSP_' + upper.replace(/-/g, '_') + '_PASSWORD'  // forma com underscore (fallback)
    ])];
  },

  // ---- server MCP ----------------------------------------------------------
  // Args do server MCP do vsp (Claude .mcp.json e Codex ~/.codex/config.toml).
  // IMPORTANTE: no modo MCP (comando raiz) este build do vsp NAO aplica
  // `-s <profile>` pra pegar URL/credencial do .vsp.json — ele exige a conexao
  // EXPLICITA (senao morre com "SAP URL is required" antes do handshake). Por
  // isso passamos tudo explicito aqui, deixando o server self-contained
  // (independe de cwd / .vsp.json).
  buildArgs(settings, e, folder) {
    const args = ['--url', urlOf(e), '--client', e.sap_client || '100'];
    if (e.language) args.push('--language', e.language);
    if (e.auth_type === 'cloud') {
      // caminho ABSOLUTO: o server precisa achar o cookie independente do cwd
      args.push('--cookie-file', cookieFileFor(folderOfEnv(e, folder), e).replace(/\\/g, '/'));
    } else { // onprem | rfc (numa RFC a URL aponta pro bridge local)
      if (e.user)     args.push('--user', e.user);
      if (e.password) args.push('--password', e.password);
      if (e.insecure && e.auth_type === 'onprem') args.push('--insecure');
    }
    args.push('--mode', e.mode || 'focused');
    if (e.read_only)                 args.push('--read-only');
    if (e.allow_transportable_edits) args.push('--allow-transportable-edits');
    if (e.enable_transports)         args.push('--enable-transports');
    return args;
  },

  // Comando + args + env do server MCP, SEM o wrap RFC (quem embrulha e o main).
  buildLaunch(settings, e, folder) {
    return {
      command: this.binPath(settings),
      args: this.binArgs(settings).concat(this.buildArgs(settings, e, folder)),
      env: {}
    };
  },

  // ---- arquivos de apoio do workspace --------------------------------------
  // O `.vsp.json` e a fonte da verdade dos sistemas pro subcomando `-s`.
  // Devolve os nomes gravados, pro main listar na resposta ao renderer.
  writeWorkspaceFiles(settings, folder, envs) {
    const systems = {};
    for (const e of envs) systems[envIdOf(e)] = buildSystemEntry(folder, e);
    const vspJson = { systems };
    if (envs.length) vspJson.default = envIdOf(envs[0]);
    writeJson(path.join(folder, '.vsp.json'), vspJson);
    return ['.vsp.json'];
  },

  // ---- teste de conexao ----------------------------------------------------
  // Garante que o .vsp.json tem este sistema (o subcomando `-s` le dele).
  // `portOverride` existe pro teste RFC, que sobe um bridge numa porta livre
  // qualquer e precisa apontar o profile pra ela sem mexer na porta oficial.
  syncTestConfig(settings, projectPath, env, portOverride) {
    const alvo = portOverride
      ? Object.assign({}, env, { bridge_port: portOverride })
      : env;
    const id = envIdOf(env);
    const vspFile = path.join(projectPath, '.vsp.json');
    const vspJson = readJson(vspFile, { systems: {} });
    if (!vspJson.systems) vspJson.systems = {};
    vspJson.systems[id] = buildSystemEntry(projectPath, alvo);
    if (!vspJson.default) vspJson.default = id;
    writeJson(vspFile, vspJson);
  },

  // Roda `vsp -s <id> search CLAS --max 1` e classifica o resultado.
  runTest(settings, projectPath, env, childEnv) {
    const id = envIdOf(env);
    return new Promise((resolve) => {
      const args = ['-s', id, 'search', 'CLAS', '--max', '1'];
      let out = '';
      let proc;
      try {
        proc = spawn(this.binPath(settings), args, { cwd: projectPath, env: childEnv });
      } catch (e) {
        resolve({ ok: false, key: 'be.vspStartFail', args: [e.message] });
        return;
      }

      let done = false;
      const finish = (res) => { if (done) return; done = true; resolve(res); };

      proc.stdout.on('data', d => { out += d.toString(); });
      proc.stderr.on('data', d => { out += d.toString(); });
      proc.on('error', e => finish({ ok: false, key: 'be.error', args: [e.message], log: out }));
      proc.on('exit', code => {
        const low = out.toLowerCase();
        if (/certificate|x509|tls:/.test(low)) {
          finish({ ok: false, key: 'be.testTls', args: [id], log: out });
        } else if (/adt-rfc bridge error|connection refused|econnrefused/.test(low)) {
          finish({ ok: false, key: 'be.testBridgeDown', args: [id], log: out });
        } else if (/\b403\b|forbidden|service cannot be reached/.test(low)) {
          finish({ ok: false, key: 'be.testForbidden', args: [id], log: out });
        } else if (/\b401\b|unauthorized|password|credential|logon failed|cookie/.test(low)) {
          finish({ ok: false, key: 'be.testAuth', args: [id], log: out });
        } else if (code === 0) {
          finish({ ok: true, key: 'be.testOk', args: [id], log: out });
        } else {
          finish({ ok: false, key: 'be.testFail', args: [id], log: out });
        }
      });

      setTimeout(() => {
        try { proc.kill(); } catch (e) {}
        finish({ ok: false, key: 'be.testFail', args: [id], log: out });
      }, 45000);
    });
  },

  // ---- kill ----------------------------------------------------------------
  // Encerra os processos vsp que ficaram vivos da geracao anterior.
  // O host MCP (Claude/Codex) sobe o vsp como filho e ele SEGURA a config antiga
  // em memoria: sem matar, o MCP continua respondendo com os profiles/cookies
  // velhos e a config recem-gerada nao vale nada. Equivale ao
  //   Get-Process vsp | Stop-Process -Force
  // que antes precisava ser rodado na mao a cada "Gerar configs".
  // Sem /T de proposito: o browser-auth abre o Chrome como filho e derrubar a
  // arvore fecharia a janela do usuario.
  kill(settings) {
    const base = path.basename(this.binPath(settings) || 'vsp.exe');
    try {
      if (process.platform === 'win32') {
        const image = /\.exe$/i.test(base) ? base : base + '.exe';
        const r = spawnSync('taskkill', ['/F', '/IM', image], { timeout: 10000 });
        // taskkill sai != 0 quando nao ha processo ("not found") - isso nao e erro.
        const out = String((r.stdout || '') + (r.stderr || ''));
        const killed = (out.match(/PID/g) || []).length;
        return { killed };
      }
      const name = base.replace(/\.exe$/i, '');
      const r = spawnSync('pkill', ['-x', name], { timeout: 10000 });
      // pkill: 0 = matou algo, 1 = nada rodando. Nao da pra contar quantos.
      return { killed: r.status === 0 ? null : 0 };
    } catch (e) {
      console.error('Falha ao encerrar processos vsp:', e);
      return { killed: 0, error: e.message };
    }
  },

  // ---- login SSO (cloud) ---------------------------------------------------
  // Dispara `vsp --browser-auth` e salva o cookie do ambiente. O browser-auth
  // nem sempre encerra sozinho (fica vivo apos a captura), entao detectamos o
  // cookie no disco e encerramos o processo na mao.
  login(settings, env) {
    return new Promise((resolve) => {
      // a pasta vem da conexao: o cookie tem que morar no mesmo workspace que a
      // config aponta, senao o vsp procura num lugar e o login gravou noutro
      const projectPath = folderOfEnv(env);
      if (!projectPath) {
        resolve({ ok: false, key: 'be.noFolderForConn' });
        return;
      }
      const semBin = this.checkBin(settings);
      if (semBin) { resolve(semBin); return; }
      fs.mkdirSync(projectPath, { recursive: true });

      const cookieFile = cookieFileFor(projectPath, env);
      const startTime = Date.now();
      const args = [
        '--url', env.url,
        '--browser-auth',
        '--cookie-save', cookieFile
      ];
      if (settings.chrome_path && fs.existsSync(settings.chrome_path)) {
        args.push('--browser-exec', settings.chrome_path);
      }

      let out = '';
      let proc;
      try {
        proc = spawn(this.binPath(settings), args, { cwd: projectPath });
      } catch (e) {
        resolve({ ok: false, key: 'be.vspStartFail', args: [e.message] });
        return;
      }

      proc.stdout.on('data', d => { out += d.toString(); });
      proc.stderr.on('data', d => { out += d.toString(); });

      let done = false;
      let poll = null;
      let killTimer = null;
      const finish = (res) => {
        if (done) return;
        done = true;
        if (poll) clearInterval(poll);
        if (killTimer) clearTimeout(killTimer);
        resolve(res);
      };
      const ok = (extra) => {
        // O cookie novo ja esta no disco, mas o vsp que o host MCP subiu ainda
        // segura o ANTIGO em memoria — relogar sem derrubar nao surte efeito
        // nenhum. A config em si NAO fica velha: ela guarda o CAMINHO do cookie,
        // e o arquivo e sempre o mesmo, sobrescrito a cada login.
        // Aqui e seguro: so chega neste ponto com o cookie ja capturado e estavel.
        const morto = this.kill(settings);
        finish({
          ok: true,
          key: 'be.loginOk',
          args: [path.basename(cookieFile)],
          log: out,
          vspKilled: morto.killed,
          ...extra
        });
      };

      proc.on('error', e => finish({ ok: false, key: 'be.error', args: [e.message], log: out }));

      // Se o vsp encerrar sozinho, decide pelo cookie.
      proc.on('exit', code => {
        const cookieOk = fs.existsSync(cookieFile) && fs.statSync(cookieFile).mtimeMs >= startTime - 2000;
        if (cookieOk) ok();
        else finish({ ok: false, key: 'be.loginFail', args: [code], log: out });
      });

      // Detecta o cookie sendo salvo: exige que o arquivo exista, nao vazio, gravado
      // depois do inicio do login e ESTAVEL (mesmo mtime em 2 leituras ~ 1,6s) pra
      // nao declarar sucesso no meio de uma escrita.
      let lastMtime = 0, stable = 0;
      poll = setInterval(() => {
        try {
          if (!fs.existsSync(cookieFile)) return;
          const st = fs.statSync(cookieFile);
          if (st.size <= 0 || st.mtimeMs < startTime - 2000) return;
          if (st.mtimeMs === lastMtime) stable++;
          else { lastMtime = st.mtimeMs; stable = 0; }
          if (stable >= 2) {
            // cookie capturado e estavel: encerra o vsp pendurado e reporta sucesso.
            try { proc.kill(); } catch (e) {}
            ok();
          }
        } catch (e) { /* arquivo em escrita; tenta de novo */ }
      }, 800);

      // Timeout de seguranca: 5 min sem cookie -> aborta e mata o processo.
      killTimer = setTimeout(() => {
        try { proc.kill(); } catch (e) {}
        finish({ ok: false, key: 'be.loginTimeout', log: out });
      }, 300000);
    });
  },

  // ---- instrucoes pro agente (CLAUDE.md / AGENTS.md) -----------------------
  // Objetivo: dar ao LLM, numa leitura so, tudo que ele precisa pra operar o
  // workspace sem gastar tokens vasculhando a pasta ou tentando operacoes que
  // falham. Boa parte disto sao workarounds de bugs DESTE build do vsp -- e por
  // isso que o texto mora no engine e nao no main.
  instructions(envs) {
    const L = [];
    L.push('# Workspace SAP MCP Cockpit — ambientes SAP via vsp (MCP)');
    L.push('');
    L.push('Este workspace **nao tem codigo de aplicacao**. Ele so configura acesso a sistemas');
    L.push('SAP pelo `vsp` (vibing-steampunk) como servidores **MCP**. **Nao vasculhe a pasta**');
    L.push('procurando codigo nem rode `glob`/`ls` recursivo: tudo que importa esta aqui.');
    L.push('');
    L.push('## Como funciona');
    L.push('- Cada ambiente abaixo e um servidor MCP de nome `<profile>`; as ferramentas dele');
    L.push('  aparecem com o prefixo `mcp__<profile>__*`.');
    L.push('- Config gerada pelo SAP MCP Cockpit (nao edite a mao): `.vsp.json` (URLs + cookie/');
    L.push('  usuario + insecure), `~/.claude.json` (Claude Code, global), `~/.codex/config.toml` (Codex, global), `.env`.');
    L.push('  A senha on-prem ja vai no bloco `env` do server MCP — nao precisa carregar `.env` na mao.');
    L.push('- Cookies de SSO dos ambientes Cloud ficam em `cookies-<profile>.txt`.');
    L.push('- **Codex:** os servers MCP vao no seu `~/.codex/config.toml` GLOBAL (o Cockpit mantem um');
    L.push('  bloco gerenciado la). Eles so carregam ao INICIAR o Codex — se as tools `mcp__<profile>__*`');
    L.push('  nao aparecerem, REINICIE o Codex (sessao nova); elas nao surgem no meio de uma sessao.');
    L.push('');
    L.push('## Ambientes');
    L.push('| Profile (MCP) | Cliente | Ambiente | Tipo | Client SAP | URL | Obs |');
    L.push('|---|---|---|---|---|---|---|');
    for (const e of envs) {
      const obs = [];
      if (e.read_only) obs.push('read-only');
      if (e.mode && e.mode !== 'focused') obs.push(e.mode);
      L.push(`| ${envIdOf(e)} | ${e.client_name} | ${e.env_name} | ${e.auth_type} | ${e.sap_client || '?'} | ${e.url} | ${obs.join(', ') || '-'} |`);
    }
    L.push('');
    L.push('## Testar conexao (rapido, sem gastar token a toa)');
    L.push('Para provar que um ambiente conecta e autentica, faca **uma busca ADT leve** pelo');
    L.push('profile (operacao de *search* do MCP, com poucos resultados). Se voltar objetos, a');
    L.push('conexao + autenticacao estao OK.');
    L.push('- ⚠️ **Nao** use *system info* como teste de conexao: ela depende de Data Preview /');
    L.push('  `S_DEVELOP` e costuma falhar por falta de autorizacao — isso **nao** significa');
    L.push('  conexao quebrada.');
    L.push('- Cloud com erro de autenticacao = cookie SSO expirou; refaca o **Login SSO** no');
    L.push('  SAP MCP Cockpit.');
    L.push('');
    L.push('## Conexoes RFC (Tipo `rfc`) — LIMITE que muda o que da pra pedir');
    L.push('Nesses ambientes o vsp **nao** fala HTTP com o SAP: ele fala com um bridge local em');
    L.push('`127.0.0.1:<porta>` que tunela cada request ADT pela FM `SADT_REST_RFC_ENDPOINT` por');
    L.push('RFC, atravessando o SAProuter (mesmo caminho do Eclipse ADT). Isso e transparente pro');
    L.push('vsp em tudo, MENOS num ponto que muda o seu plano:');
    L.push('- A FM e **stateless por chamada** — nao existe sessao HTTP. Logo **ATIVAR objeto NAO');
    L.push('  FUNCIONA**: o `LockObject` e o `Activate` caem em sessoes diferentes (da `403 User is');
    L.push('  currently editing`; e se destravar antes, o activate vira **200 no-op silencioso**).');
    L.push('- Em NetWeaver 75x o lock volta `MODIFICATION_SUPPORT=NoModification` e o vsp **aborta');
    L.push('  antes de gravar**. Nao fique retentando: nao ha flag que contorne pelo MCP.');
    L.push('- Portanto, aqui conte com **ler, buscar e analisar**. Precisa gravar/ativar? Diga ao');
    L.push('  usuario pra usar Eclipse ADT (ou um caminho HTTP(S) real ate o ICM) — nao tente por aqui.');
    L.push('- Erro `502 ADT-RFC bridge error` ou conexao recusada = problema do bridge/RFC (SDK,');
    L.push('  pyrfc, credencial, router), **nao** do seu fluxo. Reporte ao usuario para ele rodar o');
    L.push('  **Diagnostico do bridge** no SAP MCP Cockpit.');
    L.push('');
    L.push('## Erros comuns (decodificador) — nao gaste tempo redescobrindo');
    L.push('- `tls: certificate has expired or is not yet valid` → cert self-signed/expirado (on-prem).');
    L.push('  Marque **--insecure** no ambiente pelo Cockpit e **Gerar configs** de novo (vira `insecure:true`');
    L.push('  no `.vsp.json`). Nao saia passando `--insecure` na mao no subcomando — ele e root-only.');
    L.push('- `403 ... Service cannot be reached` no endpoint ADT → os servicos **ADT nao estao ativos');
    L.push('  na SICF** desse client (tarefa de Basis no SAP), nao e problema de conexao/credencial.');
    L.push('- Pediu `VSP_<ID>_PASSWORD` / cookie → falta a senha/cookie. Via MCP isso ja vem no `env`');
    L.push('  do server; refaca **Gerar configs** no Cockpit se faltar.');
    L.push('- Para **editar objeto transportavel** (status "transport protection"): o ambiente precisa');
    L.push('  de **Permitir edits transportaveis** + **Habilitar transports** marcados no Cockpit. Via');
    L.push('  CLI o subcomando `source write` ignora esses opt-ins; use a tool MCP `EditSource` (replace');
    L.push('  cirurgico + syntax check + activate), passando `transport` = sua request.');
    L.push('');
    L.push('## Criar/editar objeto ABAP — SIGA EXATAMENTE (nao improvise)');
    L.push('Os helpers de alto nivel (`EditSource`/`WriteSource`/`CreateAndActivateProgram`) tem um BUG');
    L.push('neste build do vsp: ao gravar fonte em objeto **recem-criado** retornam `status 423 -');
    L.push('lock handle invalid`. NAO fique retentando esses helpers nem caia pro shell/CLI. O caminho');
    L.push('abaixo FUNCIONA — exige **mode = expert** (no `focused` faltam `LockObject`/`UpdateSource`;');
    L.push('se nao aparecerem, troque o ambiente pra expert no Cockpit e REINICIE o Codex).');
    L.push('');
    L.push('**Criar objeto novo (ex.: PROG transportavel):**');
    L.push('1. Cria o skeleton: `WriteSource` mode=create (ou `CreateAndActivateProgram`). Ele vai');
    L.push('   retornar o erro de lock no update inicial — **ignore**, o objeto FICA criado (confirme');
    L.push('   com `SearchObject`).');
    L.push('2. `LockObject` em `/sap/bc/adt/programs/programs/<NOME>` (access_mode MODIFY) → guarde o');
    L.push('   `lockHandle` (ele ja amarra na sua request).');
    L.push('3. `UpdateSource` com `object_url` (sem `/source/main`), `lock_handle`, `transport` e o fonte');
    L.push('   COMPLETO de uma vez.');
    L.push('4. `Activate` → depois `UnlockObject` com o mesmo `lock_handle`.');
    L.push('');
    L.push('**Editar objeto que JA EXISTE e esta ativo:** `EditSource` (replace cirurgico) funciona —');
    L.push('URL `.../source/main`, `old_string` anchor UNICO, `replace_all`=false, `syntax_check`=true,');
    L.push('`transport` = request. Se der lock invalid, caia pro fluxo LockObject->UpdateSource acima.');
    L.push('');
    L.push('**⚠️ Se MESMO com lock_handle valido (LockObject OK) o `UpdateSource`/`DeleteObject` der');
    L.push('`423 ... is not locked`:** PARE. Nao e o seu fluxo — e o **bug de sessao stateful do vsp em');
    L.push('SAP ECC/NetWeaver antigo** (lock e o PUT do source caem em sessoes HTTP diferentes; o');
    L.push('backend rejeita o handle valido). Sintoma do sistema: `GetConnectionInfo` sem rap/hana/');
    L.push('abapgit. NAO fique tentando MCP/CLI/HTTP bruto em loop — nenhum vai funcionar. Reporte ao');
    L.push('usuario: atualizar o vsp (issue vibing-steampunk #91) OU subir o fonte por Eclipse ADT/');
    L.push('SE38/SAP GUI (o objeto ja esta criado com skeleton; o fonte local esta pronto).');
    L.push('');
    L.push('**Regras gerais:**');
    L.push('- Objeto travado de uma tentativa anterior → `UnlockObject` (ou re-`LockObject`) ANTES de');
    L.push('  retentar; um lock_handle so vale uma vez.');
    L.push('- Operacao demorou (report grande leva minutos)? Nao mate nem retente as cegas — **releia o');
    L.push('  source primeiro**, a anterior pode ter comitado.');
    L.push('- `DeleteObject` tambem usa lock: `LockObject` -> `DeleteObject(lock_handle)`; se der lock');
    L.push('  invalid, e o mesmo bug — confirme o estado com `SearchObject` antes de insistir.');
    L.push('');
    L.push('## vsp pela CLI (so se o MCP estiver indisponivel)');
    L.push('- O binario nao esta no PATH; use o caminho configurado no Cockpit.');
    L.push('- Flags de conexao (`--url`, `--insecure`, `--cookie-file`, `--client`, ...) sao **so do');
    L.push('  comando raiz**. Use o profile: `vsp -s <profile> <subcomando>` (le `.vsp.json`).');
    L.push('- A CLI **nao** le `.env` sozinha. Carregue a senha antes (PowerShell), usando o nome');
    L.push('  exato da variavel (hifens do profile viram `_`):');
    L.push('  `$env:VSP_<ID>_PASSWORD = (Get-Content .env | Select-String "^VSP_<ID>_PASSWORD=").ToString().Split("=",2)[1]`');
    L.push('');
    return L.join('\n');
  }
};
