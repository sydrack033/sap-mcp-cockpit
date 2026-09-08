'use strict';

// ---------------------------------------------------------------------------
// Patch notes: uma secao por release, da mais nova para a mais antiga.
//
// REGRA DO PROJETO: todo release novo entra AQUI, no topo, junto com o bump do
// package.json. Sem entrada aqui, o release nao existe pro usuario -- ele ve a
// versao mudar na barra de status e nao tem como saber o que mudou.
//
// Fica no renderer/ porque so `renderer/**` vai pro pacote (package.json,
// build.files): um .md na raiz do repo nao chegaria ao app instalado.
//
// IIFE: os <script> classicos do renderer dividem o MESMO escopo global, entao
// nome top-level daqui colidiria com o de i18n.js/app.js. So window.PATCH_NOTES vaza.
//
// Formato de cada release:
//   v     versao, igual a do package.json
//   date  ISO (aaaa-mm-dd); a UI formata por idioma
//   items { t: 'feat' | 'fix', pt, en } — o texto diz o que MUDOU PRO USUARIO,
//         nao o que mudou no codigo. Sem jargao de commit.
// ---------------------------------------------------------------------------
(function () {

window.PATCH_NOTES = [
  {
    v: '2.5.1', date: '2026-09-08',
    items: [
      { t: 'fix',
        pt: 'O modo hyperfocused voltou a lista das conexoes vsp. O binario sempre aceitou os tres modos, mas quando o seletor de engine chegou a opcao sumiu da tela — e conexao que ja estava em hyperfocused caia pra focused sem avisar, na primeira vez que era salva.',
        en: 'The hyperfocused mode is back in the list for vsp connections. The binary always accepted all three modes, but the option vanished from the screen when the engine selector arrived — and a connection already set to hyperfocused silently fell back to focused the first time it was saved.' }
    ]
  },
  {
    v: '2.5.0', date: '2026-09-06',
    items: [
      { t: 'feat',
        pt: 'Esta aba. Cada release passa a ter sua secao aqui, com o que mudou de fato pra quem usa.',
        en: 'This tab. Every release now gets its own section here, in plain language.' },
      { t: 'feat',
        pt: 'Workbook, spec e manual em .docx / .pdf / .pptx / .xlsx viram .md na PRIMEIRA leitura — em docs/ quando valem pro cliente inteiro, em chamados/<ID>/ quando sao de uma frente so. As sessoes seguintes leem o markdown e nao pagam a extracao de novo. (Protocolo de trabalho ligado.)',
        en: 'Workbooks, specs and manuals in .docx / .pdf / .pptx / .xlsx are converted to .md on FIRST read — into docs/ when they apply to the whole client, into chamados/<ID>/ when they belong to a single ticket. Later sessions read the markdown and never pay for the extraction again. (Requires the work protocol.)' }
    ]
  },
  {
    v: '2.4.2', date: '2026-09-05',
    items: [
      { t: 'fix',
        pt: 'Ligar ou desligar o protocolo de trabalho agora avisa que a sessao precisa ser reiniciada: o CLAUDE.md so e lido no inicio do chat.',
        en: 'Turning the work protocol on or off now warns that the session must be restarted: CLAUDE.md is only read when the chat starts.' }
    ]
  },
  {
    v: '2.4.1', date: '2026-09-05',
    items: [
      { t: 'feat',
        pt: 'O protocolo de trabalho virou opcional e vem DESLIGADO. Quem nao trabalha por chamado nao recebe mais docs/ nem chamados/ no workspace.',
        en: 'The work protocol is now optional and ships OFF. If you do not work ticket by ticket, your workspace no longer gets docs/ or chamados/.' },
      { t: 'feat',
        pt: 'O agente renomeia a conversa com o cliente na frente — [Cliente] CHAVE — resumo — porque a barra lateral do chat agrupa por repositorio git, e clientes que dividem um repo caiam todos no mesmo grupo.',
        en: 'The agent renames the chat with the client up front — [Client] KEY — summary — because the chat sidebar groups by git repository, so clients sharing a repo all landed in the same group.' }
    ]
  },
  {
    v: '2.4.0', date: '2026-09-05',
    items: [
      { t: 'feat',
        pt: 'Protocolo de trabalho no workspace: docs/ guarda o que vale pro cliente inteiro e chamados/<chave>/HANDOFF.md guarda o estado de cada frente. Semeados uma vez, nunca sobrescritos — a conversa nova retoma de onde a anterior parou.',
        en: 'Work protocol in the workspace: docs/ holds what applies to the whole client, chamados/<key>/HANDOFF.md holds the state of each ticket. Seeded once, never overwritten — a new chat picks up where the last one stopped.' },
      { t: 'feat',
        pt: 'Camada de engine: cada conexao escolhe entre vsp e ARC-1, com instalacao gerenciada do ARC-1 (start do server cai de 6-18 s para ~2-3 s).',
        en: 'Engine layer: each connection picks between vsp and ARC-1, with a managed ARC-1 install (server start drops from 6-18 s to ~2-3 s).' },
      { t: 'feat',
        pt: 'Exportar e importar conexoes sem senha nem caminho absoluto, pra levar o setup pra outra maquina com seguranca.',
        en: 'Export and import connections without passwords or absolute paths, so the setup travels safely to another machine.' },
      { t: 'fix',
        pt: 'O Cockpit regera os arquivos de apoio de todo workspace ao abrir: estrutura nova chega sem voce ter que mexer em cada cliente.',
        en: 'The Cockpit regenerates every workspace support file on startup, so a new structure reaches you without touching each client by hand.' }
    ]
  },
  {
    v: '2.3.1', date: '2026-08-27',
    items: [
      { t: 'fix',
        pt: 'O diagnostico do bridge culpava o pyrfc quando o que falta de verdade e o SAP NW RFC SDK.',
        en: 'Bridge diagnostics blamed pyrfc when the missing piece was really the SAP NW RFC SDK.' }
    ]
  },
  {
    v: '2.3.0', date: '2026-08-27',
    items: [
      { t: 'feat',
        pt: 'Conexao SAProuter (RFC): ADT por cima de RFC, com Python e pyrfc embarcados no app — nada a instalar alem do SDK da SAP.',
        en: 'SAProuter (RFC) connection: ADT over RFC, with Python and pyrfc bundled in the app — nothing to install beyond the SAP SDK.' }
    ]
  },
  {
    v: '2.2.2', date: '2026-08-17',
    items: [
      { t: 'feat',
        pt: 'Botao pra ver a senha ao editar uma conexao Private.',
        en: 'Button to reveal the password when editing a Private connection.' }
    ]
  },
  {
    v: '2.2.1', date: '2026-08-16',
    items: [
      { t: 'fix',
        pt: 'O login SSO passa a pedir a pasta do cliente, e o aviso deixa de sair verde quando o login nao deu certo.',
        en: 'SSO login now asks for the client folder, and the notice stops showing green when the login did not work.' }
    ]
  },
  {
    v: '2.2.0', date: '2026-08-15',
    items: [
      { t: 'feat',
        pt: 'MCP so em escopo global (~/.claude.json). O modo local nunca podia funcionar: server de projeto fica preso em pending approval e nao conecta.',
        en: 'MCP only in global scope (~/.claude.json). Local mode could never work: a project-scoped server stays stuck in pending approval and never connects.' },
      { t: 'feat',
        pt: 'Validade do cookie SSO na tela, com limpeza do que ja venceu.',
        en: 'SSO cookie expiry shown in the UI, with cleanup of whatever already expired.' }
    ]
  }
];

})();
