"""
Launcher MCP das conexoes RFC (SAProuter) do SAP MCP Cockpit.

O host MCP (Claude Code / Codex) sobe ESTE script como comando do server. Ele:

  1. garante que o adt_rfc_bridge esta no ar em BRIDGE_PORT, subindo-o DESTACADO
     se ainda nao estiver (o bridge so loga no SAP na primeira chamada ADT, entao
     um bridge ocioso nao gasta logon nenhum);
  2. mantem esse bridge vivo com um ping periodico enquanto esta sessao existir
     (ver keepalive) -- o bridge se encerra sozinho depois de BRIDGE_IDLE_MINUTES
     sem sinal de vida, e sem o ping ele sumiria debaixo de uma sessao so quieta;
  3. entrega o controle ao vsp, REPASSANDO os argumentos recebidos -- e por isso
     que este launcher existe em vez do vsp_launch.py original: as flags de
     conexao e de modo montadas pelo Cockpit (--url/--user/--mode/--read-only/...)
     precisam chegar no vsp.

O stdio e herdado pelo vsp, entao os pipes MCP passam direto pra ele.

REGRA DE OURO: nada aqui pode escrever em stdout. Stdout E o canal JSON-RPC do
MCP -- uma linha solta corrompe a sessao inteira. Diagnostico vai pra stderr, e a
saida do bridge vai pra bridge-start.log.

Variaveis de ambiente (o Cockpit preenche todas no bloco `env` do server):
  Bridge : BRIDGE_PORT, BRIDGE_SCRIPT, RFC_ASHOST, RFC_SYSNR, RFC_CLIENT,
           RFC_USER, RFC_PASSWD, RFC_SAPROUTER
  Cliente: ADT_CLIENT (caminho do vsp.exe)
"""
import os
import sys
import socket
import subprocess
import threading
import time
import http.client

HERE = os.path.dirname(os.path.abspath(__file__))
BRIDGE_SCRIPT = os.environ.get("BRIDGE_SCRIPT", os.path.join(HERE, "adt_rfc_bridge.py"))
ADT_CLIENT = os.environ.get("ADT_CLIENT", "vsp")
STARTLOG = os.path.join(HERE, "bridge-start.log")

# Windows: sobe o bridge totalmente destacado, pra ele sobreviver a este launcher
# (o host MCP mata o launcher junto com o vsp ao trocar de sessao).
DETACHED_PROCESS = 0x00000008
CREATE_NEW_PROCESS_GROUP = 0x00000200


def listening(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.4)
        try:
            s.connect(("127.0.0.1", port))
            return True
        except OSError:
            return False


def start_bridge(port):
    """Sobe o bridge destacado e espera ele abrir a porta. True se subiu."""
    try:
        log = open(STARTLOG, "ab", buffering=0)
    except OSError:
        log = subprocess.DEVNULL

    # stdout/stderr do bridge NUNCA podem cair nos pipes do MCP: o print de boot
    # dele viraria lixo no meio do JSON-RPC. Vao pro log.
    kwargs = dict(stdin=subprocess.DEVNULL, stdout=log, stderr=log, close_fds=True)
    if os.name == "nt":
        kwargs["creationflags"] = DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
    else:
        kwargs["start_new_session"] = True

    try:
        subprocess.Popen([sys.executable, BRIDGE_SCRIPT], **kwargs)
    except OSError as e:
        sys.stderr.write("bridge_launch: nao consegui subir %s: %s\n" % (BRIDGE_SCRIPT, e))
        return False

    for _ in range(100):  # ate ~10s
        if listening(port):
            return True
        time.sleep(0.1)
    return False


def keepalive(port):
    """Enquanto ESTE launcher viver, o bridge nao esta ocioso.

    O timeout de ociosidade do bridge serve pra recolher bridge ORFAO -- o de uma
    sessao que ja acabou. Sem este ping ele recolheria tambem o bridge de uma
    sessao viva mas quieta (voce saiu pra almocar): a proxima chamada ADT bateria
    em porta fechada e nao ha quem levante de novo, porque o launcher garante o
    bridge no boot e depois ja entregou o stdio pro cliente.

    O ping tem endpoint proprio, que NAO fala com o SAP: manter o bridge de pe
    nao pode custar um logon -- logon repetido e o que bloqueia usuario no SAP.
    """
    try:
        idle = float(os.environ.get("BRIDGE_IDLE_MINUTES", "30")) * 60.0
    except ValueError:
        idle = 30 * 60.0
    if idle <= 0:
        return                       # timeout desligado: nao ha o que segurar
    # 1/3 do timeout da folga pra um ping se perder sem derrubar o bridge. O teto
    # evita ping inutil num timeout enorme; o piso mantem um timeout curto
    # (usado em teste) funcionando em vez de morrer antes do primeiro ping.
    passo = min(600.0, max(1.0, idle / 3.0))
    while True:
        time.sleep(passo)
        try:
            c = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
            c.request("GET", "/_bridge/ping")
            c.getresponse().read()
            c.close()
        except OSError:
            return                   # bridge morreu: quem sobe outro e o proximo launcher


def main():
    port = int(os.environ.get("BRIDGE_PORT", "8410"))

    if not listening(port) and not start_bridge(port):
        sys.stderr.write(
            "bridge_launch: o ADT-over-RFC bridge nao subiu na porta %d.\n"
            "Veja o motivo em %s (falta pyrfc? falta o SAP NW RFC SDK no PATH?\n"
            "Python x86 no lugar de x64?). Rode o Diagnostico do bridge no\n"
            "SAP MCP Cockpit para checar os pre-requisitos.\n" % (port, STARTLOG)
        )
        return 3

    threading.Thread(target=keepalive, args=(port,), daemon=True).start()

    try:
        return subprocess.call([ADT_CLIENT] + sys.argv[1:])
    except OSError as e:
        sys.stderr.write("bridge_launch: nao consegui executar o ADT_CLIENT %r: %s\n" % (ADT_CLIENT, e))
        return 4


if __name__ == "__main__":
    sys.exit(main())
