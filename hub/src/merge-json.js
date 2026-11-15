// Merge driver de git para compass/ (spec §44, D55): `scompass merge-json %O %A %B %P`. Junta a tres bandas campo por
// campo, y las listas por elemento, para que dos cambios a la misma tarea en campos distintos (aprobar una decisión en
// el teléfono mientras un agente tilda pasos) no den conflicto. Si los dos lados cambiaron lo mismo, o el resultado no
// pasa el schema, deja lo que deja git sin driver: el archivo con marcadores de conflicto, que el store marca inválido
// (§4.5). No necesita hub ni proyecto: git lo corre con archivos temporales.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { canonical } from './store/canonical.js';
import { COLLECTIONS } from './store/load.js';
import { loadValidators, parseDoc } from './schema.js';
import { selfCommand } from './self.js';
import { T } from './i18n.js';

const same = (x, y) => (x === undefined || y === undefined ? x === y : canonical(x) === canonical(y));
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Identidad de un elemento de una lista, para juntarlas por elemento: ítems de lista por fecha de creación,
// decisiones por fecha, refs por documento y sección, pasos e ítems por texto, vínculos e ítems de playtest por tarea,
// y los textos sueltos (etiquetas, archivos, capturas) por su valor.
function identity(el) {
  if (!isObj(el)) return 'v:' + JSON.stringify(el);
  if (typeof el.created_at === 'string') return 'c:' + el.created_at;
  if (typeof el.at === 'string') return 'a:' + el.at;
  if (typeof el.doc === 'string') return 'd:' + el.doc + '#' + (el.section ?? '');
  if (typeof el.text === 'string') return 't:' + el.text;
  if (typeof el.task === 'string') return 'k:' + el.task;
  return 'j:' + canonical(el);
}
// Lista → Map(clave → elemento) en orden; una clave repetida (dos pasos con el mismo texto) lleva su número de vez.
function keyed(list) {
  const seen = new Map();
  const out = new Map();
  for (const el of list) {
    const id = identity(el);
    const n = seen.get(id) ?? 0;
    seen.set(id, n + 1);
    out.set(n ? `${id}\u0000${n}` : id, el);
  }
  return out;
}

/**
 * Merge a tres bandas de valores JSON: base, nuestro y el de ellos. Devuelve { value, conflicts } con conflicts la
 * lista de rutas ("checklist[Primero].done") que los dos lados cambiaron distinto. undefined es "no está".
 */
export function merge3(base, ours, theirs, path = '') {
  const conflicts = [];
  const go = (o, a, b, at) => {
    if (same(a, b)) return a;
    if (same(a, o)) return b;
    if (same(b, o)) return a;
    if (isObj(a) && isObj(b) && (o === undefined || isObj(o))) {
      const out = {};
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
        const v = go(o?.[k], a[k], b[k], at ? `${at}.${k}` : k);
        if (v !== undefined) out[k] = v;
      }
      return out;
    }
    if (Array.isArray(a) && Array.isArray(b) && (o === undefined || Array.isArray(o))) return list(o ?? [], a, b, at);
    // Las fechas de cambio: la más nueva (ISO, así que se comparan como texto).
    if (/(^|\.)updated_at$/.test(at) && typeof a === 'string' && typeof b === 'string') return a > b ? a : b;
    conflicts.push(at || T('(raíz)'));
    return a;
  };
  const list = (o, a, b, at) => {
    const [ko, ka, kb] = [keyed(o), keyed(a), keyed(b)];
    // El orden: el del lado que lo cambió (ordenar las sesiones de playtest); si no, el nuestro. Lo que agregó el otro
    // lado va después del elemento que tenía antes.
    const common = (x, y) => [...x.keys()].filter((k) => y.has(k));
    const reordered = (side) => common(side, ko).join('\n') !== common(ko, side).join('\n');
    const [first, second] = !reordered(ka) && reordered(kb) ? [kb, ka] : [ka, kb];
    const order = [...first.keys()];
    const keys2 = [...second.keys()];
    keys2.forEach((k, i) => {
      if (order.includes(k)) return;
      // Agregado al final de su lado: al final. Si no, después del que tenía antes, y después de lo nuevo del otro lado
      // que ya esté ahí.
      if (keys2.slice(i + 1).every((x) => !ko.has(x))) { order.push(k); return; }
      const prev = keys2.slice(0, i).reverse().find((p) => order.includes(p));
      let at = prev === undefined ? 0 : order.indexOf(prev) + 1;
      while (at < order.length && !ko.has(order[at]) && !second.has(order[at])) at++;
      order.splice(at, 0, k);
    });
    const out = [];
    for (const k of order) {
      const label = k.replace(/^[a-z]:/, '').replace(/\u0000\d+$/, '');
      const v = go(ko.get(k), ka.get(k), kb.get(k), `${at}[${label}]`);
      if (v !== undefined) out.push(v);
    }
    return out;
  };
  const value = go(base, ours, theirs, path);
  return { value, conflicts };
}

// El tipo de documento por su ruta en el repo (%P): tasks/m1-04.json es una tarea; config.json, la config.
export function kindOfPath(path) {
  if (!path) return null;
  if (basename(path) === 'config.json') return 'config';
  return COLLECTIONS[basename(dirname(path))] ?? null;
}

/**
 * El driver: lee los tres archivos y escribe el resultado en `ours` (%A), como pide git. Devuelve { code, conflicts,
 * fallback }: code 0 si se juntó solo; si no, el de `git merge-file`, que deja los marcadores en `ours`.
 */
export function mergeFiles(baseFile, oursFile, theirsFile, path = '', { validators = loadValidators() } = {}) {
  const texts = [baseFile, oursFile, theirsFile].map((f) => readFileSync(f, 'utf8'));
  let parsed = null;
  try {
    // Un archivo agregado en los dos lados llega con la base vacía.
    parsed = texts.map((t, i) => (i === 0 && !t.trim() ? undefined : JSON.parse(t)));
  } catch {
    parsed = null;
  }
  let conflicts = [T('(no es JSON)')];
  if (parsed) {
    const r = merge3(...parsed);
    conflicts = r.conflicts;
    if (!conflicts.length) {
      const text = canonical(r.value);
      const kind = kindOfPath(path);
      const check = kind ? parseDoc(text, kind, validators) : { ok: true };
      if (check.ok) {
        writeFileSync(oursFile, text);
        return { code: 0, conflicts: [] };
      }
      conflicts = [`schema: ${check.message}`];
    }
  }
  // Lo mismo que git sin driver: merge por líneas con marcadores.
  const name = path || T('archivo');
  const r = spawnSync('git', ['merge-file', '-L', T`${name} (nuestro)`, '-L', T`${name} (base)`, '-L', T`${name} (de ellos)`, oursFile, baseFile, theirsFile], { encoding: 'utf8', windowsHide: true });
  // Aunque las líneas se junten solas, los dos lados cambiaron lo mismo (o no pasa el schema): conflicto igual.
  if (r.error || r.status < 0 || r.status > 127) return { code: 2, conflicts, fallback: true, error: r.error?.message ?? r.stderr };
  return { code: 1, conflicts, fallback: true };
}

const git = (cwd, args) => spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true });
// El comando del driver, con la ruta entera de este scompass (no hace falta el PATH) y barras / (git lo corre con sh,
// también en Windows).
export function driverCommand() {
  const [exe, args] = selfCommand(['merge-json']);
  return [exe, ...args].map((a) => (a === 'merge-json' ? a : `"${a.replace(/\\/g, '/')}"`)).join(' ') + ' %O %A %B %P';
}

/**
 * Registra el driver en el repo de git de compass/ (el de tableros si es un enlace, §36; el del proyecto si es una
 * carpeta suya): merge.scompass.name y .driver. Un driver de otro (sin merge-json) no se pisa; uno nuestro con otra
 * ruta se pone al día. Devuelve 'added', 'updated', 'ok', 'foreign' o 'no-git'.
 */
export function ensureMergeDriver(compass, command = driverCommand()) {
  if (git(compass, ['rev-parse', '--git-dir']).status !== 0) return 'no-git';
  const cur = git(compass, ['config', '--get', 'merge.scompass.driver']).stdout.trim();
  if (cur === command) return 'ok';
  if (cur && !/\bmerge-json\b/.test(cur)) return 'foreign';
  git(compass, ['config', 'merge.scompass.name', 'Scope Compass: merge de JSON por campo']);
  const r = git(compass, ['config', 'merge.scompass.driver', command]);
  if (r.status !== 0) throw new Error(`git config: ${r.stderr.trim()}`);
  return cur ? 'updated' : 'added';
}
