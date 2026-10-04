#!/usr/bin/env python3
"""Validate exams/dayNN.json against SCHEMA.md. Usage: validate.py docs/exams/day01.json [...]"""
import json, sys, re
SKILLS = {"detail","global","paraphrase","negation","number-time","attitude","inference","matching"}
VOICES = {"f1","f2","f3","m1","m2","m3","at_m","ch_f"}

def check(path):
    errs = []
    e = errs.append
    try:
        d = json.load(open(path, encoding="utf-8"))
    except Exception as ex:
        return [f"JSON parse error: {ex}"]
    def item_ok(it, kind, prefix):
        if not re.match(r"^[LH]\d-\d+[ab]?$", it.get("id","")): e(f"{prefix}: bad id {it.get('id')}")
        if it.get("skill") not in SKILLS: e(f"{prefix} {it.get('id')}: bad skill {it.get('skill')}")
        if kind == "rf":
            if not isinstance(it.get("answer"), bool): e(f"{prefix} {it.get('id')}: rf answer must be bool")
            if not it.get("statement") and not it.get("text"): e(f"{prefix} {it.get('id')}: missing statement")
        elif kind == "mc":
            if len(it.get("options",[])) != 3: e(f"{prefix} {it.get('id')}: need 3 options")
            if it.get("answer") not in (0,1,2): e(f"{prefix} {it.get('id')}: mc answer must be 0/1/2")
            if not it.get("question"): e(f"{prefix} {it.get('id')}: missing question")
    for k in ("day","topic","lesen","hoeren","schreiben","sprechen"):
        if k not in d: e(f"missing top-level {k}")
    L = d.get("lesen",{})
    t1 = L.get("teil1",{})
    if len(t1.get("items",[])) != 6: e("lesen.teil1 needs 6 items")
    for it in t1.get("items",[]): item_ok(it,"rf","L1")
    if len(t1.get("text","").split()) < 180: e("lesen.teil1 text too short (<180 words)")
    t2 = L.get("teil2",{})
    if len(t2.get("texts",[])) != 2: e("lesen.teil2 needs 2 texts")
    for tx in t2.get("texts",[]):
        if len(tx.get("items",[])) != 3: e("lesen.teil2 text needs 3 items")
        if len(tx.get("text","").split()) < 150: e(f"lesen.teil2 text '{tx.get('title')}' too short")
        for it in tx.get("items",[]): item_ok(it,"mc","L2")
    t3 = L.get("teil3",{})
    sits, ads = t3.get("situations",[]), t3.get("ads",[])
    if len(sits) != 7: e("lesen.teil3 needs 7 situations")
    if len(ads) != 10: e("lesen.teil3 needs 10 ads")
    letters = [a.get("letter") for a in ads]
    if letters != list("ABCDEFGHIJ"): e(f"lesen.teil3 ad letters must be A..J, got {letters}")
    answers = [s.get("answer") for s in sits]
    if answers.count(None) != 1: e(f"lesen.teil3 exactly one situation must have answer null, got {answers.count(None)}")
    used = [a for a in answers if a]
    if len(used) != len(set(used)): e("lesen.teil3 an ad is used twice")
    for a in used:
        if a not in letters: e(f"lesen.teil3 answer {a} not an ad letter")
    for s in sits:
        if s.get("skill") != "matching": e(f"lesen.teil3 {s.get('id')} skill must be matching")
    t4 = L.get("teil4",{})
    if len(t4.get("comments",[])) != 7: e("lesen.teil4 needs 7 comments")
    for c in t4.get("comments",[]):
        item_ok(c,"rf","L4")
        if not c.get("text") or not c.get("author"): e(f"L4 {c.get('id')} missing text/author")
    ja = sum(1 for c in t4.get("comments",[]) if c.get("answer") is True)
    if ja < 2 or ja > 5: e(f"lesen.teil4 ja/nein mix unbalanced ({ja} ja)")
    t5 = L.get("teil5",{})
    if len(t5.get("items",[])) != 4: e("lesen.teil5 needs 4 items")
    for it in t5.get("items",[]): item_ok(it,"mc","L5")
    H = d.get("hoeren",{})
    h1 = H.get("teil1",{})
    if len(h1.get("texts",[])) != 5: e("hoeren.teil1 needs 5 texts")
    for tx in h1.get("texts",[]):
        its = tx.get("items",[])
        if len(its) != 2 or its[0].get("type") != "rf" or its[1].get("type") != "mc": e(f"hoeren.teil1 {tx.get('id')} needs [rf, mc]")
        for it in its: item_ok(it, it.get("type"), "H1")
        for seg in tx.get("script",[]):
            if seg.get("speaker") not in VOICES: e(f"H1 {tx.get('id')} bad speaker {seg.get('speaker')}")
        wc = sum(len(s.get("text","").split()) for s in tx.get("script",[]))
        if wc < 60: e(f"hoeren.teil1 {tx.get('id')} script too short ({wc} words)")
    h2 = H.get("teil2",{})
    if len(h2.get("items",[])) != 5: e("hoeren.teil2 needs 5 items")
    for it in h2.get("items",[]): item_ok(it,"mc","H2")
    for seg in h2.get("script",[]):
        if seg.get("speaker") not in VOICES: e(f"H2 bad speaker {seg.get('speaker')}")
    wc = sum(len(s.get("text","").split()) for s in h2.get("script",[]))
    if wc < 200: e(f"hoeren.teil2 script too short ({wc} words)")
    h3 = H.get("teil3",{})
    if len(h3.get("items",[])) != 7: e("hoeren.teil3 needs 7 items")
    for it in h3.get("items",[]): item_ok(it,"rf","H3")
    spk = {s.get("speaker") for s in h3.get("script",[])}
    if len(spk) != 2 or not spk <= VOICES: e(f"hoeren.teil3 needs exactly 2 valid speakers, got {spk}")
    wc = sum(len(s.get("text","").split()) for s in h3.get("script",[]))
    if wc < 230: e(f"hoeren.teil3 script too short ({wc} words)")
    h4 = H.get("teil4",{})
    if len(h4.get("items",[])) != 8: e("hoeren.teil4 needs 8 items")
    for it in h4.get("items",[]):
        if it.get("answer") not in ("mod","a","b"): e(f"H4 {it.get('id')} answer must be mod/a/b")
        if it.get("skill") != "matching": e(f"H4 {it.get('id')} skill must be matching")
    ans4 = [it.get("answer") for it in h4.get("items",[])]
    if not ({"mod","a","b"} <= set(ans4)): e("hoeren.teil4 answers must include mod, a and b")
    if set(h4.get("speakers",{}).keys()) != {"mod","a","b"}: e("hoeren.teil4 speakers needs mod/a/b")
    v = h4.get("voices",{})
    if set(v.keys()) != {"mod","a","b"} or not set(v.values()) <= VOICES or len(set(v.values())) != 3: e("hoeren.teil4 voices must map mod/a/b to 3 distinct voice codes")
    for seg in h4.get("script",[]):
        if seg.get("speaker") not in ("mod","a","b"): e(f"H4 script speaker must be mod/a/b, got {seg.get('speaker')}")
    wc = sum(len(s.get("text","").split()) for s in h4.get("script",[]))
    if wc < 380: e(f"hoeren.teil4 script too short ({wc} words)")
    S = d.get("schreiben",{})
    for k in ("aufgabe1","aufgabe2","aufgabe3"):
        if k not in S: e(f"schreiben.{k} missing")
    if len(S.get("aufgabe1",{}).get("points",[])) != 3: e("schreiben.aufgabe1 needs 3 points")
    if not S.get("aufgabe2",{}).get("quote"): e("schreiben.aufgabe2 needs quote")
    if not S.get("aufgabe3",{}).get("addressee"): e("schreiben.aufgabe3 needs addressee")
    P = d.get("sprechen",{})
    if len(P.get("teil1",{}).get("points",[])) < 3: e("sprechen.teil1 needs >=3 points")
    if len(P.get("teil1",{}).get("partner_cues",[])) < 4: e("sprechen.teil1 needs >=4 partner_cues")
    if len(P.get("teil2",{}).get("topics",[])) != 2: e("sprechen.teil2 needs 2 topics")
    if len(P.get("teil2",{}).get("folien",[])) != 5: e("sprechen.teil2 needs 5 folien")
    if len(P.get("teil3",{}).get("questions",[])) != 3 or len(P.get("teil3",{}).get("questions_b",[])) != 3: e("sprechen.teil3 needs 3 questions + 3 questions_b")
    # all ids unique
    ids = re.findall(r'"id":\s*"([^"]+)"', open(path, encoding="utf-8").read())
    dup = {i for i in ids if ids.count(i) > 1}
    if dup: e(f"duplicate ids: {sorted(dup)}")
    return errs

if __name__ == "__main__":
    bad = 0
    for p in sys.argv[1:]:
        errs = check(p)
        print(f"{p}: {'OK' if not errs else str(len(errs)) + ' errors'}")
        for x in errs: print("   -", x)
        bad += bool(errs)
    sys.exit(1 if bad else 0)
