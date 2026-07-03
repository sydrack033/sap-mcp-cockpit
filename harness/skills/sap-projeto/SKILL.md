---
name: sap-projeto
description: Conduzir projeto SAP com multiplas entregas ao longo de varias sessoes (implementacao, rollout, migracao, melhoria grande). Use quando o trabalho nao cabe numa sessao so e precisa de plano e memoria de progresso.
---

# Projeto SAP (multi-sessao)

Objetivo: trabalho grande dividido em fases, com **memoria persistente em
arquivos** — qualquer sessao futura (sua ou de outro agente) consegue retomar
de onde parou sem redescobrir nada.

Leia antes: `.claude/contextos/<cliente>.md` do cliente do projeto.

## Estrutura de pastas

Cada projeto vive em `projetos/<slug-do-projeto>/` no workspace:

- `PLANO.md` — escopo, fases, entregas, criterios de aceite
- `PROGRESSO.md` — diario: o que foi feito (com evidencia), o que falta,
  proximo passo concreto
- `DECISOES.md` — decisoes tecnicas com o porque (evita re-litigar)

## Ao INICIAR uma sessao de projeto

1. Leia `PROGRESSO.md` e `PLANO.md` do projeto. Se nao existem, e projeto novo:
   monte o `PLANO.md` com o usuario antes de qualquer implementacao.
2. Confirme o proximo passo registrado; nao re-investigue o que ja esta
   documentado como resolvido.

## Durante

- Fases sequenciais: **pesquisar -> planejar -> implementar -> revisar ->
  verificar**. Cada entrega individual segue a skill `sap-desenvolvimento`
  (transport, edicao segura); investigacao pesada vai pro subagente
  `sap-investigador`.
- Registrou-se uma decisao? Anote em `DECISOES.md` na hora, com o motivo.
- Aprendeu algo nao-obvio do ambiente (bug, limitacao, jeito certo)? Anote em
  `PROGRESSO.md` — proxima sessao nao pode pagar esse custo de novo.

## Ao ENCERRAR a sessao (obrigatorio)

Atualize `PROGRESSO.md`:
- O que foi concluido HOJE, com evidencia (objeto ativado, teste ok, transport)
- O que ficou pendente e **qual o proximo passo concreto**
- Bloqueios (ex.: "aguardando request do lider", "cookie SSO expirou")

## Ajustes deste cliente

(Ex.: reportar progresso semanal em formato X, gate de aprovacao entre fases)

-
