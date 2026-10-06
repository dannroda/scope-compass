// Los archivos que `init` copia de Scope Compass (schema/, la guía para agentes y .gitattributes) quedan viejos cuando Scope
// Compass cambia, por ejemplo con un campo nuevo en las tareas. updateCompass los vuelve a copiar; no toca los
// datos, config.json ni README.md. Lo usan `scompass update` y la bandeja del hub. De la guía hay una copia igual en
// addons/scope_compass/AGENTS.md (un test las compara).
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KINDS, SCHEMA_DIR } from './schema.js';

export const TEMPLATES = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');

const generated = () => [...KINDS.map((k) => [join(SCHEMA_DIR, `${k}.schema.json`), `schema/${k}.schema.json`]), [join(TEMPLATES, 'compass-AGENTS.md'), 'AGENTS.md'],
  [join(TEMPLATES, 'compass-gitattributes'), '.gitattributes']];
const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };

/** Rutas relativas a compass/ ("schema/task.schema.json", "AGENTS.md") que no coinciden con las de Scope Compass. */
export const outdatedFiles = (compass) => generated().filter(([src, rel]) => read(join(compass, rel)) !== read(src)).map(([, rel]) => rel);

/** Copia los desactualizados y devuelve sus rutas relativas a compass/. */
export function updateCompass(compass) {
  const stale = new Set(outdatedFiles(compass));
  mkdirSync(join(compass, 'schema'), { recursive: true });
  for (const [src, rel] of generated()) if (stale.has(rel)) copyFileSync(src, join(compass, rel));
  return [...stale];
}
