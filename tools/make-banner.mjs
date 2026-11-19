#!/usr/bin/env node
// La imagen de cabecera de los README, docs/images/<idioma>/banner.png: el ícono (el mismo SVG que usan Linux, Windows y
// la web), el nombre en Cinzel y una línea de qué es, con los colores y las fuentes del tema oscuro de la web.
// Se vuelve a correr solo si cambian el ícono, los colores o el texto; los PNG van en el repo.
// Uso: node tools/make-banner.mjs (con las dependencias de hub/ instaladas: dibuja en el Chromium de Playwright).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const SVG = readFileSync(join(REPO, 'hub', 'assets', 'icons', 'hicolor', 'scalable', 'apps', 'scope-compass.svg'), 'utf8');
const font = (file) => `data:font/woff2;base64,${readFileSync(join(REPO, 'web', 'fonts', file)).toString('base64')}`;
const TAGLINE = {
  en: 'A project organizer for video games that keeps its data in git',
  es: 'Un organizador de proyectos de videojuegos que guarda los datos en git',
};
const { chromium } = createRequire(join(REPO, 'hub', 'package.json'))('playwright');

const html = (tagline) => `<!doctype html><meta charset="utf-8"><style>
@font-face { font-family: Cinzel; font-weight: 700; src: url(${font('cinzel-latin-700-normal.woff2')}); }
@font-face { font-family: 'Alegreya Sans'; font-weight: 400; src: url(${font('alegreya-sans-latin-400-normal.woff2')}); }
* { margin: 0; box-sizing: border-box; }
body { width: 1280px; height: 360px; overflow: hidden; display: flex; align-items: center; justify-content: center; gap: 80px;
  background: radial-gradient(ellipse 60% 90% at 30% 50%, #1f252e 0%, #101318 70%); color: #ece5d6; position: relative; }
.ring { position: absolute; border-radius: 50%; border: 1px solid #d9a44126; transform: translate(-50%, -50%); }
.logo { width: 168px; height: 168px; flex: none; filter: drop-shadow(0 0 28px #d9a44155); }
h1 { font: 700 76px/1 Cinzel; letter-spacing: .06em; color: #d9a441; }
p { font: 400 27px/1.3 'Alegreya Sans'; color: #a69d8c; margin-top: 18px; word-spacing: .12em; max-width: 820px; }
</style>
<div class="ring" style="width:230px;height:230px"></div>
<div class="ring" style="width:296px;height:296px;border-style:dashed"></div>
<img class="logo" src="data:image/svg+xml;base64,${Buffer.from(SVG).toString('base64')}">
<div><h1>Scope Compass</h1><p>${tagline}</p></div>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 360 }, deviceScaleFactor: 2 });
for (const [lang, tagline] of Object.entries(TAGLINE)) {
  await page.setContent(html(tagline));
  await page.evaluate(async () => {
    await document.fonts.ready;
    // Los anillos, centrados en el ícono.
    const r = document.querySelector('.logo').getBoundingClientRect();
    for (const ring of document.querySelectorAll('.ring')) Object.assign(ring.style, { left: `${r.x + r.width / 2}px`, top: `${r.y + r.height / 2}px` });
  });
  await page.screenshot({ path: join(REPO, 'docs', 'images', lang, 'banner.png') });
}
await browser.close();
console.log('docs/images/en/banner.png\ndocs/images/es/banner.png');
