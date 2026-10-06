// Lo que comparten las dos bandejas: el menú evaluado y el .ico de Windows (corre en las dos plataformas).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMenu, compassIco, compassPixmap } from '../src/tray-menu.js';

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

test('compassIco: un .ico válido con un BMP de 32 bits por tamaño, el mismo dibujo que el pixmap', () => {
  const sizes = [16, 32];
  const ico = compassIco(sizes);
  assert.deepEqual([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)], [0, 1, 2], 'ICONDIR: tipo ícono, 2 imágenes');
  sizes.forEach((s, i) => {
    const e = 6 + i * 16;
    assert.deepEqual([ico[e], ico[e + 1], ico.readUInt16LE(e + 6)], [s, s, 32]);
    const len = ico.readUInt32LE(e + 8), off = ico.readUInt32LE(e + 12);
    assert.equal(len, 40 + s * s * 4 + Math.ceil(s / 32) * 4 * s);
    assert.ok(off + len <= ico.length);
    assert.deepEqual([ico.readUInt32LE(off), ico.readInt32LE(off + 4), ico.readInt32LE(off + 8)], [40, s, 2 * s], 'BITMAPINFOHEADER: alto doble');
    // El píxel de arriba en el centro (borde dorado) está en la última fila del BMP, en BGRA.
    const [, , argb] = compassPixmap(s);
    const x = Math.floor(s / 2), src = x * 4, dst = off + 40 + ((s - 1) * s + x) * 4;
    assert.deepEqual([...ico.subarray(dst, dst + 4)], [argb[src + 3], argb[src + 2], argb[src + 1], argb[src]]);
  });
});
