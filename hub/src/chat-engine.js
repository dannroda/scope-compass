// El motor del chat (spec §47, D58): claude (Claude Code) o agy (Antigravity CLI). Se elige por equipo, en
// <config>/settings.json › chat_engine (el mismo archivo que el idioma); si el elegido no está instalado, o no se
// eligió, va claude si está y si no agy. Cada conversación guarda el suyo y no cambia.
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { findClaude } from './chat.js';
import { findAgy } from './chat-agy.js';
import { settingsFile } from './i18n.js';
import { writeAtomic } from './store/atomic.js';

export const ENGINES = ['claude', 'agy'];

function readSettings() {
  try { return JSON.parse(readFileSync(settingsFile(), 'utf8')); } catch { return {}; }
}

/** El motor elegido en Ajustes, o null si no se eligió. */
export function chosenEngine() {
  const v = readSettings().chat_engine;
  return ENGINES.includes(v) ? v : null;
}

/** Guarda el motor elegido; null vuelve al de por defecto. */
export async function setChosenEngine(engine) {
  const s = readSettings();
  if (ENGINES.includes(engine)) s.chat_engine = engine;
  else delete s.chat_engine;
  mkdirSync(dirname(settingsFile()), { recursive: true });
  await writeAtomic(settingsFile(), `${JSON.stringify(s, null, 2)}\n`);
}

/** Qué motores están instalados: { claude: bool, agy: bool }. */
export const installedEngines = (env = process.env) => ({ claude: findClaude(env) !== null, agy: findAgy(env) !== null });

/** El motor de una conversación nueva: el elegido si está instalado; si no, claude si está; si no, agy si está; si no, claude. */
export function engineFor(env = process.env, chosen = chosenEngine()) {
  const have = installedEngines(env);
  if (chosen && have[chosen]) return chosen;
  if (have.claude) return 'claude';
  if (have.agy) return 'agy';
  return chosen ?? 'claude';
}
