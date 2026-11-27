import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { createDemoVisitRunner, notifyDemoVisitChanges } from './demoVisitRuntime';

export default function useDemoAutoVisits(enabled, request) {
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!enabled) { setNotice(null); setError(''); return; }
    let noticeTimer;
    const runner = createDemoVisitRunner({
      sync: () => request('/demo/visits/sync', { method: 'POST', body: {} }),
      isActive: () => AppState.currentState === 'active'
        && (Platform.OS !== 'web' || document.visibilityState === 'visible'),
      onResult: result => {
        setError('');
        if (result.changed) notifyDemoVisitChanges();
        if (result.marked > 0) {
          setNotice(result.lastVisit ? { ...result.lastVisit, marked: result.marked } : { marked: result.marked });
          clearTimeout(noticeTimer);
          noticeTimer = setTimeout(() => setNotice(null), 15000);
        }
      },
      onError: failure => setError(failure.message || 'Не удалось сохранить демо-отметку. Повторим автоматически.'),
    });
    const resume = () => { void runner.tick(); };
    const subscription = AppState.addEventListener('change', resume);
    if (Platform.OS === 'web') {
      document.addEventListener('visibilitychange', resume);
      window.addEventListener('focus', resume);
    }
    const timer = setInterval(resume, 2000);
    resume();
    return () => {
      runner.stop(); clearInterval(timer); clearTimeout(noticeTimer); subscription.remove();
      if (Platform.OS === 'web') {
        document.removeEventListener('visibilitychange', resume);
        window.removeEventListener('focus', resume);
      }
    };
  }, [enabled, request]);
  return { notice, error };
}
