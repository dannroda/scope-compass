// Generador de QR propio, sin librería (§49, D60): para el enlace de Vincular teléfono. Modo byte (UTF-8), corrección M
// y versiones 1 a 10 (hasta 213 bytes: una dirección de la red con el código entra en la 3 o la 4). Sigue ISO/IEC 18004:
// Reed-Solomon sobre GF(256), bloques intercalados, patrones fijos, información de formato y de versión, y la máscara
// con menos penalidad. QR.matrix(text) da las filas (true = oscuro); QR.svg(text) un <svg> con 4 módulos de margen.
(function (root) {
  // Por versión, con corrección M: codewords en total, bloques y codewords de corrección por bloque.
  const TOTAL = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346];
  const BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
  const ECC = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
  const ALIGN = [[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
  const M_BITS = 0; // corrección M en la información de formato
  const MAX_VERSION = 10;

  // Multiplicación en GF(256) con el polinomio 0x11D.
  function mul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xff;
  }
  // Divisor de Reed-Solomon de grado n: el producto de (x - 2^i), sin el coeficiente principal.
  function divisor(n) {
    const out = new Array(n).fill(0);
    out[n - 1] = 1;
    let r = 1;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        out[j] = mul(out[j], r);
        if (j + 1 < n) out[j] ^= out[j + 1];
      }
      r = mul(r, 0x02);
    }
    return out;
  }
  function remainder(data, div) {
    const out = div.map(() => 0);
    for (const b of data) {
      const f = b ^ out.shift();
      out.push(0);
      div.forEach((c, i) => { out[i] ^= mul(c, f); });
    }
    return out;
  }

  // Los bytes de datos de la versión v: modo byte, largo, datos, terminador y relleno 0xEC 0x11.
  function encode(bytes, v) {
    const cap = TOTAL[v] - BLOCKS[v] * ECC[v];
    const bits = [];
    const put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    put(0b0100, 4);
    put(bytes.length, v < 10 ? 8 : 16);
    for (const b of bytes) put(b, 8);
    put(0, Math.min(4, cap * 8 - bits.length));
    while (bits.length % 8) bits.push(0);
    const out = [];
    for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
    for (let pad = 0xec; out.length < cap; pad ^= 0xec ^ 0x11) out.push(pad);
    return out;
  }
  // Partir en bloques, agregar la corrección e intercalar: primero los datos columna por columna, después la corrección.
  function interleave(data, v) {
    const n = BLOCKS[v], ecc = ECC[v];
    const short = Math.floor(TOTAL[v] / n) - ecc; // datos de un bloque corto
    const longs = TOTAL[v] % n; // los últimos `longs` bloques llevan un byte más
    const div = divisor(ecc);
    const blocks = [];
    for (let i = 0, k = 0; i < n; i++) {
      const len = short + (i >= n - longs ? 1 : 0);
      const d = data.slice(k, k + len);
      k += len;
      blocks.push({ d, e: remainder(d, div) });
    }
    const out = [];
    for (let i = 0; i <= short; i++) for (const b of blocks) if (i < b.d.length) out.push(b.d[i]);
    for (let i = 0; i < ecc; i++) for (const b of blocks) out.push(b.e[i]);
    return out;
  }

  function build(codewords, v, mask) {
    const size = 17 + 4 * v;
    const m = Array.from({ length: size }, () => new Array(size).fill(false));
    const fixed = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (x, y, dark) => { m[y][x] = dark; fixed[y][x] = true; };
    // Patrones de sincronización.
    for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    // Buscadores, con su separador.
    for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
      }
    }
    // Alineación, salvo donde están los buscadores.
    const al = ALIGN[v], last = al.length - 1;
    for (let i = 0; i <= last; i++) for (let j = 0; j <= last; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
    // Información de formato: corrección y máscara, BCH(15,5) y la máscara fija 0x5412.
    const fmt = (M_BITS << 3) | mask;
    let r = fmt;
    for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const fb = ((fmt << 10) | r) ^ 0x5412;
    const bit = (val, i) => ((val >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) set(8, i, bit(fb, i));
    set(8, 7, bit(fb, 6));
    set(8, 8, bit(fb, 7));
    set(7, 8, bit(fb, 8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(fb, i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(fb, i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(fb, i));
    set(8, size - 8, true);
    // Información de versión (7 en adelante): BCH(18,6).
    if (v >= 7) {
      let vr = v;
      for (let i = 0; i < 12; i++) vr = (vr << 1) ^ ((vr >>> 11) * 0x1f25);
      const vb = (v << 12) | vr;
      for (let i = 0; i < 18; i++) {
        const a = size - 11 + (i % 3), b = Math.floor(i / 3);
        set(a, b, bit(vb, i));
        set(b, a, bit(vb, i));
      }
    }
    // Los datos, en zigzag de a dos columnas desde abajo a la derecha, salteando la columna de sincronización.
    let k = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      const up = ((right + 1) & 2) === 0;
      for (let vert = 0; vert < size; vert++) {
        const y = up ? size - 1 - vert : vert;
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          if (fixed[y][x]) continue;
          if (k < codewords.length * 8) m[y][x] = bit(codewords[k >>> 3], 7 - (k & 7));
          k++;
        }
      }
    }
    // La máscara, solo sobre los datos.
    const MASKS = [
      (x, y) => (x + y) % 2 === 0,
      (x, y) => y % 2 === 0,
      (x) => x % 3 === 0,
      (x, y) => (x + y) % 3 === 0,
      (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
      (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
      (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
      (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
    ];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fixed[y][x] && MASKS[mask](x, y)) m[y][x] = !m[y][x];
    return m;
  }

  // Penalidad de ISO/IEC 18004 §7.8.3, para elegir la máscara.
  function penalty(m) {
    const size = m.length;
    let p = 0, dark = 0;
    const lines = [];
    for (let i = 0; i < size; i++) { lines.push(m[i]); lines.push(m.map((row) => row[i])); }
    const finder = [true, false, true, true, true, false, true];
    for (const line of lines) {
      for (let i = 0, run = 1; i < size; i++) {
        if (i + 1 < size && line[i + 1] === line[i]) { run++; continue; }
        if (run >= 5) p += 3 + (run - 5);
        run = 1;
      }
      // 1:1:3:1:1 con cuatro claros de un lado (afuera del símbolo cuenta como claro).
      for (let i = -4; i < size; i++) {
        if (!finder.every((f, j) => (line[i + j] ?? false) === f)) continue;
        const light = (from) => [0, 1, 2, 3].every((j) => !(line[from + j] ?? false));
        if (light(i - 4) || light(i + 7)) p += 40;
      }
    }
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (m[y][x]) dark++;
      if (x + 1 < size && y + 1 < size && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3;
    }
    const total = size * size;
    p += Math.max(0, Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return p;
  }

  function matrix(text) {
    const bytes = Array.from(new TextEncoder().encode(String(text)));
    let v = 1;
    while (v <= MAX_VERSION && 4 + (v < 10 ? 8 : 16) + bytes.length * 8 > (TOTAL[v] - BLOCKS[v] * ECC[v]) * 8) v++;
    if (v > MAX_VERSION) throw new Error('QR: el texto es demasiado largo');
    const cw = interleave(encode(bytes, v), v);
    let best = null, bestP = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      const m = build(cw, v, mask);
      const p = penalty(m);
      if (p < bestP) { best = m; bestP = p; }
    }
    return best;
  }

  function svg(text, { label = '' } = {}) {
    const m = matrix(text);
    const q = 4, n = m.length + 2 * q;
    let d = '';
    m.forEach((row, y) => row.forEach((dark, x) => { if (dark) d += `M${x + q} ${y + q}h1v1h-1z`; }));
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" role="img"${label ? ` aria-label="${esc(label)}"` : ''}><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  }

  const api = { matrix, svg };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QR = api;
})(typeof window !== 'undefined' ? window : globalThis);
