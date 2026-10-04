# Brief: write a beginner (A1-A2) English chunk bank

The existing bank `data/chunks/en.json` has 1,200 high-frequency English chunks for B1-B2 conversation. It lacks the beginner layer. Write **250 new chunks** a learner needs at A1-A2, in exactly the same schema, and deduplicated against the existing 1,200 (read en.json fully first; do not repeat any existing chunk or a trivial variant of one).

## Schema (keys in exactly this order)
`id, chunk, category, pragmatic_function, register, variable_slots, natural_example, substitutable_examples, cefr_level`
- `id`: ENG_CHUNK_1201 ... ENG_CHUNK_1450, consecutive.
- `category`: one of sentence_frame, collocation, gambit_filler, fixed_formula, discourse_connector.
- `register`: neutral, informal, polite or formal.
- `variable_slots`: list of {slot, type} for every [slot] in `chunk` (same slot style as en.json, e.g. "[noun]", "[base-verb]", "[place]", "[number]", "[time]"); [] if none.
- `natural_example`: one natural sentence. `substitutable_examples`: two more.
- `cefr_level`: "A1" or "A2".

## Mix (250 total)
- ~70 A1, ~180 A2.
- Categories: fixed_formula ~70, sentence_frame ~90, collocation ~45, gambit_filler ~25, discourse_connector ~20.
- Cover these domains, each with several items: greetings and goodbyes; introducing yourself and others; please/thanks/sorry and replies; understanding and repair ("Sorry, I don't understand", "Could you speak more slowly?", "How do you say ___?", "What does ___ mean?", "Can you spell that?"); numbers, prices, time, dates; shopping and paying; ordering food and drink; directions and transport; hotel and travel; health and emergencies ("I need a doctor", "It hurts here"); likes, wants, needs; daily routine collocations; making and changing plans; simple feelings and states; asking about someone; weather small talk; phone and messaging basics; simple opinions and agreement; first connectors (and, but, because, so, then, first, after that, also).
- Each chunk must be something a beginner will actually say, in natural current English (mixed US/UK neutral).

## Output and checks
Write `data/chunks/beginner_en.json` (a JSON array, 250 items). Run `python3 tools/validate_beginner.py` until it prints OK; it checks schema, ids, slots, and near-duplicates against en.json. Reply with the OK line and the level/category counts.
