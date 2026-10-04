// Validación de los documentos de compass/ (spec §4.3, D14): JSON Schema de ../schema con ajv.
// parseDoc nunca lanza: devuelve el documento o un error con código, para avisar sin tirar el servidor.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const HUB_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
// schema/ y web/ viven en la raíz del repo, al lado de hub/. En el paquete instalable (tools/build.mjs) van
// adentro del paquete: se usa esa copia si está.
export const resourceDir = (name) => (existsSync(join(HUB_DIR, name)) ? join(HUB_DIR, name) : join(HUB_DIR, '..', name));
export const SCHEMA_DIR = resourceDir('schema');
export const KINDS = ['config', 'milestone', 'task', 'list'];

export function loadValidators(dir = SCHEMA_DIR) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return Object.fromEntries(KINDS.map((kind) =>
    [kind, ajv.compile(JSON.parse(readFileSync(join(dir, `${kind}.schema.json`), 'utf8')))]));
}

// Una línea que empieza con un marcador de git: el archivo quedó a medio mergear.
const CONFLICT = /^(<{7}|={7}|>{7})( |$)/m;

export function parseDoc(text, kind, validators) {
  if (CONFLICT.test(text)) {
    return { ok: false, code: 'conflict_markers', message: 'marcadores de conflicto de git' };
  }
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    return { ok: false, code: 'invalid_json', message: `JSON inválido: ${e.message}` };
  }
  const validate = validators[kind];
  if (!validate(doc)) {
    const details = validate.errors.map((e) => `${e.instancePath || '(raíz)'}: ${e.message}` +
      (e.params.additionalProperty ? ` (${e.params.additionalProperty})` : '') +
      (e.params.allowedValues ? ` (${e.params.allowedValues.join(', ')})` : ''));
    return { ok: false, code: 'invalid_schema', message: details.join('; '), details };
  }
  return { ok: true, doc };
}
