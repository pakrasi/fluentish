/* Feedback text (Fritz's corrections and one-click corrections) in the small Markdown subset the B1 exam app used:
     ## / ### headings · - list · > quote · → tip · ! score line · ~~wrong~~ · ==right== · !!bad!! · **bold** · _muted_
     a line "~~x~~ → ==y==" followed by "_why_" lines is one correction block.
   parse() is pure (tested in node); render() builds DOM nodes with h(), so the text can never become markup. */
import { h } from '../../core/dom.js';
import { langAttr } from '../../core/lang.js';

/** @typedef {{ t: 'text' | 'b' | 'del' | 'mark' | 'bad' | 'em', v: string }} Span */
/** @typedef {{ k: 'h3' | 'h4' | 'p' | 'quote' | 'tip' | 'corr' | 'ul' | 'score', spans?: Span[], lines?: Span[][], items?: Span[][], num?: Span[], verdict?: Span[], tone?: string }} Block */

const INLINE = /\*\*(.+?)\*\*|~~(.+?)~~|==(.+?)==|!!(.+?)!!|(^|[\s(])_(.+?)_(?=[\s).,;:]|$)/g;

/** @param {string} s @returns {Span[]} */
export function inline(s) {
  /** @type {Span[]} */ const out = [];
  let last = 0;
  for (const m of s.matchAll(INLINE)) {
    const at = /** @type {number} */ (m.index);
    let start = at;
    /** @type {Span} */ let span;
    if (m[1] != null) span = { t: 'b', v: m[1] };
    else if (m[2] != null) span = { t: 'del', v: m[2] };
    else if (m[3] != null) span = { t: 'mark', v: m[3] };
    else if (m[4] != null) span = { t: 'bad', v: m[4] };
    else { start = at + m[5].length; span = { t: 'em', v: m[6] }; }
    if (start > last) out.push({ t: 'text', v: s.slice(last, start) });
    out.push(span);
    last = at + m[0].length;
  }
  if (last < s.length) out.push({ t: 'text', v: s.slice(last) });
  return out;
}

/** @param {string} src @returns {Block[]} */
export function parse(src) {
  /** @type {Block[]} */ const out = [];
  /** @type {Span[][] | null} */ let list = null;
  const close = () => { if (list) { out.push({ k: 'ul', items: list }); list = null; } };
  const lines = String(src || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) { close(); continue; }
    if (t.startsWith('### ')) { close(); out.push({ k: 'h4', spans: inline(t.slice(4)) }); }
    else if (t.startsWith('## ')) { close(); out.push({ k: 'h3', spans: inline(t.slice(3)) }); }
    else if (t.startsWith('! ')) {
      close();
      const [num, ...rest] = t.slice(2).split(' · ');
      const v = rest.join(' · ');
      out.push({ k: 'score', num: inline(num), verdict: inline(v), tone: /nicht bestanden|unter/i.test(v) ? 'bad' : /bestanden/i.test(v) ? 'ok' : '' });
    }
    else if (t.startsWith('> ')) { close(); out.push({ k: 'quote', spans: inline(t.slice(2)) }); }
    else if (t.startsWith('→ ')) { close(); out.push({ k: 'tip', spans: inline(t.slice(2)) }); }
    else if (/^~~.+~~\s*→/.test(t)) {
      close();
      const block = [inline(t)];
      while (i + 1 < lines.length && /^\s*_.+_\s*$/.test(lines[i + 1])) block.push(inline(lines[++i].trim()));
      out.push({ k: 'corr', lines: block });
    }
    else if (/^[-•] /.test(t)) (list ||= []).push(inline(t.slice(2)));
    else { close(); out.push({ k: 'p', spans: inline(t) }); }
  }
  close();
  return out;
}

const TAG = { text: null, b: 'b', del: 'del', mark: 'mark', bad: 'span', em: 'em' };

/** @param {Span[]} spans */
const spansNodes = spans => spans.map(s => (s.t === 'text' ? s.v : h(/** @type {string} */ (TAG[s.t]), s.t === 'bad' ? { class: 'md-bad' } : null, s.v)));

/** Feedback as DOM. @param {string} src @returns {HTMLElement} */
export function render(src) {
  return h('div', { class: 'md', lang: langAttr() }, parse(src).map(b => {
    switch (b.k) {
      case 'h3': return h('h3', null, spansNodes(b.spans || []));
      case 'h4': return h('h4', null, spansNodes(b.spans || []));
      case 'score': return h('p', { class: 'md-score' }, h('span', { class: 'md-num' }, spansNodes(b.num || [])), b.verdict?.length ? h('span', { class: ['md-verdict', b.tone && `is-${b.tone}`] }, spansNodes(b.verdict)) : null);
      case 'quote': return h('blockquote', null, spansNodes(b.spans || []));
      case 'tip': return h('p', { class: 'md-tip' }, '→ ', spansNodes(b.spans || []));
      case 'corr': return h('p', { class: 'md-corr' }, (b.lines || []).map((l, i) => [i ? h('br') : null, spansNodes(l)]));
      case 'ul': return h('ul', null, (b.items || []).map(it => h('li', null, spansNodes(it))));
      default: return h('p', null, spansNodes(b.spans || []));
    }
  }));
}
