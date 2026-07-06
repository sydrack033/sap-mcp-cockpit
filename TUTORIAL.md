# Tutorial — SAP MCP Cockpit (do zero ao primeiro chat com o SAP)

Guia completo: baixar, instalar, configurar um ambiente SAP e abrir o VSCode já conversando com o SAP via IA (Claude Code ou Codex).

> **Resumo do que você vai montar:** o **vsp** é o "motor" que fala com o SAP. O **SAP MCP Cockpit** é o painel que configura esse motor pro seu assistente de IA. Você cadastra o ambiente, o Cockpit gera a config de MCP, e o Claude/Codex passa a ter ferramentas pra ler/editar ABAP direto no chat.

---

## 0. ANTES DE TUDO — escolha seu LLM e instale a extensão no VSCode

Decida **qual assistente** vai usar e **instale a extensão no VSCode primeiro** (sem isso, "Abrir no VSCode" não vai ter chat pra conversar):

1. Abra o **VSCode** → **Extensions** (`Ctrl+Shift+X`).
2. Instale **uma** das opções:
   - **Claude Code** (da Anthropic), ou
   - **Codex** (da OpenAI).
3. Faça login na extensão (a conta do respectivo serviço).

> Você pode ter as duas, mas comece com uma. O Cockpit gera config pros dois de qualquer jeito.

---

## 1. Baixar os 2 programas

### 1.1 — SAP MCP Cockpit (este app)
- Página de releases: **https://github.com/sydrack033/sap-mcp-cockpit/releases/latest**
- Baixe o arquivo **`SAPMCPCockpit-1.0.0-portable.exe`**.
- É **portátil**: roda com duplo-clique, **não precisa instalar nada** (nem Node).

### 1.2 — vsp, o motor (vibing-steampunk)
- Página de releases: **https://github.com/oisee/vibing-steampunk/releases**
- Na lista de **Assets** da última versão, baixe o build de **Windows** para **amd64 / x86-64** (nome no estilo `vsp-windows-amd64...` / `..._windows_x86_64...`). É o de PC Windows comum.
- ⚠️ Não pegue versões `arm64`, `linux` ou `darwin` (mac).

> **Aviso do Windows ao abrir os `.exe`:** como são apps novos e sem assinatura paga, o **SmartScreen** pode mostrar "O Windows protegeu o computador". Clique em **Mais informações → Executar assim mesmo**. (Vale tanto pro Cockpit quanto pro vsp.)

---

## 2. Montar a estrutura de pastas

Dentro do seu usuário, monte assim (troque `SEU_USUARIO`):

```
C:\Users\SEU_USUARIO\Projects\
├── tools\
│   └── vsp.exe          ← o vsp baixado, RENOMEADO para "vsp.exe"
└── meu-sap\             ← pasta do "workspace" (onde as configs serão geradas)
```

Passo a passo:
1. Crie a pasta `C:\Users\SEU_USUARIO\Projects\tools\`.
2. **Mova** o vsp baixado pra dentro de `tools\` e **renomeie para `vsp.exe`** (tire o sufixo de versão/arquitetura do nome).
3. Crie a pasta do seu workspace, ex.: `C:\Users\SEU_USUARIO\Projects\meu-sap\`. É aqui que o Cockpit vai escrever os arquivos de config e os cookies.

> O `.exe` do **Cockpit** pode ficar onde você quiser (ex.: `Downloads` ou `Projects`). Ele não precisa estar dentro do workspace.

---

## 3. Abrir o Cockpit e configurar (aba **Configurações**)

Dê duplo-clique no **`SAPMCPCockpit-1.0.0-portable.exe`**. Na seção **Configurações** (topo):

1. **Caminho do vsp.exe** → **Procurar…** → selecione `C:\Users\SEU_USUARIO\Projects\tools\vsp.exe`.
2. **Pasta do projeto (workspace)** → **Procurar…** → selecione a pasta `meu-sap` que você criou.
3. **Caminho do Chrome** → **não precisa mexer** (já vem o caminho padrão do Chrome). Só ajuste se o seu Chrome estiver instalado em outro lugar.
4. **Comando do VSCode** → deixe **`code`** (já é o padrão).
5. Clique em **Salvar configurações**.

> 🌐 O Chrome é usado pro **login SSO** dos ambientes **Cloud** (o Edge tem bug com o vsp). Se você só usa On-Premise, não precisa do Chrome.

---

## 4. Cadastrar um ambiente

Clique em **+ Novo ambiente** e preencha:

| Campo | O que é |
|---|---|
| **Cliente** | Nome do cliente/sistema (ex.: `Acme`) |
| **Ambiente** | DEV / QAS / PRD (ex.: `QAS`) |
| **Tipo de autenticação** | **Cloud** ou **On-Premise** (ver abaixo) |
| **URL** | URL do SAP |
| **Client SAP** | Mandante (ex.: `100`) |
| **Mode** | focused / expert / hyperfocused (ver abaixo) |

> O **profile** (nome do MCP) vira `cliente-ambiente` — ex.: `acme-qas` → ferramentas `mcp__acme-qas__*`.

### Cloud vs On-Premise

- **Cloud (SSO SAML / cookie)** — pra **S/4HANA Cloud** (URL tipo `https://myXXXXXX.s4hana.cloud.sap`). A autenticação é por **cookie de login SSO** (você faz o login pelo navegador, passo 5).
- **On-Premise (basic auth)** — pra **ECC / S/4 on-prem** (URL tipo `https://host:44300` ou `http://host:8000`). Pede:
  - **Usuário SAP** e **Senha**.
  - **--insecure** → deixe **ligado** (já vem marcado). Servidor on-prem quase sempre tem certificado *self-signed*; sem isso dá erro de TLS.

### On-Premise: descobrir a URL certa (porta, SICF, hostname)

O vsp fala **HTTP/HTTPS** (não é o protocolo do SAP GUI), então a URL precisa apontar pra **porta HTTP(S) do ICM** com o **ADT ativo**. Faça estas checagens no **SAP GUI**:

1. **Porta HTTP/HTTPS certa (SMICM):** rode `/nSMICM` → menu **Ir para → Serviços** (*Goto → Services*). Ali aparecem as portas **HTTP** e **HTTPS** ativas (ex.: HTTPS `44300`, HTTP `8000`). Use essa porta na URL: `https://<host>:44300`.

2. **ADT ativo na SICF:** rode `/nSICF` → navegue em `default_host → sap → bc → `**`adt`**. Se o nó **`adt`** (e os filhos) estiver **cinza/inativo**, clique com o botão direito → **Ativar serviço** (*Activate*). Sem isso dá `403 Service cannot be reached`.

3. **Testar o HTTP pelo Fiori Launchpad:** rode **`/n/UI2/FLP`** — se o Launchpad **abrir no navegador**, o **ICM/HTTP está funcionando**, e a **URL na barra do navegador mostra o host + a porta** que o SAP usa. Ótimo pra confirmar o endpoint certo pra colocar no Cockpit.

4. **Hostname que não resolve → arquivo `hosts`:** muitas vezes o SAP espera/responde por um **hostname** (ex.: `sapqas`) que a sua máquina não sabe resolver, enquanto o **SAP Logon** conecta direto pelo **IP interno**. Solução: pegue o **IP** que está no **SAP Logon** e mapeie pro hostname no arquivo `hosts` do Windows:
   - Abra o **Bloco de Notas como Administrador** e edite:
     `C:\Windows\System32\drivers\etc\hosts`
   - Adicione uma linha no formato **`IP<TAB/espaços>hostname [fqdn]`**:
     ```
     10.20.30.40    sapqas    sapqas.suaempresa.com
     ```
     (`10.20.30.40` = o IP interno que está no SAP Logon; `sapqas` = o hostname que aparece na URL/erro). Salve.
   - Agora `https://sapqas:44300` **resolve**. Use o **hostname** (não o IP) na URL do Cockpit — o certificado e o ADT muitas vezes só batem com o hostname.

> **Regra de ouro on-prem:** URL = `https://<hostname>:<porta-HTTPS-da-SMICM>`, com o hostname resolvendo (DNS ou `hosts`) pro IP do SAP Logon, e o **ADT ativado na SICF**.

### Os modos do MCP (`Mode`)

Controla **quantas/quais ferramentas** o vsp expõe pro LLM:

| Mode | Pra quê |
|---|---|
| **focused** (~100 tools) | **Padrão.** Ler, buscar, navegar, entender código. Bom pra análise/exploração. |
| **expert** (147 tools) | Tudo do focused **+ as ferramentas de criar/editar/ativar objeto** (`LockObject`, `UpdateSource`, `Activate`...). **Use `expert` se for desenvolver** (gravar código no SAP). |
| **hyperfocused** (1 tool) | Uma única ferramenta "guarda-chuva" — gasto mínimo de contexto/token. Avançado. |

> 👉 Se a sua intenção é **criar ou editar objeto** no SAP, escolha **expert**. No `focused` faltam as ferramentas de gravação e a IA não consegue criar/editar direito.

As **flags** (Read-only, Permitir edits transportáveis, Habilitar transports) controlam permissões de escrita/transporte — deixe os padrões se não tiver certeza.

Clique em **Salvar ambiente**.

---

## 5. (Só **Cloud**) Login SSO

No card do ambiente, clique em **Login SSO** → o **Chrome** abre → faça seu login normal no SAP → quando concluir, o Cockpit salva o cookie (o botão fica **verde ✓**).

> O cookie **expira** com o tempo. Se a conexão parar de funcionar depois, é só clicar **Login SSO** de novo.

---

## 6. Testar a conexão

Clique em **Testar** no card. O Cockpit faz uma busca leve no SAP e diz se está tudo certo:
- **✓ Conexão OK** → pode seguir.
- **Erro de TLS** → marque/confirme o **--insecure** (on-prem) e gere as configs de novo.
- **403 / ADT não ativo** → os serviços **ADT precisam estar ativos na SICF** (tarefa de Basis no SAP), não é problema do app.
- **Sem cookie** (cloud) → faça o **Login SSO** antes.

---

## 7. Gerar as configs

Clique em **Gerar configs**. Isso escreve, na pasta do workspace:
- `.vsp.json`, `.env`, `cookies-<profile>.txt`
- `.mcp.json` (pro **Claude Code**)
- `CLAUDE.md` / `AGENTS.md` (instruções que a IA lê)

E, se você usa **Codex**, mescla o servidor MCP no seu **`~/.codex/config.toml` global** (o Codex lê de lá, não da pasta do projeto).

---

## 8. Abrir no VSCode e começar a usar

Clique em **Abrir no VSCode**. A pasta do workspace abre no editor.

### Se você usa **Claude Code**
1. Abra o painel do **Claude Code**.
2. Ele detecta o `.mcp.json` e pode **pedir pra aprovar/ativar** os servidores MCP → **aprove**.
3. Se as ferramentas não aparecerem, recarregue: `Ctrl+Shift+P` → **Developer: Reload Window**.

### Se você usa **Codex**
1. ⚠️ **Reinicie o Codex** (feche e abra uma **sessão nova**). O Codex carrega o MCP **só no início da sessão** — não aparece no meio de uma conversa já aberta.
2. Se ele perguntar, **confie na pasta** (trust).

### Verificando que funcionou
Peça pro LLM **listar as ferramentas MCP**. Devem aparecer as `mcp__<profile>__*` (ex.: `mcp__acme-qas__GetSource`, `...Search`, `...EditSource`).

---

## 9. ⭐ A primeira mensagem pro LLM (importante!)

Logo de cara, avise a IA pra **usar as ferramentas MCP** e **não** chamar o `vsp.exe` na mão pelo terminal. Cole isto no chat:

```
Use SEMPRE as ferramentas MCP do profile (mcp__<profile>__*) pra falar com o SAP —
NÃO rode o vsp.exe direto por shell/PowerShell. Pra ler/buscar use as tools de read/search;
pra criar/editar objeto, use o fluxo LockObject → UpdateSource → Activate → UnlockObject
(precisa do mode expert). Se uma operação demorar, NÃO mate nem retente às cegas: releia
o source antes, pode já ter sido gravado.
```

Troque `<profile>` pelo nome do seu ambiente (ex.: `acme-qas`).

> Por quê? Se a IA chamar o `vsp.exe` na unha, ela perde os benefícios do MCP (espera de operações longas, framing correto) e costuma sofrer. Com o MCP nativo, o próprio harness do LLM cuida disso.

---

## 10. Resolução de problemas (rápido)

| Sintoma | Causa / solução |
|---|---|
| **As tools `mcp__*` não aparecem** | **Codex:** reinicie (sessão nova). **Claude:** aprove o MCP / Reload Window. |
| `SAP URL is required` no startup do MCP | Config antiga (`-s`). **Gere as configs de novo** com esta versão do Cockpit. |
| `tls: certificate has expired` | On-prem self-signed → marque **--insecure** e gere as configs de novo. |
| Não conecta / host não encontrado (on-prem) | Confira **porta** (SMICM → Serviços), **ADT ativo na SICF** e o **hostname no `hosts`** — ver a seção "On-Premise: descobrir a URL certa". |
| `403 ... Service cannot be reached` | ADT **não ativo na SICF** → ative `default_host/sap/bc/adt` na `/nSICF`. |
| `403 ... ExceptionResourceNoAuthorization` ("Keine Berechtigung") | **Falta de autorização do usuário** (não é SICF). Falta o objeto **`S_ADT_RES`** (+ `S_DEVELOP`, `S_RFC`). Rode **`/nSU53`** logo após o erro pra ver o que faltou e passe pro Basis. Típico de user de **QAS/PRD** mais restrito que o de DEV. |
| Auth falhou / pediu senha (cloud) | Cookie SSO expirou → **Login SSO** de novo. |
| `423 lock handle invalid` ao criar/editar objeto | Use **mode expert** + fluxo `LockObject→UpdateSource→Activate→UnlockObject`. Em **SAP ECC antigo** isso pode ser um limite do próprio vsp (sessão stateful do ADT). |
| Windows bloqueou o `.exe` | SmartScreen → **Mais informações → Executar assim mesmo**. |

---

## Links

- **Release do SAP MCP Cockpit:** https://github.com/sydrack033/sap-mcp-cockpit/releases/latest
- **Repositório:** https://github.com/sydrack033/sap-mcp-cockpit
- **Releases do vsp (motor):** https://github.com/oisee/vibing-steampunk/releases

---

## Apêndice — ordem rápida (cola)

1. Instalar extensão do LLM no VSCode (Claude **ou** Codex) e logar.
2. Baixar Cockpit (nosso release) + vsp (Windows amd64).
3. `Projects\tools\vsp.exe` (renomeado) + `Projects\meu-sap\` (workspace).
4. Abrir Cockpit → Configurações: vsp.exe + pasta do projeto → **Salvar configurações**.
5. **+ Novo ambiente** (Cloud/On-Prem, URL, client, **mode**) → **Salvar ambiente**.
6. (Cloud) **Login SSO** → **Testar**.
7. **Gerar configs**.
8. **Abrir no VSCode** → (Codex) reiniciar / (Claude) aprovar MCP.
9. Avisar o LLM pra usar o **MCP** (mensagem do passo 9).
