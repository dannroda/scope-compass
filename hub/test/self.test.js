// Encontrar scompass sin el PATH (§37): la instalación anota su ruta y `mcp install` la registra en Claude Code.
import './isolate.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { run } from '../src/cli.js';
import { BIN, recordSelf, selfFile } from '../src/self.js';

test('el binario y un paquete de npm anotan su ruta; un clon del repo no', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'scompass-self-'));
  try {
    const file = join(dir, 'sub', 'scompass.json');
    assert.equal(recordSelf({ binary: false, bin: BIN, file }), false, 'el repo no se anota');
    assert.equal(recordSelf({ binary: true, exec: '/opt/scompass', file }), true);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { command: '/opt/scompass', args: [] });
    assert.equal(recordSelf({ binary: true, exec: '/opt/scompass', file }), false, 'igual: no reescribe');
    const npm = ['', 'lib', 'node_modules', 'scope-compass', 'bin', 'scompass.js'].join(sep);
    assert.equal(recordSelf({ binary: false, bin: npm, exec: '/usr/bin/node', file }), true);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { command: '/usr/bin/node', args: [npm] });
    assert.equal(recordSelf({ binary: true, exec: '/x', file: join(dir, 'sub', 'scompass.json', 'no') }), false, 'un error no tira');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('selfFile está en la carpeta de datos', () => {
  assert.equal(selfFile(), join(process.env.SCOMPASS_DATA, 'scompass.json'));
});

async function cli(argv, env) {
  let out = '', err = '';
  const code = await run(argv, { cwd: tmpdir(), stdin: Readable.from(['']), env, out: { write: (s) => { out += s; } }, err: { write: (s) => { err += s; } } });
  return { code, out, err };
}

test('mcp install registra este scompass en Claude Code con la ruta entera', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'scompass-mcp-install-'));
  try {
    const log = join(dir, 'argv.json');
    const fake = join(dir, 'claude.js');
    await writeFile(fake, `require('node:fs').writeFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)));\n`);
    await writeFile(join(dir, 'package.json'), '{"type":"commonjs"}');
    const r = await cli(['mcp', 'install'], { ...process.env, SCOMPASS_CLAUDE: fake });
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(JSON.parse(await readFile(log, 'utf8')), ['mcp', 'add', '--scope', 'user', 'scompass', '--', process.execPath, BIN, 'mcp']);
    assert.match(r.out, /registrado/);

    const missing = await cli(['mcp', 'install'], { ...process.env, SCOMPASS_CLAUDE: join(dir, 'no-está') });
    assert.equal(missing.code, 1);
    assert.match(missing.err, /claude mcp add --scope user scompass -- .*scompass\.js mcp/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
