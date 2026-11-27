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
    configFile: false, babelrc: false, plugins: [require.resolve('@babel/plugin-transform-modules-commonjs')],
  });
  vm.runInNewContext(code, { module, exports: module.exports, require: load }, { filename: file });
  return module.exports;
}
const { createDemoTrips } = load('demoTrips');
function environment() {
  const values = new Map(); let failWrites = false;
  const storage = { getItem: async key => values.get(key) ?? null,
    setItem: async (key, value) => { if (failWrites) throw Error('Quota'); values.set(key, value); } };
  return { values, reload: () => createDemoTrips(storage, () => '2026-11-27T08:00:00Z'), failWrites: value => { failWrites = value; } };
}
const post = (api, role, url, body = {}) => api(role, url, { method: 'POST', body });
const draft = { requestId: 'new', destination: 'Астана', purpose: 'Обслуживание', dailyRate: 10000,
  transport: 5000, lodging: 12000, plannedStart: '2026-11-28T04:00:00Z', plannedEnd: '2026-11-29T13:00:00Z' };
const decision = (api, role, offer, action = 'approve', reason = '') => post(api, role, `/trip-offers/${offer.id}/approval`, {
  action, reason, expectedRevision: offer.revision, stage: offer.approvalStages.find(s => s.status === 'waiting').position });
async function approvedTrip(api) {
  const { offer } = await post(api, 'employee', '/trip-offers', draft);
  const { offer: checked } = await decision(api, 'accountant', offer);
  const { offer: approved } = await decision(api, 'manager', checked);
  return (await api('accountant', `/trips/${approved.tripId}/report`)).trip;
}
const record = (api, trip, kind, amount, requestId = 'payment-1', extra = {}) => post(api, 'accountant', `/accounting/trips/${trip.id}/transactions`, {
  kind, amount, requestId, date: '2026-11-27', expectedRevision: trip.finance.revision, ...extra });
const review = (api, trip, extra = {}) => post(api, 'accountant', `/accounting/trips/${trip.id}/review`, {
  action: 'approved', documentsChecked: true, expectedRevision: trip.finance.revision,
  actualRevision: trip.actualExpenses.revision, receiptRevision: trip.receiptRevision, ...extra });
async function finish(api, trip, expenses = 14000) {
  await post(api, 'employee', `/trips/${trip.id}/start`);
  await post(api, 'employee', `/trips/${trip.id}/actual-expenses`, { transport: expenses, expectedRevision: 0 });
  await post(api, 'employee', `/trips/${trip.id}/finish`);
  return (await api('accountant', `/trips/${trip.id}/report`)).trip;
}
test('accountant checks first; manager cannot bypass; returned route is corrected and resubmitted', async () => {
  const api = environment().reload();
  const { offer } = await post(api, 'employee', '/trip-offers', { ...draft,
    destinations: ['Астана · Офис', 'Астана · Склад'], visitTimes: ['2026-11-28T06:00:00Z','2026-11-29T06:00:00Z'] });
  await assert.rejects(decision(api, 'manager', offer), /этапа/);
  await assert.rejects(decision(api, 'accountant', offer, 'reject'), /причину/);
  const { offer: returned } = await decision(api, 'accountant', offer, 'reject', 'Уточнить проезд');
  assert.equal(returned.status, 'awaiting_employee');
  assert.equal(returned.revisionReason, 'Уточнить проезд');
  const proposal = { ...draft, transport: 7000, expectedRevision: returned.revision,
    stops: returned.stops.map(stop => ({ id: stop.id, plannedAt: stop.plannedAt })) };
  await assert.rejects(post(api,'manager',`/trip-offers/${offer.id}/proposal`,proposal), /сотрудник/);
  const { offer: corrected } = await post(api,'employee',`/trip-offers/${offer.id}/proposal`,proposal);
  assert.equal(corrected.estimate.transport,7000);
  assert.equal(corrected.approvalStages[0].status,'waiting');
  assert.equal(corrected.approvalStages[1].status,'pending');
  assert.equal(corrected.stops[1].destination,'Астана · Склад');
  assert.equal(corrected.approvalHistory.length,1);
  const { offer: checked } = await decision(api,'accountant',corrected);
  assert.equal((await api('manager','/trip-offers')).offers[0].canDecideApproval,true);
  assert.equal((await api('employee','/trips')).trips.length,0);
  const { offer: approved } = await decision(api,'manager',checked);
  assert.ok(approved.tripId);
});
test('partial advances exclude work pay; retries and concurrent submissions never double the amount', async () => {
  const env=environment();const api=env.reload(); const trip=await approvedTrip(api);
  assert.equal(trip.finance.remainingAdvance,17000); assert.equal(trip.estimate.workTotal,20000);
  await assert.rejects(record(api,trip,'advance',37000),/превышать/);
  await assert.rejects(post(api,'employee',`/accounting/trips/${trip.id}/transactions`,{}),/бухгалтеру/);
  await assert.rejects(record(api,trip,'advance',10000,'bad-date',{date:'2026-11-28'}),/Дата/);
  const results=await Promise.all([record(api,trip,'advance',10000),record(api,trip,'advance',10000)]);
  assert.equal(results[0].trip.finance.advanceTotal,10000); assert.equal(results[1].trip.finance.transactions.length,1);
  const current=(await env.reload()('employee',`/trips/${trip.id}/report`)).trip;
  assert.equal(current.finance.remainingAdvance,7000);
  await assert.rejects(record(api,trip,'advance',1000,'different'),/изменились/);
  await assert.rejects(record(api,current,'advance',11000),/отличается/);
  const second=await record(api,current,'advance',7000,'payment-2');
  assert.equal(second.trip.finance.remainingAdvance,0);
});
test('refund requires accepted current report; partial refund and reload preserve exact remaining balance', async () => {
  const env=environment();const api=env.reload();let trip=await approvedTrip(api);
  ({trip}=await record(api,trip,'advance',17000));trip=await finish(api,trip);
  assert.equal(trip.finance.balance,-3000);
  await assert.rejects(record(api,trip,'refund',3000,'r1'),/Сначала/);
  await assert.rejects(review(api,trip,{documentsChecked:false}),/сверку/);
  ({trip}=await review(api,trip));
  await assert.rejects(record(api,trip,'payment',3000,'wrong'),/направление/);
  await assert.rejects(record(api,trip,'refund',3001,'over'),/превышает/);
  ({trip}=await record(api,trip,'refund',1000,'r1')); assert.equal(trip.finance.balance,-2000);
  ({trip}=await record(api,trip,'refund',2000,'r2')); assert.equal(trip.finance.balance,0);
  await assert.rejects(record(api,trip,'refund',1,'extra'),/направление/);
  assert.equal((await env.reload()('employee',`/trips/${trip.id}/report`)).trip.finance.balance,0);
});
test('updated amounts and new receipt invalidate an accepted review until accountant checks again', async () => {
  const api=environment().reload();let trip=await finish(api,await approvedTrip(api),19000);
  ({trip}=await review(api,trip)); assert.equal(trip.finance.balance,19000);
  await post(api,'employee',`/trips/${trip.id}/actual-expenses`,{ transport:20000,expectedRevision:1 });
  await assert.rejects(record(api,trip,'payment',19000),/Сначала/);
  await assert.rejects(review(api,trip),/новую версию/);
  trip=(await api('accountant',`/trips/${trip.id}/report`)).trip;
  assert.equal(trip.finance.reviewStatus,'pending');
  ({trip}=await review(api,trip,{action:'returned',reason:'Приложите чек'}));
  assert.equal((await api('employee',`/trips/${trip.id}/report`)).trip.finance.review.reason,'Приложите чек');
  const receipt={requestId:'receipt1',name:'Учебный чек',data:'data:image/png;base64,aGVsbG8='};
  await assert.rejects(post(api,'manager',`/trips/${trip.id}/receipts`,receipt),/сотрудник/);
  await assert.rejects(post(api,'employee',`/trips/${trip.id}/receipts`,{...receipt,data:'https://example.com/a.png'}),/фото/);
  ({trip}=await post(api,'employee',`/trips/${trip.id}/receipts`,receipt));
  assert.equal(trip.finance.reviewStatus,'pending'); assert.equal(trip.receipts.length,1);
  assert.equal((await post(api,'employee',`/trips/${trip.id}/receipts`,receipt)).trip.receipts.length,1);
  ({trip}=await review(api,trip));
  ({trip}=await record(api,trip,'payment',20000));assert.equal(trip.finance.balance,0);
  ({trip}=await post(api,'employee',`/trips/${trip.id}/receipts`,{...receipt,requestId:'receipt2'}));
  assert.equal(trip.finance.reviewStatus,'pending');
});
test('failed financial writes leave stored balance unchanged; existing one-stage offers still work', async () => {
  const env=environment();const api=env.reload();const trip=await approvedTrip(api);
  env.failWrites(true);await assert.rejects(record(api,trip,'advance',5000),/сохранить/);env.failWrites(false);
  assert.equal((await env.reload()('employee',`/trips/${trip.id}/report`)).trip.finance.advanceTotal,0);
  await record(api,trip,'advance',5000);
  const {offer}=await post(api,'employee','/trip-offers',{...draft,requestId:'legacy'});
  const key=[...env.values.keys()][0];const state=JSON.parse(env.values.get(key));
  state.offers.find(o=>o.id===offer.id).approvalStages=[{position:1,approverId:'demo-manager',approverName:'Демо-руководитель',status:'waiting'}];
  env.values.set(key,JSON.stringify(state));
  const old=(await api('manager','/trip-offers')).offers.find(o=>o.id===offer.id);
  assert.equal((await decision(api,'manager',old)).offer.status,'confirmed');
});
test('sample data is opt-in and idempotent; contract receipts and closing documents enforce balance and order', async () => {
  const api=environment().reload();assert.equal((await api('accountant','/accounting')).trips.length,0);
  await post(api,'accountant','/accounting/examples');await post(api,'accountant','/accounting/examples');
  const data=await api('accountant','/accounting');assert.equal(data.trips.length,2);assert.ok(data.trips.every(t=>t.sample));
  const contract=data.contracts[0]; const receipt={paymentIndex:0,amount:100000,receivedOn:'2026-11-27',requestId:'c1'};
  await assert.rejects(post(api,'manager',`/contracts/${contract.id}/receipts`,receipt),/бухгалтер/);
  await post(api,'accountant',`/contracts/${contract.id}/receipts`,receipt);
  const result=await post(api,'accountant',`/contracts/${contract.id}/receipts`,receipt);
  assert.equal(result.contract.paidAmount,100000);assert.equal(result.contract.outstandingAmount,200000);
  await assert.rejects(post(api,'accountant',`/contracts/${contract.id}/receipts`,{...receipt,requestId:'c2',amount:200001}),/превышает/);
  const base=`/contracts/${contract.id}/closing-documents/${contract.closingDocuments[0].id}`;
  await assert.rejects(post(api,'accountant',base+'/esf',{number:'ЭСФ-1',issuedOn:'2026-11-27'}),/Сначала/);
  await post(api,'accountant',base+'/avr',{number:'АВР-1',issuedOn:'2026-11-27'});
  const closed=await post(api,'accountant',base+'/esf',{number:'ЭСФ-1',issuedOn:'2026-11-27'});
  assert.equal(closed.contract.closingDocuments[0].esf.number,'ЭСФ-1');
});
