# SAP MCP Cockpit — instrucoes do repositorio

App Electron que gera as configs de MCP dos workspaces de cliente (`.vsp.json`,
`~/.claude.json`, `~/.codex/config.toml`, `CLAUDE.md`/`AGENTS.md`). Sem build
step: `npm start` roda, `npm run dist` empacota com o electron-builder.

## Todo release novo entra nos patch notes

O app tem a aba **Novidades**, alimentada por `renderer/patchnotes.js`.
**Nenhum release sai sem uma secao nova la.** O usuario ve a versao mudar
sozinha na barra de status (auto-update) e, sem a entrada, nao tem como saber o
que mudou — que e exatamente o problema que a aba existe pra resolver.

Ao subir a versao:

1. `package.json` → `version`.
2. `renderer/patchnotes.js` → entrada nova **no topo** do array, com essa mesma
   versao, a data em ISO (`aaaa-mm-dd`) e um item por mudanca:
   `{ t: 'feat' | 'fix', pt: '...', en: '...' }`.
3. Escreva o que mudou **pro usuario**, nos dois idiomas — nao a mensagem do
   commit. "Workbook vira `.md` na primeira leitura", nao "refactor do protocolo".
4. Commit do bump no padrao do repo: `chore: versao <x.y.z>`.

A entrada do topo tem que bater com o `version` do `package.json`: e ela que
recebe a marca **instalada** na aba, comparada com `app.getVersion()`.

Por que os patch notes moram em JS e nao num `.md`: so `renderer/**` entra no
pacote (`build.files` do `package.json`), e a aba e bilingue — um markdown na
raiz do repo nunca chegaria ao app instalado.

## Onde as coisas ficam

| Arquivo | O que e |
|---|---|
| `main.js` | processo principal: settings, geracao dos workspaces, IPC, auto-update |
| `lib/engines/` | um modulo por engine (vsp, ARC-1): config gerada + instrucoes do agente |
| `renderer/app.js` | toda a logica da UI |
| `renderer/i18n.js` | dicionario en/pt |
| `renderer/patchnotes.js` | historico de releases da aba Novidades |
| `TUTORIAL.md` | manual do usuario final |

Os `<script>` do renderer sao classicos e dividem o **mesmo escopo global**:
arquivo novo ali vai dentro de uma IIFE, expondo so `window.<algo>` — nome
top-level solto colide com o dos outros e derruba o app inteiro.

O texto que o Cockpit escreve no `CLAUDE.md` dos workspaces de cliente
(`protocoloChamados()` em `main.js`) e lido pelo agente em **toda sessao nova**:
cada linha custa token la, entao so entra o que muda o comportamento dele.
