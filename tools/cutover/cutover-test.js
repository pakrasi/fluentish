async page => {
  const U = 'http://localhost:8462';   // tools/cutover/run.sh starts fake-origin.py there
  const out = { steps: [], map: [], fails: [] };
  const check = (name, pass, info) => { out.steps.push({ name, pass: !!pass, info }); if (!pass) out.fails.push(name); };
  const set = q => page.request.get(`${U}/__set?${q}`).then(r => r.json());
  const regs = p => p.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map(r => r.scope.replace(location.origin, '')).sort());
  const legacy = p => p.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (!k.startsWith('fluentish.')) o[k] = localStorage.getItem(k); } return o; });
  const diff = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => a[k] !== b[k]).sort();
  const path = u => u.replace(U, '');
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(`${path(page.url())}: ${m.text().slice(0, 160)}`); });

  // ---------- A. the old world: old apps live, Fluentish's service worker already registered ----------
  await set('ld=old&b1=old');
  await page.goto(`${U}/language-doors/index.html`);
  await page.evaluate(() => {
    localStorage.clear();
    const S = (k, v) => localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
    S('examDate', '2026-10-09');
    S('doors.prefs.v2', { view: 'b1', theme: 'dark' });
    S('doors.b1.fsrs.v1', {
      'BW:synthetic-1': { S: 3.2, D: 5.1, due: '2026-10-06', reps: 2, lapses: 0, u: 1759500000000, hist: [] },
      'BW:synthetic-2': { S: 1.1, D: 6.0, due: '2026-10-05', reps: 1, lapses: 1, u: 1759500000001, hist: [] },
      'BG:synthetic-3': { S: 8.0, D: 4.0, due: '2026-10-08', reps: 3, lapses: 0, u: 1759500000002, hist: [] },
    });
    S('remote:attempts', [{ id: 1759300000000, day: 3, module: 'lesen', score: 20, max_score: 30, submitted_at: '2026-10-01T10:00:00+02:00', responses: [], synced: true }]);
    S('draft:3:lesen', { answers: { '1': 'a' } });
    S('doors.srs.v1', { 'german|K:SYN_1': { ivl: 3, reps: 2, ease: 2.5, due: '2026-10-07', lapses: 0, hist: [] } });
  });
  // service workers already on the origin: Fluentish's (stand-in) and one under /b1-exam/app/ (none exists today;
  // this proves the b1-exam stub removes only its own scope)
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/fluentish/sw.js', { scope: '/fluentish/', updateViaCache: 'none' });   // Fluentish's real sw.js
    await navigator.serviceWorker.register('/b1-exam/app/__sw-test.js', { scope: '/b1-exam/app/' });
  });
  await page.goto(`${U}/language-doors/app.html#drill`);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForTimeout(1500);
  check('A1 old Igloo registers its SW', (await regs(page)).includes('/language-doors/'), await regs(page));
  // the B1 hub open in a tab with the old code (its version check runs now, so the next one is >= 60 s away)
  await page.goto(`${U}/language-doors/app.html#b1`);
  await page.waitForSelector('.b1-wrap, .b1-hub, h1', { timeout: 10000 });
  await page.waitForTimeout(1500);
  check('A2 old B1 hub renders on the old site', path(page.url()).startsWith('/language-doors/app.html#b1'), path(page.url()));
  // a second tab: the old b1-exam Pages app
  const tab2 = await page.context().newPage();
  tab2.on('console', m => { if (m.type() === 'error') consoleErrors.push(`[tab2] ${path(tab2.url())}: ${m.text().slice(0, 160)}`); });
  await tab2.goto(`${U}/b1-exam/app/#/woerter`);
  await tab2.waitForTimeout(2500);
  check('A3 old b1-exam app loads (no redirect yet)', path(tab2.url()).startsWith('/b1-exam/app/'), path(tab2.url()));

  // ---------- B. deploy the cutover branches; the two old tabs stay open ----------
  await set('ld=new&b1=new');
  const L0 = await legacy(page);
  // b1-exam: the next navigation in the old tab runs its version check, which reloads into the stub
  await tab2.evaluate(() => { location.hash = '#/fortschritt'; });
  await tab2.waitForURL(/\/fluentish\//, { timeout: 15000 }).catch(() => {});
  await tab2.waitForTimeout(2000);
  check('B1 stale b1-exam tab reloads into Fluentish', /\/fluentish\/#\/exam$/.test(tab2.url()), path(tab2.url()));
  // Igloo: the hub's version check is rate-limited to once a minute
  await page.waitForTimeout(61000);
  await page.evaluate(() => { location.hash = '#b1/words'; });
  await page.waitForTimeout(800);
  await page.evaluate(() => { location.hash = '#b1'; });
  await page.waitForURL(/\/fluentish\//, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);
  check('B2 stale Igloo B1 hub reloads into Fluentish', /\/fluentish\/#\/practice/.test(page.url()), path(page.url()));
  await tab2.close();
  const L1 = await legacy(page);
  out.oldCodeWritesBeforeReload = diff(L0, L1);

  // ---------- C. every old link, fresh load ----------
  const cases = [
    ['/language-doors/app.html#b1', '/fluentish/#/practice'],
    ['/language-doors/app.html#/b1', '/fluentish/#/practice'],
    ['/language-doors/app.html#b1/round', '/fluentish/#/practice/round'],
    ['/language-doors/app.html#b1/missed', '/fluentish/#/practice/round?kind=missed'],
    ['/language-doors/app.html#b1/words', '/fluentish/#/practice/round?kind=area:words'],
    ['/language-doors/app.html#b1/words/round', '/fluentish/#/practice/round?kind=area:words'],
    ['/language-doors/app.html#b1/sprechen', '/fluentish/#/practice/round?kind=area:speaking'],
    ['/language-doors/app.html#b1/situations', '/fluentish/#/practice/round?kind=area:speaking'],
    ['/language-doors/app.html#b1/lesen', '/fluentish/#/practice/round?kind=area:reading'],
    ['/language-doors/app.html#b1/grammar', '/fluentish/#/practice/round?kind=area:grammar'],
    ['/language-doors/app.html#b1/grammar/dass', '/fluentish/#/practice/round?kind=topic:dass'],
    ['/language-doors/app.html#b1/aloud', '/fluentish/#/practice/speak/aloud'],
    ['/language-doors/app.html#b1/aloud/go', '/fluentish/#/practice/speak/aloud'],
    ['/language-doors/app.html#b1/teil2', '/fluentish/#/practice/speak/teil2'],
    ['/language-doors/app.html#b1/frames', '/fluentish/#/lookup/frames'],
    // b1-exam Pages app and dashboard
    ['/b1-exam/app/', '/fluentish/#/exam'],
    ['/b1-exam/app/#/', '/fluentish/#/exam'],
    ['/b1-exam/app/index.html#/tag/3', '/fluentish/#/exam/3'],
    ['/b1-exam/app/#/tag/3/lesen', '/fluentish/#/exam/3/lesen'],
    ['/b1-exam/app/#/tag/3/schreiben?review=42', '/fluentish/#/exam/3/schreiben/review/42'],
    ['/b1-exam/app/#/woerter', '/fluentish/#/lookup/words'],
    ['/b1-exam/app/#/woerter/ueben', '/fluentish/#/lookup/words'],
    ['/b1-exam/app/#/woerter?tag=4', '/fluentish/#/lookup/words?test=4'],
    ['/b1-exam/app/#/training', '/fluentish/#/practice/write'],
    ['/b1-exam/app/#/training/1-aufgabe1', '/fluentish/#/practice/write'],
    ['/b1-exam/app/#/fortschritt', '/fluentish/#/exam'],
    ['/b1-exam/app/#/einstellungen', '/fluentish/#/profile'],
    ['/b1-exam/app/#/export', '/fluentish/#/profile/data'],
    ['/b1-exam/app/#token=github_pat_SYNTHETIC_NOT_A_TOKEN', '/fluentish/#/profile'],
    ['/b1-exam/', '/fluentish/#/exam'],
    ['/b1-exam/index.html', '/fluentish/#/exam'],
  ];
  const stays = [   // stay on Igloo until phase 3 (review B5/A4); Igloo itself writes doors.prefs.v2 here
    ['/language-doors/app.html#drill', '/language-doors/app.html#drill'],
    ['/language-doors/app.html#test', '/language-doors/app.html#test'],
    ['/language-doors/app.html#lookup/phrases', '/language-doors/app.html#lookup/phrases'],
    ['/language-doors/app.html#write', /^\/language-doors\/app\.html#write(\/SC-[\w-]+)?$/],
    ['/language-doors/app.html#b1x', /^\/language-doors\/app\.html#(drill|test|lookup|write)/],
    ['/language-doors/', '/language-doors/'],
    ['/language-doors/index.html#how', '/language-doors/index.html#how'],
    ['/language-doors/explore.html', '/language-doors/index.html'],
  ];
  const run = async (from, want) => {
    const toFl = typeof want === 'string' && want.startsWith('/fluentish/');
    await page.goto('about:blank');
    await page.goto(U + from).catch(() => {});
    if (toFl) await page.waitForURL(/\/fluentish\/#\//, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(toFl ? 1500 : 2500);
    const got = path(page.url());
    const pass = typeof want === 'string' ? got === want : want.test(got);
    out.map.push({ from, want: String(want), got, pass });
    if (!pass) out.fails.push(`map ${from}`);
  };
  for (const [from, want] of cases) await run(from, want);
  const L2 = await legacy(page);
  check('C1 no legacy localStorage key changed by any redirect or by Fluentish', diff(L1, L2).length === 0, diff(L1, L2));
  for (const [from, want] of stays) await run(from, want);
  // a saved Igloo view of 'b1' opens Drill on a bare app.html, with no redirect
  await page.evaluate(() => { const p = JSON.parse(localStorage.getItem('doors.prefs.v2') || '{}'); p.view = 'b1'; localStorage.setItem('doors.prefs.v2', JSON.stringify(p)); });
  await run('/language-doors/app.html', '/language-doors/app.html#drill');
  // in-page navigation to #b1… on the new Igloo app (hashchange guard)
  await page.evaluate(() => { location.hash = '#b1/round'; });
  await page.waitForURL(/\/fluentish\/#\//, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1500);
  check('C4 in-page #b1/round link on new Igloo goes to Fluentish', path(page.url()) === '/fluentish/#/practice/round', path(page.url()));
  /* (cases run above) */ if (false) for (const [from, want] of cases) {
    await page.goto('about:blank');
    await page.goto(U + from).catch(() => {});
    if (want.startsWith('/fluentish/')) await page.waitForURL(/\/fluentish\//, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(want.startsWith('/fluentish/') ? 1500 : 2500);
    const got = path(page.url());
    const hops = [];
    out.map.push({ from, want, got, pass: got === want });
    if (got !== want) out.fails.push(`map ${from}`);
  }
  check('C2 no token stored or kept in the URL', !JSON.stringify(L2).includes('SYNTHETIC_NOT_A_TOKEN') && !out.map.some(m => m.got.includes('token')), null);
  // the migration sets onboarded, so a device with legacy progress never lands on #/welcome
  check('C3 Fluentish migrated (no redirect ended on #/welcome)', !out.map.some(m => m.got.includes('#/welcome')), out.map.filter(m => m.got.includes('welcome')).map(m => m.from));

  // ---------- D. service workers ----------
  await page.goto(`${U}/language-doors/app.html#drill`);
  await page.waitForTimeout(2500);
  const R1 = await regs(page);
  check('D1 Fluentish SW survived every stub', R1.includes('/fluentish/'), R1);
  check('D2 b1-exam stub removed only its own scope (/b1-exam/app/)', !R1.includes('/b1-exam/app/'), R1);
  check('D3 Igloo SW stays registered (Drill offline, review A4)', R1.includes('/language-doors/'), R1);
  const swInfo = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration('/language-doors/');
    const txt = await (await fetch('/language-doors/sw.js', { cache: 'no-store' })).text();
    return { active: !!r?.active, waiting: !!r?.waiting, served: (txt.match(/const V = '([^']+)'/) || [])[1] };
  });
  out.iglooSw = swInfo;
  check('D4 new sw.js (V 20261004a) is what the server gives the SW', swInfo.served === '20261004a', swInfo);
  // the saved view 'b1' no longer opens B1 on a bare app.html
  check('D5 new Igloo Drill page has DG and no B1 global', await page.evaluate(() => !!window.DG && !window.B1), null);
  await page.evaluate(() => window.DG.swKill());
  const R2 = await regs(page);
  check('D6 scoped DG.swKill() removes /language-doors/ only', !R2.includes('/language-doors/') && R2.includes('/fluentish/'), R2);
  // for contrast: the swKill on origin/main (what {"sw":"off"} would run in a stale B1 tab)
  await page.evaluate(async () => { for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); });
  const R3 = await regs(page);
  out.oldUnscopedSwKill = { before: R2, after: R3 };
  // Fluentish puts its own registration back on its next load (src/services/sw.js; ?sw=on because localhost is dev)
  await page.goto(`${U}/fluentish/?sw=on#/today`);
  await page.waitForTimeout(3000);
  const R4 = await regs(page);
  check('E1 Fluentish re-registers its SW after an unscoped kill', R4.includes('/fluentish/'), R4);
  out.consoleErrors = consoleErrors;
  return JSON.stringify(out, null, 1);
}
