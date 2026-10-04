# Brief: role-tagged sentences for the Explore experience

Read `data/sentences/en.json` first. It holds 6 meanings x 3-5 variants = 24 English sentences. Every English token carries one or more **roles** (the `roles` map at the top explains them). Your job: write the same 24 sentences in your language, natural and spoken, and tag every token with the role of the English piece it corresponds to. The site uses these roles to (a) light up the counterpart of a hovered word in every language and (b) draw ribbons from English word order to yours, so tagging is the whole point.

Output `data/sentences/<lang>.json`:
```json
{"lang":"german",
 "variants":{
   "decline.now": {"tokens":[["Ich","subj"],["kann","door"],["nicht","neg"],["kommen,","verb"],["weil","glue"],["ich","subj2"],["arbeiten","verb2"],["muss.","door2"]],
                   "why":"weil sends the conjugated verb (muss) to the end of its clause; the German door wraps around its slot."},
   ...all 24 keys, "<meaning>.<variant>"
 }}
```
Rules
- Tokens are single words or tight multi-word units (a phrase that moves as one piece, e.g. "to the market", "zum Markt", "बाज़ार"). Punctuation attaches to the neighbouring token.
- A token can carry several roles joined with `|` (German "kann" is `door`; "konnte" is `door|aux` because it also carries tense). Tense-carrying auxiliaries and particles (habe, bin, la, dang, yn, hai, rahaa, थी, va, ai) get `aux`. Negation words get `neg`. Question particles or fronted question words get `q`. Function words with no English counterpart (zu, ban, को, ne, que-complementiser, ïa, go) get `x`.
- Every English `door`, `door2`, `verb`, `verb2`, `glue` role must appear on some token. If your language genuinely fuses two roles into one word, give that word both roles. If a role is dropped (pro-drop subject), leave it out and say so in `why`.
- Hindi: each token is `[text, roles, translit]` with the same doubled-vowel roman scheme as data/hindi.json. Others: two elements.
- `why`: 20-180 characters, one concrete observation about the shape of THIS sentence in your language (word order, where tense went, what got fused or added). Not a generic remark.
- Register: informal address (du/tu/तुम/me-pha) in the "you" variants. Keep the register consistent with data/<lang>.json.
- Keep each sentence under 140 characters. Natural spoken forms over textbook forms; say so in `why` when they differ.
- Spelling: follow the conventions already used in data/<lang>.json (Zürich German informal spelling, Sohra Khasi orthography, Devanagari + translit).

Validate: `python3 tools/validate_sentences.py data/sentences/<lang>.json` must print OK. Then reply with the OK line and 3-5 sentences on judgement calls.
