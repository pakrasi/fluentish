# Brief: translate the English Chunk Bank into one language

The site has 1,200 high-frequency English chunks (sentence frames, collocations, gambits/fillers, fixed formulas, discourse connectors), CEFR B1-B2. You render them in ONE target language, as a native speaker would actually say them. The English source is split into 12 files: `data/chunks/src/batch01.json` ... `batch12.json` (100 items each; fields id, chunk, category, pragmatic_function, register, natural_example, cefr_level). Your assignment names which batches are yours.

## Output
For each of your batches write `data/chunks/parts/<lang>/batchNN.json`: a JSON array of 100 objects, one per source id, same order:
```json
{"id":"ENG_CHUNK_0001","t":"Könntest du mir vielleicht [Verb im Infinitiv]?","ex":"Könntest du mir vielleicht kurz helfen?","n":"Du form; Sie form: Könnten Sie ... Konjunktiv II carries the politeness."}
```
- `t`: the target-language chunk. It must do the same JOB (pragmatic_function, register) as the English, not be a word-for-word gloss. Keep variable slots as square-bracket markers written in English or the target language, e.g. `[verb]`, `[Infinitiv]`, `[noun]`; if English has a slot, yours must too. Under 120 chars. If two forms are both very common, give both separated by " / ".
- `ex`: a natural translation of `natural_example` (adapt names/places if needed). Under 200 chars.
- `tr`, `extr`: romanised transliteration of `t` and `ex`. REQUIRED for hindi, bengali, arabic; omit otherwise.
- `n` (optional, under 160 chars): only when it teaches something: register trap, word order the chunk triggers, a false friend, or "no fixed equivalent; speakers say X instead". Skip for the obvious ones; do not write filler.
- Match register: informal English -> informal target (du/tu/tú/tu/você/तुम/তুমি/me-pha/Swiss du), polite -> polite forms.
- Conventions: follow the spelling/register choices already in `data/<lang>.json` if that file exists (Swiss German = Zürich informal spelling; Khasi = standard Sohra orthography; Hindi = everyday Hindustani, Devanagari + doubled-vowel roman aa/ii/uu). Languages without a framework file: Bengali = colloquial Kolkata cholito bhasha, Bengali script; Spanish = neutral Latin American (tú/usted, ustedes); Italian = standard; Portuguese = Brazilian (você); Arabic = Modern Standard Arabic for the chunk, and give the Levantine spoken form in `n` when daily speech differs sharply (chat-style roman: 3 for ع, 7 for ح).
- Khasi is low-resource: prefer common constructions you are confident in; where a chunk has no natural Khasi equivalent, give what a Shillong speaker would say and flag it in `n`.

## Process
Work one batch at a time: read `data/chunks/src/batchNN.json`, write the part file, run `python3 tools/validate_chunks.py <lang> batchNN`, fix until OK, then move on. Writing each batch to disk before starting the next is important: if you are cut off, finished batches survive. If a part file already exists and validates, skip it. When all your batches pass, reply with the OK lines and 2-4 sentences of judgement calls. Do not run --assemble.
