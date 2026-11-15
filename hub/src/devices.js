// Dispositivos vinculados para el chat (spec §49, D60). Un código de un solo uso, pedido desde este equipo, se canjea
// por un token propio del dispositivo que queda en una cookie. Del token se guarda solo su SHA-256, en
// <config>/devices.json (de la máquina, no va a git). Los códigos viven en la memoria del Inicio y nunca tocan el disco.
import { createHash, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdirSync, readFileSync, statSync, unwatchFile, watchFile } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { configDir } from './projects.js';
import { writeAtomic } from './store/atomic.js';
import { T } from './i18n.js';

export const DEVICE_COOKIE = 'scompass_device';
export const CODE_TTL_MS = 5 * 60 * 1000;
const MAX_FAILURES = 5;
const SEEN_EVERY_MS = 60 * 1000;
const NAME_MAX = 60;

export class DeviceError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export const devicesFile = () => join(configDir(), 'devices.json');
const hashOf = (token) => createHash('sha256').update(token).digest('hex');
const random = (bytes) => randomBytes(bytes).toString('base64url');

// Lectura con caché por fecha de cambio: se mira en cada pedido del chat y en cada evento del WebSocket, y un
// `scompass devices rm` en otro proceso tiene que verse enseguida.
let cache = { key: null, devices: [] };
function readDevices() {
  const file = devicesFile();
  let st;
  try { st = statSync(file); } catch { cache = { key: null, devices: [] }; return []; }
  const key = `${file}\u0000${st.mtimeMs}\u0000${st.size}`;
  if (cache.key === key) return cache.devices;
  let devices = [];
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    if (Array.isArray(data?.devices)) devices = data.devices.filter((d) => d && typeof d.id === 'string' && typeof d.hash === 'string');
  } catch { /* un devices.json roto no vincula a nadie */ }
  cache = { key, devices };
  return devices;
}
async function writeDevices(devices) {
  const file = devicesFile();
  await mkdir(dirname(file), { recursive: true });
  await writeAtomic(file, JSON.stringify({ devices }, null, 2) + '\n');
  cache = { key: null, devices: [] };
}

const view = ({ hash: _hash, ...d }) => d;

/** Los dispositivos vinculados, sin el hash. */
export const listDevices = () => readDevices().map(view);

/** Desvincula un dispositivo. Devuelve si estaba. */
export async function removeDevice(id) {
  const devices = readDevices();
  if (!devices.some((d) => d.id === id)) return false;
  await writeDevices(devices.filter((d) => d.id !== id));
  return true;
}

/** El valor de la cookie del dispositivo en una cabecera Cookie, o null. */
export function tokenFromCookie(header) {
  if (typeof header !== 'string') return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === DEVICE_COOKIE) return part.slice(i + 1).trim() || null;
  }
  return null;
}

/** La cabecera Set-Cookie para un token: HttpOnly, SameSite=Strict, un año; Secure si el pedido llegó por HTTPS. */
export const deviceCookie = (token, { secure = false } = {}) =>
  `${DEVICE_COOKIE}=${token}; Path=/; Max-Age=${365 * 24 * 3600}; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;

/**
 * Lo que usa el Inicio: los códigos pendientes, el canje y quién es el dispositivo de un pedido. Emite 'removed' con
 * el id de cada dispositivo que deja de estar (desvinculado acá o con la CLI), para cerrar sus WebSocket.
 */
export function createDevices({ ttlMs = CODE_TTL_MS, now = Date.now, watchMs = 1000 } = {}) {
  const events = new EventEmitter();
  const codes = new Map(); // código → vence
  let failures = 0;
  let known = new Set(readDevices().map((d) => d.id));
  let touching = Promise.resolve();

  const sweep = () => { for (const [c, until] of codes) if (until <= now()) codes.delete(c); };
  const check = () => {
    const ids = new Set(readDevices().map((d) => d.id));
    for (const id of known) if (!ids.has(id)) events.emit('removed', id);
    known = ids;
  };
  // Lo que borra otro proceso (scompass devices rm): fs.watchFile mira la fecha, también si el archivo no existía.
  const file = devicesFile();
  try { mkdirSync(dirname(file), { recursive: true }); } catch { /* sin carpeta de config, sin vigilar */ }
  const onFile = () => check();
  if (watchMs > 0) watchFile(file, { interval: watchMs, persistent: false }, onFile);

  // last_seen, como mucho una vez por minuto por dispositivo; las escrituras van en fila.
  const touch = (device) => {
    const t = now();
    if (device.last_seen && t - Date.parse(device.last_seen) < SEEN_EVERY_MS) return;
    device.last_seen = new Date(t).toISOString();
    touching = touching.then(async () => {
      const devices = readDevices();
      const d = devices.find((x) => x.id === device.id);
      if (!d) return;
      d.last_seen = device.last_seen;
      await writeDevices(devices);
    }).catch(() => {});
  };

  return {
    events,
    /** Crea un código de un solo uso. */
    code() {
      sweep();
      const code = random(12);
      const expires = now() + ttlMs;
      codes.set(code, expires);
      return { code, expires_at: new Date(expires).toISOString() };
    },
    /** Canjea un código por un dispositivo nuevo: { device, token }. */
    async pair(code, name) {
      sweep();
      if (typeof code !== 'string' || !codes.has(code)) {
        // Con 5 intentos fallidos seguidos se anulan los pendientes: adivinar no sirve.
        if (++failures >= MAX_FAILURES) { codes.clear(); failures = 0; }
        throw new DeviceError('forbidden', T('el código no sirve: ya se usó, venció o no existe; pedí otro en este equipo'));
      }
      codes.delete(code);
      failures = 0;
      const clean = typeof name === 'string' ? name.trim().slice(0, NAME_MAX) : '';
      const token = random(32);
      const at = new Date(now()).toISOString();
      const device = { id: random(6), name: clean || T('Teléfono'), hash: hashOf(token), created_at: at, last_seen: at };
      const devices = readDevices();
      await writeDevices([...devices, device]);
      known.add(device.id);
      return { device: view(device), token };
    },
    /** El dispositivo vinculado de un pedido (por su cookie), o null. Anota el último uso. */
    of(req) {
      const token = tokenFromCookie(req.headers?.cookie);
      if (!token) return null;
      const hash = hashOf(token);
      const device = readDevices().find((d) => d.hash === hash);
      if (!device) return null;
      touch(device);
      return view(device);
    },
    /** Si un dispositivo sigue vinculado. */
    has: (id) => readDevices().some((d) => d.id === id),
    async remove(id) {
      const ok = await removeDevice(id);
      if (ok) check();
      return ok;
    },
    list: () => listDevices(),
    pending: () => { sweep(); return codes.size; },
    close() { if (watchMs > 0) unwatchFile(file, onFile); events.removeAllListeners(); }
  };
}
