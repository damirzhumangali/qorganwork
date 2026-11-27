import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, Icon } from './ui';

const roles = [
  { id: 'employee', label: 'Сотрудник', icon: 'user', description: 'Мои задачи, ход работ и фотоотчёты' },
  { id: 'manager', label: 'Руководитель', icon: 'users', description: 'Заявки команды и проверка результатов' },
  { id: 'accountant', label: 'Бухгалтер', icon: 'clipboard', description: 'Проверка расходов, авансы и расчёты по поездкам' },
];

export function DemoRoleSwitch({ role, onSelectRole }) {
  return <View style={styles.switch}>
    {roles.map(item => <Pressable key={item.id} accessibilityRole="tab"
      accessibilityLabel={item.label} accessibilityState={{ selected: role === item.id }}
      onPress={() => onSelectRole(item.id)}
      style={[styles.switchButton, role === item.id && styles.switchActive]}>
      <Text style={[styles.switchText, role === item.id && styles.switchActiveText]}>{item.label}</Text>
    </Pressable>)}
  </View>;
}

export default function DemoEntry({ onSelectRole }) {
  return <ScrollView contentContainerStyle={styles.page}>
    <View style={styles.brand}>
      <View style={styles.mark}><Text style={styles.markText}>q</Text></View>
      <View><Text style={styles.wordmark}>qwork</Text><Text style={styles.tagline}>Команда. Задачи. Результат.</Text></View>
    </View>
    <View style={styles.intro}>
      <Text accessibilityRole="header" style={styles.title}>Выберите роль</Text>
      <Text style={styles.subtitle}>Откройте рабочий экран одним нажатием.</Text>
    </View>
    {roles.map(item => <Pressable key={item.id} accessibilityRole="button"
      accessibilityLabel={item.label} accessibilityHint={item.description}
      onPress={() => onSelectRole(item.id)} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={styles.icon}><Icon name={item.icon} size={27} /></View>
      <View style={styles.cardCopy}><Text style={styles.cardTitle}>{item.label}</Text><Text style={styles.description}>{item.description}</Text></View>
      <Icon name="arrow-right" size={23} />
    </Pressable>)}
    <View style={styles.note}>
      <Icon name="info" size={17} color={colors.muted} />
      <Text style={styles.noteText}>Демо-режим без регистрации. Изменения сохраняются в этом браузере.</Text>
    </View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, paddingHorizontal: 22, paddingTop: 40, paddingBottom: 32, gap: 14 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 32 },
  mark: { width: 52, height: 52, borderRadius: 17, backgroundColor: colors.blue, alignItems: 'center', justifyContent: 'center' },
  markText: { color: '#FFFFFF', fontSize: 39, fontWeight: '800', lineHeight: 46 },
  wordmark: { color: colors.ink, fontSize: 30, fontWeight: '800', letterSpacing: -1 },
  tagline: { color: colors.muted, fontSize: 12, marginTop: 2 },
  intro: { gap: 8, marginBottom: 12 },
  title: { color: colors.ink, fontSize: 28, fontWeight: '700', letterSpacing: -.6 },
  subtitle: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 13, minHeight: 124, padding: 18,
    backgroundColor: '#FFFFFF', borderRadius: 20, borderWidth: 1, borderColor: colors.border },
  cardCopy: { flex: 1, gap: 6 },
  cardTitle: { color: colors.ink, fontSize: 18, fontWeight: '700' },
  description: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  icon: { width: 49, height: 49, borderRadius: 15, backgroundColor: colors.tint, justifyContent: 'center', alignItems: 'center' },
  pressed: { opacity: .65 },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 8, paddingHorizontal: 5 },
  noteText: { flex: 1, color: colors.muted, fontSize: 12, lineHeight: 18 },
  switch: { flexDirection: 'row', gap: 4, padding: 4, marginHorizontal: 16, marginBottom: 8,
    backgroundColor: '#E8EEF6', borderRadius: 12 },
  switchButton: { flex: 1, minHeight: 40, justifyContent: 'center', alignItems: 'center', borderRadius: 9 },
  switchActive: { backgroundColor: colors.blue },
  switchText: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  switchActiveText: { color: '#FFFFFF' },
});
