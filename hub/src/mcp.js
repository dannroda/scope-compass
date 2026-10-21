// `scompass mcp` (spec §30, D41): servidor MCP por stdio, JSON-RPC 2.0 con un mensaje por línea. Cada herramienta
// arma los argumentos de un comando de la CLI y llama a run() con --json, una por vez: valida, pasa por el hub y
// regenera el export igual que la CLI. stdout es solo del protocolo; los avisos van por stderr.
import { createInterface } from 'node:readline';
import { run } from './cli.js';
import { VERSION } from './server.js';
import { DECISION_STATES } from './decisions.js';

// La más nueva primero: si el cliente pide una que no está, se le ofrece esa.
const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

const INSTRUCTIONS = `Tablero de tareas del proyecto (compass/, formato de Scope Compass). Estas herramientas son la CLI scompass: usalas en lugar de correr scompass por Bash.
- Hitos con id m00, m01…; tareas con id m5-12 (o ids viejos al azar). Estados: todo (Pendiente), paused, doing, review, done.
- Al empezar una tarea, move_task a doing; al avanzar, check_step (pasos desde 1, como los muestra show_task); al terminar, completá test y notes con update_task y pasala a review.
- Trabajo nuevo que aparece: add_task con description (qué y por qué). Si una tarea depende de otra, add_link en lugar de anotarlo.
- Cada vez que elijas entre alternativas razonables que el usuario podría haber querido distinto (formato, nombre visible, dejar algo afuera, una dependencia, un comportamiento por defecto), registralo con add_decision (why, alternatives); si le preguntaste, con ask y después reply_decision con la respuesta. Antes de seguir una tarea, mirá si tiene decisiones a revertir (list_decisions con states revert): deshacelas y marcalas reverted con review_decision.
- Las escrituras devuelven la tarea con su etag; pasalo en etag para no pisar un cambio ajeno (si cambió, falla con conflicto: volvé a leerla).
- Los cambios quedan como archivos modificados en compass/: commitealos solo si te lo piden.
- dir opera sobre otro proyecto (la carpeta que tiene compass/).`;

const STATUSES = ['todo', 'paused', 'doing', 'review', 'done'];
const str = (description, extra) => ({ type: 'string', description, ...extra });
const strs = (description, items = { type: 'string' }) => ({ type: 'array', items, description });
const int = (description) => ({ type: 'integer', minimum: 1, description });
const bool = (description) => ({ type: 'boolean', description });
const ID = str('id de la tarea (m5-02)');
const ETAG = str('etag que devolvió la última lectura: si la tarea cambió desde entonces, falla con conflicto');
const DIR = str('carpeta de otro proyecto (la que tiene compass/); por defecto, el de esta sesión');
const DUE = 'fecha límite, YYYY-MM-DD o YYYY-MM-DDTHH:MM (hora local)';

// Opciones de la CLI: --nombre=valor (así un valor que empieza con - no se toma por otra opción), listas con comas,
// true como bandera sola; undefined no se pasa.
const opts = (a, names) => names.flatMap(([key, flag = key.replace(/_/g, '-')]) => {
  const v = a[key];
  if (v === undefined || v === null || v === false) return [];
  if (v === true) return [`--${flag}`];
  return [`--${flag}=${Array.isArray(v) ? v.join(',') : v}`];
});
const named = (...keys) => keys.map((k) => [k]);

// name, description, inputSchema.properties, required, solo lectura, y los argumentos de la CLI: [opciones, posicionales].
const TOOLS = [
  { name: 'list_tasks', read: true, description: 'Tareas, por hito y en orden, con id, etag, estado, pasos y vínculos. Sin filtros, todas.',
    props: { milestone: str('id del hito (m05)'), status: strs('estados', { enum: STATUSES }), q: str('todas las palabras en código, título o id, sin tildes ni mayúsculas'),
      due: str('vencimiento', { enum: ['overdue', 'today', 'week', 'none'] }), blocked: bool('true: solo bloqueadas; false: solo sin bloquear'),
      pending_steps: bool('solo con pasos sin tildar'), with_refs: bool('solo con referencias a documentos'), tags: strs('con alguna de estas etiquetas'),
      priority: strs('prioridades', { enum: ['high', 'medium', 'low', 'none'] }), size: strs('estimaciones', { enum: ['s', 'm', 'l', 'none'] }), assignee: strs('responsables (none: sin responsable)'),
      decisions: strs('con alguna decisión en estos estados: open (pregunta sin respuesta), pending (tomada sin consultar, sin revisar), revert (a revertir)', { enum: DECISION_STATES }) },
    argv: (a) => [[...opts(a, [...named('milestone', 'status', 'q', 'due', 'pending_steps', 'with_refs', 'priority', 'size', 'assignee', 'decisions'), ['tags', 'tag']]),
      ...(a.blocked === true ? ['--blocked'] : a.blocked === false ? ['--unblocked'] : [])], ['list']] },
  { name: 'show_task', read: true, description: 'Una tarea entera, con su etag.', props: { id: ID }, required: ['id'], argv: (a) => [[], ['show', a.id]] },
  { name: 'task_history', read: true, description: 'Qué cambió en la tarea en cada commit de git, y lo que hay sin commitear.', props: { id: ID }, required: ['id'], argv: (a) => [[], ['history', a.id]] },
  { name: 'list_milestones', read: true, description: 'Hitos, en orden.', props: {}, argv: () => [[], ['milestone', 'list']] },
  { name: 'show_milestone', read: true, description: 'Un hito: objetivo, criterios de terminado (done_when) y fecha objetivo.', props: { id: str('id del hito (m05)') }, required: ['id'], argv: (a) => [[], ['milestone', 'show', a.id]] },
  { name: 'list_links', read: true, description: 'Vínculos (bloquea, bloqueada por, relacionada) de una tarea, o de todas; broken lista los que apuntan a tareas que no existen.',
    props: { id: str('id de la tarea; sin él, todas') }, argv: (a) => [[], ['link', 'list', ...(a.id ? [a.id] : [])]] },
  { name: 'list_playtests', read: true, description: 'Sesiones de playtest.', props: {}, argv: () => [[], ['playtest', 'list']] },
  { name: 'show_playtest', read: true, description: 'Una sesión de playtest: las tareas en el orden de prueba (el resultado está en cada tarea, en playtest).',
    props: { session: str('id de la sesión') }, required: ['session'], argv: (a) => [[], ['playtest', 'show', a.session]] },
  { name: 'list_decisions', read: true, description: 'Decisiones de todo el proyecto, la más nueva primero, con su tarea, su número (n) y su estado. Sin states, todas.',
    props: { states: strs('open (pregunta sin respuesta), pending (tomada sin consultar, sin revisar), revert (a revertir)', { enum: DECISION_STATES }), milestone: str('id del hito (m05)') },
    argv: (a) => [[...opts(a, named('milestone')), ...(a.states ?? []).map((x) => `--${x}`)], ['decisions']] },
  { name: 'list_docs', read: true, description: 'Documentos del proyecto (los de config.json) con su índice de secciones.', props: {}, argv: () => [[], ['doc', 'list']] },
  { name: 'search_docs', read: true, description: 'Líneas de los documentos con todas las palabras (sin tildes ni mayúsculas), con la sección donde está cada una.',
    props: { text: str('texto a buscar') }, required: ['text'], argv: (a) => [[], ['doc', 'search', a.text]] },
  { name: 'show_doc', read: true, description: 'Un documento entero (alias) o una sección (alias#id), en markdown.',
    props: { ref: str('alias o alias#id-de-sección (list_docs los muestra)') }, required: ['ref'], argv: (a) => [[], ['doc', 'show', a.ref]] },

  { name: 'add_task', description: 'Crea una tarea en un hito (el id sale solo: siguiente número del hito). Con una etiqueta que tiene plantilla y sin description, la descripción arranca con la plantilla.',
    props: { title: str('título'), milestone: str('id del hito (m05)'), code: str('número visible (5.9)'), status: str('estado inicial (todo por defecto)', { enum: STATUSES }),
      description: str('qué hay que hacer y por qué'), due: str(DUE), tags: strs('etiquetas (usá las que ya existen)'), priority: str('prioridad', { enum: ['high', 'medium', 'low'] }),
      size: str('estimación', { enum: ['s', 'm', 'l'] }), assignee: str('responsable') },
    required: ['title', 'milestone'], argv: (a) => [opts(a, named('milestone', 'code', 'status', 'description', 'due', 'tags', 'priority', 'size', 'assignee')), ['add', a.title]] },
  { name: 'update_task', description: 'Cambia solo los campos que se pasan. "" quita description, due, tags, priority, size o assignee.',
    props: { id: ID, title: str('título'), description: str('qué y por qué (el pedido)'), notes: str('lo que va saliendo al trabajarla: decisiones, hallazgos, lo que el siguiente necesita saber'),
      test: str('cómo se comprueba que está terminada'), code: str('número visible'), milestone: str('id del hito al que se mueve'), status: str('estado', { enum: STATUSES }),
      due: str(DUE), tags: strs('etiquetas (reemplaza la lista; [] las quita)'), priority: str('prioridad', { enum: ['high', 'medium', 'low', ''] }),
      size: str('estimación', { enum: ['s', 'm', 'l', ''] }), assignee: str('responsable'), etag: ETAG },
    required: ['id'], argv: (a) => [opts(a, named('title', 'description', 'notes', 'test', 'code', 'milestone', 'status', 'due', 'tags', 'priority', 'size', 'assignee', 'etag')), ['set', a.id]] },
  { name: 'move_task', description: 'Cambia el estado de una tarea.', props: { id: ID, status: str('estado nuevo', { enum: STATUSES }), etag: ETAG },
    required: ['id', 'status'], argv: (a) => [opts(a, named('etag')), ['move', a.id, a.status]] },
  { name: 'add_step', description: 'Agrega un paso al final del checklist.', props: { id: ID, text: str('una línea corta'), detail: str('el cómo y el porqué'), etag: ETAG },
    required: ['id', 'text'], argv: (a) => [opts(a, named('detail', 'etag')), ['step', 'add', a.id, a.text]] },
  { name: 'update_step', description: 'Cambia el texto o el detalle de un paso ("" en detail lo quita).', props: { id: ID, n: int('número de paso, desde 1'), text: str('texto'), detail: str('detalle'), etag: ETAG },
    required: ['id', 'n'], argv: (a) => [opts(a, named('text', 'detail', 'etag')), ['step', 'set', a.id, String(a.n)]] },
  { name: 'remove_step', description: 'Quita un paso.', props: { id: ID, n: int('número de paso, desde 1'), etag: ETAG },
    required: ['id', 'n'], argv: (a) => [opts(a, named('etag')), ['step', 'rm', a.id, String(a.n)]] },
  { name: 'check_step', description: 'Tilda un paso (undo: lo destilda).', props: { id: ID, n: int('número de paso, desde 1'), undo: bool('destildarlo'), etag: ETAG },
    required: ['id', 'n'], argv: (a) => [opts(a, named('undo', 'etag')), ['check', a.id, String(a.n)]] },
  { name: 'add_decision', description: 'Registra una decisión en la tarea: sin ask, la tomaste sin consultar (queda sin revisar hasta que el usuario la revisa); con ask, es una pregunta al usuario (queda abierta hasta que responde).',
    props: { id: ID, text: str('qué decidiste, en una línea; con ask, la pregunta'), why: str('por qué'), alternatives: str('qué descartaste'), ask: bool('es una pregunta al usuario'), etag: ETAG },
    required: ['id', 'text'], argv: (a) => [opts(a, named('why', 'alternatives', 'ask', 'etag')), ['decide', a.id, a.text]] },
  { name: 'review_decision', description: 'Revisa una decisión tomada sin consultar: ok, revert (a revertir; reply dice qué hacer) o reverted (ya la deshiciste). Las preguntas se responden con reply_decision.',
    props: { id: ID, n: int('número de decisión, desde 1'), review: str('revisión', { enum: ['ok', 'revert', 'reverted'] }), reply: str('qué hacer en su lugar'), etag: ETAG },
    required: ['id', 'n', 'review'], argv: (a) => [opts(a, named('reply', 'etag')), ['decision', a.review, a.id, String(a.n)]] },
  { name: 'reply_decision', description: 'Responde una pregunta abierta de la tarea.', props: { id: ID, n: int('número de decisión, desde 1'), reply: str('la respuesta'), etag: ETAG },
    required: ['id', 'n', 'reply'], argv: (a) => [opts(a, named('etag')), ['decision', 'reply', a.id, String(a.n), a.reply]] },
  { name: 'promote_decision', description: 'Agrega una decisión resuelta (revisada con ok o pregunta respondida) como entrada D-n al final del documento de decisiones del proyecto, y la marca en la tarea. Solo si el usuario lo pide o si es una decisión de diseño que cambia la spec.',
    props: { id: ID, n: int('número de decisión, desde 1') }, required: ['id', 'n'], argv: (a) => [[], ['decision', 'promote', a.id, String(a.n)]] },
  { name: 'remove_decision', description: 'Quita una decisión de la tarea.', props: { id: ID, n: int('número de decisión, desde 1'), etag: ETAG },
    required: ['id', 'n'], argv: (a) => [opts(a, named('etag')), ['decision', 'rm', a.id, String(a.n)]] },
  { name: 'add_link', description: 'Vincula dos tareas (reemplaza el vínculo que tuvieran). blocked-by: id no puede avanzar hasta que other esté hecha.',
    props: { id: ID, type: str('tipo', { enum: ['blocks', 'blocked-by', 'related'] }), other: str('id de la otra tarea') },
    required: ['id', 'type', 'other'], argv: (a) => [[], ['link', 'add', a.id, a.type, a.other]] },
  { name: 'remove_link', description: 'Quita el vínculo entre dos tareas.', props: { id: ID, other: str('id de la otra tarea') },
    required: ['id', 'other'], argv: (a) => [[], ['link', 'rm', a.id, a.other]] },
  { name: 'add_ref', description: 'Agrega una referencia a un documento entero (alias) o a una sección (alias#id).', props: { id: ID, ref: str('alias o alias#id'), etag: ETAG },
    required: ['id', 'ref'], argv: (a) => [opts(a, named('etag')), ['ref', 'add', a.id, a.ref]] },
  { name: 'remove_ref', description: 'Quita una referencia.', props: { id: ID, ref: str('alias o alias#id'), etag: ETAG },
    required: ['id', 'ref'], argv: (a) => [opts(a, named('etag')), ['ref', 'rm', a.id, a.ref]] },
  { name: 'add_file', description: 'Vincula un archivo del repo a la tarea (un script, una escena; ruta desde la raíz o res://).', props: { id: ID, path: str('ruta'), etag: ETAG },
    required: ['id', 'path'], argv: (a) => [opts(a, named('etag')), ['file', 'add', a.id, a.path]] },
  { name: 'remove_file', description: 'Desvincula un archivo de la tarea.', props: { id: ID, path: str('ruta'), etag: ETAG },
    required: ['id', 'path'], argv: (a) => [opts(a, named('etag')), ['file', 'rm', a.id, a.path]] },
  { name: 'set_playtest_result', description: 'Anota cómo salió la prueba de una tarea de una sesión: pass (anda), fail (falla) o reset (sin probar). Se guarda en la tarea.',
    props: { session: str('id de la sesión'), task: str('id de la tarea o su posición en la sesión'), result: str('resultado', { enum: ['pass', 'fail', 'reset'] }), note: str('lo que se vio ("" la quita)') },
    required: ['session', 'task', 'result'], argv: (a) => [opts(a, named('note')), ['playtest', a.result, a.session, String(a.task)]] }
];

const toolList = TOOLS.map((t) => ({
  name: t.name, description: t.description,
  inputSchema: { type: 'object', properties: { ...t.props, dir: DIR }, ...(t.required && { required: t.required }), additionalProperties: false },
  annotations: { readOnlyHint: !!t.read, destructiveHint: false, openWorldHint: false }
}));

class RpcError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export async function serveMcp({ project, stdin = process.stdin, out = process.stdout, err = process.stderr }) {
  // Algo que escriba con console.log rompería el protocolo: va a stderr.
  if (out === process.stdout) console.log = console.info = console.debug = console.error;

  // Una llamada a la CLI por vez, como alguien que corre comandos de a uno.
  let queue = Promise.resolve();
  const cli = (argv, dir) => {
    const job = queue.then(async () => {
      let o = '', e = '';
      const code = await run([`--dir=${dir ?? project}`, '--json', ...argv], { cwd: project, stdin: null, out: { write: (s) => { o += s; } }, err: { write: (s) => { e += s; } } });
      return { code, out: o.trim(), err: e.trim() };
    });
    queue = job.catch(() => {});
    return job;
  };
  // El mensaje de error de la CLI: el JSON de --json, o el texto de un error de uso sin la ayuda entera.
  const failure = (r) => {
    try { const { error } = JSON.parse(r.err.split('\n').at(-1)); return `error [${error.code}]: ${error.message}`; } catch { /* texto */ }
    return r.err.split('\n\nUso:')[0] || `scompass salió con ${r.code}`;
  };

  async function callTool({ name, arguments: a = {} }) {
    const t = TOOLS.find((x) => x.name === name);
    if (!t) throw new RpcError(-32602, `herramienta desconocida: ${name}`);
    for (const k of t.required ?? []) if (a[k] === undefined) return { content: [{ type: 'text', text: `falta ${k}` }], isError: true };
    const [flags, positional] = t.argv(a);
    // Las opciones antes de --, así un título que empieza con - es un título.
    const r = await cli([...flags, '--', ...positional], a.dir);
    // link list sale con 1 si hay vínculos rotos, pero contesta igual: vale lo que haya en stdout.
    if (!r.out) return { content: [{ type: 'text', text: failure(r) }], isError: true };
    const content = [{ type: 'text', text: r.out }];
    // Avisos de la CLI (hub de otra versión, archivos inválidos): sin el JSON de error, que no lo hay.
    if (r.err) content.push({ type: 'text', text: r.err });
    let data;
    try { data = JSON.parse(r.out); } catch { /* no es JSON */ }
    return { content, ...(data && typeof data === 'object' && !Array.isArray(data) && { structuredContent: data }) };
  }

  // Recursos (22.5): para adjuntar con @ en Claude Code.
  async function listResources() {
    const [ms, docs] = await Promise.all([cli(['milestone', 'list']), cli(['doc', 'list'])]);
    const parse = (r, key) => { try { return JSON.parse(r.out)[key] ?? []; } catch { return []; } };
    return {
      resources: [
        ...parse(ms, 'milestones').map((m) => ({ uri: `compass://milestone/${m.id}`, name: `${m.code} · ${m.title}`, description: m.goal, mimeType: 'application/json' })),
        ...parse(docs, 'docs').map((d) => ({ uri: `compass://doc/${encodeURIComponent(d.alias)}`, name: d.alias, description: d.path, mimeType: 'text/markdown' }))
      ]
    };
  }
  async function readResource({ uri }) {
    const m = /^compass:\/\/(milestone|task|doc)\/(.+)$/.exec(uri ?? '');
    if (!m) throw new RpcError(-32002, `recurso desconocido: ${uri}`);
    const id = decodeURIComponent(m[2]);
    const must = (r) => { if (r.code !== 0 || !r.out) throw new RpcError(-32002, failure(r)); return JSON.parse(r.out); };
    let text, mimeType = 'application/json';
    if (m[1] === 'task') text = JSON.stringify(must(await cli(['--', 'show', id])));
    else if (m[1] === 'milestone') {
      const ms = must(await cli(['--', 'milestone', 'show', id]));
      const { tasks } = must(await cli([`--milestone=${id}`, '--', 'list']));
      text = JSON.stringify({ ...ms, tasks });
    } else {
      text = must(await cli(['--', 'doc', 'show', id])).markdown;
      mimeType = 'text/markdown';
    }
    return { contents: [{ uri, mimeType, text }] };
  }
  const templates = { resourceTemplates: [
    { uriTemplate: 'compass://task/{id}', name: 'Tarea', description: 'Una tarea entera, con su etag (id: m5-02)', mimeType: 'application/json' },
    { uriTemplate: 'compass://milestone/{id}', name: 'Hito', description: 'Un hito con sus tareas (id: m05)', mimeType: 'application/json' },
    { uriTemplate: 'compass://doc/{ref}', name: 'Documento', description: 'Un documento (alias) o una sección (alias#id), en markdown', mimeType: 'text/markdown' }
  ] };

  const methods = {
    initialize: (p) => ({
      protocolVersion: PROTOCOLS.includes(p?.protocolVersion) ? p.protocolVersion : PROTOCOLS[0],
      capabilities: { tools: {}, resources: {} },
      serverInfo: { name: 'scope-compass', title: 'Scope Compass', version: VERSION },
      instructions: INSTRUCTIONS
    }),
    ping: () => ({}),
    'tools/list': () => ({ tools: toolList }),
    'tools/call': callTool,
    'resources/list': listResources,
    'resources/templates/list': () => templates,
    'resources/read': readResource
  };

  const send = (msg) => out.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
  async function handle(line) {
    let msg;
    try { msg = JSON.parse(line); } catch { return send({ id: null, error: { code: -32700, message: 'JSON inválido' } }); }
    const { id, method, params } = msg ?? {};
    // Notificaciones (initialized, cancelled) y respuestas: no se contestan.
    if (id === undefined || method === undefined) return;
    const fn = Object.hasOwn(methods, method) ? methods[method] : null;
    if (!fn) return send({ id, error: { code: -32601, message: `método desconocido: ${method}` } });
    try {
      send({ id, result: await fn(params) });
    } catch (e) {
      if (!(e instanceof RpcError)) err.write(`mcp ${method}: ${e.stack ?? e}\n`);
      send({ id, error: { code: e instanceof RpcError ? e.code : -32603, message: e.message } });
    }
  }

  const pending = new Set();
  const lines = createInterface({ input: stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    const p = handle(line);
    pending.add(p);
    p.finally(() => pending.delete(p));
  }
  await Promise.all(pending);
}
