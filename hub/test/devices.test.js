// Vincular el teléfono al chat (spec §49, D60, m29-02): código de un solo uso, token por dispositivo en una cookie,
// el chat del Inicio para «local o vinculado» por HTTP y por WebSocket, y desvincular al instante.
import './isolate.js';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { networkInterfaces, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadValidators } from '../src/schema.js';
import { listen } from '../src/server.js';
import { createHomeServer } from '../src/home.js';
import { recordProject } from '../src/projects.js';
import { chatDir } from '../src/chat.js';
import { run } from '../src/cli.js';
import { createDevices, devicesFile, removeDevice, tokenFromCookie } from '../src/devices.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const V = loadValidators();
const AWAY = '192.168.1.20';
const json = (r) => JSON.parse(r.payload || 'null');
const until = async (cond, ms = 3000) => {
  for (const t = Date.now(); Date.now() - t < ms; await new Promise((r) => setTimeout(r, 10))) if (await cond()) return;
  throw new Error('no pasó a tiempo');
};
const lanIp = () => Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
let root, dir, apps, saved;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'scompass-devices-'));
  dir = join(root, 'p');
  await cp(join(HERE, 'fixtures', 'compass'), join(dir, 'compass'), { recursive: true });
  await rm(devicesFile(), { force: true });
  saved = process.env.SCOMPASS_CLAUDE;
  process.env.SCOMPASS_CLAUDE = join(HERE, 'fake-claude.js');
  process.env.FAKE_CLAUDE_LOG = join(root, 'launches.jsonl');
  process.env.FAKE_CLAUDE_STATE = join(root, 'sessions');
  apps = [];
});
afterEach(async () => {
  for (const a of apps) await a.close();
  if (saved === undefined) delete process.env.SCOMPASS_CLAUDE; else process.env.SCOMPASS_CLAUDE = saved;
  await rm(chatDir(dir), { recursive: true, force: true });
  await rm(root, { recursive: true, force: true, maxRetries: 10 });
});

function home(opts = {}) {
  const app = createHomeServer({ validators: V, pollMs: 50, lan: () => ['http://192.168.1.10:4700/'], devices: { watchMs: 50 }, ...opts });
  apps.push(app);
  return app;
}
// Vincula un dispositivo desde la red y devuelve su cookie.
async function pair(app, name = 'Teléfono de prueba') {
  const { code } = json(await app.inject({ method: 'POST', url: '/api/devices/code' }));
  const r = await app.inject({ method: 'POST', url: '/api/devices/pair', payload: { code, name }, remoteAddress: AWAY });
  assert.equal(r.statusCode, 201);
  return { cookie: `scompass_device=${tokenFromCookie(r.headers['set-cookie'])}`, device: json(r).device, setCookie: r.headers['set-cookie'] };
}

test('un código sirve una vez y vence', async () => {
  let t = Date.parse('2026-11-15T10:00:00Z');
  const d = createDevices({ now: () => t, watchMs: 0 });
  try {
    const { code, expires_at } = d.code();
    assert.equal(expires_at, '2026-11-15T10:05:00.000Z', '5 minutos (D60)');
    const { device, token } = await d.pair(code, '  Mi teléfono  ');
    assert.equal(device.name, 'Mi teléfono');
    assert.equal(device.hash, undefined, 'el hash no sale');
    await assert.rejects(d.pair(code, 'otro'), { code: 'forbidden' });
    const late = d.code().code;
    t += 5 * 60 * 1000;
    await assert.rejects(d.pair(late, 'tarde'), { code: 'forbidden' });
    // devices.json guarda solo el hash del token.
    const file = await readFile(devicesFile(), 'utf8');
    assert.ok(!file.includes(token));
    assert.equal(JSON.parse(file).devices[0].hash.length, 64);
    assert.equal(d.of({ headers: { cookie: `a=1; scompass_device=${token}` } })?.id, device.id);
    assert.equal(d.of({ headers: { cookie: 'scompass_device=otro' } }), null);
  } finally {
    d.close();
  }
});

test('5 intentos fallidos seguidos anulan los códigos pendientes', async () => {
  const d = createDevices({ watchMs: 0 });
  try {
    const { code } = d.code();
    for (let i = 0; i < 4; i++) await assert.rejects(d.pair('nada', 'x'));
    assert.equal(d.pending(), 1);
    await assert.rejects(d.pair('nada', 'x'));
    assert.equal(d.pending(), 0);
    await assert.rejects(d.pair(code, 'x'), { code: 'forbidden' });
  } finally {
    d.close();
  }
});

test('Inicio: el código y la lista solo desde este equipo; sin --lan no hay código', async () => {
  const app = home();
  const away = await app.inject({ method: 'POST', url: '/api/devices/code', remoteAddress: AWAY });
  assert.deepEqual([away.statusCode, json(away).error.code], [403, 'forbidden']);
  const r = json(await app.inject({ method: 'POST', url: '/api/devices/code' }));
  assert.equal(r.url, `http://192.168.1.10:4700/vincular#${r.code}`);
  assert.equal((await app.inject({ url: '/api/devices', remoteAddress: AWAY })).statusCode, 403);
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/devices/x', remoteAddress: AWAY })).statusCode, 403);
  const solo = home({ lan: () => null });
  const none = await solo.inject({ method: 'POST', url: '/api/devices/code' });
  assert.deepEqual([none.statusCode, json(none).error.code], [409, 'conflict']);
});

test('Inicio: el canje deja una cookie HttpOnly y SameSite=Strict, Secure solo por HTTPS', async () => {
  const app = home();
  const { setCookie, device } = await pair(app);
  assert.match(setCookie, /^scompass_device=[\w-]{43}; Path=\/; Max-Age=31536000; HttpOnly; SameSite=Strict$/);
  assert.deepEqual(json(await app.inject('/api/devices')).devices.map((d) => [d.id, d.name, d.hash]), [[device.id, 'Teléfono de prueba', undefined]]);
  const { code } = json(await app.inject({ method: 'POST', url: '/api/devices/code' }));
  const https = await app.inject({ method: 'POST', url: '/api/devices/pair', payload: { code }, headers: { 'x-forwarded-proto': 'https' }, remoteAddress: AWAY });
  assert.match(https.headers['set-cookie'], /; Secure$/);
  assert.equal(json(https).device.name, 'Teléfono', 'sin nombre, «Teléfono»');
  const used = await app.inject({ method: 'POST', url: '/api/devices/pair', payload: { code }, remoteAddress: AWAY });
  assert.deepEqual([used.statusCode, json(used).error.code], [403, 'forbidden']);
});

test('Inicio: el chat de un proyecto desde la red, sin vincular 403, vinculado 200 y desvinculado 403 al instante', async () => {
  await recordProject(dir);
  const app = home();
  const key = json(await app.inject('/api/projects')).projects.find((p) => p.path === dir).key;
  const url = `/p/${key}/api/chats`;
  assert.equal((await app.inject({ url, remoteAddress: AWAY })).statusCode, 403);
  const { cookie, device } = await pair(app);
  const ok = await app.inject({ url, headers: { cookie }, remoteAddress: AWAY });
  assert.deepEqual([ok.statusCode, json(ok).claude], [200, true]);
  // La cabecera interna no se puede mandar desde afuera.
  assert.equal((await app.inject({ url, headers: { 'x-scompass-linked': 'x' }, remoteAddress: AWAY })).statusCode, 403);
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/devices/${device.id}` })).statusCode, 200);
  assert.equal((await app.inject({ url, headers: { cookie }, remoteAddress: AWAY })).statusCode, 403);
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/devices/${device.id}` })).statusCode, 404);
});

test('Inicio: el WebSocket manda el chat a un vinculado, no a uno sin vincular, y desvincular lo cierra', { skip: !lanIp() && 'sin IP de red' }, async () => {
  await recordProject(dir);
  const app = home();
  const ip = lanIp();
  const { port } = await listen(app, 0, { lan: true });
  const key = json(await app.inject('/api/projects')).projects.find((p) => p.path === dir).key;
  const { cookie, device } = await pair(app);
  const open = (headers) => {
    const ws = new WebSocket(`ws://${ip}:${port}/p/${key}/ws`, { headers });
    const got = [];
    let closed = null;
    ws.addEventListener('message', (m) => got.push(JSON.parse(m.data)));
    ws.addEventListener('close', (e) => { closed = e.code; });
    return { ws, got, chat: () => got.filter((m) => m.type === 'chat'), closed: () => closed, open: new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); }) };
  };
  const linked = open({ cookie });
  const stranger = open({});
  await Promise.all([linked.open, stranger.open]);
  const r = await app.inject({ method: 'POST', url: `/p/${key}/api/chats`, payload: { text: 'hola' } });
  assert.equal(r.statusCode, 201);
  await until(() => linked.chat().some((m) => m.event === 'end'));
  // Algo que sí le llega a la otra, para saber que tuvo tiempo de recibir los del chat.
  await app.inject({ method: 'POST', url: `/p/${key}/api/tasks`, payload: { id: 'm1-09', milestone: 'm1', title: 'Marca', status: 'todo' } });
  await until(() => stranger.got.some((m) => m.type === 'upsert'));
  assert.deepEqual(stranger.chat(), []);
  // Desvincular con la CLI (otro proceso, el archivo): el Inicio lo ve y cierra el WebSocket.
  assert.equal(await removeDevice(device.id), true);
  await until(() => linked.closed() !== null);
  assert.equal(linked.closed(), 4403);
  stranger.ws.close();
});

test('CLI: scompass devices lista y devices rm desvincula', async () => {
  const app = home();
  const { device } = await pair(app, 'Tableta');
  let out = '';
  const cli = (...argv) => { out = ''; return run(argv, { cwd: root, out: { write: (s) => { out += s; } }, err: { write: () => {} } }); };
  assert.equal(await cli('devices', '--json'), 0);
  assert.deepEqual(JSON.parse(out).devices.map((d) => [d.id, d.name]), [[device.id, 'Tableta']]);
  assert.equal(await cli('devices'), 0);
  assert.match(out, new RegExp(`${device.id}  Tableta`));
  assert.equal(await cli('devices', 'rm', device.id), 0);
  assert.notEqual(await cli('devices', 'rm', device.id), 0);
  assert.equal(await cli('devices'), 0);
  assert.match(out, /No hay dispositivos vinculados/);
});
