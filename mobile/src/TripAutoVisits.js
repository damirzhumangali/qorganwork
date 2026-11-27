import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import MapView, { Circle, Marker } from './MapView';
import { validVisitLocation } from './tripVisitRules';
import { colors } from './ui';

function Action({ children, onPress, disabled, label }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
    style={[styles.button, disabled && { opacity: 0.5 }]}><Text style={styles.link}>{children}</Text></Pressable>;
}
export function TripVisitStopControls({ stop, employee, manager, active, busy, onLocation, onUndo, simulation = false }) {
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
    {!simulation && !done && <Text style={styles.text}>{stop.visitLocation ? `Зона объекта · ${stop.visitLocation.radius} м`
      : 'Расположение объекта ещё не настроено руководителем.'}</Text>}
    {stop.visitEvidence?.method === 'gps' && <Text style={styles.text}>GPS · расстояние {stop.visitEvidence.distance} м · точность ±{Math.round(stop.visitEvidence.accuracy)} м · рядом {stop.visitEvidence.durationSeconds} сек.</Text>}
    {stop.visitEvidence?.method === 'demo_simulation' && <Text style={styles.text}>Местоположение определено · демо. Учебная отметка без проверки настоящего GPS.</Text>}
    {history.length > 0 && <Text style={styles.warning}>Предыдущая отметка отменена: {history[history.length - 1].reason}. История сохранена.</Text>}
    {manager && !simulation && !mode && <Action disabled={disabled} label={`Настроить GPS · ${stop.destination}`} onPress={() => {
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
