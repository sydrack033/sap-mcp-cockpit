# SAP MCP Cockpit

App desktop (Electron) que **liga seu assistente de IA (Claude Code / Codex) ao SAP via MCP** — sem editar `.mcp.json` / `.vsp.json` / config do Codex na mão.

Você cadastra **clientes e ambientes** (Cloud SSO ou On-Premise basic auth) e o app gera toda a configuração, faz o login SSO, testa a conexão e abre o projeto no VSCode. Hoje o **motor** é o [`vsp`](https://github.com/oisee/vibing-steampunk) (vibing-steampunk); a ideia é suportar outros motores (ex.: ARC-1) no futuro.

Cada ambiente vira um MCP server nomeado `cliente-ambiente` (ex.: `mcp__acme-dev__*`).

---

## Pré-requisitos

- **Node.js** (vem com `npm`)
- **`vsp.exe`** baixado (https://github.com/oisee/vibing-steampunk/releases)
- **VSCode** com `code` no PATH (pra abrir pelo botão / usar Claude Code)
- **Chrome** (pro browser-auth dos tenants Cloud — o Edge tem bug com o vsp)
- **Codex** instalado (só se for usar Codex — o app mescla a config no `~/.codex/config.toml`)

## Instalar e rodar

```powershell
npm install
npm start
```

## Como usar

1. **Configurações** (topo): caminho do `vsp.exe`, pasta do projeto (workspace), caminho do Chrome, comando do VSCode (`code`). Clique **Salvar configurações**.
2. **+ Novo ambiente**: Cliente + Ambiente (ex.: `Acme` / `DEV` → profile `acme-dev`), tipo **Cloud** (SSO) ou **On-Premise** (user + senha), URL + Client SAP, e flags (mode, `--insecure`, edits transportáveis, transports).
   - Use **expert** se for **criar/editar objeto** (precisa das tools `LockObject`/`UpdateSource`).
3. **Login SSO** (só Cloud): no card do ambiente → **Login SSO** → conclua no Chrome → cookie salvo (`cookies-<profile>.txt`).
4. **Testar**: pinga o ambiente (busca ADT leve) e diz se conexão + auth + ADT estão OK.
5. **Gerar configs**: escreve a config (ver tabela abaixo).
6. **Abrir no VSCode**: abre a pasta do projeto pro Claude Code.

## Arquivos / config gerados

| Onde | Pra quem | Conteúdo |
|---|---|---|
| `.vsp.json` (projeto) | comum | Profiles (URL, client, `cookie_file` p/ cloud, `user`/`insecure` p/ onprem) |
| `.env` (projeto) | comum | Senhas on-prem (`VSP_<PROFILE>_PASSWORD`, com e sem hífen) |
| `cookies-<profile>.txt` (projeto) | comum | Cookie SSO de cada tenant cloud |
| `.mcp.json` (projeto) | **Claude Code** | Um MCP server por ambiente, **conexão explícita** nos args |
| `CLAUDE.md` / `AGENTS.md` (projeto) | **Claude / Codex** | Instruções do workspace + playbook de operação |
| `~/.codex/config.toml` (global) | **Codex** | Bloco gerenciado `[mcp_servers.<profile>]` (só se o Codex existir na máquina) |
| `.gitignore` (projeto) | — | Ignora `.env`, `.vsp.json`, `.mcp.json`, `.codex/`, `cookies*.txt` |

> **Codex lê MCP do `~/.codex/config.toml` GLOBAL**, não de um arquivo no projeto. O app mescla um bloco gerenciado (delimitado por marcadores) preservando o resto da sua config. As tools MCP só aparecem ao **reiniciar o Codex** (sessão nova).

## Por que a conexão vai explícita nos args

Em modo MCP, o `vsp` **não aplica o `-s <profile>`** — ele exige `--url`/`--client`/`--cookie-file` (cloud) ou `--user`/`--password`/`--insecure` (on-prem) direto. Por isso o app gera os servers com a conexão completa nos `args` (self-contained), em vez de depender do `.vsp.json` + cwd. Pros ambientes Codex, também adiciona `startup_timeout_sec`/`tool_timeout_sec` generosos.

## Onde ficam os dados do app

`settings.json` e `clients.json` em `%APPDATA%/sap-mcp-cockpit/` (perfil do usuário). As senhas on-prem ficam aí e no `.env`/config gerados (texto plano, protegido pela ACL do seu usuário). *(Migração automática do nome antigo `steampunk-manager` é feita no primeiro start.)*

## Compilar num .exe portable

```powershell
npm run dist
```

Gera `..\..\sap-mcp-cockpit-dist\SAPMCPCockpit-1.0.0-portable.exe` (roda com duplo-clique, sem Node). A saída fica **fora** da pasta do projeto de propósito (evita o VSCode travar o `.exe` durante o build).

> **Erro de symlink no `winCodeSign` durante o build?** O electron-builder baixa um pacote com symlinks de macOS que o Windows recusa sem Developer Mode/admin. Contorno: extrair o pacote no cache **sem a pasta `darwin`**:
> ```powershell
> $cache = "$env:LOCALAPPDATA\electron-builder\Cache\winCodeSign"
> $7za = ".\node_modules\7zip-bin\win\x64\7za.exe"
> & $7za x (Join-Path $cache (Get-ChildItem $cache -Filter *.7z)[0].Name) "-o$cache\winCodeSign-2.6.0" "-xr!darwin" -y
> ```

## Notas

- Cookies de tenant Cloud expiram → clique **Login SSO** de novo e reinicie o MCP (no VSCode: recarregar; no Codex: nova sessão).
- On-Premise quase sempre tem cert self-signed → deixe `--insecure` ligado.
- `403 Service cannot be reached` no ADT = serviço ADT não ativo na SICF (lado SAP), não é conexão.
- Em **SAP ECC antigo**, o `vsp` pode falhar a gravação de objeto (`423 lock handle invalid`) por limitação de sessão stateful do ADT — é do motor, não do app.
