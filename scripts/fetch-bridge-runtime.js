'use strict';

// ---------------------------------------------------------------------------
// Baixa o runtime do bridge RFC (Python embutivel + pyrfc) para vendor/.
//
// Roda no BUILD, nao na maquina do usuario: o electron-builder empacota o
// resultado em resources/bridge-runtime. Por isso os 20 MB nao entram no git.
//
// O QUE PODE E O QUE NAO PODE IR JUNTO:
//   - Python embeddable  -> PSF License, redistribuicao permitida.  VAI.
//   - pyrfc (wheel)      -> Apache 2.0, redistribuicao permitida.   VAI.
//   - SAP NW RFC SDK     -> licenca SAP, NAO redistribuivel.        FICA DE FORA.
// O SDK (sapnwrfc.dll) tem que ja estar na maquina do usuario. Na pratica ele
// esta: o SAPSetup deixa a DLL x64 na System32 de quem instalou o SAP GUI, e o
// pyrfc a encontra sem configuracao nenhuma. Quem tiver o SDK numa pasta propria
// aponta ela nas Configuracoes (vira SAPNWRFC_HOME).
//
// Uso:  node scripts/fetch-bridge-runtime.js [--force]
// ---------------------------------------------------------------------------

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

// Python 3.12 e o teto: o pyrfc NAO publica wheel win_amd64 para 3.13/3.14
// (as tags param em cp312). Subir a versao aqui sem checar o PyPI quebra o build.
const PYTHON_VERSION = '3.12.10';
const PYRFC_VERSION = '3.3.1';

const ALVOS = [
  {
    nome: 'python-embed',
    url: `https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-embed-amd64.zip`,
    sha256: '4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3',
    bytes: 11133606
  },
  {
    nome: 'pyrfc-wheel',
    url: 'https://files.pythonhosted.org/packages/1f/05/39579c91304efd793ea346e204d7d059e7ecdf828fdc7944714798df3abe/'
       + `pyrfc-${PYRFC_VERSION}-cp312-cp312-win_amd64.whl`,
    sha256: '9bc668c47b998a8a79d89d5dbd3eaf108b87a1e4b81ba23057aba3931e50918c',
    bytes: 838249
  }
];

// Peso morto para o bridge: simbolos de debug e modulos que ele nunca importa.
// Testado - com isto fora, `import pyrfc` e o adt_rfc_bridge.py continuam OK.
// NAO tire libcrypto-3.dll: o http.server puxa hashlib por caminhos indiretos.
const DESCARTAR = [
  'pyrfc/_cyrfc.cp312-win_amd64.pdb',
  'sqlite3.dll', '_sqlite3.pyd', '_msi.pyd', '_wmi.pyd',
  'python.cat', 'pythonw.exe'
];

const RAIZ = path.resolve(__dirname, '..');
const DESTINO = path.join(RAIZ, 'vendor', 'bridge-runtime');
const MARCADOR = path.join(DESTINO, '.runtime-version');
const ASSINATURA = `python ${PYTHON_VERSION} + pyrfc ${PYRFC_VERSION}`;

function log(msg) { process.stdout.write(msg + '\n'); }

// https.get sem seguir redirect nao serve: o pythonhosted redireciona.
function baixar(url, destino, saltos = 0) {
  return new Promise((resolve, reject) => {
    if (saltos > 5) return reject(new Error('redirects demais: ' + url));
    https.get(url, { headers: { 'User-Agent': 'sap-mcp-cockpit-build' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(baixar(new URL(res.headers.location, url).toString(), destino, saltos + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} em ${url}`));
      }
      const out = fs.createWriteStream(destino);
      res.pipe(out);
      out.on('finish', () => out.close(resolve));
      out.on('error', reject);
    }).on('error', reject);
  });
}

function sha256(arquivo) {
  return crypto.createHash('sha256').update(fs.readFileSync(arquivo)).digest('hex');
}

// Node nao tem unzip embutido; o Expand-Archive do PowerShell resolve e ja esta
// na maquina de build (Windows). O -Force sobrescreve extracoes anteriores.
function descompactar(zip, destino) {
  const r = spawnSync('powershell', [
    '-NoProfile', '-NonInteractive', '-Command',
    `Expand-Archive -LiteralPath "${zip}" -DestinationPath "${destino}" -Force`
  ], { encoding: 'utf8', timeout: 180000 });
  if (r.status !== 0) {
    throw new Error('Expand-Archive falhou: ' + String(r.stderr || r.stdout || r.error));
  }
}

function tamanhoDe(dir) {
  let total = 0;
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, item.name);
    total += item.isDirectory() ? tamanhoDe(p) : fs.statSync(p).size;
  }
  return total;
}

async function main() {
  const forcar = process.argv.includes('--force');

  if (!forcar && fs.existsSync(MARCADOR) && fs.readFileSync(MARCADOR, 'utf8').trim() === ASSINATURA) {
    log(`runtime do bridge ja presente (${ASSINATURA}) - use --force para refazer`);
    return;
  }

  if (process.platform !== 'win32') {
    log('AVISO: este runtime e win_amd64. Baixando assim mesmo, mas so serve no build Windows.');
  }

  fs.rmSync(DESTINO, { recursive: true, force: true });
  fs.mkdirSync(DESTINO, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-runtime-'));

  try {
    for (const alvo of ALVOS) {
      const arquivo = path.join(tmp, alvo.nome + '.zip');
      log(`baixando ${alvo.nome}...`);
      await baixar(alvo.url, arquivo);

      const visto = sha256(arquivo);
      if (visto !== alvo.sha256) {
        throw new Error(
          `sha256 nao confere em ${alvo.nome}\n  esperado: ${alvo.sha256}\n  obtido:   ${visto}\n` +
          '  Se a origem publicou um arquivo novo de proposito, confira e atualize o pin neste script.'
        );
      }
      log(`  ok  ${(fs.statSync(arquivo).size / 1024 / 1024).toFixed(1)} MB  sha256 confere`);
      // os dois vao para a MESMA pasta: o ._pth do embeddable poe a raiz no
      // sys.path, entao o pyrfc extraido ali e importavel sem PYTHONPATH
      descompactar(arquivo, DESTINO);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // O pyrfc/__init__.py chama importlib.metadata.version('pyrfc'): sem a pasta
  // .dist-info o import morre com PackageNotFoundError. Ela TEM que ficar.
  const temDistInfo = fs.readdirSync(DESTINO).some(n => /^pyrfc-.*\.dist-info$/.test(n));
  if (!temDistInfo) throw new Error('pyrfc-*.dist-info nao veio junto - o import do pyrfc vai falhar');

  for (const rel of DESCARTAR) {
    fs.rmSync(path.join(DESTINO, rel), { force: true });
  }
  fs.writeFileSync(MARCADOR, ASSINATURA + '\n', 'utf8');

  // Prova que o conjunto funciona antes de deixar o build seguir. Nao valida o
  // SDK de proposito: a maquina de build nao precisa ter o SAP GUI instalado.
  const python = path.join(DESTINO, 'python.exe');
  const r = spawnSync(python, ['-c', 'import sys;print(sys.version.split()[0])'], { encoding: 'utf8', timeout: 60000 });
  if (r.status !== 0) throw new Error('o Python embutido nao roda: ' + String(r.stderr || r.error));

  log('');
  log(`runtime pronto em vendor/bridge-runtime  (${(tamanhoDe(DESTINO) / 1024 / 1024).toFixed(1)} MB)`);
  log(`  Python ${r.stdout.trim()} + pyrfc ${PYRFC_VERSION}`);
  log('  o SAP NW RFC SDK NAO vai junto (nao e redistribuivel) - fica por conta da maquina do usuario');
}

main().catch((e) => {
  process.stderr.write('\nfalhou: ' + (e && e.message ? e.message : e) + '\n');
  process.exit(1);
});
