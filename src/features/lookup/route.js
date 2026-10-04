/* Look up routes. Pure, tested in node.
   #/lookup[/words|/phrases|/grammar|/frames][?q=…]   a section, or with only ?q= the results from every section
   #/lookup/words/<lemma or word id>                  a word sheet
   #/lookup/grammar/<topic id>                        a B1 grammar topic
   Query: q (search), lang (study language; German only in phase 1, kept so links stay valid later),
   w (words: mine | all), g (grammar sub-section), f (frames: sprechen | verbs), cat (phrase kind), test (My words: Test N),
   freq (My words: 1 = frequent only), level (word list: A1…B2). */
import { TABS } from './sources.js';

const KEYS = ['q', 'w', 'g', 'f', 'cat', 'test', 'level', 'freq', 'lang'];

/**
 * @param {string | undefined} rest   ctx.params.rest
 * @param {URLSearchParams} query
 * @returns {{tab: string | null, id: string | null, q: string, opts: Record<string, string>}}
 */
export function parseRoute(rest, query) {
  const parts = String(rest || '').split('/').filter(Boolean);
  const tab = parts[0] && TABS.includes(parts[0]) ? parts[0] : null;
  const id = tab && parts.length > 1 ? parts.slice(1).join('/') : null;
  /** @type {Record<string, string>} */ const opts = {};
  for (const k of KEYS) { const v = query.get(k); if (v != null && v !== '' && k !== 'q') opts[k] = v; }
  return { tab, id, q: (query.get('q') || '').slice(0, 120), opts };
}

/**
 * @param {{tab?: string | null, id?: string | null, q?: string, opts?: Record<string, string | null | undefined>}} s
 * @returns {string} a hash, '#/lookup/…'
 */
export function hashFor({ tab = null, id = null, q = '', opts = {} }) {
  let p = '#/lookup';
  if (tab && tab !== 'all') p += `/${tab}`;
  if (tab && tab !== 'all' && id) p += `/${encodeURIComponent(id)}`;
  const sp = new URLSearchParams();
  if (q && q.trim()) sp.set('q', q.trim());
  for (const k of KEYS) { const v = opts[k]; if (k !== 'q' && v != null && v !== '') sp.set(k, v); }
  const s = sp.toString();
  return s ? `${p}?${s}` : p;
}
