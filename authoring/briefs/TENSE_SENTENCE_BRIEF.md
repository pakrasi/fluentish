# Brief: Prism data for one chunk-bank language

The homepage ("Prism") compares languages. It currently has data for Khasi, German, Hindi, French and Swiss German; you add one more language. Two deliverables, both in your language only.

## 1. Role-tagged sentences
Follow tools/SENTENCE_BRIEF.md exactly (read it and data/sentences/en.json; look at data/sentences/german.json and data/sentences/hindi.json as models). Write data/sentences/<lang>.json with all 24 variants. Bengali and Arabic tokens are [text, roles, translit] like Hindi; others two elements. Arabic: MSA text, word order as written (the site handles right-to-left display); mention Levantine differences in `why` where striking. Validate: `python3 tools/validate_sentences.py data/sentences/<lang>.json` until OK. Keep `why` in plain, specific English (no slogans).

## 2. Tense table for GO
Write data/turns_src/<lang>.json: a JSON array of 9 cells, one per time (past, present, future) x aspect (simple, progressive, perfect), first person singular of "go":
{"time":"past","aspect":"progressive","form":"yo iba","alt":"yo estaba yendo","status":"form","marker":["iba"],"gloss":"I was going","note":"Imperfect: background or ongoing action in the past.","translit":"","markerTr":[]}
- form: the most natural spoken form. alt: another common way (or "" ). status: "form" (real tense/construction), "periphrasis" (workaround such as an adverb), or "none" (not used; still give the closest thing in form).
- marker: the whole word(s) of `form` that carry time/aspect compared with the present simple; present simple has marker []. Every marker must appear as whole words in form.
- translit and markerTr: required for bengali and arabic (romanised form and markers), else "".
- note: one sentence, under 140 characters, plain English, what a learner should notice.
See tools/build_turns.py for how the existing five languages were authored and follow the same judgement.

Keep helper scripts in a private scratchpad subfolder named after your language (other agents share the scratchpad). Do not edit any other files. Reply with the validator OK line and 2-3 sentences of judgement calls.
