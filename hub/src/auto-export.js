// Export markdown automático del hub (D13, spec §6): después de cada cambio, con debounce para las
// ráfagas (un git pull, varios pasos tildados). Relee la config cada vez: auto_export_md se respeta en vivo.
import { exportMarkdown } from './export-md.js';

export function createAutoExport({ projectDir, store, emit, onExported = () => {}, debounceMs = 200 }) {
  let timer = null;
  let running = Promise.resolve();

  async function exportNow() {
    const all = await store.loadAll();
    if (!all.config?.export_md || all.config.auto_export_md === false) return;
    try {
      onExported(await exportMarkdown(projectDir, all));
    } catch (e) {
      emit({ type: 'warning', code: 'io_error', path: all.config.export_md, message: `export markdown: ${e.message}` });
    }
  }
  // Los exports no se pisan entre sí: cada uno espera al anterior.
  const run = () => (running = running.then(exportNow, exportNow));

  return {
    schedule() {
      clearTimeout(timer);
      timer = setTimeout(() => { timer = null; run(); }, debounceMs);
    },
    // Al cerrar: si había uno pendiente, se hace ya.
    async flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
        run();
      }
      await running;
    }
  };
}
