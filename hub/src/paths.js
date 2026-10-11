// Rutas dentro del proyecto (19.2): lo que viene de config.json o de la API no puede leer ni escribir afuera, ni
// con ../, ni con una ruta absoluta, ni con las llaves de un glob ({..,x}), ni a través de un enlace simbólico.
import { realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

/**
 * La ruta relativa al proyecto, con "/", si es una ruta (o un patrón con *) que no puede salir de él; null si es
 * absoluta, tiene un segmento .., llaves, \ o un NUL. Es el mismo criterio que el pattern del schema de config.
 */
export function projectRel(raw) {
  const p = String(raw ?? '');
  if (!p || p.startsWith('/') || /^[a-zA-Z]:/.test(p) || /[\\{}\0]/.test(p) || /(^|\/)\.\.(\/|$)/.test(p)) return null;
  return p.replace(/^(\.\/)+/, '') || null;
}

// realpath del archivo o, si todavía no existe, de la carpeta existente más cercana.
async function realOrParent(abs) {
  for (let p = abs; ; p = dirname(p)) {
    const r = await realpath(p).catch(() => null);
    if (r !== null) return r + abs.slice(p.length);
    if (dirname(p) === p) return abs;
  }
}

/** true si abs, siguiendo los enlaces simbólicos, queda dentro del proyecto. */
export async function realInside(projectDir, abs) {
  const [root, real] = await Promise.all([realpath(projectDir).catch(() => resolve(projectDir)), realOrParent(resolve(abs))]);
  const rel = relative(root, real);
  return rel === '' || (!rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel));
}
