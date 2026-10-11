// Archivos del repo (spec §22, 14.1): lo que git no ignora, con su estado, la rama y los últimos commits; y cada
// archivo con su contenido, su diff contra HEAD y su historial. Todo de lectura: la app no escribe archivos ni
// commitea (D34); la única excepción son las capturas de compass/images/ (D38, images.js). Solo se sirven rutas que
// git lista, nunca un enlace simbólico seguido.
import { lstat, readFile, readlink } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { docDiff, docLog, docsStatus, repoBranch, repoFiles } from './git.js';
import { renderCode, renderMarkdown } from './render.js';
import { StoreError } from './store/json-files.js';

const MAX_TEXT = 1 << 20; // un texto más grande no se muestra (ni su diff entero): se avisa
const IMAGES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
// Lenguaje de Prism por extensión; .tscn, .tres, .godot e .import son como ini.
const LANG = { '.gd': 'gdscript', '.gdshader': 'glsl', '.glsl': 'glsl', '.json': 'json', '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.py': 'python', '.cs': 'csharp', '.sh': 'bash', '.cfg': 'ini', '.ini': 'ini', '.toml': 'ini', '.godot': 'ini', '.import': 'ini', '.tscn': 'ini',
  '.tres': 'ini', '.yml': 'yaml', '.yaml': 'yaml', '.html': 'markup', '.xml': 'markup', '.svg': 'markup', '.css': 'css' };
const binary = (buf) => buf.subarray(0, 8000).includes(0);

// La ruta tiene que estar en lo que git lista (o en su estado: un borrado ya commiteado en el índice). Nada de ../.
// También decide qué archivos puede citar una tarea (scompass file add, 15.1).
export async function repoFile(projectDir, raw) {
  const path = String(raw ?? '');
  const g = await docsStatus(projectDir);
  const ok = path && !path.startsWith('/') && !/(^|\/)\.\.(\/|$)/.test(path) && !/[\\\0]/.test(path) &&
    ((await repoFiles(projectDir, path))?.includes(path) || g.status[path]);
  if (!ok) throw new StoreError('not_found', `no hay un archivo "${path}" en el repo (o git lo ignora)`);
  return { path, git: g.status[path] ?? 'clean', abs: join(projectDir, path) };
}

export function registerFilesApi(app, { projectDir }) {
  app.get('/api/files', async () => {
    const [files, g, branch, commits] = await Promise.all([repoFiles(projectDir), docsStatus(projectDir), repoBranch(projectDir), docLog(projectDir, '.', { follow: false })]);
    if (!files) return { repo: false, files: [], status: {}, commits: [] };
    // ponytail: la lista va entera (unos 50 bytes por archivo); con repos de cientos de miles, paginar por carpeta.
    return { repo: true, ...branch, files: [...new Set([...files, ...Object.keys(g.status)])].sort(), status: g.status, commits };
  });

  // kind: text (html resaltado), markdown (html renderizado), image (se pide a /raw), binary, big, link o missing.
  app.get('/api/files/file', async (req) => {
    const { path, git, abs } = await repoFile(projectDir, req.query.path);
    const ext = extname(path).toLowerCase();
    const [st, commits] = await Promise.all([lstat(abs).catch(() => null), docLog(projectDir, path)]);
    const base = { path, git, commits, size: st?.size ?? 0 };
    if (!st) return { ...base, kind: 'missing' };
    if (st.isSymbolicLink()) return { ...base, kind: 'link', target: await readlink(abs) };
    if (!st.isFile()) return { ...base, kind: 'missing' };
    if (IMAGES[ext]) return { ...base, kind: 'image' };
    if (st.size > MAX_TEXT) return { ...base, kind: 'big' };
    const buf = await readFile(abs);
    if (binary(buf)) return { ...base, kind: 'binary' };
    const text = buf.toString('utf8');
    if (ext === '.md') return { ...base, kind: 'markdown', html: renderMarkdown(text) };
    return { ...base, kind: 'text', lines: text.split('\n').length - (text.endsWith('\n') ? 1 : 0), html: renderCode(text, LANG[ext]) };
  });

  // Diff contra HEAD. Uno nuevo sin seguir se arma entero; uno binario o enorme no trae texto (binary / truncated).
  app.get('/api/files/diff', async (req) => {
    const { path, git, abs } = await repoFile(projectDir, req.query.path);
    if (git === 'clean') return { path, git, diff: '' };
    let text = '';
    if (git === 'untracked') {
      const st = await lstat(abs).catch(() => null);
      const buf = st?.isFile() && st.size <= MAX_TEXT ? await readFile(abs) : null;
      if (!buf || binary(buf)) return { path, git, diff: '', binary: true };
      text = buf.toString('utf8');
    }
    const diff = await docDiff(projectDir, path, { untracked: git === 'untracked', text });
    if (/^Binary files .* differ$/m.test(diff)) return { path, git, diff: '', binary: true };
    return diff.length > 2 * MAX_TEXT ? { path, git, diff: diff.slice(0, 2 * MAX_TEXT), truncated: true } : { path, git, diff };
  });

  // Solo imágenes, para <img>; con sandbox, por si alguien la abre sola.
  app.get('/api/files/raw', async (req, reply) => {
    const { path, abs } = await repoFile(projectDir, req.query.path);
    const type = IMAGES[extname(path).toLowerCase()];
    if (!type) throw new StoreError('invalid_argument', `${path} no es una imagen`);
    const st = await lstat(abs).catch(() => null);
    if (!st?.isFile()) throw new StoreError('not_found', `${path} no está en el disco`);
    reply.header('content-type', type).header('x-content-type-options', 'nosniff').header('content-security-policy', "default-src 'none'; sandbox");
    return readFile(abs);
  });
}
