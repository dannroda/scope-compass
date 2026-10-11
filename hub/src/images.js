// Capturas de las tareas (18.4, D38): rutas del repo a imágenes, en el campo images. Las que se pegan o se suben
// desde la web (o se agregan desde fuera del proyecto con la CLI) se guardan en compass/images/: es la única
// escritura de archivos de la app fuera de los JSON, y solo de imágenes verificadas por su contenido.
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';
import { writeAtomic } from './store/atomic.js';
import { StoreError } from './store/json-files.js';

export const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
export const IMAGES_DIR = 'compass/images';
export const MAX_IMAGE = 10 << 20;

export const isImagePath = (p) => IMAGE_EXT.includes(extname(String(p)).toLowerCase());

// La extensión según los primeros bytes; null si no es PNG, JPEG, GIF ni WebP.
export function imageKind(buf) {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg';
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.subarray(0, 6).toString('latin1'))) return '.gif';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return '.webp';
  return null;
}

// <tarea>-<AAAAMMDD-HHMMSS>[-n].<ext>, en hora local: se lee en el árbol de Archivos y no choca con otra del mismo segundo.
async function freeName(projectDir, taskId, ext, now) {
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  for (let i = 1; ; i++) {
    const rel = `${IMAGES_DIR}/${taskId}-${stamp}${i > 1 ? '-' + i : ''}${ext}`;
    if (!(await stat(join(projectDir, rel)).catch(() => null))) return rel;
  }
}

/** Guarda una imagen (Buffer) para la tarea en compass/images/ y devuelve su ruta desde la raíz del proyecto. */
export async function saveImage(projectDir, taskId, buf, now = new Date()) {
  if (buf.length > MAX_IMAGE) throw new StoreError('invalid_argument', `la imagen pesa más de ${MAX_IMAGE >> 20} MB`);
  const ext = imageKind(buf);
  if (!ext) throw new StoreError('invalid_argument', 'no es una imagen PNG, JPEG, GIF ni WebP');
  await mkdir(join(projectDir, IMAGES_DIR), { recursive: true });
  const rel = await freeName(projectDir, taskId, ext, now);
  await writeAtomic(join(projectDir, rel), buf);
  return rel;
}

/** Copia a compass/images/ una imagen de fuera del proyecto (scompass image add con una ruta de afuera). */
export async function importImage(projectDir, taskId, absPath, now = new Date()) {
  const buf = await readFile(absPath).catch((e) => { throw new StoreError('not_found', `${absPath}: ${e.code === 'ENOENT' ? 'no existe' : e.message}`); });
  return saveImage(projectDir, taskId, buf, now);
}

/** La ruta desde la raíz del proyecto si abs está adentro; null si está afuera. */
export function insideProject(projectDir, abs) {
  const rel = relative(resolve(projectDir), resolve(abs));
  return rel && !rel.startsWith('..') && !rel.startsWith(sep) && !/^[a-zA-Z]:/.test(rel) ? rel.split(sep).join('/') : null;
}

/**
 * Al quitar una captura de una tarea: si la guardó la app (está en compass/images/) y ninguna otra tarea la cita, se
 * borra el archivo, para que las pegadas no se acumulen. Una imagen del repo citada a mano nunca se borra.
 */
export async function dropImage(projectDir, path, tasks) {
  if (!path.startsWith(IMAGES_DIR + '/') || path.includes('..')) return false;
  if (tasks.some((t) => (t.images ?? []).includes(path))) return false;
  await rm(join(projectDir, path), { force: true });
  return true;
}
