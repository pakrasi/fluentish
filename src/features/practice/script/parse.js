/* Script mode: reading a pasted script. Pure; tested in node (tests/unit/script-parse.test.mjs).

   detect(text)      what was pasted: German, English, German with English (EN/DE pairs), or notes; and its language
   parseScript(text) sections → sentences (with ids), the English line per sentence when there is one, the parts of a
                     sentence (his "Bausteine": numbered pair lines without ✦ before a ✦ line), slide notes, and the
                     words he set in **bold** (the words he had to learn: they arrive marked)
   splitSentences, tokenize, wordCount, isLong, splitLocal, partsOf: the pieces the views use

   Formats read:
     plain German      paragraphs; # headings make sections (else paragraphs do)
     EN/DE pairs       "1. ✦ **EN**: …" / "**DE**: …" (bold markers optional), or alternating English and German lines
     his Lern-Edition  ## Teil N — Title, ### Vortrag (read), ### Vertiefung and ### Publikumsfragen (skipped),
                       **ROLLUP** (a new section), *(Folien 1–2)* (a section note) */

import { SECTION_MAX, SECTION_SPLIT_AT, LONG_SENTENCE } from './config.js';

const DE_STOP = new Set('der die das und ist nicht ich ein eine zu mit auf für von den dem sich es wir sie auch aber wie wenn dass oder noch so im ins zum zur wird werden hat haben sind war man nur schon sehr kann können mehr dann denn weil also hier da was wer bei aus nach über unter einen einem einer auch ja nein euch ihr uns mir mich dir dich doch immer gibt heute'.split(' '));
const EN_STOP = new Set('the and is to of a in that it for you with on are this was be have i we they not but at what so an as by from or my your our their can will would there here about which when just like do does did has had been were how why who me us them it\'s i\'m don\'t we\'re let\'s into than then very also'.split(' '));
const lower = (/** @type {string} */ s) => s.toLowerCase();
const plainWords = (/** @type {string} */ s) => (lower(s).match(/[\p{L}']+/gu) || []);

/** 'de' | 'en' | null by stop-word ratio. @param {string} text */
export function langOf(text) {
  const w = plainWords(text);
  let de = 0, en = 0;
  for (const x of w) { if (DE_STOP.has(x)) de++; if (EN_STOP.has(x)) en++; }
  if (!de && !en) return /[äöüß]/i.test(text) ? 'de' : null;
  return de >= en ? 'de' : 'en';
}

/* ------------------------------------------------------------------ */
/* Detection                                                            */
/* ------------------------------------------------------------------ */

const PAIR_RE = /^\s*(?:\d+[.)]\s*)?(?:✦\s*)?(?:\*\*|__)?(EN|DE)(?:\*\*|__)?\s*:\s*(?:\*\*|__)?/i;
const BULLET_RE = /^\s*(?:[-*•–]|\d+[.)])\s+/;

/**
 * @param {string} text
 * @returns {{format: 'de' | 'en' | 'pairs' | 'notes', lang: 'de' | 'en' | null, words: number, sections: number}}
 */
export function detect(text) {
  const body = stripFrontMatter(String(text || ''));
  const lines = body.split(/\r?\n/).map(l => l.trim()).filter(l => l && !/^#{1,6}\s/.test(l) && !/^>/.test(l));
  const marked = lines.filter(l => PAIR_RE.test(l)).length;
  let format = /** @type {'de' | 'en' | 'pairs' | 'notes'} */ ('de');
  let lang = langOf(body);
  if (marked >= 2) { format = 'pairs'; lang = 'de'; }
  else if (alternating(lines)) { format = 'pairs'; lang = 'de'; }
  else {
    const notes = lines.filter(l => BULLET_RE.test(l) || (plainWords(l).length < 8 && !/[.!?…:]["“”»]?$/.test(l))).length;
    if (lines.length >= 3 && notes / lines.length >= 0.6) format = 'notes';
    else format = lang === 'en' ? 'en' : 'de';
  }
  let sections = 0, words = 0;
  if (format === 'pairs' || (format !== 'en' && lang !== 'en')) {
    const s = parseScript(body, { format: format === 'notes' ? 'de' : format, id: counterIds() });
    sections = s.sections.length;
    words = s.sections.reduce((n, x) => n + x.sentences.reduce((m, y) => m + wordCount(y.de), 0), 0);
  } else words = plainWords(body).length;
  return { format, lang, words, sections };
}

/** Alternating English and German lines: at least 70 % of the lines pair up. @param {string[]} lines */
function alternating(lines) {
  const ls = lines.filter(l => !BULLET_RE.test(l) || plainWords(l).length > 3).map(l => l.replace(BULLET_RE, ''));
  if (ls.length < 4) return false;
  let pairs = 0;
  for (let i = 0; i + 1 < ls.length; i++) {
    if (langOf(ls[i]) === 'en' && langOf(ls[i + 1]) === 'de') { pairs++; i++; }
  }
  return (pairs * 2) / ls.length >= 0.7;
}

/* ------------------------------------------------------------------ */
/* Sentences and tokens                                                 */
/* ------------------------------------------------------------------ */

const ABBR = new Set(['z', 'b', 'd', 'h', 'u', 'a', 'bzw', 'ca', 'dr', 'prof', 'nr', 'usw', 'etc', 'vgl', 'evtl', 'ggf', 'inkl', 'bspw', 'mio', 'mrd', 'str', 'tel', 'hr', 'fr', 'st', 'e', 'v', 'chr', 'jh', 'mr', 'mrs', 'ms', 'vs', 'max', 'min']);

/**
 * German sentences. Splits after . ! ? … when the next word starts a sentence; never after an abbreviation
 * ("z. B.", "Dr.") or a number ("am 3. Oktober").
 * @param {string} text @returns {string[]}
 */
export function splitSentences(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return [];
  /** @type {string[]} */ const out = [];
  let start = 0;
  const re = /([.!?…]+)(["“”»«'’)]*)\s+(?=[„"“«»'(]?[\p{Lu}\d])/gu;
  let m;
  while ((m = re.exec(s))) {
    const end = m.index + m[1].length + m[2].length;
    const before = s.slice(start, m.index);
    const last = (before.match(/([\p{L}\d]+)$/u) || [])[1] || '';
    if (m[1] === '.' && (ABBR.has(last.toLowerCase()) || /^\d+$/.test(last) || /^\p{L}$/u.test(last))) continue;
    out.push(s.slice(start, end).trim());
    start = end;
  }
  const tail = s.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

/**
 * @typedef {object} Token
 * @property {string} t      the text as written (with its punctuation for non-word tokens)
 * @property {boolean} w     a word (letters or digits)
 * @property {number} k      word index in the sentence (-1 for punctuation)
 * @property {boolean} [num] a number
 * @property {boolean} [sp]  a space comes before it
 */

/**
 * Tokens of one sentence: words (hyphenated compounds are one word), and punctuation and quotes as their own tokens.
 * @param {string} sentence @returns {Token[]}
 */
export function tokenize(sentence) {
  /** @type {Token[]} */ const out = [];
  let k = 0;
  for (const chunk of String(sentence || '').split(/(\s+)/)) {
    if (!chunk || /^\s+$/.test(chunk)) continue;
    const m = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u.exec(chunk) || ['', '', chunk, ''];
    const [, lead, core, trail] = m;
    let first = true;
    const push = (/** @type {Token} */ tok) => { if (first) { tok.sp = out.length > 0; first = false; } out.push(tok); };
    if (lead) push({ t: lead, w: false, k: -1 });
    if (core) push({ t: core, w: true, k: k++, num: /^[\d.,:]+$/.test(core) });
    if (trail) push({ t: trail, w: false, k: -1 });
  }
  return out;
}

/** Words in a text. @param {string} s */
export const wordCount = s => tokenize(s).filter(x => x.w).length;

/** A sentence too long to say comfortably. @param {string} s */
export const isLong = s => wordCount(s) > LONG_SENTENCE;

const SUBORD = /,\s+(?=(?:die|der|das|dem|den|deren|dessen|weil|dass|wenn|obwohl|damit|als|ob|während|bevor|nachdem|sodass|indem|wo|was|wie|um)\b)/i;

/**
 * Split a long sentence locally at the comma before a subordinator or relative pronoun nearest the middle.
 * Returns null when there is no such place. The first part ends with a full stop; the second keeps its words.
 * @param {string} s @returns {[string, string] | null}
 */
export function splitLocal(s) {
  const text = String(s);
  /** @type {number[]} */ const cuts = [];
  const re = new RegExp(SUBORD.source, 'gi');
  let m;
  while ((m = re.exec(text))) cuts.push(m.index);
  if (!cuts.length) return null;
  const mid = text.length / 2;
  const at = cuts.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid))[0];
  const a = text.slice(0, at).trim(), b = text.slice(at + 1).trim();
  if (wordCount(a) < 3 || wordCount(b) < 3) return null;
  return [`${a}.`, b.charAt(0).toUpperCase() + b.slice(1)];
}

/**
 * The parts of a sentence for the Parts step: his own Bausteine when the import had them, else the sentence cut at
 * commas, colons and dashes into pieces of about 4 to 9 words.
 * @param {{de: string, parts?: string[] | null}} sent @returns {string[]}
 */
export function partsOf(sent) {
  if (sent.parts && sent.parts.length > 1) return sent.parts;
  const pieces = String(sent.de).split(/(?<=[,;:])\s+|\s+(?=[—–]\s)/).map(x => x.trim()).filter(Boolean);
  /** @type {string[]} */ const out = [];
  for (const p of pieces) {
    const last = out[out.length - 1];
    if (last && (wordCount(last) < 4 || wordCount(p) < 3) && wordCount(last) + wordCount(p) <= 9) out[out.length - 1] = `${last} ${p}`;
    else out.push(p);
  }
  // a piece still over 9 words is cut in the middle at a word boundary
  return out.flatMap(p => {
    const w = p.split(/\s+/);
    if (w.length <= 9) return [p];
    const half = Math.ceil(w.length / 2);
    return [w.slice(0, half).join(' '), w.slice(half).join(' ')];
  });
}

/* ------------------------------------------------------------------ */
/* Ids                                                                  */
/* ------------------------------------------------------------------ */

/**
 * A maker of short ids (6 base36 chars) that are unique within one script.
 * @param {Iterable<string>} [taken] @param {() => number} [rnd]
 */
export function idMaker(taken = [], rnd = Math.random) {
  const used = new Set(taken);
  return () => {
    for (;;) {
      let id = '';
      for (let i = 0; i < 6; i++) id += Math.floor(rnd() * 36).toString(36);
      if (!used.has(id) && /[a-z]/.test(id)) { used.add(id); return id; }
    }
  };
}
/** Deterministic ids for tests and for detect(). */
export function counterIds(prefix = 'x') { let n = 0; return () => `${prefix}${(n++).toString(36).padStart(5, '0')}`; }

/* ------------------------------------------------------------------ */
/* Parsing                                                              */
/* ------------------------------------------------------------------ */

/** @param {string} s */
function stripFrontMatter(s) {
  return s.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}
const SKIP_HEAD = /^(vertiefung|publikumsfragen|fragen|q\s*&\s*a|notizen|notes|vokabeln|wortschatz|glossar|vocabulary)\b/i;
const OPEN_HEAD = /^(vortrag|text|skript|script|talk|transcript|rede)$/i;
const SLIDE_RE = /^[*_(\s]*\(?\s*((?:folien?|slides?)\s[^)]*?)\s*\)?[*_\s)]*$/i;
const ROLLUP_RE = /^\s*(?:\*\*|__)?\s*rollup\s*(?:\*\*|__)?\s*:?\s*$/i;

/** "Teil 1 — Einführung" → "Einführung". @param {string} s */
export function cleanTitle(s) {
  return stripInline(s).text.replace(/^(?:teil|kapitel|part|abschnitt|section|chapter)\s*\d+[a-z]?\s*[—–:.-]\s*/i, '').trim();
}

/**
 * Markdown inline marks out; the words in **bold** listed.
 * @param {string} s @returns {{text: string, bold: string[]}}
 */
export function stripInline(s) {
  /** @type {string[]} */ const bold = [];
  let t = String(s)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(\*\*|__)(.+?)\1/g, (_, _m, x) => { bold.push(x.trim()); return x; })
    .replace(/(^|[^\p{L}*])[*_]([^*_\s][^*_]*?)[*_](?![\p{L}])/gu, '$1$2')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/✦/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return { text: t, bold };
}

/**
 * @typedef {object} Sentence
 * @property {string} id
 * @property {string} de
 * @property {string | null} en
 * @property {string[] | null} [parts]
 * @property {boolean} [p]   starts a paragraph
 * @property {string} [changedAt]
 */
/**
 * @typedef {object} Section
 * @property {string} id
 * @property {string} title
 * @property {string | null} note
 * @property {'talk' | 'retell'} kind
 * @property {Sentence[]} sentences
 */

/**
 * @param {string} text
 * @param {{format?: 'de' | 'pairs' | 'notes', id?: () => string, kind?: 'talk' | 'retell'}} [o]
 * @returns {{title: string | null, sections: Section[], bold: {sentenceId: string, surface: string}[], names: string[]}}
 *   names: words that appear in the English lines (proper names and English terms are never suggested as unknown)
 */
export function parseScript(text, { format, id = idMaker(), kind = 'talk' } = {}) {
  const body = stripFrontMatter(String(text || '')).replace(/\r\n?/g, '\n');
  const fmt = format || detect(body).format;
  const kindFor = fmt === 'notes' ? 'retell' : kind;
  const lines = body.split('\n');
  const hasHeads = lines.some(l => /^#{2,6}\s+\S/.test(l)) || lines.filter(l => /^#\s+\S/.test(l)).length > 1;

  /** @type {{title: string, note: string | null, blocks: {kind: 'para' | 'pair', de: string, en?: string | null, full?: boolean, bold: string[], para?: boolean}[]}[]} */
  const raw = [];
  let title = /** @type {string | null} */ (null);
  /** @type {any} */ let cur = null;
  let skipLevel = 0;      // inside a skipped heading of this level (0: not skipping)
  let mainLevel = 0;      // the level of headings that make sections
  let rollN = 1;
  /** @type {string[]} */ let para = [];
  /** @type {any} */ let pair = null;
  /** @type {string[]} */ const enLines = [];
  let paraStart = true;

  const ensure = () => { if (!cur) { cur = { title: '', note: null, blocks: [] }; raw.push(cur); } return cur; };
  const flushPara = () => {
    if (!para.length) return;
    const joined = para.join(' ');
    para = [];
    if (skipLevel) return;
    const { text: t, bold } = stripInline(joined);
    if (t) { ensure().blocks.push({ kind: 'para', de: t, bold, para: paraStart }); }
    paraStart = true;
  };
  const flushPair = () => {
    if (!pair) return;
    const p = pair; pair = null;
    if (skipLevel || !p.de) return;
    const de = stripInline(p.de), en = p.en ? stripInline(p.en).text : null;
    if (en) enLines.push(en);
    ensure().blocks.push({ kind: 'pair', de: de.text, en, full: p.full, bold: de.bold });
  };
  const flush = () => { flushPara(); flushPair(); };

  for (const line0 of lines) {
    const line = line0.replace(/\s+$/, '');
    const head = /^(#{1,6})\s+(.*)$/.exec(line.trim());
    if (head) {
      flush();
      const level = head[1].length;
      let txt = head[2].trim();
      const hs = /\s*[*_]*\(\s*((?:folien?|slides?)\s[^)]*?)\s*\)[*_]*\s*$/i.exec(txt);
      if (hs) txt = txt.slice(0, hs.index).trim();
      if (level === 1 && hasHeads && !title && !raw.some(r => r.blocks.length)) { title = stripInline(txt).text; continue; }
      if (skipLevel && level > skipLevel) continue;
      skipLevel = 0;
      if (SKIP_HEAD.test(txt)) { skipLevel = level; continue; }
      if (OPEN_HEAD.test(cleanTitle(txt))) continue;
      if (!mainLevel || level <= mainLevel) mainLevel = level;
      if (level > mainLevel && cur && !cur.blocks.length) { cur.title = cur.title || cleanTitle(txt); if (hs) cur.note = hs[1]; continue; }
      cur = { title: cleanTitle(txt), note: hs ? hs[1] : null, blocks: [] }; raw.push(cur); rollN = 1;
      continue;
    }
    if (skipLevel) continue;
    const tl = line.trim();
    if (!tl) { flush(); continue; }
    if (/^>/.test(tl) || /^<!--.*-->$/.test(tl) || /^(-{3,}|\*{3,}|_{3,})$/.test(tl)) { flush(); continue; }
    if (ROLLUP_RE.test(tl)) {
      flush();
      if (cur && cur.blocks.length) { const base = cur.baseTitle || cur.title; rollN++; cur = { title: base ? `${base} · ${rollN}` : '', baseTitle: base, note: null, blocks: [] }; raw.push(cur); }
      continue;
    }
    const slide = SLIDE_RE.exec(tl);
    if (slide) { flush(); const c = ensure(); c.note = c.note ? `${c.note} · ${slide[1]}` : slide[1]; continue; }
    if (fmt === 'pairs') {
      const pm = PAIR_RE.exec(tl);
      if (pm) {
        const which = pm[1].toUpperCase(), rest = tl.slice(pm[0].length).replace(/^\s*(?:\*\*|__)\s*/, '');
        const full = /✦/.test(tl.slice(0, pm[0].length + 2));
        if (which === 'EN') { flushPair(); flushPara(); pair = { en: rest, de: '', full }; }
        else if (pair && !pair.de) { pair.de = rest; if (full) pair.full = true; }
        else { flushPair(); pair = { en: null, de: rest, full }; }
        continue;
      }
      if (pair && pair.marked === false && pair.de) flushPair();   // unmarked pairs are one line each
      if (pair) {
        if (pair.de) pair.de += ` ${tl}`;
        else if (pair.marked === false && langOf(tl) === 'de') pair.de = tl;
        else pair.en += ` ${tl}`;
        continue;
      }
      // alternating lines without markers
      if (langOf(tl) === 'en' && !BULLET_RE.test(tl)) { flushPara(); pair = { en: tl.replace(BULLET_RE, ''), de: '', full: false, marked: false }; continue; }
    }
    const item = BULLET_RE.test(tl);
    if (item || fmt === 'notes') { flushPara(); para.push(tl.replace(BULLET_RE, '')); flushPara(); paraStart = false; continue; }
    para.push(tl);
  }
  flush();

  // blocks → sentences
  /** @type {{sentenceId: string, surface: string}[]} */ const bold = [];
  /** @type {Section[]} */ let sections = [];
  for (const r of raw) {
    /** @type {Sentence[]} */ const sents = [];
    const anyFull = r.blocks.some(b => b.kind === 'pair' && b.full);
    /** @type {any[]} */ let parts = [];
    const addSent = (/** @type {string} */ de, /** @type {string | null} */ en, /** @type {string[]} */ boldWords, /** @type {string[] | null} */ ps, /** @type {boolean} */ p) => {
      const s = /** @type {Sentence} */ ({ id: id(), de, en });
      if (ps && ps.length > 1) s.parts = ps;
      if (p) s.p = true;
      sents.push(s);
      for (const b of boldWords) if (de.includes(b)) bold.push({ sentenceId: s.id, surface: b });
    };
    for (const b of r.blocks) {
      if (b.kind === 'para') {
        splitSentences(b.de).forEach((x, i) => addSent(x, null, b.bold, null, !!b.para && i === 0));
        continue;
      }
      if (anyFull && !b.full) { parts.push(b); continue; }
      const ps = parts.length ? parts.map(x => x.de) : null;
      const boldWords = [...b.bold, ...parts.flatMap(x => x.bold)];
      parts = [];
      const ds = ps ? [b.de] : splitSentences(b.de), es = b.en ? splitSentences(b.en) : [];
      if (ds.length > 1 && ds.length === es.length) ds.forEach((d, i) => addSent(d, es[i], boldWords, null, false));
      else addSent(b.de, b.en || null, boldWords, ps, false);
    }
    for (const left of parts) addSent(left.de, left.en || null, left.bold, null, false);
    if (sents.length) sections.push({ id: id(), title: r.title, note: r.note || null, kind: kindFor, sentences: sents });
    else if (r.note && sections.length) { /* a note with no text belongs to nothing */ }
  }
  // no headings: paragraphs are sections (short ones join the next)
  if (!hasHeads && sections.length === 1) sections = byParagraph(sections[0], id);
  sections = sections.flatMap(s => splitLongRun(s, id));
  sections.forEach((s, i) => { if (!s.title) s.title = untitled(s, i); });
  return { title, sections, bold, names: [...new Set(enLines.flatMap(l => (l.match(/[\p{L}][\p{L}'’-]*/gu) || [])).filter(w => w.length >= 3 && !EN_STOP.has(w.toLowerCase())))] };
}

/** @param {Section} s @param {() => string} id @returns {Section[]} */
function byParagraph(s, id) {
  /** @type {Section[]} */ const out = [];
  let cur = /** @type {Section | null} */ (null);
  for (const sent of s.sentences) {
    const words = cur ? cur.sentences.reduce((n, x) => n + wordCount(x.de), 0) : 0;
    if (!cur || (sent.p && words >= 60)) { cur = { id: out.length ? id() : s.id, title: '', note: out.length ? null : s.note, kind: s.kind, sentences: [] }; out.push(cur); }
    cur.sentences.push(sent);
  }
  return out;
}

/** A section over SECTION_MAX words is cut near SECTION_SPLIT_AT words, at a paragraph start if there is one near. @param {Section} s @param {() => string} id @returns {Section[]} */
function splitLongRun(s, id) {
  const total = s.sentences.reduce((n, x) => n + wordCount(x.de), 0);
  if (total <= SECTION_MAX) return [s];
  /** @type {Section[]} */ const out = [];
  let cur = /** @type {Section} */ ({ ...s, sentences: [] }), words = 0, n = 1;
  const base = s.title;
  s.sentences.forEach((sent, i) => {
    const w = wordCount(sent.de);
    const left = s.sentences.slice(i).reduce((m, x) => m + wordCount(x.de), 0);
    const cut = cur.sentences.length && left > 40 && ((words >= SECTION_SPLIT_AT && (sent.p || words + w > SECTION_SPLIT_AT + 30)) || words + w > SECTION_MAX);
    if (cut) {
      out.push(cur); n++;
      cur = { id: id(), title: base ? `${base} · ${n}` : '', note: null, kind: s.kind, sentences: [] }; words = 0;
    }
    cur.sentences.push(sent); words += w;
  });
  out.push(cur);
  if (out.length > 1 && base) out[0].title = `${base} · 1`;
  return out;
}

/** The first words of a section without a heading. @param {Section} s @param {number} i */
function untitled(s, i) {
  const w = (s.sentences[0]?.de || '').split(/\s+/).slice(0, 4).join(' ').replace(/[,.:;!?]+$/, '');
  return w ? `${w} …` : `${i + 1}`;
}

/** Words of a whole script. @param {{sections: Section[]}} script */
export const scriptWords = script => script.sections.reduce((n, s) => n + s.sentences.reduce((m, x) => m + wordCount(x.de), 0), 0);
/** @param {Section} s */
export const sectionWords = s => s.sentences.reduce((m, x) => m + wordCount(x.de), 0);
