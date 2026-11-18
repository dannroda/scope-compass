#!/usr/bin/env node
// El ícono de Windows, hub/assets/icons/scope-compass.ico, desde el mismo SVG que usan Linux y la web
// (hub/assets/icons/hicolor/scalable/apps/scope-compass.svg): lo usan la bandeja de Windows y el acceso directo del menú
// Inicio que crea install.ps1. Se vuelve a correr solo si cambia el SVG; el .ico va en el repo.
// Uso: node tools/make-ico.mjs (con las dependencias de hub/ instaladas: dibuja el SVG en el Chromium de Playwright).
// Tamaños de 16 a 64 como BMP de 32 bits (los que lee System.Drawing.Icon de la bandeja) y 256 como PNG (Explorer).
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const ICONS = join(REPO, 'hub', 'assets', 'icons');
const SVG = readFileSync(join(ICONS, 'hicolor', 'scalable', 'apps', 'scope-compass.svg'), 'utf8');
const BMP_SIZES = [16, 20, 24, 32, 40, 48, 64];
const PNG_SIZE = 256;
const { chromium } = createRequire(join(REPO, 'hub', 'package.json'))('playwright');

const browser = await chromium.launch();
const page = await browser.newPage();
// Cada tamaño se dibuja de nuevo desde el vector (no se achica uno grande): los bordes quedan nítidos.
const drawn = await page.evaluate(async ({ svg, bmp, png }) => {
  const img = new Image();
  img.src = 'data:image/svg+xml;base64,' + btoa(svg);
  await img.decode();
  const canvas = (s) => { const c = document.createElement('canvas'); c.width = c.height = s; c.getContext('2d').drawImage(img, 0, 0, s, s); return c; };
  return {
    rgba: bmp.map((s) => Array.from(canvas(s).getContext('2d').getImageData(0, 0, s, s).data)),
    png: canvas(png).toDataURL('image/png').split(',')[1]
  };
}, { svg: SVG, bmp: BMP_SIZES, png: PNG_SIZE });
await browser.close();

// BMP de 32 bits: BGRA de abajo arriba, más la máscara AND vacía (la transparencia la da el alfa).
const bmpEntry = (s, rgba) => {
  const maskRow = Math.ceil(s / 32) * 4;
  const img = Buffer.alloc(40 + s * s * 4 + maskRow * s);
  img.writeUInt32LE(40, 0); img.writeInt32LE(s, 4); img.writeInt32LE(s * 2, 8);
  img.writeUInt16LE(1, 12); img.writeUInt16LE(32, 14);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const from = (y * s + x) * 4, to = 40 + ((s - 1 - y) * s + x) * 4;
      img[to] = rgba[from + 2]; img[to + 1] = rgba[from + 1]; img[to + 2] = rgba[from]; img[to + 3] = rgba[from + 3];
    }
  }
  return img;
};
const entries = [...BMP_SIZES.map((s, i) => [s, bmpEntry(s, drawn.rgba[i])]), [PNG_SIZE, Buffer.from(drawn.png, 'base64')]];
const head = Buffer.alloc(6 + 16 * entries.length);
head.writeUInt16LE(1, 2); head.writeUInt16LE(entries.length, 4);
let offset = head.length;
entries.forEach(([s, img], i) => {
  const e = 6 + i * 16;
  head[e] = s & 0xff; head[e + 1] = s & 0xff; // 256 se escribe 0
  head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
  head.writeUInt32LE(img.length, e + 8); head.writeUInt32LE(offset, e + 12);
  offset += img.length;
});
const out = join(ICONS, 'scope-compass.ico');
writeFileSync(out, Buffer.concat([head, ...entries.map(([, img]) => img)]));
console.log(`${out} (${entries.map(([s]) => s).join(', ')})`);
