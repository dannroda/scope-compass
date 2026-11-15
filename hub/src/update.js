// Los archivos que `init` copia de Scope Compass (schema/, la guía para agentes y .gitattributes) quedan viejos cuando Scope
// Compass cambia, por ejemplo con un campo nuevo en las tareas. updateCompass los vuelve a copiar; no toca los
// datos, config.json ni README.md. Lo usan `scompass update` y la bandeja del hub. De la guía hay una copia igual en
// addons/scope_compass/AGENTS.md (un test las compara), y en inglés en compass-AGENTS.en.md y AGENTS.en.md.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KINDS, SCHEMA_DIR } from './schema.js';
import { ensureMergeDriver } from './merge-json.js';

export const TEMPLATES = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');

const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };
// El idioma del tablero (config.json › language, §45): la guía va en ese idioma. Sin él, castellano.
const boardLang = (compass) => { try { return JSON.parse(read(join(compass, 'config.json'))).language === 'en' ? 'en' : 'es'; } catch { return 'es'; } };
const generated = (compass) => [...KINDS.map((k) => [join(SCHEMA_DIR, `${k}.schema.json`), `schema/${k}.schema.json`]),
  [join(TEMPLATES, boardLang(compass) === 'en' ? 'compass-AGENTS.en.md' : 'compass-AGENTS.md'), 'AGENTS.md'],
  [join(TEMPLATES, 'compass-gitattributes'), '.gitattributes']];

/** Rutas relativas a compass/ ("schema/task.schema.json", "AGENTS.md") que no coinciden con las de Scope Compass. */
export const outdatedFiles = (compass) => generated(compass).filter(([src, rel]) => read(join(compass, rel)) !== read(src)).map(([, rel]) => rel);

/** Copia los desactualizados y devuelve sus rutas relativas a compass/. */
export function updateCompass(compass) {
  const stale = new Set(outdatedFiles(compass));
  mkdirSync(join(compass, 'schema'), { recursive: true });
  for (const [src, rel] of generated(compass)) if (stale.has(rel)) copyFileSync(src, join(compass, rel));
  // El merge driver (§44) en el repo del tablero: lo que .gitattributes nombra tiene que existir en .git/config.
  try { ensureMergeDriver(compass); } catch { /* sin git o sin permiso: el merge de git sigue como siempre */ }
  return [...stale];
}

/**
 * Pone al día el compass/ de cada proyecto encontrado que lo tenga desactualizado (§38). Con check, solo dice cuáles.
 * Devuelve [{ path, name, files }] con las rutas como compass/<archivo>, solo los que tenían algo viejo.
 */
export function updateAllCompasses(projects, { check = false } = {}) {
  const out = [];
  for (const p of projects) {
    if (!p.found) continue;
    const compass = join(p.path, 'compass');
    if (!existsSync(join(compass, 'config.json'))) continue;
    const files = check ? outdatedFiles(compass) : updateCompass(compass);
    if (files.length) out.push({ path: p.path, name: p.name, files: files.map((f) => 'compass/' + f) });
  }
  return out;
}
