// Escritura atómica (spec §5.3): archivo temporal en la misma carpeta + rename.
// Un corte a mitad de la escritura deja el archivo viejo intacto, nunca un JSON a medias.
import { open, rename as fsRename, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { basename, dirname, join } from 'node:path';

// Empieza con punto y termina en .tmp: el watcher y los listados de *.json lo ignoran.
export const isTempFile = (name) => name.startsWith('.') && name.endsWith('.tmp');

// En Windows, rename sobre un archivo que otro proceso tiene abierto sin compartir (el antivirus, el indexador,
// un editor) falla con EPERM, EBUSY o EACCES hasta que lo suelta: se reintenta unas veces, con esperas que crecen
// (hasta ~1 s en total). En Linux esos errores son de permisos de verdad y se informan enseguida (§18).
const BUSY = new Set(['EPERM', 'EBUSY', 'EACCES']);
export async function renameRetrying(from, to, { rename = fsRename, retry = process.platform === 'win32', tries = 10 } = {}) {
  for (let i = 1; ; i++) {
    try { return await rename(from, to); } catch (e) {
      if (!retry || !BUSY.has(e.code) || i >= tries) throw e;
      await new Promise((r) => setTimeout(r, 20 * i));
    }
  }
}

export async function writeAtomic(path, text) {
  const tmp = join(dirname(path), `.${basename(path)}.${randomBytes(4).toString('hex')}.tmp`);
  const fh = await open(tmp, 'wx');
  try {
    await fh.writeFile(text, 'utf8');
    await fh.sync();
  } catch (e) {
    await fh.close();
    await rm(tmp, { force: true });
    throw e;
  }
  await fh.close();
  try {
    await renameRetrying(tmp, path);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}
