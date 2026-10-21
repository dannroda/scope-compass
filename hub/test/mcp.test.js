// `scompass mcp` (M22, §30): lanza el servidor de verdad, le habla por stdio y compara con lo que da la CLI, con y
// sin hub.
import './isolate.js';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadValidators } from '../src/schema.js';
import { canonical } from '../src/store/canonical.js';
import { createJsonFilesStore } from '../src/store/json-files.js';
import { createServer, listen } from '../src/server.js';
import { run } from '../src/cli.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, 'fixtures', 'compass');
const BIN = join(HERE, '..', 'bin', 'scompass.js');
let root, dir, servers;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'scompass-'));
  dir = join(root, 'p');
  await cp(FIXTURE, join(dir, 'compass'), { recursive: true });
  // Un puerto donde no escucha nadie: sin hub, salvo que el test levante uno.
  await setPort(1);
  await mkdir(join(dir, 'docs'));
  await writeFile(join(dir, 'docs', 'spec.md'), '# Spec\n\n## Alcance\n<!-- id: alcance -->\n\nQué entra.\n');
  servers = [];
});
afterEach(async () => {
  for (const s of servers) s.close();
  await rm(root, { recursive: true, force: true, maxRetries: 10 });
});

async function setPort(port) {
  const path = join(dir, 'compass', 'config.json');
  await writeFile(path, canonical({ ...JSON.parse(await readFile(path, 'utf8')), port }));
}

// El servidor como lo lanza Claude Code: un proceso con la carpeta de la sesión, mensajes por línea.
function mcp(cwd = dir, env = {}) {
  const p = spawn(process.execPath, [BIN, 'mcp'], { cwd, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  const waiting = new Map();
  const stray = [];
  createInterface({ input: p.stdout }).on('line', (l) => {
    const m = JSON.parse(l);
    waiting.has(m.id) ? (waiting.get(m.id)(m), waiting.delete(m.id)) : stray.push(m);
  });
  let next = 1;
  const s = {
    stray,
    send: (msg) => p.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n'),
    request: (method, params) => new Promise((res) => { const id = next++; waiting.set(id, res); s.send({ id, method, params }); }),
    tool: async (name, args = {}) => (await s.request('tools/call', { name, arguments: args })).result,
    close: () => p.stdin.end(),
    exited: new Promise((res) => p.on('exit', res))
  };
  servers.push(s);
  return s;
}
const data = (r) => JSON.parse(r.content[0].text);

async function cli(argv) {
  let out = '';
  await run(argv, { cwd: dir, out: { write: (x) => { out += x; } }, err: { write: () => {} } });
  return JSON.parse(out);
}
const task = async (id) => JSON.parse(await readFile(join(dir, 'compass', 'tasks', `${id}.json`), 'utf8'));

test('initialize, ping, tools/list y lo que no existe', async () => {
  const s = mcp();
  const init = await s.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.deepEqual(init.result.capabilities, { tools: {}, resources: {} });
  assert.equal(init.result.serverInfo.name, 'scope-compass');
  assert.match(init.result.instructions, /move_task/);
  // Una versión desconocida: se ofrece la más nueva que conoce.
  assert.match((await s.request('initialize', { protocolVersion: '1999-01-01' })).result.protocolVersion, /^\d{4}-\d{2}-\d{2}$/);
  s.send({ method: 'notifications/initialized' });
  assert.deepEqual((await s.request('ping')).result, {});
  const { tools } = (await s.request('tools/list')).result;
  for (const name of ['list_tasks', 'show_task', 'add_task', 'update_task', 'move_task', 'check_step', 'add_link', 'set_playtest_result']) assert.ok(tools.some((t) => t.name === name), name);
  for (const t of tools) {
    assert.equal(t.inputSchema.type, 'object', t.name);
    assert.ok(t.inputSchema.properties.dir, `${t.name} acepta dir`);
  }
  assert.equal(tools.find((t) => t.name === 'list_tasks').annotations.readOnlyHint, true);
  assert.equal(tools.find((t) => t.name === 'add_task').annotations.readOnlyHint, false);
  assert.equal((await s.request('nada/esto')).error.code, -32601);
  assert.equal((await s.request('tools/call', { name: 'nada' })).error.code, -32602);
  s.send({ id: 99, method: 'ping', params: {} });
  s.send({ method: 'notifications/cancelled', params: {} });
  s.close();
  assert.equal(await s.exited, 0);
  // Las notificaciones no se contestan; el ping de id 99 sí.
  assert.deepEqual(s.stray.map((m) => m.id), [99]);
});

test('las lecturas dan lo mismo que la CLI', async () => {
  const s = mcp();
  assert.deepEqual(data(await s.tool('list_tasks', { milestone: 'm01', status: ['done', 'todo'] })).tasks,
    (await cli(['list', '--json', '--milestone', 'm01', '--status', 'done,todo'])).tasks);
  const withTag = await s.tool('list_tasks', { q: 'hub', blocked: false });
  assert.deepEqual(data(withTag).tasks, (await cli(['list', '--json', '--q', 'hub', '--unblocked'])).tasks);
  assert.deepEqual(data(await s.tool('show_task', { id: 'm1-04' })), await cli(['show', 'm1-04', '--json']));
  assert.deepEqual(data(await s.tool('list_milestones')), await cli(['milestone', 'list', '--json']));
  assert.deepEqual(data(await s.tool('show_doc', { ref: 'spec#alcance' })).markdown, (await cli(['doc', 'show', 'spec#alcance', '--json'])).markdown);
  // Un id que no existe: isError con el mensaje de la CLI, sin la ayuda entera.
  const bad = await s.tool('show_task', { id: 'nope' });
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /^error \[not_found\]/);
  const usage = await s.tool('list_tasks', { status: ['wip'] });
  assert.equal(usage.isError, true);
  assert.match(usage.content[0].text, /estado inválido: wip/);
  assert.doesNotMatch(usage.content[0].text, /Uso:/);
  assert.match((await s.tool('show_task', {})).content[0].text, /falta id/);
});

test('las escrituras pasan por la CLI: archivo canónico, export y etag', async () => {
  const s = mcp();
  // Un título que empieza con - es un título, no una opción.
  const add = await s.tool('add_task', { title: '-raro', milestone: 'm01', code: '1.9', tags: ['arte', 'audio'], priority: 'high' });
  const t = add.structuredContent;
  assert.equal(add.isError, undefined);
  assert.equal(t.title, '-raro');
  assert.deepEqual((await task(t.id)).tags, ['arte', 'audio']);
  assert.match(await readFile(join(dir, 'docs', 'tareas.md'), 'utf8'), /-raro/);
  await s.tool('move_task', { id: t.id, status: 'doing' });
  await s.tool('add_step', { id: t.id, text: 'Primero', detail: 'cómo' });
  await s.tool('add_step', { id: t.id, text: 'Segundo' });
  await s.tool('check_step', { id: t.id, n: 2 });
  await s.tool('update_step', { id: t.id, n: 1, detail: '' });
  const now = await task(t.id);
  assert.equal(now.status, 'doing');
  assert.deepEqual(now.checklist, [{ text: 'Primero', done: false }, { text: 'Segundo', done: true }]);
  // update_task: "" quita; un etag viejo es un conflicto.
  const u = await s.tool('update_task', { id: t.id, notes: 'listo', priority: '', tags: [], etag: t.etag });
  assert.equal(u.isError, true);
  assert.match(u.content[0].text, /conflict/);
  const fresh = data(await s.tool('show_task', { id: t.id }));
  const ok = await s.tool('update_task', { id: t.id, notes: 'listo', priority: '', tags: [], etag: fresh.etag });
  assert.equal(ok.structuredContent.notes, 'listo');
  assert.equal((await task(t.id)).priority, undefined);
  assert.equal((await task(t.id)).tags, undefined);
  // Vínculos: blocked-by se guarda en la que bloquea; list_links lo muestra desde las dos.
  await s.tool('add_link', { id: t.id, type: 'blocked-by', other: 'm1-04' });
  const links = data(await s.tool('list_links', { id: t.id }));
  assert.deepEqual(links.links, [{ id: t.id, blocks: [], blocked_by: ['m1-04'], related: [] }]);
  assert.deepEqual(links, await cli(['link', 'list', t.id, '--json']));
  await s.tool('remove_link', { id: t.id, other: 'm1-04' });
  assert.equal((await task('m1-04')).links, undefined);
});

test('playtest: el resultado queda en la tarea', async () => {
  const s = mcp();
  await cli(['playtest', 'new', 'Build 1', '--json']);
  await cli(['playtest', 'add', 'build-1', 'm1-04', '--json']);
  const r = await s.tool('set_playtest_result', { session: 'build-1', task: 'm1-04', result: 'fail', note: 'se cuelga' });
  assert.deepEqual(r.structuredContent.playtest, { result: 'fail', note: 'se cuelga' });
  assert.deepEqual((await task('m1-04')).playtest, { result: 'fail', note: 'se cuelga' });
  assert.equal(data(await s.tool('show_playtest', { session: 'build-1' })).items[0].task, 'm1-04');
});

test('decisiones (§31): registrar, responder, revisar, listar y filtrar, igual que la CLI', async () => {
  const s = mcp();
  const a = await s.tool('add_decision', { id: 'm1-04', text: 'Usar X', why: 'porque', alternatives: 'Y' });
  assert.deepEqual(a.structuredContent.decisions.map(({ at, ...d }) => d), [{ text: 'Usar X', why: 'porque', alternatives: 'Y' }]);
  await s.tool('add_decision', { id: 'm1-04', text: '-¿A o B?', ask: true });
  assert.deepEqual(data(await s.tool('list_tasks', { decisions: ['open'] })).tasks.map((t) => t.id), ['m1-04']);
  assert.deepEqual(data(await s.tool('list_decisions', { states: ['open', 'pending'] })), await cli(['decisions', '--open', '--pending', '--json']));
  // Una pregunta no se revisa: se responde.
  const wrong = await s.tool('review_decision', { id: 'm1-04', n: 2, review: 'ok' });
  assert.equal(wrong.isError, true);
  assert.match(wrong.content[0].text, /es una pregunta/);
  await s.tool('reply_decision', { id: 'm1-04', n: 2, reply: 'A' });
  const r = await s.tool('review_decision', { id: 'm1-04', n: 1, review: 'revert', reply: 'hacer W' });
  assert.deepEqual(r.structuredContent.decisions.map((d) => [d.text, d.review, d.reply]), [['Usar X', 'revert', 'hacer W'], ['-¿A o B?', undefined, 'A']]);
  assert.deepEqual(data(await s.tool('list_decisions', { states: ['revert'] })).decisions.map((d) => [d.task, d.n]), [['m1-04', 1]]);
  await s.tool('remove_decision', { id: 'm1-04', n: 2 });
  assert.equal((await task('m1-04')).decisions.length, 1);
});

test('recursos: hitos, tareas y documentos', async () => {
  const s = mcp();
  const { resources } = (await s.request('resources/list')).result;
  assert.ok(resources.some((r) => r.uri === 'compass://milestone/m00' && r.name.startsWith('M0 · ')));
  assert.ok(resources.some((r) => r.uri === 'compass://doc/spec' && r.mimeType === 'text/markdown'));
  const { resourceTemplates } = (await s.request('resources/templates/list')).result;
  assert.ok(resourceTemplates.some((t) => t.uriTemplate === 'compass://task/{id}'));
  const m = JSON.parse((await s.request('resources/read', { uri: 'compass://milestone/m01' })).result.contents[0].text);
  assert.equal(m.id, 'm01');
  assert.deepEqual(m.tasks, (await cli(['list', '--json', '--milestone', 'm01'])).tasks);
  const t = JSON.parse((await s.request('resources/read', { uri: 'compass://task/m1-04' })).result.contents[0].text);
  assert.deepEqual(t, await cli(['show', 'm1-04', '--json']));
  const doc = (await s.request('resources/read', { uri: 'compass://doc/spec%23alcance' })).result.contents[0];
  assert.equal(doc.mimeType, 'text/markdown');
  assert.match(doc.text, /Qué entra/);
  assert.equal((await s.request('resources/read', { uri: 'compass://task/nope' })).error.code, -32002);
  assert.equal((await s.request('resources/read', { uri: 'https://x' })).error.code, -32002);
});

test('el proyecto: la carpeta donde lo lanzan, o CLAUDE_PROJECT_DIR si ahí no hay compass/; dir opera sobre otro', async () => {
  await mkdir(join(dir, 'a', 'b'), { recursive: true });
  const fromSub = mcp(join(dir, 'a', 'b'));
  assert.ok(data(await fromSub.tool('show_task', { id: 'm1-04' })).title);
  const fromEnv = mcp(root, { CLAUDE_PROJECT_DIR: dir });
  assert.ok(data(await fromEnv.tool('show_task', { id: 'm1-04' })).title);
  const other = mcp(root, { CLAUDE_PROJECT_DIR: '' });
  assert.equal((await other.tool('show_task', { id: 'm1-04' })).isError, true);
  assert.ok(data(await other.tool('show_task', { id: 'm1-04', dir })).title);
});

test('con hub, las escrituras pasan por su API y la UI se entera', async () => {
  const app = createServer({ projectDir: dir, store: createJsonFilesStore(join(dir, 'compass'), { validators: loadValidators() }) });
  const { port } = await listen(app, 0);
  try {
    await setPort(port);
    const events = [];
    app.events.on('event', (e) => events.push(e));
    const s = mcp();
    const t = (await s.tool('add_task', { title: 'Desde el MCP', milestone: 'm01' })).structuredContent;
    await s.tool('move_task', { id: t.id, status: 'review' });
    assert.deepEqual(events.filter((e) => e.type === 'upsert').map((e) => e.id), [t.id, t.id]);
    assert.equal((await task(t.id)).status, 'review');
    assert.deepEqual(data(await s.tool('show_task', { id: t.id })), await cli(['show', t.id, '--json']));
  } finally {
    await app.close();
  }
});

test('add_decision con ask guarda la sesión de Claude Code del servidor (CLAUDE_CODE_SESSION_ID, §32)', async () => {
  const s = mcp(dir, { CLAUDE_CODE_SESSION_ID: '6f0c4c1e-1111-4222-8333-444455556666' });
  const r = await s.tool('add_decision', { id: 'm1-04', text: '¿A o B?', ask: true });
  assert.equal(r.structuredContent.decisions.at(-1).session, '6f0c4c1e-1111-4222-8333-444455556666');
  const r2 = await s.tool('add_decision', { id: 'm1-04', text: 'Usar X' });
  assert.equal(r2.structuredContent.decisions.at(-1).session, undefined);
});
