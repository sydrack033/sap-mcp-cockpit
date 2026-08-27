# SAP MCP Cockpit

App desktop (Electron) que **liga seu assistente de IA (Claude Code / Codex) ao SAP via MCP** — sem editar `.mcp.json` / `.vsp.json` / config do Codex na mão.

Você cadastra **clientes e ambientes** (Cloud SSO, On-Premise basic auth ou RFC atrás de SAProuter) e o app gera toda a configuração, faz o login SSO, testa a conexão e abre o projeto no VSCode. Hoje o **motor** é o [`vsp`](https://github.com/oisee/vibing-steampunk) (vibing-steampunk); a ideia é suportar outros motores (ex.: ARC-1) no futuro.

Cada ambiente vira um MCP server nomeado `cliente-ambiente` (ex.: `mcp__acme-dev__*`).

> 📖 **Primeira vez?** Siga o **[TUTORIAL.md](TUTORIAL.md)** — passo a passo do zero (baixar o app + o vsp, montar as pastas, cadastrar ambiente, gerar config e abrir no VSCode já conversando com o SAP).

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
2. **+ Novo ambiente**: Cliente + Ambiente (ex.: `Acme` / `DEV` → profile `acme-dev`), tipo **Cloud** (SSO), **On-Premise** (user + senha) ou **SAProuter (RFC)** (sistemas atrás de router, ver secao abaixo), URL + Client SAP, e flags (mode, `--insecure`, edits transportáveis, transports).
   - Use **expert** se for **criar/editar objeto** (precisa das tools `LockObject`/`UpdateSource`).
3. **Login SSO** (só Cloud): no card do ambiente → **Login SSO** → conclua no Chrome → cookie salvo (`cookies-<profile>.txt`).
4. **Testar**: pinga o ambiente (busca ADT leve) e diz se conexão + auth + ADT estão OK.
5. **Gerar configs**: escreve a config (ver tabela abaixo) e, no fim, **encerra os processos `vsp` que ficaram rodando** — eles seguram a config antiga em memória e fariam o MCP continuar respondendo com os profiles/cookies velhos. Depois disso, **reinicie o host MCP** (Claude Code / Codex) pra ele subir o `vsp` com a config nova.
6. **Abrir no VSCode**: abre a pasta do projeto pro Claude Code.

## Conexão via SAProuter (RFC)

Alguns sistemas só são alcançáveis por um SAProuter que libera rota **NI** (gateway `33nn`) e **nega** rota crua até o ICM. O `vsp` só fala HTTP, então nesses casos ele não tem caminho nenhum — embora o Eclipse ADT conecte normalmente.

O tipo de conexão **SAProuter (RFC)** resolve isso. O app sobe um bridge local que empacota cada request ADT na function module padrão `SADT_REST_RFC_ENDPOINT` e a envia por RFC, atravessando o router — o mesmo caminho que o Eclipse usa:

```
Claude/Codex --MCP--> vsp --HTTP--> bridge (127.0.0.1) --RFC(+saprouter)--> SAP
```

Pro `vsp` é transparente: a URL dele vira `http://127.0.0.1:<porta>` e todas as flags (`--mode`, `--read-only`, transports) continuam valendo.

### O que preencher

Além de cliente/ambiente/mandante/usuário/senha: **servidor de aplicação** (o host como o SAP o conhece, normalmente interno), **número do sistema** e a **rota do SAProuter** (`/H/router/S/3299`). A URL some do formulário — ela é derivada da porta do bridge. Cada conexão RFC usa uma porta local própria.

O botão **⤓ Puxar do SAP GUI** preenche esses campos a partir do `SAPUILandscape.xml`, inclusive a rota do router.

### Pré-requisitos

O app **já traz** o Python e o `pyrfc` embutidos — não há nada a instalar. A única peça que falta é a **`sapnwrfc.dll` x64** do SAP NW RFC SDK, que a SAP não permite redistribuir. Ela vem com o **SAP GUI 8.00 64-bit** (ou o 7.70 com o opcional *64Bit RFC Controls*), que a maioria das máquinas já tem.

**Configurações → Rodar diagnóstico do bridge** checa cada elo (Python x64, SDK, `pyrfc`, scripts, `vsp`) e diz exatamente qual faltou.

### Limite importante

A function module é **stateless por chamada** — não existe sessão HTTP sobre RFC. Logo **ativar objeto não funciona** por esse caminho: o lock e o activate caem em sessões diferentes. Em NetWeaver 75x o lock ainda volta `MODIFICATION_SUPPORT=NoModification` e o `vsp` aborta antes de gravar.

Conte com **ler, buscar e analisar**. Para gravar e ativar, use o Eclipse ADT ou um caminho HTTP(S) real até o ICM. O `CLAUDE.md`/`AGENTS.md` gerado avisa o agente disso, pra ele não queimar tokens tentando.

### Build

O runtime do bridge não vai no repositório. O `npm run dist` roda antes o `npm run fetch-runtime`, que baixa o Python embutível e o wheel do `pyrfc`, **confere o SHA256** e empacota em `resources/bridge-runtime` (~20 MB).

> O bridge é o projeto [adt-rfc-bridge](https://github.com/enricoandreoli/adt-rfc-bridge) (MIT), de Enrico Andreoli, embarcado sem modificações em `bridge/`. Veja `bridge/NOTICE.md`.

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

## Fluxo de desenvolvimento → build → release (pra quem mexe no código)

Roteiro completo de **depois que você alterou o código** até publicar uma nova versão. Tudo em **PowerShell**, na raiz do projeto.

> Confirme antes que o `gh` está na conta certa: `gh auth status`. Se não estiver: `gh auth switch --user sydrack033`.

### 1. Testar a mudança no app
```powershell
npm start
```
> Mexeu só no `renderer/` (HTML/CSS/JS da tela)? Dá pra recarregar a janela aberta com **Ctrl+R** em vez de reiniciar. Mexeu no `main.js`/`preload.js`? Tem que fechar e `npm start` de novo.

### 2. Subir o fonte numa branch nova
```powershell
# cria e já entra na branch nova (troque o nome)
git checkout -b feature/minha-mudanca

# commita tudo
git add -A
git commit -m "descreva a mudança aqui"

# sobe a branch e cria o tracking
git push -u origin feature/minha-mudanca
```
Depois, **abra o Pull Request** no GitHub e faça o merge na `main`. (Ou, se for direto, sem PR:)
```powershell
git checkout main
git merge feature/minha-mudanca
git push
```

### 3. Subir versão (gera commit + tag automático)
Na `main`, já com tudo mergeado:
```powershell
git checkout main
git pull

# escolha um: patch (1.0.0->1.0.1) | minor (1.0.0->1.1.0) | major (1.0.0->2.0.0)
npm version minor

# sobe o commit de versão + a tag (ex.: v1.1.0)
git push --follow-tags
```
> `npm version` atualiza o `package.json` e **cria a tag `vX.Y.Z`** sozinho.

### 4. Gerar o instalador (já com a versão nova)
```powershell
npm run dist
```
Gera dois arquivos em `..\..\sap-mcp-cockpit-dist\`:

| Arquivo | Pra quê |
|---|---|
| `SAPMCPCockpit-Setup-<versão>.exe` | Instalador one-click, por usuário (`%LOCALAPPDATA%`, **sem admin**) |
| `latest.yml` | **Metadado do auto-update** — versão + sha512 + nome do instalador |

A saída fica **fora** da pasta do projeto de propósito (evita o VSCode travar o `.exe` durante o build).
> Feche o Cockpit antes do build, senão dá erro de arquivo travado.

### 5. Publicar a Release no GitHub (com o `.exe` **e o `latest.yml`**)
> ⚠️ **O `latest.yml` é obrigatório.** É ele que o app instalado consulta pra saber que saiu versão nova. Release sem esse anexo = auto-update quebrado pra todo mundo que já instalou.

Troque a versão nos três lugares:
```powershell
gh release create v1.1.0 --repo sydrack033/sap-mcp-cockpit --title "SAP MCP Cockpit v1.1.0" --notes "O que mudou nesta versão." "..\..\sap-mcp-cockpit-dist\SAPMCPCockpit-Setup-1.1.0.exe" "..\..\sap-mcp-cockpit-dist\latest.yml"
```
Conferir (tem que listar os **dois** assets):
```powershell
gh release view v1.1.0 --repo sydrack033/sap-mcp-cockpit
```
> Link fixo de download da última versão (pra divulgar): `https://github.com/sydrack033/sap-mcp-cockpit/releases/latest`

### Resumo (cola rápida)
```powershell
git checkout -b feature/x; git add -A; git commit -m "..."; git push -u origin feature/x
# (merge na main pelo PR, depois:)
git checkout main; git pull; npm version minor; git push --follow-tags
npm run dist
gh release create v1.1.0 --repo sydrack033/sap-mcp-cockpit --title "SAP MCP Cockpit v1.1.0" --notes "..." "..\..\sap-mcp-cockpit-dist\SAPMCPCockpit-Setup-1.1.0.exe" "..\..\sap-mcp-cockpit-dist\latest.yml"
```

## Auto-update

A partir da **v2.0.0** o app se atualiza sozinho: `electron-updater` + as Releases deste repositório (repo público, então não precisa de token).

Como funciona:
1. 3 segundos depois de abrir, o app consulta a release mais recente do GitHub.
2. Se houver versão maior, baixa em background — a pílula na barra de status mostra o progresso.
3. Quando termina, aparece **Reiniciar agora**. Quem ignorar leva a atualização no próximo fechamento do app (`autoInstallOnAppQuit`).

Detalhes que importam:
- **Só funciona no app instalado.** Rodando por `npm start` a pílula fica escondida e o botão de versão responde "só funciona no app instalado" — em dev não existe `app-update.yml`.
- **Falha de rede não quebra nada**: o app segue na versão atual e mostra a pílula vermelha. Dá pra forçar uma nova checagem clicando na versão (`vX.Y.Z`) no canto da barra de status.
- **Rate limit** do GitHub: 5000 req/hora por usuário, e cada checagem gasta até 3 — folgado pro uso real.
- **Sem code signing**: o Windows/SmartScreen ainda avisa na primeira instalação. O update em si não exige assinatura no Windows (no macOS exigiria).
- Os dados (`settings.json`/`clients.json`) ficam em `%APPDATA%/sap-mcp-cockpit/`, **fora** da pasta de instalação — atualizar não perde nada, e quem vinha do portable mantém tudo.

> **Erro de symlink no `winCodeSign` durante o `npm run dist`?** O electron-builder baixa um pacote com symlinks de macOS que o Windows recusa sem Developer Mode/admin. Contorno: extrair o pacote no cache **sem a pasta `darwin`**:
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
