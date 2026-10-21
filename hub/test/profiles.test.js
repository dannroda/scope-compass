// Perfiles de Claude Code en el chat (M28, §33): cuáles hay, su cuenta, el de cada conversación y el del proyecto,
// y en cuál está la sesión de una pregunta. Con el claude falso de fake-claude.js.
import './isolate.js';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chatDir } from '../src/chat.js';
import { ChatManager } from '../src/chats.js';
import { accountOf, forgetAccounts, listProfiles, profileEnv, sessionProfile } from '../src/profiles.js';
import { loadValidators } from '../src/schema.js';
import { createJsonFilesStore } from '../src/store/json-files.js';
import { createServer } from '../src/server.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const V = loadValidators();
let root, home, dir, env, log, closers;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'scompass-profiles-'));
  home = join(root, 'home');
  dir = join(root, 'p');
  await cp(join(HERE, 'fixtures', 'compass'), join(dir, 'compass'), { recursive: true });
  await mkdir(join(home, '.claude'), { recursive: true });
  for (const [name, file] of [['personal', '.claude.json'], ['otro', 'settings.json'], ['vacio', null]]) {
    await mkdir(join(home, '.claude-profiles', name), { recursive: true });
    if (file) await writeFile(join(home, '.claude-profiles', name, file), '{}');
  }
  await writeFile(join(home, '.claude-profiles', 'suelto.json'), '{}');
  await writeFile(join(home, '.claude', 'fake-account.json'), JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'yo@casa', orgName: 'Casa', subscriptionType: 'pro' }));
  await writeFile(join(home, '.claude-profiles', 'personal', 'fake-account.json'), JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'yo@team', orgName: 'Team', subscriptionType: 'team' }));
  log = join(root, 'launches.jsonl');
  env = { ...process.env, HOME: home, USERPROFILE: home, SCOMPASS_CLAUDE: join(HERE, 'fake-claude.js'), FAKE_CLAUDE_LOG: log };
  delete env.FAKE_CLAUDE_STATE;
  delete env.SCOMPASS_CLAUDE_PROFILES;
  forgetAccounts();
  closers = [];
});
afterEach(async () => {
  for (const c of closers) await c.close();
  await rm(chatDir(dir), { recursive: true, force: true });
  await rm(root, { recursive: true, force: true, maxRetries: 10 });
});

const launches = async () => (await readFile(log, 'utf8').catch(() => '')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
function manager() {
  const m = new ChatManager({ projectDir: dir, name: 'Prueba', env });
  closers.push(m);
  return m;
}
const turnEnd = (m) => new Promise((resolve) => { const on = (e) => { if (e.event === 'end') { m.off('event', on); resolve(e); } }; m.on('event', on); });
async function create(m, text, opts) {
  const end = turnEnd(m);
  const chat = await m.create(text, opts);
  await end;
  return chat;
}

test('listProfiles: ~/.claude primero, y las carpetas de ~/.claude-profiles con .claude.json o settings.json', () => {
  assert.deepEqual(listProfiles(env), [
    { id: 'default', label: 'Predeterminado', dir: join(home, '.claude'), default: true },
    { id: 'otro', label: 'otro', dir: join(home, '.claude-profiles', 'otro') },
    { id: 'personal', label: 'personal', dir: join(home, '.claude-profiles', 'personal') }]);
  assert.deepEqual(listProfiles({ ...env, SCOMPASS_CLAUDE_PROFILES: join(root, 'no-está') }).map((p) => p.id), ['default']);
});

test('profileEnv: el predeterminado sin CLAUDE_CONFIG_DIR aunque el hub lo tenga; los demás con su carpeta', () => {
  const [def, otro] = listProfiles(env);
  assert.equal('CLAUDE_CONFIG_DIR' in profileEnv(def, { ...env, CLAUDE_CONFIG_DIR: '/x' }), false);
  assert.equal(profileEnv(otro, env).CLAUDE_CONFIG_DIR, otro.dir);
  assert.equal('CLAUDE_CONFIG_DIR' in profileEnv(null, { CLAUDE_CONFIG_DIR: '/x' }), false);
});

test('accountOf: la cuenta de claude auth status, guardada un rato; sin login también', async () => {
  const [def, otro, personal] = listProfiles(env);
  assert.deepEqual(await accountOf(def, { env }), { logged_in: true, method: 'claude.ai', email: 'yo@casa', org: 'Casa', plan: 'pro' });
  assert.deepEqual(await accountOf(personal, { env }), { logged_in: true, method: 'claude.ai', email: 'yo@team', org: 'Team', plan: 'team' });
  assert.deepEqual(await accountOf(otro, { env }), { logged_in: false, method: 'none' });
  await writeFile(join(home, '.claude', 'fake-account.json'), JSON.stringify({ loggedIn: true, email: 'otra@casa' }));
  assert.equal((await accountOf(def, { env })).email, 'yo@casa', 'guardada');
  forgetAccounts();
  assert.equal((await accountOf(def, { env })).email, 'otra@casa');
  forgetAccounts();
  assert.equal(await accountOf(def, { env: { ...env, SCOMPASS_CLAUDE: join(root, 'no-está') } }), null);
});

test('cada conversación usa su perfil; el elegido queda para las siguientes del proyecto', async () => {
  const m = manager();
  const a = await create(m, 'en casa');
  assert.equal(a.profile, undefined);
  assert.equal((await launches())[0].config, null);
  const b = await create(m, 'en el team', { profile: 'personal' });
  assert.equal(b.profile, 'personal');
  assert.equal(await m.store.profile(), 'personal');
  const c = await create(m, 'sigue en el team');
  assert.equal(c.profile, 'personal');
  assert.deepEqual((await launches()).map((l) => l.config), [null, join(home, '.claude-profiles', 'personal'), join(home, '.claude-profiles', 'personal')]);
  // Retomarla después de cerrar el hub vuelve a su perfil, aunque el proyecto haya cambiado de predeterminado.
  await m.setProfile('default');
  m.close();
  const again = manager();
  const end = turnEnd(again);
  await again.send(b.id, 'sigo');
  await end;
  const last = (await launches()).at(-1);
  assert.equal(last.config, join(home, '.claude-profiles', 'personal'));
  assert.ok(last.argv.includes('--resume'));
  await assert.rejects(again.create('x', { profile: 'no-está' }), { code: 'invalid_argument' });
  await assert.rejects(again.setProfile('vacio'), { code: 'invalid_argument' });
});

test('una pregunta se retoma en el perfil donde está su sesión', async () => {
  const session = '6f0c4c1e-1111-4222-8333-444455556666';
  const where = join(home, '.claude-profiles', 'personal', 'projects', 'fake');
  await mkdir(where, { recursive: true });
  await writeFile(join(where, `${session}.jsonl`), '');
  assert.equal(sessionProfile(session, listProfiles(env)).id, 'personal');
  assert.equal(sessionProfile('0f0f0f0f-0000-4000-8000-000000000000', listProfiles(env)), null);
  const m = manager();
  const chat = await create(m, 'Respuesta: A', { session });
  assert.equal(chat.profile, 'personal');
  assert.equal((await launches())[0].config, join(home, '.claude-profiles', 'personal'));
  // El perfil del proyecto no cambia por retomar una pregunta.
  assert.equal(await m.store.profile(), 'default');
});

test('API: /api/chats/profiles con la cuenta de cada uno, y elegir el del proyecto', async () => {
  const app = createServer({ projectDir: dir, store: createJsonFilesStore(join(dir, 'compass'), { validators: V }), validators: V, chatEnv: env });
  closers.push(app);
  const r = JSON.parse((await app.inject('/api/chats/profiles')).payload);
  assert.deepEqual(r.profiles.map((p) => [p.id, p.account?.email ?? null]), [['default', 'yo@casa'], ['otro', null], ['personal', 'yo@team']]);
  assert.equal(r.profile, 'default');
  const put = await app.inject({ method: 'PUT', url: '/api/chats/profile', payload: { profile: 'personal' } });
  assert.deepEqual(JSON.parse(put.payload), { profile: 'personal' });
  assert.equal(JSON.parse((await app.inject('/api/chats')).payload).profile, 'personal');
  const bad = await app.inject({ method: 'PUT', url: '/api/chats/profile', payload: { profile: 'no-está' } });
  assert.equal(bad.statusCode, 400);
  const away = await app.inject({ url: '/api/chats/profiles', remoteAddress: '192.168.1.20' });
  assert.equal(away.statusCode, 403);
  const created = await app.inject({ method: 'POST', url: '/api/chats', payload: { text: 'hola', profile: 'otro' } });
  assert.equal(JSON.parse(created.payload).profile, 'otro');
  // Después de un turno, el perfil trae el último uso de sus límites.
  for (let i = 0; i < 100 && !JSON.parse((await app.inject('/api/chats/profiles')).payload).profiles.find((p) => p.id === 'otro').limits; i++) await new Promise((r) => setTimeout(r, 20));
  const otro = JSON.parse((await app.inject('/api/chats/profiles')).payload).profiles.find((p) => p.id === 'otro');
  assert.equal(otro.limits.seven_day.used, 0.4);
  assert.match(otro.limits.at, /^\d{4}-/);
});
