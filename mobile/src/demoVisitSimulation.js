// Demo-only elapsed-time scenario. This is not GPS, a background task, or proof of a real visit.
export const DEMO_VISIT_INTERVAL_MS = 20000;

export function isDemoVisitSuppressed(stop) {
  const history = stop.visitHistory ?? [];
  return history[history.length - 1]?.action === 'undo';
}

const canSimulate = stop => !stop.visitedAt && !stop.skippedAt && !isDemoVisitSuppressed(stop);

export function initializeDemoAutoVisit(trip, at) {
  if (trip.status !== 'active' || trip.demoAutoVisit) return false;
  const start = Date.parse(at);
  if (!Number.isFinite(start)) throw new Error('Не удалось определить время демо-сценария.');
  trip.demoAutoVisit = {
    version: 1, mode: 'simulation', startedAt: new Date(start).toISOString(), intervalMs: DEMO_VISIT_INTERVAL_MS,
    schedule: (trip.stops ?? []).filter(canSimulate).map((stop, index) => ({
      stopId: stop.id, scheduledAt: new Date(start + (index + 1) * DEMO_VISIT_INTERVAL_MS).toISOString(),
    })),
  };
  return true;
}

export function nextDemoVisit(trip) {
  if (trip.status !== 'active') return null;
  for (const entry of trip.demoAutoVisit?.schedule ?? []) {
    const stop = (trip.stops ?? []).find(row => row.id === entry.stopId);
    if (stop && canSimulate(stop)) return { ...entry, destination: stop.destination };
  }
  return null;
}

export function syncDemoVisitSimulation(trips, recordedAt) {
  const now = Date.parse(recordedAt);
  if (!Number.isFinite(now)) throw new Error('Не удалось определить время демо-сценария.');
  let changed = false; let marked = 0; let lastVisit;
  for (const trip of trips) {
    if (trip.status !== 'active') continue;
    changed = initializeDemoAutoVisit(trip, recordedAt) || changed;
    for (const entry of trip.demoAutoVisit.schedule) {
      if (Date.parse(entry.scheduledAt) > now) continue;
      const stop = (trip.stops ?? []).find(row => row.id === entry.stopId);
      if (!stop || !canSimulate(stop)) continue;
      const requestId = `demo-simulation:${trip.id}:${trip.demoAutoVisit.startedAt}:${stop.id}`;
      if ((stop.visitHistory ?? []).some(event => event.requestId === requestId)) continue;
      const previous = { visitedAt: stop.visitedAt ?? null, skippedAt: stop.skippedAt ?? null,
        skipReason: stop.skipReason ?? null, visitEvidence: stop.visitEvidence ?? null };
      stop.visitedAt = entry.scheduledAt;
      stop.visitEvidence = { method: 'demo_simulation', scheduledAt: entry.scheduledAt, recordedAt };
      stop.visitHistory = [...(stop.visitHistory ?? []), { requestId, action: 'demo_auto_visit',
        at: entry.scheduledAt, recordedAt, by: 'Демо-сценарий', previous }];
      stop.visitRevision = (stop.visitRevision ?? 0) + 1;
      lastVisit = { tripId: trip.id, stopId: stop.id, destination: stop.destination,
        scheduledAt: entry.scheduledAt, recordedAt };
      changed = true; marked++;
    }
  }
  return { changed, marked, ...(lastVisit ? { lastVisit } : {}) };
}
