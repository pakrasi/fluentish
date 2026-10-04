// The runway's days across the DST changes of 2026 (Europe 25 Oct, North America 1 Nov). npm run test:tz runs this in
// New York, Berlin and Kolkata.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runwayDays, daysBetween } from '../../src/domain/runway.js';

const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

for (const [today, exam] of [['2026-10-20', '2026-10-28'], ['2026-10-29', '2026-11-05'], ['2026-03-25', '2026-04-02'], ['2026-03-05', '2026-03-12']]) {
  test(`runway ${today} → ${exam}: one column per calendar day, all at midnight, the exam last`, () => {
    const [y, m, d] = today.split('-').map(Number), [Y, M, D] = exam.split('-').map(Number);
    const days = runwayDays(new Date(y, m - 1, d, 15, 30), new Date(Y, M - 1, D, 9), 2);
    const n = daysBetween(new Date(y, m - 1, d), new Date(Y, M - 1, D));
    assert.equal(days.length, n + 3);
    for (const x of days) assert.equal(x.getHours(), 0, `${x} is not midnight`);
    assert.equal(ymd(days.at(-1)), exam, 'the exam column is there');
    for (let i = 1; i < days.length; i++) assert.equal(daysBetween(days[i - 1], days[i]), 1);
  });
}
