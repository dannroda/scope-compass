// Los instaladores (§35, D63): se corren desde el repo con `curl … | sh` / `irm … | iex` y bajan el binario de la
// release más nueva del canal, verificado con SHA256SUMS. install.sh, contra un GitHub falso y un binario falso (un
// script), en Linux; install.ps1 se prueba a mano (toca el PATH del usuario y el menú Inicio).
import './isolate.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const skip = process.platform === 'win32' && 'install.sh es para Linux (install.ps1 se prueba a mano)';

// El binario falso: `hubs` deja el ícono donde lo deja el de verdad al extraerse; `upgrade --channel` anota el canal.
const fakeBinary = (version) => `#!/bin/sh
# scompass falso ${version}
case "$1" in
  hubs) mkdir -p "$SCOMPASS_RUNTIME_DIR/${version}/web" && echo '<svg/>' > "$SCOMPASS_RUNTIME_DIR/${version}/web/favicon.svg" ;;
  upgrade) echo "$3" > "$HOME/canal" ;;
esac
`;

let server, base, releases, files;
before(async () => {
  server = createServer((req, res) => {
    if (req.url.startsWith('/releases')) {
      // Como la API de GitHub: con espacios o sin ellos, y con objetos adentro (author, assets) que no tienen tag_name.
      const pretty = !req.url.includes('compact');
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(releases.map((r) => ({ url: 'x', author: { login: 'dann', id: 1 }, tag_name: `v${r.version}`, name: `v${r.version}`, draft: false, prerelease: r.prerelease, assets: [{ name: 'SHA256SUMS', id: 2 }] })), null, pretty ? 2 : 0));
    }
    const m = /^\/download\/v([^/]+)\/(.+)$/.exec(req.url);
    const body = m && files[`${m[1]}/${m[2]}`];
    if (body === undefined) { res.writeHead(404); return res.end(); }
    res.writeHead(200);
    res.end(body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server?.close());

function publish(list, { corrupt } = {}) {
  releases = list;
  files = {};
  for (const r of list) {
    const name = `scompass-v${r.version}-linux-x64`;
    const bin = fakeBinary(r.version);
    files[`${r.version}/${name}`] = bin;
    const hash = createHash('sha256').update(corrupt ? 'otra cosa' : bin).digest('hex');
    files[`${r.version}/SHA256SUMS`] = `${'0'.repeat(64)}  scope-compass-addon-v${r.version}.zip\n${hash}  ${name}\n`;
  }
}

// `cat install.sh | sh`, como `curl … | sh`, con su HOME y su caché.
async function install({ channel, compact } = {}) {
  const home = await mkdtemp(join(tmpdir(), 'scompass-install-'));
  const env = { PATH: process.env.PATH, HOME: home, XDG_DATA_HOME: join(home, 'share'), SCOMPASS_RUNTIME_DIR: join(home, 'runtime'),
    SCOMPASS_RELEASES_URL: `${base}/releases${compact ? '?compact' : ''}`, SCOMPASS_DOWNLOAD_URL: `${base}/download`, ...(channel && { SCOMPASS_CHANNEL: channel }) };
  const r = await new Promise((resolve) => {
    const p = spawn('sh', ['-c', `cat '${join(REPO, 'tools', 'install.sh')}' | sh`], { env, cwd: home });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => resolve({ code, out }));
  });
  const bin = join(home, '.local', 'bin', 'scompass');
  return { ...r, home, bin, installed: existsSync(bin) ? /scompass falso (\S+)/.exec(readFileSync(bin, 'utf8'))?.[1] : null };
}

test('curl … | sh: baja la release más nueva del canal stable, la verifica y deja el lanzador', { skip }, async () => {
  publish([{ version: '0.1.5', prerelease: false }, { version: '0.2.0', prerelease: true }, { version: '0.1.10', prerelease: false }]);
  for (const compact of [false, true]) {
    const r = await install({ compact });
    try {
      assert.equal(r.code, 0, r.out);
      assert.equal(r.installed, '0.1.10', 'la más nueva por versión, no por orden ni la pre-release');
      assert.match(readFileSync(join(r.home, 'share', 'applications', 'scope-compass.desktop'), 'utf8'), /^Exec=\S*\/\.local\/bin\/scompass home --tray --open$/m);
      assert.ok(existsSync(join(r.home, 'share', 'icons', 'hicolor', 'scalable', 'apps', 'scope-compass.svg')));
      assert.ok(!existsSync(join(r.home, 'canal')), 'stable no toca el canal');
      assert.match(r.out, /no hace falta de nuevo/);
    } finally {
      await rm(r.home, { recursive: true, force: true });
    }
  }
});

test('SCOMPASS_CHANNEL=beta: también las pre-releases, y el binario queda en el canal beta', { skip }, async () => {
  publish([{ version: '0.1.5', prerelease: false }, { version: '0.2.0', prerelease: true }]);
  const r = await install({ channel: 'beta' });
  try {
    assert.equal(r.code, 0, r.out);
    assert.equal(r.installed, '0.2.0');
    assert.equal(readFileSync(join(r.home, 'canal'), 'utf8').trim(), 'beta');
  } finally {
    await rm(r.home, { recursive: true, force: true });
  }
});

test('sin releases estables lo dice y da el comando con beta; un binario que no coincide con SHA256SUMS no se instala', { skip }, async () => {
  publish([{ version: '0.2.0', prerelease: true }]);
  let r = await install();
  try {
    assert.equal(r.code, 1);
    assert.match(r.out, /todavía no hay releases estables[\s\S]*SCOMPASS_CHANNEL=beta sh/);
    assert.equal(r.installed, null);
  } finally {
    await rm(r.home, { recursive: true, force: true });
  }
  publish([{ version: '0.1.5', prerelease: false }], { corrupt: true });
  r = await install();
  try {
    assert.equal(r.code, 1);
    assert.match(r.out, /no coincide con SHA256SUMS/);
    assert.equal(r.installed, null);
  } finally {
    await rm(r.home, { recursive: true, force: true });
  }
  const bad = await install({ channel: 'nightly' });
  assert.equal(bad.code, 1);
  assert.match(bad.out, /canal inválido/);
  await rm(bad.home, { recursive: true, force: true });
});
