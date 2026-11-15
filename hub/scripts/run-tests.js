// `npm test`: corre `node --test` con un registro, una config y una carpeta de datos propios, para no tocar
// los del usuario. Es un script de Node y no variables de sh en package.json para que ande igual en Windows.
// Los argumentos pasan tal cual: `npm test -- test/store.test.js`.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'scompass-test-'));
// Los tests buscan los textos en castellano (el texto fuente, §45): el idioma va fijo, sea cual sea el del equipo.
const env = { ...process.env, SCOMPASS_LANG: 'es', SCOMPASS_REGISTRY: join(dir, 'registry'), SCOMPASS_CONFIG: join(dir, 'config'), SCOMPASS_DATA: join(dir, 'data') };
// Sin archivos, solo los *.test.js: `node --test` a secas corre todo lo que está en test/, también fake-claude.js
// (el claude de mentira, que sin argumentos falla) e isolate.js. La ruta entera, con /, para que ande desde cualquier
// carpeta y en Windows.
const TESTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'test').replace(/\\/g, '/') + '/*.test.js';
const files = process.argv.slice(2).some((a) => !a.startsWith('-')) ? [] : [TESTS];
const r = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...files], { stdio: 'inherit', env });
rmSync(dir, { recursive: true, force: true });
process.exit(r.status ?? 1);
