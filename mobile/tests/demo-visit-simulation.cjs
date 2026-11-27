const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');

function load(name) {
  const file = path.join(__dirname, '../src', name + '.js'); const module = { exports: {} };
  const { code } = babel.transformSync(fs.readFileSync(file, 'utf8'), { configFile: false, babelrc: false,
    plugins: [require.resolve('@babel/plugin-transform-modules-commonjs')] });
  vm.runInNewContext(code, { module, exports: module.exports, require: load }, { filename: file });
  return module.exports;
}
const { createDemoTrips } = load('demoTrips');
const { DEMO_VISIT_INTERVAL_MS, nextDemoVisit, isDemoVisitSuppressed } = load('demoVisitSimulation');
const key = 'qwork.demo-trips.v1';
const base = Date.parse('2026-11-27T08:00:00Z');
const iso = offset => new Date(base + offset).toISOString();
const post = (api, role, url, body = {}) => api(role, url, { method: 'POST', body });
const sync = (api, role = 'employee') => post(api, role, '/demo/visits/sync');
const clone = value => JSON.parse(JSON.stringify(value));
function makeTrip(id = 'trip', status = 'planned', count = 3) {
  return { id, status, plannedStart: '2026-12-01T04:00:00Z', plannedEnd: '2026-12-02T13:00:00Z',
    stops: Array.from({ length: count }, (_, index) => ({ id: `${id}-${index}`, destination: `Учебный объект ${index + 1}`,
      visitedAt: null, skippedAt: null, skipReason: null })),
    finance: { revision: 1, transactions: [{ kind: 'advance', amount: 12000 }] },
    receipts: [{ id: 'receipt-1' }], actualExpenses: { revision: 2, expensesTotal: 7000 } };
}
function environment(trips = [makeTrip()]) {
  let value = JSON.stringify({ version: 1, nextId: 10, offers: [], organizations: [], trips,
    documents: [{ id: 'document', revision: 3 }] });
  let time = base; let fail = false; let writes = 0;
  const storage = { getItem: async name => { assert.equal(name, key); return value; },
    setItem: async (name, next) => { assert.equal(name, key); if (fail) throw Error('Quota'); value = next; writes++; } };
  return { read: () => JSON.parse(value), time: offset => { time = base + offset; },
    fail: flag => { fail = flag; }, writes: () => writes,
    reload: () => createDemoTrips(storage, () => new Date(time).toISOString()) };
}

test('starting a trip automatically schedules the first simulated visit after 20 seconds without GPS or opening its report', async () => {
  assert.equal(DEMO_VISIT_INTERVAL_MS, 20000);
  const env = environment(); const api = env.reload();
  await post(api, 'employee', '/trips/trip/start');
  const started = env.read().trips[0];
  assert.equal(started.demoAutoVisit.mode, 'simulation');
  assert.equal(started.demoAutoVisit.startedAt, iso(0));
  assert.equal(nextDemoVisit(started).scheduledAt, iso(20000));
  env.time(19999); assert.equal((await sync(api)).marked, 0);
  env.time(20000); const result = await sync(api);
  assert.equal(result.marked, 1); assert.equal(result.lastVisit.destination, 'Учебный объект 1');
  const stop = env.read().trips[0].stops[0];
  assert.equal(stop.visitedAt, iso(20000)); assert.equal(stop.visitRevision, 1);
  assert.deepEqual(stop.visitEvidence, { method: 'demo_simulation', scheduledAt: iso(20000), recordedAt: iso(20000) });
  assert.equal(stop.visitHistory[0].action, 'demo_auto_visit');
  assert.equal(nextDemoVisit(env.read().trips[0]).stopId, 'trip-1');
});

test('elapsed-time catch-up after suspension/reload preserves simulated event time separately from recording time', async () => {
  const env = environment(); let api = env.reload();
  await post(api, 'employee', '/trips/trip/start');
  env.time(20000); await sync(api);
  // No calls while a browser/phone is asleep; only resume applies the elapsed scenario.
  env.time(3600000); api = env.reload();
  const result = await sync(api, 'manager');
  assert.equal(result.marked, 2); assert.equal(result.lastVisit.stopId, 'trip-2');
  const trip = env.read().trips[0];
  assert.deepEqual(trip.stops.map(stop => stop.visitedAt), [iso(20000), iso(40000), iso(60000)]);
  assert.equal(trip.stops[0].visitEvidence.recordedAt, iso(20000));
  assert.equal(trip.stops[2].visitEvidence.recordedAt, iso(3600000));
  assert.equal(nextDemoVisit(trip), null);
  assert.equal((await sync(api, 'accountant')).changed, false);
});

test('existing active trips initialize from first sync rather than backdating all visits', async () => {
  const active = makeTrip('old', 'active', 2); active.startedAt = iso(-86400000);
  const env = environment([active]); const api = env.reload();
  const first = await sync(api, 'accountant');
  assert.equal(first.changed, true); assert.equal(first.marked, 0);
  assert.equal(env.read().trips[0].demoAutoVisit.startedAt, iso(0));
  env.time(-10000); assert.equal((await sync(api)).marked, 0, 'clock rollback does not mark early');
  env.time(20000); assert.equal((await sync(api)).marked, 1);
});

test('planned/finished trips and financial/documents data are unchanged; ordinary reads never run simulation', async () => {
  const planned = makeTrip('planned'); const finished = makeTrip('done', 'finished');
  const env = environment([planned, finished]); const api = env.reload(); const before = env.read();
  assert.deepEqual(clone(await sync(api)), { changed: false, marked: 0 });
  assert.deepEqual(env.read(), before); assert.equal(env.writes(), 0);
  await post(api, 'employee', '/trips/planned/start');
  env.time(60000); await api('manager', '/trips'); await api('employee', '/trips/planned/report');
  assert.equal(env.read().trips[0].stops[0].visitedAt, null);
  await sync(api);
  const after = env.read();
  assert.deepEqual(after.trips[1], before.trips[1]);
  assert.deepEqual(after.trips[0].finance, before.trips[0].finance);
  assert.deepEqual(after.trips[0].receipts, before.trips[0].receipts);
  assert.deepEqual(after.trips[0].actualExpenses, before.trips[0].actualExpenses);
  assert.deepEqual(after.documents, before.documents);
});

test('manual/GPS/skipped marks are retained and an explicit undo cannot be resurrected by simulation', async () => {
  const trip = makeTrip('trip', 'active', 5); trip.startedAt = iso(-60000);
  trip.stops[0].visitedAt = iso(-50000);
  trip.stops[1].visitedAt = iso(-40000); trip.stops[1].visitEvidence = { method: 'gps', latitude: 50, longitude: 57, accuracy: 10 };
  trip.stops[2].skippedAt = iso(-30000); trip.stops[2].skipReason = 'Закрыто';
  trip.stops[3].visitHistory = [{ action: 'undo', reason: 'Отменено раньше' }];
  const before = clone(trip.stops.slice(0, 4));
  const env = environment([trip]); const api = env.reload(); await sync(api);
  assert.equal(env.read().trips[0].demoAutoVisit.schedule.length, 1);
  env.time(20000); assert.equal((await sync(api)).marked, 1);
  assert.deepEqual(env.read().trips[0].stops.slice(0, 4), before);
  const route = '/trips/trip/stops/trip-4/undo';
  const result = await post(api, 'employee', route, { requestId: 'cancel-demo', expectedRevision: 1, reason: 'Отменить учебную отметку' });
  assert.equal(isDemoVisitSuppressed(result.stop), true);
  assert.equal(result.stop.visitHistory[1].previous.visitEvidence.method, 'demo_simulation');
  env.time(3600000); assert.equal((await sync(env.reload())).marked, 0);
  assert.equal(env.read().trips[0].stops[4].visitedAt, null); assert.equal(nextDemoVisit(env.read().trips[0]), null);
});

test('concurrent sync and retries save one audit event per stop without duplicate writes', async () => {
  const env = environment(); const api = env.reload(); await post(api, 'employee', '/trips/trip/start');
  const beforeWrites = env.writes(); env.time(60000);
  const results = await Promise.all([sync(api), sync(api, 'manager'), sync(api, 'accountant')]);
  assert.deepEqual(results.map(result => result.marked), [3, 0, 0]);
  assert.equal(env.writes(), beforeWrites + 1);
  assert.ok(env.read().trips[0].stops.every(stop => stop.visitHistory.length === 1 && stop.visitRevision === 1));
  assert.equal((await sync(env.reload())).changed, false);
  await assert.rejects(sync(env.reload(), 'unknown'), /роль/);
});

test('a stop skipped during the countdown keeps its explicit reason and is never overwritten at its scheduled time', async () => {
  const env = environment(); const api = env.reload(); await post(api, 'employee', '/trips/trip/start');
  env.time(10000);
  await post(api, 'employee', '/trips/trip/stops/trip-0', {
    requestId: 'skip-before-arrival', expectedRevision: 0, outcome: 'skipped', reason: 'Объект закрыт',
  });
  env.time(20000); assert.equal((await sync(api)).marked, 0);
  const skipped = env.read().trips[0].stops[0];
  assert.equal(skipped.visitedAt, null); assert.equal(skipped.skippedAt, iso(10000));
  assert.equal(skipped.skipReason, 'Объект закрыт'); assert.equal(skipped.visitEvidence, undefined);
  env.time(60000); assert.equal((await sync(api)).marked, 2);
  assert.deepEqual(env.read().trips[0].stops[0], skipped);
});

test('storage failures do not report visits or leak a partial state; retry catches up once', async () => {
  const env = environment([makeTrip('trip', 'active')]); const api = env.reload();
  const original = env.read(); env.fail(true);
  await assert.rejects(sync(api), /сохранить/); assert.deepEqual(env.read(), original);
  env.fail(false); await sync(api); env.time(60000); env.fail(true);
  await assert.rejects(sync(api), /сохранить/);
  assert.ok(env.read().trips[0].stops.every(stop => !stop.visitedAt));
  env.fail(false); assert.equal((await sync(api)).marked, 3);
  assert.ok(env.read().trips[0].stops.every(stop => stop.visitHistory.length === 1));
});
