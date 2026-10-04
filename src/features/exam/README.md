# Exam feature

Goethe B1 mock exams: the test list, start panel, timed runners, reviews and the Today provider. Routes and files are listed at the top of `index.js`; data and collections at the top of `data.js`.

## Corrections → Practice cards

A correction line in feedback (`~~wrong~~ → ==right==` with a `_why_` line) is a practice item. "Practise these mistakes" on a review calls `addMistakes()` from `src/data/mistakes.js` with the corrections of all the attempt's current feedback entries in one call (`queueMistakes()` in `data.js`). That writes kv `mistakes`; Practice reviews each record as card `F:<attemptId>-<n>` in deck `b1`, with the source line "From your Schreiben Test 1". Calling it again keeps the ids of unchanged sentences. The review counts an attempt's live mistakes with `listMistakes()`. Exam never writes cards itself.

## Results sync

`data/sync/github-b1exam.js` (core) sends `exam.attempt`, `exam.voice`, `feedback.created` and the other b1-exam events and reads `feedback.json`, `results.json`, `vocab.json` and `learner.json`. This feature calls it when the Exam tab opens and after every submit, recording and correction (`sync()` in `data.js`). Nothing calls it on boot yet: wiring `syncResults()` into `main.js` (on start, `online` and `visibilitychange`) is a one-line core change left to the shell owner.

## Private notes for the corrector

The grader prompt in `services/claude.js` is generic. Notes about the learner come from `exams.learnerNotes` (profile kv) or, if that is empty, `notes` in the private repository's `data/learner.json`. Profile has no editor for the kv yet.
