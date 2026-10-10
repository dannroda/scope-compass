// Cambios sin commitear en el tablero (4.4): `git status` de compass/ y del export markdown. La app nunca
// commitea en local (spec §4.5); esto solo lo recuerda. Sin git o fuera de un repo: { repo: false }.
import { execFile } from 'node:child_process';
import { relative, resolve } from 'node:path';

/** { repo, uncommitted, files } con las rutas relativas al proyecto. */
export function boardStatus(projectDir, config) {
  const paths = ['compass'];
  if (config?.export_md) {
    const rel = relative(projectDir, resolve(projectDir, config.export_md));
    if (rel && !rel.startsWith('..')) paths.push(rel);
  }
  return new Promise((done) => {
    execFile('git', ['-C', projectDir, 'status', '--porcelain', '--untracked-files=all', '--', ...paths], { timeout: 5000, windowsHide: true }, (err, stdout) => {
      if (err) return done({ repo: false, uncommitted: 0, files: [] });
      const files = stdout.split('\n').filter(Boolean).map((l) => l.slice(3).replace(/^"|"$/g, ''));
      done({ repo: true, uncommitted: files.length, files });
    });
  });
}

// Estado de git de los documentos (12.3). Solo lectura, como todo lo de acá. `git` falla (sin git, fuera de un repo,
// repo sin commits) → null.
const git = (projectDir, args) => new Promise((done) => {
  execFile('git', ['-C', projectDir, ...args], { timeout: 5000, windowsHide: true, maxBuffer: 32 << 20 }, (err, stdout) => done(err ? null : stdout));
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

/** Commits que tocaron el archivo, del más nuevo al más viejo, siguiendo renombres: [{ hash, date, author, subject }]. */
export async function docLog(projectDir, path, { limit = 20 } = {}) {
  const out = await git(projectDir, ['log', '--follow', `-n${limit}`, '--format=%h%x1f%aI%x1f%an%x1f%s%x1e', '--', path]);
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
