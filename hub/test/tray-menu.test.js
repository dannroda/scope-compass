// Lo que comparten las dos bandejas: el menú evaluado y el .ico de Windows (corre en las dos plataformas).
import './isolate.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildMenu } from '../src/tray-menu.js';
import { ICO } from '../src/tray-win.js';

test('buildMenu: numera en orden (cada ítem y después sus hijos), evalúa funciones y cambia shape si cambia algo visible', () => {
  let n = 1;
  const items = () => [{ label: 'Abrir' }, { separator: true }, { label: () => `Vida · ${n}`, children: [{ label: 'Detener' }] }, { label: 'Oculto', visible: () => n > 1 }];
  const a = buildMenu(items);
  assert.deepEqual([...a.map.values()].map((x) => [x.id, x.label]), [[1, 'Abrir'], [2, ''], [3, 'Vida · 1'], [4, 'Detener'], [5, 'Oculto']]);
  assert.equal(a.map.get(5).visible, false);
  assert.equal(buildMenu(items).shape, a.shape, 'sin cambios, mismo shape');
  n = 2;
  const b = buildMenu(items);
  assert.notEqual(b.shape, a.shape);
  assert.equal(b.map.get(3).label, 'Vida · 2');
  assert.equal(b.map.get(5).visible, true);
});

test('assets/icons/scope-compass.ico (tools/make-ico.mjs): BMP de 32 bits de 16 a 64 y PNG de 256, con el dorado del SVG', () => {
  const ico = readFileSync(ICO);
  const sizes = [16, 20, 24, 32, 40, 48, 64, 256];
  assert.deepEqual([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)], [0, 1, sizes.length], 'ICONDIR: tipo ícono');
  sizes.forEach((s, i) => {
    const e = 6 + i * 16;
    assert.deepEqual([ico[e], ico[e + 1], ico.readUInt16LE(e + 6)], [s & 0xff, s & 0xff, 32], `entrada de ${s}`);
    const len = ico.readUInt32LE(e + 8), off = ico.readUInt32LE(e + 12);
    assert.ok(off + len <= ico.length);
    if (s === 256) {
      assert.deepEqual([...ico.subarray(off, off + 4)], [0x89, 0x50, 0x4e, 0x47], 'el de 256 es un PNG');
      return;
    }
    assert.equal(len, 40 + s * s * 4 + Math.ceil(s / 32) * 4 * s);
    assert.deepEqual([ico.readUInt32LE(off), ico.readInt32LE(off + 4), ico.readInt32LE(off + 8)], [40, s, 2 * s], 'BITMAPINFOHEADER: alto doble');
    // El punto del centro de la aguja es dorado (#d9a441; en 16 px, un píxel con algo de antialiasing); la esquina,
    // transparente. BGRA de abajo arriba.
    const px = (x, y) => [...ico.subarray(off + 40 + ((s - 1 - y) * s + x) * 4, off + 40 + ((s - 1 - y) * s + x) * 4 + 4)];
    const [b, g, r, a] = px(Math.floor(s / 2), Math.floor(s / 2));
    assert.ok(a > 150 && Math.abs(r - 0xd9) < 40 && Math.abs(g - 0xa4) < 40 && Math.abs(b - 0x41) < 40, `centro de ${s}: ${[r, g, b, a]}`);
    assert.equal(px(0, 0)[3], 0, `esquina de ${s}`);
  });
});
