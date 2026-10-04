/* Script mode (SCRIPT-UX, phase 1): turn his own talk or notes into something he can say. Owns #/practice/scripts…:
     #/practice/scripts                          library (library.js)
     #/practice/scripts/new                      paste (paste.js)
     #/practice/scripts/<id>                     overview (overview.js)
     #/practice/scripts/<id>/mark[/<section>]    mark words (mark.js)
     #/practice/scripts/<id>/rehearse/<section>?step=listen|parts|letters|gaps|cue   (rehearse.js, full screen)
     #/practice/scripts/<id>/run                 full run (run.js, full screen)
     #/practice/scripts/<id>/edit[/<section>]    edit the text (edit.js)
   and the words round #/practice/round?kind=script:<id> (words.js), which Practice's index hands over.
   Pure logic: parse, lemma, suggest, ladder, plan, align (tested in node). Storage: store.js. Device-only (§8). */
import { h, replace } from '../../../core/dom.js';
import * as St from './store.js';
import { back } from './ui.js';

/** @param {HTMLElement} el @param {import('../../contract.js').ViewCtx} ctx @param {string[]} parts */
export async function mountScripts(el, ctx, parts) {
  const [a, b, c] = parts;
  if (!a) return (await import('./library.js')).mountLibrary(el, ctx);
  if (a === 'new') return (await import('./paste.js')).mountPaste(el, ctx);
  const script = St.get(ctx.store, a);
  if (!script) {
    replace(el, h('div', { class: 'practice stack' }, back('#/practice/scripts', ctx.t('practice.script.title')),
      h('div', { class: 'page-head' }, h('h1', null, ctx.t('practice.script.gone'))),
      h('a', { class: 'btn pressable', href: '#/practice/scripts' }, ctx.t('practice.script.toLibrary'))));
    return;
  }
  if (!b) return (await import('./overview.js')).mountOverview(el, ctx, script);
  if (b === 'mark') return (await import('./mark.js')).mountMark(el, ctx, script, c || null);
  if (b === 'rehearse' && c) return (await import('./rehearse.js')).mountRehearse(el, ctx, script, c);
  if (b === 'run') return (await import('./run.js')).mountRun(el, ctx, script);
  if (b === 'edit') return (await import('./edit.js')).mountEdit(el, ctx, script, c || null);
  ctx.go(`/practice/scripts/${script.id}`, { replace: true });
}

/** The words round, from #/practice/round?kind=script:<id>. @param {HTMLElement} el @param {import('../../contract.js').ViewCtx} ctx */
export async function mountScriptRound(el, ctx) {
  return (await import('./words.js')).mountWords(el, ctx);
}

/** Practice hub row (§3.1). @param {any} store @param {any} c clock ctx @param {(k: string, v?: any) => string} t */
export { hubRow } from './hub.js';
