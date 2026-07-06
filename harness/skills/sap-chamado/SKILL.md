---
name: sap-chamado
description: Analisar e resolver chamado/incidente de suporte SAP (erro em transacao, job cancelado, dump, divergencia de dados, duvida de usuario). Use quando o usuario trouxer um chamado, ticket ou problema reportado em producao/QAS.
---

# Chamado de suporte SAP

Objetivo: sair com **diagnostico com evidencia** e uma **proposta de correcao**
— nao sair alterando objeto. Correcao so entra depois que o usuario aprovar, e
sempre via DEV + transport (nunca direto em producao).

Leia antes: `.claude/contextos/<cliente>.md` do cliente do chamado (regras dele:
nomenclatura, transporte, aprovacoes) e a tabela de ambientes no `CLAUDE.md`
(qual profile e producao, qual e DEV).

## Fase 1 — Entender o chamado

Extraia do relato (pergunte o que faltar, tudo de uma vez):
- Numero/ID do chamado e descricao do usuario
- Sistema/ambiente onde ocorre (mapear para um profile MCP da tabela)
- Transacao / programa / job / interface envolvida
- Quando comecou, se e intermitente, se afeta todos os usuarios
- Mensagem de erro exata (numero da mensagem, texto, dump)

## Fase 2 — Investigar (so leitura)

Use as tools MCP do profile do ambiente onde o problema ocorre (producao =
**apenas leitura**). Para investigacao pesada, delegue ao subagente
`sap-investigador` para nao poluir o contexto.

- Localize o objeto: busca ADT (`SearchObject`) pelo programa/classe/funcao.
- Leia o fonte relevante e siga a cadeia (includes, user-exits, BAdIs).
- Compare DEV x PRD se suspeitar de versao diferente (transport nao subiu?).
- Procure notas no fonte: quem mexeu por ultimo, comentarios de chamados antigos.

## Fase 3 — Diagnostico

Feche um diagnostico **com evidencia** (trecho de codigo, config, dado). Se
houver mais de uma hipotese, liste-as com o que confirmaria/descartaria cada uma.

## Fase 4 — Proposta e resposta do chamado

Entregue ao usuario:

1. **Causa raiz** (ou hipoteses ranqueadas) com evidencia.
2. **Correcao proposta**: objeto(s) a alterar, o diff conceitual, riscos,
   workaround temporario se existir.
3. **Texto pronto pra responder o chamado** (linguagem pro usuario final,
   sem jargao interno), no formato exigido pelo cliente.

So implemente a correcao se o usuario mandar — ai vale o fluxo da skill
`sap-desenvolvimento` (DEV, transport, edicao segura do CLAUDE.md).

## Ajustes deste cliente

(Adicione aqui particularidades: SLA, formato de resposta, evidencias exigidas)

-
