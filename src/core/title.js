/* The document title for a view. A view can name itself with data-title (a generic name) so private text in its h1 never
   reaches the browser history, which Safari and Chrome sync to the cloud (scripts: audit round 2 P1-3). Pure. */

/**
 * @param {{h1?: string | null, custom?: string | null, path: string, name: string}} o
 * @returns {string}
 */
export function docTitle({ h1 = null, custom = null, path, name }) {
  if (custom) return `${custom} · ${name}`;
  if (h1 && path !== '/today') return `${h1} · ${name}`;
  return name;
}
