/* Profile settings (settings@1) and device prefs (prefs@1): defaults, field-level writes, courses and the exam date.

   Courses (Arch #11, round 3 wave C). A profile learns one or more languages: settings.courses holds one course per
   language, {id, lang, level, goal: {exam, date}, decks}, and settings.activeCourse names the one Today and Practice
   are about. The fields from before courses (language, level, exam.type, exam.date) stay, as a mirror of the active
   course that the code written before courses reads; they are never written on their own any more:
     - setCourse() is the one writer of a course's fields. A write to the active course writes its mirror in the same
       step, with the same rev; setActiveCourse() rewrites the mirror from the course it switches to.
     - setSetting() on a mirrored path ('language', 'level', 'exam.type', 'exam.date') goes through setCourse().
     - Every field has its own rev on the hybrid logical clock: 'courses.<id>.goal.date', 'activeCourse', and the
       mirror's own paths, so devices merge per field (mergeSettings) and an older device that knows only the mirror
       still merges as before.
   A record from before courses has none: normalizeSettings() derives course 'de' from language, level and exam,
   with the revs those fields had (no new stamps, so every device derives the same record), and the migration in
   data/session.js (migrateCourses) stores it once. Deriving is pure and idempotent; the mirror is unchanged by it.

   The exam date has exactly one home, the active course's goal.date (mirrored to settings.exam.date), and one
   reader, core/clock.js through examDate(). setExamDate() is its writer: it validates the date, writes it through
   setCourse() (recorded per field on the hybrid logical clock, a settings.changed event, settings:changed on the
   bus so Today re-renders). It never touches a card: the exam cap on review dates is applied when due dates are read
   (domain/b1ready.js dueOn), so moving the date back and forth is always safe. */
import { isDay } from '../core/clock.js';
import { LANGS } from '../core/lang.js';
import { LEGACY_DECKS } from '../domain/decks.js';

export const MODULES = /** @type {const} */ (['lesen', 'hoeren', 'schreiben', 'sprechen']);

/** @returns {any} */
export const defaultSettings = () => ({
  v: 1,
  language: null,
  level: null,
  exam: { type: null, date: null, modules: [...MODULES] },
  minutesPerDay: 60,
  newPerDay: null,
  practice: { readAloud: false, claudeCheck: false, simpleInput: false },
  onboarded: null,
  courses: [],
  activeCourse: null,
  rev: {},
});

export const defaultPrefs = () => ({ theme: 'auto', motion: 'system', locale: 'en' });

/** Fill missing fields from the defaults (older or partial records), derive the course of a record from before
   courses, and keep the mirror equal to the active course. Pure and idempotent. @param {any} s */
export function normalizeSettings(s) {
  const d = defaultSettings();
  if (!s || typeof s !== 'object') return d;
  /** @type {any} */
  const out = { ...d, ...s, exam: { ...d.exam, ...(s.exam || {}) }, practice: { ...d.practice, ...(s.practice || {}) }, rev: { ...(s.rev || {}) } };
  out.courses = courseList(s.courses);
  if (!out.courses.length) {
    const c = legacyCourse(out);
    if (c) {
      out.courses = [c];
      for (const [legacy, field] of MIRROR) if (out.rev[legacy]) out.rev[`courses.${c.id}.${field}`] = out.rev[legacy];
      if (out.rev.language && !out.rev.activeCourse) out.rev.activeCourse = out.rev.language;
      out.activeCourse = c.id;
    }
  }
  if (!out.courses.some((/** @type {Course} */ c) => c.id === out.activeCourse)) out.activeCourse = out.courses.length ? out.courses[0].id : null;
  return reconcile(out);
}

/* ---------- courses ---------- */

/**
 * @typedef {{exam: string | null, date: string | null}} Goal
 * @typedef {{id: string, lang: string, level: string | null, goal: Goal, decks: string[]}} Course
 */

/** The mirror: a field from before courses and the active course's field it shows. */
export const MIRROR = /** @type {const} */ ([['language', 'lang'], ['level', 'level'], ['exam.type', 'goal.exam'], ['exam.date', 'goal.date']]);
/** @type {Map<string, string>} */ const MIRRORED = new Map(MIRROR.map(([legacy, field]) => [legacy, field]));
/** @type {Map<string, string>} */ const LEGACY_OF = new Map(MIRROR.map(([legacy, field]) => [field, legacy]));
/** A course's fields that carry a rev each. */
export const COURSE_FIELDS = /** @type {const} */ (['lang', 'level', 'goal.exam', 'goal.date', 'decks']);
const LANG_CODE = /^[a-z]{2,3}$/;

/** The short code of a language id ('german' → 'de'), or null. @param {string | null | undefined} id */
export const langCode = id => (id && Object.prototype.hasOwnProperty.call(LANGS, id) ? LANGS[id].code : null);
/** The language id of a short code ('de' → 'german'), or null. @param {string | null | undefined} code */
export const langIdOf = code => (code ? Object.values(LANGS).find(p => p.code === code)?.id ?? null : null);

/** The decks a new course starts with: German keeps the decks from before courses; another language has none yet.
   @param {string} lang */
export const startDecks = lang => (lang === 'de' ? [...LEGACY_DECKS] : []);

/** @param {string} id @param {string | null} [lang] @returns {Course} */
const blankCourse = (id, lang = null) => {
  const l = lang && LANG_CODE.test(lang) ? lang : LANG_CODE.test(id) ? id : String(lang || id);
  return { id, lang: l, level: null, goal: { exam: null, date: null }, decks: startDecks(l) };
};

/**
 * The courses of a record, normalised and in a fixed order (by id), so two devices that merged the same records hold
 * the same list. Accepts the {id: course} map a single-field merge builds (data/restore.js setPath).
 * @param {any} x @returns {Course[]}
 */
function courseList(x) {
  const raw = Array.isArray(x) ? x : x && typeof x === 'object' ? Object.entries(x).map(([id, c]) => ({ ...(c || {}), id })) : [];
  /** @type {Map<string, Course>} */ const byId = new Map();
  for (const c of raw) {
    if (!c || typeof c !== 'object' || typeof c.id !== 'string' || !c.id) continue;
    const b = blankCourse(c.id, typeof c.lang === 'string' ? c.lang : null);
    byId.set(c.id, {
      id: c.id, lang: b.lang, level: c.level ?? null,
      goal: { exam: c.goal?.exam ?? null, date: c.goal?.date ?? null },
      decks: Array.isArray(c.decks) ? c.decks.filter((/** @type {any} */ d) => typeof d === 'string') : b.decks,
    });
  }
  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The course a record from before courses describes, or null (no language chosen yet). @param {any} s @returns {Course | null} */
function legacyCourse(s) {
  const lang = langCode(s.language);
  if (!lang) return null;
  return { ...blankCourse(lang, lang), level: s.level ?? null, goal: { exam: s.exam.type ?? null, date: s.exam.date ?? null } };
}

/** @param {string} field @param {any} v course value → mirror value */
const toLegacy = (field, v) => (field === 'lang' ? langIdOf(v) : v);

/**
 * Keep the mirror equal to the active course. A mirrored field written after both the course field and the switch to
 * this course (an older device or tab that knows only the mirror) is taken into the course; otherwise the course is
 * copied to the mirror, with the course field's rev when the value changes.
 * @param {any} s normalised settings (changed in place) @returns {any}
 */
function reconcile(s) {
  const c = s.courses.find((/** @type {Course} */ x) => x.id === s.activeCourse);
  if (!c) return s;
  const ar = s.rev.activeCourse || '';
  for (const [legacy, field] of MIRROR) {
    const cpath = `courses.${c.id}.${field}`;
    const lr = s.rev[legacy] || '', cr = s.rev[cpath] || '';
    if (lr && lr > cr && lr > ar) {
      const v = field === 'lang' ? langCode(getPath(s, legacy)) : getPath(s, legacy);
      if (field === 'lang' && !v) continue;   // a language with no code cannot be a course's
      setPath(c, field, v);
      s.rev[cpath] = lr;
      continue;
    }
    const v = toLegacy(field, getPath(c, field));
    if (JSON.stringify(getPath(s, legacy)) === JSON.stringify(v)) continue;
    setPath(s, legacy, v);
    if (cr) s.rev[legacy] = cr;   // the writers stamp the mirror themselves; this only carries a merged course field's rev
  }
  return s;
}

/** The active course of normalised settings, or null. @param {any} s @returns {Course | null} */
export function activeCourse(s) {
  const n = normalizeSettings(s);
  return n.courses.find((/** @type {Course} */ c) => c.id === n.activeCourse) || null;
}

/** A course by id, or null. @param {any} s @param {string} id @returns {Course | null} */
export const courseById = (s, id) => normalizeSettings(s).courses.find((/** @type {Course} */ c) => c.id === id) || null;

/**
 * The exam date: the active course's goal.date (core/clock.js reads it through here). A profile with no course yet
 * reads the field from before courses.
 * @param {any} s @returns {string | null}
 */
export function examDate(s) {
  const n = normalizeSettings(s);
  const c = n.courses.find((/** @type {Course} */ x) => x.id === n.activeCourse);
  return c ? c.goal.date : n.exam.date;
}

/** @param {any} o @param {string} path */
const getPath = (o, path) => path.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
/** @param {any} o @param {string} path @param {any} v */
function setPath(o, path, v) {
  const ks = path.split('.');
  let x = o;
  for (const k of ks.slice(0, -1)) x = x[k] = { ...(x[k] || {}) };
  x[ks[ks.length - 1]] = v;
}

/** Fields whose value is never written into an event (none today; kept so a future secret-ish field has a place). */
const QUIET = new Set();

/** A course id: the language's short code for the first course of a language. */
const COURSE_ID = /^[a-z0-9-]+$/;

/** 'courses.<id>.<field>' → [id, field], else null. @param {string} path @returns {[string, string] | null} */
function coursePath(path) {
  const m = /^courses\.([a-z0-9-]+)\.(.+)$/.exec(path);
  return m ? [m[1], m[2]] : null;
}
/** A field of a settings record, courses addressed by id. @param {any} s @param {string} path */
function getField(s, path) {
  const cp = coursePath(path);
  if (!cp) return getPath(s, path);
  const c = (s.courses || []).find((/** @type {Course} */ x) => x.id === cp[0]);
  return c ? getPath(c, cp[1]) : undefined;
}
/** Set a field, creating a course that is not there yet. @param {any} s @param {string} path @param {any} v */
function setField(s, path, v) {
  const cp = coursePath(path);
  if (!cp) { setPath(s, path, v); return; }
  let c = s.courses.find((/** @type {Course} */ x) => x.id === cp[0]);
  if (!c) { c = blankCourse(cp[0]); s.courses.push(c); }
  setPath(c, cp[1], v);
}

/**
 * Store settings, then a settings.changed event and a bus message per changed field. A mirrored field that changed
 * because the active course did (a first course becomes active by itself) is reported too, so listeners of
 * 'language' or 'exam.date' hear of it.
 * @param {{store: any, bus?: any}} app @param {any} before normalised @param {any} next normalised
 * @param {[string, any, any][]} changes [path, value, prev]
 */
function commit({ store, bus }, before, next, changes) {
  for (const [legacy] of MIRROR) {
    const v = getPath(next, legacy), p = getPath(before, legacy);
    if (JSON.stringify(v) !== JSON.stringify(p) && !changes.some(([k]) => k === legacy)) changes.unshift([legacy, v, p]);
  }
  if (!changes.length) return;
  store.set('settings', next);
  for (const [path, value] of changes) store.append('settings.changed', { key: path, value: QUIET.has(path) ? null : value, rev: next.rev[path] ?? null });
  for (const [path, value, prev] of changes) bus?.emit('settings:changed', { key: path, value, prev });
}

/**
 * Write one settings field. Returns the previous value. A mirrored field ('language', 'level', 'exam.type',
 * 'exam.date') is written through the active course (setCourse; 'language' picks or starts that language's course).
 * @param {{store: any, hlc: {tick: () => string}, bus?: any}} app
 * @param {string} path  e.g. 'exam.date', 'minutesPerDay'
 * @param {any} value
 */
export function setSetting(app, path, value) {
  const { store, hlc } = app;
  const cur = normalizeSettings(store.get('settings'));
  const prev = getField(cur, path);
  if (path === 'language') {
    const code = langCode(value);
    if (code) { chooseLanguage(app, code); return prev; }
  } else if (MIRRORED.has(path) && cur.activeCourse) {
    setCourse(app, cur.activeCourse, { [/** @type {string} */ (MIRRORED.get(path))]: value });
    return prev;
  } else if (coursePath(path)) {
    const [id, field] = /** @type {[string, string]} */ (coursePath(path));
    setCourse(app, id, { [field]: value });
    return prev;
  } else if (path === 'activeCourse') {
    setActiveCourse(app, value);
    return prev;
  }
  if (JSON.stringify(prev) === JSON.stringify(value) && cur.rev[path]) return prev;   // an unstamped value (carried over) is stamped when chosen
  const next = structuredClone(cur);
  setPath(next, path, value);
  next.rev = { ...next.rev, [path]: hlc.tick() };
  commit(app, cur, normalizeSettings(next), [[path, value, prev]]);
  return prev;
}

/**
 * The one writer of a course's fields. patch: any of lang, level, 'goal.exam', 'goal.date', decks (or goal: {exam,
 * date}). A course that does not exist yet is made. Each field that changes gets its own rev; on the active course the
 * mirror is written in the same step with the same rev. Returns the fields that changed.
 * @param {{store: any, hlc: {tick: () => string}, bus?: any}} app
 * @param {string} id
 * @param {Record<string, any>} patch
 * @returns {string[]}
 */
export function setCourse(app, id, patch) {
  if (!COURSE_ID.test(String(id))) throw new Error(`course: bad id ${id}`);
  const cur = normalizeSettings(app.store.get('settings'));
  const next = structuredClone(cur);
  /** @type {[string, any][]} */ const fields = [];
  for (const [k, v] of Object.entries(patch || {})) {
    if (k === 'goal' && v && typeof v === 'object') { for (const [g, x] of Object.entries(v)) fields.push([`goal.${g}`, x]); } else fields.push([k, v]);
  }
  /** @type {[string, any, any][]} */ const changes = [];
  const made = !next.courses.some((/** @type {Course} */ c) => c.id === id);
  if (made) {
    const lang = fields.find(([k]) => k === 'lang')?.[1] ?? null;
    next.courses.push(blankCourse(id, lang));
    // every field of a new course is stamped, so it reaches other devices whole
    for (const f of COURSE_FIELDS) if (!fields.some(([k]) => k === f)) fields.push([f, getField(next, `courses.${id}.${f}`)]);
  }
  const active = next.activeCourse === id;
  for (const [f, v] of fields) {
    if (!(/** @type {readonly string[]} */ (COURSE_FIELDS)).includes(f)) throw new Error(`course: unknown field ${f}`);
    if (f === 'lang' && !(typeof v === 'string' && LANG_CODE.test(v))) throw new Error(`course: bad language ${v}`);
    if (f === 'goal.date' && v != null && !isDay(v)) throw new Error(`course: bad date ${v}`);
    const path = `courses.${id}.${f}`;
    const prev = getField(next, path);
    if (!made && JSON.stringify(prev) === JSON.stringify(v) && next.rev[path]) continue;
    const rev = app.hlc.tick();
    setField(next, path, v);
    next.rev[path] = rev;
    const legacy = LEGACY_OF.get(f);
    if (active && legacy) {
      const lv = toLegacy(f, v), lp = getPath(next, legacy);
      setPath(next, legacy, lv);
      next.rev[legacy] = rev;
      changes.push([legacy, lv, lp]);
    }
    changes.push([path, v, prev]);
  }
  next.courses = courseList(next.courses);
  commit(app, cur, normalizeSettings(next), changes);
  return changes.map(([p]) => p);
}

/**
 * Make a course the active one: Today, Practice and the clock follow it. The mirror is rewritten from it in the same
 * step, each changed field with the switch's rev.
 * @param {{store: any, hlc: {tick: () => string}, bus?: any}} app @param {string} id
 * @returns {boolean} whether it changed
 */
export function setActiveCourse(app, id) {
  const cur = normalizeSettings(app.store.get('settings'));
  const c = cur.courses.find((/** @type {Course} */ x) => x.id === id);
  if (!c) throw new Error(`course: no course ${id}`);
  if (cur.activeCourse === id && cur.rev.activeCourse) return false;
  const next = structuredClone(cur);
  const rev = app.hlc.tick();
  /** @type {[string, any, any][]} */ const changes = [['activeCourse', id, cur.activeCourse]];
  next.activeCourse = id;
  next.rev.activeCourse = rev;
  for (const [legacy, field] of MIRROR) {
    const v = toLegacy(field, getPath(c, field)), lp = getPath(next, legacy);
    if (JSON.stringify(v) === JSON.stringify(lp) && next.rev[legacy]) continue;
    setPath(next, legacy, v);
    next.rev[legacy] = rev;
    changes.push([legacy, v, lp]);
  }
  commit(app, cur, normalizeSettings(next), changes);
  return true;
}

/**
 * Start a course for a language (onboarding, Profile › Courses › Add a course) and make it active. A language that has
 * a course already keeps it: that course is made active and the given fields are written to it.
 * @param {{store: any, hlc: {tick: () => string}, bus?: any}} app
 * @param {{lang: string, level?: string | null, goal?: Partial<Goal>}} o
 * @returns {string} the course id
 */
export function addCourse(app, { lang, level = null, goal = {} }) {
  const cur = normalizeSettings(app.store.get('settings'));
  const have = cur.courses.find((/** @type {Course} */ c) => c.lang === lang);
  const id = have ? have.id : lang;
  setCourse(app, id, { lang, level, goal: { exam: goal.exam ?? null, date: goal.date ?? null } });
  setActiveCourse(app, id);
  return id;
}

/** 'language' written the way it was before courses: the course of that language becomes active (made when missing).
   @param {{store: any, hlc: {tick: () => string}, bus?: any}} app @param {string} code */
function chooseLanguage(app, code) {
  const cur = normalizeSettings(app.store.get('settings'));
  const have = cur.courses.find((/** @type {Course} */ c) => c.lang === code);
  if (have) { setActiveCourse(app, have.id); return; }
  // a profile that had a goal before its first course keeps it in the new course
  setCourse(app, code, { lang: code, level: cur.level, goal: { exam: cur.exam.type, date: cur.exam.date } });
  setActiveCourse(app, code);
}

/**
 * Merge two settings records field by field: the newer rev wins (sync, import, restore). Courses are united by id
 * (a course is never removed) and then merged per field; the mirror follows the merged active course.
 * @param {any} local @param {any} remote
 */
export function mergeSettings(local, remote) {
  const a = normalizeSettings(local), b = normalizeSettings(remote);
  const out = structuredClone(a);
  for (const c of b.courses) if (!out.courses.some((/** @type {Course} */ x) => x.id === c.id)) out.courses.push(structuredClone(c));
  for (const [path, rev] of Object.entries(b.rev)) {
    if (!a.rev[path] || /** @type {string} */ (rev) > a.rev[path]) { setField(out, path, structuredClone(getField(b, path))); out.rev[path] = rev; }
  }
  out.courses = courseList(out.courses);
  return normalizeSettings(out);
}

/**
 * Make the active course take the mirror's values and revs (the cutover's settings merge decides the fields from
 * before courses itself, then calls this). @param {any} s @returns {any}
 */
export function adoptMirror(s) {
  // not normalised first: that would copy the course over the mirror, the other way round
  const out = s && Array.isArray(s.courses) && s.courses.length ? { ...structuredClone(s), courses: courseList(s.courses), rev: { ...(s.rev || {}) } } : normalizeSettings(s);
  const c = out.courses.find((/** @type {Course} */ x) => x.id === out.activeCourse);
  if (!c) return out;
  for (const [legacy, field] of MIRROR) {
    const v = field === 'lang' ? langCode(getPath(out, legacy)) : getPath(out, legacy);
    if (field === 'lang' && !v) continue;
    setPath(c, field, v);
    const cpath = `courses.${c.id}.${field}`;
    if (out.rev[legacy]) out.rev[cpath] = out.rev[legacy]; else delete out.rev[cpath];
  }
  return normalizeSettings(out);
}

/**
 * Check a date the user typed for the exam. Returns an error key or null.
 * @param {string | null} date @param {string} today
 */
export function examDateError(date, today) {
  if (date == null || date === '') return null;
  if (!isDay(date)) return 'goal.date.invalid';
  if (date < today) return 'goal.date.past';
  return null;
}

/**
 * The one writer of the exam date: the active course's goal.date (or a given course's), through setCourse.
 * @param {{store: any, hlc: {tick: () => string}, bus?: any, clock: {today: () => string}}} app
 * @param {string | null} date
 * @param {string | null} [courseId] default: the active course
 * @returns {{ok: boolean, error?: string, prev?: string | null}}
 */
export function setExamDate(app, date, courseId = null) {
  const today = app.clock.today();
  const value = date || null;
  const error = examDateError(value, today);
  if (error) return { ok: false, error };
  const cur = normalizeSettings(app.store.get('settings'));
  const id = courseId || cur.activeCourse;
  const prev = id ? getField(cur, `courses.${id}.goal.date`) ?? null : cur.exam.date;
  if (prev === value) return { ok: true, prev };
  if (id) setCourse(app, id, { 'goal.date': value });
  else setSetting(app, 'exam.date', value);   // no course yet (before onboarding chose a language)
  return { ok: true, prev };
}
