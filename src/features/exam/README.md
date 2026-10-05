# Exam feature

Mock exams: the test list, start panel, timed runners, reviews and the Today provider. Routes and files are listed at the top of `index.js`; data and collections at the top of `data.js`.

## Exams as data

The screens draw the exam from its definition (`content/exams/<id>/exam.json`, `exam-def@1`): sections and their kind, parts, item types, timings, play limits, reading times, replays, scoring and pass lines. The runner's strings are in the exam's language, from its exam-locale (`content/exams/<id>/locale.<lang>.json`), through `exam.tx('key')`; the English chrome uses `ctx.t` and `src/i18n/en.js`. `data.js examDef()` loads both with the manifest entry. Pure helpers: `domain/examdef.js` (walking a test by the definition) and `domain/grade.js`. Result files: the adapter the definition names (`domain/exam-results.js`). Adding an exam: docs/ARCHITECTURE.md §3.4.

## Corrections → Practice cards

A correction line in feedback (`~~wrong~~ → ==right==` with a `_why_` line) is a practice item. "Practise these mistakes" on a review calls `addMistakes()` from `src/data/mistakes.js` with the corrections of all the attempt's current feedback entries in one call (`queueMistakes()` in `data.js`). That writes kv `mistakes`; Practice reviews each record as card `F:<attemptId>-<n>` in deck `b1`, with the source line "From your Schreiben Test 1". Calling it again keeps the ids of unchanged sentences. The review counts an attempt's live mistakes with `listMistakes()`. Exam never writes cards itself.

## Results sync

This feature records results through the sync seam, `data/sync/index.js` (`results(store).record(type, payload)`; `results(store).ref(event)` is the file the target names it, which a correction links to its attempt with). The GitHub target behind it (`data/sync/github-b1exam.js`) sends `exam.attempt`, `exam.voice`, `feedback.created` and the other b1-exam events and reads `feedback.json`, `results.json`, `vocab.json` and `learner.json`. The feature asks for a flush when the Exam tab opens and after every submit, recording and correction (`sync()` in `data.js`); `main.js` also flushes on start and when the page becomes visible.

## Private notes for the corrector

The grader prompt in `services/claude.js` is generic. Notes about the learner come from `exams.learnerNotes` (profile kv) or, if that is empty, `notes` in the private repository's `data/learner.json`. Profile has no editor for the kv yet.
