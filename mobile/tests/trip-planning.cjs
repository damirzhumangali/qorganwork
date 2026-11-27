const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');

function load(name) {
  // These tests exercise route restoration, not the React budget editor.
  if (name === './TripBudget') return { tripBudgetDraft: () => ({}) };
  const file = path.join(__dirname, '../src', name + '.js');
  const module = { exports: {} };
  const { code } = babel.transformSync(fs.readFileSync(file, 'utf8'), {
    configFile: false, babelrc: false,
    plugins: [require.resolve('@babel/plugin-transform-modules-commonjs')],
  });
  vm.runInNewContext(code, { module, exports: module.exports, require: load }, { filename: file });
  return module.exports;
}
const { KURMANGAZY_DESTINATIONS, organizationTripStops } = load('TripDestinations');
const { SCHEDULE_DESTINATIONS } = load('TripScheduleCatalog');
const { cityDestinationIds, tripCityOptions, tripDestinationCatalog, defaultTripPeriod, periodOnDay, calendarMonth, planTripVisits, recentTripRate } = load('tripPlanning');
const { createDemoTrips } = load('demoTrips');
const plain = value => JSON.parse(JSON.stringify(value));
const catalog = tripDestinationCatalog([...KURMANGAZY_DESTINATIONS, ...SCHEDULE_DESTINATIONS]);

test('schedule city selection includes all matching sites without confusing Алматы district in Актобе with Алматы city', () => {
  const aktobe = cityDestinationIds('Актобе', catalog);
  const almaty = cityDestinationIds('Алматы', catalog);
  assert.equal(aktobe.length, 5);
  assert.equal(almaty.length, 6);
  assert.ok(aktobe.some(name => name.includes('района Алматы города Актобе')));
  assert.ok(aktobe.every(id => !almaty.includes(id)));
  assert.equal(cityDestinationIds('Павлодар', catalog).length, 3);
  assert.equal(new Set(cityDestinationIds('Павлодар', catalog)).size, 3);
  assert.equal(cityDestinationIds('Астана', catalog).length, 0);
  assert.equal(catalog.length, 40);
  assert.ok(SCHEDULE_DESTINATIONS.every(entry => entry.sourceCells && entry.source));
});

test('company objects with different addresses remain separate, regional-only addresses are never assigned a city', () => {
  const options = tripDestinationCatalog([], [{ name: 'Областное управление', address: 'Атырауская область' }], [
    { id: 1, name: 'Офис', address: 'г. Алматы, ул. Абая, 1' },
    { id: 2, name: 'Офис', address: 'г. Алматы, ул. Абая, 2' },
  ]);
  const ids = cityDestinationIds('Алматы', options);
  assert.equal(ids.length, 2);
  const stops = organizationTripStops(ids, options);
  assert.ok(stops[0].destination.includes('Абая, 1'));
  assert.ok(stops[1].destination.includes('Абая, 2'));
  assert.equal(cityDestinationIds('Атырау', options).length, 0);
  const cities = tripCityOptions(options);
  assert.equal(cities[0].id, 'Алматы');
  assert.equal(cities[0].count, 2);
});

test('tomorrow default and duration shortcuts cross month and year boundaries with preserved time', () => {
  const defaults = defaultTripPeriod(new Date(2026, 11, 31, 23));
  assert.equal(defaults.start.getFullYear(), 2027);
  assert.equal(defaults.start.getDate(), 1);
  assert.equal(defaults.start.getHours(), 9);
  assert.equal(defaults.end.getHours(), 18);
  const period = periodOnDay(new Date(2028, 1, 28), 3, { start: new Date(2026, 0, 1, 8, 30), end: new Date(2026, 0, 1, 17, 45) });
  assert.equal(period.end.getMonth(), 2);
  assert.equal(period.end.getDate(), 1);
  assert.equal(period.start.getHours(), 8);
  assert.equal(period.end.getMinutes(), 45);
});

test('calendar begins on Monday and includes leap day and adjacent month dates', () => {
  const days = calendarMonth(new Date(2028, 1, 12));
  assert.equal(days.length, 42);
  assert.equal(days[0].getDay(), 1);
  assert.ok(days.some(day => day.getMonth() === 1 && day.getDate() === 29));
  assert.equal(new Set(days.map(Number)).size, 42);
});

test('automatic visits are unique and ordered within daytime windows and supplied trip bounds', () => {
  const stops = Array.from({ length: 30 }, (_, id) => ({ id }));
  const start = new Date(2026, 10, 28, 12);
  const end = new Date(2026, 10, 30, 15);
  const route = planTripVisits(stops, start, end);
  const times = route.map(stop => new Date(stop.plannedAt));
  assert.equal(new Set(times.map(Number)).size, 30);
  assert.ok(times.every(time => time >= start && time <= end && time.getHours() >= 9 && time.getHours() < 18));
  assert.ok(times.every((time, index) => !index || time > times[index - 1]));
  const short = planTripVisits(stops.slice(0, 2), start, new Date(+start + 10000));
  assert.notEqual(short[0].plannedAt, short[1].plannedAt);
  assert.ok(planTripVisits(stops, null, end).every(stop => stop.plannedAt === null));
});

test('reuse only the latest employee-requested rate including zero; do not copy expenses or manager offers', () => {
  const offers = [
    { selfRequested: true, createdAt: '2026-11-01', estimate: { dailyRate: 5000, transport: 10000 } },
    { selfRequested: true, createdAt: '2026-11-02', estimate: { dailyRate: 0 } },
    { selfRequested: false, createdAt: '2026-11-03', dailyRate: 100000 },
  ];
  assert.equal(recentTripRate(offers), 0);
  assert.equal(recentTripRate([]), null);
});

test('city autofill and automatic visit plan survive submission, approval and reload', async () => {
  const values = new Map();
  const storage = { getItem: async key => values.get(key), setItem: async (key, value) => values.set(key, value) };
  const stops = organizationTripStops(cityDestinationIds('Актобе', catalog), catalog);
  const start = new Date(2026, 10, 28, 9); const end = new Date(2026, 10, 30, 18);
  const route = planTripVisits(stops, start, end);
  const { offer } = await createDemoTrips(storage)('employee', '/trip-offers', { method: 'POST', body: {
    requestId: 'schedule-city-autofill', purpose: 'Обслуживание', dailyRate: 0,
    plannedStart: start.toISOString(), plannedEnd: end.toISOString(),
    destinations: stops.map(stop => stop.destination), visitTimes: route.map(stop => stop.plannedAt),
  } });
  const { offer: checked } = await createDemoTrips(storage)('accountant', `/trip-offers/${offer.id}/approval`, { method: 'POST', body: {
    stage: 1, action: 'approve', expectedRevision: offer.revision,
  } });
  const { offer: approved } = await createDemoTrips(storage)('manager', `/trip-offers/${offer.id}/approval`, { method: 'POST', body: {
    stage: 2, action: 'approve', expectedRevision: checked.revision,
  } });
  const { trip } = await createDemoTrips(storage)('employee', `/trips/${approved.tripId}/report`);
  assert.deepEqual(plain(trip.stops.map(stop => stop.destination)), plain(stops.map(stop => stop.destination)));
  assert.deepEqual(plain(trip.stops.map(stop => stop.plannedAt)), plain(route.map(stop => stop.plannedAt)));
});
