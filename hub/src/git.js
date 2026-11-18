// Cambios sin commitear en el tablero (4.4): `git status` de compass/ y del export markdown. La app nunca
// commitea en local (spec §4.5); esto solo lo recuerda. Sin git o fuera de un repo: { repo: false }.
import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

// --no-optional-locks: `git status` refresca el índice y para eso toma index.lock. El hub lo corre cada pocos segundos
// (gitPollMs), y con el lock tomado un `git commit` del usuario en ese momento fallaba con «index.lock exists».
const GIT = ['--no-optional-locks'];

const status = (dir, paths) => new Promise((done) => {
  execFile('git', [...GIT, '-C', dir, 'status', '--porcelain', '--untracked-files=all', '--', ...paths], { timeout: 5000, windowsHide: true }, (err, stdout) => {
    done(err ? null : stdout.split('\n').filter(Boolean).map((l) => l.slice(3).replace(/^"|"$/g, '')));
  });
});

/**
 * { repo, uncommitted, files } con las rutas relativas al proyecto ("compass/tasks/…"). El git es el del tablero
 * (git -C compass): el del proyecto si compass/ es una carpeta suya, o el propio si es un enlace o un submódulo
 * (m32-10). El export markdown fuera de compass/ se mira en el git del proyecto.
 */
export async function boardStatus(projectDir, config) {
  const compass = join(projectDir, 'compass');
  const extra = [];
  if (config?.export_md) {
    const rel = relative(projectDir, resolve(projectDir, config.export_md));
    if (rel && !rel.startsWith('..') && !rel.split(sep).join('/').startsWith('compass/')) extra.push(rel);
  }
  // porcelain da las rutas desde la raíz del repo: se les saca el prefijo de compass/ dentro de él.
  const [board, prefix, other] = await Promise.all([status(compass, ['.']), git(compass, ['rev-parse', '--show-prefix']), extra.length ? status(projectDir, extra) : null]);
  const p = (prefix ?? '').trim();
  const files = [...(board ?? []).map((f) => 'compass/' + (f.startsWith(p) ? f.slice(p.length) : f)), ...(other ?? [])];
  return board === null && other === null ? { repo: false, uncommitted: 0, files: [] } : { repo: true, uncommitted: files.length, files };
}

// Estado de git de los documentos (12.3). Solo lectura, como todo lo de acá. `git` falla (sin git, fuera de un repo,
// repo sin commits) → null.
const git = (projectDir, args) => new Promise((done) => {
  execFile('git', [...GIT, '-C', projectDir, ...args], { timeout: 5000, windowsHide: true, maxBuffer: 32 << 20 }, (err, stdout) => done(err ? null : stdout));
});

// Primera letra del par XY de `git status --porcelain` que cuenta, en el orden en que se informa.
const STATE = (xy) => (xy === '??' ? 'untracked' : xy.includes('D') ? 'deleted' : xy[0] === 'A' ? 'added' : xy.includes('R') ? 'renamed' : 'modified');

/**
 * Cambios sin commitear de todo el proyecto: { repo, status: { <ruta>: 'modified'|'added'|'untracked'|'deleted'|
 * 'renamed' } }, con rutas relativas al proyecto ("/"). Lo que no cambió no aparece. Sin repo: { repo: false }.
 */
export async function docsStatus(projectDir) {
  const prefix = await git(projectDir, ['rev-parse', '--show-prefix']);
  if (prefix === null) return { repo: false, status: {} };
  // Con -z las rutas van sin comillas; un renombre trae después la ruta vieja, que se saltea.
  const out = (await git(projectDir, ['status', '--porcelain', '-z', '--untracked-files=all', '--', '.'])) ?? '';
  const parts = out.split('\0');
  const status = {};
  const p = prefix.trim();
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (e.length < 4) continue;
    const xy = e.slice(0, 2);
    // Las rutas de porcelain son desde la raíz del repo, aunque el proyecto sea una subcarpeta.
    const path = e.slice(3);
    if (path.startsWith(p)) status[path.slice(p.length)] = STATE(xy);
    if (xy[0] === 'R' || xy[0] === 'C') i++;
  }
  return { repo: true, status };
}

/**
 * Commits que tocaron el archivo, del más nuevo al más viejo, siguiendo renombres: [{ hash, date, author, subject }].
 * Con follow: false, los de una carpeta ('.': todo el proyecto, 14.1).
 */
export async function docLog(projectDir, path, { limit = 20, follow = true } = {}) {
  const out = await git(projectDir, ['log', ...(follow ? ['--follow'] : []), `-n${limit}`, '--format=%h%x1f%aI%x1f%an%x1f%s%x1e', '--', path]);
  return (out ?? '').split('\x1e').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [hash, date, author, subject] = l.split('\x1f');
    return { hash, date, author, subject };
  });
}

/**
 * Diff unificado del archivo contra HEAD (lo commiteado contra lo que hay en disco). Un archivo nuevo sin seguir no
 * está en el diff de git: se arma entero como agregado. Sin cambios, ''.
 */
export async function docDiff(projectDir, path, { untracked = false, text = '' } = {}) {
  if (!untracked) {
    const d = await git(projectDir, ['diff', '--no-color', '--no-ext-diff', 'HEAD', '--', path]);
    if (d !== null) return d;
  }
  const lines = text.replace(/\n$/, '').split('\n');
  return text ? `--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => '+' + l).join('\n')}\n` : '';
}

// Archivos del repo (14.1). Lo que git no ignora: los seguidos (también los borrados del disco sin commitear) y los
// nuevos. Rutas relativas al proyecto, con "/". only: una ruta exacta, para saber si está. Sin repo, null.
export async function repoFiles(projectDir, only = null) {
  const out = await git(projectDir, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', only === null ? '.' : ':(literal)' + only]);
  return out === null ? null : [...new Set(out.split('\0').filter(Boolean))].sort();
}

/** { branch, ahead, behind }: la rama (null si HEAD está suelto) y, si sigue a otra, cuántos commits le lleva y le faltan. */
export async function repoBranch(projectDir) {
  const [branch, ab] = await Promise.all([git(projectDir, ['symbolic-ref', '--short', '-q', 'HEAD']), git(projectDir, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD'])]);
  const [behind, ahead] = ab ? ab.trim().split(/\s+/).map(Number) : [];
  return { branch: branch?.trim() || null, ...(ab && { ahead, behind }) };
}

/**
 * El repo del proyecto visto desde sus worktrees (23.2): { repo, main, branch }. repo es el mismo en todos los
 * worktrees de un repo (el .git común, más dónde está el proyecto dentro del repo); main dice si este es el worktree
 * principal. Sin repo, null.
 */
export async function repoWorktree(projectDir) {
  const [out, head] = await Promise.all([git(projectDir, ['rev-parse', '--path-format=absolute', '--git-common-dir', '--git-dir', '--show-toplevel']),
    git(projectDir, ['symbolic-ref', '--short', '-q', 'HEAD'])]);
  if (!out) return null;
  const [common, gitDir, top] = out.trim().split('\n');
  const real = (p) => { try { return realpathSync.native(p); } catch { return resolve(p); } };
  const inside = relative(real(top), real(resolve(projectDir))).split('\\').join('/');
  return { repo: common + (inside ? '#' + inside : ''), main: common === gitDir, branch: head?.trim() || null };
}
