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
function environment() {
  const values = new Map(); let fail = false;
  const storage = { getItem: async key => values.get(key) ?? null,
    setItem: async (key, value) => { if (fail) throw Error('Quota'); values.set(key, value); } };
  return { api: () => createDemoTrips(storage, () => '2026-11-27T08:00:00Z'), fail: value => { fail = value; } };
}
let seq = 0;
const post = (api, role, url, body = {}) => api(role, url, { method: 'POST', body: { requestId: 'test-' + ++seq, ...body } });
const change = async (api, role, doc, action, body = {}) => (await post(api, role, `/documents/${doc.id}/${action}`, { expectedRevision: doc.revision, ...body })).document;
async function samples(api) { await post(api, 'accountant', '/documents/examples'); return api('employee', '/documents'); }
async function statement(api, amount = 20000) {
  const data = await samples(api); const trip = data.trips.find(t => t.status === 'planned');
  return (await post(api, 'employee', '/documents', { kind: 'advance', tripId: trip.id, amount })).document;
}
test('advance autofills from an approved trip; no registration, other role or excessive amount can bypass validation', async () => {
  const api = environment().api(); const doc = await statement(api);
  assert.equal(doc.content.employee, 'Демо-сотрудник'); assert.equal(doc.content.destination, 'Павлодар');
  assert.equal(doc.content.amount, 20000); assert.equal(doc.status, 'draft');
  assert.ok(doc.content.plannedStart); assert.ok(doc.content.purpose);
  await assert.rejects(post(api, 'accountant', '/documents', { kind: 'advance', tripId: doc.tripId }), /другая роль/);
  await assert.rejects(post(api, 'employee', '/documents', { kind: 'advance', tripId: doc.tripId }), /уже есть/);
  await assert.rejects(change(api, 'employee', doc, 'update', { amount: 0 }), /положительную/);
  await assert.rejects(change(api, 'employee', doc, 'send'), /учебное/);
  await assert.rejects(change(api, 'accountant', doc, 'approve'), /Дождитесь/);
  await assert.rejects(api('manager', '/documents'), /сотруднику и бухгалтеру/);
});
test('statement return preserves prior signed content; correction creates unsigned version for resubmission', async () => {
  const api = environment().api(); let doc = await statement(api);
  doc = await change(api, 'employee', doc, 'send', { confirmDemo: true });
  assert.equal(doc.status, 'awaiting_accountant'); assert.equal(doc.signatures[0].demo, true);
  await assert.rejects(change(api, 'accountant', doc, 'return'), /Укажите/);
  doc = await change(api, 'accountant', doc, 'return', { reason: 'Уменьшить сумму' });
  await assert.rejects(change(api, 'accountant', doc, 'update', { amount: 15000 }), /автор/);
  doc = await change(api, 'employee', doc, 'update', { amount: 15000, note: 'Уточнено' });
  assert.equal(doc.version, 2); assert.equal(doc.signatures.length, 0);
  assert.equal(doc.versions[0].content.amount, 20000); assert.equal(doc.versions[0].signatures.length, 1);
  doc = await change(api, 'employee', doc, 'send', { confirmDemo: true });
  doc = await change(api, 'accountant', doc, 'approve');
  assert.equal(doc.status, 'approved'); assert.equal(doc.paid, 0);
  assert.equal((await api('accountant', '/trips')).trips.find(t => t.id === doc.tripId).finance.advanceTotal, 0);
  await assert.rejects(change(api, 'employee', doc, 'update', { amount: 1 }), /нельзя изменить/);
});
test('linked partial advances respect both statement and trip limit and survive reload; signatures never transfer funds', async () => {
  const env = environment(); const api = env.api(); let doc = await statement(api);
  doc = await change(api, 'employee', doc, 'send', { confirmDemo: true });
  let trip = (await api('employee', '/trips')).trips.find(t => t.id === doc.tripId);
  const pay = (amount, extra = {}) => post(api, 'accountant', `/accounting/trips/${trip.id}/transactions`, {
    kind: 'advance', amount, date: '2026-11-27', documentId: doc.id, expectedRevision: trip.finance.revision, ...extra });
  await assert.rejects(pay(10000), /Сначала примите/);
  doc = await change(api, 'accountant', doc, 'approve');
  await assert.rejects(pay(20001), /по заявлению/);
  ({ trip } = await pay(8000, { requestId: 'pay-1' }));
  const current = (await env.api()('employee', '/documents')).documents.find(d => d.id === doc.id);
  assert.equal(current.paid, 8000); assert.equal(current.outstanding, 12000);
  const { trip: retry } = await pay(8000, { requestId: 'pay-1' }); assert.equal(retry.finance.advanceTotal, 8000);
  await assert.rejects(pay(8000, { requestId: 'pay-1', documentId: null }), /отличается/);
  ({ trip } = await pay(12000));
  assert.equal((await api('employee', '/documents')).documents.find(d => d.id === doc.id).outstanding, 0);
  const next = await post(api, 'employee', '/documents', { kind: 'advance', tripId: trip.id });
  assert.equal(next.document.content.amount, 25000);
});
test('report requires employee then accountant confirmation; retries are idempotent and final content is immutable', async () => {
  const env = environment(); const api = env.api(); const data = await samples(api); let doc = data.documents.find(d => d.kind === 'report');
  assert.equal(doc.content.amount, 36500); assert.equal(doc.content.advance, 40000);
  await assert.rejects(change(api, 'accountant', doc, 'sign', { confirmDemo: true }), /своего этапа/);
  await assert.rejects(change(api, 'employee', doc, 'sign'), /Подтвердите/);
  const request = { expectedRevision: doc.revision, requestId: 'sign-once', confirmDemo: true };
  const [a, b] = await Promise.all([post(api, 'employee', `/documents/${doc.id}/sign`, request), post(api, 'employee', `/documents/${doc.id}/sign`, request)]);
  assert.equal(a.document.signatures.length, 1); assert.equal(b.document.signatures.length, 1); doc = a.document;
  await assert.rejects(change(api, 'employee', doc, 'sign', { confirmDemo: true }), /этапа/);
  doc = await change(api, 'accountant', doc, 'sign', { confirmDemo: true });
  assert.equal(doc.status, 'signed'); assert.equal(doc.signatures.length, 2);
  const saved = (await env.api()('employee', '/documents')).documents.find(d => d.id === doc.id);
  assert.equal(saved.status, 'signed'); assert.equal(saved.signatures[1].role, 'accountant');
  await assert.rejects(change(api, 'accountant', doc, 'update'), /нельзя изменить/);
  const trip = (await api('employee', '/trips')).trips.find(t => t.id === doc.tripId);
  assert.equal(trip.finance.reviewStatus, 'pending'); assert.equal(trip.finance.balance, -3500);
});
test('changed expenses or receipts block signing stale reports; revision archives the previous signature', async () => {
  const api = environment().api(); const data = await samples(api); let doc = data.documents.find(d => d.kind === 'report');
  doc = await change(api, 'employee', doc, 'sign', { confirmDemo: true });
  await post(api, 'employee', `/trips/${doc.tripId}/actual-expenses`, { expectedRevision: 1, transport: 38000 });
  await assert.rejects(change(api, 'accountant', doc, 'sign', { confirmDemo: true }), /изменились/);
  doc = await change(api, 'accountant', doc, 'update');
  assert.equal(doc.content.amount, 38000); assert.equal(doc.version, 2); assert.equal(doc.signatures.length, 0);
  assert.equal(doc.versions[0].signatures[0].role, 'employee'); assert.equal(doc.versions[0].content.amount, 36500);
  doc = await change(api, 'accountant', doc, 'send');
  await post(api, 'employee', `/trips/${doc.tripId}/receipts`, { name: 'Чек', data: 'data:image/png;base64,aGVsbG8=' });
  await assert.rejects(change(api, 'employee', doc, 'sign', { confirmDemo: true }), /изменились/);
  doc = await change(api, 'accountant', doc, 'update'); assert.equal(doc.content.receipts.length, 1);
});
test('writeoff supports correction and both signatures; employee cannot silently change accountant content', async () => {
  const api = environment().api(); let doc = (await samples(api)).documents.find(d => d.kind === 'writeoff');
  doc = await change(api, 'employee', doc, 'return', { reason: 'Кабель 10 м' });
  await assert.rejects(change(api, 'employee', doc, 'update', { details: 'Кабель 10 м' }), /автор/);
  await assert.rejects(change(api, 'accountant', doc, 'update'), /материалы/);
  doc = await change(api, 'accountant', doc, 'update', { details: 'Кабель UTP — 10 м. Использован на объекте.' });
  assert.equal(doc.version, 2); doc = await change(api, 'accountant', doc, 'send');
  doc = await change(api, 'employee', doc, 'sign', { confirmDemo: true });
  doc = await change(api, 'accountant', doc, 'sign', { confirmDemo: true }); assert.equal(doc.status, 'signed');
});
test('stale revisions and failed writes cannot lose signatures; examples are additive and idempotent', async () => {
  const env = environment(); const api = env.api(); const data = await samples(api); const doc = data.documents.find(d => d.kind === 'report');
  assert.equal(data.documents.length, 2); await samples(api); assert.equal((await api('employee', '/documents')).documents.length, 2);
  env.fail(true); await assert.rejects(change(api, 'employee', doc, 'sign', { confirmDemo: true }), /сохранить/); env.fail(false);
  assert.equal((await env.api()('employee', '/documents')).documents.find(d => d.id === doc.id).signatures.length, 0);
  const signed = await change(api, 'employee', doc, 'sign', { confirmDemo: true });
  await assert.rejects(change(api, 'accountant', doc, 'update'), /изменился/);
  assert.equal(signed.signatures.length, 1);
});
test('exhausted advance does not block saving a corrected draft; submitting and accepting still check the current balance', async () => {
  const env = environment(); const api = env.api(); let doc = await statement(api);
  doc = await change(api, 'employee', doc, 'send', { confirmDemo: true });
  const trip = (await api('accountant', '/trips')).trips.find(t => t.id === doc.tripId);
  await post(api, 'accountant', `/accounting/trips/${trip.id}/transactions`, {
    kind: 'advance', amount: 45000, date: '2026-11-27', expectedRevision: trip.finance.revision,
  });
  await assert.rejects(change(api, 'accountant', doc, 'approve'), /уже покрыты авансом/);
  doc = await change(api, 'accountant', doc, 'return', { reason: 'Проверить уже выданный аванс' });
  doc = await change(api, 'employee', doc, 'update', { amount: 10000, note: 'Сохраняю для уточнения' });
  assert.equal(doc.status, 'draft'); assert.equal(doc.content.amount, 10000);
  assert.equal(doc.signatures.length, 0); assert.equal(doc.versions[0].signatures.length, 1);
  const reloaded = (await env.api()('employee', '/documents')).documents.find(d => d.id === doc.id);
  assert.equal(reloaded.content.note, 'Сохраняю для уточнения');
  await assert.rejects(change(api, 'employee', doc, 'send', { confirmDemo: true }), /уже покрыты авансом/);
  const unchanged = (await api('accountant', '/trips')).trips.find(t => t.id === doc.tripId);
  assert.equal(unchanged.finance.remainingAdvance, 0); assert.equal(unchanged.finance.advanceTotal, 45000);
  assert.equal(unchanged.finance.transactions.length, 1);
});
test('an over-budget draft can be saved, corrected and sent, without creating an approval or a payment on save', async () => {
  const api = environment().api(); let doc = await statement(api, 50000);
  assert.equal(doc.status, 'draft'); assert.equal(doc.content.amount, 50000);
  await assert.rejects(change(api, 'employee', doc, 'send', { confirmDemo: true }), /больше доступного остатка/);
  doc = await change(api, 'employee', doc, 'update', { amount: 10000 });
  doc = await change(api, 'employee', doc, 'send', { confirmDemo: true });
  doc = await change(api, 'accountant', doc, 'approve');
  assert.equal(doc.status, 'approved'); assert.equal(doc.paid, 0);
});
