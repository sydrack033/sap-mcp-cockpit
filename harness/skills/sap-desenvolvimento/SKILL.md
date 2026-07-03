---
name: sap-desenvolvimento
description: Executar solicitacao de desenvolvimento ABAP (report, funcao, classe, enhancement, correcao aprovada) num ambiente SAP via MCP. Use quando o usuario pedir para criar ou alterar objeto ABAP a partir de uma especificacao ou chamado aprovado.
---

# Solicitacao de desenvolvimento SAP

Objetivo: transformar uma especificacao em objeto(s) ABAP **ativo(s), testado(s)
e amarrado(s) numa transport request**, seguindo a nomenclatura do cliente.

Leia antes: `.claude/contextos/<cliente>.md` do cliente da solicitacao
(nomenclatura, pacote, transporte) e o
`CLAUDE.md` — em especial a secao **"Criar/editar objeto ABAP — SIGA EXATAMENTE"**
(fluxo LockObject -> UpdateSource -> Activate -> UnlockObject). Nao improvise
fora dele.

## Fase 1 — Especificacao

Antes de escrever codigo, confirme (pergunte tudo de uma vez o que faltar):
- O que o desenvolvimento faz (entrada, processamento, saida)
- Nome do objeto conforme nomenclatura do cliente + pacote (dev class)
- **Transport request** a usar (ou como obter uma — ver contexto-cliente)
- Ambiente de desenvolvimento (profile MCP) — precisa estar em **mode=expert**
  para criar/editar; se as tools `LockObject`/`UpdateSource` nao aparecerem,
  peca ao usuario pra trocar no Cockpit e reiniciar a sessao.

Se a spec for grande, escreva um mini plano tecnico (objetos, ordem, riscos) e
valide com o usuario antes de comecar.

## Fase 2 — Implementar

- Investigacao previa (padroes existentes, includes, tabelas): delegue ao
  subagente `sap-investigador` quando for volumosa.
- Escreva o fonte completo localmente primeiro; so depois grave no SAP.
- Grave seguindo **exatamente** o fluxo de edicao segura do CLAUDE.md
  (objeto novo: skeleton -> LockObject -> UpdateSource com fonte completo ->
  Activate -> UnlockObject; objeto existente: EditSource cirurgico).
- Um objeto por vez: criar, ativar, conferir, so entao o proximo.

## Fase 3 — Verificar

- Syntax check + Activate sem erros.
- Releia o fonte gravado no SAP e confirme que e o que voce mandou.
- Se executavel e o ambiente permitir, rode um teste minimo e capture o resultado.

## Fase 4 — Entregar

Reporte ao usuario:
- Objetos criados/alterados (nome, tipo, pacote) e a **transport request**
- O que foi testado e o resultado
- Spec tecnica curta (o que faz, pontos de atencao) no formato do cliente
- Pendencias (ex.: "falta teste integrado em QAS apos subir a request")

## Ajustes deste cliente

(Ex.: template de cabecalho de programa, exigencia de spec tecnica formal,
code review obrigatorio)

-
