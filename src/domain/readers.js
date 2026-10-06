/* Graded reading texts (readers@1, round 4 C0; shared by lane L2's reader and lane L3's content): the rules
   schemas/content/readers.schema.json cannot say. tools/validate-content.mjs runs them for every readers@1 file in
   the manifest; tests/unit/readers.test.mjs runs them on the synthetic fixture.

     - text ids are unique and start with 'read/<lang>/' of the file's language
     - section ids are unique in a text, sentence ids too
     - words is the text's word count, within 10 % of what the language's tokenizer counts (when one is given)
     - licence: 'own' texts have no source; 'PD' and 'CC-BY-4.0' name their source (author and work)
     - questions: ids unique in a text; options distinct; answer an index into options; a true/false question has two
       options; evidence is found verbatim in the text (after the language's normalize, spaces folded)

   Pure, language-neutral: the language's text rules come in as arguments. */

/** @typedef {{normalize?: (s: unknown) => string, tokenize?: (s: unknown) => any[]}} TextRules */

/** @param {string} s @param {TextRules} rules */
const norm = (s, rules) => (rules.normalize ? rules.normalize(s) : String(s).normalize('NFC')).replace(/\s+/g, ' ').trim();

/**
 * The errors of a readers@1 document (empty when it is fine), each '<where>: <what>'.
 * @param {any} doc @param {TextRules} [rules] the language's text rules (pack.text)
 * @returns {string[]}
 */
export function readersErrors(doc, rules = {}) {
  /** @type {string[]} */ const out = [];
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.texts)) return ['/: not a readers@1 document'];
  const prefix = `read/${doc.lang}/`;
  const ids = new Set();
  for (const [i, t] of doc.texts.entries()) {
    const at = `/texts/${i} ${t && t.id}`;
    if (!t || typeof t !== 'object') { out.push(`${at}: not a text`); continue; }
    if (ids.has(t.id)) out.push(`${at}: id used twice`);
    ids.add(t.id);
    if (typeof t.id !== 'string' || !t.id.startsWith(prefix)) out.push(`${at}: id must start with ${prefix}`);
    const secIds = new Set(), sentIds = new Set();
    /** @type {string[]} */ const sentences = [];
    for (const s of t.sections || []) {
      if (secIds.has(s.id)) out.push(`${at}: section ${s.id} used twice`);
      secIds.add(s.id);
      for (const x of s.sentences || []) {
        if (sentIds.has(x.id)) out.push(`${at}: sentence ${x.id} used twice`);
        sentIds.add(x.id);
        sentences.push(String(x.text || ''));
      }
    }
    const body = norm(sentences.join(' '), rules);
    if (rules.tokenize && Number.isInteger(t.words)) {
      const n = rules.tokenize(body).length;
      if (Math.abs(n - t.words) > Math.max(1, Math.round(n * 0.1))) out.push(`${at}: words ${t.words}, but the text has ${n}`);
    }
    if (t.licence === 'own' && t.source != null) out.push(`${at}: an own text has no source`);
    if ((t.licence === 'PD' || t.licence === 'CC-BY-4.0') && !(t.source && t.source.author && t.source.work)) out.push(`${at}: licence ${t.licence} needs its source (author, work)`);
    const qIds = new Set();
    for (const q of t.questions || []) {
      const qa = `${at} ${q.id}`;
      if (qIds.has(q.id)) out.push(`${qa}: id used twice`);
      qIds.add(q.id);
      const opts = Array.isArray(q.options) ? q.options.map((/** @type {string} */ o) => norm(o, rules)) : [];
      if (new Set(opts).size !== opts.length) out.push(`${qa}: options repeat`);
      if (!(Number.isInteger(q.answer) && q.answer >= 0 && q.answer < opts.length)) out.push(`${qa}: answer ${q.answer} is not an option`);
      if (q.type === 'tf' && opts.length !== 2) out.push(`${qa}: a true/false question has two options`);
      if (!q.evidence || !body.includes(norm(q.evidence, rules))) out.push(`${qa}: evidence not found verbatim in the text`);
    }
  }
  return out;
}
