const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');
const { IDBFactory } = require('fake-indexeddb');

function load(name) {
  const file = path.join(__dirname, '../src', name + '.js');
  const module = { exports: {} };
  const { code } = babel.transformSync(fs.readFileSync(file, 'utf8'), { configFile: false, babelrc: false,
    plugins: [require.resolve('@babel/plugin-transform-modules-commonjs')] });
  vm.runInNewContext(code, { module, exports: module.exports, require: load }, { filename: file });
  return module.exports;
}
const { createDemoTrips } = load('demoTrips');
const { createDemoBrowserStorage } = load('demoBrowserStorage');
const key = 'qwork.demo-trips.v1';
const now = () => '2026-11-27T08:00:00Z';
const post = (api, role, url, body = {}) => api(role, url, { method: 'POST', body });
const receipt = { requestId: 'receipt-before', name: 'Учебный чек', data: 'data:image/png;base64,aGVsbG8=' };
function environment() {
  const values = new Map(); let legacyFull = false;
  const legacy = { getItem: async key => values.get(key) ?? null,
    setItem: async (key, value) => { if (legacyFull) throw new Error('QuotaExceededError'); values.set(key, value); } };
  const factory = new IDBFactory();
  const storage = () => createDemoBrowserStorage(legacy, factory);
  return { values, legacy, factory, storage, full: () => { legacyFull = true; },
    reload: () => createDemoTrips(storage(), now) };
}
async function samples(env) {
  const api = createDemoTrips(env.legacy, now);
  await post(api, 'accountant', '/documents/examples');
  const data = await api('employee', '/documents');
  const trip = data.trips.find(t => t.status === 'finished');
  await post(api, 'employee', `/trips/${trip.id}/receipts`, receipt);
  return trip;
}
async function open(factory) {
  return new Promise((resolve, reject) => {
    const request = factory.open('qwork-demo-v1', 1);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
async function snapshot(factory) {
  const db = await open(factory);
  try { return await new Promise((resolve, reject) => {
    const tx = db.transaction('snapshots'); const request = tx.objectStore('snapshots').get(key);
    tx.oncomplete = () => resolve(request.result); tx.onabort = () => reject(tx.error);
  }); } finally { db.close(); }
}
test('full legacy storage migrates on receipt save without losing trips, money, documents or previous photos', async () => {
  const env = environment(); const trip = await samples(env); const backup = env.values.get(key);
  const previous = JSON.parse(backup); env.full();
  const api = env.reload(); const before = await api('employee', '/documents');
  assert.equal(await snapshot(env.factory), undefined, 'read-only visits do not migrate or overwrite the snapshot');
  const newReceipt = { ...receipt, requestId: 'receipt-after', name: 'Новый учебный чек' };
  const saved = await post(api, 'employee', `/trips/${trip.id}/receipts`, newReceipt);
  assert.equal(saved.trip.receipts.length, 2);
  assert.equal(env.values.get(key), backup, 'old localStorage backup is untouched');
  const reloaded = env.reload(); const current = await reloaded('accountant', `/trips/${trip.id}/report`);
  assert.equal(current.trip.receipts[0].data, receipt.data);
  assert.equal(current.trip.receipts[1].name, newReceipt.name);
  assert.equal(current.trip.finance.advanceTotal, 40000);
  const after = await reloaded('employee', '/documents');
  assert.equal(JSON.stringify(after.documents), JSON.stringify(before.documents));
  const stored = JSON.parse((await snapshot(env.factory)).value);
  for (const field of ['offers', 'organizations', 'accountingContracts', 'documents']) {
    assert.deepEqual(stored[field], previous[field], field + ' must survive migration unchanged');
  }
  assert.equal(stored.trips.length, previous.trips.length);
  const retry = await post(reloaded, 'employee', `/trips/${trip.id}/receipts`, newReceipt);
  assert.equal(retry.trip.receipts.length, 2, 'a retry after successful commit adds no duplicate');
});
test('aborted IndexedDB receipt write leaves the entire prior snapshot intact and can be retried', async () => {
  const env = environment(); const trip = await samples(env); const api = env.reload();
  await post(api, 'employee', `/trips/${trip.id}/receipts`, { ...receipt, requestId: 'migration' });
  const original = await snapshot(env.factory);
  const db = await open(env.factory);
  const probe = db.transaction('snapshots');
  const prototype = Object.getPrototypeOf(probe.objectStore('snapshots'));
  const put = prototype.put;
  try {
    prototype.put = function (...args) {
      if (this.name === 'snapshots') throw new Error('QuotaExceededError');
      return put.apply(this, args);
    };
    await assert.rejects(post(api, 'employee', `/trips/${trip.id}/receipts`, { ...receipt, requestId: 'retry' }), /сохранить/);
  } finally { prototype.put = put; db.close(); }
  assert.deepEqual(await snapshot(env.factory), original);
  const next = await post(env.reload(), 'employee', `/trips/${trip.id}/receipts`, { ...receipt, requestId: 'retry' });
  assert.equal(next.trip.receipts.length, 3);
  assert.equal(next.trip.finance.advanceTotal, 40000);
});
test('two tabs cannot overwrite a newer snapshot; refreshing preserves both changes', async () => {
  const env = environment(); env.values.set(key, 'old');
  const first = env.storage(); const second = env.storage();
  assert.equal(await first.getItem(key), 'old'); assert.equal(await second.getItem(key), 'old');
  await first.setItem(key, 'first edit');
  await assert.rejects(second.setItem(key, 'stale edit'), /другой вкладке/);
  assert.equal(await second.getItem(key), 'first edit');
  await second.setItem(key, 'first edit + second edit');
  assert.equal(await env.storage().getItem(key), 'first edit + second edit');
  assert.equal(env.values.get(key), 'old');
});
test('first migration detects legacy changes and corrupt legacy is never replaced with an empty demo', async () => {
  const env = environment(); env.values.set(key, 'old'); const storage = env.storage();
  await storage.getItem(key); env.values.set(key, 'new from older tab');
  await assert.rejects(storage.setItem(key, 'stale'), /другой вкладке/);
  assert.equal(await snapshot(env.factory), undefined);
  env.values.set(key, '{broken');
  await assert.rejects(post(env.reload(), 'accountant', '/documents/examples'), /прочитать/);
  assert.equal(env.values.get(key), '{broken'); assert.equal(await snapshot(env.factory), undefined);
});
test('unavailable IndexedDB gives an actionable error without altering legacy data', async () => {
  const env = environment(); await samples(env); const original = env.values.get(key);
  const api = createDemoTrips(createDemoBrowserStorage(env.legacy, null), now);
  await assert.rejects(api('employee', '/trips'), /Разрешите сайту/);
  assert.equal(env.values.get(key), original);
});
