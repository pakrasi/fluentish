// The adapter conformance suite (arch F7): one set of checks every storage adapter must pass (see the interface in
// src/data/store.js). adapter-contract.test.mjs runs it on adapters/memory.js and on adapters/idb.js over
// fake-indexeddb; a SQLite or server adapter later runs the same suite. Each check asks one question about the
// learner's data: is it still there, is it only where it belongs, and is it gone only when it should be.
// All data is synthetic.
//
// A harness is { label, create() }, and create() returns a fresh, empty storage:
//   { open(): Promise<adapter>   a new adapter over the same storage (a page reload, or a second tab),
//     drop?(adapter, how)        lose the connection the way iOS does ('event': the close event fires;
//                                'silent': the connection is closed and the adapter only finds out on its next call) }
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store, DEVICE_SCOPE } from '../../src/data/store.js';

// Profile ids chosen so a sloppy key range leaks: one is a prefix of another, and one sorts between them.
export const A = '0192a3b4-c5d6-7e8f-9a0b-00000000000a';
export const A2 = `${A}0`;        // A is a prefix of A2
export const B = '0192a3b4-c5d6-7e8f-9a0b-00000000000b';

const card = (/** @type {number} */ n) => ({ due: `2026-11-${String(10 + (n % 18)).padStart(2, '0')}`, stability: 1.5 + n, difficulty: 5, reps: n, lapses: 0, state: 2, last: '2026-10-01' });
const event = (/** @type {string} */ p, /** @type {number} */ n, extra = {}) => ({
  id: `0192a3b4-c5d6-7e8f-9a0b-${String(n).padStart(12, '0')}`, v: 1, profileId: p, deviceId: 'dev-test', seq: n,
  at: '2026-10-01T09:00:00.000+02:00', day: '2026-10-01', type: 'review', payload: { deck: 'de-b1', id: `W:wort${n}`, grade: 3 },
  synced: false, path: null, ...extra,
});
const attempt = (/** @type {string} */ id, extra = {}) => ({ id, exam: 'goethe-b1', module: 'lesen', at: '2026-10-01T10:00:00.000+02:00', score: 18, max: 30, ...extra });
const bytes = async (/** @type {Blob} */ b) => new Uint8Array(await b.arrayBuffer());
const ids = (/** @type {any[]} */ list) => list.map(x => x.id).sort();

/** Put the same shape of data in profiles A, A2 and B, and some device-scope keys. @param {any} ad */
async function fill(ad) {
  for (const p of [A, A2, B]) {
    await ad.putProfile({ id: p, name: '', kind: 'local' });
    await ad.putKV(p, 'settings', { goal: 'b1', who: p });
    await ad.putKV(p, 'activity', { '2026-10-01': { minutes: 20 } });
    await ad.putCards(p, 'de-b1', [['W:Haus', { ...card(1), who: p }], ['F:gehen', card(2)]]);
    await ad.putCards(p, 'de-b1:read', [['W:Haus', card(3)]]);
    await ad.putAttempts(p, [attempt('att-1', { who: p })]);
    await ad.putEvents(p, [event(p, 1), event(p, 2), event(p, 3)]);
    await ad.archiveEvents(p, [event(p, 1)]);
  }
  await ad.putKV('device', 'prefs', { theme: 'dark' });
  await ad.putKV('device', 'secrets', { anthropicKey: 'placeholder' });
  await ad.putDevice({ deviceId: 'dev-test', activeProfile: A, seq: 3 });
}

/** @param {{label: string, create: () => Promise<{open: () => Promise<any>, drop?: (ad: any, how: 'event' | 'silent') => void}>}} harness */
export function adapterContract({ label, create }) {
  /** @param {string} name @param {any} a @param {any} [b] options then fn, or fn alone */
  const T = (name, a, b) => (typeof a === 'function' ? test(`${label}: ${name}`, a) : test(`${label}: ${name}`, a, b));
  const fresh = async () => { const s = await create(); return { s, ad: await s.open() }; };

  T('an empty storage reads as empty, not as an error', async () => {
    const { ad } = await fresh();
    assert.equal(await ad.getDevice(), null);
    assert.deepEqual(await ad.listProfiles(), []);
    assert.deepEqual(await ad.loadScope(A), {});
    assert.deepEqual(await ad.loadScope('device'), {});
    assert.deepEqual(await ad.loadProfile(A), { cards: {}, attempts: [], outbox: [] });
    assert.deepEqual(await ad.loadArchive(A), []);
    assert.equal(await ad.getBlob('nothing'), null);
    const est = await ad.estimate();
    assert.ok(est === null || typeof est === 'object');
  });

  T('device record and profiles round-trip; putProfile replaces by id', async () => {
    const { ad } = await fresh();
    await ad.putDevice({ deviceId: 'd1', activeProfile: A, seq: 41, previousDeviceIds: ['d0'] });
    assert.deepEqual(await ad.getDevice(), { deviceId: 'd1', activeProfile: A, seq: 41, previousDeviceIds: ['d0'] });
    await ad.putProfile({ id: A, name: 'one', kind: 'local' });
    await ad.putProfile({ id: B, name: 'two', kind: 'local' });
    await ad.putProfile({ id: A, name: 'one renamed', kind: 'local', extra: 1 });
    const list = (await ad.listProfiles()).sort((/** @type {any} */ x, /** @type {any} */ y) => x.id.localeCompare(y.id));
    assert.deepEqual(list, [{ id: A, name: 'one renamed', kind: 'local', extra: 1 }, { id: B, name: 'two', kind: 'local' }]);
  });

  T('key-value: each scope reads only its own keys, even when one profile id is a prefix of another', async () => {
    const { ad } = await fresh();
    await fill(ad);
    assert.deepEqual(await ad.loadScope(A), { settings: { goal: 'b1', who: A }, activity: { '2026-10-01': { minutes: 20 } } });
    assert.deepEqual((await ad.loadScope(A2)).settings, { goal: 'b1', who: A2 });
    assert.deepEqual(await ad.loadScope('device'), { prefs: { theme: 'dark' }, secrets: { anthropicKey: 'placeholder' } });
    assert.deepEqual(await ad.loadScope('devic'), {});
    assert.deepEqual(await ad.loadScope(A.slice(0, -1)), {}, 'a prefix of an id is not that profile');
  });

  T('putKV(undefined) deletes that key only; null, false, 0 and empty values are kept', async () => {
    const { ad } = await fresh();
    await fill(ad);
    for (const [k, v] of /** @type {[string, any][]} */ ([['n', null], ['f', false], ['z', 0], ['s', ''], ['a', []], ['o', {}]])) await ad.putKV(A, k, v);
    await ad.putKV(A, 'activity', undefined);
    const got = await ad.loadScope(A);
    assert.equal('activity' in got, false);
    assert.deepEqual(got, { settings: { goal: 'b1', who: A }, n: null, f: false, z: 0, s: '', a: [], o: {} });
    assert.ok('activity' in await ad.loadScope(A2), 'the same name in another profile is untouched');
    assert.ok('activity' in await ad.loadScope(B));
    await ad.putKV(A, 'never-written', undefined);   // deleting a missing key is not an error
    await ad.putKV('device', 'secrets', undefined);
    assert.deepEqual(await ad.loadScope('device'), { prefs: { theme: 'dark' } });
  });

  T('values are copies: changing an object after a write or after a read does not change what is stored', async () => {
    const { ad } = await fresh();
    const v = { list: [1, 2], nested: { a: 1 } };
    await ad.putKV(A, 'ui', v);
    const rec = card(1);
    await ad.putCards(A, 'de-b1', [['W:Haus', rec]]);
    const e = event(A, 1);
    await ad.putEvents(A, [e]);
    v.list.push(3); v.nested.a = 2; rec.reps = 99; e.payload.grade = 1;
    const got = await ad.loadScope(A);
    assert.deepEqual(got.ui, { list: [1, 2], nested: { a: 1 } });
    got.ui.list.push(4);
    const data = await ad.loadProfile(A);
    assert.equal(data.cards['de-b1']['W:Haus'].reps, 1);
    assert.equal(data.outbox[0].payload.grade, 3);
    data.cards['de-b1']['W:Haus'].reps = 50;
    assert.deepEqual((await ad.loadScope(A)).ui, { list: [1, 2], nested: { a: 1 } });
    assert.equal((await ad.loadProfile(A)).cards['de-b1']['W:Haus'].reps, 1);
  });

  T('cards: grouped by deck, scoped by profile; a null record deletes one card and nothing else', async () => {
    const { ad } = await fresh();
    await fill(ad);
    const a = await ad.loadProfile(A);
    assert.deepEqual(Object.keys(a.cards).sort(), ['de-b1', 'de-b1:read']);
    assert.deepEqual(Object.keys(a.cards['de-b1']).sort(), ['F:gehen', 'W:Haus']);
    assert.equal(a.cards['de-b1']['W:Haus'].who, A);
    assert.equal((await ad.loadProfile(A2)).cards['de-b1']['W:Haus'].who, A2);
    await ad.putCards(A, 'de-b1', [['W:Haus', null], ['F:gehen', { ...card(2), reps: 7 }], ['BW:neu', card(4)]]);
    const after = await ad.loadProfile(A);
    assert.deepEqual(Object.keys(after.cards['de-b1']).sort(), ['BW:neu', 'F:gehen']);
    assert.equal(after.cards['de-b1']['F:gehen'].reps, 7);
    assert.deepEqual(after.cards['de-b1:read'], { 'W:Haus': card(3) }, 'the same id in another deck is untouched');
    assert.equal((await ad.loadProfile(A2)).cards['de-b1']['W:Haus'].who, A2, 'the same id in another profile is untouched');
    await ad.putCards(A, 'de-b1', [['W:never-there', null]]);   // deleting a missing card is not an error
  });

  T('attempts and outbox events: replaced by id, scoped by profile', async () => {
    const { ad } = await fresh();
    await fill(ad);
    await ad.putAttempts(A, [attempt('att-1', { score: 25 }), attempt('att-2')]);
    await ad.putEvents(A, [{ ...event(A, 2), synced: true }, event(A, 4)]);
    const a = await ad.loadProfile(A);
    assert.deepEqual(ids(a.attempts), ['att-1', 'att-2']);
    assert.equal(a.attempts.find((/** @type {any} */ x) => x.id === 'att-1').score, 25);
    assert.deepEqual(ids(a.outbox), [event(A, 2).id, event(A, 3).id, event(A, 4).id]);
    assert.equal(a.outbox.find((/** @type {any} */ x) => x.id === event(A, 2).id).synced, true);
    const b = await ad.loadProfile(B);
    assert.equal(b.attempts[0].score, 18);
    assert.equal(b.attempts[0].who, B);
    assert.deepEqual(ids(b.outbox), [event(B, 2).id, event(B, 3).id]);
  });

  T('archiveEvents moves the listed events from the outbox to the archive, and only that profile\'s', async () => {
    const { ad } = await fresh();
    await fill(ad);
    assert.deepEqual(ids(await ad.loadArchive(A)), [event(A, 1).id]);
    await ad.archiveEvents(A, [event(A, 2)]);
    assert.deepEqual(ids((await ad.loadProfile(A)).outbox), [event(A, 3).id]);
    assert.deepEqual(ids(await ad.loadArchive(A)), [event(A, 1).id, event(A, 2).id]);
    // B and A2 hold events with the same ids: untouched
    for (const p of [A2, B]) {
      assert.deepEqual(ids((await ad.loadProfile(p)).outbox), [event(p, 2).id, event(p, 3).id]);
      assert.deepEqual(ids(await ad.loadArchive(p)), [event(p, 1).id]);
    }
    // archiving again, or archiving an event that is not in the outbox, loses nothing
    await ad.archiveEvents(A, [event(A, 2)]);
    assert.deepEqual(ids(await ad.loadArchive(A)), [event(A, 1).id, event(A, 2).id]);
    assert.deepEqual(ids((await ad.loadProfile(A)).outbox), [event(A, 3).id]);
    assert.deepEqual((await ad.loadArchive(A)).find((/** @type {any} */ e) => e.id === event(A, 2).id), event(A, 2), 'the archived copy is the whole event');
  });

  T('bulk reads (lane P2): hundreds of records each come back under their own key, none lost, none from a neighbour', async () => {
    const { ad } = await fresh();
    await fill(ad);
    // written in a shuffled order, with ids whose key order differs from the write order; each value names its key
    const n = 240, order = Array.from({ length: n }, (_, i) => (i * 97) % n);
    const decks = ['de-b1', 'de-b1:read', 'fr:a1'];
    for (const p of [A, B]) {
      for (const i of order) await ad.putKV(p, `bulk.${String(i).padStart(3, '0')}`, { p, i });
      for (const d of decks) await ad.putCards(p, d, order.map(i => [`W:w${i}`, { ...card(i), p, d, i }]));
      await ad.putEvents(p, order.map(i => event(p, 1000 + i, { p, i })));
      await ad.archiveEvents(p, order.filter(i => i % 3 === 0).map(i => event(p, 1000 + i, { p, i })));
    }
    for (const p of [A, B]) {
      const kv = await ad.loadScope(p);
      for (let i = 0; i < n; i++) assert.deepEqual(kv[`bulk.${String(i).padStart(3, '0')}`], { p, i });
      assert.equal(Object.keys(kv).length, n + 2, 'the bulk keys and fill()\'s two');
      const prof = await ad.loadProfile(p);
      for (const d of decks) {
        const recs = prof.cards[d];
        assert.equal(Object.keys(recs).filter(k => k.startsWith('W:w')).length, n, `${d}: every card`);
        for (let i = 0; i < n; i++) assert.deepEqual([recs[`W:w${i}`].p, recs[`W:w${i}`].d, recs[`W:w${i}`].i], [p, d, i], `${d} W:w${i}`);
      }
      const out = prof.outbox.filter((/** @type {any} */ e) => e.seq >= 1000), arch = (await ad.loadArchive(p)).filter((/** @type {any} */ e) => e.seq >= 1000);
      assert.deepEqual(out.map((/** @type {any} */ e) => e.i).sort((x, y) => x - y), order.filter(i => i % 3).sort((x, y) => x - y));
      assert.deepEqual(arch.map((/** @type {any} */ e) => e.i).sort((x, y) => x - y), order.filter(i => i % 3 === 0).sort((x, y) => x - y));
      for (const e of [...out, ...arch]) assert.equal(e.id, event(p, 1000 + e.i).id, 'each event is the one its key names');
    }
  });

  T('archiveEvents that fails part-way leaves every event in exactly one place (outbox or archive), never neither', async () => {
    const { ad } = await fresh();
    await ad.putEvents(A, [event(A, 1), event(A, 2), event(A, 3)]);
    // the second event cannot be stored (a function is not cloneable): the call must fail
    const bad = { ...event(A, 2), payload: { fn: () => 1 } };
    await assert.rejects(() => ad.archiveEvents(A, [event(A, 1), bad, event(A, 3)]));
    const outbox = ids((await ad.loadProfile(A)).outbox);
    const archive = ids(await ad.loadArchive(A));
    for (const n of [1, 2, 3]) {
      const id = event(A, n).id;
      assert.equal(Number(outbox.includes(id)) + Number(archive.includes(id)), 1, `event ${n} is in exactly one store (outbox ${outbox.includes(id)}, archive ${archive.includes(id)})`);
    }
    assert.ok(outbox.includes(event(A, 2).id) && outbox.includes(event(A, 3).id), 'the failed event and those after it stay in the outbox');
  });

  T('deleteProfile removes that profile everywhere and leaves other profiles and the device scope alone', async () => {
    const { s, ad } = await fresh();
    await fill(ad);
    await ad.putBlob('rec-b', new Blob([new Uint8Array([9, 9])], { type: 'audio/mp4' }));
    await ad.deleteProfile(A);
    for (const reader of [ad, await s.open()]) {   // and after a reload
      assert.deepEqual(ids(await reader.listProfiles()), [A2, B].sort());
      assert.deepEqual(await reader.loadScope(A), {});
      assert.deepEqual(await reader.loadProfile(A), { cards: {}, attempts: [], outbox: [] });
      assert.deepEqual(await reader.loadArchive(A), []);
      for (const p of [A2, B]) {
        const d = await reader.loadProfile(p);
        assert.equal(d.cards['de-b1']['W:Haus'].who, p);
        assert.deepEqual(Object.keys(d.cards).sort(), ['de-b1', 'de-b1:read']);
        assert.equal(d.attempts.length, 1);
        assert.equal(d.outbox.length, 2);
        assert.equal((await reader.loadArchive(p)).length, 1);
        assert.equal((await reader.loadScope(p)).settings.who, p);
      }
      assert.deepEqual(Object.keys(await reader.loadScope('device')).sort(), ['prefs', 'secrets']);
      assert.deepEqual(await reader.getDevice(), { deviceId: 'dev-test', activeProfile: A, seq: 3 });
      assert.deepEqual([...await bytes(/** @type {Blob} */ (await reader.getBlob('rec-b')))], [9, 9]);
    }
    await ad.deleteProfile('no-such-profile');   // not an error
  });

  T('deleteProfile also removes that profile\'s recordings (blobs)', {
    todo: 'arch F12: the blobs store is keyed by id only, so deleteProfile cannot find a profile\'s recordings; ' +
      'session.js dropProfileData deletes only the ones the outbox still names. Fix: prefix new blob ids with <profileId>: ' +
      'and have deleteProfile drop that range (keep reading old ids).',
  }, async () => {
    const { ad } = await fresh();
    await ad.putProfile({ id: A, name: '', kind: 'local' });
    await ad.putBlob(`${A}:take:1`, new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mp4' }));
    await ad.putBlob(`${B}:take:1`, new Blob([new Uint8Array([4])], { type: 'audio/mp4' }));
    await ad.deleteProfile(A);
    assert.equal(await ad.getBlob(`${A}:take:1`), null, 'profile A\'s recording is gone');
    assert.notEqual(await ad.getBlob(`${B}:take:1`), null, 'profile B\'s recording stays');
  });

  T('blobs: bytes and type round-trip exactly; overwrite and delete act on one id', async () => {
    const { s, ad } = await fresh();
    const all = new Uint8Array(256).map((_, i) => i);
    const big = new Uint8Array(1 << 20).map((_, i) => (i * 31) & 255);
    await ad.putBlob('voice:1', new Blob([all], { type: 'audio/webm;codecs=opus' }));
    await ad.putBlob('take:2', new Blob([big], { type: 'audio/mp4' }));
    await ad.putBlob('untyped', new Blob([new Uint8Array([7])]));
    for (const reader of [ad, await s.open()]) {
      const one = /** @type {Blob} */ (await reader.getBlob('voice:1'));
      assert.ok(one instanceof Blob);
      assert.equal(one.type, 'audio/webm;codecs=opus');
      assert.deepEqual(await bytes(one), all);
      const two = /** @type {Blob} */ (await reader.getBlob('take:2'));
      assert.equal(two.size, big.length);
      assert.deepEqual(await bytes(two), big);
      // a blob without a type keeps its bytes (idb reads it back as application/octet-stream, memory as '')
      assert.deepEqual([...await bytes(/** @type {Blob} */ (await reader.getBlob('untyped')))], [7]);
    }
    await ad.putBlob('voice:1', new Blob([new Uint8Array([5])], { type: 'audio/mp4' }));
    assert.deepEqual([...await bytes(/** @type {Blob} */ (await ad.getBlob('voice:1')))], [5]);
    await ad.deleteBlob('voice:1');
    assert.equal(await ad.getBlob('voice:1'), null);
    assert.equal((/** @type {Blob} */ (await ad.getBlob('take:2'))).size, big.length);
    await ad.deleteBlob('voice:1');   // deleting twice is not an error
  });

  T('everything written is there after a reload, and a second tab sees it', async () => {
    const { s, ad } = await fresh();
    await fill(ad);
    const before = { scope: await ad.loadScope(A), data: await ad.loadProfile(A), archive: await ad.loadArchive(A), device: await ad.getDevice(), dev: await ad.loadScope('device') };
    ad.close();
    const again = await s.open();
    const tab2 = await s.open();
    for (const r of [again, tab2]) {
      assert.deepEqual(await r.loadScope(A), before.scope);
      const data = await r.loadProfile(A);
      assert.deepEqual(data.cards, before.data.cards);
      assert.deepEqual(ids(data.attempts), ids(before.data.attempts));
      assert.deepEqual(ids(data.outbox), ids(before.data.outbox));
      assert.deepEqual(await r.loadArchive(A), before.archive);
      assert.deepEqual(await r.getDevice(), before.device);
      assert.deepEqual(await r.loadScope('device'), before.dev);
    }
    await tab2.putCards(A, 'de-b1', [['W:Tab', card(5)]]);
    assert.deepEqual((await again.loadProfile(A)).cards['de-b1']['W:Tab'], card(5));
  });

  T('many writes started together all land (an answer per card, not awaited one by one)', async () => {
    const { s, ad } = await fresh();
    const N = 120;
    await Promise.all(Array.from({ length: N }, (_, i) => [
      ad.putCards(A, 'de-b1', [[`W:w${i}`, card(i)]]),
      ad.putEvents(A, [event(A, i + 1)]),
      ad.putKV(A, `k${i % 7}`, i),
    ]).flat());
    const data = await (await s.open()).loadProfile(A);
    assert.equal(Object.keys(data.cards['de-b1']).length, N);
    assert.equal(data.outbox.length, N);
    assert.equal(Object.keys(await ad.loadScope(A)).length, 7);
  });

  T('the connection is lost (close event, or closed under it): the next calls reopen it and nothing written before or after is lost', async t => {
    const s = await create();
    if (!s.drop) return t.skip('this adapter has no connection');
    for (const how of /** @type {const} */ (['event', 'silent'])) {
      const ad = await s.open();
      const P = `${A}-${how}`;
      await ad.putCards(P, 'de-b1', [['W:before', card(1)]]);
      await ad.putEvents(P, [event(P, 1)]);
      s.drop(ad, how);
      await ad.putCards(P, 'de-b1', [['W:after', card(2)]]);   // a write is the first call after the loss
      s.drop(ad, how);
      const data = await ad.loadProfile(P);                      // and a read
      assert.deepEqual(Object.keys(data.cards['de-b1']).sort(), ['W:after', 'W:before'], how);
      assert.equal(data.outbox.length, 1, how);
      s.drop(ad, how);
      await ad.archiveEvents(P, [event(P, 1)]);                   // and the two-store move
      assert.deepEqual(ids(await (await s.open()).loadArchive(P)), [event(P, 1).id], how);
      s.drop(ad, how);
      await ad.putBlob(`${how}:blob`, new Blob([new Uint8Array([3])], { type: 'audio/mp4' }));
      assert.deepEqual([...await bytes(/** @type {Blob} */ (await ad.getBlob(`${how}:blob`)))], [3], how);
    }
  });

  T('Store over this adapter: a study session written through the store is all there after flush and a reload', async () => {
    const s = await create();
    const ad = await s.open();
    const clock = { today: () => '2026-10-01' };
    const device = { deviceId: 'dev-test', seq: 0 };
    const store = await Store.open({ adapter: ad, profile: { id: A, name: '', kind: 'local' }, device, clock });
    store.set('settings', { goal: 'b1' });          // debounced
    store.set('activity', { '2026-10-01': { minutes: 12 } });   // debounced
    store.set('prefs', { theme: 'dark' });          // debounced, device scope
    store.set('meta', { importedFrom: 'test' });    // written at once
    store.putCards('de-b1', [['W:Haus', card(1)], ['F:gehen', card(2)]]);
    store.putCards('de-b1', [['F:gehen', null]]);
    store.putAttempts([attempt('att-1')]);
    const e1 = store.append('review', { deck: 'de-b1', id: 'W:Haus', grade: 3 });
    const e2 = store.append('review', { deck: 'de-b1', id: 'W:Haus', grade: 4 });
    store.markSynced([e1.id]);
    await store.flush();
    await store.archive([store.events.get(e1.id)]);
    store.close();

    const ad2 = await s.open();
    const again = await Store.open({ adapter: ad2, profile: { id: A, name: '', kind: 'local' }, device: { deviceId: 'dev-test', seq: 0 }, clock });
    assert.deepEqual(again.get('settings'), { goal: 'b1' });
    assert.deepEqual(again.get('activity'), { '2026-10-01': { minutes: 12 } });
    assert.deepEqual(again.get('prefs'), { theme: 'dark' });
    assert.deepEqual(again.get('meta'), { importedFrom: 'test' });
    assert.deepEqual(again.cards('de-b1'), { 'W:Haus': card(1) });
    assert.deepEqual(ids(again.attempts()), ['att-1']);
    assert.deepEqual([...again.events.keys()], [e2.id]);
    assert.deepEqual(ids(await again.archived()), [e1.id]);
    assert.equal((await again.archived())[0].synced, true);
    assert.equal((await ad2.getDevice()).seq, 2, 'the event counter is stored with the events');
    // device-scope collections go to the device, the rest to the profile
    assert.deepEqual(Object.keys(await ad2.loadScope('device')), ['prefs']);
    assert.deepEqual(Object.keys(await ad2.loadScope(A)).sort(), ['activity', 'meta', 'settings']);
    // a second profile on this device sees the device's prefs, and none of the first profile's data
    const other = await Store.open({ adapter: ad2, profile: { id: B, name: '', kind: 'local' }, device: { deviceId: 'dev-test', seq: 2 }, clock });
    assert.deepEqual(other.get('prefs'), { theme: 'dark' });
    assert.equal(other.get('settings'), undefined);
    assert.deepEqual(other.cards('de-b1'), {});
    assert.equal(other.events.size, 0);
    assert.ok(DEVICE_SCOPE.has('prefs') && !DEVICE_SCOPE.has('settings'));
  });
}
