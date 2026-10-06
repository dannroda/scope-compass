// `npm test`: corre `node --test` con un registro, una config y una carpeta de datos propios, para no tocar
// los del usuario. Es un script de Node y no variables de sh en package.json para que ande igual en Windows.
// Los argumentos pasan tal cual: `npm test -- test/store.test.js`.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'scompass-test-'));
const env = { ...process.env, SCOMPASS_REGISTRY: join(dir, 'registry'), SCOMPASS_CONFIG: join(dir, 'config'), SCOMPASS_DATA: join(dir, 'data') };
const r = spawnSync(process.execPath, ['--test', ...process.argv.slice(2)], { stdio: 'inherit', env });
rmSync(dir, { recursive: true, force: true });
process.exit(r.status ?? 1);
