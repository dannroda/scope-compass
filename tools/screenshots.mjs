#!/usr/bin/env node
// Capturas del README y de la landing (m32-08): docs/images/<es|en>/*.png a 1920×1200, con datos de ejemplo.
//
//   node tools/screenshots.mjs [es] [en] [--only board,phone,home,playtest,decisions,dock] [--keep]
//
// Todo pasa en una carpeta temporal: el registro de hubs, la configuración (projects.json, settings.json) y los
// tableros son de esta corrida, así que no aparece ningún proyecto del usuario. Arma tres proyectos con la CLI (un juego,
// uno personal y la web de un estudio), levanta sus hubs y el Inicio con `scompass serve` y `scompass home`, y saca las
// capturas de la web con Playwright. La del dock corre el editor de Godot en Xvfb (como el test de game_shot), con un
// plugin que espera al dock y guarda la ventana. GODOT=<binario> elige el Godot (por defecto, godot del PATH).
import { spawn, execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(REPO, 'hub', 'bin', 'scompass.js');
const W = 1920, H = 1200;
const SHOTS = ['board', 'phone', 'home', 'playtest', 'decisions', 'dock'];

const argv = process.argv.slice(2);
const langs = argv.filter((a) => a === 'es' || a === 'en');
const onlyArg = argv.find((a) => a.startsWith('--only'));
const only = onlyArg ? (onlyArg.includes('=') ? onlyArg.split('=')[1] : argv[argv.indexOf(onlyArg) + 1]).split(',') : SHOTS;
const keep = argv.includes('--keep');
const { chromium } = createRequire(join(REPO, 'hub', 'package.json'))('playwright');

const pad = (n) => String(n).padStart(2, '0');
const day = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const freePort = () => new Promise((resolve) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Datos de ejemplo, en los dos idiomas ----

const DATA = {
  es: {
    game: 'Faro', personalName: 'Casa', studioName: 'Web del estudio', studioMilestone: 'Lanzamiento', studioGoal: 'La web nueva, con la página de prensa del juego.',
    milestones: {
      m00: ['Prototipo', 'Lo mínimo jugable: el farero, la lámpara y una noche entera.'],
      m01: ['Vertical slice', 'Una noche de tormenta completa, con barcos, sonido y guardado.'],
      m02: ['Demo para festival', 'Veinte minutos pulidos para mostrar en un stand.']
    },
    gdd: `# Faro\n<!-- id: faro -->\n\nUn juego de gestión tranquila: cuidás un faro en una isla durante el invierno y guiás a los barcos con el haz de luz.\n\n## Idea\n<!-- id: idea -->\n\nCada noche llegan barcos que no ven la costa. Girás la lámpara, tocás la sirena de niebla y cuidás el aceite hasta el amanecer.\n\n## Tormenta\n<!-- id: tormenta -->\n\nLas olas empujan a los barcos hacia las rocas. El haz los guía, pero la tormenta apaga la lámpara si no cerrás las ventanas.\n\n## Barcos\n<!-- id: barcos -->\n\nSiguen el haz si lo ven durante dos segundos seguidos. Con niebla, solo oyen la sirena.\n`,
    tasks: [
      ['m00', '0.1', 'Movimiento del farero', 'done', { tags: 'gameplay' }],
      ['m00', '0.2', 'Ciclo de día y noche', 'done', { tags: 'gameplay' }],
      ['m00', '0.3', 'Encender y girar la lámpara', 'done', { tags: 'gameplay' }],
      ['m01', '1.1', 'Tormenta: olas que empujan los barcos', 'doing', { tags: 'gameplay', priority: 'high', size: 'l', assignee: 'Lu',
        description: 'Las olas tienen que empujar a los barcos hacia las rocas, más fuerte cuanto más dura la tormenta. Es lo que hace que la noche se sienta peligrosa.' }],
      ['m01', '1.2', 'Barcos que siguen el haz de luz', 'doing', { tags: 'gameplay,ia', priority: 'high', size: 'm', assignee: 'Dani' }],
      ['m01', '1.3', 'Menú de pausa', 'review', { tags: 'ui', size: 's' }],
      ['m01', '1.4', 'Sirena de niebla', 'review', { tags: 'audio', size: 's' }],
      ['m01', '1.5', 'Guardar la partida al amanecer', 'todo', { tags: 'sistema', priority: 'medium', size: 'm', due: day(2) }],
      ['m01', '1.6', 'Bug: el haz atraviesa las rocas', 'todo', { tags: 'bug', priority: 'high', size: 's' }],
      ['m01', '1.7', 'Diario del farero', 'todo', { tags: 'narrativa', size: 'm' }],
      ['m01', '1.8', 'Paleta de colores de la noche', 'paused', { tags: 'arte', size: 's' }],
      ['m01', '1.9', 'Tutorial de la primera noche', 'todo', { tags: 'ui', priority: 'low', size: 'm' }],
      ['m01', '1.10', 'Rendimiento con 40 barcos', 'todo', { tags: 'rendimiento', size: 'm' }],
      ['m02', '2.1', 'Página de la tienda', 'todo', { tags: 'marketing', due: day(20) }],
      ['m02', '2.2', 'Tráiler de 30 segundos', 'todo', { tags: 'marketing' }]
    ],
    steps: [
      ['Fuerza de las olas según la intensidad de la tormenta', true],
      ['Empuje sobre los barcos (RigidBody2D)', true, 'Una fuerza por ola, aplicada en el centro del casco, que se suma al rumbo del barco.'],
      ['Las rocas hunden al barco que choca', false],
      ['Probar con 20 barcos a la vez', false]
    ],
    test: 'Con la tormenta al máximo, un barco sin guía choca contra las rocas en menos de un minuto; uno que sigue el haz llega al puerto.',
    notes: 'La fuerza sale de una curva que se ajusta en el inspector (storm_curve.tres).',
    decisions: [
      ['m1-01', 'Las olas empujan con una fuerza por ola y no con una corriente constante', 'Se siente como golpes, que es lo que pide el GDD; una corriente uniforme se notaba poco.', 'Una corriente global; mover los barcos por un camino.'],
      ['m1-01', '¿La tormenta apaga la lámpara si las ventanas quedan abiertas, o solo baja el alcance?', null, null, true],
      ['m1-02', 'Un barco sigue el haz si lo ve dos segundos seguidos', 'Con uno solo, los barcos giraban cada vez que el haz pasaba de largo.', 'Seguirlo apenas lo ve; un cono de visión por barco.'],
      ['m1-05', 'Se guarda solo al amanecer, sin guardado manual', 'Cada noche es una partida corta; el guardado manual partía la tensión de la noche.', 'Guardar en cualquier momento.'],
      ['m1-04', 'La sirena se oye más lejos con niebla', null, null, true]
    ],
    reviews: [['m1-02', 1, 'ok'], ['m1-05', 1, 'revert', 'Que también guarde al salir del juego.']],
    replies: [['m1-04', 1, 'Sí, el doble de lejos.']],
    playtest: ['Build 0.3', [['m1-03', 'pass', 'Se abre con Esc y con el botón del joystick.'], ['m1-04', 'fail', 'Con niebla no se oye desde el muelle.'], ['m1-02', 'pass'], ['m1-01']]],
    lists: { 'ideas-sueltas': ['Gaviotas que roban el aceite', 'Una radio con el pronóstico del día'], 'assets-a-conseguir': ['Sonido de olas contra las rocas', 'Fuente con trazo de tiza'] },
    personal: { pendientes: [['Pagar el alquiler', day(0)], ['Turno con el dentista', day(0) + 'T16:30'], ['Renovar el pasaporte', day(5)]], compras: [['Yerba'], ['Pan'], ['Pilas AA']] },
    studio: [['Página de prensa', 'doing', day(1)], ['Formulario de contacto', 'todo'], ['Blog: cómo hicimos la tormenta', 'review']]
  },
  en: {
    game: 'Beacon', personalName: 'Home chores', studioName: 'Studio website', studioMilestone: 'Launch', studioGoal: 'The new site, with the game’s press page.',
    milestones: {
      m00: ['Prototype', 'The bare minimum to play: the keeper, the lamp and one full night.'],
      m01: ['Vertical slice', 'One complete stormy night, with ships, sound and saving.'],
      m02: ['Festival demo', 'Twenty polished minutes to show at a booth.']
    },
    gdd: `# Beacon\n<!-- id: beacon -->\n\nA calm management game: you keep a lighthouse on an island through the winter and guide ships with the beam.\n\n## Idea\n<!-- id: idea -->\n\nEvery night ships arrive that can't see the coast. You turn the lamp, sound the foghorn and keep the oil going until dawn.\n\n## Storm\n<!-- id: storm -->\n\nWaves push ships toward the rocks. The beam guides them, but the storm puts the lamp out if you don't close the windows.\n\n## Ships\n<!-- id: ships -->\n\nThey follow the beam if they see it for two seconds in a row. In fog, they only hear the foghorn.\n`,
    tasks: [
      ['m00', '0.1', 'Keeper movement', 'done', { tags: 'gameplay' }],
      ['m00', '0.2', 'Day and night cycle', 'done', { tags: 'gameplay' }],
      ['m00', '0.3', 'Light and turn the lamp', 'done', { tags: 'gameplay' }],
      ['m01', '1.1', 'Storm: waves that push the ships', 'doing', { tags: 'gameplay', priority: 'high', size: 'l', assignee: 'Lu',
        description: 'Waves have to push ships toward the rocks, harder the longer the storm lasts. It is what makes the night feel dangerous.' }],
      ['m01', '1.2', 'Ships that follow the beam', 'doing', { tags: 'gameplay,ai', priority: 'high', size: 'm', assignee: 'Dani' }],
      ['m01', '1.3', 'Pause menu', 'review', { tags: 'ui', size: 's' }],
      ['m01', '1.4', 'Foghorn', 'review', { tags: 'audio', size: 's' }],
      ['m01', '1.5', 'Save the game at dawn', 'todo', { tags: 'systems', priority: 'medium', size: 'm', due: day(2) }],
      ['m01', '1.6', 'Bug: the beam goes through rocks', 'todo', { tags: 'bug', priority: 'high', size: 's' }],
      ['m01', '1.7', "Keeper's journal", 'todo', { tags: 'narrative', size: 'm' }],
      ['m01', '1.8', 'Night color palette', 'paused', { tags: 'art', size: 's' }],
      ['m01', '1.9', 'First night tutorial', 'todo', { tags: 'ui', priority: 'low', size: 'm' }],
      ['m01', '1.10', 'Performance with 40 ships', 'todo', { tags: 'performance', size: 'm' }],
      ['m02', '2.1', 'Store page', 'todo', { tags: 'marketing', due: day(20) }],
      ['m02', '2.2', '30-second trailer', 'todo', { tags: 'marketing' }]
    ],
    steps: [
      ['Wave strength from storm intensity', true],
      ['Push on the ships (RigidBody2D)', true, 'One force per wave, applied at the center of the hull, added to the ship’s heading.'],
      ['Rocks sink a ship that hits them', false],
      ['Test with 20 ships at once', false]
    ],
    test: 'With the storm at full strength, an unguided ship hits the rocks in under a minute; one following the beam reaches the harbor.',
    notes: 'The force comes from a curve tuned in the inspector (storm_curve.tres).',
    decisions: [
      ['m1-01', 'Waves push with one force per wave, not a constant current', 'It feels like blows, which is what the GDD asks for; a uniform current was barely noticeable.', 'A global current; moving ships along a path.'],
      ['m1-01', 'Does the storm put the lamp out if the windows stay open, or only shorten its reach?', null, null, true],
      ['m1-02', 'A ship follows the beam if it sees it for two seconds in a row', 'With one, ships turned every time the beam swept past.', 'Follow it as soon as it is seen; a vision cone per ship.'],
      ['m1-05', 'The game only saves at dawn, with no manual save', 'Each night is a short run; manual saving broke the tension of the night.', 'Saving at any time.'],
      ['m1-04', 'Can the foghorn be heard farther in fog?', null, null, true]
    ],
    reviews: [['m1-02', 1, 'ok'], ['m1-05', 1, 'revert', 'Also save when quitting the game.']],
    replies: [['m1-04', 1, 'Yes, twice as far.']],
    playtest: ['Build 0.3', [['m1-03', 'pass', 'Opens with Esc and with the gamepad button.'], ['m1-04', 'fail', "Can't be heard from the pier in fog."], ['m1-02', 'pass'], ['m1-01']]],
    lists: { 'loose-ideas': ['Seagulls that steal the oil', 'A radio with the day’s forecast'], 'assets-to-get': ['Waves crashing on rocks sound', 'Chalk-stroke font'] },
    personal: { 'to-do': [['Pay the rent', day(0)], ['Dentist appointment', day(0) + 'T16:30'], ['Renew passport', day(5)]], shopping: [['Coffee'], ['Bread'], ['AA batteries']] },
    studio: [['Press kit page', 'doing', day(1)], ['Contact form', 'todo'], ['Blog: how we made the storm', 'review']]
  }
};

// ---- Un entorno aislado ----

async function sandbox(lang) {
  // Una ruta fija y legible: el Inicio muestra la carpeta de cada proyecto.
  const root = join(tmpdir(), 'scompass-demo');
  await rm(root, { recursive: true, force: true });
  await mkdir(join(root, lang === 'es' ? 'Proyectos' : 'Projects'), { recursive: true });
  const env = {
    ...process.env,
    SCOMPASS_REGISTRY: join(root, 'registry'), SCOMPASS_CONFIG: join(root, 'config'), SCOMPASS_DATA: join(root, 'data'),
    XDG_CONFIG_HOME: join(root, 'xdg-config'), XDG_DATA_HOME: join(root, 'xdg-data'), XDG_CACHE_HOME: join(root, 'xdg-cache'),
    // El idioma de cada captura sale del navegador (Accept-Language) o, en el dock, de SCOMPASS_LANG.
    SCOMPASS_LANG: lang, LANG: lang === 'es' ? 'es_AR.UTF-8' : 'en_US.UTF-8'
  };
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.LC_ALL;
  delete env.LC_MESSAGES;
  return { root, projects: join(root, lang === 'es' ? 'Proyectos' : 'Projects'), env, procs: [] };
}

function cli(sb, dir, ...args) {
  return execFileSync(process.execPath, [BIN, '--dir', dir, '--direct', ...args], { env: sb.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

async function buildGame(sb, lang, D) {
  const dir = join(sb.projects, lang === 'es' ? 'faro' : 'beacon');
  await mkdir(dir, { recursive: true });
  cli(sb, dir, 'init', '--project', D.game, '--template', 'juego', '--lang', lang, '--in-project');
  const cfgPath = join(dir, 'compass', 'config.json');
  const cfg = JSON.parse(await readFile(cfgPath, 'utf8'));
  await writeFile(cfgPath, JSON.stringify({ ...cfg, views: ['board', 'playtest', 'decisions', 'lists', 'docs', 'files'] }, null, 2) + '\n');
  await writeFile(join(dir, 'docs', 'gdd.md'), D.gdd);
  for (const [id, [title, goal]] of Object.entries(D.milestones)) {
    const p = join(dir, 'compass', 'milestones', `${id}.json`);
    const m = existsSync(p) ? JSON.parse(await readFile(p, 'utf8')) : { order: Number(id.slice(1)), done_when: [] };
    await writeFile(p, JSON.stringify({ ...m, code: `M${Number(id.slice(1))}`, title, goal, ...(id === 'm01' && { due: day(18) }) }, null, 2) + '\n');
  }
  for (const [ms, code, title, status, o] of D.tasks) {
    const flags = Object.entries(o).map(([k, v]) => `--${k}=${v}`);
    cli(sb, dir, 'add', title, `--milestone=${ms}`, `--code=${code}`, `--status=${status}`, ...flags);
  }
  for (const [text, done, detail] of D.steps) {
    cli(sb, dir, 'step', 'add', 'm1-01', text, ...(detail ? [`--detail=${detail}`] : []));
  }
  D.steps.forEach(([, done], i) => { if (done) cli(sb, dir, 'check', 'm1-01', String(i + 1)); });
  cli(sb, dir, 'set', 'm1-01', `--test=${D.test}`, `--notes=${D.notes}`);
  cli(sb, dir, 'ref', 'add', 'm1-01', `gdd#${lang === 'es' ? 'tormenta' : 'storm'}`);
  cli(sb, dir, 'ref', 'add', 'm1-02', `gdd#${lang === 'es' ? 'barcos' : 'ships'}`);
  cli(sb, dir, 'link', 'add', 'm1-09', 'blocked-by', 'm1-01');
  cli(sb, dir, 'link', 'add', 'm1-06', 'related', 'm1-02');
  for (const [id, text, why, alt, ask] of D.decisions) {
    cli(sb, dir, 'decide', id, text, ...(why ? [`--why=${why}`] : []), ...(alt ? [`--alternatives=${alt}`] : []), ...(ask ? ['--ask'] : []));
  }
  for (const [id, n, review, reply] of D.reviews) cli(sb, dir, 'decision', review, id, String(n), ...(reply ? [`--reply=${reply}`] : []));
  for (const [id, n, reply] of D.replies) cli(sb, dir, 'decision', 'reply', id, String(n), reply);
  const [ptTitle, items] = D.playtest;
  const pt = JSON.parse(cli(sb, dir, '--json', 'playtest', 'new', ptTitle)).id;
  cli(sb, dir, 'playtest', 'add', pt, ...items.map(([t]) => t));
  for (const [t, result, note] of items) if (result) cli(sb, dir, 'playtest', result, pt, t, ...(note ? [`--note=${note}`] : []));
  for (const [list, texts] of Object.entries(D.lists)) for (const t of texts) cli(sb, dir, 'item', 'add', list, t);
  return { dir, playtest: pt };
}

async function buildPersonal(sb, lang, D) {
  const dir = join(sb.projects, lang === 'es' ? 'casa' : 'home-chores');
  await mkdir(dir, { recursive: true });
  cli(sb, dir, 'init', '--project', D.personalName, '--template', 'personal', '--lang', lang, '--in-project');
  for (const [list, items] of Object.entries(D.personal)) for (const [t, due] of items) cli(sb, dir, 'item', 'add', list, t, ...(due ? [`--due=${due}`] : []));
  return dir;
}

async function buildStudio(sb, lang, D) {
  const dir = join(sb.projects, lang === 'es' ? 'web-estudio' : 'studio-site');
  await mkdir(dir, { recursive: true });
  cli(sb, dir, 'init', '--project', D.studioName, '--lang', lang, '--in-project');
  // La plantilla vacía no trae hitos.
  await writeFile(join(dir, 'compass', 'milestones', 'm00.json'), JSON.stringify({ code: 'M0', order: 0, title: D.studioMilestone, goal: D.studioGoal, done_when: [] }, null, 2) + '\n');
  for (const [title, status, due] of D.studio) cli(sb, dir, 'add', title, '--milestone=m00', `--status=${status}`, ...(due ? [`--due=${due}`] : []));
  return dir;
}

// ---- Procesos: hubs e Inicio ----

function start(sb, args, ready) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [BIN, ...args], { env: sb.env, stdio: ['pipe', 'pipe', 'pipe'] });
    sb.procs.push(p);
    let out = '';
    const timer = setTimeout(() => reject(new Error(`${args.join(' ')} no arrancó:\n${out}`)), 20000);
    const on = (d) => { out += d; const m = ready.exec(out); if (m) { clearTimeout(timer); resolve(m); } };
    p.stdout.on('data', on);
    p.stderr.on('data', on);
    p.on('exit', (code) => { clearTimeout(timer); reject(new Error(`${args.join(' ')} salió con ${code}:\n${out}`)); });
  });
}
const serve = async (sb, dir) => { const port = await freePort(); await start(sb, ['--dir', dir, 'serve', '--port', String(port)], /http:\/\/127\.0\.0\.1:\d+/); return `http://127.0.0.1:${port}/`; };
const home = async (sb) => { const port = await freePort(); await start(sb, ['home', '--port', String(port)], /http:\/\/127\.0\.0\.1:\d+/); return `http://127.0.0.1:${port}/`; };

// ---- Web ----

async function page(browser, lang, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, locale: lang === 'es' ? 'es-AR' : 'en-US', colorScheme: 'dark', ...opts });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.error(`  error en la página: ${e.message}`));
  return p;
}
const settle = async (p) => { await p.waitForLoadState('networkidle').catch(() => {}); await wait(600); };

async function webShots(browser, lang, out, { hub, homeUrl, playtest }) {
  if (only.includes('board')) {
    const p = await page(browser, lang);
    await p.goto(`${hub}#task/m1-01`);
    await p.waitForSelector('.card');
    await settle(p);
    await p.screenshot({ path: join(out, 'board.png') });
    await p.context().close();
  }
  if (only.includes('playtest')) {
    const p = await page(browser, lang);
    await p.goto(`${hub}#playtest/${encodeURIComponent(playtest)}`);
    await settle(p);
    // La tarea que falta probar, abierta al costado, como cuando se está probando.
    await p.locator('button.btn.primary', { hasText: lang === 'es' ? 'Abrir la primera sin probar' : 'Open the first untested one' }).click();
    await settle(p);
    await p.screenshot({ path: join(out, 'playtest.png') });
    await p.context().close();
  }
  if (only.includes('decisions')) {
    const p = await page(browser, lang);
    await p.goto(`${hub}#decisions`);
    await settle(p);
    await p.screenshot({ path: join(out, 'decisions.png') });
    await p.context().close();
  }
  if (only.includes('home')) {
    const p = await page(browser, lang);
    await p.goto(homeUrl);
    await p.waitForSelector('.proj h3');
    await settle(p);
    await p.screenshot({ path: join(out, 'home.png') });
    await p.context().close();
  }
  if (only.includes('phone')) {
    // Dos teléfonos lado a lado (el tablero y una tarea abierta) sobre un fondo de 1920×1200.
    const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
    const shots = [];
    for (const hash of ['', '#task/m1-01']) {
      const p = await page(browser, lang, phone);
      await p.goto(hub + hash);
      await p.waitForSelector('.card');
      await settle(p);
      shots.push((await p.screenshot()).toString('base64'));
      await p.context().close();
    }
    const p = await page(browser, lang);
    await p.setContent(`<style>
      html,body{margin:0;height:100%;background:radial-gradient(circle at 50% 30%,#2a3240,#12161d);display:flex;align-items:center;justify-content:center;gap:120px}
      .ph{width:468px;height:1013px;border-radius:56px;background:#05070a;padding:14px;box-shadow:0 30px 80px #0009,inset 0 0 0 2px #333a44}
      .ph img{width:100%;height:100%;border-radius:44px;display:block}
    </style>${shots.map((s) => `<div class="ph"><img src="data:image/png;base64,${s}"></div>`).join('')}`);
    await wait(200);
    await p.screenshot({ path: join(out, 'phone.png') });
    await p.context().close();
  }
}

// ---- Dock de Godot ----

const PROBE = `@tool
extends EditorPlugin

func _enter_tree() -> void:
	_run.call_deferred()

func _run() -> void:
	var lang := OS.get_environment("SHOT_EDITOR_LANG")
	var es := EditorInterface.get_editor_settings()
	if lang != "" and es.get_setting("interface/editor/editor_language") != lang:
		# El idioma del editor se aplica al reabrirlo: lo fija y sale; el script lo vuelve a abrir.
		es.set_setting("interface/editor/editor_language", lang)
		await get_tree().create_timer(1.0).timeout
		print("SHOT relaunch")
		get_tree().quit()
		return
	EditorInterface.open_scene_from_path("res://main.tscn")
	await get_tree().create_timer(2.0).timeout
	EditorInterface.set_main_screen_editor("2D")
	# El dock Tablero comparte la columna de la derecha con el Inspector: se lo trae al frente.
	var dock := _find_dock(EditorInterface.get_base_control())
	if dock:
		dock.make_visible()
		# Más ancha la columna de la derecha, para que se lean los títulos.
		dock.custom_minimum_size.x = 520
	else:
		print("SHOT sin dock")
	await get_tree().create_timer(5.0).timeout
	var img := get_tree().root.get_texture().get_image()
	img.save_png(OS.get_environment("SHOT_OUT"))
	print("SHOT saved ", img.get_width(), "x", img.get_height())
	get_tree().quit()

func _find_dock(n: Node) -> EditorDock:
	if n is EditorDock and n.layout_key == "scope_compass":
		return n
	for c in n.get_children():
		var d := _find_dock(c)
		if d:
			return d
	return null
`;

const SCENE = (n) => `[gd_scene format=3]

[node name="${n[0]}" type="Node2D"]

[node name="${n[1]}" type="ColorRect" parent="."]
offset_right = 900.0
offset_bottom = 620.0
color = Color(0.06, 0.11, 0.2, 1)

[node name="${n[2]}" type="ColorRect" parent="."]
offset_left = 560.0
offset_top = 400.0
offset_right = 780.0
offset_bottom = 620.0
color = Color(0.22, 0.24, 0.27, 1)

[node name="${n[3]}" type="ColorRect" parent="."]
offset_left = 645.0
offset_top = 190.0
offset_right = 690.0
offset_bottom = 400.0
color = Color(0.92, 0.9, 0.84, 1)

[node name="${n[4]}" type="Polygon2D" parent="."]
color = Color(1, 0.86, 0.45, 0.35)
polygon = PackedVector2Array(667, 205, 60, 110, 60, 300)
`;

async function dockShot(sb, lang, game, out) {
  const GODOT = process.env.GODOT || 'godot';
  // El proyecto del juego se vuelve un proyecto de Godot con el addon y un plugin que saca la captura.
  await cp(join(REPO, 'addons', 'scope_compass'), join(game, 'addons', 'scope_compass'), { recursive: true });
  await mkdir(join(game, 'addons', 'shot'), { recursive: true });
  await writeFile(join(game, 'addons', 'shot', 'plugin.cfg'), '[plugin]\nname="shot"\ndescription=""\nauthor=""\nversion="0"\nscript="shot.gd"\n');
  await writeFile(join(game, 'addons', 'shot', 'shot.gd'), PROBE);
  await writeFile(join(game, 'main.tscn'), SCENE(lang === 'es' ? ['Isla', 'Mar', 'Roca', 'Faro', 'Luz'] : ['Island', 'Sea', 'Rock', 'Lighthouse', 'Beam']));
  await writeFile(join(game, 'project.godot'), `config_version=5\n\n[application]\nconfig/name="${DATA[lang].game}"\nrun/main_scene="res://main.tscn"\n\n[display]\nwindow/size/viewport_width=1280\nwindow/size/viewport_height=720\n\n[editor_plugins]\nenabled=PackedStringArray("res://addons/scope_compass/plugin.cfg", "res://addons/shot/plugin.cfg")\n\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n`);
  await cp(join(REPO, '.godot-version'), join(game, '.godot-version')).catch(() => {});
  execFileSync(GODOT, ['--headless', '--path', game, '--import'], { stdio: 'pipe', timeout: 180000, env: sb.env });
  // Con su hub corriendo, como cuando se trabaja: en otro puerto que el de la config (4711 puede ser el del usuario).
  const cfgPath = join(game, 'compass', 'config.json');
  const port = await freePort();
  await writeFile(cfgPath, JSON.stringify({ ...JSON.parse(await readFile(cfgPath, 'utf8')), port }, null, 2) + '\n');
  await start(sb, ['--dir', game, 'serve', '--port', String(port)], /http:\/\/127\.0\.0\.1:\d+/);
  const env = { ...sb.env, SHOT_OUT: join(out, 'dock.png'), SHOT_EDITOR_LANG: lang };
  for (let i = 0; i < 2; i++) {
    const log = await new Promise((resolve) => {
      const p = spawn('xvfb-run', ['-a', '-s', `-screen 0 ${W}x${H}x24`, GODOT, '--path', game, '--editor', '--resolution', `${W}x${H}`, '--position', '0,0'], { cwd: game, env });
      let s = '';
      p.stdout.on('data', (d) => { s += d; });
      p.stderr.on('data', (d) => { s += d; });
      const t = setTimeout(() => p.kill('SIGKILL'), 120000);
      p.on('exit', () => { clearTimeout(t); resolve(s); });
    });
    if (/SHOT saved/.test(log)) return;
    if (!/SHOT relaunch/.test(log)) throw new Error(`el editor no sacó la captura del dock:\n${log.slice(-3000)}`);
  }
  throw new Error('el editor no sacó la captura del dock');
}

// ---- Todo junto ----

async function shoot(lang) {
  const D = DATA[lang];
  const out = join(REPO, 'docs', 'images', lang);
  await mkdir(out, { recursive: true });
  const sb = await sandbox(lang);
  console.log(`${lang}: datos de ejemplo en ${sb.root}`);
  try {
    const game = await buildGame(sb, lang, D);
    await buildPersonal(sb, lang, D);
    await buildStudio(sb, lang, D);
    const web = only.some((s) => s !== 'dock');
    if (web) {
      // El SCOMPASS_LANG del entorno es para la CLI y el dock; la web sigue al navegador.
      const webEnv = { ...sb, env: { ...sb.env, SCOMPASS_LANG: '' } };
      const hub = await serve(webEnv, game.dir);
      const homeUrl = only.includes('home') ? await home(webEnv) : null;
      const browser = await chromium.launch();
      try {
        await webShots(browser, lang, out, { hub, homeUrl, playtest: game.playtest });
      } finally {
        await browser.close();
      }
      for (const p of sb.procs.splice(0)) p.kill('SIGTERM');
      await wait(500);
    }
    if (only.includes('dock')) await dockShot(sb, lang, game.dir, out);
    console.log(`${lang}: ${only.join(', ')} → ${out}`);
  } finally {
    for (const p of sb.procs) p.kill('SIGKILL');
    if (!keep) await rm(sb.root, { recursive: true, force: true, maxRetries: 10 });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const lang of langs.length ? langs : ['es', 'en']) await shoot(lang);
}
