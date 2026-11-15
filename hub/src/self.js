// Cómo se relanza scompass a sí mismo (el hub que reinicia, el Inicio que prende un hub, init desde el Inicio, el
// MCP que le pasa el chat a claude). Desde el repo o el paquete de npm es node con bin/scompass.js; en el binario
// (Node SEA, tools/build.mjs), el ejecutable mismo, que no acepta un script como primer argumento.
import { isSea } from 'node:sea';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'scompass.js');
export const IS_BINARY = isSea();

/** [programa, argumentos] para correr `scompass <args>` con esta misma instalación. */
export const selfCommand = (args) => (IS_BINARY ? [process.execPath, args] : [process.execPath, [BIN, ...args]]);
