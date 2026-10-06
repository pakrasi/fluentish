/* Keyboard behaviour of a radio group (WAI-ARIA APG radio group), for a role="radiogroup" whose options are
   role="radio" buttons with aria-checked: one tab stop per group (the checked option, else the first); the arrow
   keys move to the next or previous option and choose it, Home and End to the first and last, wrapping round. The
   option is chosen by its own click handler, so a screen that redraws on a choice keeps working: focus then goes to
   the option with the same data-id in the new page (its <details> opened). Used by Conversation's topic and scene
   lists (round 4, audit P1-10). */

/** @param {Element} group @returns {HTMLElement[]} */
const optionsOf = group => /** @type {HTMLElement[]} */ ([...group.querySelectorAll('[role="radio"]')]).filter(x => !(/** @type {any} */ (x).disabled) && !x.closest('[hidden]'));

/** Set the one tab stop of a group: the checked option, or the first. @param {Element} group */
export function rovingRadios(group) {
  const rs = optionsOf(group);
  const on = rs.find(r => r.getAttribute('aria-checked') === 'true') || rs[0];
  for (const r of rs) r.tabIndex = r === on ? 0 : -1;
}

/**
 * Give a radio group its tab stop and arrow keys. Call again after the group's options change.
 * @param {Element} group @param {{root?: ParentNode}} [o] root: where to find the option again after a redraw
 */
export function radioKeys(group, { root = document } = {}) {
  rovingRadios(group);
  if (/** @type {any} */ (group)._radioKeys) return;
  /** @type {any} */ (group)._radioKeys = true;
  group.addEventListener('keydown', ev => {
    const e = /** @type {KeyboardEvent} */ (ev);
    const rs = optionsOf(group);
    const i = rs.indexOf(/** @type {HTMLElement} */ (e.target));
    if (i < 0 || e.altKey || e.ctrlKey || e.metaKey) return;
    const n = rs.length;
    const to = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? (i - 1 + n) % n
      : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : null;
    if (to == null) return;
    e.preventDefault();
    const target = rs[to];
    const id = target.dataset.id;
    target.click();
    const now = target.isConnected || !id ? target
      : /** @type {HTMLElement | null} */ (root.querySelector(`[role="radio"][data-id="${CSS.escape(id)}"]`)) || target;
    const d = now.closest('details');
    if (d && !d.open) d.open = true;
    const g = now.closest('[role="radiogroup"]');
    if (g) rovingRadios(g);
    now.focus();
  });
}
