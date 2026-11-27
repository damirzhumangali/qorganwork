import { validVisitLocation, validateVisitEvidence, visitSiteKey } from './tripVisitRules';

const check = (value, message) => { if (!value) throw new Error(message); };
const copy = value => JSON.parse(JSON.stringify(value));
export function tripWithVisitSites(trip, sites = []) {
  return { ...trip, stops: (trip.stops ?? []).map(stop => ({ ...stop,
    visitLocation: sites.find(site => visitSiteKey(site.destination) === visitSiteKey(stop.destination))?.location ?? null })) };
}
export async function handleDemoVisits({ state, role, path, method, body, now, save }) {
  const match = path.match(/^\/trips\/([^/]+)\/stops\/([^/]+)(?:\/(location|undo))?$/);
  if (method !== 'POST' || !match) return null;
  const trip = state.trips.find(row => row.id === match[1]);
  const stop = trip?.stops.find(row => row.id === match[2]);
  check(stop, 'Точка маршрута не найдена.');
  const result = () => ({ stop: tripWithVisitSites(trip, state.visitSites).stops.find(row => row.id === stop.id) });
  const action = match[3]; const at = now(); const revision = stop.visitRevision ?? 0;
  if (action === 'location') {
    check(role === 'manager', 'Расположение объекта задаёт руководитель.');
    check(trip.status !== 'finished', 'Для завершённой поездки расположение не меняется.');
    check(validVisitLocation(body.location), 'Укажите точку объекта и радиус от 50 до 300 м.');
    const sites = state.visitSites ?? []; const key = visitSiteKey(stop.destination);
    const previous = sites.find(site => visitSiteKey(site.destination) === key);
    check((previous?.location.revision ?? 0) === body.expectedRevision, 'Точка уже изменена. Обновите карточку.');
    const location = { latitude: body.location.latitude, longitude: body.location.longitude, radius: body.location.radius,
      revision: (previous?.location.revision ?? 0) + 1, updatedAt: at, updatedBy: 'Демо-руководитель' };
    state.visitSites = [...sites.filter(site => visitSiteKey(site.destination) !== key), { destination: stop.destination, location,
      history: [...(previous?.history ?? []), ...(previous ? [previous.location] : [])] }];
    return save(result());
  }
  check(role === 'employee', 'Отметки поездки вносит сотрудник.');
  check(trip.status === 'active', 'Отметки доступны во время командировки.');
  check(typeof body.requestId === 'string' && body.requestId.length > 0, 'Обновите приложение перед отметкой.');
  if ((stop.visitHistory ?? []).some(event => event.requestId === body.requestId)) return copy(result());
  check(body.expectedRevision === revision, 'Отметка уже изменилась. Обновите карточку.');
  const history = { requestId: body.requestId, at, by: 'Демо-сотрудник',
    previous: { visitedAt: stop.visitedAt, skippedAt: stop.skippedAt, skipReason: stop.skipReason, visitEvidence: stop.visitEvidence ?? null } };
  if (action === 'undo') {
    check(stop.visitedAt || stop.skippedAt, 'Отметка уже отменена.');
    const reason = String(body.reason ?? '').trim(); check(reason && reason.length <= 500, 'Укажите причину отмены.');
    stop.visitedAt = null; stop.skippedAt = null; stop.skipReason = null; stop.visitEvidence = null;
    Object.assign(history, { action: 'undo', reason });
  } else {
    check(!stop.visitedAt && !stop.skippedAt, 'Эта остановка уже отмечена.');
    check(['auto_visit', 'skipped'].includes(body.outcome), 'Посещение подтверждается автоматически по GPS.');
    if (body.outcome === 'auto_visit') {
      const decorated = tripWithVisitSites(trip, state.visitSites);
      const current = decorated.stops.find(row => row.id === stop.id);
      stop.visitEvidence = validateVisitEvidence(decorated, current, body.evidence, Date.parse(at));
      stop.visitedAt = at;
    } else {
      const reason = String(body.reason ?? '').trim(); check(reason && reason.length <= 500, 'Укажите причину пропуска.');
      stop.skippedAt = at; stop.skipReason = reason;
    }
    history.action = body.outcome;
  }
  stop.visitHistory = [...(stop.visitHistory ?? []), history]; stop.visitRevision = revision + 1;
  return save(result());
}
