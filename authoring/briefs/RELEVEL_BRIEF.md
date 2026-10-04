# Brief: re-level English chunks by when a learner actually needs them

The chunk bank (`data/chunks/src/batchNN.json`, 100 items each) was generated as "CEFR B1-B2 for conversational fluency", so every item is tagged B1 or B2 even when a beginner uses it in week one. Your job: give each chunk a **practical level**, meaning the CEFR stage at which a learner living in the language needs to produce it.

## Rubric
- **A1**: survival and first-contact. Greetings, thanks, sorry, please, yes/no replies, "I don't understand", "How much is ___?", "Where is ___?", "Can I have ___?", "My name is", numbers/time basics. Short, fixed, no subordinate clause, needed in the first weeks.
- **A2**: everyday routine and simple social exchange. Ordering, shopping, directions, making plans ("Do you want to ___?", "Let's ___", "What about ___?"), simple opinions ("I think ___", "I like ___ because"), simple connectors (and then, but, because, so), common collocations (take a bus, have breakfast, make a mistake), basic repair ("Can you say that again?").
- **B1**: sustained conversation. Giving reasons and opinions with nuance, narrating, polite indirect requests ("I was wondering if"), hedging lightly, most gambits and fillers ("to be honest", "the thing is"), idioms in common daily use, connectors like although/however/in the end.
- **B2**: argument and nuance. Concession and counter-argument, rarer idioms, register-sensitive formulas, stance markers ("it's worth bearing in mind"), complex frames ("had I known").
Judge by *need and frequency*, not by how long the chunk is. When unsure between two levels, pick the higher one. Expect roughly: A1 5-10%, A2 25-35%, B1 35-45%, B2 20-30% across the whole bank, but let the items decide.

## Output
For each of your batches write `data/chunks/levels/batchNN.json`: a JSON array with one object per source id, same order:
`{"id":"ENG_CHUNK_0001","level":"B1","r":"polite indirect request; needs past-tense frame"}`
`r` is a reason under 70 characters. Validate with `python3 tools/validate_levels.py batchNN` until OK. Reply with the OK lines and your level distribution.
