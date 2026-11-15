// El generador de QR propio de la web (web/qr.js, §49, D60): igual módulo por módulo a qrencode (si está instalado)
// con la misma máscara, y la estructura de la norma sin él.
import './isolate.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'qr.js'), 'utf8');
// Se carga como script, con las funciones internas a la vista para probar cada máscara.
const mod = { exports: {} };
new Function('module', 'globalThis', SRC.replace('const api = { matrix, svg };', 'const api = { matrix, svg, build, encode, interleave };'))(mod, {});
const QR = mod.exports;
const hasQrencode = (() => { try { execFileSync('qrencode', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const TEXTS = ['hola', 'http://192.168.1.10:4700/vincular#AbCdEfGhIjKlMnOp', 'ñandú ' + 'y'.repeat(100), 'z'.repeat(150), 'w'.repeat(213)];

test('igual a qrencode -l M -8 con la máscara que eligió', { skip: !hasQrencode && 'sin qrencode' }, () => {
  for (const t of TEXTS) {
    const ref = execFileSync('qrencode', ['-l', 'M', '-8', '-m', '0', '-t', 'ASCII', '-o', '-', t]).toString()
      .split('\n').filter(Boolean).map((l) => Array.from({ length: l.length / 2 }, (_, i) => l[2 * i] === '#'));
    const v = (ref.length - 17) / 4;
    const cw = QR.interleave(QR.encode(Array.from(new TextEncoder().encode(t)), v), v);
    const same = [0, 1, 2, 3, 4, 5, 6, 7].some((mask) => JSON.stringify(QR.build(cw, v, mask)) === JSON.stringify(ref));
    assert.ok(same, `versión ${v}, ${t.length} caracteres`);
    assert.equal(QR.matrix(t).length, ref.length, 'la misma versión');
  }
});

test('estructura: la versión más chica que entra, buscadores, sincronización y formato M válido', () => {
  for (const [t, v] of [['hola', 1], ['http://192.168.1.10:4700/vincular#AbCdEfGhIjKlMnOp', 4], ['w'.repeat(213), 10]]) {
    const m = QR.matrix(t);
    assert.equal(m.length, 17 + 4 * v);
    const n = m.length;
    for (const [x0, y0] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
      for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
        const d = Math.max(Math.abs(x - 3), Math.abs(y - 3));
        assert.equal(m[y0 + y][x0 + x], d !== 2, `buscador en ${x0},${y0}`);
      }
    }
    for (let i = 8; i < n - 8; i++) { assert.equal(m[6][i], i % 2 === 0); assert.equal(m[i][6], i % 2 === 0); }
    // Formato, junto al buscador de arriba a la izquierda (bit i): sin la máscara 0x5412, nivel M (00) y un BCH(15,5)
    // que cierra.
    const at = (i) => (i <= 5 ? m[i][8] : i === 6 ? m[7][8] : i === 7 ? m[8][8] : i === 8 ? m[8][7] : m[8][14 - i]);
    const bits = Array.from({ length: 15 }, (_, i) => at(i));
    const raw = bits.reduceRight((a, b) => (a << 1) | (b ? 1 : 0), 0) ^ 0x5412;
    let r = raw >>> 10;
    for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    assert.equal(raw >>> 13, 0, 'corrección M');
    assert.equal(((raw >>> 10) << 10) | r, raw, 'BCH del formato');
    assert.equal(m[n - 8][8], true, 'módulo oscuro');
  }
  assert.throws(() => QR.matrix('x'.repeat(214)), /demasiado largo/);
  assert.match(QR.svg('hola', { label: 'a"b' }), /^<svg [^>]*viewBox="0 0 29 29"[^>]*aria-label="a&quot;b"/);
});
