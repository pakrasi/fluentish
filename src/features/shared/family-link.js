/* "Family: stellen ›" on a word sheet (round 7, WORDGAMES-DESIGN §3d): one row when the word is a form of a root with
   family data (data/families.js). Outside a round it links to the family view with that form open; inside a round it
   opens the family as a sheet over the round (features/build/boot.js listens for 'family:open'), so a look never
   ends the round. The row fills in when the index has loaded and stays empty for a word with no family. */
import { h } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { t } from '../../core/i18n.js';
import { langAttr, dirAttr } from '../../core/lang.js';
import { familyIndexOf, familyHref } from '../../data/families.js';

/**
 * @param {{content: {load: (id: string) => Promise<any>}, bus?: {emit: (name: string, data?: any) => void} | null}} ctx
 * @param {string | null | undefined} wordId a word-list id ('die_Ausstellung', 'ausstellen.verb'), with or without W:
 * @param {{inRound?: boolean, from?: string, keep?: (e: Event) => void}} [o]
 */
export function familyLink(ctx, wordId, { inRound = false, from = '', keep } = {}) {
  const slot = h('div', { class: 'fam-link-slot' });
  const id = String(wordId || '').replace(/^W:/, '');
  if (!id) return slot;
  familyIndexOf(ctx.content).then(ix => {
    const hit = ix.get(id);
    if (!hit) return;
    const kids = [h('span', { class: 'fam-link-label' }, t('build.family.linkLabel')), ' ', h('span', { class: 'fam-link-root', lang: langAttr(), dir: dirAttr() }, hit.root), icon('next', { size: 16 })];
    slot.replaceChildren(inRound && ctx.bus
      ? h('button', { type: 'button', class: 'fam-link pressable', 'aria-haspopup': 'dialog', onpointerdown: keep || null, onclick: () => ctx.bus?.emit('family:open', hit) }, kids)
      : h('a', { class: 'fam-link pressable', href: familyHref(hit, from) }, kids));
  }).catch(() => {});
  return slot;
}
