/* Prompt templates for services/claude.js callers (round 4, C0). Every template is PUBLIC: it describes the task and
   the output format and says nothing about any learner. What a learner chose (level, topic, interests) fills its
   {slots} at run time through fill(); nothing personal is ever written in these files.

   One file per feature: services/prompts/<feature>.js (read.js, conversation.js …) exports
     TEMPLATES   { '<name>@<n>': text }   every template of the feature, keyed by its versioned id
   A template's text is hash-pinned in tests/unit/prompt-pins.test.mjs (PINS, one block per file): changing a text
   means a new version (<name>@<n+1>) and its pin, so every stored output says which prompt wrote it. Pure. */

/** A versioned template id: 'read-gloss@1'. */
export const TEMPLATE_ID = /^[a-z][a-z0-9-]*@\d+$/;

/**
 * A template with its {slot}s filled. Every slot in the template needs a value (a missing one throws, so a prompt
 * never goes out with a hole in it); values are written as text. Slot names: letters, digits, '_' and '.'.
 * @param {string} template @param {Record<string, string | number>} vars @returns {string}
 */
export function fill(template, vars) {
  return String(template).replace(/\{([A-Za-z][A-Za-z0-9_.]*)\}/g, (_, k) => {
    if (!Object.prototype.hasOwnProperty.call(vars || {}, k)) throw new Error(`prompt: no value for {${k}}`);
    return String(vars[k]);
  });
}
