export const VISIT_DWELL_MS = 60000;
export const VISIT_MAX_GAP_MS = 30000;
export const visitSiteKey = value => String(value).normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
const validPoint = point => Number.isFinite(point?.latitude) && Math.abs(point.latitude) <= 90
  && Number.isFinite(point?.longitude) && Math.abs(point.longitude) <= 180;
export const validVisitLocation = point => validPoint(point) && Number.isInteger(point.radius)
  && point.radius >= 50 && point.radius <= 300;
export function visitDistance(a, b) {
  const rad = value => value * Math.PI / 180;
  const h = Math.sin(rad(b.latitude - a.latitude) / 2) ** 2
    + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(rad(b.longitude - a.longitude) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
export function visitFixError(fix, now = Date.now()) {
  if (!validPoint(fix) || fix.mocked || !Number.isFinite(fix.accuracy) || fix.accuracy < 0 || fix.accuracy > 50) {
    return 'Нужен точный сигнал GPS: погрешность не более 50 м. Отметка пока не поставлена.';
  }
  const age = now - Date.parse(fix.capturedAt);
  return !Number.isFinite(age) || age < -5000 || age > VISIT_MAX_GAP_MS
    ? 'Ожидаем свежую геопозицию. Отметка пока не поставлена.' : '';
}
export function tripVisitPeriodError(trip, now = Date.now()) {
  const day = value => new Date(value).toLocaleDateString('en-CA', { timeZone: 'Asia/Almaty' });
  const start = Date.parse(trip.plannedStart); const end = Date.parse(trip.plannedEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'Уточните даты поездки перед автоотметкой.';
  const today = day(now);
  return today < day(start) || today > day(end) ? 'Автоотметка доступна в даты согласованной поездки.' : '';
}
export function visitCandidate(stops, fix, now = Date.now()) {
  const error = visitFixError(fix, now);
  if (error) return { error };
  // Include completed stops too: adjacent organizations must not be silently marked in sequence.
  const nearby = stops.filter(stop => validVisitLocation(stop.visitLocation)
    && visitDistance(stop.visitLocation, fix) <= stop.visitLocation.radius + fix.accuracy);
  if (nearby.length > 1) return { error: 'Рядом несколько точек маршрута. Руководителю нужно уточнить их расположение или радиус.' };
  const stop = nearby[0];
  if (!stop || stop.visitedAt || stop.skippedAt) return { error: 'Ждём прибытия к следующему объекту.' };
  const distance = visitDistance(stop.visitLocation, fix);
  if (distance + fix.accuracy > stop.visitLocation.radius) return { error: 'Вы у границы объекта. Ждём более точную геопозицию.' };
  return { stop, distance };
}
export function advanceVisitWindow(previous, stops, fix, now = Date.now()) {
  const candidate = visitCandidate(stops, fix, now);
  if (!candidate.stop) return { window: null, error: candidate.error };
  const { stop } = candidate; const at = Date.parse(fix.capturedAt);
  const old = previous?.stopId === stop.id && previous.siteRevision === stop.visitLocation.revision ? previous : null;
  const lastAt = old ? Date.parse(old.fixes[old.fixes.length - 1].capturedAt) : 0;
  if (old && at <= lastAt) return { window: old, error: 'Ждём следующего измерения GPS.' };
  const fixes = old && at - lastAt <= VISIT_MAX_GAP_MS ? [...old.fixes, fix] : [fix];
  const window = { stopId: stop.id, siteRevision: stop.visitLocation.revision, fixes };
  const elapsed = at - Date.parse(fixes[0].capturedAt);
  return { window, ready: elapsed >= VISIT_DWELL_MS && fixes.length >= 3,
    remaining: Math.max(0, Math.ceil((VISIT_DWELL_MS - elapsed) / 1000)), distance: candidate.distance };
}
export function validateVisitEvidence(trip, stop, proof, now = Date.now()) {
  const check = (value, message) => { if (!value) throw new Error(message); };
  check(!tripVisitPeriodError(trip, now), tripVisitPeriodError(trip, now));
  check(validVisitLocation(stop.visitLocation), 'Руководитель ещё не указал точное расположение объекта.');
  check(proof?.siteRevision === stop.visitLocation.revision, 'Расположение объекта изменилось. Начните проверку заново.');
  check(Array.isArray(proof.fixes) && proof.fixes.length >= 3 && proof.fixes.length <= 12, 'Нужно находиться у объекта не менее минуты.');
  const times = proof.fixes.map(fix => Date.parse(fix.capturedAt));
  check(now - times[0] <= 180000 && times[0] >= Date.parse(trip.startedAt), 'Начните проверку GPS заново.');
  check(times[times.length - 1] - times[0] >= VISIT_DWELL_MS, 'Нужно находиться у объекта не менее минуты.');
  proof.fixes.forEach((fix, index) => {
    const candidate = visitCandidate(trip.stops, fix, index === proof.fixes.length - 1 ? now : times[index]);
    check(candidate.stop?.id === stop.id, candidate.error || 'Геопозиция не соответствует объекту.');
    if (index) check(times[index] > times[index - 1] && times[index] - times[index - 1] <= VISIT_MAX_GAP_MS,
      'Проверка GPS прервалась. Останьтесь у объекта ещё на минуту.');
  });
  const last = proof.fixes[proof.fixes.length - 1];
  return { method: 'gps', startedAt: proof.fixes[0].capturedAt, capturedAt: last.capturedAt,
    durationSeconds: Math.floor((times[times.length - 1] - times[0]) / 1000), samples: proof.fixes.length,
    latitude: last.latitude, longitude: last.longitude, accuracy: last.accuracy,
    distance: Math.round(visitDistance(stop.visitLocation, last)), location: { ...stop.visitLocation } };
}
