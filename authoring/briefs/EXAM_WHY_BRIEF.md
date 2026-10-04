# Answer explanations (shown in the review after submitting)

One file per day: `docs/exams/why/dayNN.json` — an object keyed by item id (every Lesen + Hören item, 60 per day):

```json
{
  "H3-2": {
    "evidence": "exact quote from the text or Hören script that decides the item (verbatim, ≤ 30 words)",
    "evidence_en": "English translation of the quote",
    "why": "1–2 short sentences in simple German (B1): why the solution is right",
    "why_en": "the same in English",
    "trap": "1 sentence (German): why the tempting wrong answer is wrong — the recycled word, the negation, the number, the other speaker…",
    "trap_en": "the same in English",
    "question_en": "English translation of the item as shown (statement / question stem / Teil 3 situation / Teil 4 comment / Hören Teil 4 statement)",
    "options_en": ["a in English", "b in English", "c in English"]   // only for items that have options
  }
}
```
Rules: evidence must appear verbatim in the day's exam text/script (for Hören the speaker's line; for Lesen Teil 3 the ad text; for "0 = keine Anzeige" quote the near-miss ad and say what doesn't fit). Keep it about the reasoning, not a translation of the whole text. Check with `python3 scripts/validate_why.py --en docs/exams/why/dayNN.json`.
