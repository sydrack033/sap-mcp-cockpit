# Terceiros embarcados neste diretorio

## adt_rfc_bridge.py

Copia sem modificacoes do projeto **ADT-over-RFC bridge**, de Enrico Andreoli.

- Origem: https://github.com/enricoandreoli/adt-rfc-bridge
- Licenca: MIT

O SAP MCP Cockpit apenas redistribui o arquivo e o executa localmente; nao ha
alteracao no codigo. Para atualizar, baixe a versao nova do repositorio acima e
substitua o arquivo aqui.

```
MIT License

Copyright (c) 2026 Enrico Andreoli

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

**Nao e redistribuivel** e por isso **nao** esta aqui: o *SAP NW RFC SDK*
(`sapnwrfc.dll` e cia), que o `pyrfc` carrega. Ele vem junto com o SAP GUI ou
e baixado do SAP Support Portal com usuario S. O Cockpit apenas DETECTA o SDK.

## bridge_launch.py

Escrito para o SAP MCP Cockpit (nao vem do repositorio acima). Faz o mesmo papel
do `vsp_launch.py` original, com uma diferenca necessaria: **repassa os
argumentos** recebidos para o `vsp`, para as flags de conexao/modo montadas pelo
Cockpit continuarem valendo.
