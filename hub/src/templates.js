// Plantillas de proyecto (spec §16.6, D25): hub/templates/proyectos/<nombre>.json con
// { description, config?, milestones?, lists?, files? }. Las usan `scompass init` y el Inicio.
// En inglés (§45), hub/templates/proyectos/en/<nombre>.json: los mismos nombres, con los textos y los ids en inglés.
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TEMPLATES } from './update.js';

const DIR = join(TEMPLATES, 'proyectos');
// Nombres en inglés que también se aceptan.
const ALIASES = { game: 'juego', empty: 'vacio' };

export async function listTemplates() {
  return (await readdir(DIR)).filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5)).sort();
}

/** La plantilla con su nombre, en ese idioma (en castellano si no está traducida), o null si no existe. */
export async function loadTemplate(name, lang = 'es') {
  name = ALIASES[name] ?? name;
  if (!(await listTemplates()).includes(name)) return null;
  const en = join(DIR, 'en', `${name}.json`);
  const file = lang === 'en' && existsSync(en) ? en : join(DIR, `${name}.json`);
  return { name, ...JSON.parse(await readFile(file, 'utf8')) };
}
