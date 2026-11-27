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
  vm.runInNewContext(code, { module, exports: module.exports, require: load }, { filename: file }); return module.exports;
}
const { createDemoTrips } = load('demoTrips');
const { advanceVisitWindow, validateVisitEvidence, visitCandidate, tripVisitPeriodError } = load('tripVisitRules');
const location = { latitude: 50.2839, longitude: 57.167, radius: 150, revision: 1 };
const start = Date.parse('2026-11-27T08:00:00Z');
const fix = (offset, extra = {}) => ({ latitude: location.latitude, longitude: location.longitude, accuracy: 10,
  capturedAt: new Date(start + offset).toISOString(), ...extra });
const stop = { id: '1', destination: 'Учебный объект', visitLocation: location };
const trip = { startedAt: new Date(start - 1000).toISOString(), plannedStart: '2026-11-27T04:00:00Z',
  plannedEnd: '2026-11-28T13:00:00Z', stops: [stop] };
const proof = { siteRevision: 1, fixes: [0, 15000, 30000, 45000, 60000].map(time => fix(time)) };
test('arrival requires a full minute of fresh accurate positions; passing by, leaving or losing GPS resets it', () => {
  let window;
  for (const time of [0, 15000, 30000, 45000]) {
    const result = advanceVisitWindow(window, [stop], fix(time), start + time); window = result.window; assert.equal(result.ready, false);
  }
  assert.equal(advanceVisitWindow(window, [stop], fix(60000), start + 60000).ready, true);
  assert.equal(advanceVisitWindow(window, [stop], fix(50000, { longitude: 58 }), start + 50000).window, null);
  assert.equal(advanceVisitWindow(window, [stop], fix(50000, { accuracy: 200 }), start + 50000).window, null);
  assert.equal(advanceVisitWindow(window, [stop], fix(80000), start + 80000).remaining, 60);
  assert.equal(advanceVisitWindow(window, [stop], fix(45000), start + 46000).ready, undefined, 'cached reading adds no dwell');
});
test('unknown points, overlapping organizations, uncertain edge and mocked/stale/future positions never qualify', () => {
  assert.equal(visitCandidate([{ ...stop, visitLocation: null }], fix(0), start).stop, undefined);
  assert.match(visitCandidate([stop, { ...stop, id: '2', visitedAt: 'already' }], fix(0), start).error, /несколько/);
  assert.match(visitCandidate([stop], fix(0, { latitude: location.latitude + .0012, accuracy: 40 }), start).error, /границы/);
  for (const extra of [{ mocked: true }, { latitude: NaN }, { longitude: 181 }, { accuracy: null }, { accuracy: -1 },
    { capturedAt: new Date(start - 31000).toISOString() }, { capturedAt: new Date(start + 10000).toISOString() }]) {
    assert.equal(visitCandidate([stop], fix(0, extra), start).stop, undefined);
  }
});
test('stored evidence revalidates duration, gaps, dates, point revision and the full series', () => {
  const evidence = validateVisitEvidence(trip, stop, proof, start + 60000);
  assert.equal(evidence.method, 'gps'); assert.equal(evidence.durationSeconds, 60); assert.equal(evidence.samples, 5);
  assert.equal(evidence.distance, 0);
  assert.throws(() => validateVisitEvidence(trip, stop, { ...proof, siteRevision: 2 }, start + 60000), /изменилось/);
  assert.throws(() => validateVisitEvidence(trip, stop, { ...proof, fixes: [fix(0), fix(1000), fix(60000)] }, start + 60000), /прервалась/);
  assert.throws(() => validateVisitEvidence(trip, stop, { ...proof, fixes: [fix(0), fix(15000), fix(30000)] }, start + 30000), /минуты/);
  assert.throws(() => validateVisitEvidence(trip, stop, { ...proof, fixes: proof.fixes.map((p, i) => i === 2 ? { ...p, longitude: 58 } : p) }, start + 60000));
  assert.throws(() => validateVisitEvidence(trip, stop, proof, start + 100000), /свежую/);
  assert.throws(() => validateVisitEvidence({ ...trip, plannedStart: '2026-11-28T04:00:00Z' }, stop, proof, start + 60000), /даты/);
  assert.equal(tripVisitPeriodError(trip, Date.parse('2026-11-26T20:00:00Z')), '', 'date is evaluated in Almaty, not UTC');
});
function environment() {
  const values = new Map(); let time = start - 1000; let fail = false;
  const storage = { getItem: async key => values.get(key) ?? null,
    setItem: async (key, value) => { if (fail) throw Error('Quota'); values.set(key, value); } };
  return { values, time: value => { time = value; }, fail: value => { fail = value; },
    api: () => createDemoTrips(storage, () => new Date(time).toISOString()) };
}
const post = (api, role, url, body = {}) => api(role, url, { method: 'POST', body });
async function prepare(env, name = 'Актобе · Учебный офис') {
  const api = env.api(); const { offer } = await post(api, 'employee', '/trip-offers', {
    requestId: name, destination: name, destinations: [name], purpose: 'Проверка автоотметок', dailyRate: 1000,
    plannedStart: trip.plannedStart, plannedEnd: trip.plannedEnd, visitTimes: [trip.plannedStart] });
  const checked = (await post(api, 'accountant', `/trip-offers/${offer.id}/approval`, { stage: 1, action: 'approve', expectedRevision: 1 })).offer;
  const approved = (await post(api, 'manager', `/trip-offers/${offer.id}/approval`, { stage: 2, action: 'approve', expectedRevision: checked.revision })).offer;
  await post(api, 'employee', `/trips/${approved.tripId}/start`);
  return { api, tripId: approved.tripId, stopId: offer.stops[0].id, route: `/trips/${approved.tripId}/stops/${offer.stops[0].id}` };
}
test('only manager configures a reusable site; employee cannot self-set location or mark manually', async () => {
  const env = environment(); const { api, route, tripId } = await prepare(env);
  const config = { expectedRevision: 0, location };
  await assert.rejects(post(api, 'employee', route + '/location', config), /руководитель/);
  await assert.rejects(post(api, 'accountant', route + '/location', config), /руководитель/);
  await assert.rejects(post(api, 'manager', route + '/location', { ...config, location: { ...location, radius: 9000 } }), /300/);
  await assert.rejects(post(api, 'employee', route, { requestId: 'manual', expectedRevision: 0, outcome: 'visited' }), /автоматически/);
  await post(api, 'manager', route + '/location', config);
  await assert.rejects(post(api, 'manager', route + '/location', config), /изменена/);
  const data = await env.api()('employee', `/trips/${tripId}/report`);
  assert.equal(data.trip.stops[0].visitLocation.latitude, location.latitude);
  const old = JSON.parse([...env.values.values()][0]);
  old.trips.push({ ...old.trips[0], id: 'second-trip', stops: [{ ...old.trips[0].stops[0], id: 'second-stop' }] });
  env.values.set([...env.values.keys()][0], JSON.stringify(old));
  assert.equal((await env.api()('employee', '/trips/second-trip/report')).trip.stops[0].visitLocation.radius, 150);
});
test('automatic visit persists once, survives reload, and cancellation keeps audit history', async () => {
  const env = environment(); const { api, route, tripId } = await prepare(env);
  await post(api, 'manager', route + '/location', { expectedRevision: 0, location }); env.time(start + 60000);
  const body = { outcome: 'auto_visit', requestId: 'auto1', expectedRevision: 0, evidence: proof };
  await assert.rejects(post(api, 'manager', route, body), /сотрудник/);
  env.fail(true); await assert.rejects(post(api, 'employee', route, body), /сохранить/); env.fail(false);
  assert.equal((await env.api()('employee', `/trips/${tripId}/report`)).trip.stops[0].visitedAt, null);
  const results = await Promise.all([post(api, 'employee', route, body), post(api, 'employee', route, body)]);
  assert.equal(results[1].stop.visitHistory.length, 1);
  const saved = (await env.api()('manager', `/trips/${tripId}/report`)).trip.stops[0];
  assert.ok(saved.visitedAt); assert.equal(saved.visitEvidence.samples, 5);
  await assert.rejects(post(api, 'employee', route + '/undo', { requestId: 'undo', expectedRevision: 1 }), /причину/);
  const undone = (await post(api, 'employee', route + '/undo', { requestId: 'undo', expectedRevision: 1, reason: 'Ошибочная точка объекта' })).stop;
  assert.equal(undone.visitedAt, null); assert.equal(undone.visitHistory.length, 2);
  assert.equal(undone.visitHistory[1].previous.visitEvidence.method, 'gps');
  await assert.rejects(post(api, 'employee', `/trips/${tripId}/finish`), /остановки/);
  assert.equal((await post(api, 'employee', route, body)).stop.visitedAt, null, 'retry of cancelled event cannot resurrect it');
});
test('legacy visits keep their original time without inventing GPS evidence', async () => {
  const env = environment(); const { api, route, tripId } = await prepare(env);
  const key = [...env.values.keys()][0]; const data = JSON.parse(env.values.get(key));
  data.trips[0].stops[0].visitedAt = '2026-11-27T07:00:00Z'; env.values.set(key, JSON.stringify(data));
  const old = (await api('employee', `/trips/${tripId}/report`)).trip.stops[0];
  assert.equal(old.visitedAt, '2026-11-27T07:00:00Z'); assert.equal(old.visitEvidence, undefined);
  const changed = await post(api, 'employee', route + '/undo', { requestId: 'undo-legacy', expectedRevision: 0, reason: 'Нажал случайно' });
  assert.equal(changed.stop.visitHistory[0].previous.visitedAt, old.visitedAt);
});
