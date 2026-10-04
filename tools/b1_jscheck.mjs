// Grades each item's model and wrong answers with the app's matcher (match.js, B1 options) and the trap detectors.
// stdin: JSON array of items; stdout: JSON array of [index, message]. Called by validate_b1.py.
import M from '../src/domain/match.js';
import Det from '../src/domain/detect.js';
const items = JSON.parse(await new Promise(r => { let s = ''; process.stdin.on('data', d => s += d); process.stdin.on('end', () => r(s)); }));
const out = [];
items.forEach((it, i) => {
  if (!it || typeof it !== 'object' || it.kind === 'reply' || !Array.isArray(it.accept) || !it.model) return;
  const gap = String(it.prompt).includes('___');
  const acc = gap ? M.acceptedForGap(it.prompt, it.accept) : it.accept;
  const o = { anywhere: !!it.anywhere, slotMax: 10, endings: true, umlaut: true, strict: it.strict || [], ...(gap ? { loose: M.gapLoose(it.prompt) } : {}) };
  const m = M.check(it.model, acc, o);
  if (!m.ok) out.push([i, `model ${JSON.stringify(it.model)} fails in the app's matcher`]);
  const cap = (it.focus || []).includes('cap') || it.trap === 'cap';
  for (const w of it.wrong || []) {
    const r = M.check(w, acc, o);
    if (!r.ok) continue;
    const det = Det.run(w, it, r);
    if (det && (it.kind === 'topic' || det.cls === it.trap || (it.focus || []).includes(det.cls))) continue;   // caught by a detector
    if (cap && r.capMiss.length) continue;
    const slips = [...r.typos, ...r.umlautMiss].map(t => `${t.typed} → ${t.expected}`);
    out.push([i, slips.length
      ? `wrong ${JSON.stringify(w)} passes in the app as a typo (${slips.join(', ')}); add ${JSON.stringify(slips.map(s => s.split(' → ')[1])[0])} to strict`
      : `wrong ${JSON.stringify(w)} passes in the app's matcher`]);
  }
});
process.stdout.write(JSON.stringify(out));
