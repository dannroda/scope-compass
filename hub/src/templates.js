// Plantillas de proyecto (spec §16.6, D25): hub/templates/proyectos/<nombre>.json con
// { description, config?, milestones?, lists?, files? }. Las usan `scompass init` y el Inicio.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TEMPLATES } from './update.js';

const DIR = join(TEMPLATES, 'proyectos');

export async function listTemplates() {
  return (await readdir(DIR)).filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5)).sort();
}

/** La plantilla con su nombre, o null si no existe. */
export async function loadTemplate(name) {
  if (!(await listTemplates()).includes(name)) return null;
  return { name, ...JSON.parse(await readFile(join(DIR, `${name}.json`), 'utf8')) };
}
