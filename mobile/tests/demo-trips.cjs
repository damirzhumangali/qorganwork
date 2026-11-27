const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');

function load(name) {
  const file = path.join(__dirname, '../src', name + '.js');
  const module = { exports: {} };
  const { code } = babel.transformSync(fs.readFileSync(file, 'utf8'), {
    configFile: false, babelrc: false,
    plugins: [require.resolve('@babel/plugin-transform-modules-commonjs')],
  });
  vm.runInNewContext(code, { module, exports: module.exports, require: load }, { filename: file });
  return module.exports;
}
const { createDemoTrips } = load('demoTrips');
function environment() {
  const values = new Map();
  let failWrites = false;
  const storage = {
    getItem: async key => values.get(key) ?? null,
    setItem: async (key, value) => { if (failWrites) throw new Error('Quota'); values.set(key, value); },
  };
  return { reload: () => createDemoTrips(storage), failWrites: value => { failWrites = value; }, values };
}
const draft = {
  requestId: 'creation-1', destination: 'Астана', purpose: 'Проверить оборудование',
  plannedStart: '2026-11-27T04:00:00.000Z', plannedEnd: '2026-11-28T13:00:00.000Z',
  dailyRate: 10000, transport: 5000, lodging: 12000,
};
const post = (api, role, url, body = {}) => api(role, url, { method: 'POST', body });
const checkExpenses = (api, offer) => post(api, 'accountant', `/trip-offers/${offer.id}/approval`, {
  stage: 1, action: 'approve', expectedRevision: offer.revision,
});
const approve = async (api, offer) => {
  const { offer: checked } = await checkExpenses(api, offer);
  return post(api, 'manager', `/trip-offers/${offer.id}/approval`, {
    stage: 2, action: 'approve', expectedRevision: checked.revision,
  });
};

test('employee creates locally; reloaded manager approves; employee starts and finishes', async () => {
  const env = environment();
  let api = env.reload();
  const { offer } = await post(api, 'employee', '/trip-offers', draft);
  assert.equal(offer.status, 'awaiting_approval');
  assert.equal(offer.canDecideApproval, false);
  assert.equal(offer.estimate.days, 2);
  assert.equal(offer.estimate.total, 37000);
  api = env.reload();
  const list = await api('manager', '/trip-offers');
  assert.equal(list.offers[0].id, offer.id);
  assert.equal(list.offers[0].canDecideApproval, false);
  assert.equal((await api('accountant', '/trip-offers')).offers[0].canDecideApproval, true);
  const { offer: approved } = await approve(api, offer);
  assert.equal(approved.status, 'confirmed');
  api = env.reload();
  const trips = await api('employee', '/trips');
  assert.equal(trips.trips[0].id, approved.tripId);
  await post(api, 'employee', `/trips/${approved.tripId}/start`);
  const { actualExpenses } = await post(api, 'employee', `/trips/${approved.tripId}/actual-expenses`, {
    transport: 6000, lodging: 11000, expectedRevision: 0,
  });
  assert.equal(actualExpenses.actualTotal, 37000);
  await post(api, 'employee', `/trips/${approved.tripId}/finish`);
  const report = await env.reload()('manager', `/trips/${approved.tripId}/report`);
  assert.equal(report.trip.status, 'finished');
  assert.ok(report.trip.finishedAt);
});

test('retry and concurrent approval never create duplicate trips; employee cannot approve', async () => {
  const env = environment(); const api = env.reload();
  const [first, retry] = await Promise.all([
    post(api, 'employee', '/trip-offers', draft), post(api, 'employee', '/trip-offers', draft),
  ]);
  assert.equal(first.offer.id, retry.offer.id);
  await assert.rejects(post(api, 'employee', `/trip-offers/${first.offer.id}/approval`, {
    stage: 1, action: 'approve', expectedRevision: 1,
  }), /руководителю/);
  const results = await Promise.allSettled([approve(api, first.offer), approve(api, first.offer)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((await api('manager', '/trips')).trips.length, 1);
});

test('rejection and reason persist for employee without creating a trip', async () => {
  const env = environment(); const api = env.reload();
  const { offer } = await post(api, 'employee', '/trip-offers', draft);
  const url = `/trip-offers/${offer.id}/approval`;
  const { offer: checked } = await checkExpenses(api, offer);
  await assert.rejects(post(api, 'manager', url, { stage: 2, action: 'reject', expectedRevision: checked.revision }), /причину/);
  await post(api, 'manager', url, { stage: 2, action: 'reject', reason: 'Перенести дату', expectedRevision: checked.revision });
  const { offers } = await env.reload()('employee', '/trip-offers');
  assert.equal(offers[0].status, 'rejected');
  assert.equal(offers[0].approvalStages[1].reason, 'Перенести дату');
  assert.equal((await api('employee', '/trips')).trips.length, 0);
});

test('route requires visit times, marks each stop, and prevents premature finish', async () => {
  const env = environment(); const api = env.reload();
  const body = { ...draft, destinations: ['Астана · Офис', 'Астана · Склад'],
    visitTimes: ['2026-11-27T06:00:00.000Z', '2026-11-28T06:00:00.000Z'] };
  await assert.rejects(post(api, 'employee', '/trip-offers', { ...body, visitTimes: [] }), /маршрут/);
  const { offer } = await post(api, 'employee', '/trip-offers', body);
  const { offer: approved } = await approve(api, offer);
  const url = `/trips/${approved.tripId}`;
  await post(api, 'employee', url + '/start');
  await assert.rejects(post(api, 'employee', url + '/finish'), /остановки/);
  await post(api, 'employee', url + '/stops/' + offer.stops[0].id, { outcome: 'visited' });
  await post(api, 'employee', url + '/stops/' + offer.stops[1].id, { outcome: 'skipped', reason: 'Закрыт' });
  await post(api, 'employee', url + '/finish');
  const { trip } = await env.reload()('manager', url + '/report');
  assert.ok(trip.stops[0].visitedAt);
  assert.equal(trip.stops[1].skipReason, 'Закрыт');
});

test('failed storage never reports success and a retry saves exactly once', async () => {
  const env = environment(); const api = env.reload();
  env.failWrites(true);
  await assert.rejects(post(api, 'employee', '/trip-offers', draft), /Не удалось сохранить/);
  assert.equal((await api('employee', '/trip-offers')).offers.length, 0);
  env.failWrites(false);
  const { offer } = await post(api, 'employee', '/trip-offers', draft);
  env.failWrites(true);
  await assert.rejects(approve(api, offer), /Не удалось сохранить/);
  assert.equal((await api('manager', '/trips')).trips.length, 0);
  env.failWrites(false);
  await approve(api, offer);
  assert.equal((await api('manager', '/trips')).trips.length, 1);
});

test('invalid dates and corrupt storage are not silently accepted or overwritten', async () => {
  const env = environment(); const api = env.reload();
  await assert.rejects(post(api, 'employee', '/trip-offers', { ...draft, plannedEnd: draft.plannedStart }), /позже/);
  await post(api, 'employee', '/trip-offers', draft);
  const key = [...env.values.keys()][0];
  env.values.set(key, '{broken');
  await assert.rejects(post(api, 'employee', '/trip-offers', draft), /Не удалось прочитать/);
  assert.equal(env.values.get(key), '{broken');
});
