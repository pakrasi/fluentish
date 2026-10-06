/* Reading, once the app has started: the words of phrases he marked before round 4's privacy fix move from read.words
   (backed up) to device-only read.ctx, keeping their card ids (features/shared/read-data.js migratePhrases). Again
   whenever read.words changes (a restore can bring an old entry back). main.js runs this through the registry
   (startFeatures), so core never imports a feature. */
import { migratePhrases, WORDS } from '../shared/read-data.js';

/** @param {{store: any, log: (where: string, e: unknown) => void}} app */
export async function start({ store, log }) {
  const run = () => { try { migratePhrases(store); } catch (e) { log('read migrate', e); } };
  run();
  store.subscribe(WORDS, run);
}
