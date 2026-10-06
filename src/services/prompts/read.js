/* Reading's prompt templates (round 4, features/practice-read). Public: they describe the task and the format and say
   nothing about the learner. The text he pasted fills {text} or {sentence} only when he taps the button that sends it,
   after the line that says so. Pinned in tests/unit/prompt-pins.test.mjs. */
// @ts-check

/** @type {Record<string, string>} */
export const TEMPLATES = {
  'read-questions@1': 'Write {n} comprehension questions in {language} about the {language} text below, for a learner who has just read it. '
    + 'Mix them: 2 about the main idea (skill "global"), 2 about details (skill "detail") and 1 that needs an inference (skill "inference"). '
    + 'Each question is either multiple choice with 3 options (type "mc") or a statement to judge as true or false (type "tf", '
    + 'options exactly ["{true}", "{false}"]). "answer" is the index of the right option. "evidence" is a quote of 5 to 25 words '
    + 'copied exactly, character for character, from the text, that shows the answer. Answer only from the text. '
    + 'Do not ask about the title or about single words.\n\nText:\n{text}',
  'read-translate@1': 'Translate this {language} sentence into natural English. Reply with the translation only.\n\n{sentence}',
  'read-gloss@1': 'A learner of {language} saved the words below while reading. For each word give its dictionary form '
    + '(nouns with their article, verbs in the infinitive with a separable prefix attached) and a short English meaning that fits '
    + 'the sentence (at most 5 words).\n{words}\n'
    + 'Reply with JSON only: [{"n": 1, "lemma": "...", "en": "..."}], one object per word, in order.',
};
