/* DOM helpers. h() builds elements with properties, attributes, listeners and children; text is always a text node.
   There is no way to pass markup: an `html`/`innerHTML` attribute throws, so content (exam texts, Claude output,
   another user's words) can never become markup. Styles go through the CSSOM (el.style), which a strict CSP allows. */

/** @typedef {Node | string | number | null | undefined | false | Child[]} Child */

const PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'hidden', 'indeterminate', 'readOnly', 'required', 'multiple', 'open']);
const BANNED = new Set(['html', 'innerHTML', 'outerHTML', 'srcdoc']);

/**
 * h('button', { class: ['btn', primary && 'btn-primary'], onclick: fn, 'aria-label': 'Close' }, 'Close')
 * @param {string} tag
 * @param {Record<string, any> | null} [attrs]
 * @param {...Child} children
 * @returns {HTMLElement}
 */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (BANNED.has(k)) throw new Error(`h(): "${k}" is not allowed; build nodes instead`);
      if (v == null || v === false) continue;
      if (k === 'class') el.className = Array.isArray(v) ? v.filter(Boolean).join(' ') : String(v);
      else if (k === 'style') setStyle(el, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'ref') v(el);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (PROPS.has(k)) /** @type {any} */ (el)[k] = v;
      else if (k === 'href' && /^\s*javascript:/i.test(String(v))) throw new Error('h(): javascript: URLs are not allowed');
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

/** @param {HTMLElement} el @param {Record<string, string | number | null>} style */
export function setStyle(el, style) {
  for (const [k, v] of Object.entries(style)) {
    if (v == null) el.style.removeProperty(k);
    else if (k.startsWith('--') || k.includes('-')) el.style.setProperty(k, String(v));
    else /** @type {any} */ (el.style)[k] = v;
  }
}

/** @param {Node} parent @param {Child[]} children */
export function append(parent, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    parent.appendChild(typeof c === 'object' ? /** @type {Node} */ (c) : document.createTextNode(String(c)));
  }
  return parent;
}

/** Replace all children. @param {Element} el @param {...Child} children */
export function replace(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

/** @param {...Child} children */
export const frag = (...children) => /** @type {DocumentFragment} */ (append(document.createDocumentFragment(), children));

/** @param {string} sel @param {ParentNode} [root] @returns {HTMLElement | null} */
export const $ = (sel, root = document) => root.querySelector(sel);
/** @param {string} sel @param {ParentNode} [root] @returns {HTMLElement[]} */
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** addEventListener that returns its own remover. @param {EventTarget} el @param {string} type @param {EventListener} fn */
export function on(el, type, fn, opts) {
  el.addEventListener(type, fn, opts);
  return () => el.removeEventListener(type, fn, opts);
}

/** Polite screen-reader announcement through the shell's live region. @param {string} text */
export function announce(text) {
  const r = document.getElementById('live');
  if (!r) return;
  r.textContent = '';
  requestAnimationFrame(() => { r.textContent = text; });
}

/** Trigger a file download of a Blob without touching markup. @param {Blob} blob @param {string} name */
export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name, hidden: true });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}
