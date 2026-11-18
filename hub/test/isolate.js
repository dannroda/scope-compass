// Cada archivo de test lo importa primero: el registro de hubs, la config (projects.json, settings.json) y la carpeta
// de datos son temporales y de ese archivo, y un tablero de prueba no queda anotado en el Inicio del usuario. Son de
// cada archivo también con `npm test`, que corre cada uno en su proceso y a la vez: compartiendo los de
// scripts/run-tests.js, un test que elegía el agente del chat en settings.json (§47) le cambiaba lo que veía otro.
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// En Windows la carpeta temporal puede venir con nombres cortos (C:\Users\RUNNER~1) y el hub guarda las rutas reales,
// largas: los tests arman sus rutas con la misma forma.
if (process.platform === 'win32') process.env.TEMP = process.env.TMP = realpathSync.native(tmpdir());

// Corridos desde Claude Code, los tests no son parte de su sesión: decide --ask la guardaría (§32).
delete process.env.CLAUDE_CODE_SESSION_ID;
delete process.env.SCOMPASS_CHAT_SESSION;
// Ningún test lanza el agy de verdad (gastaría la cuenta del usuario): sin SCOMPASS_AGY, uno que no existe. Los tests
// del chat con agy ponen el falso (fake-agy.js).
process.env.SCOMPASS_AGY ??= join(tmpdir(), 'scompass-no-agy', 'agy.js');

const dir = mkdtempSync(join(tmpdir(), 'scompass-test-'));
process.env.SCOMPASS_REGISTRY = join(dir, 'registry');
process.env.SCOMPASS_CONFIG = join(dir, 'config');
process.env.SCOMPASS_DATA = join(dir, 'data');
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
