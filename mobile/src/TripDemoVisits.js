import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { DEMO_VISIT_INTERVAL_MS, isDemoVisitSuppressed, nextDemoVisit } from './demoVisitSimulation';
import { Icon, colors } from './ui';

export default function TripDemoVisits({ trip }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const next = nextDemoVisit(trip);
  const seconds = next ? Math.max(0, Math.ceil((Date.parse(next.scheduledAt) - now) / 1000)) : 0;
  const marked = trip.stops.filter(stop => stop.visitEvidence?.method === 'demo_simulation').length;
  const suppressed = trip.stops.some(isDemoVisitSuppressed);
  const started = Boolean(trip.demoAutoVisit);
  const title = !started ? 'Автоотметка запускается…' : !next ? suppressed ? 'Есть отменённые отметки'
    : marked ? 'Посещения отмечены автоматически' : 'Все точки обработаны'
    : seconds > DEMO_VISIT_INTERVAL_MS / 1000 - 8 ? 'Определяем местоположение…'
      : seconds > 5 ? 'Местоположение определено' : seconds > 0 ? 'Объект соответствует маршруту' : 'Сохраняем автоотметку…';
  return <View style={styles.panel}>
    <View style={styles.row}><Icon name="pin" color="#17694B" size={20} />
      <Text style={styles.badge}>ДЕМО · ИМИТАЦИЯ МЕСТОПОЛОЖЕНИЯ</Text></View>
    <Text accessibilityRole="header" style={styles.title}>{title}</Text>
    {next && <Text style={styles.destination}>{next.destination}</Text>}
    {next && seconds > 0 && <Text style={styles.countdown}>Автоотметка через {seconds} сек.</Text>}
    <Text style={styles.text}>После начала поездки объекты отмечаются по очереди каждые 20 секунд, в любом разделе. Открывать поездку и включать проверку не нужно.</Text>
    <Text style={styles.text}>Это учебный сценарий: настоящий GPS не проверяется. После блокировки телефона или закрытия страницы отметки восстановятся при возвращении в приложение.</Text>
    {suppressed && <Text style={styles.warning}>Отменённые отметки не ставятся повторно. Если объект не посещён, укажите причину пропуска.</Text>}
  </View>;
}
const styles = StyleSheet.create({
  panel: { padding: 14, borderRadius: 14, backgroundColor: '#ECF8F2', gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge: { flex: 1, fontSize: 12, fontWeight: '700', color: '#17694B', lineHeight: 17 },
  title: { fontSize: 17, fontWeight: '700', color: colors.ink },
  destination: { fontSize: 14, fontWeight: '600', color: colors.ink, lineHeight: 20 },
  countdown: { fontSize: 14, color: '#17694B', fontWeight: '600' },
  text: { fontSize: 13, color: '#4E665C', lineHeight: 19 },
  warning: { fontSize: 13, color: '#80550F', lineHeight: 19 },
});
