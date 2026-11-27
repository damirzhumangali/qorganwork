import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { calendarMonth } from './tripPlanning';
import { colors } from './ui';

const dayNumber = date => date ? +new Date(date.getFullYear(), date.getMonth(), date.getDate()) : NaN;
export default function MonthCalendar({ value, end, onSelect, disabled, minimumDate, maximumDate }) {
  const [month, setMonth] = useState(() => value || new Date());
  const selected = dayNumber(value); const finish = dayNumber(end);
  return <View style={styles.calendar}>
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="Предыдущий месяц" disabled={disabled}
        onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} style={styles.arrow}><Text style={styles.arrowText}>‹</Text></Pressable>
      <Text accessibilityRole="header" style={styles.title}>{month.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Следующий месяц" disabled={disabled}
        onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} style={styles.arrow}><Text style={styles.arrowText}>›</Text></Pressable>
    </View>
    <View style={styles.grid}>{['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(day => <Text key={day} style={styles.weekday}>{day}</Text>)}</View>
    <View style={styles.grid}>{calendarMonth(month).map(date => {
      const time = dayNumber(date);
      const chosen = time === selected || time === finish;
      const unavailable = disabled || time < dayNumber(minimumDate) || time > dayNumber(maximumDate);
      return <View key={time} style={styles.cell}><Pressable accessibilityRole="button"
        accessibilityLabel={date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
        accessibilityState={{ selected: chosen, disabled: unavailable }} disabled={unavailable}
        onPress={() => onSelect(date)} style={[styles.day, time > selected && time < finish && styles.range,
          chosen && styles.selected, unavailable && styles.disabled]}>
        <Text style={[styles.number, date.getMonth() !== month.getMonth() && styles.outside, chosen && styles.white]}>{date.getDate()}</Text>
      </Pressable></View>;
    })}</View>
  </View>;
}
const styles = StyleSheet.create({
  calendar: { gap: 4 }, header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: colors.ink, fontSize: 16, fontWeight: '700', textTransform: 'capitalize' },
  arrow: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }, arrowText: { color: colors.blue, fontSize: 30 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' }, weekday: { width: '14.2857%', textAlign: 'center', color: colors.muted, fontSize: 12, paddingVertical: 8 },
  cell: { width: '14.2857%', paddingVertical: 2 }, day: { minHeight: 44, justifyContent: 'center', alignItems: 'center', borderRadius: 10 },
  number: { color: colors.ink, fontSize: 16 }, outside: { color: colors.muted }, range: { backgroundColor: colors.tint },
  selected: { backgroundColor: colors.blue }, white: { color: '#fff', fontWeight: '700' }, disabled: { opacity: 0.25 },
});
