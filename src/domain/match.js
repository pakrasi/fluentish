/* Igloo answer matcher. Pure functions, no DOM. Used by the Test view and node tests (tests/unit/match.test.mjs).
   check(input, accepted[], {pos, strictCase, slots, anywhere, typos})
     -> {ok, exact, close, articleMiss, caseMiss, matched, others, fixed, typos: [{typed, expected, start, end}], input}
     (typo offsets point into `input`, the answer after NFC and space cleanup)
   Matching is word by word (token alignment), not a regex on the raw string:
   - Case and punctuation are ignored (case counts only with strictCase); ae/oe/ue/ss count as ä/ö/ü/ß; other accents
     are ignored (Cafe = Café).
   - Each fixed word may be a small typo away: 0 edits up to 3 letters, 1 edit for 4-7, 2 for 8+ (Damerau-Levenshtein,
     after folding). Articles, pronouns, prepositions and a few grammar words (dass, sind, ...) never count as typos.
     A match with typos is ok:true with typos.length > 0; `exact` is false when the input needed folding or typos.
   - A typo is never a grammar mistake (typoOk): the inflectional ending must be the same (vielen/vieles, macht/machst,
     kleinem/kleinen are misses), the edit must be in the stem, a vowel change (spricht/sprecht, sieht/seht, ie/ei) is a
     form, words that differ only in umlauts are never typos (Mutter/Mütter; a dropped umlaut is a slip only when the
     plain spelling is not another word, see `umlaut`), and a typed word that is a German word or form itself
     (opts.lexicon, a Set of folded words) is that word. opts.never: folded words from known wrong answers, never
     forgiven.
   - "(words)" are optional; "[slot]" and "..." match 1-6 whole words. Only in the legacy chunk strings (not accept
     patterns) may a slot be glued to a word ("Lieblings[Nomen]": the rest of that word counts).
   - anywhere:true (the accept patterns for phrases) = the pattern may appear anywhere in the answer; otherwise the whole
     answer has to match.
   - Nouns: the right word with a wrong or missing article is ok:false, articleMiss:true.
   - close: not ok, but at least half of a pattern's fixed words are in the answer (patterns of 2+ fixed words, not nouns).
   - `fixed` is the accepted string with its slots filled from the answer; `others` the accepted strings not matched.
   The pattern rules follow tools/validate_accept.py (to_regex/matches); match.test.mjs checks that both agree.

   B1 trainer options (opt-in; Igloo Test passes none of them, so its grading is unchanged):
   - slotMax (default 6): words a slot may take. "([x])" in a pattern is an optional slot (0..slotMax words).
   - endings: a typo is forgiven only on the stem: the word minus a final e/en/em/er/es/n/m/r/s, 5+ letters, 1 edit,
     with identical suffixes (kleinem ≠ kleinen; Bahnhfo = Bahnhof).
   - umlaut: a dropped umlaut is a slip (ok, listed in umlautMiss, the caller rates Hard), except in words where the
     umlaut changes the meaning (könnten/konnten, müssten/mussten, würde/wurde, hätte/hatte, schön/schon …): a miss.
   - strict: [words] that must be typed exactly, in the given case (not sentence-initially); a case slip → ok:false and
     focusMiss.
   - caseRef: Map(folded lowercase word → cased form), e.g. built from the model and a noun list. After a match, typed
     words whose capitalisation differs from the reference are listed in capMiss (sentence-initial words are exempt);
     ok stays true.
   - When not ok: `nearest` = index of the accepted string with the most fixed words found (ties → list order).
   - When ok: `span` = [start, end] of the matched pattern in `input`, `fills` = the text each slot took, in order.
   restCheck() grades the rest of a phrase card's sentence, formCheck() a situation's words against its model, markDiff()
   is the word diff the round shows (see each). */
const FOLD = { 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'ß': 'ss', 'Ä': 'Ae', 'Ö': 'Oe', 'Ü': 'Ue', 'ẞ': 'SS' };
const fold = s => String(s).replace(/[äöüßÄÖÜẞ]/g, c => FOLD[c]);
const ARTICLES = ['der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem', 'einer', 'eines'];
// Closed-class words: a different word from this list is a grammar mistake, never a typo, and these words get 0 edits.
const CLOSED = new Set(`der die das den dem des ein eine einen einem einer eines kein keine keinen keinem keiner keines
  ich mich mir du dich dir er ihn ihm sie ihr ihnen es wir uns euch man sich
  mein meine meinen meinem meiner meines dein deine deinen deinem deiner deines sein seine seinen seinem seiner seines
  ihre ihren ihrem ihrer ihres unser unsere unseren unserem unserer unseres euer eure euren eurem eurer eures
  dieser diese dieses diesen diesem jener jene jenes jenen jenem wer wen wem wessen
  an am ans auf aufs aus bei beim bis durch durchs für fürs gegen hinter hinterm im in ins mit nach neben ohne seit
  über übers um ums unter unterm von vom vor vorm während wegen zu zum zur zwischen trotz statt ab außer gegenüber
  entlang innerhalb außerhalb dass ob wenn als wie
  bin bist ist sind seid war warst waren wart habe hab hast hat habt haben hatte werde wirst wird werden werdet wurde`
  .split(/\s+/).filter(Boolean).map(w => fold(w)));
const WORD_RE = /[\p{L}\p{N}_'-]+/gu;   // what validate_accept.norm keeps as a word (brackets aside)

// Legacy cleanup, kept for callers: NFC, collapse spaces, drop commas, quotes and final punctuation.
function clean(s) {
  return String(s == null ? '' : s).normalize('NFC')
    .replace(/[‘’ʼ]/g, "'").replace(/["„“”«»‚]/g, ' ').replace(/,/g, ' ')
    .replace(/\s+/g, ' ').trim().replace(/[\s.!?;:]+$/u, '').replace(/^[¿¡]+/, '').trim();
}
const tidy = s => String(s).normalize('NFC').replace(/\s+/g, ' ').trim();
const nfc = s => String(s == null ? '' : s).normalize('NFC').replace(/[‘’ʼ]/g, "'");

// words of a string, with offsets: {raw, low, n (lowercase + folded), len (letters), start, end}
function words(s, offset = 0) {
  const out = [];
  for (const m of String(s).matchAll(WORD_RE)) {
    const raw = m[0], low = raw.toLowerCase();
    out.push({ raw, low, n: fold(low).normalize('NFD').replace(/\p{M}/gu, ''), len: (low.match(/\p{L}/gu) || []).length || low.length, start: offset + m.index, end: offset + m.index + raw.length });
  }
  return out;
}

// Damerau-Levenshtein (optimal string alignment) distance, or max+1 once it is over max
function dl(a, b, max = 9) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const la = a.length, lb = b.length;
  let p2 = null, p1 = Array.from({ length: lb + 1 }, (_, j) => j);
  for (let i = 1; i <= la; i++) {
    const cur = [i]; let rowMin = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(p1[j] + 1, cur[j - 1] + 1, p1[j - 1] + cost);
      if (p2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, p2[j - 2] + 1);
      cur.push(v); if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    p2 = p1; p1 = cur;
  }
  return p1[lb];
}
const dl1 = (a, b) => dl(a, b, 1) <= 1;
const allowedEdits = (len) => len <= 3 ? 0 : len <= 7 ? 1 : 2;

// one pattern word against one typed word: null, or {cost: 0|1, exact}
// loose (optional Set of folded words): only these words may have typos; every other word must be exact
// x: {endings, umlaut, strict: Map, never: Set, lex: Set} (see check); typo rules in typoOk()
const NOX = {};
function wcost(w, tok, typos, loose, x = NOX) {
  let best = null;
  for (const a of w.alts) {
    if (tok.n === a.n) return { cost: 0, exact: tok.low === a.low, a };
    if (x.never && x.never.has(tok.n)) continue;               // a word from a known wrong answer: never a slip
    if (deUml(tok.low) === deUml(a.low)) {
      // the two differ only in umlauts: never a typo. Typing the plain vowel for ä/ö/ü is a slip (B1: umlautMiss, Hard)
      // unless the plain spelling is another word or form (konnten/könnten, Mutter/Mütter, fahrt/fährt): then a miss.
      // Typing an umlaut that is not there (Mütter for Mutter, würde for wurde) is always a miss.
      const dropped = unUml(a.low).replace(/ß/g, 'ss') === tok.low.replace(/ß/g, 'ss') && /[äöü]/.test(a.low);
      if (!dropped || UML_PAIR.has(tok.low) || (x.lex && x.lex.has(tok.n)) || (x.strict && x.strict.has(a.n))) continue;
      if (x.umlaut) { best = { cost: 1, exact: false, a, umlaut: true }; continue; }
      if (typos && !best && !(loose && !loose.has(a.n)) && !CLOSED.has(a.n) && allowedEdits(a.len)) best = { cost: 1, exact: false, a };
      continue;
    }
    if (!typos || best || (loose && !loose.has(a.n))) continue;
    if (x.strict && x.strict.has(a.n)) continue;
    if (typoOk(tok.n, a, x)) best = { cost: 1, exact: false, a };
  }
  return best;
}
// Whether typed (folded) is a typo of the pattern word a, not a grammar mistake:
//  - articles, pronouns, prepositions and the other CLOSED words get no typos at all;
//  - a typed word that is itself a German word or form (x.lex: the content's words) is that word, not a typo;
//  - the inflectional endings must be the same (vielen ≠ vieles, macht ≠ machst, kleinem ≠ kleinen): the typo is in
//    the stem, within the budget (B1 `endings`: 1 edit, 5+ letters; Test: 1 edit for 4-7 letters, 2 for 8+);
//  - a one-edit difference that is a vowel change (sprechen/sprichst, fuhr/fahr), ie/e (sieht/seht) or ie/ei
//    (schrieb/schreib) is a grammar form, not a typo. u↔i and i↔o (neighbouring keys) stay typos.
function typoOk(t, a, x) {
  if (CLOSED.has(a.n) || CLOSED.has(t)) return false;
  if (SOUNDS.has(t) || (x.lex && x.lex.has(t))) return false;
  if (x.endings && a.len < 5) return false;
  const budget = x.endings ? 1 : allowedEdits(a.len);
  if (!budget) return false;
  const et = ending(t), ea = ending(a.n);
  if (et !== ea) return false;
  const st = t.slice(0, t.length - et.length), sa = a.n.slice(0, a.n.length - ea.length);
  const d = dl(st, sa, budget);
  return d <= budget && !(d === 1 && formChange(st, sa));
}
// inflectional endings, longest first; the rest of the word (the stem) keeps at least 3 letters
const ENDINGS = ['ern', 'est', 'ens', 'en', 'em', 'er', 'es', 'et', 'st', 'e', 'n', 'm', 'r', 's', 't'];
const ending = n => ENDINGS.find(f => n.length >= f.length + 3 && n.endsWith(f)) || '';
const VOWEL = /[aeiou]/;
const KEY_NEIGHBOURS = new Set(['ui', 'iu', 'io', 'oi']);
// the single edit between two stems is a German vowel alternation (ablaut, e→i, ie/e, ie/ei), not a slip of the finger
function formChange(s, t) {
  let p = 0; while (p < s.length && p < t.length && s[p] === t[p]) p++;
  let q = 0; while (q < s.length - p && q < t.length - p && s[s.length - 1 - q] === t[t.length - 1 - q]) q++;
  const ds = s.slice(p, s.length - q), dt = t.slice(p, t.length - q);
  if (ds.length === 1 && dt.length === 1) return VOWEL.test(ds) && VOWEL.test(dt) && !KEY_NEIGHBOURS.has(ds + dt);
  if (ds.length + dt.length === 1) {   // one letter more or less: ie/e (sieht/seht, liest/lest)
    const c = ds || dt, long = ds ? s : t;
    return c === 'i' && (long[p + 1] === 'e' || long[p - 1] === 'e');
  }
  if (ds.length === 2 && dt.length === 2 && ds[0] === dt[1] && ds[1] === dt[0]) return (ds === 'ie' || ds === 'ei');
  return false;
}
// real words that sound like another word (wider/wieder, fiel/viel, Staat/Stadt): typing one is that word, never a typo,
// even without the lexicon
const SOUNDS = new Set('wider fiel seid wen staat meer wahr mahl lehre leere wal wahl lid leid lied stiel stil rat tod weise waise saite seite ente'.split(' '));
const unUml = s => String(s).replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u');
// both spellings of an umlaut (ä and ae) and the plain vowel map to the same letter: words equal under deUml differ
// only in umlauts
const deUml = s => String(s).replace(/ä|ae/g, 'a').replace(/ö|oe/g, 'o').replace(/ü|ue/g, 'u').replace(/ß/g, 'ss');
// words that exist without the umlaut and mean something else: typing them is a miss, not a slip
const UML_PAIR = new Set(`konnte konnten konntest konntet musste mussten musstest wurde wurden wurdest hatte hatten hattest
  ware waren war durfte durften durfe schon bruder mutter vater tochter apfel garten laden zahlen drucken kuchen fuhren
  uben schwul suss`.split(/\s+/).filter(Boolean));

// ---- patterns ----
// elements: {t:'w', alts:[{n, low, len, word}], raw} | {t:'opt', words:[w...], raw} | {t:'slot', raw, prefix?}
// each element keeps `raw` (as written, for display) and `tail` (punctuation after it, display only)
function parse(src, useSlots, dots) {
  let s = nfc(src);
  if (useSlots && dots) s = s.replace(/\.\.\.|…/g, '[…]');
  const re = useSlots ? /\[[^\]]*\]|\([^)]*\)|[^\s[\]()]+/g : /\S+/g;
  const els = []; let lead = '', prevEnd = -1, prevReal = false;
  const lit = (wd, raw) => ({ t: 'w', raw, alts: [{ n: wd.n, low: wd.low, len: wd.len, word: wd.raw }] });
  for (const m of s.matchAll(re)) {
    const tok = m[0], glued = prevReal && prevEnd === m.index;
    prevEnd = m.index + tok.length;
    if (useSlots && tok[0] === '[') { els.push({ t: 'slot', raw: '…', glued }); prevReal = true; continue; }
    if (useSlots && /^\(\[[^\]]*\]\)$/.test(tok)) { els.push({ t: 'slot', raw: '…', opt: true, glued }); prevReal = true; continue; }
    if (useSlots && tok[0] === '(') {
      const ws = words(tok.slice(1, -1));
      if (ws.length) { els.push({ t: 'opt', words: ws.map(wd => lit(wd, wd.raw)), raw: tok.slice(1, -1).trim(), glued }); prevReal = true; }
      continue;
    }
    const ws = words(tok);
    if (!ws.length) { if (els.length) els[els.length - 1].tail = (els[els.length - 1].tail || '') + tok; else lead += tok; prevReal = false; continue; }
    ws.forEach((wd, j) => { const e = lit(wd, j ? '' : tok); e.glued = j ? false : glued; els.push(e); });
    prevReal = true;
  }
  // glue: "Mein(e)" -> mein|meine, "(un)möglich" -> möglich|unmöglich, "Lieblings[Nomen]" -> slot with a prefix
  const out = [];
  for (const e of els) {
    const prev = out[out.length - 1];
    if (e.glued && prev) {
      if (e.t === 'opt' && prev.t === 'w' && e.words.length === 1 && prev.alts.length === 1) {
        const a = prev.alts[0], b = e.words[0].alts[0];
        prev.alts.push({ n: a.n + b.n, low: a.low + b.low, len: a.len + b.len, word: a.word + b.word });
        prev.raw = prev.raw + e.raw; prev.tail = e.tail; continue;
      }
      if (e.t === 'w' && prev.t === 'opt' && prev.words.length === 1 && e.alts.length === 1) {
        const a = prev.words[0].alts[0], b = e.alts[0];
        out[out.length - 1] = { t: 'w', raw: prev.raw + e.raw, tail: e.tail, alts: [b, { n: a.n + b.n, low: a.low + b.low, len: a.len + b.len, word: a.word + b.word }] };
        continue;
      }
      if (dots && e.t === 'slot' && prev.t === 'w' && prev.alts.length === 1 && !prev.tail) {   // legacy chunk strings only
        out[out.length - 1] = { t: 'slot', raw: prev.raw + '…', tail: e.tail, prefix: prev.alts[0] };
        continue;
      }
    }
    out.push(e);
  }
  return { els: out, lead, src: String(src) };
}

// Best alignment of pattern elements to typed words: fewest typos, then exact spelling, then earliest start.
// Positions are (token, offset): like validate_accept's "\s*" between words, fixed words may be written together
// ("schonmal" for "schon (ein)mal"). Such glued pieces must be spelled exactly; typos only count on whole words.
function align(pat, toks, { anywhere, typos, loose, x, slotMax = 6 }) {
  const els = pat.els, memo = new Map(), END = { n: 0, x: true, steps: null };
  const better = (a, b) => !b || a.n < b.n || (a.n === b.n && a.x && !b.x);
  // one pattern word at (ti, off): [{ti, off, c}] ways to match it
  function word(w, ti, off) {
    const t = toks[ti], out = [];
    if (!t) return out;
    if (!off) { const c = wcost(w, t, typos, loose, x); if (c) out.push({ ti: ti + 1, off: 0, c: { ...c, ti } }); }
    const rest = t.n.slice(off);
    for (const a of w.alts) {
      if (!a.n || !rest.startsWith(a.n) || (!off && rest === a.n)) continue;
      out.push(rest === a.n ? { ti: ti + 1, off: 0, c: { cost: 0, exact: false, a, ti, glued: true } } : { ti, off: off + a.n.length, c: { cost: 0, exact: false, a, ti, glued: true } });
    }
    return out;
  }
  function go(ei, ti, off) {
    if (ei === els.length) return !off && (anywhere || ti === toks.length) ? END : null;
    const key = (ei * 4096 + ti) * 128 + off;
    if (memo.has(key)) return memo.get(key);
    const e = els[ei]; let best = null;
    const take = (r, step) => {
      if (!r) return;
      const cand = { n: r.n + step.n, x: r.x && step.x, steps: { step, next: r.steps } };
      if (better(cand, best)) best = cand;
    };
    if (e.t === 'w') {
      for (const m of word(e, ti, off)) take(go(ei + 1, m.ti, m.off), { ei, ti, len: 1, n: m.c.cost, x: m.c.exact, cs: [m.c] });
    } else if (e.t === 'opt') {
      const chain = (j, ti2, off2, n, x, cs) => {
        if (j === e.words.length) return take(go(ei + 1, ti2, off2), { ei, ti, len: ti2 - ti, n, x, cs, present: true });
        for (const m of word(e.words[j], ti2, off2)) chain(j + 1, m.ti, m.off, n + m.c.cost, x && m.c.exact, [...cs, m.c]);
      };
      chain(0, ti, off, 0, true, []);
      take(go(ei + 1, ti, off), { ei, ti, len: 0, n: 0, x: true, present: false });
    } else if (off) {
      // a slot is always whole words, separated from its neighbours by spaces
    } else if (e.prefix) {
      const t = toks[ti], p = e.prefix;
      if (t && t.n.startsWith(p.n) && t.n.length > p.n.length)   // glued: the rest of this word is the slot's first word
        for (let k = 1; k <= 6 && ti + k <= toks.length; k++) take(go(ei + 1, ti + k, 0), { ei, ti, len: k, n: 0, x: t.low.startsWith(p.low), cut: p.word.length });
      if (t && t.n === p.n)                                         // written apart: "Lieblings Essen"
        for (let k = 1; k <= 6 && ti + 1 + k <= toks.length; k++) take(go(ei + 1, ti + 1 + k, 0), { ei, ti, len: 1 + k, n: 0, x: t.low === p.low, cut: -1 });
    } else {
      if (e.opt) take(go(ei + 1, ti, 0), { ei, ti, len: 0, n: 0, x: true });
      for (let k = 1; k <= slotMax && ti + k <= toks.length; k++) take(go(ei + 1, ti + k, 0), { ei, ti, len: k, n: 0, x: true });
    }
    memo.set(key, best);
    return best;
  }
  let best = null, start = 0;
  for (let s = 0; s < (anywhere ? Math.max(1, toks.length) : 1); s++) {
    const r = go(0, s, 0);
    if (r && better(r, best)) { best = r; start = s; }
    if (best && best.n === 0 && best.x) break;
  }
  if (!best) return null;
  const steps = []; for (let l = best.steps; l; l = l.next) steps.push(l.step);
  return { n: best.n, exact: best.x, steps, start };
}

// Display a pattern. fill: the alignment (slots take the typed words), or null for the model answer
// (optional words kept without their parens, slots as "…", first letter capitalised).
function display(pat, input, m) {
  const byEl = new Map((m?.steps || []).map(s => [s.ei, s]));
  const parts = pat.lead ? [pat.lead] : [];
  pat.els.forEach((e, i) => {
    const s = byEl.get(i); let txt;
    if (e.t === 'w') txt = e.raw;
    else if (e.t === 'opt') txt = m && !s?.present ? '' : e.raw;
    else if (e.opt && !m) txt = '';
    else if (!m || !s) txt = e.raw;
    else if (!s.len) txt = '';
    else {
      const tk = m.toks.slice(s.ti, s.ti + s.len);
      const typed = input.slice(tk[0].start, tk[tk.length - 1].end);
      txt = e.prefix ? (s.cut === -1 ? e.raw.slice(0, -1) + ' ' + input.slice(tk[1].start, tk[tk.length - 1].end) : e.raw.slice(0, -1) + typed.slice(s.cut)) : typed;
    }
    if (txt) parts.push(txt + (e.tail || ''));
    else if (e.tail && parts.length) parts[parts.length - 1] += e.tail;
  });
  let out = parts.join(' ').replace(/\s+([,.!?;:])/g, '$1').replace(/\s+/g, ' ').trim();
  if (!m) out = out.replace(/^(\P{L}*)(\p{L})/u, (_, a, b) => a + b.toUpperCase());
  return out;
}
const cache = new Map();
function compile(src, useSlots, dots) {
  const k = (useSlots ? 1 : 0) + (dots ? 2 : 0) + '|' + src;
  let p = cache.get(k);
  if (!p) { p = parse(src, useSlots, dots); if (cache.size > 5000) cache.clear(); cache.set(k, p); }
  return p;
}
// "(entschuldigung) könnten sie das [x]" -> "Entschuldigung könnten sie das …"
// caseRef (optional, e.g. the German example sentence): lowercase pattern words take its capitalisation ("Sie", nouns)
function renderPattern(p, caseRef) {
  let out = display(compile(p, true, false), '', null);
  if (caseRef) {
    const ref = new Map();
    String(caseRef).normalize('NFC').split(/(?<=[.!?:])\s+/).forEach(sent => words(sent).forEach((w, i) => { if (i && !ref.has(w.low)) ref.set(w.low, w.raw); }));
    out = out.replace(WORD_RE, w => ref.get(w.toLowerCase()) || w);
    out = out.replace(/^(\P{L}*)(\p{L})/u, (_, a, b) => a + b.toUpperCase());
  }
  return out;
}

// case check for strictCase: an aligned word whose capitalisation differs
function caseDiffers(pat, m) {
  for (const s of m.steps) {
    const e = pat.els[s.ei];
    if (!s.cs) continue;
    for (let j = 0; j < s.cs.length; j++) {
      if (s.cs[j].glued) continue;
      const t = m.toks[s.cs[j].ti], want = s.cs[j].a.word;
      if (s.cs[j].cost === 0 ? fold(t.raw) !== fold(want) : (t.raw[0] === t.raw[0].toUpperCase()) !== (want[0] === want[0].toUpperCase())) return true;
    }
    void e;
  }
  return false;
}

function run(input, pat, opts) {
  const toks = words(input);
  const m = toks.length ? align(pat, toks, opts) : null;
  if (m) m.toks = toks;
  return m;
}

// B1: strict words in their exact case (focusMiss) and capitals against a reference (capMiss); sentence starts exempt
// "recht/Recht haben", "recht/Recht geben": Duden allows both spellings, so neither case is a slip
const HABEN_GEBEN = /^(hab|habe|hast|hat|haben|habt|hatte|hattest|hatten|hattet|haette|haettest|haetten|haettet|gehabt|geb|gebe|gibst|gibt|geben|gebt|gab|gabst|gaben|gabt|gegeben|gib)$/;
const RECHT_DET = /^(das|des|dem|ein|eines|einem|kein|keines|keinem|mein|dein|sein|ihr|unser|euer|jedes|jedem|gleiche|gleiches|volle|volles|vollem|gutes|gutem)$/;
const eitherCase = (toks, i) => toks[i].n === 'recht' && !(i > 0 && RECHT_DET.test(toks[i - 1].n)) &&
  toks.slice(Math.max(0, i - 5), i + 6).some(t => HABEN_GEBEN.test(t.n));
function caseChecks(res, m, inp, x, caseRef) {
  const initial = t => t.start === 0 || /[.!?:]\s*["„“]?\s*$/.test(inp.slice(0, t.start));
  const used = new Set();
  for (const s of m.steps) (s.cs || []).forEach(c => {
    if (c.glued) return;
    const t = m.toks[c.ti]; used.add(c.ti);
    if (initial(t) || eitherCase(m.toks, c.ti)) return;
    const want = x && x.strict && x.strict.get(c.a.n);
    if (want && /\p{Lu}/u.test(want[0]) !== /\p{Lu}/u.test(t.raw[0])) { res.focusMiss.push({ typed: t.raw, expected: want, start: t.start, end: t.end }); return; }
    const ref = caseRef && caseRef.get(t.n);
    if (!want && ref && /\p{Lu}/u.test(ref[0]) !== /\p{Lu}/u.test(t.raw[0])) res.capMiss.push({ typed: t.raw, expected: ref, start: t.start, end: t.end });
  });
  if (!caseRef) return;
  m.toks.forEach((t, i) => {   // words in slots and around the pattern: only nouns written in lowercase
    if (used.has(i) || initial(t) || eitherCase(m.toks, i)) return;
    const ref = caseRef.get(t.n);
    if (ref && /\p{Lu}/u.test(ref[0]) && !/\p{Lu}/u.test(t.raw[0])) res.capMiss.push({ typed: t.raw, expected: ref, start: t.start, end: t.end });
  });
  res.capMiss.sort((a, b) => a.start - b.start);
}
// Word-level diff of an answer against a right sentence (LCS on folded words): which typed words are not in the
// right one (`wrong`, offsets into a), and which words of b are not in a (`missing`, indexes into words(b)).
function diffWords(a, b) {
  const A = words(a), B = words(b), n = A.length, m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i].n === B[j].n ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const wrong = [], keepB = new Set();
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i].n === B[j].n) { keepB.add(j); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) { wrong.push({ start: A[i].start, end: A[i].end, word: A[i].raw }); i++; }
    else j++;
  }
  for (; i < n; i++) wrong.push({ start: A[i].start, end: A[i].end, word: A[i].raw });
  return { wrong, missing: B.map((w, k) => keepB.has(k) ? null : k).filter(k => k != null), right: B };
}

// the word-level options for wcost/typoOk
function xOpts(opts) {
  const set = v => (v ? new Set([...v].map(w => fold(String(w).toLowerCase()))) : null);
  return {
    endings: !!opts.endings, umlaut: !!opts.umlaut,
    strict: opts.strict && opts.strict.length ? new Map(opts.strict.map(w => [fold(String(w).toLowerCase()), String(w)])) : null,
    never: set(opts.never), lex: opts.lexicon || null,
  };
}

function check(input, accepted, opts = {}) {
  const strictCase = !!opts.strictCase, useSlots = opts.slots !== false, anywhere = !!opts.anywhere, typos = opts.typos !== false;
  const loose = opts.loose ? new Set([...opts.loose].map(w => fold(String(w).toLowerCase()))) : null;
  const list = (Array.isArray(accepted) ? accepted : [accepted]).filter(a => a != null && String(a).trim() !== '');
  const inp = nfc(input).replace(/\s+/g, ' ').trim();
  const res = { ok: false, exact: false, close: false, articleMiss: false, caseMiss: false, matched: null, others: list.slice(), fixed: list[0] ? tidy(list[0]) : '', typos: [], input: inp };
  const b1 = opts.endings || opts.umlaut || opts.strict || opts.caseRef || opts.slotMax;
  if (b1) Object.assign(res, { umlautMiss: [], capMiss: [], focusMiss: [], nearest: null });
  const toks = words(inp);
  if (!toks.length || !list.length) return res;
  const pats = list.map(a => compile(a, useSlots, !anywhere));
  const x = xOpts(opts);
  const aopts = { anywhere, typos, loose, x, slotMax: opts.slotMax || 6 };

  // 1. best match over all accepted strings: fewest typos, then exact spelling, then list order
  let hit = -1, best = null;
  pats.forEach((p, k) => {
    const m = align(p, toks, aopts);
    if (m && (!best || m.n < best.n || (m.n === best.n && m.exact && !best.exact))) { best = m; hit = k; }
  });
  if (best) {
    best.toks = toks;
    const p = pats[hit];
    res.matched = list[hit]; res.others = list.filter((_, k) => k !== hit); res.fixed = display(p, inp, best);
    res.typos = [];
    for (const s of best.steps) (s.cs || []).forEach((c, j) => {
      if (!c.cost) return;
      // the fix in its written case: the reference's capital (Präsentation), or a capital where he typed one
      const t = toks[c.ti];
      const ref = opts.caseRef && typeof opts.caseRef.get === 'function' ? opts.caseRef.get(c.a.n) : null;
      let expected = ref || c.a.word;
      if (/^\p{Lu}/u.test(t.raw)) expected = expected.charAt(0).toUpperCase() + expected.slice(1);
      const miss = { typed: t.raw, expected, start: t.start, end: t.end };
      (c.umlaut ? res.umlautMiss : res.typos).push(miss);
    });
    // where the pattern sits in the answer, and what each slot took (in order)
    let s0 = Infinity, e0 = -1; const fills = [];
    for (const s of best.steps) {
      const e = p.els[s.ei];
      if (e.t === 'slot') {
        if (!s.len) { fills.push(''); continue; }
        const a = toks[s.ti], b = toks[s.ti + s.len - 1];
        fills.push(inp.slice(a.start, b.end)); s0 = Math.min(s0, a.start); e0 = Math.max(e0, b.end);
        continue;
      }
      for (const c of s.cs || []) { const t = toks[c.ti]; s0 = Math.min(s0, t.start); e0 = Math.max(e0, t.end); }
    }
    res.span = e0 >= 0 ? [s0, e0] : null; res.fills = fills;
    if (strictCase && caseDiffers(p, best)) { res.caseMiss = true; return res; }
    res.ok = true; res.exact = best.exact && !res.typos.length && !(res.umlautMiss || []).length;
    if (b1) caseChecks(res, best, inp, x, opts.caseRef);
    if (res.focusMiss && res.focusMiss.length) { res.ok = false; res.exact = false; }
    return res;
  }

  // 2. nouns: right word (typos allowed), wrong or missing article
  if (opts.pos === 'noun') {
    const rest = ARTICLES.includes(toks[0].n) ? toks.slice(1) : toks;
    for (let k = 0; k < pats.length && rest.length; k++) {
      const p = pats[k], first = p.els[0];
      if (!first || first.t !== 'w' || !ARTICLES.includes(first.alts[0].n)) continue;
      if (align({ els: p.els.slice(1) }, rest, { anywhere: false, typos, loose })) {
        res.articleMiss = true; res.matched = list[k]; res.fixed = tidy(list[k]); res.others = list.filter((_, j) => j !== k);
        return res;
      }
    }
    return res;
  }

  // 3. close: at least half of a pattern's fixed words are in the answer (typos allowed)
  for (let k = 0; k < pats.length; k++) {
    const fixedWords = pats[k].els.filter(e => e.t === 'w');
    if (fixedWords.length < 2) continue;
    const found = fixedWords.filter(w => toks.some(t => wcost(w, t, typos, loose))).length;
    if (found * 2 >= fixedWords.length) { res.close = true; break; }
  }
  if (b1) {   // the accepted string closest to the answer: the most fixed words found (ties: list order)
    let bestK = 0, bestF = -1;
    pats.forEach((p, k) => {
      const fw = p.els.flatMap(e => e.t === 'w' ? [e] : e.t === 'opt' ? e.words : []);
      const f = fw.filter(w => toks.some(t => wcost(w, t, typos, loose, x))).length - 0.01 * Math.max(0, fw.length - toks.length);
      if (f > bestF) { bestF = f; bestK = k; }
    });
    res.nearest = bestK;
  }
  return res;
}

// ---- the rest of the sentence on a phrase card ----
// A phrase card grades one phrase: the highlighted part of an English sentence. restCheck() grades the rest of what he
// typed: it has to be the model sentence around the phrase he used (with the same typo rules), a saved variant, or a
// part of one of them that holds the phrase ("vor allem die vielen Cafés"). The model's slot words fill the slots of
// every accepted phrase, so slot words are checked word for word too ("dass wir das Geschenk zusammen kaufen").
//   restCheck(input, base, accepted, opts) → {status: 'ok'|'differs'|'na', frag, ref, typos, umlautMiss, marks, wrong}
//     base: the model sentence. opts: check()'s B1 options, plus matched (the accepted pattern his answer matched; its
//     sentence comes first), variants (whole sentences confirmed right) and caseRef (Map: folded word → written form).
//     'na': the model does not hold an accepted phrase, so there is nothing to compare with.
//     ref: the sentence compared with (the closest one when the rest differs); marks: ranges in ref to highlight
//     (whole words, or the differing ending of a word he nearly had); wrong: ranges in the answer that differ.
const SLOT_RE = /\(\[[^\]]*\]\)|\[[^\]]*\]/g;
const VERB_LAST = new Set(['dass', 'weil', 'ob', 'wenn', 'obwohl', 'damit', 'sobald', 'bevor', 'nachdem', 'waehrend', 'falls', 'seitdem']);
const INVERT = new Set(['deshalb', 'deswegen', 'darum', 'daher', 'trotzdem', 'dann', 'danach', 'ausserdem', 'also', 'sonst', 'dennoch', 'denn']);
const AUX_SEIN = /^(bin|bist|ist|sind|seid)$/, AUX_HABEN = /^(hab|habe|hast|hat|haben|habt)$/;
function shapeOf(p) {
  const ws = words(String(p || '').replace(SLOT_RE, ' ')).map(w => w.n);
  return { clause: [ws.filter(w => VERB_LAST.has(w)).sort().join('+'), ws.filter(w => INVERT.has(w)).sort().join('+')].join('|'),
    sein: ws.some(w => AUX_SEIN.test(w)), haben: ws.some(w => AUX_HABEN.test(w)) };
}
// the same clause words, and not sein in one where the other has haben
const sameShape = (a, b) => a.clause === b.clause && !((a.sein && !a.haben && b.haben && !b.sein) || (a.haben && !a.sein && b.sein && !b.haben));
function fillSlots(p, fills) {
  const n = (String(p).match(SLOT_RE) || []).length;
  if (!n) return String(p);
  if (n !== fills.length) return null;
  let k = 0, bad = false;
  const out = String(p).replace(SLOT_RE, m => { const f = fills[k++]; if (!f && m[0] === '[') bad = true; return f ? ` ${f} ` : ' '; });
  return bad ? null : out.replace(/\s+/g, ' ').trim();
}
// a pattern (slots filled) as text in the sentence: the base sentence's spelling of each word, nouns from caseRef
function renderIn(mid, base, caseRef, initial) {
  const ref = new Map();
  String(base).normalize('NFC').split(/(?<=[.!?:])\s+/).forEach(sent => words(sent).forEach((w, i) => { if (i && !ref.has(w.low)) ref.set(w.low, w.raw); }));
  let out = display(compile(mid, true, false), '', null).replace(WORD_RE, w => ref.get(w.toLowerCase()) || (caseRef && caseRef.get(fold(w.toLowerCase()))) || w.toLowerCase());
  if (initial) out = out.replace(/^(\P{L}*)(\p{L})/u, (_, a, b) => a + b.toUpperCase());
  return out;
}
const joinText = (...parts) => parts.filter(s => s && s.trim()).join(' ').replace(/\s+([,.!?;:])/g, '$1').replace(/\s+/g, ' ').trim();

function restCheck(input, base, accepted, opts = {}) {
  const list = (Array.isArray(accepted) ? accepted : [accepted]).filter(a => a != null && String(a).trim() !== '');
  const inp = nfc(input).replace(/\s+/g, ' ').trim();
  const toks = words(inp);
  const out = { status: 'na', frag: false, ref: base ? tidy(base) : '', typos: [], umlautMiss: [], marks: [], wrong: [] };
  if (!base || !toks.length || !list.length) return out;
  const slotMax = opts.slotMax || 10;
  const mr = check(base, list, { anywhere: true, slotMax, typos: false });
  if (!mr.ok || !mr.span) return out;
  const pre = base.slice(0, mr.span[0]), post = base.slice(mr.span[1]);
  const order = opts.matched != null && list.includes(opts.matched) ? [opts.matched, ...list.filter(p => p !== opts.matched)] : list;
  // another accepted phrase goes into the model sentence only when it has the same shape: the same subordinators and
  // inversion words (ich finde dass … / ich finde …: the verb moves) and the same Perfekt helper (früher habe ich /
  // früher bin ich: the participle decides). The model's own words fill the slots.
  const shape = shapeOf(mr.matched);
  const cands = [];
  for (const p of order) {
    if (p !== mr.matched && !sameShape(shapeOf(p), shape)) continue;
    const mid = fillSlots(p, mr.fills); if (mid != null) cands.push({ pre, mid, post });
  }
  for (const v of opts.variants || []) if (v) cands.push({ pre: '', mid: String(v), post: '', literal: true });
  const x = xOpts({ ...opts, endings: opts.endings !== false });
  const typos = opts.typos !== false;
  const aopts = { anywhere: false, typos, loose: null, x, slotMax };
  const first = toks[0], last = toks[toks.length - 1];
  const fits = (e, t, atEnd) => !e || e.t !== 'w' || !!wcost(e, t, typos, null, x) || e.alts.some(a => a.n && (atEnd ? t.n.endsWith(a.n) : t.n.startsWith(a.n)));
  const text = c => c.literal ? tidy(c.mid) : joinText(pre, renderIn(c.mid, base, opts.caseRef, !/\p{L}/u.test(pre)), post);
  for (const c of cands) {
    const P = compile(c.pre, false, false).els, M = compile(c.mid, !c.literal, false).els, Q = compile(c.post, false, false).els;
    for (let s = 0; s <= P.length; s++) {
      const head = s < P.length ? P[s] : M[0];
      if (head && head.t === 'w' && !fits(head, first, false)) continue;
      for (let e = Q.length; e >= 0; e--) {
        const tail = e > 0 ? Q[e - 1] : M[M.length - 1];
        if (tail && tail.t === 'w' && !fits(tail, last, true)) continue;
        const m = align({ els: [...P.slice(s), ...M, ...Q.slice(0, e)] }, toks, aopts);
        if (!m) continue;
        const res = { ...out, status: 'ok', frag: s > 0 || e < Q.length, ref: text(c) };
        for (const st of m.steps) for (const cs of st.cs || []) {
          if (!cs.cost) continue;
          const t = toks[cs.ti];
          (cs.umlaut ? res.umlautMiss : res.typos).push({ typed: t.raw, expected: cs.a.word, start: t.start, end: t.end });
        }
        return res;
      }
    }
  }
  // nothing fits: the closest sentence (most words in common, his phrase first on a tie) and the word diff
  let best = null, bestN = -1;
  for (const c of cands) {
    const ref = text(c), n = lcsWords(words(inp), words(ref));
    if (n > bestN) { bestN = n; best = ref; }
  }
  return { ...out, status: 'differs', ref: best, ...markDiff(inp, best) };
}
function lcsTable(A, B, eq = (a, b) => a.n === b.n) {
  const L = Array.from({ length: A.length + 1 }, () => new Array(B.length + 1).fill(0));
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) L[i][j] = eq(A[i], B[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  return L;
}
const lcsWords = (A, B) => lcsTable(A, B)[0][0];
// the LCS walk as gaps: [{a: [indexes in A], b: [indexes in B]}] between matched words, plus the matched pairs
function gaps(A, B) {
  const L = lcsTable(A, B), out = [], pairs = [];
  let i = 0, j = 0, cur = { a: [], b: [], lead: true };
  while (i < A.length || j < B.length) {
    if (i < A.length && j < B.length && A[i].n === B[j].n) { out.push(cur); pairs.push([i, j]); cur = { a: [], b: [], lead: false }; i++; j++; }
    else if (j >= B.length || (i < A.length && L[i + 1][j] >= L[i][j + 1])) cur.a.push(i++);
    else cur.b.push(j++);
  }
  cur.trail = true; out.push(cur);
  return { gaps: out.filter(g => g.a.length || g.b.length), pairs };
}
// he nearly had it: the same word up to its ending, or the same but for an umlaut
const nearly = (a, b) => commonPrefix(a.low, b.low) >= 3 || deUml(a.low) === deUml(b.low);
const commonPrefix = (a, b) => { let p = 0; while (p < a.length && p < b.length && a[p] === b[p]) p++; return p; };
// Word diff of an answer a against a right sentence b: the words of a that differ (wrong) and the parts of b to mark.
// A word he nearly had is marked from its first differing letter (from the ending when that is where it differs:
// viel[en]); others whole. Words of b before or after everything he wrote are not marked when he wrote nothing there
// (an answer that is a part of the sentence).
function markDiff(a, b) {
  const A = words(a), B = words(b), { gaps: G } = gaps(A, B);
  const wrong = [], marks = [];
  for (const g of G) {
    if ((g.lead || g.trail) && !g.a.length) continue;
    g.a.forEach(i => wrong.push({ start: A[i].start, end: A[i].end, word: A[i].raw }));
    g.b.forEach((j, k) => {
      const w = B[j], t = g.a[k] != null ? A[g.a[k]] : null;
      let from = w.start;
      if (t && nearly(t, w)) {
        const p = commonPrefix(t.low, w.low), end = w.raw.length - ending(w.n).length;
        if (p < w.raw.length) from = w.start + Math.min(p, end);
      }
      marks.push({ start: from, end: w.end });
    });
  }
  return { wrong, marks };
}

// Situations (Sprechen Teil 1–3): the answer is free, only the phrase is graded. formCheck() compares it with the model
// sentence and flags only a word that is the model's word in another form, in the same place: one word between the
// same neighbours, differing in its ending (einen anderes Vorschlag), an umlaut, or as another case or gender of the
// same article or pronoun (bei mich, für einer Party). Other wordings pass.
//   → {status: 'ok'|'differs', ref, marks, wrong}
const FAMILY = [/^d(er|ie|as|en|em|es)$/, /^ein(e|en|em|er|es)?$/, /^kein(e|en|em|er|es)?$/, /^mein(e|en|em|er|es)?$/, /^dein(e|en|em|er|es)?$/,
  /^sein(e|en|em|er|es)?$/, /^ihr(e|en|em|er|es)$/, /^unser(e|en|em|er|es)?$/, /^eu(e)?r(e|en|em|er|es)?$/, /^dies(e|er|en|em|es)$/, /^jed(e|er|en|em|es)$/,
  /^welch(e|er|en|em|es)$/, /^(ich|mich|mir)$/, /^(du|dich|dir)$/, /^(er|ihn|ihm)$/, /^(wir|uns)$/, /^(ihnen)$/,
  /^(bin|bist|ist|sind|seid|sein|hab|habe|hast|hat|haben|habt)$/, /^(hatte|hattest|hatten|hattet|war|warst|waren|wart)$/, /^(werde|wirst|wird|werden|werdet)$/,
  /^(war|warst|waren|wart)$/, /^(wurde|wurdest|wurden|wurdet)$/];
const family = n => FAMILY.findIndex(re => re.test(n));
function formPair(a, b, x = NOX) {
  if (a.n === b.n) return false;
  if (deUml(a.low) === deUml(b.low)) return true;   // hatte/hätte, schon/schön, Mutter/Mütter
  if (CLOSED.has(a.n) && CLOSED.has(b.n)) { const f = family(a.n); if (f >= 0 && f === family(b.n)) return true; }
  // nearly the same word in the same place, and not a typo by the typo rules: das/dass, viel/fiel, Staat/Stadt, wider
  if (a.len >= 3 && dl(a.n, b.n, 1) <= 1 && !typoOk(a.n, { n: b.n, len: b.len }, { endings: true, lex: x.lex })) return true;
  if (CLOSED.has(a.n) && CLOSED.has(b.n)) return false;   // für/vor, mit/bei: another word, not another form
  // the same word up to a different ending: vieles/vielen, anderes/anderen, müsst/müssen, kannt/kannst
  const p = commonPrefix(a.n, b.n), ra = a.n.slice(p), rb = b.n.slice(p);
  return p >= 3 && ra !== rb && ENDING_SET.has(ra) && ENDING_SET.has(rb);
}
const ENDING_SET = new Set(['', ...ENDINGS]);
function formCheck(input, base, opts = {}) {
  const x = xOpts({ ...opts, endings: true });
  const inp = nfc(input).replace(/\s+/g, ' ').trim();
  const A = words(inp), B = words(base || '');
  const out = { status: 'ok', ref: base ? tidy(base) : '', marks: [], wrong: [] };
  if (!A.length || !B.length) return out;
  for (const g of gaps(A, B).gaps) {
    if (g.a.length !== 1 || g.b.length !== 1) continue;
    const t = A[g.a[0]], w = B[g.b[0]];
    if (!formPair(t, w, x)) continue;
    out.status = 'differs';
    out.wrong.push({ start: t.start, end: t.end, word: t.raw });
    const p = commonPrefix(t.low, w.low), end = w.raw.length - ending(w.n).length;
    out.marks.push({ start: p >= 3 && p < w.raw.length ? w.start + Math.min(p, end) : w.start, end: w.end });
  }
  return out;
}

// validate_accept.matches(answer, pattern) without typo tolerance
const matches = (answer, pattern) => check(answer, [pattern], { anywhere: true, typos: false }).ok;

// ---- nouns: definite ("the car") or indefinite ("a car") prompts ----
const hash = s => { let x = 2166136261; for (const c of String(s)) { x ^= c.codePointAt(0); x = Math.imul(x, 16777619); } return x >>> 0; };
const stripArt = g => String(g || '').replace(/^\s*(the|a|an)\s+/i, '').trim();
// 'indef' for about 30% of countable common nouns (stable per id); 'def' for everything else
function nounForm(word) {
  if (!word || word.pos !== 'noun' || !word.art) return 'def';
  const g = stripArt((word.en || [])[0]);
  if (!word.pl || word.pl === word.w || !g) return 'def';        // plural-only or uncountable
  if (/^\P{Ll}*\p{Lu}/u.test(g)) return 'def';                     // proper nouns, holidays, languages
  return hash(word.id || word.w) % 100 < 30 ? 'indef' : 'def';
}
const anSound = g => /^(hour|honest|honou?r|heir)/i.test(g) || (/^[aeiou]/i.test(g) && !/^(u[nst]i|use|usu|ur[aeiou]|eu|one\b|once)/i.test(g));
function nounPrompt(word, form = nounForm(word)) {
  const g = stripArt((word.en || [])[0] || word.w);
  return form === 'indef' ? `${anSound(g) ? 'an' : 'a'} ${g}` : `the ${g}`;
}
const INDEF = { der: 'ein', das: 'ein', die: 'eine' };
const toIndef = s => { const m = String(s).match(/^(der|die|das)\s+(.+)$/i); return m ? `${INDEF[m[1].toLowerCase()]} ${m[2]}` : s; };

function acceptedForWord(word, form = 'def') {
  if (!word) return [];
  const main = word.pos === 'noun' && word.art ? `${word.art} ${word.w}` : word.w;
  const def = [main];
  for (const a of word.alt || []) if (a && !def.includes(a)) def.push(a);
  if (form !== 'indef' || word.pos !== 'noun' || !word.art) return def;
  const out = [];
  for (const a of def) { const i = toIndef(a); if (!out.includes(i)) out.push(i); }
  for (const a of def) if (!out.includes(a)) out.push(a);   // the definite form counts too
  return out;
}
// t: the German chunk string, variants split on " / ". ex (optional): the German example sentence, accepted first.
function acceptedForChunk(t, ex) {
  const out = [];
  if (ex) out.push(ex);
  for (const v of String(t || '').split(' / ').map(s => s.trim()).filter(Boolean)) if (!out.includes(v)) out.push(v);
  return out;
}

// Gap items ("Ich kaufe ___ Tisch. (der)"): the answer word alone, or the prompt with the gap filled, both count.
// gapLoose() lists the carried-over words, which may have typos; the gap word itself must be exact.
const GAP = '___';
const gapBase = prompt => String(prompt || '').replace(/\s*\([^()]*\)\s*$/, '').trim();
function gapFill(prompt, answer) {
  const base = gapBase(prompt), i = base.indexOf(GAP);
  let a = String(answer);
  if (i >= 0 && !/\p{L}/u.test(base.slice(0, i)) && /\p{Ll}/u.test(a[0] || '') && /[.!?]\s*$/.test(base)) a = a[0].toUpperCase() + a.slice(1);
  return i < 0 ? null : { before: base.slice(0, i), gap: a, after: base.slice(i + GAP.length), text: base.slice(0, i) + a + base.slice(i + GAP.length) };
}
function acceptedForGap(prompt, answers) {
  const list = (Array.isArray(answers) ? answers : [answers]).filter(Boolean);
  if (!String(prompt || '').includes(GAP)) return list.slice();
  const out = list.slice();
  for (const a of list) { const f = gapFill(prompt, a); if (f && !out.includes(f.text)) out.push(f.text); }
  return out;
}
const gapLoose = prompt => words(gapBase(prompt).split(GAP).join(' ')).map(w => w.n);

const api = { check, matches, diffWords, markDiff, restCheck, shapeOf, sameShape, formCheck, renderPattern, acceptedForWord, acceptedForChunk, acceptedForGap, gapFill, gapLoose, nounForm, nounPrompt, toIndef, clean, fold, dl, dl1, words, ending, CLOSED };
export default api;
export { check, matches, diffWords, markDiff, restCheck, shapeOf, sameShape, formCheck, renderPattern, acceptedForWord, acceptedForChunk, acceptedForGap, gapFill, gapLoose, nounForm, nounPrompt, toIndef, clean, fold, dl, dl1, words, ending, CLOSED };
