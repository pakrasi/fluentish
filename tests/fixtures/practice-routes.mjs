// Every Practice route that existed before Practice was split into sibling features (round 3), with the feature
// that owns it now. Links in his history, Today's rows, bookmarks and the old apps' redirects (core/router.js
// mapLegacy) point at these, so each must keep resolving. Read by tests/unit/practice-routes.test.mjs (the registry
// matches it) and tests/e2e/routes.spec.mjs (it opens in the browser). Synthetic ids only.
export const PRACTICE_ROUTES = [
  ['#/practice', 'practice'],
  ['#/practice/words', 'practice'],   // goes on to Look up › Words › Exam words (round 3)
  ['#/practice/round', 'practice-round'],
  ['#/practice/round?kind=missed', 'practice-round'],
  ['#/practice/round?kind=mistakes', 'practice-round'],
  ['#/practice/round?kind=write', 'practice-round'],
  ['#/practice/round?kind=area:speaking', 'practice-round'],
  ['#/practice/round?kind=area:reading', 'practice-round'],
  ['#/practice/round?kind=area:grammar', 'practice-round'],
  ['#/practice/round?kind=area:words', 'practice-round'],
  ['#/practice/round?kind=topic:linking', 'practice-round'],
  ['#/practice/round?kind=cluster%3Adue', 'practice-round'],
  ['#/practice/round?kind=script:e2e-none', 'practice-script'],
  ['#/practice/write', 'practice-write'],
  ['#/practice/write/build/e2e-none', 'practice-write'],
  ['#/practice/speak', 'practice-speak'],
  ['#/practice/speak/teil2', 'practice-speak'],
  ['#/practice/speak/aloud', 'practice-speak'],
  ['#/practice/speak/aloud/check', 'practice-speak'],
  ['#/practice/situations', 'practice-speak'],
  ['#/practice/situations/round?pick=mixed', 'practice-speak'],
  ['#/practice/teil2', 'practice-speak'],
  ['#/practice/scripts', 'practice-script'],
  ['#/practice/scripts/new', 'practice-script'],
  ['#/practice/scripts/e2e-none', 'practice-script'],
  ['#/practice/clusters', 'practice-clusters'],
  ['#/practice/clusters/topic', 'practice-clusters'],
  ['#/practice/clusters/topic/food', 'practice-clusters'],   // goes on to the group page, #/lookup/map/topic/food (round 3)
  ['#/practice/sort?level=A1', 'practice-clusters'],
  ['#/practice/known/A1', 'practice-clusters'],
  ['#/practice/build', 'build'],
  ['#/practice/build/prefixes', 'build'],
  // round 4: Reading (lane L2b)
  ['#/practice/read', 'practice-read'],
  ['#/practice/read/new', 'practice-read'],
  ['#/practice/read/e2e-none', 'practice-read'],
  ['#/practice/round?kind=read', 'practice-read'],
];
