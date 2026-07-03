# Harness SAP — .claude/

Esta pasta e o **harness** do workspace: fluxos de trabalho prontos (chamado de
suporte, desenvolvimento, projeto) que o Claude Code carrega automaticamente,
mais um arquivo de contexto do cliente que VOCE deve preencher.

Gerada pelo SAP MCP Cockpit a partir dos templates dele, mas **100% sua**:

- O Cockpit **nunca sobrescreve** arquivos que ja existem aqui. Edite a vontade.
- Apagou um arquivo? O proximo **Gerar configs** restaura o padrao.
- Quer um fluxo novo (ex.: `/auditoria`)? Crie `commands/auditoria.md` e, se o
  fluxo for grande, um `skills/sap-auditoria/SKILL.md` — vira comando na hora.

## O que tem aqui

| Pasta / arquivo | O que e |
|---|---|
| `contextos/<cliente>.md` | Regras de CADA cliente (nomenclatura, transporte, aprovacoes) — um arquivo por cliente cadastrado no Cockpit, criado sozinho. **Preencha!** |
| `commands/` | Slash commands: `/chamado`, `/desenvolvimento`, `/projeto` |
| `skills/` | Playbooks detalhados de cada fluxo (carregados sob demanda) |
| `agents/` | Subagentes: `sap-investigador` (so leitura) e `sap-desenvolvedor` |

## Como customizar

- **Por cliente:** `contextos/<cliente>.md` — cadastrou cliente novo no Cockpit,
  o arquivo dele nasce no proximo "Gerar configs"; e so preencher.
- **Pra todos os clientes (seu jeito de trabalhar):** edite as skills/commands —
  cada skill tem uma secao **"Ajustes deste cliente"** no final pra
  particularidades de fluxo (ex.: "chamado so fecha com evidencia de teste em
  QAS", "todo report novo precisa de tela de selecao com variante").
- **Por demanda:** o chamado/spec entra como argumento do comando; projetos
  guardam estado em `projetos/<nome>/` (PLANO/PROGRESSO/DECISOES).

## Codex

O Codex nao le esta pasta sozinho. O `AGENTS.md` do workspace instrui ele a ler
os arquivos daqui quando precisar — funciona, so nao e automatico como no Claude.
