// Enlaces simbólicos en los tests. En Windows, crear uno pide el modo de desarrollador o ser admin (si no, EPERM; el
// runner de CI es admin y no se nota). Una carpeta se enlaza entonces con una junction, que no pide permisos y es lo
// que usa scompass para compass/ (§36); un archivo no tiene alternativa: link devuelve false y el test saltea esa parte.
import { stat, symlink } from 'node:fs/promises';

export const NO_FILE_LINKS = 'Windows sin permiso para enlaces simbólicos (activá el modo de desarrollador)';

export async function link(target, path) {
  try {
    await symlink(target, path);
    return true;
  } catch (e) {
    if (e.code !== 'EPERM' || process.platform !== 'win32') throw e;
  }
  if (!(await stat(target).catch(() => null))?.isDirectory()) return false;
  await symlink(target, path, 'junction');
  return true;
}
