#!/usr/bin/env node
import { openSync, writeSync } from 'node:fs';
import { run } from '../src/cli.js';

// `scompass list | head`: si se cierra la salida, terminar sin error como cualquier herramienta de Unix.
process.stdout.on('error', (e) => { if (e.code === 'EPIPE') process.exit(0); throw e; });

// --log <archivo>: toda la salida se agrega a ese archivo, también un error que tire el proceso, como `>>log 2>&1`
// en sh. Lo usa el dock en Windows, donde no hay sh para redirigir (§18).
const at = process.argv.findIndex((a) => a === '--log' || a.startsWith('--log='));
const logFile = at < 0 ? null : process.argv[at].startsWith('--log=') ? process.argv[at].slice(6) : process.argv[at + 1];
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

process.exitCode = await run(process.argv.slice(2));
