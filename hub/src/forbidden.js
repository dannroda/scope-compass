// Patrones prohibidos (spec §42, m30-01): config.json › forbidden, expresiones regulares que ningún texto de
// compass/ puede tener. El store rechaza la escritura que tiene una coincidencia (lo que entra a git queda en el
// historial, así que no alcanza con avisar) y `scompass lint` las busca en archivos editados a mano.

import { T } from './i18n.js';

/**
 * Los patrones de la config, compilados: { patterns: [{ source, re, note }], errors: [{ index, source, message }] }.
 * Una entrada es el patrón como texto o { pattern, ignore_case, note }.
 */
export function compileForbidden(config) {
  const patterns = [];
  const errors = [];
  (config?.forbidden ?? []).forEach((entry, index) => {
    const source = typeof entry === 'string' ? entry : entry?.pattern;
    try {
      patterns.push({ source, re: new RegExp(source, entry?.ignore_case ? 'gi' : 'g'), note: entry?.note ?? '' });
    } catch (e) {
      errors.push({ index, source, message: e.message });
    }
  });
  return { patterns, errors };
}

// Las coincidencias de los patrones en un texto: [{ pattern, note, match, index }].
export function matchText(text, patterns) {
  const out = [];
  for (const p of patterns) {
    p.re.lastIndex = 0;
    for (const m of String(text).matchAll(p.re)) {
      if (m[0] === '') continue;
      out.push({ pattern: p.source, note: p.note, match: m[0], index: m.index });
    }
  }
  return out;
}

/**
 * Las coincidencias en todos los textos de un documento JSON, con dónde: [{ where, pattern, note, match }]. where es el
 * camino al campo ("notes", "checklist[2].text").
 */
export function findForbidden(value, patterns, where = '') {
  if (!patterns.length) return [];
  if (typeof value === 'string') return matchText(value, patterns).map(({ index, ...m }) => ({ where: where || '(texto)', ...m }));
  if (Array.isArray(value)) return value.flatMap((v, i) => findForbidden(v, patterns, `${where}[${i}]`));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => findForbidden(v, patterns, where ? `${where}.${k}` : k));
  return [];
}

/** Una línea por coincidencia: «compass/tasks/m1-04.json › notes: «X» coincide con el patrón /…/ (nota)». */
export const describeMatch = (file, m) => T`${file}${m.where ? ` › ${m.where}` : ''}${m.line ? `:${m.line}` : ''}: «${m.match}» coincide con el patrón prohibido /${m.pattern}/${m.note ? ` (${m.note})` : ''}`;
