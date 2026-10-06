# Brief: the German B2 layer (round 4)

A learner moving from B1 to B2 will memorise every item in this layer. A wrong key teaches an error for years, so
every sentence must be what an educated native speaker in Germany writes today: correct, natural, and at B2. If in
doubt, choose the plainer sentence.

Batches live in `authoring/de/b2/<batch>/source.json`; `node tools/b2.mjs apply` writes them into content and
`node tools/b2.mjs gates <batch>` runs the machine gates. Read `GRAMMAR_BRIEF.md` (item shape) and `CHUNK_BRIEF.md`
(phrases) first. This brief adds the B2 rules.

## Language

- Standard German of Germany (de-DE), current spelling (2006 reform). Where the reform allows two spellings, list
  both as answers when the learner could type either: *infrage/in Frage stellen*, *sodass/so dass*, *vor kurzem/vor
  Kurzem* (case is ignored, spaces are not), *recht/Recht geben*, *ohne Weiteres/weiteres*.
- Register: neutral written German unless the item is about speech. Use *Sie* or *du* consistently in a sentence;
  translate items list both when English "you" is open.
- Topics: work, studies, housing, health, environment, technology, media, society, everyday life. No names of real
  people, firms or brands. No personal details about anyone.
- Vocabulary may be B2, but the point of a grammar item is its grammar: keep the rest of the sentence easy.
- No grammar hints in prompts ("(Verb ans Ende)", "(Konjunktiv)"). The task line may name the form to use
  ("Rewrite in the Konjunktiv II of the past."), the prompt never explains it. Brackets only for the word to inflect or
  the connector to use.

## Grammar items (`items`)

- Shape as in `GRAMMAR_BRIEF.md`: id `<concept>.NN`, kind, task (English), prompt, answer (every right variant, never a
  wrong one), note (one line: the rule, shown after answering), `strict_case: false`.
- B2 concepts have **12 items** (at least 3 kinds). Order the 12 from the plainest use to the hardest.
- Answers: list every variant a native speaker would accept for that prompt, and constrain the prompt so the list
  stays short ("Start with „Zwar“.", "Use „losfahren“.", "Keep the order."). Typical variants to remember:
  *desto/umso*; *dass*-clause and V2 clause in reported speech; *würde + Infinitiv* next to the synthetic Konjunktiv
  II where both are normal (*käme / würde kommen*), but not where the synthetic form is the norm (*hätte, wäre,
  könnte, müsste*: never *würde haben*); position variants of adverbs (*allerdings*, *dennoch*) when the task allows.
- Translate items only when the German has two or three renderings at most.
- `near`: for every item, 2 to 4 typical B2 learner errors on its point, as [answer, why]. They must be wrong German
  in this sentence and the grader must mark them wrong. Examples: *hatte* for *hätte*, *wurde* for *würde*, *müsse*
  for *müsste* where Konjunktiv II is needed, *geworden* for *worden* in the passive, *… machen sollen hätte* for *…
  hätte machen sollen*, *wäre* for *sei* where the item asks for Konjunktiv I, *es* left in after the impersonal
  passive moved (*Bis spät wurde es gefeiert*), a wrong case after *wegen/trotz/aufgrund*. For a gap item the near
  miss is the word(s) typed into the gap.

## Phrases (`phrases`: Redemittel and collocations)

- One English source entry (`ENG_CHUNK_NNNN` in `content/igloo/chunks/en.json` shape) and one German entry
  (`t`, `ex`, optional `n`) plus accepted typed patterns (`accept`, `core_en`) as in `ACCEPT_BRIEF.md`.
- `t` is the German phrase as people use it; `ex` a natural B2 sentence with it; `n` only when it teaches something
  (register, the case it takes, a false friend).
- `fn`: the function group (see below). Every B2 phrase has one.
- Prefer the phrase a German speaker actually says over a literal translation of the English. No anglicisms
  (*am Ende des Tages*) unless they are now normal German.

Function groups (`fn`): `opinion` giving and backing an opinion · `argue` arguing and giving examples · `hedge`
hedging and qualifying · `concede` conceding and countering · `agree` nuanced agreement and disagreement ·
`probability` guesses and probability · `conclude` weighing and concluding · `report` reporting and summarising a
source · `present` presentations · `discuss` chairing and taking part in a discussion · `figures` describing graphs
and figures · `formal` work and formal writing. Phrases outside these: `react` reacting (surprise, annoyance,
sympathy, irony) · `request` requests, offers, advice, declining · `social` social formulas (thanks, wishes, toasts,
goodbyes) · `narrate` telling and linking events · `people` relationships and character · `collocation` a
collocation or Funktionsverbgefüge with no single function.

## Review

Two independent passes per batch, both written as model personas (`reviewedBy: "model-2pass"`; never a name that
suggests a human native speaker):
- **Pass A**: a strict native de-DE editor and Goethe/telc B2 examiner. Checks every field and logs every change.
- **Pass B**: a second native editor (with an eye on Austrian and Swiss variants for answers), reviewing pass A's
  output without seeing pass A's log.
Each log entry: `{id, field, before, after, severity: "error" | "improve", why}`. `error` = wrong German, a wrong key,
a missing right answer a learner would type, a near miss that is actually right, a wrong level. `improve` = a more
natural or clearer choice. If pass B finds errors in more than 2 % of a batch's entries, the batch goes through pass
A again. The Konjunktiv, passive and indirect-speech keys also go to the learner's tutor (`TUTOR-CHECK.md`).
