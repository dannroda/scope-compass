// Mirar una carpeta y sus subcarpetas (19.1). En Linux, fs.watch recursivo deja de avisar de un archivo después de
// que se lo reemplaza con un rename (lo que hacen writeAtomic, git checkout, sed -i y muchos editores): ahí se mira
// cada carpeta por separado, sin recursión, y se suman o se sacan las que aparecen o desaparecen. En macOS y
// Windows el recursivo es nativo y no tiene ese problema.
import { watch } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join, sep } from 'node:path';

// Carpetas que nunca hay que mirar: pesan y no tienen nada del tablero ni de los documentos.
const SKIP = new Set(['.git', 'node_modules', '.godot', '.import']);

/**
 * Llama onChange(rel) con la ruta del archivo que cambió, relativa a root y con "/" (o null si el sistema no dice
 * cuál), y onError(e) si falla. Devuelve { ready, close }: ready se cumple cuando ya se miran todas las carpetas.
 */
export function watchTree(root, onChange, { onError = () => {}, linux = process.platform === 'linux' } = {}) {
  if (!linux) {
    const w = watch(root, { recursive: true }, (ev, file) => onChange(file ? file.split(sep).join('/') : null));
    w.on('error', onError);
    return { ready: Promise.resolve(), close: () => w.close() };
  }
  const watchers = new Map(); // "sub/dir" ("" la raíz) → FSWatcher
  let closed = false;

  function drop(rel) {
    for (const [key, w] of [...watchers]) {
      if (key === rel || key.startsWith(rel + '/')) { w.close(); watchers.delete(key); }
    }
  }

  async function add(rel) {
    if (closed || watchers.has(rel)) return;
    const abs = rel ? join(root, rel) : root;
    let w;
    try {
      w = watch(abs, (ev, file) => {
        const path = file ? (rel ? `${rel}/${file}` : String(file)) : null;
        onChange(path);
        // Una carpeta nueva (o vuelta a crear: git checkout) se empieza a mirar; una que se fue, se suelta.
        if (path && ev === 'rename' && !SKIP.has(String(file))) {
          stat(join(root, path)).then((s) => { if (s.isDirectory()) { drop(path); return add(path); } }, () => drop(path)).catch(onError);
        }
      });
    } catch (e) {
      if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') onError(e);
      return;
    }
    // La carpeta se borró: el watcher se cierra solo; se suelta para poder volver a mirarla.
    w.on('error', (e) => { drop(rel); if (e.code !== 'ENOENT' && e.code !== 'EPERM') onError(e); });
    watchers.set(rel, w);
    const entries = await readdir(abs, { withFileTypes: true }).catch(() => []);
    for (const d of entries) if (d.isDirectory() && !SKIP.has(d.name)) await add(rel ? `${rel}/${d.name}` : d.name);
  }

  const ready = add('').catch(onError);
  return {
    ready,
    close() {
      closed = true;
      for (const w of watchers.values()) w.close();
      watchers.clear();
    }
  };
}
