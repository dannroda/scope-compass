// Render de los documentos (spec §10.4, D21): markdown-it + Prism, en el hub, sin HTML crudo del documento.
import MarkdownIt from 'markdown-it';
import Prism from 'prismjs';
import loadLanguages from 'prismjs/components/index.js';

loadLanguages(['gdscript', 'json', 'bash', 'javascript', 'python', 'csharp', 'glsl', 'ini', 'yaml']);
const ALIASES = { gd: 'gdscript', godot: 'gdscript', sh: 'bash', shell: 'bash', js: 'javascript', py: 'python', cs: 'csharp', gdshader: 'glsl', cfg: 'ini', toml: 'ini' };
const ID_LINE = /^\s*<!--\s*id:\s*[a-z0-9][a-z0-9_-]*\s*-->\s*$/;

const md = new MarkdownIt({
  html: false, // el HTML del documento se muestra como texto: nada de <script> ni estilos ajenos
  linkify: true,
  highlight(code, lang) {
    const l = ALIASES[lang] ?? lang;
    if (!Prism.languages[l]) return ''; // markdown-it escapa el código
    return `<pre class="code language-${l}"><code>${Prism.highlight(code, Prism.languages[l], l)}</code></pre>`;
  }
});
// Los enlaces del documento abren en otra pestaña y sin acceso a esta.
md.renderer.rules.link_open = (tokens, i, opts, env, self) => {
  tokens[i].attrSet('target', '_blank');
  tokens[i].attrSet('rel', 'noopener noreferrer');
  return self.renderToken(tokens, i, opts);
};

/**
 * HTML de un fragmento de markdown. sections: las secciones de ese fragmento, en orden: cada título recibe
 * id="sec-<id>" y data-section, para enlazar desde el índice y las referencias.
 */
export function renderMarkdown(text, sections = []) {
  const clean = text.split('\n').filter((l) => !ID_LINE.test(l)).join('\n');
  const tokens = md.parse(clean, {});
  let n = 0;
  for (const t of tokens) {
    if (t.type !== 'heading_open') continue;
    const s = sections[n++];
    if (s) { t.attrSet('id', `sec-${s.id}`); t.attrSet('data-section', s.id); }
  }
  return md.renderer.render(tokens, md.options, {});
}

// --- BBCode para el dock de Godot (6.7): RichTextLabel no entiende markdown. ---

// Colores del resaltado sobre el tema oscuro del editor (los de la UI web en oscuro).
const BB_COLORS = { keyword: '#ff7085', boolean: '#ff7085', 'class-name': '#8effda', builtin: '#8effda', string: '#ffeda1',
  char: '#ffeda1', number: '#a1ffe0', constant: '#a1ffe0', comment: '#8a929c', function: '#57b3ff', annotation: '#ffb373',
  decorator: '#ffb373', variable: '#ffb373' };
// Corchetes del texto: [lb] y [rb], para que `Array[int]` no se lea como etiqueta.
const bbEscape = (s) => s.replace(/[[\]]/g, (c) => (c === '[' ? '[lb]' : '[rb]'));

function bbTokens(tokens) {
  return tokens.map((t) => {
    if (typeof t === 'string') return bbEscape(t);
    const inner = bbTokens(Array.isArray(t.content) ? t.content : [t.content]);
    const color = BB_COLORS[t.type] ?? (Array.isArray(t.alias) ? t.alias.map((a) => BB_COLORS[a]).find(Boolean) : BB_COLORS[t.alias]);
    return color ? `[color=${color}]${inner}[/color]` : inner;
  }).join('');
}

function bbInline(children) {
  let out = '';
  for (const c of children ?? []) {
    switch (c.type) {
      case 'text': out += bbEscape(c.content); break;
      case 'code_inline': out += `[code]${bbEscape(c.content)}[/code]`; break;
      case 'strong_open': out += '[b]'; break;
      case 'strong_close': out += '[/b]'; break;
      case 'em_open': out += '[i]'; break;
      case 'em_close': out += '[/i]'; break;
      case 's_open': out += '[s]'; break;
      case 's_close': out += '[/s]'; break;
      case 'link_open': out += `[url=${c.attrGet('href')}]`; break;
      case 'link_close': out += '[/url]'; break;
      case 'softbreak': out += ' '; break;
      case 'hardbreak': out += '\n'; break;
      default: out += bbEscape(c.content ?? '');
    }
  }
  return out;
}

const HEADING_SIZE = { h1: 22, h2: 19, h3: 17, h4: 16, h5: 15, h6: 15 };

/** BBCode de un fragmento de markdown para un RichTextLabel (bbcode_enabled). */
export function renderBBCode(text) {
  const clean = text.split('\n').filter((l) => !ID_LINE.test(l)).join('\n');
  const tokens = md.parse(clean, {});
  const out = [];
  const lists = []; // pila de { ordered, n }
  let cells = null;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    switch (t.type) {
      case 'heading_open':
        out.push(`[font_size=${HEADING_SIZE[t.tag]}][b]${bbInline(tokens[i + 1].children)}[/b][/font_size]\n`);
        i += 2;
        break;
      case 'paragraph_open':
        out.push(bbInline(tokens[i + 1].children) + (lists.length ? '\n' : '\n\n'));
        i += 2;
        break;
      case 'bullet_list_open': lists.push({ ordered: false }); break;
      case 'ordered_list_open': lists.push({ ordered: true, n: Number(t.attrGet('start') ?? 1) }); break;
      case 'bullet_list_close': case 'ordered_list_close':
        lists.pop();
        if (!lists.length) out.push('\n');
        break;
      case 'list_item_open': {
        const l = lists[lists.length - 1];
        out.push('    '.repeat(lists.length - 1) + (l.ordered ? `${l.n++}. ` : '• '));
        break;
      }
      case 'fence': case 'code_block': {
        const lang = ({ gd: 'gdscript' })[t.info.trim()] ?? t.info.trim();
        const body = Prism.languages[lang] ? bbTokens(Prism.tokenize(t.content.replace(/\n$/, ''), Prism.languages[lang])) : bbEscape(t.content.replace(/\n$/, ''));
        out.push(`[bgcolor=#0c0f13][code]${body}[/code][/bgcolor]\n\n`);
        break;
      }
      case 'blockquote_open': out.push('[i]'); break;
      case 'blockquote_close': out.push('[/i]'); break;
      case 'hr': out.push('────────\n\n'); break;
      case 'tr_open': cells = []; break;
      case 'th_open': case 'td_open': cells.push(bbInline(tokens[i + 1].children)); i += 2; break;
      case 'tr_close': out.push((tokens[i - 1]?.type === 'th_close' ? `[b]${cells.join('  |  ')}[/b]` : cells.join('  |  ')) + '\n'); cells = null; break;
      case 'table_close': out.push('\n'); break;
      default: break;
    }
  }
  return out.join('').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/**
 * La sección en bloques para el dock: [{ type: 'text', bbcode }, { type: 'code', lang, code }]. Los bloques de
 * código van crudos: el dock los muestra en un CodeEdit con el resaltado del propio editor de Godot.
 */
export function renderBlocks(text) {
  const lines = text.split('\n').filter((l) => !ID_LINE.test(l));
  const blocks = [];
  let buf = [];
  let fence = null;
  let lang = '';
  const flushText = () => {
    const chunk = buf.join('\n');
    buf = [];
    if (chunk.trim()) blocks.push({ type: 'text', bbcode: renderBBCode(chunk).replace(/\n+$/, '') });
  };
  for (const line of lines) {
    const f = /^\s{0,3}(```|~~~)\s*([\w+-]*)/.exec(line);
    if (fence === null && f) { flushText(); fence = f[1]; lang = ({ gd: 'gdscript' })[f[2]] ?? f[2]; continue; }
    if (fence !== null && f && f[1] === fence && !f[2]) {
      blocks.push({ type: 'code', lang, code: buf.join('\n') });
      buf = [];
      fence = null;
      continue;
    }
    buf.push(line);
  }
  if (fence !== null) blocks.push({ type: 'code', lang, code: buf.join('\n') });
  else flushText();
  return blocks;
}
