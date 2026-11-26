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
  const city = TRIP_CITIES.find(option => destination?.startsWith(option.label + separator))?.label;
  return city ? { city, name: destination.slice(city.length + separator.length) } : { name: destination };
}

export function tripSiteLocation(address = '') {
  const parts = address.split(/[,;·\n]/u).map(part => part.trim()).filter(Boolean);
  const namedCity = parts.map(part => /^(?:город\s+|г\.\s*)(.+)$/iu.exec(part)?.[1]).find(Boolean);
  const knownCity = TRIP_CITIES.find(({ label }) => parts.some(part => organizationKey(part) === organizationKey(label)));
  const city = namedCity ? TRIP_CITIES.find(({ label }) => organizationKey(label) === organizationKey(namedCity))?.label ?? namedCity
    : knownCity?.label ?? '';
  const region = parts.find(part => /(?:\sобласть|\sобл\.?)$/iu.test(part)) ?? '';
  return { city, region };
}

export function organizationKey(name) {
  return name.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}

export const KURMANGAZY_DESTINATIONS = [
  'Аппарат акима сельского округа Курмангазы',
  'Отдел строительства',
  'Отдел занятости, социальных программ и регистрации актов гражданского состояния',
  'Аппарат акима сельского округа Орлы',
  'Аппарат акима сельского округа Макаш',
  'Аппарат акима сельского округа Енбекши',
  'Аппарат акима сельского округа Тениз',
  'Аппарат акима Бирликского сельского округа',
  'Аппарат акима сельского округа Кигаш',
  'Аппарат акима сельского округа Коптогай',
  'Аппарат акима сельского округа Бөкейхан',
  'Аппарат акима сельского округа Шортанбай',
  'Аппарат акима сельского округа Кудряшов',
  'Аппарат акима сельского округа Сафон',
  'Аппарат акима сельского округа Асан',
  'Аппарат акима сельского округа Азгир',
  'Аппарат акима сельского округа Суюндук',
].map(name => {
  const label = `ГУ «${name} ${district}»`;
  const shortLabel = name.replace('Аппарат акима сельского округа ', 'Акимат ')
    .replace('Аппарат акима Бирликского сельского округа', 'Акимат Бирлика')
    .replace('Отдел занятости, социальных программ и регистрации актов гражданского состояния', 'Отдел занятости и социальных программ');
  return { id: label, label, shortLabel };
});
