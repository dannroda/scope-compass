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
    execFile('git', ['-C', projectDir, 'status', '--porcelain', '--untracked-files=all', '--', ...paths], { timeout: 5000 }, (err, stdout) => {
      if (err) return done({ repo: false, uncommitted: 0, files: [] });
      const files = stdout.split('\n').filter(Boolean).map((l) => l.slice(3).replace(/^"|"$/g, ''));
      done({ repo: true, uncommitted: files.length, files });
    });
  });
}
