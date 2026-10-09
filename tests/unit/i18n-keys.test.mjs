// i18n keys (arch F13, test part): every literal t('key') in src/ exists in src/i18n/en.js, every template-built key
// t(`x.${y}`) starts with a prefix on the allow-list below, and en.js has no key written twice (an object literal keeps
// the last one silently, which is what a bad merge of two lanes' sections would do). Keys nothing seems to use are
// reported as a diagnostic, never a failure: some are reached through tables of keys this scan cannot follow.
//
// Not the app's t(): the exam runner's own t (the exam locale, exam.tx; its keys live in
// content/exams/<id>/locale.<lang>.json and are checked there) and one local helper named t. See OTHER_T.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import en from '../../src/i18n/en.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EN_FILE = path.join(ROOT, 'src/i18n/en.js');

/* Prefixes of template-built keys: the text before the first ${ in t(`...`). A new t(`prefix.${x}`) adds its prefix
   here, and en.js must hold at least one key with that prefix. */
const DYNAMIC_PREFIXES = [
  'account.err.', 'accounts.provider.', 'accounts.why.',
  'build.cls.', 'build.family.by.', 'build.family.kind.', 'build.family.legend.', 'build.family.state.',
  'build.family.type.', 'build.form.', 'build.grade.', 'build.grade.g', 'build.how.', 'build.state.',
  'build.today.key.', 'build.today.learn.end.', 'build.today.slot.', 'build.today.sq.',
  'conn.link.', 'conn.warn.', 'conv.err.', 'conv.fb.why.', 'conv.mode.', 'data.kind.', 'exam.correct.err.',
  'explore.group.', 'explore.group.source.', 'explore.kind.', 'explore.mode.', 'explore.sheet.', 'explore.state.',
  'goal.gate.strand.', 'goals.exam.name.', 'goals.exam.short.', 'goals.kind.', 'level.',
  'lookup.frames.', 'lookup.grammar.', 'lookup.notes.', 'lookup.phrases.cat.', 'lookup.sheet.', 'lookup.sheet.freq.',
  'lookup.tab.', 'pg.days.k', 'pg.group.', 'pg.range.',
  'practice.area.', 'practice.build.part.', 'practice.clusters.about.', 'practice.clusters.case.',
  'practice.clusters.legend.', 'practice.clusters.types.', 'practice.clusters.where.', 'practice.grade.g',
  'practice.kind.', 'practice.mistake.kind.', 'practice.note.', 'practice.punct.', 'practice.script.err.',
  'practice.script.fmt.', 'practice.script.grade.', 'practice.script.how.', 'practice.script.kind.',
  'practice.script.register.', 'practice.script.step.', 'practice.sim.g',
  'read.band.', 'read.err.', 'read.paste.format.', 'read.sheet.from.', 'read.state.',
  'stand.items.', 'week.day.', 'week.kind.', 'week.kindHint.', 'welcome.time.', 'word.freq.', 'word.type.',
];

/* Files whose t(...) is not the app's t. 'exam': the exam runner's t (exam.tx); a key there must be in en or in
   every exam locale catalog. 'local': a local function named t; not checked. Each entry is re-checked below so it
   cannot hide a real call once the file changes. */
const OTHER_T = {
  'src/features/exam/parts.js': 'exam',
  'src/features/exam/player.js': 'exam',
  'src/services/claude.js': 'local',   // graderMessage: const t = k => the learner's text for that task
};

const EXAM_CATALOGS = readdirSync(path.join(ROOT, 'content/exams')).flatMap(id => {
  const dir = path.join(ROOT, 'content/exams', id);
  return statSync(dir).isDirectory()
    ? readdirSync(dir).filter(f => /^locale\.[a-z-]+\.json$/.test(f)).map(f => JSON.parse(readFileSync(path.join(dir, f), 'utf8')).strings || {})
    : [];
});

/** @returns {string[]} every .js file under src/, without vendored code and the catalogs themselves */
function sources() {
  /** @type {string[]} */ const out = [];
  const walk = (/** @type {string} */ d) => {
    for (const f of readdirSync(d)) {
      const p = path.join(d, f);
      if (statSync(p).isDirectory()) { if (!(d === path.join(ROOT, 'src') && ['vendor', 'i18n'].includes(f))) walk(p); }
      else if (p.endsWith('.js')) out.push(p);
    }
  };
  walk(path.join(ROOT, 'src'));
  return out;
}

/** Is the call inside a comment? `pre` is its line up to the call. Good enough for this code base: a line comment,
    a block comment's later line (` * ...`), or a block comment opened on this line and not yet closed. */
const inComment = (/** @type {string} */ pre) => /^\s*\/\//.test(pre) || (/^\s*\*/.test(pre) && !pre.includes('*/'))
  || pre.lastIndexOf('/*') > pre.lastIndexOf('*/');

/** Every t( call with a string or template first argument: t, ctx.t, app.t, and import aliases of core/i18n's t. */
function scan() {
  /** @type {{ file: string, line: number, key: string }[]} */ const literal = [];
  /** @type {{ file: string, line: number, prefix: string }[]} */ const dynamic = [];
  for (const abs of sources()) {
    const src = readFileSync(abs, 'utf8');
    const file = path.relative(ROOT, abs).split(path.sep).join('/');
    const aliases = [...src.matchAll(/import\s*\{[^}]*\bt\s+as\s+(\w+)[^}]*\}\s*from\s*['"][^'"]*core\/i18n\.js['"]/g)].map(m => m[1]);
    const names = ['t', ...aliases].join('|');
    const re = new RegExp(String.raw`(?<![\w$.])(?:(?:ctx|app)\.)?(?:${names})\(\s*(?:(['"])((?:\\.|(?!\1)[^\\\n])*)\1|\x60([^\x60]*)\x60)`, 'g');
    for (const m of src.matchAll(re)) {
      const before = src.slice(0, m.index);
      const line = before.split('\n').length;
      if (inComment(before.slice(before.lastIndexOf('\n') + 1))) continue;
      const tpl = m[3];
      if (tpl !== undefined && tpl.includes('${')) dynamic.push({ file, line, prefix: tpl.slice(0, tpl.indexOf('${')) });
      else literal.push({ file, line, key: (m[2] ?? tpl).replace(/\\(.)/g, '$1') });
    }
  }
  return { literal, dynamic };
}

const { literal, dynamic } = scan();
const where = (/** @type {{file: string, line: number}} */ x) => `${x.file}:${x.line}`;

test('i18n: the scan finds the app\'s t() calls (a broken scan must not pass by finding nothing)', () => {
  assert.ok(literal.length > 1500, `only ${literal.length} literal keys found`);
  assert.ok(dynamic.length > 50, `only ${dynamic.length} template keys found`);
  assert.ok(literal.some(x => x.file === 'src/features/practice-script/ui.js'), 'the import alias tr is scanned');
});

test('i18n: every literal t(\'key\') in src/ exists in en.js', () => {
  const missing = literal.filter(x => {
    if (x.key in en) return false;
    const kind = OTHER_T[/** @type {keyof typeof OTHER_T} */ (x.file)];
    if (kind === 'local') return false;
    if (kind === 'exam') return !(EXAM_CATALOGS.length && EXAM_CATALOGS.every(c => x.key in c));
    return true;
  });
  assert.deepEqual(missing.map(x => `${where(x)} ${x.key}`), [], 'keys used in src/ but missing from src/i18n/en.js (or from the exam locale)');
});

test('i18n: the files with another t still have it, so their exclusion hides nothing', () => {
  assert.ok(EXAM_CATALOGS.length > 0, 'no exam locale catalog found under content/exams/');
  for (const [file, kind] of Object.entries(OTHER_T)) {
    const src = readFileSync(path.join(ROOT, file), 'utf8');
    if (kind === 'exam') assert.match(src, /\bt\b[^\n]*the exam's strings \(exam\.tx\)/, `${file}: t is no longer documented as the exam's strings`);
    else assert.match(src, /\bconst t = /, `${file}: the local t is gone; remove it from OTHER_T`);
    assert.doesNotMatch(src, /import\s*\{[^}]*\bt\b[^}]*\}\s*from\s*['"][^'"]*core\/i18n\.js['"]/, `${file} imports the app's t; check its keys`);
  }
});

test('i18n: every template-built key t(`prefix${x}`) has an allowed prefix, and each prefix has keys in en.js', ctx => {
  const allowed = new Set(DYNAMIC_PREFIXES);
  assert.deepEqual(dynamic.filter(x => !allowed.has(x.prefix)).map(x => `${where(x)} t(\`${x.prefix}\${...}\`)`), [],
    'new template-built keys: add the prefix to DYNAMIC_PREFIXES in tests/unit/i18n-keys.test.mjs');
  const keys = Object.keys(en);
  assert.deepEqual(DYNAMIC_PREFIXES.filter(p => !keys.some(k => k.startsWith(p))), [], 'prefixes with no key in en.js');
  assert.ok(DYNAMIC_PREFIXES.every(p => p.length > 0), 'an empty prefix would allow any key');
  const used = new Set(dynamic.map(x => x.prefix));
  const stale = DYNAMIC_PREFIXES.filter(p => !used.has(p));
  if (stale.length) ctx.diagnostic(`prefixes no longer used in src/ (remove them): ${stale.join(', ')}`);
});

test('i18n: en.js writes no key twice, and its R8 lane sections open and close in pairs (empty sections are fine)', () => {
  const text = readFileSync(EN_FILE, 'utf8');
  const keys = [...text.matchAll(/^\s*(['"])((?:\\.|(?!\1).)+)\1\s*:/gm)].map(m => m[2].replace(/\\(.)/g, '$1'));
  assert.equal(keys.length, Object.keys(en).length + keys.filter((k, i) => keys.indexOf(k) !== i).length);
  assert.deepEqual(keys.filter((k, i) => keys.indexOf(k) !== i), [], 'keys written twice in en.js (the last one wins silently)');

  const lines = text.split('\n');
  /** @type {string | null} */ let open = null;
  /** @type {Set<string>} */ const seen = new Set();
  lines.forEach((l, i) => {
    const start = l.match(/^\s*\/\/ ---- R8 (\S+) ----\s*$/);
    const end = l.match(/^\s*\/\/ ---- end of R8 (\S+) ----\s*$/);
    if (start) {
      assert.equal(open, null, `en.js:${i + 1} R8 ${start[1]} opens inside R8 ${open}`);
      assert.ok(!seen.has(start[1]), `en.js:${i + 1} R8 ${start[1]} opens twice`);
      open = start[1]; seen.add(start[1]);
    } else if (end) {
      assert.equal(end[1], open, `en.js:${i + 1} closes R8 ${end[1]} but R8 ${open} is open`);
      open = null;
    }
  });
  assert.equal(open, null, `R8 ${open} is never closed`);
});

test('i18n: keys nothing seems to use (a report, not a failure; I18N_UNUSED=1 lists them)', ctx => {
  const used = new Set(literal.map(x => x.key));
  const unused = Object.keys(en).filter(k => !used.has(k) && !DYNAMIC_PREFIXES.some(p => k.startsWith(p)));
  ctx.diagnostic(`${unused.length} of ${Object.keys(en).length} en.js keys are not used as a literal or under an allowed prefix`);
  if (process.env.I18N_UNUSED) for (const k of unused) ctx.diagnostic(`unused: ${k}`);
});
