import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, Icon } from './ui';
import MonthCalendar from './MonthCalendar';
import DeadlinePicker from './DeadlinePicker';
import { periodOnDay } from './tripPlanning';

const label = date => date?.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) || 'Выбрать';
function Action({ children, onPress, disabled, selected }) {
  return <Pressable accessibilityRole="button" disabled={disabled} accessibilityState={{ disabled, selected }} onPress={onPress}
    style={[styles.action, selected && styles.active, disabled && { opacity: 0.5 }]}>
    <Text style={[styles.actionText, selected && { color: '#fff' }]}>{children}</Text>
  </Pressable>;
}
export default function TripPeriodPicker({ start, end, onChange, disabled }) {
  const [draft, setDraft] = useState(null);
  const [stage, setStage] = useState('start');
  const [times, setTimes] = useState(false);
  function quick(offset, days) {
    const now = new Date();
    const day = days > 1 && start ? start : new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    onChange(periodOnDay(day, days, { start, end }));
    setDraft(null);
  }
  function selectDay(day) {
    if (stage === 'start') {
      setDraft({ start: periodOnDay(day, 1, { start, end }).start, end: null });
      setStage('end');
    } else {
      const first = new Date(draft.start); first.setHours(0, 0, 0, 0);
      if (day < first) { setDraft({ start: periodOnDay(day, 1, { start, end }).start, end: null }); return; }
      const last = periodOnDay(day, 1, { start, end }).end;
      setDraft({ ...draft, end: last });
    }
  }
  return <View style={styles.container}>
    <View style={styles.row}>{[['Сегодня', 0, 1], ['Завтра', 1, 1], ['3 дня', 0, 3], ['5 дней', 0, 5]].map(([text, offset, days]) =>
      <Action key={text} disabled={disabled} onPress={() => quick(offset, days)}>{text}</Action>)}</View>
    <Pressable accessibilityRole="button" accessibilityLabel="Выбрать период поездки" accessibilityState={{ expanded: Boolean(draft), disabled }}
      disabled={disabled} onPress={() => { setDraft(draft ? null : { start, end }); setStage('start'); }} style={styles.period}>
      <Icon name="calendar" size={22} /><View style={{ flex: 1 }}><Text style={styles.caption}>Начало → окончание</Text>
        <Text style={styles.value}>{label(start)} — {label(end)}</Text></View><Icon name="chevron-right" size={18} />
    </Pressable>
    {draft && <View style={styles.editor}>
      <View style={styles.row}><Action disabled={disabled} selected={stage === 'start'} onPress={() => setStage('start')}>Начало · {label(draft.start)}</Action>
        <Action disabled={disabled || !draft.start} selected={stage === 'end'} onPress={() => setStage('end')}>Окончание · {label(draft.end)}</Action></View>
      <Text style={styles.caption}>{stage === 'start' ? 'Нажмите на день начала поездки.' : 'Нажмите на день окончания. Для одного дня выберите ту же дату.'}</Text>
      <MonthCalendar value={draft.start} end={draft.end} onSelect={selectDay} disabled={disabled} />
      <View style={styles.row}><Action disabled={disabled || !draft.start || !draft.end || draft.end <= draft.start} selected
        onPress={() => { onChange(draft); setDraft(null); }}>Применить даты</Action><Action disabled={disabled} onPress={() => setDraft(null)}>Отмена</Action></View>
    </View>}
    <Action disabled={disabled} onPress={() => setTimes(!times)}>{times ? 'Скрыть время' : `Время · ${start?.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} — ${end?.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} · изменить`}</Action>
    {times && <>
      <DeadlinePicker label="Начало поездки" value={start} onChange={next => onChange({ start: next, end })} required showQuick={false} showHelper={false} timeOnly disabled={disabled} />
      <DeadlinePicker label="Окончание поездки" value={end} onChange={next => onChange({ start, end: next })} required showQuick={false} showHelper={false} timeOnly disabled={disabled} />
    </>}
    <Text style={styles.caption}>Предложен период с 09:00 до 18:00. Проверьте даты и время поездки.</Text>
  </View>;
}
const styles = StyleSheet.create({
  container: { gap: 10 }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, action: { backgroundColor: colors.tint, paddingHorizontal: 12, paddingVertical: 10, minHeight: 44, borderRadius: 10, justifyContent: 'center' },
  actionText: { color: colors.blue, fontWeight: '600', fontSize: 14 }, active: { backgroundColor: colors.blue },
  period: { backgroundColor: colors.canvas, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  caption: { color: '#536680', fontSize: 13, lineHeight: 18 }, value: { color: colors.ink, fontWeight: '700', fontSize: 18, marginTop: 4 },
  editor: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 10, gap: 8 },
});
