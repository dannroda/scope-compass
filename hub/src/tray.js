// Ícono en la bandeja del sistema (5.9, D20): StatusNotifierItem + menú com.canonical.dbusmenu por D-Bus,
// el mecanismo nativo de KDE Plasma. Sin binarios nativos: @homebridge/dbus-native es JavaScript puro.
import dbus from '@homebridge/dbus-native';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICON_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'icons');
const WATCHER = 'org.kde.StatusNotifierWatcher';
const ITEM_PATH = '/StatusNotifierItem';
const MENU_PATH = '/MenuBar';

// Ícono dibujado en píxeles (ARGB32, big endian), por si la bandeja no encuentra el SVG del tema (el compass de @icons).
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
 * Muestra el ícono. items: [{ label, onClick?, visible?, enabled?, children?, separator? }] para el menú; items,
 * children, label, visible y enabled pueden ser funciones: se evalúan al abrir el menú y con refresh(). En un menú
 * plano, cada ítem tiene id = su posición + 1. onActivate: clic en el ícono.
 * Devuelve { close(), refresh(), service }. Falla si no hay bus de sesión.
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

  // Menú: raíz 0 y los ítems numerados en orden (primero cada ítem, después sus hijos). La revisión sube cuando
  // cambia algo visible: un label, un visible o la lista de ítems (los proyectos del Inicio van y vienen).
  const val = (v) => (typeof v === 'function' ? v() : v);
  let root = { id: 0, children: [] };
  let byId = new Map();
  let shape = '';
  let revision = 1;
  const build = () => {
    let next = 1;
    const map = new Map();
    const walk = (list) => (val(list) ?? []).map((it) => {
      const node = { id: next++, item: it, separator: !!it.separator, label: it.separator ? '' : String(val(it.label)),
        visible: it.visible === undefined ? true : !!val(it.visible), enabled: it.enabled === undefined ? true : !!val(it.enabled) };
      map.set(node.id, node);
      node.children = it.children ? walk(it.children) : [];
      return node;
    });
    return { root: { id: 0, children: walk(items) }, map };
  };
  const strip = (n) => ({ l: n.label, v: n.visible, e: n.enabled, s: n.separator, c: n.children.map(strip) });
  const recompute = () => {
    const b = build();
    const next = JSON.stringify(strip(b.root));
    root = b.root;
    byId = b.map;
    const changed = next !== shape;
    shape = next;
    if (changed) revision++;
    return changed;
  };
  recompute();
  const props = (n) => n.id === 0 ? [['children-display', ['s', 'submenu']]]
    : n.separator ? [['type', ['s', 'separator']], ['visible', ['b', n.visible]]]
      : [['label', ['s', n.label]], ['enabled', ['b', n.enabled]], ['visible', ['b', n.visible]], ...(n.children.length ? [['children-display', ['s', 'submenu']]] : [])];
  const layout = (n) => [n.id, props(n), n.children.map((c) => ['(ia{sv}av)', layout(c)])];
  const nodeOf = (id) => (id === 0 ? root : byId.get(id));
  const menu = {
    Version: 3, TextDirection: 'ltr', Status: 'normal', IconThemePath: [],
    // emit lo reemplaza dbus-native al exportar: así se mandan las señales (LayoutUpdated).
    emit: () => {},
    GetLayout: (parentId) => [revision, layout(nodeOf(parentId) ?? root)],
    GetGroupProperties: (ids) => ids.map((id) => nodeOf(id)).filter(Boolean).map((n) => [n.id, props(n)]),
    GetProperty: (id, name) => { const n = nodeOf(id); const p = n ? props(n).find(([k]) => k === name) : null; return p ? p[1] : ['s', '']; },
    Event: (id, eventId) => { const n = byId.get(id); if (eventId === 'clicked' && n?.item.onClick) setImmediate(() => n.item.onClick()); },
    EventGroup: (events) => { for (const [id, eventId] of events) menu.Event(id, eventId); return []; },
    // Antes de abrir el menú el escritorio pregunta si cambió: se reevalúan labels, visibles y la lista de ítems.
    AboutToShow: () => recompute(),
    AboutToShowGroup: () => [recompute() ? [0] : [], []]
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
    refresh: () => { if (recompute()) menu.emit('LayoutUpdated', revision, 0); },
    close: () => { try { bus.connection.end(); } catch {} }
  };
}
