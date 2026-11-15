// Lo que hace bin/scompass.js, como función: el binario (sea/main.cjs) lo carga con require(), que no admite un
// await en el nivel superior del módulo.
import { openSync, writeSync } from 'node:fs';
import { run } from './cli.js';
import { recordSelf } from './self.js';

/** Corre scompass con estos argumentos y devuelve el código de salida. */
export async function main(argv) {
  // `scompass list | head`: si se cierra la salida, terminar sin error como cualquier herramienta de Unix.
  process.stdout.on('error', (e) => { if (e.code === 'EPIPE') process.exit(0); throw e; });

  // --log <archivo>: toda la salida se agrega a ese archivo, también un error que tire el proceso, como `>>log 2>&1`
  // en sh. Lo usa el dock en Windows, donde no hay sh para redirigir (§18).
  const at = argv.findIndex((a) => a === '--log' || a.startsWith('--log='));
  const logFile = at < 0 ? null : argv[at].startsWith('--log=') ? argv[at].slice(6) : argv[at + 1];
  if (logFile) {
    const fd = openSync(logFile, 'a');
    const write = (chunk, enc, cb) => {
      writeSync(fd, typeof chunk === 'string' ? chunk : Buffer.from(chunk));
      (typeof enc === 'function' ? enc : cb)?.();
      return true;
    };
    process.stdout.write = write;
    process.stderr.write = write;
    const die = (e) => { writeSync(fd, `${e?.stack ?? e}\n`); process.exit(1); };
    process.on('uncaughtException', die);
    process.on('unhandledRejection', die);
  }

  // El addon y `mcp install` encuentran esta instalación sin el PATH (§37).
  recordSelf();
  return run(argv);
}
