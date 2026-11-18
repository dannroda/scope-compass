// Actualizar el binario (§39, D62): elegir la release, verificar con SHA256SUMS y reemplazar el ejecutable; la CLI
// (`scompass upgrade`) y el Inicio (GET y POST /api/upgrade). GitHub es un servidor local con el formato de su API.
import './isolate.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/cli.js';
import { createHomeServer } from '../src/home.js';
import { loadValidators } from '../src/schema.js';
import { assetName, checkUpgrade, compareVersions, installUpgrade, pickRelease, setUpdateChannel, sumFor, updateChannel } from '../src/upgrade.js';

const V = loadValidators();
const NAME = assetName('9.0.0');
const BODY = Buffer.from('#!/bin/sh\necho scompass 9.0.0\n');
const SHA = createHash('sha256').update(BODY).digest('hex');
let server, base, dir, hits = 0, sums = `${SHA}  ${NAME}\n`;

const release = (tag, { prerelease = false, draft = false, files = [] } = {}) => ({
  tag_name: tag, prerelease, draft, body: `notas de ${tag}`, html_url: `${base}/releases/${tag}`,
  assets: files.map((name) => ({ name, browser_download_url: `${base}/download/${tag}/${name}` }))
});
const LIST = () => [
  release('v9.1.0', { draft: true, files: [assetName('9.1.0'), 'SHA256SUMS'] }),
  release('v9.0.1-rc.1', { prerelease: true, files: [assetName('9.0.1-rc.1'), 'SHA256SUMS'] }),
  release('v9.0.0', { files: [NAME, 'SHA256SUMS'] }),
  release('v8.0.0', { files: [assetName('8.0.0'), 'SHA256SUMS'] })
];

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'scompass-upgrade-'));
  server = createServer((req, res) => {
    if (req.url === '/releases') { hits++; res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(LIST())); }
    if (req.url.endsWith('/SHA256SUMS')) return res.end(sums);
    if (req.url.endsWith('/' + NAME)) return res.end(BODY);
    res.statusCode = 404;
    res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.close();
  await rm(dir, { recursive: true, force: true, maxRetries: 10 });
});
const env = () => ({ ...process.env, SCOMPASS_RELEASES_URL: `${base}/releases` });

test('compareVersions: números, la v delante y una pre-release antes que la misma sin ella', () => {
  assert.equal(compareVersions('0.2.0', '0.1.9'), 1);
  assert.equal(compareVersions('v1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('1.0.0-rc.1', '1.0.0'), -1);
  assert.equal(compareVersions('1.0.0-rc.2', '1.0.0-rc.1'), 1);
  assert.equal(compareVersions('0.10.0', '0.9.0'), 1);
});

test('assetName arma el nombre de tools/build.mjs', () => {
  assert.equal(assetName('0.1.0', { platform: 'win32', arch: 'x64' }), 'scompass-v0.1.0-windows-x64.exe');
  assert.equal(assetName('0.1.0', { platform: 'linux', arch: 'arm64' }), 'scompass-v0.1.0-linux-arm64');
  assert.equal(assetName('0.1.0', { platform: 'darwin', arch: 'arm64' }), 'scompass-v0.1.0-macos-arm64');
});

test('pickRelease: sin borradores; pre-releases solo con pre (el canal beta)', () => {
  assert.equal(pickRelease(LIST()).version, '9.0.0');
  assert.equal(pickRelease(LIST(), { pre: true }).version, '9.0.1-rc.1');
  // Correr una pre-release no cambia de canal (D62): 0.1.0 salió como pre-release y no por eso es beta.
  const onPre = [...LIST(), release('v8.5.0', { prerelease: true, files: [assetName('8.5.0')] })];
  assert.equal(pickRelease(onPre).version, '9.0.0');
  // En beta, una release estable más nueva que la pre-release también llega.
  const stableNewer = [release('v9.2.0', { files: [assetName('9.2.0')] }), ...LIST()];
  assert.equal(pickRelease(stableNewer, { pre: true }).version, '9.2.0');
  const other = pickRelease(LIST(), { platform: 'freebsd', arch: 'mips' });
  assert.equal(other, null, 'sin binario para la plataforma, nada');
  const r = pickRelease(LIST());
  assert.match(r.sums_url, /\/v9\.0\.0\/SHA256SUMS$/);
  assert.equal(r.notes, 'notas de v9.0.0');
});

test('sumFor lee SHA256SUMS (con o sin el * de modo binario)', () => {
  const text = `${'a'.repeat(64)}  otro\n${'B'.repeat(64)} *scompass-v1-linux-x64\n`;
  assert.equal(sumFor(text, 'scompass-v1-linux-x64'), 'b'.repeat(64));
  assert.equal(sumFor(text, 'no-esta'), null);
});

test('checkUpgrade guarda la consulta un día; force la repite', async () => {
  hits = 0;
  const a = await checkUpgrade({ current: '8.0.0', env: env() });
  assert.equal(a.available, true);
  assert.equal(a.latest, '9.0.0');
  const b = await checkUpgrade({ current: '9.0.0', env: env() });
  assert.equal(b.available, false, 'la misma versión: al día');
  assert.equal(hits, 1, 'la segunda vez, de la caché');
  await checkUpgrade({ current: '8.0.0', env: env(), force: true });
  assert.equal(hits, 2);
  const tomorrow = await checkUpgrade({ current: '8.0.0', env: env(), now: () => Date.now() + 25 * 3600 * 1000 });
  assert.equal(hits, 3, 'pasado un día se vuelve a pedir');
  assert.equal(tomorrow.latest, '9.0.0');
});

test('installUpgrade reemplaza el ejecutable si coincide con SHA256SUMS; si no, no toca nada', async () => {
  const { release: rel } = await checkUpgrade({ current: '8.0.0', env: env() });
  const target = join(dir, 'install', 'scompass');
  await rm(join(dir, 'install'), { recursive: true, force: true });
  await mkdir(join(dir, 'install'));
  await writeFile(target, 'viejo');
  await assert.rejects(installUpgrade(rel, { target, binary: false }), { code: 'not_binary' });

  sums = `${'0'.repeat(64)}  ${NAME}\n`;
  await assert.rejects(installUpgrade(rel, { target, binary: true }), { code: 'invalid_file' });
  assert.equal(readFileSync(target, 'utf8'), 'viejo');
  assert.deepEqual(await readdir(join(dir, 'install')), ['scompass'], 'sin .new a medias');
  sums = `${SHA}  ${NAME}\n`;

  const r = await installUpgrade(rel, { target, binary: true, platform: 'linux' });
  assert.deepEqual(r, { version: '9.0.0', path: target });
  assert.deepEqual(readFileSync(target), BODY);

  // Windows: el que corre se aparta como .old (y el .old de antes se borra).
  await writeFile(target, 'viejo');
  await writeFile(target + '.old', 'más viejo');
  await installUpgrade(rel, { target, binary: true, platform: 'win32' });
  assert.deepEqual(readFileSync(target), BODY);
  assert.equal(readFileSync(target + '.old', 'utf8'), 'viejo');
});

test('el canal se guarda en settings.json: stable por defecto, beta cuenta las pre-releases', async () => {
  assert.equal(updateChannel(), 'stable');
  assert.equal((await checkUpgrade({ current: '8.0.0', env: env() })).latest, '9.0.0');
  await setUpdateChannel('beta');
  assert.equal(updateChannel(), 'beta');
  const beta = await checkUpgrade({ current: '8.0.0', env: env() });
  assert.equal(beta.channel, 'beta');
  assert.equal(beta.latest, '9.0.1-rc.1');
  assert.equal((await checkUpgrade({ current: '8.0.0', env: env(), pre: false })).latest, '9.0.0', 'pre: false manda');
  await setUpdateChannel('stable');
  assert.equal(updateChannel(), 'stable');
  await assert.rejects(setUpdateChannel('nightly'), { code: 'invalid_argument' });
});

test('scompass upgrade --check y scompass upgrade', async () => {
  const target = join(dir, 'cli-scompass');
  await writeFile(target, 'viejo');
  const cli = async (argv, extra = {}) => {
    let out = '', err = '';
    const code = await run(argv, { cwd: dir, env: { ...env(), ...extra }, stdin: Readable.from(['']), out: { write: (s) => { out += s; } }, err: { write: (s) => { err += s; } } });
    return { code, out, err };
  };
  const check = await cli(['upgrade', '--check', '--json']);
  assert.equal(check.code, 1, 'hay una más nueva: sale con 1');
  assert.equal(JSON.parse(check.out).latest, '9.0.0');
  const pre = await cli(['upgrade', '--check', '--pre']);
  assert.match(pre.out, /9\.0\.1-rc\.1 \(beta\)/);
  assert.equal(updateChannel(), 'stable', '--pre no cambia el canal');
  const ch = await cli(['upgrade', '--channel', 'beta']);
  assert.equal(ch.code, 0, ch.err);
  assert.match(ch.out, /beta[\s\S]*9\.0\.1-rc\.1/);
  assert.equal(updateChannel(), 'beta');
  assert.equal((await cli(['upgrade', '--channel', 'nightly'])).code, 1);
  assert.equal((await cli(['upgrade', '--channel', 'stable'])).code, 0);
  assert.equal(updateChannel(), 'stable');

  const notBinary = await cli(['upgrade']);
  assert.equal(notBinary.code, 1);
  assert.match(notBinary.err, /npm/);
  assert.equal(readFileSync(target, 'utf8'), 'viejo');

  const up = await cli(['upgrade'], { SCOMPASS_UPGRADE_TARGET: target });
  assert.equal(up.code, 0, up.err);
  assert.deepEqual(readFileSync(target), BODY);
});

test('Inicio: GET /api/upgrade avisa y POST la instala; sin ser el binario, ni sale a GitHub', async () => {
  const target = join(dir, 'home-scompass');
  await writeFile(target, 'viejo');
  const home = createHomeServer({ validators: V, pollMs: 50, upgrade: {
    enabled: true,
    check: (o) => checkUpgrade({ ...o, current: '8.0.0', env: env() }),
    install: (rel) => installUpgrade(rel, { target, binary: true })
  } });
  const events = [];
  home.events.on('event', (e) => events.push(e.type));
  try {
    const got = (await home.inject({ method: 'GET', url: '/api/upgrade' })).json();
    assert.equal(got.available, true);
    assert.equal(got.latest, '9.0.0');
    assert.equal(got.installed, null);
    assert.ok(events.includes('upgrade'));
    const posted = await home.inject({ method: 'POST', url: '/api/upgrade', remoteAddress: '127.0.0.1' });
    assert.equal(posted.statusCode, 200, posted.body);
    assert.equal(posted.json().installed, '9.0.0');
    assert.deepEqual(readFileSync(target), BODY);
    assert.equal(home.upgrade.installed, '9.0.0', 'la bandeja lo lee de acá');
    const far = await home.inject({ method: 'POST', url: '/api/upgrade', remoteAddress: '192.168.1.20' });
    assert.equal(far.statusCode, 403, 'desde el teléfono no');
  } finally {
    await home.close();
  }

  hits = 0;
  const dev = createHomeServer({ validators: V, pollMs: 50 });
  try {
    const got = (await dev.inject({ method: 'GET', url: '/api/upgrade' })).json();
    assert.equal(got.available, false);
    assert.equal(got.binary, false);
    assert.equal((await dev.inject({ method: 'POST', url: '/api/upgrade', remoteAddress: '127.0.0.1' })).statusCode, 409);
    assert.equal(hits, 0);
  } finally {
    await dev.close();
  }
  assert.ok(!existsSync(target + '.new'));
});
