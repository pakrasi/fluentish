/* Script mode: a celebration waiting for the overview. Rehearse sets it after a Good or Easy grade at Cue; the overview
   plays it once (the section's cells land in accent, the numeral rolls) and clears it. In memory only. */

/** @type {{scriptId: string, sectionId: string} | null} */
let pending = null;

/** @param {string} scriptId @param {string} sectionId */
export function celebrate(scriptId, sectionId) { pending = { scriptId, sectionId }; }

/** The pending celebration for this script, taken (it plays once). @param {string} scriptId */
export function take(scriptId) {
  if (!pending || pending.scriptId !== scriptId) return null;
  const p = pending; pending = null;
  return p;
}
