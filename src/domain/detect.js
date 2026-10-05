/* B1 trainer: sticky-error detectors. Run on EVERY typed answer, accepted or not (an accepted answer can still hide
   "weil ich muss arbeiten" in a free [x] slot). Pure; an ES module, tested in node.
   The verb-final / inversion / v2 rules mirror tools/validate_b1.py detect(); tests/unit/b1.test.mjs checks that both
   agree on every model and wrong answer in content/b1/items.json and on Igloo's German example sentences.
   Detect.run(input, item, r) → null | {cls, hint, word}   (r = the Match.check result, optional) */
const norm = s => String(s == null ? '' : s).normalize('NFC').toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .replace(/[’]/g, "'").replace(/[^\p{L}\p{N}_\s\[\]()'-]/gu, ' ').split(/\s+/).filter(Boolean).join(' ');
const set = s => new Set(norm(s).split(' '));
const FINITE = set(`bin bist ist sind seid war warst waren habe hab hast hat haben habt hatte hatten kann kannst können
  könnt muss musst müssen will willst wollen soll sollst sollen darf darfst dürfen möchte möchtest möchten werde wirst
  wird werden würde würdest würden könnte könntest könnten hätte hättest hätten wäre wärst wären mag gibt geht kommt
  macht regnet passt klappt sollte sollten solltest wollte wollten konnte konnten musste mussten durfte durften
  mochte mochten wurde wurden gab ging kam`);
const PRON = set('ich du er sie es wir ihr man das dies jemand niemand');
const DET = set('der die das den dem des ein eine einen einem einer mein meine meinen dein deine sein seine ihr ihre unser unsere euer eure kein keine dieser diese dieses jede jeder jedes jeden alle viele manche einige beide meisten wenige');
const SUB = set('dass weil wenn ob obwohl damit sobald bevor nachdem während falls indem sodass seitdem');
const PARTICLES = set('ab an auf aus ein mit vor zu zurück weg los fest teil statt vorbei hin her nach');
const PARTS_BY_LEN = [...PARTICLES].sort((a, b) => b.length - a.length);
// plan.json traps[v2].fronted, longest first (test_b1.mjs checks the two lists are the same)
let FRONTED = `auf der anderen seite|in meinem heimatland|meiner meinung nach|auf der einen seite|aus diesem grund|vor zwei jahren|zum beispiel|am wochenende|normalerweise|nächste woche|letztes jahr|letzte woche|andererseits|schließlich|zum schluss|tatsächlich|vielleicht|inzwischen|am samstag|am sonntag|am freitag|eigentlich|einerseits|allerdings|am anfang|natürlich|am montag|im sommer|im winter|zum glück|im moment|deswegen|trotzdem|außerdem|manchmal|meistens|am ende|deshalb|zuletzt|gestern|bei uns|seitdem|zurzeit|dagegen|leider|danach|zuerst|morgen|früher|darum|heute|jetzt|dafür|sonst|dann|oft`
  .split('|').map(norm).sort((a, b) => b.length - a.length);
const COMMA_OK = new Set(['natuerlich', 'vielleicht', 'allerdings']);   // plan.json traps[v2].comma_ok
const NONVERB = set(`der die das den dem des ein eine einen einem einer eines mein meine meinen meinem dein deine sein seine
  ihr ihre unser unsere euer eure kein keine keinen dieser diese dieses diesen jede jeder jedes jeden alle viele manche
  einige beide ich du er sie es wir man mich dich sich uns euch ihnen ihm ihn mir dir an auf aus bei mit nach von vor zu
  in um über unter für gegen ohne durch nicht auch noch schon sehr gern gerne ganz mehr wieder immer oben unten heute
  morgen gestern hier dort dann denn aber oder und sondern zusammen selten draußen drinnen neben wegen`);
const TIME_NOUNS = set('abend morgen nachmittag mittag vormittag nacht wochenende anfang ende jahr woche monat');
const WER_PRON = set('er sie');
const MEINEN = set('meine meinst meint meinen');
const WH = set('wie warum wo wann was wer wohin woher womit wofür worüber worauf wovon welche welcher welches');
const WH_FRAME = /\b(interessier\w*|wissen|weiss|weisst|frage|fragen|fragt|sag|sagen|sagt|erklaer\w*|verstehe|verstehen|ahnung|unklar|sicher|ueberlegen|zeig\w*)\b/;
// words that can follow aber/denn and look like verbs to finiteAny (aber selbst ich …, aber jetzt ist es …)
const CONN_ADV = set('selbst sogar nur auch erst genau fast besonders gerade jedenfalls meist zumindest mindestens wenigstens höchstens vielleicht jetzt nachts abends morgens mittags eben bereits trotzdem dennoch damals längst oben hinten vorne immerhin');
// a main clause that starts with these after a missing comma or full stop ("weil … haben trotzdem hat …")
const NEXT_MAIN = set('dann so trotzdem deshalb deswegen darum außerdem danach');
// adverbs that keep the verb second in the middle of a sentence too
const MID_V2 = set('deshalb deswegen darum trotzdem außerdem dennoch');
const finiteAny = w => !NONVERB.has(w) && /^[a-z]{2,}(e|st|t|en|n)$/.test(w) && !/(ung|heit|keit|lein)$/.test(w);
const isFin = (w, fin) => fin.has(w) || finiteAny(w);
// subordinators that are never an adverb: a finite verb right after them is a word-order error ("ob kann man …")
const NEVER_ADV = set('dass weil ob wenn obwohl falls');
// a subordinate clause that opens a sentence and ends with its verb: "Da Busse teuer sind, …", "Als ich ankam, …"
// (da and als are also an adverb and a preposition: "Da hast du recht", "Als Kind …", so the clause must look like one)
const LEAD_SUB = set('da als');
// the auxiliaries: haben, sein, werden. In "weil wir haben gefeiert" the participle at the end is no finite verb
const AUX = set('bin bist ist sind seid war warst waren habe hab hast hat haben habt hatte hatten werde wirst wird werden');
const PARTICIPLE = /^(ab|an|auf|aus|ein|mit|vor|zu|zurueck|weg|los|fest|teil|vorbei|hin|her|nach|um|durch)?ge[a-z]{2,}(t|en)$/;

function clauseVerbs(model) {
  const out = new Set();
  for (const clause of String(model || '').split(/[,.;:!?]/)) {
    const toks = norm(clause).split(' ').filter(Boolean);
    if (toks.length && toks.slice(0, -1).some(t => SUB.has(t))) {
      const last = toks[toks.length - 1]; out.add(last);
      const pre = PARTS_BY_LEN.find(p => last.startsWith(p) && last.length > p.length + 2);
      if (pre) out.add(last.slice(pre.length));
    }
  }
  return out;
}
function subjectEnd(toks, j, fin) {
  if (j >= toks.length) return null;
  if (DET.has(toks[j]) && j + 1 < toks.length && PRON.has(toks[j + 1])) return null;   // "meinen Sie …": a verb
  if (DET.has(toks[j]) && j + 1 < toks.length && !fin.has(toks[j + 1])) return j + 2;
  if (PRON.has(toks[j]) || DET.has(toks[j])) return j + 1;
  return null;
}
// the word-order classes, with the word to name in the hint
function order(text, model, verbs = null) {
  const out = [];
  const fin = new Set([...FINITE, ...clauseVerbs(model)]);
  // verb forms from the word list (run() only): a lower-case word of the answer that is a finite form of a known verb
  // counts as a verb too, so "weil sie arbeiten dort" is caught when no model has arbeiten (Build an email's free lines)
  /** @type {Set<string> | null} */ const lower = verbs ? new Set() : null;   // words written in lower case (not nouns)
  if (verbs && lower) for (const m of String(text).matchAll(/[\p{L}\p{N}_'-]+/gu)) if (m[0] === m[0].toLowerCase()) { const n = norm(m[0]); lower.add(n); if (verbs.has(n)) fin.add(n); }
  const verbish = (/** @type {string} */ r) => fin.has(r) || (!!lower && lower.has(r) && finiteAny(r));
  const pieces = String(text).split(/([,.;:!?])/);
  for (let k = 0; k < pieces.length; k += 2) {
    const toks = norm(pieces[k]).split(' ').filter(Boolean);
    if (k && pieces[k - 1] === ',' && toks.length >= 3 && WH.has(toks[0]) && WH_FRAME.test(norm(k >= 2 ? pieces[k - 2] : ''))) {
      // "…, wie sieht deine Familie das": the verb right after the question word, then a subject, verb not last
      if (isFin(toks[1], fin) && (PRON.has(toks[2]) || DET.has(toks[2])) && !isFin(toks[toks.length - 1], fin)) out.push({ cls: 'verb-final', word: toks[0] });
    }
    toks.forEach((t, i) => {
      if (t === 'als') {   // only "als + subject + finite verb + more": "als ich habe die Nachricht bekommen"
        const j = subjectEnd(toks, i + 1, fin);
        if (j != null && j < toks.length - 1 && fin.has(toks[j]) && toks.slice(j + 1).some(r => !fin.has(r))) out.push({ cls: 'verb-final', word: t });
        return;
      }
      if (!SUB.has(t)) return;
      if (i + 2 < toks.length && NEVER_ADV.has(t) && FINITE.has(toks[i + 1]) && (PRON.has(toks[i + 2]) || DET.has(toks[i + 2]))) { out.push({ cls: 'verb-final', word: t }); return; }   // "ob kann man …"
      if (i + 1 < toks.length && (FINITE.has(toks[i + 1]) || (verbs && fin.has(toks[i + 1])))) return;   // "Damit bin ich …", "Seitdem gehe ich …": an adverb
      let end = toks.length;   // the clause ends at a main clause that follows without a comma
      for (let j = i + 1; j < Math.min(i + 5, toks.length - 1); j++) {
        if (SUB.has(toks[j])) break;
        const rest = toks.slice(j + 1);
        // a finite verb, then a finite verb and a pronoun: the main clause after a missing comma ("Wenn ich Zeit habe lerne ich")
        // or a finite verb then another subordinator, or dann/so/trotzdem … + verb ("…, weil …", "… ist dann fahre ich")
        if (isFin(toks[j], fin) && rest.length >= 2 && ((isFin(rest[0], fin) && PRON.has(rest[1]) && rest[1] !== 'das') ||
          SUB.has(rest[0]) || (NEXT_MAIN.has(rest[0]) && isFin(rest[1], fin)))) { end = j + 1; break; }
        // with the word list's verbs: a verb group goes on (regnen würde, warten musstest), so decide at its last verb
        if (verbs && fin.has(toks[j]) && rest.length && fin.has(rest[0])) continue;
        if (fin.has(toks[j]) && !['oder', 'und', 'aber'].includes(rest[0]) && rest.some(r => (verbs ? !verbish(r) || (AUX.has(toks[j]) && PARTICIPLE.test(r)) : !fin.has(r)))) { out.push({ cls: 'verb-final', word: t }); return; }
      }
      const cl = toks.slice(i + 1, end);
      if (cl.length >= 3 && PARTICLES.has(cl[cl.length - 1]) && cl.slice(1, -1).some(c => isFin(c, fin))) out.push({ cls: 'verb-final', word: t });
    });
  }
  for (const sent of String(text).trim().split(/(?<=[.!?])\s+/)) {
    const k = sent.indexOf(',');
    if (k < 0) continue;
    const hd = norm(sent.slice(0, k)).split(' ').filter(Boolean);   // "Wer hat Fragen, kann …" (not a question)
    if (!/\?\s*$/.test(sent) && hd.length >= 3 && hd[0] === 'wer' && fin.has(hd[1]) && hd.slice(2).some(r => !fin.has(r))) out.push({ cls: 'verb-final', word: 'wer' });
    const rest = norm(sent.slice(k + 1)).split(' ').filter(Boolean);
    // "Wer Fragen hat, er kann …": the second clause picks up wer with der, not er/sie
    if (!/\?\s*$/.test(sent) && hd.length >= 2 && hd[0] === 'wer' && rest.length >= 2 && WER_PRON.has(rest[0])) out.push({ cls: 'wer-der', word: 'wer' });
    const raw0 = sent.slice(0, k).match(/[\p{L}\p{N}_'-]+/gu) || [];
    const lead = LEAD_SUB.has(hd[0]) && hd.length >= 3 && !FINITE.has(hd[1]) && (PRON.has(hd[1]) || DET.has(hd[1]) || /^\p{Lu}/u.test(raw0[1] || '')) && isFin(hd[hd.length - 1], fin) && !hd.slice(1, -1).some(w => FINITE.has(w));
    if (!(SUB.has(hd[0]) || lead) || norm(sent.slice(0, k)).includes('oder nicht')) continue;
    const j = subjectEnd(rest, 0, fin);
    if (j != null && j < rest.length && isFin(rest[j], fin)) out.push({ cls: 'inversion', word: hd[0] });
    else if (rest.length >= 2 && PRON.has(rest[0]) && rest[0] !== 'das' && MEINEN.has(rest[1])) out.push({ cls: 'inversion', word: hd[0] });   // "Wenn …, Sie meinen"
  }
  for (const sent of String(text).trim().split(/(?<=[.!?])\s+/)) {
    const n = norm(sent);
    const f = FRONTED.find(f => n.startsWith(f + ' '));
    if (!f) continue;
    const nf = f.split(' ').length;
    if (COMMA_OK.has(f) && new RegExp(`^\\s*\\S+(\\s+\\S+){${nf - 1}}\\s*,`).test(sent)) {   // "Natürlich, das stimmt."
      const after = norm(sent.slice(sent.indexOf(',') + 1)).split(' ').filter(Boolean);
      if (after.length >= 3 && after[0] === 'es' && fin.has(after[1])) out.push({ cls: 'v2', word: sent.trim().split(/[\s,]+/).slice(0, nf).join(' ') });   // "Natürlich, es ist …"
      continue;
    }
    const rest = n.slice(f.length).split(' ').filter(Boolean);
    const raw = (sent.match(/[\p{L}\p{N}_'-]+/gu) || []).slice(nf);
    let j = subjectEnd(rest, 0, fin);
    if (j == null && raw.length && /^\p{Lu}/u.test(raw[0]) && rest.length && !TIME_NOUNS.has(rest[0])) j = 1;   // "Einerseits Online-Lernen ist …"
    if (j != null && j < rest.length && isFin(rest[j], fin) && (PRON.has(rest[0]) || !(j + 1 < rest.length && PRON.has(rest[j + 1]))))
      out.push({ cls: 'v2', word: sent.trim().split(/[\s,]+/).slice(0, nf).join(' ') });
  }
  // aber and denn keep the normal order: "…, aber habe ich …", "…, aber könnten viele Firmen …" (a finite verb right
  // after, then a subject) is wrong; a question after aber is not ("…, aber kannst du kommen?")
  for (const sent of String(text).trim().split(/(?<=[.!?])\s+/)) {
    if (/\?\s*$/.test(sent)) continue;
    const toks = norm(sent).split(' ').filter(Boolean);
    // deshalb, trotzdem … right after a comma (or after und, oder): the verb comes next (…, deshalb ich kann →
    // deshalb kann ich); "trotzdem, wir sollten …" starts a new clause after the comma
    sent.split(/[,;:]/).some((piece, k) => {
      const pt = norm(piece).split(' ').filter(Boolean);
      for (let i = 0; i + 2 < pt.length; i++) {
        if (!(k > 0 && (i === 0 || (i === 1 && (pt[0] === 'und' || pt[0] === 'oder'))))) continue;
        if (MID_V2.has(pt[i]) && PRON.has(pt[i + 1]) && pt[i + 1] !== 'das' && pt[i + 1] !== 'dies' && isFin(pt[i + 2], fin)) { out.push({ cls: 'v2', word: pt[i] }); return true; }
      }
      return false;
    });
    for (let i = 0; i + 2 < toks.length; i++) {
      if ((toks[i] === 'aber' || toks[i] === 'denn') && !CONN_ADV.has(toks[i + 1]) && ((isFin(toks[i + 1], fin) && PRON.has(toks[i + 2]) && toks[i + 2] !== 'das' && toks[i + 2] !== 'dies')
        || (FINITE.has(toks[i + 1]) && DET.has(toks[i + 2])))) {
        out.push({ cls: 'connector-order', word: toks[i] });
        break;
      }
    }
  }
  return out;
}
// the same classes as validate_b1.detect(text, model), as a sorted array (for the parity test)
const classes = (text, model) => [...new Set(order(text, model).map(x => x.cls))].sort();

const NEUTER_END = /(ma|um|ment|chen|lein)$/i;
const WRONG_FOR_NEUTER = new Set(['der', 'die', 'den', 'eine', 'einen', 'einer']);
const NEUTER_ART = new Set(['das', 'dem', 'des', 'ein', 'einem', 'eines']);
const words = s => [...String(s).matchAll(/[\p{L}\p{N}_'-]+/gu)].map(m => m[0]);
const focusHas = (item, c) => item && (item.trap === c || (item.focus || []).includes(c));
const it = w => `*${w}*`;

/**
 * The first sticky error in an answer, or null.
 * @param {string} input @param {any} [item] @param {any} [r] the Match.check result
 * @param {{verbs?: Set<string> | null}} [opts] verbs: finite verb forms (verbForms()) for answers no model covers
 */
function run(input, item = {}, r = null, opts = {}) {
  const text = String(input || '');
  if (!text.trim()) return null;
  const model = item.model || '';
  const o = order(text, model, (opts && opts.verbs) || null);
  const pick = c => o.find(x => x.cls === c);
  let x;
  if ((x = pick('verb-final'))) return { cls: 'verb-final', word: x.word, hint: `Check where the verb goes after ${it(x.word)}.` };
  if ((x = pick('inversion'))) return { cls: 'inversion', word: x.word, hint: 'Check the word order after the comma.' };
  if ((x = pick('v2'))) return { cls: 'v2', word: x.word, hint: `Check the word order after ${it(x.word)}.` };
  if ((x = pick('wer-der'))) return { cls: 'wer-der', word: 'wer', hint: 'Check the word after the comma.' };
  if ((x = pick('connector-order'))) return { cls: 'connector-order', word: x.word, hint: `Check the word order after ${it(x.word)}.` };
  // für / vor where the model has the other one (fear and warning take vor)
  const mw = words(model).map(w => w.toLowerCase()), iw = words(text).map(w => w.toLowerCase());
  if (focusHas(item, 'fuer-vor') || /\b(angst|warnen|warnt|schämen|schäme|fürchten)\b.*\bvor\b/i.test(model)) {
    for (const [want, bad] of [['vor', 'für'], ['für', 'vor']]) {
      if (mw.includes(want) && !iw.includes(want) && iw.includes(bad)) {
        const k = iw.indexOf(bad), prev = k > 0 ? words(text)[k - 1] : null;
        return { cls: 'fuer-vor', word: prev, hint: prev ? `Check the preposition after ${it(prev)}.` : 'Check the preposition.' };
      }
    }
  }
  // a neuter noun of the model (-ma, -um, -ment, -chen, nouns made from verbs) with a masculine or feminine article
  const MW = words(model);
  for (let k = 1; k < MW.length; k++) {
    const noun = MW[k], art = MW[k - 1].toLowerCase();
    if (!/^\p{Lu}/u.test(noun) || !NEUTER_ART.has(art)) continue;
    if (!(NEUTER_END.test(noun) || /en$/.test(noun) || focusHas(item, 'neuter'))) continue;
    const IW = words(text);
    for (let j = 1; j < IW.length; j++) {
      if (IW[j].toLowerCase() === noun.toLowerCase() && WRONG_FOR_NEUTER.has(IW[j - 1].toLowerCase()) && !(art === 'des' && IW[j - 1].toLowerCase() === 'der'))
        return { cls: 'neuter', word: noun, hint: `Check the article on ${it(noun)}.` };
    }
  }
  if (r && ((r.focusMiss && r.focusMiss.length) || (focusHas(item, 'cap') && r.capMiss && r.capMiss.length)))
    return { cls: 'cap', word: (r.focusMiss && r.focusMiss[0] || r.capMiss[0]).expected, hint: 'Check the capital letters.' };
  return null;
}

// words that are a verb form and also something else in lower case (bitte, danke): never counted as verbs
const NOT_A_VERB = set('bitte danke lange leise weise gerade heute morgen gestern ende liebe reise');
/**
 * Finite forms of the verbs in a word list (igloo words: {w, pos, forms: '3rd sg · past · Perfekt'}): the infinitive
 * (= wir/sie form), the ich form, the er form and the past forms (from forms, or the regular -te, -ten). Folded, as
 * norm() makes them.
 * @param {any[] | null | undefined} words @returns {Set<string>}
 */
function verbForms(words) {
  const out = new Set();
  for (const w of words || []) {
    if (!w || w.pos !== 'verb' || !w.w || /\s/.test(String(w.w).trim())) continue;
    const inf = norm(w.w);
    if (!/^[a-z]+$/.test(inf)) continue;
    const forms = [inf];
    const f = String(w.forms || '').split('·').map(x => norm(x).split(' ')[0] || '');   // fährt ab → faehrt
    const elern = /(el|er)n$/.test(inf);
    if (/en$/.test(inf) || elern) {   // the ich form, and the er form of a regular verb (wohnen: wohne, wohnt; arbeiten: arbeitet; feiern: feiere, feiert)
      const stem = inf.slice(0, elern ? -1 : -2);
      forms.push(stem + 'e');
      const e = /[td]$/.test(stem) ? 'e' : '';
      if (!f[0]) forms.push(`${stem}${e}t`);
      if (!f[1]) forms.push(`${stem}${e}te`, `${stem}${e}ten`);   // a regular past: feierte, arbeiteten
    }
    if (f[0]) forms.push(f[0]);
    if (f[1]) forms.push(f[1]);
    for (const x of forms) if (x && !NONVERB.has(x) && !NOT_A_VERB.has(x) && !PRON.has(x) && !DET.has(x)) out.add(x);
  }
  return out;
}

const api = { run, classes, norm, verbForms, setFronted(list) { FRONTED = list.map(norm).sort((a, b) => b.length - a.length); }, get FRONTED() { return FRONTED; } };
export default api;
export { run, classes, norm, verbForms };
