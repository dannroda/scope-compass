// Ícono en la bandeja del sistema (5.9, D20): StatusNotifierItem + menú com.canonical.dbusmenu por D-Bus,
// el mecanismo nativo de KDE Plasma. Sin binarios nativos: @homebridge/dbus-native es JavaScript puro.
import dbus from '@homebridge/dbus-native';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICON_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'icons');
const WATCHER = 'org.kde.StatusNotifierWatcher';
const ITEM_PATH = '/StatusNotifierItem';
const MENU_PATH = '/MenuBar';

// Ícono dibujado en píxeles (ARGB32, big endian), por si el tema no encuentra el SVG.
function compassPixmap(size) {
  const buf = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2, r = size / 2 - 1;
  const put = (x, y, [a, rr, g, b]) => { const i = (y * size + x) * 4; buf[i] = a; buf[i + 1] = rr; buf[i + 2] = g; buf[i + 3] = b; };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - c, dy = y - c, d = Math.hypot(dx, dy);
      if (d <= r) put(x, y, d > r - size / 11 ? [255, 0xd9, 0xa4, 0x41] : [255, 0x1f, 0x25, 0x2e]);
      // Aguja: rombo vertical, mitad norte en dorado y mitad sur en claro.
      const w = (r * 0.62 - Math.abs(dy)) * 0.32;
      if (Math.abs(dx) <= w && Math.abs(dy) <= r * 0.62) put(x, y, dy < 0 ? [255, 0xd9, 0xa4, 0x41] : [255, 0xec, 0xe5, 0xd6]);
    }
  }
  return [size, size, buf];
}

const ITEM_IFACE = {
  name: 'org.kde.StatusNotifierItem',
  methods: { ContextMenu: ['ii', ''], Activate: ['ii', ''], SecondaryActivate: ['ii', ''], Scroll: ['is', ''] },
  properties: {
    Category: 's', Id: 's', Title: 's', Status: 's', WindowId: 'i', IconThemePath: 's', IconName: 's',
    IconPixmap: 'a(iiay)', OverlayIconName: 's', OverlayIconPixmap: 'a(iiay)', AttentionIconName: 's',
    AttentionIconPixmap: 'a(iiay)', AttentionMovieName: 's', ToolTip: '(sa(iiay)ss)', ItemIsMenu: 'b', Menu: 'o'
  },
  signals: { NewTitle: ['', ''], NewIcon: ['', ''], NewToolTip: ['', ''], NewStatus: ['s', 'status'] }
};

const MENU_IFACE = {
  name: 'com.canonical.dbusmenu',
  methods: {
    GetLayout: ['iias', 'u(ia{sv}av)'], GetGroupProperties: ['aias', 'a(ia{sv})'], GetProperty: ['is', 'v'],
    Event: ['isvu', ''], EventGroup: ['a(isvu)', 'ai'], AboutToShow: ['i', 'b'], AboutToShowGroup: ['ai', 'aiai']
  },
  properties: { Version: 'u', TextDirection: 's', Status: 's', IconThemePath: 'as' },
  signals: { ItemsPropertiesUpdated: ['a(ia{sv})a(ias)', ''], LayoutUpdated: ['ui', ''], ItemActivationRequested: ['iu', ''] }
};

/**
 * Muestra el ícono. items: [{ label, onClick }] para el menú; onActivate: clic en el ícono.
 * Devuelve { close(), service }. Falla si no hay bus de sesión.
 */
export async function startTray({ title, tooltip, items, onActivate, busAddress = process.env.DBUS_SESSION_BUS_ADDRESS }) {
  if (!busAddress) throw new Error('no hay bus de sesión de D-Bus');
  const bus = dbus.sessionBus({ busAddress });
  await new Promise((resolve, reject) => {
    bus.connection.once('connect', resolve);
    bus.connection.once('error', reject);
  });
  const service = `org.kde.StatusNotifierItem-${process.pid}-1`;
  await new Promise((resolve, reject) => bus.requestName(service, 0x4, (err, r) => (err ? reject(err) : resolve(r))));

  const item = {
    Category: 'ApplicationStatus', Id: 'scope-compass', Title: title, Status: 'Active', WindowId: 0,
    IconThemePath: ICON_DIR, IconName: 'scope-compass', IconPixmap: [compassPixmap(22), compassPixmap(44)],
    OverlayIconName: '', OverlayIconPixmap: [], AttentionIconName: '', AttentionIconPixmap: [], AttentionMovieName: '',
    ToolTip: ['scope-compass', [], title, tooltip], ItemIsMenu: false, Menu: MENU_PATH,
    Activate: () => onActivate?.(), SecondaryActivate: () => onActivate?.(), ContextMenu: () => {}, Scroll: () => {}
  };

  // Menú: raíz 0 con los ítems 1..n.
  const props = (i) => [['label', ['s', items[i].label]], ['enabled', ['b', true]], ['visible', ['b', true]]];
  const node = (i) => [i + 1, props(i), []];
  const menu = {
    Version: 3, TextDirection: 'ltr', Status: 'normal', IconThemePath: [],
    GetLayout: () => [1, [0, [['children-display', ['s', 'submenu']]], items.map((_, i) => ['(ia{sv}av)', node(i)])]],
    GetGroupProperties: (ids) => ids.filter((id) => id >= 1 && id <= items.length).map((id) => [id, props(id - 1)]),
    GetProperty: (id, name) => { const p = id >= 1 && id <= items.length ? props(id - 1).find(([k]) => k === name) : null; return p ? p[1] : ['s', '']; },
    Event: (id, eventId) => { if (eventId === 'clicked' && id >= 1 && id <= items.length) setImmediate(() => items[id - 1].onClick()); },
    EventGroup: (events) => { for (const [id, eventId] of events) menu.Event(id, eventId); return []; },
    AboutToShow: () => false,
    AboutToShowGroup: () => [[], []]
  };
  bus.exportInterface(item, ITEM_PATH, ITEM_IFACE);
  bus.exportInterface(menu, MENU_PATH, MENU_IFACE);

  const register = () => bus.invoke({
    destination: WATCHER, path: '/StatusNotifierWatcher', interface: WATCHER,
    member: 'RegisterStatusNotifierItem', signature: 's', body: [service]
  }, () => {});
  register();
  // Si Plasma se reinicia, el watcher vuelve con otro dueño: hay que registrarse de nuevo.
  bus.addMatch(`type='signal',sender='org.freedesktop.DBus',member='NameOwnerChanged',arg0='${WATCHER}'`, () => {});
  bus.connection.on('message', (m) => {
    if (m.member === 'NameOwnerChanged' && m.body?.[0] === WATCHER && m.body?.[2]) register();
  });

  return {
    service,
    close: () => { try { bus.connection.end(); } catch {} }
  };
}
