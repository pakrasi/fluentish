/* Saving a file the app made (a backup, a Sprechen take), behind one interface (Arch #8), so the iOS shell can use the
   native share sheet with setShare() and the callers stay as they are.

     await shareFile(blob, name)  → 'shared' | 'cancelled' | 'downloaded'

   The web version: on a touch device that can share files (Safari on iPhone and iPad, Chrome on Android) the share
   sheet opens, which is how a phone saves to Files or sends a file on; anywhere else, and when sharing fails, the file
   downloads. Call it from the tap: the share sheet opens only inside a user gesture. Closing the sheet is not a
   failure and downloads nothing. */

/** @typedef {'shared' | 'cancelled' | 'downloaded'} ShareResult */

/** Download a Blob through a hidden link (no markup). @param {Blob} blob @param {string} name */
export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.hidden = true;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}
/** @typedef {{ shareFile: (blob: Blob, name: string) => Promise<ShareResult> }} Share */

/**
 * @param {{ nav?: any, coarse?: () => boolean, save?: (blob: Blob, name: string) => void }} [o] injectable for tests
 * @returns {Share}
 */
export function webShare({
  nav = typeof navigator !== 'undefined' ? navigator : null,
  coarse = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
  save = download,
} = {}) {
  return {
    async shareFile(blob, name) {
      /** @type {File | null} */ let file = null;
      try { file = typeof File === 'function' ? new File([blob], name, { type: blob.type || 'application/octet-stream' }) : null; } catch { file = null; }
      const canShare = !!(file && nav && typeof nav.share === 'function' && typeof nav.canShare === 'function' && coarse());
      if (canShare) {
        let ok = false;
        try { ok = !!nav.canShare({ files: [file] }); } catch { ok = false; }
        if (ok) {
          try { await nav.share({ files: [file] }); return 'shared'; }
          catch (e) { if (/** @type {any} */ (e)?.name === 'AbortError') return 'cancelled'; }
        }
      }
      save(blob, name);
      return 'downloaded';
    },
  };
}

/** @type {Share | null} */ let impl = null;
/** For the iOS shell and tests (null: the web one again). @param {Share | null} s */
export function setShare(s) { impl = s; }
/** Save or share a file. @param {Blob} blob @param {string} name */
export const shareFile = (blob, name) => (impl || (impl = webShare())).shareFile(blob, name);
