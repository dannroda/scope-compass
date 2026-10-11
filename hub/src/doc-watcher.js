// Watcher de los documentos de config.json › docs (spec §10.4): emite { type: 'doc_changed', alias } al
// cambiar uno. Mira la carpeta de cada documento (los editores reemplazan el archivo al guardar).
import { watch } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { globBase } from './docs.js';
import { watchTree } from './watch-tree.js';

export function createDocWatcher(projectDir, { config, emit, debounceMs = 100 }) {
  const watchers = [];
  const timers = new Map();
  const changed = (alias) => {
    clearTimeout(timers.get(alias));
    timers.set(alias, setTimeout(() => { timers.delete(alias); emit({ type: 'doc_changed', alias }); }, debounceMs));
  };
  for (const entry of config?.docs ?? []) {
    try {
      if (entry.path.includes('*')) {
        // Patrón: se mira la carpeta fija del comienzo, recursiva; el alias es "<alias>/<ruta sin .md>", como en
        // docFiles. El export markdown no es un documento: se reescribe en cada cambio del tablero.
        const base = globBase(entry.path);
        watchers.push(watchTree(join(projectDir, base || '.'), (rel) => {
          if (rel && rel.endsWith('.md') && base + rel !== config.export_md) changed(`${entry.alias}/${rel.slice(0, -3)}`);
        }));
      } else {
        const name = basename(entry.path);
        watchers.push(watch(join(projectDir, dirname(entry.path)), (ev, file) => {
          if (file === name) changed(entry.alias);
        }));
      }
    } catch {
      // La carpeta no existe: /api/docs lo informa como missing_doc.
    }
  }
  return {
    close() {
      for (const t of timers.values()) clearTimeout(t);
      for (const w of watchers) w.close();
    }
  };
}

