// Chat (M25, §32): la API y los eventos del WebSocket (25.4), con el claude falso de fake-claude.js. Solo desde el
// mismo equipo, también a través del Inicio.
import './isolate.js';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { networkInterfaces, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadValidators } from '../src/schema.js';
import { createJsonFilesStore } from '../src/store/json-files.js';
import { createServer, listen } from '../src/server.js';
import { createHomeServer } from '../src/home.js';
import { recordProject } from '../src/projects.js';
import { chatDir } from '../src/chat.js';
import { isLoopback } from '../src/chat-api.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const V = loadValidators();
let root, dir, env, apps;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'scompass-chat-api-'));
  dir = join(root, 'p');
  await cp(join(HERE, 'fixtures', 'compass'), join(dir, 'compass'), { recursive: true });
  env = { ...process.env, SCOMPASS_CLAUDE: join(HERE, 'fake-claude.js'), FAKE_CLAUDE_LOG: join(root, 'launches.jsonl'), FAKE_CLAUDE_STATE: join(root, 'sessions') };
  apps = [];
});
afterEach(async () => {
  for (const a of apps) await a.close();
  await rm(chatDir(dir), { recursive: true, force: true });
  await rm(root, { recursive: true, force: true, maxRetries: 10 });
});

function hub(opts = {}) {
  const app = createServer({ projectDir: dir, store: createJsonFilesStore(join(dir, 'compass'), { validators: V }), validators: V, chatEnv: env, ...opts });
  apps.push(app);
  return app;
}
const json = (r) => JSON.parse(r.payload || 'null');
const post = (app, url, payload, extra = {}) => app.inject({ method: 'POST', url, payload, ...extra });
const until = async (cond, ms = 3000) => {
  for (const t = Date.now(); Date.now() - t < ms; await new Promise((r) => setTimeout(r, 10))) if (await cond()) return;
  throw new Error('no pasó a tiempo');
};
function socket(url) {
  const ws = new WebSocket(url);
  const got = [];
  ws.addEventListener('message', (m) => got.push(JSON.parse(m.data)));
  return { ws, got, chat: () => got.filter((m) => m.type === 'chat'), open: new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); }) };
}
const lanIp = () => Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;

test('isLoopback: 127.0.0.1, ::1 y 127.0.0.1 en IPv6; nada más', () => {
  for (const a of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) assert.equal(isLoopback(a), true);
  for (const a of ['192.168.1.20', '::ffff:192.168.1.20', '0.0.0.0', undefined]) assert.equal(isLoopback(a), false);
});

test('conversar: crear, mandar, leer la copia, ocupada mientras responde, cortar y borrar', async () => {
  const app = hub();
  assert.deepEqual(json(await app.inject('/api/chats')), { chats: [], claude: true, profile: 'default' });
  const created = await post(app, '/api/chats', { text: 'hola', task: 'm1-01' });
  assert.equal(created.statusCode, 201);
  const chat = json(created);
  assert.equal(chat.title, 'hola');
  await until(async () => json(await app.inject(`/api/chats/${chat.id}`)).entries.length === 2);
  const got = json(await app.inject(`/api/chats/${chat.id}`));
  assert.equal(got.busy, false);
  assert.deepEqual(got.entries.map((e) => [e.role, e.task]), [['user', 'm1-01'], ['assistant', undefined]]);
  assert.match(got.entries[1].text, /^eco: Tarea abierta: .*compass:\/\/task\/m1-01/);
  assert.deepEqual(json(await app.inject('/api/chats')).chats.map((c) => c.id), [chat.id]);

  assert.equal((await post(app, `/api/chats/${chat.id}/messages`, { text: 'lento' })).statusCode, 202);
  const busy = await post(app, `/api/chats/${chat.id}/messages`, { text: 'otro' });
  assert.deepEqual([busy.statusCode, json(busy).error.code], [409, 'busy']);
  await until(async () => json(await app.inject(`/api/chats/${chat.id}`)).turn?.text.length > 0);
  assert.deepEqual(json(await post(app, `/api/chats/${chat.id}/interrupt`)), { interrupted: true });
  await until(async () => !json(await app.inject(`/api/chats/${chat.id}`)).busy);
  assert.equal(json(await app.inject(`/api/chats/${chat.id}`)).entries.at(-1).interrupted, true);
  assert.deepEqual(json(await post(app, `/api/chats/${chat.id}/interrupt`)), { interrupted: false });

  assert.equal((await app.inject({ method: 'DELETE', url: `/api/chats/${chat.id}` })).statusCode, 204);
  assert.deepEqual(json(await app.inject('/api/chats')).chats, []);
  for (const r of [await app.inject(`/api/chats/${chat.id}`), await post(app, `/api/chats/${chat.id}/messages`, { text: 'x' }),
    await post(app, `/api/chats/${chat.id}/interrupt`), await app.inject({ method: 'DELETE', url: `/api/chats/${chat.id}` })]) {
    assert.deepEqual([r.statusCode, json(r).error.code], [404, 'not_found']);
  }
});

test('pedidos inválidos: sin texto, una tarea que no existe', async () => {
  const app = hub();
  for (const body of [{}, { text: '  ' }, { text: 3 }]) {
    const r = await post(app, '/api/chats', body);
    assert.deepEqual([r.statusCode, json(r).error.code], [400, 'invalid_argument']);
  }
  const r = await post(app, '/api/chats', { text: 'hola', task: 'm9-99' });
  assert.deepEqual([r.statusCode, json(r).error.code], [400, 'invalid_argument']);
  assert.deepEqual(json(await app.inject('/api/chats')).chats, []);
});

test('sin claude: la lista lo dice y crear responde claude_missing', async () => {
  env.SCOMPASS_CLAUDE = join(root, 'no-está');
  const app = hub();
  assert.deepEqual(json(await app.inject('/api/chats')), { chats: [], claude: false, profile: 'default' });
  const r = await post(app, '/api/chats', { text: 'hola' });
  assert.deepEqual([r.statusCode, json(r).error.code], [503, 'claude_missing']);
});

test('fuera de este equipo: 403 en todo el chat, también con --lan; el resto de la API sigue', async () => {
  const app = hub();
  const away = { remoteAddress: '192.168.1.20' };
  for (const r of [await app.inject({ url: '/api/chats', ...away }), await post(app, '/api/chats', { text: 'hola' }, away),
    await app.inject({ url: '/api/chats/0f0f0f0f-0000-4000-8000-000000000000', ...away }), await app.inject({ method: 'DELETE', url: '/api/chats/x', ...away })]) {
    assert.deepEqual([r.statusCode, json(r).error.code], [403, 'forbidden']);
  }
  assert.equal((await app.inject({ url: '/api/tasks', ...away })).statusCode, 200);
  assert.equal((await app.inject({ url: '/api/chats', remoteAddress: '::1' })).statusCode, 200);
});

test('con token (hosting) el chat está apagado', async () => {
  const app = hub({ token: 'secreto' });
  const r = await app.inject({ url: '/api/chats', headers: { authorization: 'Bearer secreto' } });
  assert.deepEqual([r.statusCode, json(r).error.code], [403, 'forbidden']);
});

test('WebSocket: todas las pestañas locales ven la conversación; una de la red, no', async () => {
  const app = hub();
  const ip = lanIp();
  const { port } = await listen(app, 0, { lan: !!ip });
  const a = socket(`ws://127.0.0.1:${port}/ws`);
  const b = socket(`ws://127.0.0.1:${port}/ws`);
  const far = ip ? socket(`ws://${ip}:${port}/ws`) : null;
  await Promise.all([a.open, b.open, far?.open]);
  const chat = json(await post(app, '/api/chats', { text: 'herramienta' }));
  await until(() => a.chat().some((m) => m.event === 'end') && b.chat().some((m) => m.event === 'end'));
  assert.deepEqual(a.chat().map((m) => m.event), ['turn', 'tool', 'tool_result', 'text', 'end']);
  assert.ok(a.chat().every((m) => m.chat === chat.id));
  assert.deepEqual(b.chat(), a.chat());
  assert.equal(a.chat()[1].name, 'show_task');
  if (far) {
    // Se le manda algo que sí le llega, para saber que tuvo tiempo de recibir los del chat.
    await post(app, '/api/tasks', { id: 'm1-09', milestone: 'm1', title: 'Marca', status: 'todo' });
    await until(() => far.got.some((m) => m.type === 'upsert'));
    assert.deepEqual(far.chat(), []);
  }
  for (const s of [a, b, far]) s?.ws.close();
});

test('cerrar el hub cierra los procesos de claude', async () => {
  const app = hub();
  const chat = json(await post(app, '/api/chats', { text: 'lento' }));
  await until(async () => json(await app.inject(`/api/chats/${chat.id}`)).busy);
  await app.close();
  apps.splice(apps.indexOf(app), 1);
  const again = hub();
  // Se cortó a mitad del turno: la copia lo guarda como cortado y la conversación se retoma.
  const { entries } = json(await again.inject(`/api/chats/${chat.id}`));
  assert.equal(entries.at(-1).interrupted, true);
  assert.equal((await post(again, `/api/chats/${chat.id}/messages`, { text: 'sigo' })).statusCode, 202);
  await until(async () => json(await again.inject(`/api/chats/${chat.id}`)).entries.length === 4);
  const launches = (await readFile(env.FAKE_CLAUDE_LOG, 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(launches.at(-1).argv.includes('--resume'));
  assert.equal(json(await again.inject(`/api/chats/${chat.id}`)).entries.at(-1).ok, true);
});

test('a través del Inicio: el chat del proyecto anda desde este equipo y da 403 desde la red', async () => {
  const saved = process.env.SCOMPASS_CLAUDE;
  process.env.SCOMPASS_CLAUDE = env.SCOMPASS_CLAUDE;
  try {
    await recordProject(dir);
    const home = createHomeServer({ validators: V, pollMs: 50 });
    apps.push(home);
    const { port } = await listen(home, 0);
    const key = (await (await fetch(`http://127.0.0.1:${port}/api/projects`)).json()).projects.find((p) => p.path === dir).key;
    const r = await fetch(`http://127.0.0.1:${port}/p/${key}/api/chats`);
    assert.deepEqual([r.status, (await r.json()).claude], [200, true]);
    const away = await home.inject({ url: `/p/${key}/api/chats`, remoteAddress: '192.168.1.20' });
    assert.deepEqual([away.statusCode, json(away).error.code], [403, 'forbidden']);
    const away2 = await home.inject({ method: 'POST', url: `/p/${key}/api/chats?x=1`, payload: { text: 'hola' }, remoteAddress: '192.168.1.20' });
    assert.equal(away2.statusCode, 403);
    assert.equal((await home.inject({ url: `/p/${key}/api/tasks`, remoteAddress: '192.168.1.20' })).statusCode, 200);
  } finally {
    if (saved === undefined) delete process.env.SCOMPASS_CLAUDE; else process.env.SCOMPASS_CLAUDE = saved;
  }
});

test('POST /api/chats con session retoma esa sesión de Claude Code', async () => {
  const app = hub();
  const { mkdir, writeFile } = await import('node:fs/promises');
  await mkdir(env.FAKE_CLAUDE_STATE, { recursive: true });
  await writeFile(join(env.FAKE_CLAUDE_STATE, '6f0c4c1e-1111-4222-8333-444455556666'), '');
  const r = await post(app, '/api/chats', { text: 'Respuesta: A', session: '6f0c4c1e-1111-4222-8333-444455556666' });
  assert.equal(r.statusCode, 201);
  assert.equal(json(r).id, '6f0c4c1e-1111-4222-8333-444455556666');
  await until(async () => json(await app.inject(`/api/chats/${json(r).id}`)).entries.length === 2);
  const bad = await post(app, '/api/chats', { text: 'x', session: 3 });
  assert.deepEqual([bad.statusCode, json(bad).error.code], [400, 'invalid_argument']);
});
