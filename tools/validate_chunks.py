#!/usr/bin/env python3
"""Validate chunk translations.
  python3 tools/validate_chunks.py <lang> [batchNN]   -> checks authoring/chunks/parts/<lang>/batchNN.json (or all present parts)
  python3 tools/validate_chunks.py <lang> --assemble  -> requires every source batch, writes content/igloo/chunks/<lang>.json
<lang> is the settings id (german) or the pack id (de); the language's rules come from tools/langrules.py."""
import json, sys, pathlib, re
root = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root / 'tools'))
from langrules import lang as lang_rules  # noqa: E402
L = lang_rules(sys.argv[1]); lang = L.legacy; arg = sys.argv[2] if len(sys.argv) > 2 else None
TRANSLIT = L.translit
SLOT = re.compile(r'\[[^\]]+\]')
def check(bn):
    src = json.loads((root / f'authoring/chunks/src/{bn}.json').read_text())
    p = root / f'authoring/chunks/parts/{lang}/{bn}.json'
    if not p.exists(): return [f'{bn}: missing']
    try: rows = json.loads(p.read_text())
    except Exception as e: return [f'{bn}: invalid JSON: {e}']
    errs = []; by = {r.get('id'): r for r in rows if isinstance(r, dict)}
    for s in src:
        r = by.get(s['id'])
        if not r: errs.append(f"{s['id']}: missing"); continue
        for k in ('t', 'ex'):
            if not isinstance(r.get(k), str) or not r[k].strip(): errs.append(f"{s['id']}: '{k}' missing")
        if TRANSLIT and (not r.get('tr') or not r.get('extr')): errs.append(f"{s['id']}: 'tr' and 'extr' required")
        en_slots = len(SLOT.findall(s['chunk'])); t_slots = len(SLOT.findall(r.get('t', '')))
        if en_slots and not t_slots: errs.append(f"{s['id']}: English has {en_slots} [slot](s); target has none")
        if len(r.get('t', '')) > 120: errs.append(f"{s['id']}: 't' over 120 chars")
        if len(r.get('ex', '')) > 200: errs.append(f"{s['id']}: 'ex' over 200 chars")
        if r.get('n') is not None and (not isinstance(r['n'], str) or len(r['n']) > 160): errs.append(f"{s['id']}: 'n' must be a string under 160 chars")
    extra = set(by) - {s['id'] for s in src}
    if extra: errs.append(f'{bn}: unknown ids {sorted(extra)[:5]}')
    return errs
batches = sorted(p.stem for p in (root / 'authoring/chunks/src').glob('batch*.json'))
if arg == '--assemble':
    errs = [e for b in batches for e in check(b)]
    if errs: print(f'{len(errs)} problem(s):'); [print(' -', e) for e in errs[:40]]; sys.exit(1)
    out = {}
    for b in batches:
        for r in json.loads((root / f'authoring/chunks/parts/{lang}/{b}.json').read_text()):
            out[r['id']] = {k: r[k] for k in ('t', 'tr', 'ex', 'extr', 'n') if r.get(k)}
    (root / f'content/igloo/chunks/{lang}.json').write_text(json.dumps({'lang': lang, 'chunks': out}, ensure_ascii=False, separators=(',', ':')))
    print(f'OK assembled content/igloo/chunks/{lang}.json: {len(out)} chunks'); sys.exit(0)
todo = [arg] if arg else [b for b in batches if (root / f'authoring/chunks/parts/{lang}/{b}.json').exists()]
errs = [e for b in todo for e in check(b)]
if errs: print(f'{len(errs)} problem(s):'); [print(' -', e) for e in errs[:60]]; sys.exit(1)
print(f'OK {lang}: {", ".join(todo)}')
