const district = 'Курмангазинского района Атырауской области';

export const TRIP_CITIES = [
  'Актау',
  'Актобе',
  'Алматы',
  'Астана',
  'Атырау',
  'Жезказган',
  'Караганда',
  'Кокшетау',
  'Конаев',
  'Костанай',
  'Кульсары',
  'Кызылорда',
  'Павлодар',
  'Петропавловск',
  'Семей',
  'Талдыкорган',
  'Тараз',
  'Туркестан',
  'Уральск',
  'Усть-Каменогорск',
  'Шымкент',
].map(city => ({ id: city, label: city }));

export function splitTripDestination(destination) {
  const lineBreak = destination?.indexOf('\n') ?? -1;
  if (lineBreak > 0) {
    const address = destination.slice(lineBreak + 1);
    return { name: destination.slice(0, lineBreak), address, ...tripSiteLocation(address) };
  }
  const separator = ' · ';
  const city = TRIP_PLACES.find(option => destination?.startsWith(option.label + separator))?.label;
  return city ? { city, name: destination.slice(city.length + separator.length) } : { name: destination };
}

export function tripSiteLocation(address = '') {
  const parts = (address ?? '').split(/[,;·\n]/u).map(part => part.trim()).filter(Boolean);
  const namedCity = parts.map(part => /^(?:город\s+|г\.\s*|село\s+|с\.(?!\s*о\.)\s*|пос[её]лок\s+|п\.\s*|разъезд\s+|рзд\.\s*)(.+)$/iu.exec(part)?.[1]).find(Boolean);
  const knownCity = TRIP_PLACES.find(({ label }) => parts.some(part => organizationKey(part) === organizationKey(label)));
  const city = namedCity ? TRIP_PLACES.find(({ label }) => organizationKey(label) === organizationKey(namedCity))?.label ?? namedCity
    : knownCity?.label ?? '';
  const region = parts.find(part => /(?:\sобласть|\sобл\.?)$/iu.test(part)) ?? '';
  return { city, region };
}

export function organizationKey(name) {
  return name.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}

// Organization names are stable IDs used by saved trips. Locations were checked
// against the linked public registers on 2026-11-27; district names are not cities.
// Ганюшкино was renamed Құрманғазы: https://old.adilet.zan.kz/rus/docs/V18T0004087
export const KURMANGAZY_DESTINATIONS = [
  ['Аппарат акима сельского округа Курмангазы', 'Құрманғазы', 'https://old.goszakup.gov.kz/ru/registry/show_supplier/22717'],
  ['Отдел строительства', 'Құрманғазы', 'https://old.goszakup.gov.kz/ru/registry/show_supplier/62902'],
  ['Отдел занятости, социальных программ и регистрации актов гражданского состояния', 'Құрманғазы', 'https://www.gov.kz/article/691?lang=ru'],
  ['Аппарат акима сельского округа Орлы', 'Орлы', 'https://www.gov.kz/org/atyrau-kurmangazy-orly/press/news/details/993948?lang=ru'],
  ['Аппарат акима сельского округа Макаш', 'Алга', 'https://old.goszakup.gov.kz/kz/announce/index/17468796'],
  ['Аппарат акима сельского округа Енбекши', 'Жумекен', 'https://old.goszakup.gov.kz/ru/registry/show_supplier/25463'],
  ['Аппарат акима сельского округа Тениз', 'Теңіз', 'https://old.goszakup.gov.kz/ru/registry/show_supplier/56314'],
  ['Аппарат акима Бирликского сельского округа', 'Бирлик', 'https://old.goszakup.gov.kz/ru/registry/show_supplier/60616'],
  ['Аппарат акима сельского округа Кигаш', 'Нурпеисовой', 'https://old.goszakup.gov.kz/ru/registry/show_supplier/44912', 'разъезд'],
  ['Аппарат акима сельского округа Коптогай', 'Коптогай', 'https://old.goszakup.gov.kz/ru/registry/show_supplier/49191'],
  ['Аппарат акима сельского округа Бөкейхан', 'Бөкейхан', 'https://old.goszakup.gov.kz/ru/registry/show_supplier/61263'],
  ['Аппарат акима сельского округа Шортанбай', 'Шортанбай', 'https://old.goszakup.gov.kz/ru/registry/show_supplier/25207'],
  ['Аппарат акима сельского округа Кудряшов', 'Кудряшево', 'https://old.goszakup.gov.kz/ru/registry/show_supplier/47731'],
  ['Аппарат акима сельского округа Сафон', 'Сафоновка', 'https://procurement.gov.kz/ru/registry/show_supplier/51471'],
  ['Аппарат акима сельского округа Асан', 'Асан', 'https://goszakup.gov.kz/ru/announce/index/15254075'],
  ['Аппарат акима сельского округа Азгир', 'Балқұдық', 'https://old.goszakup.gov.kz/kz/registry/show_supplier/67447'],
  ['Аппарат акима сельского округа Суюндук', 'Суюндук', 'https://old.goszakup.gov.kz/ru/announce/index/16010079'],
].map(([name, city, source, settlementType = 'село']) => {
  const label = `ГУ «${name} ${district}»`;
  const shortLabel = name.replace('Аппарат акима сельского округа ', 'Акимат ')
    .replace('Аппарат акима Бирликского сельского округа', 'Акимат Бирлика')
    .replace('Отдел занятости, социальных программ и регистрации актов гражданского состояния', 'Отдел занятости и социальных программ');
  return { id: label, label, shortLabel, city, source, region: 'Атырауская область',
    detail: `${settlementType} ${city} · Атырауская область` };
});

export const TRIP_PLACES = [...TRIP_CITIES, ...Array.from(new Set(KURMANGAZY_DESTINATIONS.map(place => place.city)))
  .map(city => ({ id: city, label: city }))];

export function organizationTripStops(names, options, fallbackCity = '') {
  const catalog = new Map(options.map(option => [organizationKey(option.label), option]));
  return names.map(name => {
    const option = catalog.get(organizationKey(name));
    const recorded = splitTripDestination(name);
    const automaticCity = option?.city || tripSiteLocation(option?.address).city || recorded.city || '';
    const city = automaticCity || fallbackCity;
    return { id: `organizations:${name}`, name: recorded.name, city, automaticCity,
      destination: city ? `${city} · ${recorded.city ? recorded.name : name}` : name };
  });
}
