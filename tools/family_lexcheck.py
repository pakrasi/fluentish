#!/usr/bin/env python3
"""Lexicon checks for the word families (round 7, content/build/FAMILY-SCHEMA.md).

Records, for every word a family uses (its forms, its checked non-words, its rare combinations and its candidates),
three facts the build and the validator read from authoring/build/family-lexcheck.de.json:

  dwds   DWDS (Digitales Wörterbuch der deutschen Sprache, dwds.de) has a dictionary entry for it (its snippet API)
  hits   how often it occurs in the DWDS corpora (its frequency API: lemma hits in about 53 billion tokens)
  wf     its Zipf frequency in wordfreq (Robyn Speer; data CC BY-SA 4.0), and for a verb the Zipf of its 3rd person
         and Präteritum forms (`forms`)

Only these facts are stored: no DWDS text and no wordfreq list is copied (content/NOTICE.md). A word is called "not a
German word" by the game only when dwds is false, hits are at most 10, wf is 0 for every form, it is in no lexicon the
build knows, and both model review passes agree (src/domain/wordbuild-family-check.js).

  pip install wordfreq            (once; any 3.x)
  python3 tools/family_lexcheck.py            check the words not yet recorded (polite: about 3 requests a second)
  python3 tools/family_lexcheck.py --recheck  check every word again
"""
import json, os, sys, time, urllib.parse, urllib.request, datetime

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SRC = os.path.join(ROOT, 'authoring', 'build')
OUT = os.path.join(SRC, 'family-lexcheck.de.json')


def words_to_check():
    build = json.load(open(os.path.join(ROOT, 'content', 'build', 'de.json'), encoding='utf-8'))
    verbs = {v['id']: v for v in build['verbs']}
    chains = {c['id']: c for c in build['chains']}
    out = {}
    fam_dir = os.path.join(SRC, 'families')
    for name in sorted(os.listdir(fam_dir)):
        if not name.endswith('.json'):
            continue
        fam = json.load(open(os.path.join(fam_dir, name), encoding='utf-8'))
        out[fam['root']] = 'verb'
        for f in fam.get('forms', []):
            w, cls = f.get('word'), f.get('cls')
            if f.get('verb'):
                w, cls = verbs[f['verb']]['inf'].replace('sich ', ''), 'verb'
            elif f.get('chain'):
                cid, nid = f['chain'].split('/')
                n = next(x for x in chains[cid]['nodes'] if x['id'] == nid)
                w, cls = n['word'], n['cls']
            if w:
                out[w] = cls or 'word'
        for k in ('none', 'rare', 'candidates'):
            for n in fam.get(k, []):
                w = n['word'] if isinstance(n, dict) else n
                out[w] = 'verb' if w[:1].islower() and w.endswith('en') else 'word'
    return out


def get(url):
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'fluentish-content-check'}), timeout=20) as r:
                return json.loads(r.read().decode('utf-8'))
        except Exception:
            time.sleep(2 + 3 * attempt)
    raise RuntimeError(f'no answer from {url}')


def dwds_entry(w):
    """Dictionary entry under the word as written, or (for a noun-looking word) capitalised."""
    for q in dict.fromkeys([w, w[:1].upper() + w[1:]]):
        hits = get('https://www.dwds.de/api/wb/snippet?q=' + urllib.parse.quote(q))
        if any(h.get('lemma') == q for h in hits):
            return q
    return None


def dwds_hits(w):
    best = 0
    for q in dict.fromkeys([w, w[:1].upper() + w[1:]]):
        r = get('https://www.dwds.de/api/frequency/?q=' + urllib.parse.quote(q))
        best = max(best, int(r.get('hits') or 0))
    return best


def verb_forms(w):
    if not w.endswith('en'):
        return []
    st = w[:-2]
    return [st + 't', st + 'te', st + 'et']


def main():
    from wordfreq import zipf_frequency
    recheck = '--recheck' in sys.argv
    data = json.load(open(OUT, encoding='utf-8')) if os.path.exists(OUT) else {}
    rec = data.get('words', {})
    todo = {w: c for w, c in words_to_check().items() if recheck or w.lower() not in rec}
    print(f'family_lexcheck: {len(todo)} word(s) to check, {len(rec)} recorded')
    for i, (w, cls) in enumerate(sorted(todo.items())):
        e = {'dwds': dwds_entry(w) is not None, 'hits': dwds_hits(w), 'wf': zipf_frequency(w, 'de', wordlist='large')}
        if cls == 'verb':
            e['forms'] = {f: zipf_frequency(f, 'de', wordlist='large') for f in verb_forms(w)}
        rec[w.lower()] = e
        time.sleep(0.3)
        if i % 50 == 49:
            print(f'  {i + 1} …')
            save(rec)
    save(rec)


def save(rec):
    out = {
        'about': 'Lexicon facts for the word families (tools/family_lexcheck.py): dwds = DWDS has a dictionary entry; hits = DWDS corpus hits (about 53 billion tokens); wf = wordfreq Zipf (CC BY-SA 4.0), forms = Zipf of a verb\'s 3rd person and past forms. Facts only; no DWDS or wordfreq text is copied.',
        'checkedAt': datetime.date.today().isoformat(),
        'words': dict(sorted(rec.items())),
    }
    with open(OUT, 'w', encoding='utf-8') as fh:
        fh.write('{\n "about": ' + json.dumps(out['about'], ensure_ascii=False) + ',\n "checkedAt": "' + out['checkedAt'] + '",\n "words": {\n')
        fh.write(',\n'.join(f'  {json.dumps(k, ensure_ascii=False)}: {json.dumps(v, ensure_ascii=False)}' for k, v in out['words'].items()))
        fh.write('\n }\n}\n')


if __name__ == '__main__':
    main()
