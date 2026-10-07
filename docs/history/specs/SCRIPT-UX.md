> **Historical spec, not maintained.** Written 2026-10-04 in round 2 of the Fluentish build as the UX spec for Scripts (paste a text, mark unknown words, rehearse until you can deliver it).
> Copied here and privacy-scrubbed on 2026-10-07: personal data, names, local paths and scores were removed or
> summarised. Where it disagrees with the code, the code and the living docs win: `docs/ARCHITECTURE.md`, `src/features/practice-script/`, `src/domain/script/`, `src/domain/text/`.
> What was actually built, and what changed: `docs/history/round2-practice-and-explore.md`.

# Script mode: UX spec

Author: UX agent, round 2, 2026-10-04. Inputs: ROUND2.md, CLAUDE.md, docs/DESIGN.md, ARCHITECTURE.md, CONTRIBUTING-FEATURES.md, UX.md, the live app at 390 px WebKit, the code (`itemids.js`, `wordtriage.js`, `budget.js`, `fsrs.js`, `services/claude.js`, `practice/speech.js`, content word list and grammar concepts), and a real talk the owner is preparing in German (read-only; none of its text is copied here).

---

## 0. What a real talk script looks like

| Fact (from the owner's talk) | Design consequence |
|---|---|
| The talk is long: well over a thousand German words in many chapters ("Kapitel") with slide numbers, close to 20 min to say | Sections are the unit of rehearsal. A script is long; nothing may assume it fits on one screen or in one Claude call. |
| He writes **EN → DE pairs** per sentence (`**EN**:` / `**DE**:`); the German is corrected by a tutor | Import that format as is. The English line per sentence is the best cue and the best card prompt we can get. |
| His learning edition ("Lern-Edition") splits sentences into **Bausteine**, then rebuilds ✦ full sentences, then **ROLLUP** (all sentences since the last roll-up in one go) | He already invented the ladder: parts → sentence → run of sentences. The app should do the same, not invent a new method. |
| **Bold** marks the words he had to learn | Marking unknown words is right. Only a small share of words need it, so marking must be fast and suggestion-led. |
| Some sentences are long, technical subordinate-clause chains | Some sentences are above his level and too long to say. Flag them; offer a split. |
| An audience-questions block ("Publikumsfragen") per part, with answers | Q&A prep is part of delivering a talk. Later phase, but the data model leaves room. |
| A register note: informal (ihr/euch), switchable to Sie | Register is a per-script setting that Claude respects when it writes German. |
| Proper names everywhere (product names, people's names, English titles) | Never suggest names or English terms as unknown words. |

**Critique of the starting idea** ("paste → mark unknown words → practise sentences, words, grammar until known"):
1. Making every sentence an FSRS card is the wrong tool. A talk is recalled **in order, from a cue**; over a hundred isolated sentence cards cost ~10 min a day forever and still don't make him able to say Kapitel 3 start to end. So: **words and phrases are cards** (they transfer to every other conversation); **sections are rehearsed** on a ladder and the section itself is the scheduled item. Sentence cards exist only for the few sentences he flags as hard.
2. Grammar drills from a talk are low value a few weeks before delivery. Show which B1 topics the script uses and link to the existing topic rounds; don't generate new grammar cards from his sentences.
3. A word is best learnt in the sentence he'll say it in. Word cards show his own sentence with the word gapped.
4. "Until he knows it" needs a number he can trust. **Ready** = share of the script (by words) he can say from the cue with expected recall ≥ 90% on the delivery day. Same honesty rule as exam readiness.

---

## 1. Decisions

1. **Place:** Practice › Scripts. Not a tab (four tabs stay; Exam hides without an exam). One Today row when a script has work due. Routes under `#/practice/scripts…`, code in `src/features/practice/script/` so it can reuse the round engine (features can't import each other).
2. **Two kinds:** *Talk* (say it as written: full ladder, verbatim) and *Retell* (say it in your words: notes and model text, ladder skips Letters/Gaps). Chosen on paste; changeable.
3. **Input:** paste German, or paste English / notes and let Claude write the German (his key). His EN/DE pair markdown is detected and imported with both languages kept.
4. **Marking:** tap a word to mark it; suggestions from the word list are pre-underlined, one button marks them all.
5. **Ladder per section:** Listen → Letters → Gaps → Cue, then the section is a scheduled item. Full run at the end.
6. **Self-grading:** Again / Hard / Good / Easy, as in the speaking simulation, after every ladder step past Listen and every Cue rehearsal.
7. **Scheduling:** while a B1 exam date is ahead, script items never enter the B1 round and add no Today row, unless the delivery date comes before the exam. After the exam they share the daily minutes (§6).
8. **Privacy:** device-only, never synced, never exported unless he opts in (§8).

---

## 2. User journeys

**J1 First script (the talk, German pairs, has key).** Practice › Scripts (empty) › New script › pastes the Kapitel 1–5 markdown › app detects "German with English" and 5 sections from `##` headings › title, Talk, deliver-by date › Continue › Mark: Section 1 shows 3 suggested words underlined; taps "Mark 3 suggested", taps one more word himself (it lifts into the tray) › Next section … › Tray › "4 words without a meaning" › Get meanings (Claude) › Done › Overview: Ready 0%, Next: "Listen · Einführung · 2 min".

**J2 A video retold to friends (English notes, has key).** New script › pastes 9 bullet points in English › detected "Notes in English" › kind preset Retell › "Write it in German" (register: du; length: about 2 min) › preview, edits one sentence › Continue › Mark › Overview. Ladder per section: Listen → Cue.

**J3 No key.** Pastes English › the German step says "Writing the German needs a Claude key. Add one in Profile, or paste German instead." Pasting German works fully: marking, glosses from the word list (off-list words get his own meaning or wait), word cards, ladder, full run. Sentence translations are missing, so cues use section titles and the first words.

**J4 A normal day after the exam (talk in 40 days).** Today shows "My talk · D words due · Gaps: Der Tanz · 9 min" › one tap runs the script round, then the rehearsal › grades Good › script line fills.

**J5 Three days before the talk.** Today row moves up (priority 22): "Full run · M min". No new words. Overview shows the countdown like the exam: "Talk Thu · 3 days". Eve: one full run + Listen pass; Day: Listen to Section 1 only, as a warm-up.

**J6 Editing after cards exist.** Tutor corrects two sentences › Overview › Edit › Section 3 › changes text › Save › toast "2 sentences changed in Die Nahrung. That section goes back to Gaps." Word cards untouched.

**J7 Done.** After the delivery date: "Did you give the talk? [Yes, archive it] [Move the date]". Archive stops rehearsals; marked words stay in the review queue.

---

## 3. Screens

Width 390 px (≈38 chars). `▮` primary, `[ ]` button, `▸` row link, `┄` dotted underline = suggested, `▁` solid accent underline = marked.

### 3.1 Practice hub row
Inserted after "Mistakes from corrections", before Speak: `Scripts · My talk 34% · talk in 40 days ▸`. None yet: `Scripts · Practise a talk or a story you want to tell ▸`. Two or more: `Scripts · 2 active ▸`.

### 3.2 Library `#/practice/scripts`
Purpose: list scripts, start a new one. Sort: active by delivery date, then no date, then archived (collapsed).
```
┌──────────────────────────────────────┐
│ ‹ Practice                           │
│ Scripts                              │
│ ┌──────────────────────────────────┐ │
│ │ My talk                   Talk   │ │
│ │ N words · about M min           │ │
│ │ ▓▓▓▓▓▓▓░░░░░░░░░░░  34% ready    │ │
│ │ Talk Thu 3 Dec · 40 days         │ │
│ └──────────────────────────────────┘ │
│ ┌──────────────────────────────────┐ │
│ │ A film, retold          Retell   │ │
│ │ 240 words · about 2 min · 80%    │ │
│ └──────────────────────────────────┘ │
│ Archived · 1                       ▸ │
│ Scripts stay on this device.         │
│ ▮ New script                         │
└──────────────────────────────────────┘
```
Empty: h1, one line "Paste a talk, a text or notes you want to say in German. The app finds the words you need and takes you from reading along to saying it from memory.", ▮ New script. Bar under each card = the script field in its compact 6 px strip form (§5.2).

### 3.3 New script `#/practice/scripts/new` (step 1 of 3: Paste)
```
┌──────────────────────────────────────┐
│ ‹ Scripts               Step 1 of 3  │
│ New script                           │
│ Title                                │
│ [ My talk                          ] │
│ ( Talk ) ( Retell )                  │
│ ┌──────────────────────────────────┐ │
│ │ ## Kapitel 1 — Einführung        │ │
│ │ 1. **EN**: Hi everyone, I'm …    │ │
│ │    **DE**: Hallo zusammen, …     │ │
│ └──────────────────────────────────┘ │
│ German with English · 5 sections ·   │
│ 612 words                    Change  │
│ Deliver by (optional)  [ Thu 3 Dec ] │
│ Stays on this device. Not synced.    │
│ ▮ Continue                           │
└──────────────────────────────────────┘
```
- Detection line (local, instant, under the field): *German* · *English* (→ step 2 writes German) · *German with English* (`**EN**:/**DE**:` pairs, or alternating lines where ≥ 70% pair up) · *Notes* (≥ 60% of lines start with `-`, `*`, `•`, `1.`, or are under 8 words without a final full stop). Language by stop-word ratio. "Change" opens chips to override.
- Sections: from `#`/`##`/`###` headings, else blank-line paragraphs; a run over 220 words with no break is split at the nearest paragraph or sentence end near 150 words. `**ROLLUP**` lines start a new section (the roll-up markers of the pair format). Slide notes like `*(Folien 1–2)*` are kept as the section's note, not spoken text.
- Limits: 20,000 characters (≈ 3,000 words). Over 2,500 words: "Long script: about 25 minutes to say. Fine, it's practised one section at a time." Over the limit: field border bad + "Over 20,000 characters. Split it into two scripts." Continue disabled. Under 20 words: "Paste at least a few sentences."
- Deliver by: date chips/picker as in Profile; empty is allowed (no countdown, no caps).
- Talk/Retell: preset by detection (Notes → Retell), always changeable.

### 3.4 Step 2: German version (only for English or Notes)
```
┌──────────────────────────────────────┐
│ ‹ Paste                 Step 2 of 3  │
│ German version                       │
│ Address the audience as              │
│ ( du ) ( ihr ) ( Sie )               │
│ Wording  ( Close to B1 ) ( As mine ) │
│ ▮ Write it in German                 │
│ ── after the call ────────────────── │
│ 1 · Einführung                       │
│ Hallo zusammen, ich bin …            │
│   Hi everyone, I'm …           Edit  │
│ Ein sehr langer Satz mit … (31 words)│
│   Long sentence.       Split · Keep  │
│ ▮ Continue to marking                │
└──────────────────────────────────────┘
```
- One Claude call per section, sections streamed in order, so he can read section 1 while 2–5 are written. Retry per section on error (existing ClaudeError codes → sentences).
- Output contract (JSON): `{sentences: [{de, en}]}` keeping his sentence boundaries; Notes → prose of about the chosen length (Retell: "about 2 min" chips 1 / 2 / 5 min).
- "Close to B1" asks for sentences ≤ 20 words and B1 grammar where meaning allows; "As mine" translates closely.
- Long-sentence flag (> 25 words, local) appears for every kind of input. "Split" asks Claude (with key) or splits at the comma before a subordinator (`, die/der/das/weil/dass/wenn/obwohl/damit`) locally.
- No key: this step is replaced by a notice: "Writing the German needs a Claude key. Add one in Profile, or go back and paste German." [Profile] [Back]. German input skips step 2 entirely.
- Privacy line once above the button: "The text is sent to Claude with your key."

### 3.5 Step 3 / Mark words `#/practice/scripts/<id>/mark[/<section>]`
The heart of setup. Full text of one section, Newsreader 19 px (german-list), every word a 44 px-tall tap target (line-height 2.3 on this screen only).
```
┌──────────────────────────────────────┐
│ ‹ My talk        Section 1 of 5      │
│ Einführung         ( Words )(Phrases)│
│                                      │
│ Heute möchte ich über Bienen spre-   │
│ chen, genauer über ihre erstaunliche │
│                         ▁▁▁▁▁▁▁▁▁▁▁▁ │
│ Orientierung. Eine Biene findet den  │
│ Weg zurück zum Stock, auch wenn sie  │
│ kilometerweit geflogen ist. … wie    │
│ sie anderen Bienen die Richtung mit- │
│ teilt, ist noch erstaunlicher.       │
│ ┄┄┄┄┄┄┄┄┄                            │
│ ▮ Mark 2 suggested      [Next ›]     │
├──────────────────────────────────────┤
│ ▴ 3 marked · erstaunlich · Orient…   │
└──────────────────────────────────────┘
```
- **Tap** an unmarked word: marks it (accent underline, lift into tray, §9.1). **Tap** a marked word: opens the word sheet. Unmark is in the sheet and on swipe in the tray, so a stray tap never loses a gloss.
- **Suggested** (dotted ink-3 underline, not marked): computed locally (§7.2). "Mark N suggested" marks them all in this section; the button disappears at 0. He can leave suggestions unmarked; they mean nothing on their own.
- **Phrases** segment: tap the first word, then the last word of the phrase (max 8 words, same sentence); the span gets a light surface-2 band and goes in the tray as one item. Chunk-bank matches (§7.3) show as suggested phrases in this mode.
- Proper names and English words are not tappable in Words mode (ink-2, no hover); a long press makes them tappable if the guess was wrong.
- Word sheet (bottom sheet): lemma in Newsreader 24 ("anstoßen" from "angestoßen"), article/plural for nouns, ▶ (device voice), meaning (from word list, else Claude, else an input "Meaning"), level chip (B2), "In this script 3×", [Unmark]. Lemma has "Change" (a 16 px input) because the local guess can be wrong.
- Tray (sticky, above safe area; replaces the tab bar on this screen): peek row with count and the last three lemmas; tap → sheet with the full list grouped by lemma, "4 without a meaning", [Get meanings] (key) or the inline meaning inputs. Words without a meaning are kept and wait, as exam words do (`wordtriage` "waiting").
- Last section: [Next ›] becomes ▮ Done, which goes to the overview. Marking can be resumed any time from the overview ("Section 4 not marked yet").
- Sentence flag: long-press a sentence's final punctuation → "Practise this sentence" (makes an `SS:` card, §7.4). Also offered on the overview for long sentences.

### 3.6 Script overview `#/practice/scripts/<id>`
```
┌──────────────────────────────────────┐
│ ‹ Scripts                       ···  │
│ My talk                              │
│ Talk Thu 3 Dec · 40 days             │
│ 34                                   │
│ % ready to deliver                   │
│ ▓▓▓▓▓▓▓▓▓▓▓▓▒▒▒▒░░░░░ Einführung     │
│ ▓▓▓▓▓▓▓▓▒▒▒▒▒▒░░░░░░░ Der Tanz       │
│ ▒▒▒▒▒░░░░░░░░░░░░░░░░ Die Nahrung    │
│ ░░░░░░░░░░░░░░░░░░░░░ Der Winter     │
│ ░░░░░░░░░░░░░░░ Was wir lernen       │
│ Words N · K known · D due            │
│ Full runs 0 · target M min           │
│ SECTIONS                             │
│ 1 Einführung     ■■■■ cue · Fri    ▸ │
│ 2 Der Tanz       ■■■□ gaps         ▸ │
│ 3 Die Nahrung    ■□□□ letters      ▸ │
│ 4 Der Winter     □□□□ not marked   ▸ │
│ Grammar in this script             ▸ │
│ Phrases from the bank · 9          ▸ │
│ ▮ Words · D due · 4 min             │
└──────────────────────────────────────┘
```
- Figure: Newsreader numeral (odometer), one per screen. Definition line under the field: "Ready: sections you can say from the cue, expected on Thu 3 Dec." (or "today" without a date). Tap → explanation sheet.
- The **script field** (§5.2): one row per section, one cell per sentence, width ∝ words.
- Section rows: 4 segments (DESIGN segments: done ink, now accent) for Listen · Letters · Gaps · Cue; caption is the current step or the next rehearsal day. Retell shows 2 segments.
- Sticky primary = the **next step**, picked in this order: (1) unmarked section → "Mark words · Section 4"; (2) due word/sentence cards → "Words · D due · 4 min"; (3) a due Cue rehearsal → "Say Einführung from the cue"; (4) the earliest section not at Cue → "Gaps · Der Tanz · 3 min"; (5) all at Cue and ≤ 7 days left or none due → "Full run · about M min". Final 3 days: Full run comes first.
- `···` menu: Edit text, Change date, Pause (no Today row, nothing due), Archive, Delete.
- Grammar sheet (phase 2): "Verb at the end after weil, dass, wenn · 14 sentences ▸" → his sentences with the pattern underlined (role colours allowed: these are grammar tiles), [Practise this topic] → existing round `#/practice/round?kind=topic:<id>`, [Look up] → `#/lookup/grammar/<topic>`.
- States: *first time* (nothing marked): numeral hidden, one line "Mark the words you don't know, then start with Listen." and ▮ Mark words. *No date*: "No delivery date · Add one" link instead of the countdown. *Paused*: banner "Paused. Nothing is due." [Resume]. *Archived*: read-only text + "Delivered Thu 3 Dec".

### 3.7 Rehearse a section `#/practice/scripts/<id>/rehearse/<section>?step=listen|letters|gaps|cue`
Full screen (chrome off), like a round. One layout for all four steps; only the text treatment changes.
```
┌──────────────────────────────────────┐
│ Der Tanz            ■■□□       [End] │
│ ( Listen )( Letters )( Gaps )( Cue ) │
│                                      │
│ Jetzt kommt der schönste Teil. Ich   │
│ zeige euch gleich ein V____ von      │
│ einem T____ im B_______ .            │
│ ┊ Das haben die meisten von euch     │
│   noch nie gesehen.                  │
│                                      │
│ I'm going to show you a video of a   │
│ dance in the hive …   (EN, toggle)   │
├──────────────────────────────────────┤
│  ⟲    ◀   ▶ Sentence 3 of 7   ▶▶  0.9×│
└──────────────────────────────────────┘
```
- **Listen** (read along, shadow): device German voice reads sentence by sentence; current sentence ink, others ink-3; current word underlined from `boundary` events (sentence-level highlight where the browser has none). Auto-pause after each sentence for his own repetition: pause = 1.2 × sentence audio length, then the next one (the same idea as audio files with pauses built in). Transport: replay sentence, previous, play/pause, next, speed 0.8/0.9/1.0. Done when every sentence has been played once → "Listen done" check, no grade (it's exposure).
- **Letters:** every word reduced to its first letter + underscores sized to the word ("V____"); marked words and sentence starts first. Tap a word to re-ink it for 2 s (counts as a peek). Voice is off by default; ▶ per sentence remains.
- **Gaps:** only the first word of each sentence and punctuation remain; the rest are baseline gaps. Tap a gap to peek. Peeks are counted and shown ("4 peeks") at the end, never during.
- **Cue:** the text is hidden. Cue = his EN sentence for the first sentence + the section title, or (no English) the first three words. [Show text] reveals with Letters, then full text. Optional ● Record.
- End of every step except Listen: grade sheet "How did that go?" with **Again / Hard / Good / Easy**, each with a one-line meaning: Again "Stuck more than twice" · Hard "Got through with peeks" · Good "A few hesitations" · Easy "Fluent". Good/Easy unlocks the next step for the next session (Easy on Letters skips to Cue). Again on Cue sends the section back to Gaps next time. The peek count pre-selects a suggestion (0 → Good, 1–3 → Hard, > 3 → Again) but he always taps.
- The step chips are free to switch (he may want to drop back to Listen); only the grade moves the ladder.
- Retell: steps are Listen (model text) and Cue (his notes as cue); grading the same.
- No German voice on the device: Listen shows "This device has no German voice. On iPhone: Settings › Accessibility › Spoken Content › Voices › German." and works as silent read-along.

### 3.8 Record and compare (in Cue and Full run)
● Record (recorder service). After stop: two rows: "Your take · 1:12 ▶" and "Device voice · 1:02 ▶", and the section text to read while listening. Keep the last 3 takes per section (blobs, device only), older ones deleted automatically; "Keep this take" pins one. No transcription in phase 1.

### 3.9 Full run `#/practice/scripts/<id>/run`
```
┌──────────────────────────────────────┐
│ 07:42 / about 18:00            [End] │
│ ──────────────────────────────────── │  2 px timer, hairline-strong, ticks per section
│ 4 of 5                               │
│ Der Winter                           │
│ "In winter the bees stay …"          │
│ Folien 5–7                           │
│            (tap for text)            │
│ ● Recording                          │
│ ▮ Next section                       │
└──────────────────────────────────────┘
```
- One cue card per section; Next records the split time. Screen stays awake (Wake Lock where available).
- Start sheet: "Record the run?" (off by default), "Show slides notes" toggle.
- End screen: a bar per section, planned vs actual seconds (runway style: planned = outlined cell-plan bar, actual = ink fill, today accent), total "17:20 · target 18:00", then one grade for the whole run and an optional per-section "Stuck here" chip list. Sections marked stuck get an Again on their SR item; the rest get the run grade (capped at Good).
- Target minutes: words ÷ 110 wpm by default, editable on the start sheet.

### 3.10 Script round `#/practice/round?kind=script:<id>`
The existing round, filtered to this script's cards, source line "My talk · Der Tanz".
- Word (`W:`/`SW:`): his sentence with the word gapped, the meaning as hint; type the word. Second exposure on: the English meaning alone (the standard word card). Grading = existing match.js rules (corpus stays at 0).
- Phrase (`SP:`/`K:`): English → type the phrase; long ones as tiles to order.
- Sentence (`SS:`, flagged sentences only): English (or the sentence with the verb chunk gapped when there's no English) → **say it**, [Show], then Again/Hard/Good/Easy. No typing of 20-word sentences on a phone.

### 3.11 Edit `#/practice/scripts/<id>/edit`
Sections as a list; tap one → plain textarea with that section's German (and English below when present). Add / delete / reorder (move up/down buttons, not drag) sections. Save shows what changed (§7.5).

### 3.12 Delete
Sheet: "Delete My talk? Its text, rehearsals, recordings and sentence cards are deleted. The words you marked stay in your review queue." Checkbox "Also remove the words that only came from this script". [Delete] (bad) [Cancel]. Toast "My talk deleted" with Undo for 4 s; real deletion (tombstone, blobs removed) after the toast closes.

---

## 4. Copy (plain, `practice.script.*`)
"Scripts", "New script", "Talk", "Retell", "Deliver by", "Mark 3 suggested", "3 marked", "Get meanings", "Write it in German", "Listen", "Letters", "Gaps", "Cue", "Full run", "Ready", "Show text", "Record", "How did that go?", "Words · D due", "Talk Thu 3 Dec · 40 days" (Retell: "Tell it Sat 28 Nov"), "Scripts stay on this device." No "master your talk", no "you've got this". German text in Newsreader with `lang="de"`; UI English.

---

## 5. Graphic system

### 5.1 Tokens used
Only DESIGN.md tokens. Marked word = accent underline 2 px (accent means "you, now": he chose it). Suggested = 1 px dotted ink-3. Phrase = surface-2 band, rounded.tile. Hidden letters = underscores in ink-3 at the word's width (monospace not needed: `ch` width of the hidden letters, so line breaks don't jump between steps).

### 5.2 The script field (the graphic moment of this mode)
The script drawn as text lines: one row per section, one cell per **sentence**, cell width ∝ its word count (min 6 px), 7 px tall, 2 px gaps, rows labelled with the section title in caption. Cell states reuse the field colours: not started `cell-empty` + outline · learning `cell-learning` (section on Listen–Gaps) · known `cell-known` (section at Cue with expected recall ≥ 0.9 on the delivery day) · known today `accent`. So a ready script looks like a page of dark text. Library cards use a 6 px single strip of all cells. Canvas, `aria-hidden`; the figure and the per-section list carry the data.

### 5.3 Delivery chart
Full-run result bars (§3.9) and, on the overview after the first run, a line "Last run 17:20 · 4 runs" with the last five run totals as small ink ticks against the target line. No accent except today's run.

---

## 6. Scheduling

**Items.** Words/phrases are FSRS cards (one per lemma across all sources). Sections at Cue are FSRS items `SR:` graded by self-report. Ladder steps before Cue are not FSRS: the next step is offered the next study day (or the same day after 4 h, if he asks). Flagged sentences are FSRS `SS:` cards.

**Exam first.** While the B1 exam date is ahead (clock phases `week`, `lastNew`, `eve`, `day`): no script row on Today, no script items in the B1 round, the Practice row still opens the script so he can set up and mark. Exception: a delivery date on or before the exam date (then the script gets a row at priority 50). Phase 1 ships after the freeze anyway (no deploy before the exam), so this rule mostly protects later exams.

**Budget.** One Today row per active script, kind `speak`, built by `practice/script/plan.js`:
- minutes = due cards (`roundMinutes`) + the next ladder step (section words ÷ 60 per step, Listen ÷ 40) + due Cue rehearsals; capped at **25% of daily minutes** (default 15 of 60) unless the deadline needs more: `needed = remaining step-minutes ÷ days left`, up to 50%.
- priority 45 normally; 22 (right after the review round) in the last 7 days; on the eve: "Full run + Listen", on the day: "Listen · Section 1 · 2 min" (kind `warmup`).
- New script words per day: at most 8 per script and they count against `dayBudget().newPerDay` (script share first taken from the same total), so the combined new load never grows.
- No new words in the last 3 days before delivery (same idea as the exam's `lastNew`).
- With no exam and no B1 work, script due words join the main review round (source line shows the script); section rehearsals always stay in the script flow.

**Delivery date = an exam date for this script.** Due dates of `SR:`/`SS:` cards and script-only `SW:`/`SP:` cards are capped at delivery−1 when **read** (as `b1ready.dueOn` does for the exam), so moving the date never rewrites a card. Countdown copy, phases (`build` ≥ 8 days, `polish` 7–2, `eve`, `day`, `after`) computed by the clock from the script's date. After the date: J7 prompt, cap lifted, words keep their schedule.

**Ready** (pure function, tested in node): the words of every section that is at Cue **and** whose `SR:` card has expected recall ≥ 0.9 on the delivery day (today without a date), divided by all words in the script, as a whole percent. A section counts fully or not at all, so the number only moves when he can really say more. Words known = marked lemmas with recall ≥ 0.9. At most two scripts active at once; a third starts paused ("2 scripts are active. Pause one to rehearse this.").

---

## 7. What runs where

| Step | Local (no key) | Claude (his key) |
|---|---|---|
| Detect format, split sections, long sentences | yes | - |
| English / notes → German | - | per section, JSON `{sentences:[{de,en}]}` |
| English line per German sentence | from pair import only | "Add English" on the overview (one call per section) |
| Suggest unknown words | word list levels + his cards | - |
| Lemma of a marked word | word list, verb `forms`, noun plurals, suffix rules | "Check meanings" fixes lemmas in the same call |
| Meanings | word list `en` | off-list words in one batched call |
| Chunk-bank phrases | substring match against the 1,450 bank phrases | other multi-word phrases suggested in the analysis call |
| Grammar topics per sentence | detectors (verb-final after subordinators, Perfekt, um…zu, zu-Infinitiv, relative clause, Konjunktiv II, Passiv) | concept ids from `concepts_de.json` (closed list, 67 ids) |
| Split a long sentence | at comma + subordinator | rewrite into two |
| TTS, recording, ladder, grading, scheduling | yes | - |

Prompts are public templates in `services/claude.js` (no learner text in the repo); register and wording choice go in as parameters. Every response is rendered as text nodes and validated (unknown concept ids dropped).

### 7.1 Tokenising
Split on whitespace; keep punctuation as separate non-tappable tokens; hyphenated compounds are one token ("Honigbienen-Forschung"); quotes „ “ stripped from the tappable part. Token index is per sentence.

### 7.2 Suggestions (local)
Suggest a token when it is not a name/English word and any of: word-list level above his profile level (B2, C1, C2 for a B1 learner); not in the word list (and not a regular inflection of a listed lemma); its `W:` card has ≥ 2 lapses. Never suggest: list words at or below his level, words whose card recall today ≥ 0.9, words he unmarked in this script. Names/English: capitalised token not in the word list that is also capitalised mid-sentence in English stop-word context, or appears in an English line of the pair import, or is all caps; ASCII-only tokens with English letter patterns ("th", "w", final "y") and in no German list. Expect ~5–8% of tokens suggested.

### 7.3 Chunks
Normalised substring match of each bank phrase's German (`content/igloo/chunks/german.json`) against the sentences; matches reuse the bank's `K:` card ids (generic, already schedulable).

### 7.4 Sentence cards
Only flagged ones: via long-press (§3.5), via "Practise long sentences" on the overview (all > 25 words), or auto-proposed when a sentence holds ≥ 2 marked words. Cap 1 per 3 sentences.

### 7.5 Editing with stable ids
Each sentence and section gets a short id at parse time (6 base36 chars, unique in the script) and keeps it. On save, old and new sentences are aligned in order: identical text keeps its id; token overlap ≥ 0.6 at the same place keeps the id with `changedAt` (its `SS:` card shows "Changed since your last review" once, and the section's ladder drops to Gaps); everything else gets new ids; removed sentences tombstone their `SS:` cards. Marks are re-attached by lemma + sentence id; a mark whose word vanished is removed with a line in the save summary ("2 marks removed: Wabe, Nektar"). Word cards never change (ids are lemma based).

---

## 8. Privacy

- Script text, marks, translations, rehearsal state and recordings live in IndexedDB for this profile only: kv `scripts` and `scripts.progress`, blobs `script:<id>:<section>:<n>`. Never in the repo (fixtures for tests are a synthetic script, e.g. a short talk about bees).
- **Not synced.** Review events for cards whose only origin is a script (`SS:`, `SR:`, `SW:`, `SP:`, and `W:` cards created by a script) carry `local: true` and the outbox skips them. A `W:` card that also has an exam or B1 source syncs as before (its id is a public word-list id). Opt-in in Profile › Connections: "Include scripts in results sync" (off), which sends events and, if also chosen, recordings, to the private b1-exam repo so the tutor can hear a run.
- **Not exported** by Profile › Data › Export unless "Include scripts" is ticked. "Delete all" removes them.
- Claude: one line before the first call per script, "The text is sent to Claude with your key."
- `SW:` ids contain a lemma slug (e.g. `SW:wabenbau`), which can hint at the script's topic, so `SW:` cards are always `local: true`, even with the sync opt-in. All other script ids are random section/sentence ids.

---

## 9. Motion moments (kit only, transform/opacity, reduced-motion paths)

1. **Word lifts into the tray.** Tap: accent underline sweeps left to right (base 240 ms, ease-out); a clone of the word rises 8 px, then flies to the tray peek (FLIP, card 380 ms, spring-snappy, scale to 0.7, opacity to 0 on arrival); the tray count ticks (`countTo`) and the lemma slides into the peek row. Haptic tick. One primary motion; the text itself never moves. "Mark N suggested" staggers the lifts (28 ms, max 8; the rest just count). Reduced: underline appears, count updates, no clone.
2. **Letters recede.** Switching Listen → Letters: letters after the first fade out left to right across the section (quick 160 ms per word, stagger 28 ms by sentence, total ≤ 640 ms) while underscores fade in. Gaps: the remaining first letters fade the same way. Peek re-inks one word (quick) and fades back after 2 s. Reduced: instant swap.
3. **Read-along.** Current sentence crossfades to ink (quick); word underline moves with `boundary` events via transform (no layout). Nothing else moves while the voice speaks.
4. **Script field fills.** Back on the overview after a Good/Easy Cue grade: that section's cells land in accent with the `ripple()` across the row (720 ms); the numeral rolls (odometer). This is the celebration; no confetti. Reduced: final state drawn.
5. **Full-run end.** Section bars rise in sequence (fill 640 ms, stagger 28 ms), total ticks to its value. `breathe()` is not used here (Today only).
6. **Ladder step done.** The section's next segment fills (spring-snappy), the check pops (spring-pop) on the grade sheet. Same as a round's correct answer, so it feels like part of one app.

---

## 10. Data model (for the builder)

```js
// kv 'scripts' (profile, private, local-only): { [scriptId]: script@1 }
{ id, v: 1, profileId, title, kind: 'talk' | 'retell', lang: 'de', register: 'du' | 'ihr' | 'Sie' | null,
  deliverOn: 'YYYY-MM-DD' | null, targetMin: number | null, status: 'active' | 'paused' | 'archived',
  source: { format: 'de' | 'en' | 'pairs' | 'notes', wording: 'b1' | 'mine' | null },
  sections: [{ id, title, note, sentences: [{ id, de, en: string | null, changedAt?: string }] }],
  marks: [{ id, kind: 'word' | 'phrase', sentenceId, start, end, surface, lemma, gloss: string | null,
            glossFrom: 'list' | 'claude' | 'me' | null, cardId }],      // cardId: W:… | SW:… | SP:… | K:…
  analysis: { [sentenceId]: { concepts: string[], chunks: string[] } },   // phase 2
  flagged: string[],                                                       // sentence ids with SS: cards
  createdAt, rev, deletedAt }
// kv 'scripts.progress': { [scriptId]: { sections: { [sectionId]: { step: 0..4, steps: { listen?, letters?, gaps?, cue?: day },
//                          peeks: number }, runs: [{ day, ms, splits: number[], grade, takeId? }] } }
```
- **Item ids** (add to `itemids.js` TAGS, no existing id changes): `SW:<slug>` script word not in the list (area words), `SP:<scriptId>.<markId>` phrase (area speaking), `SS:<scriptId>.<sentenceId>` sentence (area script), `SR:<scriptId>.<sectionId>` section rehearsal (area script). Marked list words reuse `wordId(lemma, wordmap)`.
- **Decks:** words/phrases in `b1` (one card per lemma for all sources). `SS:`/`SR:` in a new deck `script`, so B1 readiness, area bars and the B1 pool never count them.
- Cards carry `origin: ['script:<id>', …]` (new field) for the sync filter, delete, and source lines.
- `fsrs.schedule` gets ctx `{today, exam: deliverOn, phase: scriptPhase}` for `script` deck items; self-grades map directly to ratings 1–4 (mode `'s'` in `hist`, as the speaking simulation).
- Pure, node-tested modules: `script/parse.js` (detect, sections, sentences, tokens, pairs), `script/suggest.js`, `script/lemma.js`, `script/align.js` (edit), `script/ready.js`, `script/plan.js` (Today row + next step). Test fixture: a synthetic 3-section script. The `?today=` override covers the deadline phases.

---

## 11. States checklist

| State | Behaviour |
|---|---|
| Empty library | §3.2 empty copy + ▮ New script |
| First script, nothing marked | Overview shows ▮ Mark words, no numeral |
| Returning | Overview figure rolls once from last-seen value; next-step button |
| No key | German paste fully works; English/notes blocked with Profile link; meanings typed or waiting |
| Claude error | Per-section "Couldn't write this section. [Try again]" with the error sentence from `ClaudeError` codes |
| Offline | Same as no key for Claude steps; everything else works |
| Long script (> 2,500 words) | Note on paste; overview list virtualised by section; field rows wrap |
| No German voice | §3.7 notice; read-along silent |
| Mic denied | Record hides, line "Recording needs the microphone. Allow it in Settings › Safari." |
| Exam week | Practice row shows "Scripts wait until after the exam on <exam date>" (date from clock), still openable |
| Past delivery date | J7 prompt on overview and once on Today |
| Paused / archived | §3.6 states |

---

## 12. Phase 1 (build first) vs later

**Phase 1 (one PR, after the exam freeze):** library, new script with **German and EN/DE pair paste** (no Claude writing), sections from headings/paragraphs/ROLLUP, long-sentence flag with local split, Mark words (tap, suggestions, tray, word sheet, local lemma + list meanings, typed meanings, "Get meanings" for off-list words as the only Claude call), word cards in a script round (gapped in his sentence), the four-step ladder with device TTS and self-grades, `SR:` scheduling with delivery-date cap, overview with Ready + script field, full run with timer and split bars, edit with stable ids, delete with undo, Today row and budget rules, privacy rules (`local: true`, export exclusion). Motion moments 1, 2, 4, 6.

**Phase 2:** English and notes → German (step 2) and Retell polish; "Add English" per section; Phrases mode and chunk-bank matches; flagged sentence cards (`SS:`); grammar topics sheet linked to existing rounds; record and compare (§3.8); motion 3 and 5; opt-in sync for the tutor.

**Phase 3:** audience questions per section (Claude proposes 3, he edits, practised from the cue, like an audience-questions list); dictation compare that lists skipped words (speech.js recogniser, never a grade); import from a file or the share sheet in the iOS app; neural voice audio built on the Mac (edge-tts) and pulled privately.

**Cut:** auto sentence cards for every sentence; grammar cards generated from his text; typed full-sentence translation; a separate Script tab; streaks or badges.

---

## 13. Open questions for the owner

1. When is the talk, and should the app hold you to verbatim (Talk) or is Retell with your own wording enough?
2. ihr or Sie for this audience? (The talk's notes say ihr, switchable.)
3. How many minutes a day can scripts take after the exam: the 25% default (15 of 60), or more?
4. Should script reviews ever reach the b1-exam repo, so the review assistant can hear a full run? Default here is no.
5. Import: is pasting from a notes app fine, or do you want the app to read the notes' Markdown files directly (only possible later in the iOS app or via the Mac sync)?
6. The existing learning edition has Bausteine (sentence parts). Want a "Parts" step before Letters (say each part, then the whole sentence), or is Letters enough?
