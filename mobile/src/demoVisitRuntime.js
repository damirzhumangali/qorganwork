const listeners = new Set();
export function subscribeDemoVisitChanges(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function notifyDemoVisitChanges() {
  for (const listener of listeners) listener();
}

// The browser does not run reliably while locked. Each sync reconciles the
// persisted demo schedule, including elapsed time while JavaScript was asleep.
export function createDemoVisitRunner({ sync, isActive, onResult, onError }) {
  let running = false; let stopped = false;
  return {
    async tick() {
      if (stopped || running || !isActive()) return;
      running = true;
      try {
        const result = await sync();
        if (!stopped) onResult(result);
      } catch (error) {
        if (!stopped) onError(error);
      } finally { running = false; }
    },
    stop() { stopped = true; },
  };
}
