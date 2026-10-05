/* Exam, once the app has started: a Sprechen take cut off by a reload or a killed page is kept as a recording
   (data.js recoverTake). main.js runs this through the registry (startFeatures), so core never imports the exam. */

/** @param {{store: any, bus: any, t: (k: string, v?: any) => string, toast: (text: string) => void, log: (where: string, e: unknown) => void}} app */
export async function start({ store, bus, t, toast, log }) {
  if (!store.get('exams.takeInProgress')) return;
  try {
    const { recoverTake } = await import('./data.js');
    const info = await recoverTake({ store, bus });
    if (info) toast(t('exam.rec.recovered'));
  } catch (e) { log('take', e); }
}
