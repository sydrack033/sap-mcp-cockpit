# Contexto do cliente: {{CLIENTE}} — PREENCHA ESTE ARQUIVO

Regras especificas do cliente **{{CLIENTE}}** que valem pra qualquer demanda dele
(chamado, desenvolvimento, projeto). O agente le isto antes de mexer em qualquer
objeto num ambiente deste cliente. O SAP MCP Cockpit **nunca sobrescreve** este
arquivo — ele e seu.

## Ambientes deste cliente (profiles MCP)

{{AMBIENTES}}

(Marque qual e producao — NUNCA editar la — e em qual se desenvolve.)

## Cliente / empresa

- Modulos SAP em uso (FI, MM, SD, ...):
- Contato/aprovador tecnico:

## Nomenclatura de objetos

- Namespace: `Z` (ou namespace proprio `/XXX/`)
- Padrao de nomes (exemplos reais ajudam):
  - Reports: `Z<MODULO>_<DESCRICAO>` (ex.: `ZFI_RELATORIO_SALDOS`)
  - Classes: `ZCL_...`
  - Tabelas: `Z...`
- Pacote (dev class) padrao para novos objetos:

## Transporte e paisagem

- Fluxo: DEV -> QAS -> PRD (ajuste se diferente)
- Como obter uma transport request: (ex.: "pedir ao lider", "criar em SE09 com
  descricao no padrao `<chamado> - <descricao>`")

## Regras de trabalho

- O que precisa de aprovacao antes de comecar:
- Evidencias exigidas ao entregar (prints, resultado de teste, spec tecnica):
- Onde registrar horas / atualizar o chamado:

## Particularidades tecnicas

(Ex.: "ECC 6.0 sem HANA — nao usar sintaxe 7.5+", "user-exits concentradas na
ZXXXU01", "nao criar tabela Z sem aprovacao do arquiteto")

-
