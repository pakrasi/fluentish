#!/usr/bin/env python3
import json, sys, pathlib, collections
root = pathlib.Path(__file__).resolve().parent.parent
bs = sys.argv[1:] or sorted(p.stem for p in (root / 'authoring/chunks/levels').glob('batch*.json'))
errs = []; dist = collections.Counter()
for b in bs:
    src = json.loads((root / f'authoring/chunks/src/{b}.json').read_text())
    p = root / f'authoring/chunks/levels/{b}.json'
    if not p.exists(): errs.append(f'{b}: missing'); continue
    rows = {r['id']: r for r in json.loads(p.read_text())}
    for s in src:
        r = rows.get(s['id'])
        if not r: errs.append(f"{s['id']}: missing"); continue
        if r.get('level') not in ('A1', 'A2', 'B1', 'B2'): errs.append(f"{s['id']}: level must be A1/A2/B1/B2")
        if not r.get('r') or len(r['r']) > 70: errs.append(f"{s['id']}: r missing or over 70 chars")
        dist[r.get('level')] += 1
if errs: print(len(errs), 'problem(s):'); [print(' -', e) for e in errs[:40]]; sys.exit(1)
print('OK', ', '.join(bs), dict(sorted(dist.items())))
