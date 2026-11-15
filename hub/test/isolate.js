// Cada archivo de test lo importa primero: con `node --test test/x.test.js` (sin `npm test`) el registro de hubs,
// projects.json y la carpeta de datos son temporales, y un tablero de prueba no queda anotado en el Inicio del
// usuario. Con `npm test` ya vienen puestos (scripts/run-tests.js) y no se tocan.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Corridos desde Claude Code, los tests no son parte de su sesión: decide --ask la guardaría (§32).
delete process.env.CLAUDE_CODE_SESSION_ID;
delete process.env.SCOMPASS_CHAT_SESSION;
// Ningún test lanza el agy de verdad (gastaría la cuenta del usuario): sin SCOMPASS_AGY, uno que no existe. Los tests
// del chat con agy ponen el falso (fake-agy.js).
process.env.SCOMPASS_AGY ??= join(tmpdir(), 'scompass-no-agy', 'agy.js');

if (!process.env.SCOMPASS_CONFIG) {
  const dir = mkdtempSync(join(tmpdir(), 'scompass-test-'));
  process.env.SCOMPASS_REGISTRY ??= join(dir, 'registry');
  process.env.SCOMPASS_CONFIG = join(dir, 'config');
  process.env.SCOMPASS_DATA ??= join(dir, 'data');
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
}
