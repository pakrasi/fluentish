# B1 mock exam JSON schema (one file per day: exams/dayNN.json)

Format follows the Goethe-Zertifikat B1 Modellsatz exactly (item counts, task types, play counts).
All German at solid B1 level (Goethe B1 Wortliste), texts realistic, varied register. All `answer` keys
are stripped by the server before content reaches the browser and graded server-side.

Every objective item has `skill`, one of:
`detail` (find specific info) · `global` (main idea/purpose) · `paraphrase` (correct option paraphrases text;
distractors recycle its words) · `negation` (statement true only if a negation is caught) · `number-time`
(numbers, times, dates, prices) · `attitude` (speaker's opinion/feeling) · `inference` (implied, not stated) ·
`matching` (Lesen Teil 3 / Hören Teil 4 attribution).

```jsonc
{
  "day": 1,
  "topic": "Arbeit und Beruf",
  "lesen": {
    "teil1": {                                   // 10 min · 6 items richtig/falsch · blog/personal text ~250-300 words
      "title": "…", "source": "Blog", "text": "…paragraphs separated by \n\n…",
      "items": [ {"id":"L1-1","statement":"…","answer":true,"skill":"detail"} /* ×6, mix true/false */ ]
    },
    "teil2": {                                   // 20 min · 2 press texts ~200-250 words · 3 MC each
      "texts": [ {"title":"…","source":"Zeitung / Zeitschrift / Website","text":"…",
                  "items":[ {"id":"L2-1","question":"…","options":["…","…","…"],"answer":0,"skill":"paraphrase"} /* ×3 */ ]} /* ×2 */ ]
    },
    "teil3": {                                   // 10 min · 7 situations → 10 ads A–J · exactly ONE situation has answer null (= "0", no ad fits) · each ad used at most once
      "intro": "…who is looking for what…",
      "situations": [ {"id":"L3-1","text":"…","answer":"C","skill":"matching"} /* ×7, one with "answer": null */ ],
      "ads": [ {"letter":"A","title":"…","text":"…"} /* ×10, A–J; short ad style, ~30-50 words */ ]
    },
    "teil4": {                                   // 15 min · 7 reader comments · Ja (dafür) / Nein (dagegen)
      "question": "…yes/no question the commenters answer…",
      "comments": [ {"id":"L4-1","author":"Name, Ort","text":"…","answer":true,"skill":"attitude"} /* ×7; answer true = dafür/Ja */ ]
    },
    "teil5": {                                   // 10 min · rules/instructions text (Hausordnung, Anleitung, AGB) · 4 MC
      "title":"…", "text":"…numbered §-style paragraphs…",
      "items": [ {"id":"L5-1","question":"…","options":["…","…","…"],"answer":2,"skill":"detail"} /* ×4 */ ]
    }
  },
  "hoeren": {
    "teil1": {                                   // 5 short texts (Ansage, Anrufbeantworter, Radio, Wetter…) · heard TWICE · 2 items each: item A richtig/falsch, item B MC
      "texts": [ {"id":"H1-1","kind":"Anrufbeantworter","script":[{"speaker":"f1","text":"…"}],
                  "items":[ {"id":"H1-1a","type":"rf","statement":"…","answer":false,"skill":"detail"},
                            {"id":"H1-1b","type":"mc","question":"…","options":["…","…","…"],"answer":1,"skill":"number-time"} ]} /* ×5 */ ]
    },
    "teil2": {                                   // one monologue (guide, welcome speech, briefing) ~300-350 words · heard ONCE · 5 MC
      "setting":"…", "script":[{"speaker":"m1","text":"…"}],
      "items":[ {"id":"H2-1","question":"…","options":["…","…","…"],"answer":0,"skill":"detail"} /* ×5 */ ]
    },
    "teil3": {                                   // everyday dialogue, 2 people ~350-400 words · heard ONCE · 7 richtig/falsch
      "setting":"…", "script":[{"speaker":"m2","text":"…"},{"speaker":"f2","text":"…"}],
      "items":[ {"id":"H3-1","statement":"…","answer":true,"skill":"detail"} /* ×7 */ ]
    },
    "teil4": {                                   // radio discussion: Moderator + 2 guests ~500-600 words · heard TWICE · 8 statements → who said it
      "setting":"…", "speakers":{"mod":"Moderator/in Name","a":"Name (role)","b":"Name (role)"},
      "voices":{"mod":"m1","a":"f1","b":"m2"},
      "script":[{"speaker":"mod","text":"…"},{"speaker":"a","text":"…"}],
      "items":[ {"id":"H4-1","statement":"…","answer":"a","skill":"matching"} /* ×8; answers spread over mod/a/b */ ]
    }
  },
  "schreiben": {
    "aufgabe1": {"minutes":20,"words":80,"situation":"…informal email/blog situation…","points":["…","…","…"]},
    "aufgabe2": {"minutes":25,"words":80,"situation":"…you saw a TV discussion on X; in the online guestbook you read:…","quote":"…one reader's opinion, 2-3 sentences…","instruction":"Schreiben Sie Ihre Meinung dazu (circa 80 Wörter)."},
    "aufgabe3": {"minutes":15,"words":40,"situation":"…semi-formal email: apologise / decline / ask politely…","addressee":"Frau/Herr …"}
  },
  "sprechen": {
    "teil1": {"situation":"…gemeinsam etwas planen…","points":["Wann?","Wo?","Was mitbringen?","Wer macht was?"],
              "partner_cues":["…4-6 lines a partner would say, which the learner reacts to…"]},
    "teil2": {"topics":["Thema A …?","Thema B …?"],
              "folien":["Stellen Sie Ihr Thema vor. Erklären Sie den Inhalt und die Struktur Ihrer Präsentation.",
                        "Berichten Sie von Ihrer Situation oder einem Erlebnis im Zusammenhang mit dem Thema.",
                        "Berichten Sie, wie die Situation in Ihrem Heimatland ist, und geben Sie Beispiele.",
                        "Nennen Sie die Vor- und Nachteile und sagen Sie dazu Ihre Meinung. Geben Sie auch Beispiele.",
                        "Beenden Sie Ihre Präsentation und bedanken Sie sich bei den Zuhörern."]},
    "teil3": {"questions":["…3 follow-up questions an examiner/partner would ask about Thema A…"],
              "questions_b":["…3 for Thema B…"]}
  }
}
```

Speaker codes for TTS: `f1` Katja, `f2` Amala, `f3` Seraphina, `m1` Conrad, `m2` Killian, `m3` Florian, `at_m` Jonas (Austrian), `ch_f` Leni (Swiss).
Scripts: plain spoken German, contractions allowed ("Hallo, hier ist…"), numbers written as words or digits (TTS reads both).
Hören scripts must contain the information the items test on, with realistic distractors (a second time/price mentioned then corrected, etc.).
