# Exam feature

Goethe B1 mock exams: the test list, start panel, timed runners, reviews and the Today provider. Routes and files are listed at the top of `index.js`; data and collections at the top of `data.js`.

## Hand-off: corrections → Practice cards

A correction line in feedback (`~~wrong~~ → ==right==` with a `_why_` line) is a practice item. "Practise these mistakes" on a review writes them to the store, in the kv collection **`mistakes.inbox`**:

```js
{ id: 'f:<attemptId>-<n>', kind: 'correction', language: 'german', wrong, right, rule,
  source: { examId, test, module, attemptId, feedbackId }, createdAt }
```

Ids are stable (pressing the button twice adds nothing). Practice owns the rest: turn each entry into an `f:` card (UX §3.3, "Rewrite this sentence correctly", source line "Your Schreiben Test 1"), then remove it from the inbox with `store.update('mistakes.inbox', …)`. The review counts an attempt's mistakes as "in Practice" if they are in the inbox **or** a card `f:<attemptId>-*` exists in deck `b1` (`mistakesQueued()` in `data.js`); if Practice uses another deck, change that one line. Exam never writes cards itself.

## Results sync

`data/sync/github-b1exam.js` (core) sends `exam.attempt`, `exam.voice`, `feedback.created` and the other b1-exam events and reads `feedback.json`, `results.json`, `vocab.json` and `learner.json`. This feature calls it when the Exam tab opens and after every submit, recording and correction (`sync()` in `data.js`). Nothing calls it on boot yet: wiring `syncResults()` into `main.js` (on start, `online` and `visibilitychange`) is a one-line core change left to the shell owner.

## Private notes for the corrector

The grader prompt in `services/claude.js` is generic. Notes about the learner come from `exams.learnerNotes` (profile kv) or, if that is empty, `notes` in the private repository's `data/learner.json`. Profile has no editor for the kv yet.
