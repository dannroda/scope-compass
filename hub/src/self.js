// Cómo se relanza scompass a sí mismo (el hub que reinicia, el Inicio que prende un hub, init desde el Inicio, el
// MCP que le pasa el chat a claude). Desde el repo o el paquete de npm es node con bin/scompass.js; en el binario
// (Node SEA, tools/build.mjs), el ejecutable mismo, que no acepta un script como primer argumento.
import { isSea } from 'node:sea';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectsDataDir } from './projects.js';

export const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'scompass.js');
export const IS_BINARY = isSea();

/** [programa, argumentos] para correr `scompass <args>` con esta misma instalación. */
export const selfCommand = (args) => (IS_BINARY ? [process.execPath, args] : [process.execPath, [BIN, ...args]]);

/**
 * La salida del proceso que se relanza (restart del hub y del Inicio): la misma que la de este, salvo en Windows con
 * una consola propia (doble clic, el acceso directo del menú Inicio): esa consola se cierra con este proceso y el nuevo,
 * que la heredaba, moría al escribir en ella. Ahí, sin salida: se maneja desde la bandeja y la web.
 */
export const relaunchStdio = () => (process.platform === 'win32' && (process.stdout.isTTY || process.stderr.isTTY) ? 'ignore' : 'inherit');

/** Dónde anota scompass su propia ruta (§37): <datos>/scompass.json. */
export const selfFile = () => join(projectsDataDir(), 'scompass.json');

/**
 * Anota en selfFile() cómo lanzar esta instalación, para que el addon de Godot y `scompass mcp install` la encuentren
 * sin que scompass esté en el PATH (§37, D48). Solo el binario y un paquete de npm instalado: un clon del repo (y los
 * tests) no pisan la instalación del usuario. Escribe solo si cambió y nunca falla.
 */
export function recordSelf({ binary = IS_BINARY, bin = BIN, exec = process.execPath, file = selfFile() } = {}) {
  if (!binary && !bin.includes(`${sep}node_modules${sep}`)) return false;
  const text = `${JSON.stringify(binary ? { command: exec, args: [] } : { command: exec, args: [bin] }, null, 2)}\n`;
  try {
    if (readFileSync(file, 'utf8') === text) return false;
  } catch { /* no estaba */ }
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
    return true;
  } catch {
    return false;
  }
}
