// Lo que comparten las dos bandejas (D20 en Linux, D31 en Windows): el dibujo del ícono y el menú evaluado.

// Ícono dibujado en píxeles (ARGB32, big endian, filas de arriba abajo), el compass de @icons: lo usa la bandeja
// de Linux si no encuentra el SVG del tema. La de Windows usa assets/icons/scope-compass.ico (tools/make-ico.mjs).
export function compassPixmap(size) {
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

const val = (v) => (typeof v === 'function' ? v() : v);

/**
 * Evalúa los ítems del menú: [{ label, onClick?, visible?, enabled?, children?, separator? }], donde items,
 * children, label, visible y enabled pueden ser funciones. Numera en orden desde 1 (primero cada ítem, después sus
 * hijos). Devuelve { root: { id: 0, children }, map: id → nodo, shape } con nodos
 * { id, item, separator, label, visible, enabled, children }; shape cambia si cambió algo visible.
 */
export function buildMenu(items) {
  let next = 1;
  const map = new Map();
  const walk = (list) => (val(list) ?? []).map((it) => {
    const node = { id: next++, item: it, separator: !!it.separator, label: it.separator ? '' : String(val(it.label)),
      visible: it.visible === undefined ? true : !!val(it.visible), enabled: it.enabled === undefined ? true : !!val(it.enabled) };
    map.set(node.id, node);
    node.children = it.children ? walk(it.children) : [];
    return node;
  });
  const root = { id: 0, children: walk(items) };
  const strip = (n) => ({ l: n.label, v: n.visible, e: n.enabled, s: n.separator, c: n.children.map(strip) });
  return { root, map, shape: JSON.stringify(strip(root)) };
}
