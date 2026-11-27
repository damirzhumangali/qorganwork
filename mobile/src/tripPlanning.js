import { organizationKey, TRIP_PLACES, tripSiteLocation } from './TripDestinations';

export const DEFAULT_TRIP_PURPOSE = 'Техническое обслуживание оборудования';

export function tripDestinationCatalog(base, organizations = [], objects = []) {
  const catalog = new Map(base.map(option => [organizationKey(option.label), option]));
  for (const { name, city, address } of organizations) {
    const key = organizationKey(name);
    const existing = catalog.get(key);
    catalog.set(key, existing ? { ...existing, ...(city ? { city } : {}), ...(address ? { address } : {}) }
      : { id: name, label: name, city, address, detail: address || city });
  }
  for (const object of objects) {
    const city = object.city || tripSiteLocation(object.address).city;
    const label = [object.name, object.address].filter(Boolean).join(' · ');
    // An address distinguishes two buildings of the same organization.
    catalog.set(organizationKey(label), { id: label, label, city, address: object.address,
      shortLabel: label, detail: city ? `${city} · объект из справочника` : 'Объект из справочника' });
  }
  return [...catalog.values()];
}

export function recentTripRate(offers = []) {
  const latest = offers.filter(offer => offer.selfRequested && Number.isFinite(offer.estimate?.dailyRate ?? offer.dailyRate))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  return latest ? latest.estimate?.dailyRate ?? latest.dailyRate : null;
}

export function cityDestinationIds(city, options) {
  if (!city) return [];
  return options.filter(option => organizationKey(option.city || tripSiteLocation(option.address).city)
    === organizationKey(city)).map(option => option.id);
}

export function tripCityOptions(options) {
  const cities = new Set([...TRIP_PLACES.map(place => place.label),
    ...options.map(option => option.city || tripSiteLocation(option.address).city).filter(Boolean)]);
  return [...cities].map(city => {
    const count = cityDestinationIds(city, options).length;
    return { id: city, label: city, count,
      detail: count ? `Организации и объекты · ${count}` : 'Объекты пока не привязаны к этому городу' };
  }).sort((a, b) => Boolean(b.count) - Boolean(a.count) || a.label.localeCompare(b.label, 'ru'));
}

export function defaultTripPeriod(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9);
  const end = new Date(start); end.setHours(18);
  return { start, end };
}

export function periodOnDay(day, days = 1, current = {}) {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(),
    current.start?.getHours() ?? 9, current.start?.getMinutes() ?? 0);
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + days - 1,
    current.end?.getHours() ?? 18, current.end?.getMinutes() ?? 0);
  if (end <= start) end.setTime(+start + 60 * 60 * 1000);
  return { start, end };
}

export function calendarMonth(date) {
  const first = new Date(date.getFullYear(), date.getMonth(), 1, 12);
  const offset = (first.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => new Date(first.getFullYear(), first.getMonth(), 1 - offset + index, 12));
}

// Draft visit times only: distributed over daytime windows, without claiming
// travel duration or availability. Any manual schedule stays under user control.
export function planTripVisits(stops, start, end) {
  const first = new Date(start); const last = new Date(end);
  if (!start || !end || !Number.isFinite(+first) || !Number.isFinite(+last) || last <= first) {
    return stops.map(stop => ({ id: stop.id, plannedAt: null }));
  }
  const windows = [];
  let day = new Date(first.getFullYear(), first.getMonth(), first.getDate(), 9);
  // Bound the draft planner even if a malformed period is entered.
  for (let i = 0; day <= last && i < 366; i++) {
    const finish = new Date(day); finish.setHours(18, 0, 0, 0);
    const from = Math.max(+day, +first); const to = Math.min(+finish, +last);
    if (to > from) windows.push({ from, to });
    day.setDate(day.getDate() + 1);
  }
  if (!windows.length) windows.push({ from: +first, to: +last });
  const total = windows.reduce((sum, window) => sum + window.to - window.from, 0);
  return stops.map((stop, index) => {
    let offset = index * total / Math.max(stops.length, 1);
    for (const window of windows) {
      const length = window.to - window.from;
      if (offset < length) {
        const precision = total / Math.max(stops.length, 1) >= 60000 ? 60000 : 1;
        return { id: stop.id, plannedAt: new Date(window.from + Math.floor(offset / precision) * precision).toISOString() };
      }
      offset -= length;
    }
    return { id: stop.id, plannedAt: last.toISOString() };
  });
}
