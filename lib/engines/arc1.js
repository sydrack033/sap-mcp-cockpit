'use strict';

// ---------------------------------------------------------------------------
// Engine `arc1` (ARC-1, github.com/arc-mcp/arc-1).
//
// Mesma interface do engine vsp (ver ./vsp.js). As diferencas que importam:
//
//   - NAO e binario unico: e pacote npm, rodado por `npx -y arc-1@latest`. Por
//     isso `binArgs` existe -- o comando e `npx` e o resto vai como argumento.
//   - NAO tem CLI: e so servidor MCP (stdio ou http). Nao da pra "rodar um
//     search pela linha de comando", entao o teste de conexao precisa de um
//     handshake MCP. Enquanto isso nao existe (Fase 3), `caps.cliTest` e false
//     e o runTest devolve mensagem clara em vez de fingir que testou.
//   - NAO tem browser-auth. O cookie jar dele e Netscape, o MESMO do vsp, entao
//     na pratica se mina o cookie com o vsp e aponta o --cookie-file aqui.
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
const { spawnSync } = require('child_process');

const { envIdOf, urlOf, cookieFileFor, folderOfEnv } = require('../common');

// Como subir o ARC-1 quando o usuario nao configurou nada.
const DEFAULT_CMD  = 'npx';
const DEFAULT_ARGS = ['-y', 'arc-1@latest'];

module.exports = {
  id: 'arc1',
  label: 'ARC-1',

  caps: {
    browserAuth: false,        // sem `--browser-auth`: o botao Login SSO some
    cliTest: false,            // sem CLI: o teste real chega na Fase 3
    transportableEdits: false, // nao ha equivalente a --allow-transportable-edits
    modes: ['standard', 'hyperfocused']
  },

  // ---- binario -------------------------------------------------------------
  binPath(settings) {
    return String((settings && settings.arc1_cmd) || '').trim() || DEFAULT_CMD;
  },

  binArgs(settings) {
    const bruto = String((settings && settings.arc1_args) || '').trim();
    if (!bruto) return DEFAULT_ARGS.slice();
    // split simples respeitando aspas: basta pra "-y arc-1@latest" ou um caminho
    // de entrypoint com espaco no meio.
    return (bruto.match(/"[^"]*"|\S+/g) || []).map(s => s.replace(/^"|"$/g, ''));
  },

  // So da pra checar quando o usuario apontou um CAMINHO. `npx` (ou qualquer
  // comando do PATH) nao tem arquivo pra procurar -- fingir que checou daria
  // erro errado, entao deixa passar e a falha aparece na hora de subir.
  checkBin(settings) {
    const bin = this.binPath(settings);
    if (!/[\\/]/.test(bin)) return null;
    if (!fs.existsSync(bin)) return { ok: false, key: 'be.engineBinNotFound', args: [this.label, bin] };
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

  runTest() {
    return Promise.resolve({ ok: false, key: 'be.testNotSupported', args: [this.label] });
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
  instructions(envs) {
    const L = [];
    L.push('# Workspace SAP MCP Cockpit — ambientes SAP via ARC-1 (MCP)');
    L.push('');
    L.push('Este workspace **nao tem codigo de aplicacao**. Ele so configura acesso a sistemas');
    L.push('SAP pelo **ARC-1** como servidores **MCP**. **Nao vasculhe a pasta** procurando');
    L.push('codigo nem rode `glob`/`ls` recursivo: tudo que importa esta aqui.');
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
    L.push('- Cloud com erro de autenticacao = cookie SSO expirou. O ARC-1 nao tem login por');
    L.push('  browser: refaca o **Login SSO** no Cockpit numa conexao `vsp` do mesmo sistema');
    L.push('  (o formato do cookie jar e o mesmo) ou reponha o `cookies-<profile>.txt` na mao.');
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
    L.push('Nao existe. O ARC-1 e **so servidor MCP** — nao ha subcomando `search`/`source` como');
    L.push('no vsp. Se o MCP estiver indisponivel, nao ha plano B pela linha de comando: reporte');
    L.push('ao usuario em vez de tentar improvisar com `npx`.');
    L.push('');
    return L.join('\n');
  }
};
