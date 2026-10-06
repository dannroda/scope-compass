// Lo que comparten las dos bandejas (D20 en Linux, D31 en Windows): el dibujo del ícono y el menú evaluado.

// Ícono dibujado en píxeles (ARGB32, big endian, filas de arriba abajo), el compass de @icons: lo usa la bandeja
// de Linux si no encuentra el SVG del tema, y la de Windows para armar su .ico.
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

/**
 * El mismo dibujo como .ico de Windows, con un BMP de 32 bits por tamaño (BGRA de abajo arriba, más la máscara
 * AND vacía: la transparencia la da el alfa).
 */
export function compassIco(sizes = [16, 20, 24, 32, 40, 48]) {
  const images = sizes.map((s) => {
    const [, , argb] = compassPixmap(s);
    const maskRow = Math.ceil(s / 32) * 4;
    const img = Buffer.alloc(40 + s * s * 4 + maskRow * s);
    img.writeUInt32LE(40, 0); img.writeInt32LE(s, 4); img.writeInt32LE(s * 2, 8);
    img.writeUInt16LE(1, 12); img.writeUInt16LE(32, 14);
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const from = (y * s + x) * 4, to = 40 + ((s - 1 - y) * s + x) * 4;
        img[to] = argb[from + 3]; img[to + 1] = argb[from + 2]; img[to + 2] = argb[from + 1]; img[to + 3] = argb[from];
      }
    }
    return [s, img];
  });
  const head = Buffer.alloc(6 + 16 * images.length);
  head.writeUInt16LE(1, 2); head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach(([s, img], i) => {
    const e = 6 + i * 16;
    head[e] = s; head[e + 1] = s; head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(img.length, e + 8); head.writeUInt32LE(offset, e + 12);
    offset += img.length;
  });
  return Buffer.concat([head, ...images.map(([, img]) => img)]);
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
