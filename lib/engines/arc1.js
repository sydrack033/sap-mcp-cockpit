'use strict';

// ---------------------------------------------------------------------------
// Engine `arc1` (ARC-1, github.com/arc-mcp/arc-1).
//
// Mesma interface do engine vsp (ver ./vsp.js). As diferencas que importam:
//
//   - NAO e binario unico: e pacote npm. Por isso `binArgs` existe -- o comando
//     e um runtime (node/npx) e o entrypoint vai como argumento. Como subir e
//     decidido pelo lib/arc1install (instalacao gerenciada > npx).
//   - TEM CLI, ao contrario do que este comentario dizia ate agora: alem do
//     `serve` (default quando nao vem subcomando), o binario expoe `search`,
//     `read`, `sql`, `tools`, `call`, `atc`, `unittest`... Por isso o teste de
//     conexao e o mesmo padrao do vsp -- roda um `search` de verdade -- e nao
//     um handshake MCP. As flags de conexao sao GLOBAIS do programa, entao vem
//     ANTES do subcomando (commander nao aceita depois).
//   - Exit code do CLI e deterministico: 0 ok, 1 falha de tool/SAP, 2 erro de
//     uso/configuracao. E o sinal mais confiavel que ele da -- ver runTest.
//   - TEM browser-auth (subcomando `extract-cookies`), mas o Cockpit ainda nao
//     o expoe: `caps.browserAuth` segue false porque falta implementar o
//     `login()` aqui. Hoje o caminho e minar o cookie com o vsp e apontar o
//     --cookie-file, que funciona porque o jar e Netscape nos dois.
//   - E read-only POR PADRAO: onde o vsp tem `--read-only` (opt-out), aqui o
//     opt-in e `--allow-writes`. A UI continua mostrando "somente leitura"; a
//     inversao acontece no buildArgs, nao no formulario.
//   - ATENCAO: os flags booleanos do ARC-1 EXIGEM valor (`--insecure <boolean>`),
//     ao contrario do vsp, onde sao chaves secas. Passar `--insecure` sozinho faz
//     o parser engolir o proximo argumento como valor dele e o server morre com
//     "too many arguments for 'serve'" -- erro que nao aponta pro flag culpado.
//   - NAO tem arquivo de profiles (o `.vsp.json` nao tem equivalente): a config
//     dele e flag > env > .env do cwd. Como passamos tudo explicito na entrada
//     do server MCP, nao ha o que gravar na pasta.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const { envIdOf, urlOf, cookieFileFor, folderOfEnv } = require('../common');
const instalacao = require('../arc1install');

module.exports = {
  id: 'arc1',
  label: 'ARC-1',

  caps: {
    browserAuth: false,        // existe (`extract-cookies`), mas falta o login() aqui
    cliTest: true,             // `search` pela CLI, mesmo padrao do vsp
    transportableEdits: false, // nao ha equivalente a --allow-transportable-edits
    modes: ['standard', 'hyperfocused']
  },

  // ---- binario -------------------------------------------------------------
  // Quem decide COMO subir e o lib/arc1install: comando manual do usuario, ou a
  // instalacao gerenciada (`node <entrypoint>`, ~3s), ou o fallback `npx`
  // (6-18s, mas roda em qualquer maquina). Fonte unica, pra tela de status e
  // launch do server nunca discordarem.
  binPath(settings) { return instalacao.runtime(settings).command; },
  binArgs(settings)  { return instalacao.runtime(settings).args; },

  // So da pra checar quando o comando e um CAMINHO. `npx` (ou qualquer comando
  // do PATH) nao tem arquivo pra procurar -- fingir que checou daria erro
  // errado, entao deixa passar e a falha aparece na hora de subir.
  checkBin(settings) {
    const rt = instalacao.runtime(settings);
    // Sem Node na maquina o ARC-1 nao roda de jeito NENHUM: o `npx` do fallback
    // vem junto com o Node. Falhar aqui, com o motivo certo, evita o usuario
    // caçar um "comando nao encontrado" solto mais tarde.
    if (rt.mode === 'npx' && !instalacao.nodeInfo(settings).ok) {
      const n = instalacao.nodeInfo(settings);
      return { ok: false,
        key: n.motivo === 'tooOld' ? 'be.arc1NodeOld' : 'be.arc1NoNode',
        args: [n.version || n.bin, instalacao.NODE_MINIMO.join('.')] };
    }
    if (!/[\\/]/.test(rt.command)) return null;
    if (!fs.existsSync(rt.command)) {
      return { ok: false, key: 'be.engineBinNotFound', args: [this.label, rt.command] };
    }
    // instalacao gerenciada: o entrypoint tem que existir tambem, senao o node
    // sobe e morre com "Cannot find module", que nao diz nada ao usuario
    if (rt.mode === 'local' && rt.args[0] && !fs.existsSync(rt.args[0])) {
      return { ok: false, key: 'be.arc1Broken', args: [rt.version || '?'] };
    }
    return null;
  },

  // O ARC-1 le a senha de SAP_PASSWORD. Vale por PROCESSO, entao serve pra
  // entrada do server MCP (uma por conexao) -- ver dotenvVars pro caso do .env.
  passwordVars() { return ['SAP_PASSWORD']; },

  // De proposito vazio: `SAP_PASSWORD` nao tem o nome do profile, e uma pasta
  // hospeda VARIAS conexoes. Gravar no .env compartilhado faria a segunda
  // conexao herdar a senha da primeira -- silenciosamente. A senha vai so no
  // bloco `env` do server MCP, que e por conexao.
  dotenvVars() { return []; },

  // ---- server MCP ----------------------------------------------------------
  buildArgs(settings, e, folder) {
    const args = ['--url', urlOf(e), '--client', e.sap_client || '100'];
    if (e.language) args.push('--language', e.language);

    if (e.auth_type === 'cloud') {
      // caminho ABSOLUTO: o server precisa achar o cookie independente do cwd
      args.push('--cookie-file', cookieFileFor(folderOfEnv(e, folder), e).replace(/\\/g, '/'));
    } else { // onprem | rfc (numa RFC a URL aponta pro bridge local)
      if (e.user) args.push('--user', e.user);
      // A senha NAO vai em argv de proposito: a doc do ARC-1 avisa que argv fica
      // fora do redact dos logs (e aparece em process listing). Ela vai por
      // SAP_PASSWORD no bloco `env` do server -- ver passwordVars.
      if (e.insecure && e.auth_type === 'onprem') args.push('--insecure', 'true');
    }

    // vsp: focused/expert. ARC-1: standard (12 tools) / hyperfocused (1 tool).
    args.push('--tool-mode', e.mode === 'hyperfocused' ? 'hyperfocused' : 'standard');

    // Invertido em relacao ao vsp: aqui escrever e opt-in.
    if (!e.read_only) {
      args.push('--allow-writes', 'true');
      if (e.enable_transports) args.push('--allow-transport-writes', 'true');
    }

    // Nome do server no handshake. Serve tambem pra achar o processo depois:
    // rodando sob node, matar por nome de imagem derrubaria o Node do usuario.
    args.push('--server-name', envIdOf(e));
    return args;
  },

  buildLaunch(settings, e, folder) {
    return {
      command: this.binPath(settings),
      args: this.binArgs(settings).concat(this.buildArgs(settings, e, folder)),
      env: {}
    };
  },

  // ---- arquivos de apoio do workspace --------------------------------------
  // Nao ha equivalente do .vsp.json: a entrada do server MCP ja e self-contained.
  writeWorkspaceFiles() { return []; },

  // ---- teste de conexao ----------------------------------------------------
  syncTestConfig() { /* sem arquivo de profiles: nada a sincronizar */ },

  // Roda o MESMO comando que o server MCP vai rodar, so que com o subcomando
  // `search` no fim. Rodar as flags de verdade (e nao um subconjunto "de
  // teste") e o ponto do exercicio: o que passa aqui e exatamente o que o host
  // sobe depois -- URL, client, cookie/usuario, --insecure, tudo.
  runTest(settings, projectPath, env, childEnv) {
    const id = envIdOf(env);
    const launch = this.buildLaunch(settings, env, projectPath);
    // Subcomando por ULTIMO: as flags de conexao sao globais do programa e o
    // commander so as aceita antes do nome do subcomando.
    const args = launch.args.concat(['search', 'CLAS', '--max', '1']);
    // No fallback npx o comando e `npx.cmd`, que o spawn sem shell nao executa.
    // Quem sabe traduzir isso pra um par spawnavel e o arc1install.
    const exec = instalacao.spawnavel(settings, launch.command, args);

    return new Promise((resolve) => {
      let proc;
      try {
        proc = spawn(exec.command, exec.args, { cwd: projectPath, env: childEnv });
      } catch (e) {
        resolve({ ok: false, key: 'be.arc1StartFail', args: [e.message] });
        return;
      }

      let out = '';
      let done = false;
      let timer = null;
      const finish = (res) => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        resolve(res);
      };

      // O ARC-1 manda log E o erro final pro stderr; o stdout so leva resultado.
      // Juntamos os dois porque a classificacao abaixo le o texto inteiro.
      proc.stdout.on('data', d => { out += d.toString(); });
      proc.stderr.on('data', d => { out += d.toString(); });
      proc.on('error', e => finish({ ok: false, key: 'be.arc1StartFail', args: [e.message], log: out }));

      // Le o que o ARC-1 escreveu ate agora e devolve a chave do diagnostico,
      // ou null quando o texto nao diz nada de util. Serve ao exit E ao timeout:
      // o ARC-1 leva ~105s pra desistir sozinho de um host que nao resolve, mas
      // grita "network error" nos primeiros segundos. Esperar o processo inteiro
      // so pra dar a MESMA resposta seria cobrar 1min a mais do usuario a toa.
      const diagnostico = () => {
        const low = out.toLowerCase();
        const semRede = /network error|fetch failed|econnrefused|connection refused|enotfound|etimedout/.test(low);
        // `err_tls` e nao um `tls` solto: a URL do proprio ambiente aparece no
        // log, e um host com "tls" no nome viraria falso positivo de certificado.
        if (/certificate|self-signed|x509|unable to verify|err_tls/.test(low)) return 'be.testTls';
        // Numa RFC a URL aponta pro bridge local: nao chegar nela e problema do
        // bridge, nao do SAP. A mensagem manda pro diagnostico certo.
        if (env.auth_type === 'rfc' && semRede) return 'be.testBridgeDown';
        if (/\b403\b|forbidden|check user authorizations|service cannot be reached/.test(low)) return 'be.testForbidden';
        if (/\b401\b|unauthorized|check sap_client|logon failed/.test(low)) return 'be.testAuth';
        if (semRede) return 'be.testUnreachable';
        return null;
      };

      proc.on('exit', (code) => {
        // So olhamos o TEXTO quando o exit code ja disse que falhou. Em sucesso
        // o ARC-1 ainda imprime WARN de probe ("object search access denied"),
        // e classificar por regex nesse caso viraria falso negativo.
        if (code === 0) return finish({ ok: true, key: 'be.testOk', args: [id], log: out });
        if (code === 2) return finish({ ok: false, key: 'be.arc1BadArgs', args: [id], log: out });
        finish({ ok: false, key: diagnostico() || 'be.testFail', args: [id], log: out });
      });

      // Teto de espera. O npx re-resolve o pacote a cada start (6-18s medidos),
      // por isso ele ganha mais folga -- senao o corte cairia antes de o SAP
      // sequer ser chamado. Nao adianta esticar ate os ~105s que o ARC-1 leva
      // pra desistir de um host morto: o `diagnostico()` abaixo aproveita o que
      // ja saiu no log e entrega o mesmo veredito bem mais cedo.
      const teto = instalacao.runtime(settings).mode === 'npx' ? 90000 : 60000;
      timer = setTimeout(() => {
        // /T derruba a ARVORE: no modo npx o `node` neto sobrevive ao kill do
        // npx sozinho. De proposito NAO usa o kill() do engine aqui -- aquele
        // mata todo arc-1 da maquina, inclusive os servers que o host do
        // usuario esta usando neste momento.
        try {
          if (process.platform === 'win32' && proc.pid) {
            spawnSync('taskkill', ['/F', '/T', '/PID', String(proc.pid)], { timeout: 10000 });
          } else {
            proc.kill();
          }
        } catch (e) { /* ja morreu: segue */ }
        // Cortamos o processo, mas o que ele ja disse continua valendo: se o log
        // aponta rede/TLS/401, essa e a resposta util. "Timeout" fica so pro caso
        // em que ele travou sem falar nada.
        const key = diagnostico();
        finish(key
          ? { ok: false, key, args: [id], log: out }
          : { ok: false, key: 'be.testTimeout', args: [id, String(teto / 1000)], log: out });
      }, teto);
    });
  },

  // ---- kill ----------------------------------------------------------------
  // Nao da pra usar taskkill /IM node.exe: derrubaria todo Node da maquina
  // (dev server do usuario incluso). O filtro e pela linha de comando conter
  // `arc-1`, entao so morre o que e nosso. Mesma tecnica do killBridgeProcesses.
  kill() {
    try {
      if (process.platform === 'win32') {
        // Restringir a 'node%'/'npx%' nao e detalhe: sem isso o PROPRIO
        // powershell entra no resultado (a string do filtro esta na linha de
        // comando dele) e ele se mata antes de matar o server.
        const ps = [
          '$me = $PID',
          "$p = @(Get-CimInstance Win32_Process -Filter \"Name LIKE 'node%' OR Name LIKE 'npx%'\" | " +
            "Where-Object { $_.CommandLine -like '*arc-1*' -and $_.ProcessId -ne $me })",
          '$p | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }',
          '$p.Count'
        ].join('; ');
        const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 15000 });
        const n = parseInt(String(r.stdout || '').trim(), 10);
        return { killed: Number.isFinite(n) ? n : 0 };
      }
      const r = spawnSync('pkill', ['-f', 'arc-1'], { timeout: 10000 });
      return { killed: r.status === 0 ? null : 0 };
    } catch (e) {
      console.error('Falha ao encerrar processos ARC-1:', e);
      return { killed: 0, error: e.message };
    }
  },

  // ---- instrucoes pro agente (CLAUDE.md / AGENTS.md) -----------------------
  instructions(envs, opts) {
    const L = [];
    L.push('# Workspace SAP MCP Cockpit — ambientes SAP via ARC-1 (MCP)');
    L.push('');
    L.push('Workspace de **um cliente**: acesso aos sistemas SAP dele pelo **ARC-1**');
    L.push('como servidores **MCP**.');
    if (!(opts && opts.protocolo)) {
      L.push('**Nao vasculhe a pasta** procurando codigo nem rode `glob`/`ls` recursivo:');
      L.push('tudo que importa esta aqui.');
    }
    L.push('');
    L.push('## Como funciona');
    L.push('- Cada ambiente abaixo e um servidor MCP de nome `<profile>`; as ferramentas dele');
    L.push('  aparecem com o prefixo `mcp__<profile>__*`.');
    L.push('- Config gerada pelo SAP MCP Cockpit (nao edite a mao): `~/.claude.json` (Claude Code,');
    L.push('  global) e `~/.codex/config.toml` (Codex, global). O ARC-1 **nao tem arquivo de');
    L.push('  profiles** — a conexao inteira vai nos argumentos do server.');
    L.push('- Cookies de SSO dos ambientes Cloud ficam em `cookies-<profile>.txt`.');
    L.push('- **Codex:** os servers MCP so carregam ao INICIAR o Codex — se as tools');
    L.push('  `mcp__<profile>__*` nao aparecerem, REINICIE o Codex (sessao nova).');
    L.push('');
    L.push('## Ambientes');
    L.push('| Profile (MCP) | Cliente | Ambiente | Tipo | Client SAP | URL | Obs |');
    L.push('|---|---|---|---|---|---|---|');
    for (const e of envs) {
      const obs = [];
      if (e.read_only) obs.push('read-only');
      if (e.mode === 'hyperfocused') obs.push('hyperfocused');
      L.push(`| ${envIdOf(e)} | ${e.client_name} | ${e.env_name} | ${e.auth_type} | ${e.sap_client || '?'} | ${e.url} | ${obs.join(', ') || '-'} |`);
    }
    L.push('');
    L.push('## As ferramentas — 12 tools por INTENCAO (nao uma por operacao ADT)');
    L.push('O ARC-1 agrupa por intencao, entao a operacao vai num parametro e nao no nome da');
    L.push('tool. Nao procure `LockObject`/`UpdateSource`/`SearchObject`: nao existem aqui.');
    L.push('- `SAPRead` — fonte, metodos, tabelas, CDS, metadados, historico de revisao');
    L.push('- `SAPSearch` — busca de objeto e full-text no fonte');
    L.push('- `SAPWrite` — criar/alterar/apagar fonte e DDIC');
    L.push('- `SAPActivate` — ativar objeto (individual ou lote), publicar service binding');
    L.push('- `SAPNavigate` — go-to-definition, referencias, code completion');
    L.push('- `SAPQuery` — ABAP SQL');
    L.push('- `SAPTransport` — CTS');
    L.push('- `SAPGit` — gCTS e abapGit');
    L.push('- `SAPContext` — dependencias, usos, analise de impacto');
    L.push('- `SAPLint` — lint local e formatacao no servidor');
    L.push('- `SAPDiagnose` — syntax check, ABAP Unit, ATC');
    L.push('- `SAPManage` — probe de features, cache, pacotes, FLP');
    L.push('');
    L.push('## Escrita e read-only');
    L.push('O ARC-1 nasce **read-only**: sem `--allow-writes` TODA tool de mutacao e recusada.');
    L.push('O Cockpit liga esse opt-in quando a conexao NAO esta marcada como "somente leitura".');
    L.push('- Transport: precisa tambem de `--allow-transport-writes` (o Cockpit liga junto com');
    L.push('  **Habilitar transports**).');
    L.push('- Se uma escrita voltar recusada por permissao, **nao insista**: e opt-in de');
    L.push('  configuracao, nao autorizacao SAP. Peca ao usuario pra desmarcar "somente leitura"');
    L.push('  no Cockpit, **Gerar configs** de novo e REINICIAR o host MCP.');
    L.push('- `Data Preview` e SQL livre sao opt-ins SEPARADOS (`SAP_ALLOW_DATA_PREVIEW` /');
    L.push('  `SAP_ALLOW_FREE_SQL`) e o Cockpit ainda nao os expoe — conte com eles desligados.');
    L.push('');
    L.push('## Testar conexao (rapido, sem gastar token a toa)');
    L.push('Faca **uma busca leve** com `SAPSearch` (poucos resultados). Se voltar objetos, a');
    L.push('conexao + autenticacao estao OK.');
    L.push('- ⚠️ **Nao** use system info como teste: depende de Data Preview / `S_DEVELOP` e');
    L.push('  costuma falhar por autorizacao — isso **nao** significa conexao quebrada.');
    L.push('- Cloud com erro de autenticacao = cookie SSO expirou. O ARC-1 sabe minar cookie');
    L.push('  (`extract-cookies`), mas o Cockpit ainda nao expoe isso: refaca o **Login SSO** no');
    L.push('  Cockpit numa conexao `vsp` do mesmo sistema (o jar e Netscape nos dois) ou reponha');
    L.push('  o `cookies-<profile>.txt` na mao.');
    L.push('');
    L.push('## Conexoes RFC (Tipo `rfc`) — LIMITE que muda o que da pra pedir');
    L.push('Nesses ambientes o ARC-1 **nao** fala HTTP com o SAP: ele fala com um bridge local em');
    L.push('`127.0.0.1:<porta>` que tunela cada request ADT pela FM `SADT_REST_RFC_ENDPOINT` por');
    L.push('RFC, atravessando o SAProuter (mesmo caminho do Eclipse ADT).');
    L.push('- A FM e **stateless por chamada** — nao existe sessao HTTP. Logo **ATIVAR objeto NAO');
    L.push('  FUNCIONA**: o lock e o activate caem em sessoes diferentes.');
    L.push('- Aqui conte com **ler, buscar e analisar**. Precisa gravar/ativar? Diga ao usuario');
    L.push('  pra usar Eclipse ADT (ou um caminho HTTP(S) real ate o ICM).');
    L.push('- Erro `502 ADT-RFC bridge error` ou conexao recusada = problema do bridge/RFC (SDK,');
    L.push('  pyrfc, credencial, router), **nao** do seu fluxo. Peca ao usuario o **Diagnostico');
    L.push('  do bridge** no Cockpit.');
    L.push('');
    L.push('## Erros comuns (decodificador)');
    L.push('- `certificate` / TLS em on-prem → cert self-signed. Marque **--insecure** no');
    L.push('  ambiente pelo Cockpit e **Gerar configs** de novo.');
    L.push('- `403 ... Service cannot be reached` no endpoint ADT → servicos **ADT nao ativos na');
    L.push('  SICF** desse client (tarefa de Basis), nao e problema de credencial.');
    L.push('- Pediu senha → falta `SAP_PASSWORD`. Via MCP ela ja vai no bloco `env` do server;');
    L.push('  refaca **Gerar configs** no Cockpit se faltar.');
    L.push('');
    L.push('## ARC-1 pela CLI');
    L.push('Existe, e e o mesmo binario: sem subcomando ele sobe o server MCP (`serve`), e com');
    L.push('subcomando roda uma operacao unica — `search`, `read`, `sql`, `tools`, `call`, `atc`,');
    L.push('`unittest`, entre outras. As flags de conexao sao **globais** e vem ANTES do');
    L.push('subcomando. **Prefira sempre as tools MCP**: pela CLI cada chamada paga o start do');
    L.push('processo de novo e voce teria que remontar as credenciais na mao. A CLI e plano B —');
    L.push('util pra isolar se a falha e do MCP ou do SAP quando algo esta estranho.');
    L.push('');
    return L.join('\n');
  }
};
