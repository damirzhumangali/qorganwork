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
const { KURMANGAZY_DESTINATIONS: catalog, organizationTripStops, tripSiteLocation, splitTripDestination } = load('TripDestinations');
const { tripFormTemplate } = load('TripFormTemplate');
const { createDemoTrips } = load('demoTrips');
const organization = suffix => catalog.find(item => item.shortLabel === `Акимат ${suffix}`).id;
const plain = value => JSON.parse(JSON.stringify(value));

test('organization locations use actual settlements, not district names or the regional capital', () => {
  const stops = organizationTripStops(['Макаш', 'Енбекши', 'Кигаш', 'Азгир'].map(organization), catalog, 'Атырау');
  assert.deepEqual(plain(stops.map(stop => stop.city)), ['Алга', 'Жумекен', 'Нурпеисовой', 'Балқұдық']);
  assert.equal(catalog.length, 17);
  assert.ok(catalog.every(item => item.city && item.source && item.detail));
});

test('changing or removing a selection derives fresh locations without a stale common city', () => {
  const first = organizationTripStops([organization('Макаш')], catalog, 'Астана');
  const next = organizationTripStops([organization('Енбекши')], catalog, 'Астана');
  assert.equal(first[0].city, 'Алга');
  assert.equal(next[0].city, 'Жумекен');
  assert.deepEqual(plain(organizationTripStops([], catalog, 'Астана')), []);
});

test('unknown organizations do not inherit another organization’s automatic location', () => {
  const names = [organization('Макаш'), 'Новая организация'];
  const automatic = organizationTripStops(names, catalog);
  assert.equal(automatic[1].city, '');
  assert.equal(automatic[1].destination, 'Новая организация');
  const withFallback = organizationTripStops(names, catalog, 'Алматы');
  assert.equal(withFallback[0].city, 'Алга');
  assert.equal(withFallback[1].city, 'Алматы');
  assert.equal(withFallback[1].automaticCity, '');
});

test('object addresses support cities, villages and railway settlements but not rural districts', () => {
  assert.equal(tripSiteLocation('Атырауская область, Курмангазинский район, с.о. Макаш, с.Алга, ул. Центральная, 1').city, 'Алга');
  assert.equal(tripSiteLocation('Казахстан, село Құрманғазы, ул. Абай, 2').city, 'Құрманғазы');
  assert.equal(tripSiteLocation('Атырауская область, рзд.Нурпеисовой, ул. Абай, 1').city, 'Нурпеисовой');
  assert.equal(tripSiteLocation('г. Алматы, ул. Абая, 2').city, 'Алматы');
  assert.equal(tripSiteLocation('Атырауская область, Курмангазинский район, с.о. Макаш').city, '');
  assert.equal(tripSiteLocation().city, '');
  assert.equal(tripSiteLocation(null).city, '');
  const companyPlace = { id: 'Участок', label: 'Участок', address: 'с.Орлы, ул. Новая, 2' };
  assert.equal(organizationTripStops(['Участок'], [companyPlace])[0].city, 'Орлы');
});

test('repeating a multi-settlement trip preserves organization identities, route order and visit dates', () => {
  const names = [organization('Енбекши'), organization('Макаш')];
  const stops = organizationTripStops(names, catalog).map((stop, index) => ({
    ...stop, plannedAt: `2026-11-2${8 + index}T05:00:00.000Z`,
  }));
  const draft = tripFormTemplate({ stops }, [], catalog);
  assert.deepEqual(plain(draft.organizations), names);
  assert.equal(draft.cityName, '');
  assert.deepEqual(plain(draft.visitSchedule.map(stop => stop.plannedAt)), plain(stops.map(stop => stop.plannedAt)));
  const repeated = organizationTripStops(draft.organizations, catalog, draft.cityName);
  assert.deepEqual(plain(repeated.map(stop => stop.destination)), plain(stops.map(stop => stop.destination)));
  assert.deepEqual(plain(repeated.map(stop => stop.id)), plain(draft.visitSchedule.map(stop => stop.id)));
});

test('unknown mixed-city stops and old single-city trips round-trip without duplicate prefixes', () => {
  const stops = [{ destination: `Алга · ${organization('Макаш')}` }, { destination: 'Алматы · Новый офис' }];
  const withCustomOrganization = [...catalog, { id: 'Новый офис', label: 'Новый офис', address: null }];
  const draft = tripFormTemplate({ stops }, [], withCustomOrganization);
  const repeated = organizationTripStops(draft.organizations, catalog, draft.cityName);
  assert.deepEqual(plain(repeated.map(stop => stop.destination)), stops.map(stop => stop.destination));
  const single = tripFormTemplate({ stops: [{ destination: 'Астана · Новый офис' }] }, [], catalog);
  assert.equal(single.cityName, 'Астана');
  assert.equal(organizationTripStops(single.organizations, catalog, single.cityName)[0].destination, 'Астана · Новый офис');
  assert.equal(splitTripDestination(`Құрманғазы · ${catalog[0].id}`).name, catalog[0].id);
});

test('distinct historical stops are not collapsed when they refer to the same organization', () => {
  const name = organization('Макаш');
  const stops = [{ destination: `Алга · ${name}` }, { destination: `Алматы · ${name}` }];
  const draft = tripFormTemplate({ stops }, [], catalog);
  assert.equal(new Set(draft.organizations).size, 2);
  const repeated = organizationTripStops(draft.organizations, catalog, draft.cityName);
  assert.deepEqual(plain(repeated.map(stop => stop.destination)), stops.map(stop => stop.destination));
});

test('automatic destinations persist through employee submission, manager approval and reload', async () => {
  const values = new Map();
  const storage = { getItem: async key => values.get(key), setItem: async (key, value) => values.set(key, value) };
  const routes = organizationTripStops([organization('Макаш'), organization('Енбекши')], catalog);
  let api = createDemoTrips(storage);
  const { offer } = await api('employee', '/trip-offers', { method: 'POST', body: {
    requestId: 'automatic-cities', purpose: 'Проверка оборудования', dailyRate: 10000,
    plannedStart: '2026-11-28T04:00:00.000Z', plannedEnd: '2026-11-29T13:00:00.000Z',
    destinations: routes.map(stop => stop.destination), visitTimes: ['2026-11-28T05:00:00.000Z', '2026-11-29T05:00:00.000Z'],
  } });
  api = createDemoTrips(storage);
  const { offer: approved } = await api('manager', `/trip-offers/${offer.id}/approval`, { method: 'POST', body: {
    stage: 1, action: 'approve', expectedRevision: offer.revision,
  } });
  const { trip } = await createDemoTrips(storage)('employee', `/trips/${approved.tripId}/report`);
  assert.deepEqual(plain(trip.stops.map(stop => stop.destination)), plain(routes.map(stop => stop.destination)));
});
