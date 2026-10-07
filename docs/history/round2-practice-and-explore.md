# Round 2: new practice, Explore, and the first off-device backup (4 to 5 October 2026)

**Commits:** `66156ff` … `2678e29` (72 commits, including merges). Historical record; living docs:
`docs/ARCHITECTURE.md`, `docs/DESIGN.md`, `docs/ROADMAP.md`. Specs from this round, privacy-scrubbed:
`specs/SCRIPT-UX.md`, `specs/EXPLORE-DESIGN.md`, `specs/PALACE-DESIGN.md`, `specs/PREFIX-DESIGN.md`,
`specs/ARCH-ASSESSMENT.md`.

## Goal

A few days before his exam, with Schreiben his weakest module, the owner asked for:

1. **Schreiben practice:** the most important B1 Schreiben phrases and a way to practise them.
2. **Speaking situations:** an everyday situation that needs a chunk, ranked A1 to B2 by how common it is; he answers
   aloud, grades himself Again / Hard / Good / Easy, and the item comes back on the schedule.
3. **Scripts (shadowing):** paste a script (a talk to give, notes from a video), mark the words you don't know, and
   practise sentences, words and grammar until you can deliver it.
4. Motion that adds spark and joy, tasteful and reduced-motion safe.

Later the same weekend he queued more: mark items as known, a word map, word clusters, a 3D view, word cards with the
dictionary form and key forms, a round size picker, Word building (German verb prefixes), and an architect's
assessment with a score.

## Decisions

- Speaking situations are their own deck (`speak`, ids `SS:`) on the one FSRS schedule, with neural clips published
  next to the exam audio rather than in this repository.
- Scripts stay on the device, are excluded from sync and export, and their new words count inside the B1 budget.
- One shared self-grade control (grade4) and one done screen for every self-graded practice.
- Explore is a 2D map of every word, phrase and grammar concept with a stable, content-only layout built at build
  time; 3D is an optional view of the same layout (the Type city).
- One knowledge score per item across every source.
- The architect's assessment scored scalability 5.0 / 10 (multi-language 2.5) and put "his progress exists on one
  device only" first. Its "Now" items 1 to 3 and 7 were built at once.

## What shipped

- Scripts (paste, mark words, rehearse from Listen to Cue, full run, a words round), speaking situations, Schreiben
  phrases and Build an email, word clusters (families, opposites, prefixes, endings, topics, prepositions), the
  Explore map with a group sheet that starts a round, the 3D Type city in hand-written WebGL2, "I know this" and Quick
  sort, word cards, the round size picker, Word building.
- An append-only ledger of every card id content has shipped, and a test that fails when one disappears.
- **Off-device progress:** the sync seam (`data/sync/index.js`), the progress backup (learning events as one NDJSON file
  per device per day plus a daily snapshot), restore with a journaled cross-device merge, the bounded outbox, and a
  persisted, scrubbed error log.

## What the reviews found

Four reviewers (design and motion, UX and copy, German, code and accessibility). The coordinator's 16 rulings were
applied by one implementer.

- **German:** the content was correct, but Script mode's "split long sentence" generated wrong German (verb-final
  fragments) that he would have rehearsed (P0). Schreiben grading let exam-costing mistakes through: polite forms not
  strict, four verb-position errors undetected, two accept patterns that accepted bad German, two plain right
  answers rejected. Glosses carried authoring notes or duplicated each other. A grading hotfix landed first.
- **UX:** Today gave Schreiben new phrases while the two most useful Schreiben actions (reading the uncorrected
  corrections, writing a task from memory) sat outside the plan; Practice had overlapping rows. Ruling: Practice as
  one list grouped by exam module, and Schreiben first on Today.
- **Design:** two moments cleared the bar (the map's mode switch, the situation card); elsewhere motion happened where
  it could not be seen on a phone. Progress bars re-divided when a card came back. The map was cramped at 390 px.
- **Code and accessibility:** unseen-word text under 4.5:1, the map canvas not operable by keyboard, focus dropping
  to `body`, an unbounded bitmap cache on iOS, a benign ResizeObserver error logged as an app error.
