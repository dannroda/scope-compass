// Historial de una tarea desde git (18.5): los commits que tocaron compass/tasks/<id>.json y, en cada uno, qué
// campos cambiaron, en texto (la CLI y la web muestran lo mismo). Arriba, lo que hay sin commitear. Solo lectura.
import { execFile, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decisionLabel } from './decisions.js';
import { T } from './i18n.js';

// En el idioma del pedido (§45): se arman al usarlos, no al cargar el módulo.
const STATUS = () => ({ todo: T('Pendiente'), paused: T('Pausado'), doing: T('En curso'), review: T('Revisión'), done: T('Hecho') });
const PRIORITY = () => ({ high: T('alta'), medium: T('media'), low: T('baja') });
const LABEL = () => ({ title: T('Título'), status: T('Estado'), milestone: T('Hito'), code: T('Código'), due: T('Vence'), priority: T('Prioridad'), size: T('Tamaño'),
  assignee: T('Responsable'), description: T('Descripción'), notes: T('Notas'), test: T('Cómo probarlo'), checklist: T('Pasos'), tags: T('Etiquetas'),
  refs: T('Referencias'), files: T('Archivos'), images: T('Capturas'), links: T('Vínculos'), playtest: T('Playtest'), decisions: T('Decisiones') });
const RESULT = () => ({ pass: T('anda'), fail: T('falla') });
// Lo que cambia solo, o que ya cuenta otro campo: no es historia.
const SKIP = new Set(['updated_at', 'created_at', 'done_at', 'order']);
// Textos largos: solo si se agregaron, se quitaron o se editaron (con la concordancia de cada uno).
const TEXTS = () => ({ description: [T('agregada'), T('quitada'), T('editada')], notes: [T('agregadas'), T('quitadas'), T('editadas')], test: [T('agregado'), T('quitado'), T('editado')] });

const git = (dir, args) => new Promise((done) => {
  execFile('git', ['-C', dir, ...args], { timeout: 5000, windowsHide: true, maxBuffer: 32 << 20 }, (err, out) => done(err ? null : out));
});

// Contenido de varios "<rev>:<ruta>" en un solo proceso (git cat-file --batch). null el que no existe.
function catFiles(dir, specs) {
  if (!specs.length) return Promise.resolve([]);
  return new Promise((done) => {
    const p = spawn('git', ['-C', dir, 'cat-file', '--batch'], { windowsHide: true });
    const chunks = [];
    p.stdout.on('data', (c) => chunks.push(c));
    p.on('error', () => done(specs.map(() => null)));
    p.on('close', () => {
      const buf = Buffer.concat(chunks);
      const out = [];
      let at = 0;
      for (let i = 0; i < specs.length; i++) {
        const nl = buf.indexOf(10, at);
        if (nl < 0) { out.push(null); continue; }
        const head = buf.subarray(at, nl).toString('utf8');
        const m = / blob (\d+)$/.exec(head);
        if (!m) { out.push(null); at = nl + 1; continue; }
        const size = Number(m[1]);
        out.push(buf.subarray(nl + 1, nl + 1 + size).toString('utf8'));
        at = nl + 1 + size + 1;
      }
      done(out);
    });
    p.stdin.end(specs.join('\n') + '\n');
  });
}

const parse = (text) => { try { return text === null ? null : JSON.parse(text); } catch { return undefined; } };
const show = (field, v) => (v === undefined || v === null || v === '' ? '—'
  : field === 'status' ? STATUS()[v] ?? v : field === 'priority' ? PRIORITY()[v] ?? v : field === 'size' ? String(v).toUpperCase()
    : field === 'due' ? String(v).replace('T', ' ') : field === 'title' ? `«${v}»` : String(v));
const key = (field, x) => (field === 'refs' ? (x.section ? `${x.doc}#${x.section}` : x.doc) : field === 'links' ? `${x.type === 'blocks' ? T('bloquea a') : T('relacionada con')} ${x.task}` : String(x));
const quote = (s) => `«${String(s).length > 60 ? String(s).slice(0, 57) + '…' : s}»`;

// Pasos: agregados, quitados, tildados y destildados (por texto); lo demás, "editados".
function checklistChange(a = [], b = []) {
  const texts = (l) => l.map((c) => c.text);
  const before = new Map(a.map((c) => [c.text, c])), after = new Map(b.map((c) => [c.text, c]));
  const parts = [];
  for (const c of b) if (!before.has(c.text)) parts.push('+' + quote(c.text));
  for (const c of a) if (!after.has(c.text)) parts.push('−' + quote(c.text));
  for (const c of b) {
    const o = before.get(c.text);
    if (o && !o.done && c.done) parts.push(T`tildado ${quote(c.text)}`);
    if (o && o.done && !c.done) parts.push(T`destildado ${quote(c.text)}`);
  }
  if (!parts.length && JSON.stringify(a) !== JSON.stringify(b)) parts.push(JSON.stringify(texts(a)) === JSON.stringify(texts(b)) ? T('detalle editado') : T('reordenados'));
  return parts.join(', ');
}

// Decisiones (§31): agregadas, quitadas y cambios de estado, por cuándo se registraron y su texto.
function decisionsChange(a = [], b = []) {
  const id = (d) => `${d.at}|${d.text}`;
  const before = new Map(a.map((d) => [id(d), d])), after = new Map(b.map((d) => [id(d), d]));
  const parts = [];
  for (const d of b) if (!before.has(id(d))) parts.push('+' + quote(d.text));
  for (const d of a) if (!after.has(id(d))) parts.push('−' + quote(d.text));
  for (const d of b) {
    const o = before.get(id(d));
    if (o && decisionLabel(o) !== decisionLabel(d)) parts.push(`${quote(d.text)} ${decisionLabel(o)} → ${decisionLabel(d)}`);
    if (o && o.promoted !== d.promoted && d.promoted) parts.push(`${quote(d.text)} → ${d.promoted}`);
  }
  return parts.join(', ') || T('editadas');
}

/** Los cambios entre dos versiones de la tarea, como líneas de texto ("Estado: Pendiente → En curso"). */
export function taskChanges(a, b) {
  const out = [];
  const labels = LABEL(), texts = TEXTS(), result = RESULT();
  for (const field of [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])]) {
    if (SKIP.has(field)) continue;
    const x = a?.[field], y = b?.[field];
    if (JSON.stringify(x) === JSON.stringify(y)) continue;
    const label = labels[field] ?? field;
    if (texts[field]) out.push(`${label}: ${texts[field][!x ? 0 : !y ? 1 : 2]}`);
    else if (field === 'checklist') out.push(`${label}: ${checklistChange(x, y)}`);
    else if (field === 'decisions') out.push(`${label}: ${decisionsChange(x, y)}`);
    else if (field === 'playtest') {
      // Resultado (sin probar, anda, falla) y la nota, como los textos largos.
      const parts = [];
      if (x?.result !== y?.result) parts.push(`${result[x?.result] ?? T('sin probar')} → ${result[y?.result] ?? T('sin probar')}`);
      if (x?.note !== y?.note) parts.push(!x?.note ? T('nota agregada') : !y?.note ? T('nota quitada') : T('nota editada'));
      out.push(`${label}: ${parts.join(', ')}`);
    }
    else if (Array.isArray(x) || Array.isArray(y)) {
      const kx = (x ?? []).map((v) => key(field, v)), ky = (y ?? []).map((v) => key(field, v));
      const parts = [...ky.filter((v) => !kx.includes(v)).map((v) => '+' + v), ...kx.filter((v) => !ky.includes(v)).map((v) => '−' + v)];
      out.push(`${label}: ${parts.join(' ') || T('reordenados')}`);
    } else out.push(`${label}: ${show(field, x)} → ${show(field, y)}`);
  }
  return out;
}

/**
 * { repo, entries: [{ hash, date, author, subject, created?, changes: [] }] }, del más nuevo al más viejo. La primera
 * entrada, con hash null, es lo que hay sin commitear (si cambió algo visible). Sin repo: { repo: false, entries: [] }.
 */
export async function taskHistory(projectDir, id, { limit = 30 } = {}) {
  // El git del tablero (m32-10): desde compass/ sirve igual si es una carpeta del proyecto, un enlace a un tablero
  // con su propio repo o un submódulo.
  const board = join(projectDir, 'compass');
  const path = `tasks/${id}.json`;
  const log = await git(board, ['log', `-n${limit}`, '--format=%H%x1f%h%x1f%aI%x1f%an%x1f%s%x1e', '--', path]);
  if (log === null) return { repo: false, entries: [] };
  const commits = log.split('\x1e').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [full, hash, date, author, subject] = l.split('\x1f');
    return { full, hash, date, author, subject };
  });
  // "<rev>:./<ruta>" es relativo a compass/, aunque esté dentro de un repo más grande (19.3).
  const blobs = await catFiles(board, commits.flatMap((c) => [`${c.full}:./${path}`, `${c.full}~1:./${path}`]));
  // Un commit que no cambió nada visible (solo order o los sellos de fecha) no se lista.
  const entries = commits.map(({ full, ...c }, i) => {
    const [now, before] = [parse(blobs[2 * i]), parse(blobs[2 * i + 1])];
    if (now === null) return { ...c, deleted: true, changes: [] };
    if (before === null) return { ...c, created: true, changes: [] };
    return { ...c, changes: now === undefined || before === undefined ? [T('(JSON inválido en este commit)')] : taskChanges(before, now) };
  }).filter((e) => e.created || e.deleted || e.changes.length);
  // Sin commitear: el disco contra HEAD.
  const disk = parse(await readFile(join(board, path), 'utf8').catch(() => null));
  const head = commits.length ? parse(blobs[0]) : null;
  const pending = disk && JSON.stringify(disk) !== JSON.stringify(head) ? (head ? taskChanges(head, disk) : []) : null;
  if (pending && (pending.length || !head)) entries.unshift({ hash: null, date: disk.updated_at ?? null, author: null, subject: T('Sin commitear'), ...(head ? {} : { created: true }), changes: pending });
  return { repo: true, entries };
}
