// The card-id ledger (tools/shipped-ids.mjs): an id that content has shipped must still be created by the content, or
// be listed in tests/fixtures/retired-ids.txt. A learner's card is keyed by that id; if it disappears, the card is
// orphaned and its schedule lost without a sound.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentIds, readList, LEDGER, RETIRED } from '../../tools/shipped-ids.mjs';

test('every shipped card id is still created by the content (append-only ledger)', async () => {
  const cur = await currentIds();
  const shipped = readList(LEDGER), retired = new Set(readList(RETIRED));
  assert.ok(shipped.length > 6000, `ledger has ${shipped.length} ids`);
  assert.equal(new Set(shipped).size, shipped.length, 'the ledger lists each id once');
  const gone = shipped.filter(id => !cur.has(id) && !retired.has(id));
  assert.deepEqual(gone, [], 'shipped ids that disappeared: keep them, or retire them in tests/fixtures/retired-ids.txt after migrating their cards');
});

test('the ledger knows every id the content creates now (run node tools/shipped-ids.mjs --write)', async () => {
  const have = new Set(readList(LEDGER));
  const missing = [...await currentIds()].filter(id => !have.has(id));
  assert.deepEqual(missing.slice(0, 20), [], `${missing.length} new ids not in the ledger`);
});
