#!/usr/bin/env node
import { run } from '../src/cli.js';

// `scompass list | head`: si se cierra la salida, terminar sin error como cualquier herramienta de Unix.
process.stdout.on('error', (e) => { if (e.code === 'EPIPE') process.exit(0); throw e; });

process.exitCode = await run(process.argv.slice(2));
