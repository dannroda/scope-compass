// Escritura atómica (spec §5.3): archivo temporal en la misma carpeta + rename.
// Un corte a mitad de la escritura deja el archivo viejo intacto, nunca un JSON a medias.
import { open, rename, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { basename, dirname, join } from 'node:path';

// Empieza con punto y termina en .tmp: el watcher y los listados de *.json lo ignoran.
export const isTempFile = (name) => name.startsWith('.') && name.endsWith('.tmp');

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
    await rename(tmp, path);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}
