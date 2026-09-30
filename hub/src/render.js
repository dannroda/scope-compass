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
