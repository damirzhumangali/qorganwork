import React, { useEffect, useRef, useState } from 'react';
import { AppState, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import MapView, { Circle, Marker } from './MapView';
import { getVisitPosition } from './visitPosition';
import { advanceVisitWindow, tripVisitPeriodError, validVisitLocation } from './tripVisitRules';
import { colors } from './ui';

function Action({ children, onPress, disabled, label }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
    style={[styles.button, disabled && { opacity: 0.5 }]}><Text style={styles.link}>{children}</Text></Pressable>;
}
const foreground = () => AppState.currentState === 'active'
  && (Platform.OS !== 'web' || document.visibilityState === 'visible');

export default function TripAutoVisits({ trip, onRecord, busy, offline }) {
  const [enabled, setEnabled] = useState(false); const [message, setMessage] = useState('');
  const latest = useRef({ trip, onRecord, busy, offline }); latest.current = { trip, onRecord, busy, offline };
  const remaining = trip.stops.filter(stop => !stop.visitedAt && !stop.skippedAt);
  const configured = remaining.filter(stop => validVisitLocation(stop.visitLocation)).length;
  const periodError = tripVisitPeriodError(trip);
  useEffect(() => {
    if (!enabled) return;
    let ended = false; let timer; let window = null; let generation = 0;
    const clear = () => { window = null; generation++; };
    const pause = () => { clear(); if (!ended) setMessage(foreground() ? 'Проверка возобновляется. Ожидаем GPS…' : 'Пауза: откройте поездку и оставьте экран активным.'); };
    const subscription = AppState.addEventListener('change', pause);
    if (Platform.OS === 'web') document.addEventListener('visibilitychange', pause);
    async function poll() {
      try {
        const current = latest.current;
        if (!foreground() || current.busy || current.offline) { clear(); return; }
        if (current.trip.status !== 'active') { setEnabled(false); return; }
        const period = tripVisitPeriodError(current.trip);
        if (period) { clear(); setMessage(period); return; }
        if (!current.trip.stops.some(stop => !stop.visitedAt && !stop.skippedAt && validVisitLocation(stop.visitLocation))) {
          clear(); setMessage('Нет оставшихся объектов с настроенной точкой GPS.'); setEnabled(false); return;
        }
        const token = generation;
        const fix = await getVisitPosition();
        if (ended || token !== generation || !foreground()) return;
        const newest = latest.current;
        if (newest.offline || newest.busy || newest.trip.status !== 'active') { clear(); return; }
        const next = advanceVisitWindow(window, newest.trip.stops, fix);
        window = next.window;
        if (next.error) { setMessage(next.error); return; }
        const stop = newest.trip.stops.find(row => row.id === window.stopId);
        setMessage(`Рядом с объектом: ${stop.destination}. До автоотметки: ${next.remaining} сек.`);
        if (next.ready) {
          const proof = window; clear();
          const saved = await newest.onRecord(stop.id, { outcome: 'auto_visit', requestId: randomUUID(),
            expectedRevision: stop.visitRevision ?? 0, evidence: { siteRevision: proof.siteRevision, fixes: proof.fixes } });
          if (!ended) {
            setMessage(saved ? `Посещение отмечено автоматически: ${stop.destination}` : 'Не удалось сохранить отметку. Проверьте сообщение ниже и включите автоотметку снова.');
            if (!saved) setEnabled(false);
          }
        }
      } catch (error) {
        clear(); if (!ended) { setMessage(error.message || 'Не удалось проверить GPS.'); setEnabled(false); }
      } finally { if (!ended) timer = setTimeout(poll, 15000); }
    }
    setMessage('Определяем геопозицию…'); void poll();
    return () => { ended = true; clear(); clearTimeout(timer); subscription.remove();
      if (Platform.OS === 'web') document.removeEventListener('visibilitychange', pause); };
  }, [enabled, trip.id]);
  return <View style={styles.panel}>
    <Text accessibilityRole="header" style={styles.title}>Автоматическое посещение</Text>
    <Text style={styles.text}>Разрешите GPS один раз. Объект отметится сам после минуты рядом с ним при точности до 50 м.</Text>
    <Text style={styles.text}>Проверка работает, пока эта поездка открыта и экран активен. Координаты сохраняются только с отметкой посещения.</Text>
    {!remaining.length ? <Text style={styles.text}>Все точки маршрута уже обработаны.</Text>
      : !configured && <Text style={styles.warning}>Для оставшихся объектов руководитель ещё не настроил расположение. До этого автоотметка недоступна.</Text>}
    {periodError ? <Text style={styles.warning}>{periodError}</Text> : null}
    {offline && <Text style={styles.warning}>Нет связи. Проверка приостановлена.</Text>}
    {message ? <Text accessibilityLiveRegion="polite" style={styles.text}>{message}</Text> : null}
    <Action disabled={!enabled && (!configured || Boolean(periodError) || busy || offline)}
      onPress={() => setEnabled(value => !value)}>{enabled ? 'Остановить автоотметку' : 'Включить автоотметку'}</Action>
  </View>;
}

export function TripVisitStopControls({ stop, employee, manager, active, busy, onLocation, onUndo }) {
  const [mode, setMode] = useState(null); const [reason, setReason] = useState('');
  const [latitude, setLatitude] = useState(''); const [longitude, setLongitude] = useState(''); const [radius, setRadius] = useState('150');
  const [saving, setSaving] = useState(false); const lock = useRef(false);
  const location = { latitude: latitude.trim() ? Number(latitude.replace(',', '.')) : NaN,
    longitude: longitude.trim() ? Number(longitude.replace(',', '.')) : NaN, radius: Number(radius) };
  const done = stop.visitedAt || stop.skippedAt;
  async function save(operation) {
    if (busy || lock.current) return; lock.current = true; setSaving(true);
    try { if (await operation()) setMode(null); } finally { lock.current = false; setSaving(false); }
  }
  const disabled = busy || saving;
  const history = (stop.visitHistory ?? []).filter(event => event.action === 'undo');
  return <View style={{ gap: 8 }}>
    {!done && <Text style={styles.text}>{stop.visitLocation ? `Зона объекта · ${stop.visitLocation.radius} м`
      : 'Расположение объекта ещё не настроено руководителем.'}</Text>}
    {stop.visitEvidence?.method === 'gps' && <Text style={styles.text}>GPS · расстояние {stop.visitEvidence.distance} м · точность ±{Math.round(stop.visitEvidence.accuracy)} м · рядом {stop.visitEvidence.durationSeconds} сек.</Text>}
    {history.length > 0 && <Text style={styles.warning}>Предыдущая отметка отменена: {history[history.length - 1].reason}. История сохранена.</Text>}
    {manager && !mode && <Action disabled={disabled} label={`Настроить GPS · ${stop.destination}`} onPress={() => {
      setLatitude(stop.visitLocation ? String(stop.visitLocation.latitude) : '');
      setLongitude(stop.visitLocation ? String(stop.visitLocation.longitude) : '');
      setRadius(String(stop.visitLocation?.radius ?? 150)); setMode('location');
    }}>{stop.visitLocation ? 'Изменить точку объекта' : 'Указать точку на карте'}</Action>}
    {employee && active && done && !mode && <Action disabled={disabled} label={`Отменить отметку · ${stop.destination}`}
      onPress={() => { setReason(''); setMode('undo'); }}>Ошибочная отметка</Action>}
    {mode === 'location' && <View style={styles.panel}>
      <Text style={styles.text}>Нажмите на здание на карте или введите его координаты. Точка запомнится для следующих поездок в эту организацию.</Text>
      <MapView accessibilityLabel="Карта расположения объекта" initialRegion={{ latitude: stop.visitLocation?.latitude ?? 48.5,
        longitude: stop.visitLocation?.longitude ?? 67, latitudeDelta: 10, longitudeDelta: 20 }}
        initialZoom={stop.visitLocation ? 16 : 5} style={{ height: 240 }} onPress={event => {
          if (disabled) return;
          setLatitude(event.nativeEvent.coordinate.latitude.toFixed(6)); setLongitude(event.nativeEvent.coordinate.longitude.toFixed(6));
        }}>
        {validVisitLocation(location) && <><Marker coordinate={location} title="Объект" /><Circle center={location} radius={location.radius} /></>}
      </MapView>
      <TextInput accessibilityLabel="Широта объекта" value={latitude} onChangeText={setLatitude} editable={!disabled} placeholder="Широта, например 50.2839" style={styles.input} />
      <TextInput accessibilityLabel="Долгота объекта" value={longitude} onChangeText={setLongitude} editable={!disabled} placeholder="Долгота, например 57.1670" style={styles.input} />
      <Text style={styles.text}>Радиус объекта, м · от 50 до 300</Text>
      <TextInput accessibilityLabel="Радиус объекта, м" value={radius} onChangeText={setRadius} keyboardType="numeric" editable={!disabled} style={styles.input} />
      <Action disabled={disabled || !validVisitLocation(location)} onPress={() => save(() => onLocation(stop.id,
        { location, expectedRevision: stop.visitLocation?.revision ?? 0 }))}>Сохранить расположение</Action>
      <Action disabled={disabled} onPress={() => setMode(null)}>Отмена</Action>
    </View>}
    {mode === 'undo' && <View style={styles.panel}>
      <Text style={styles.text}>Отметка будет отменена, а причина останется в истории поездки.</Text>
      <TextInput accessibilityLabel="Причина отмены отметки" value={reason} onChangeText={setReason} editable={!disabled}
        maxLength={500} multiline placeholder="Например: отметил по ошибке, ещё не был на объекте" style={styles.input} />
      <Action disabled={disabled || !reason.trim()} onPress={() => save(() => onUndo(stop.id, { reason: reason.trim(),
        requestId: randomUUID(), expectedRevision: stop.visitRevision ?? 0 }))}>Подтвердить отмену отметки</Action>
      <Action disabled={disabled} onPress={() => setMode(null)}>Оставить отметку</Action>
    </View>}
  </View>;
}
const styles = StyleSheet.create({
  panel: { padding: 12, borderRadius: 12, backgroundColor: '#EEF5FF', gap: 10 },
  title: { fontSize: 15, color: colors.ink, fontWeight: '700' },
  text: { fontSize: 13, color: '#536680', lineHeight: 19 }, warning: { color: '#80550F', fontSize: 13, lineHeight: 19 },
  button: { minHeight: 44, padding: 10, justifyContent: 'center', alignItems: 'center', borderRadius: 9, backgroundColor: '#DCEBFF' },
  link: { color: '#185DB0', fontSize: 14, fontWeight: '600' },
  input: { backgroundColor: '#fff', borderRadius: 8, borderColor: colors.border, borderWidth: 1, minHeight: 44, padding: 10, color: colors.ink },
});
