import React, { useRef, useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { randomUUID } from 'expo-crypto';
import { colors, Icon } from './ui';
import { prepareReceipt } from './receiptImage';

const moneyFormat = new Intl.NumberFormat('ru-KZ', { maximumFractionDigits: 0 });
export const financeMoney = value => value == null ? '—' : moneyFormat.format(value) + ' ₸';
export const financeDate = value => value ? new Date(value).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', timeZone: 'Asia/Almaty' }) : '—';
export function ReceiptGallery({ receipts = [] }) {
  const [opened, setOpened] = useState(null);
  return <View style={{ gap: 10 }}>
    {!receipts.length && <Text style={styles.muted}>Фото чеков пока не прикреплены.</Text>}
    <View style={styles.row}>{receipts.map(receipt => <Pressable key={receipt.id} accessibilityRole="button"
      accessibilityLabel={`Открыть чек · ${receipt.name}`} onPress={() => setOpened(receipt)} style={styles.receipt}>
      <Image source={{ uri: receipt.data }} style={styles.thumbnail} resizeMode="cover" />
      <Text numberOfLines={1} style={styles.muted}>{receipt.name}</Text>
    </Pressable>)}</View>
    <Modal visible={Boolean(opened)} transparent animationType="fade" onRequestClose={() => setOpened(null)}>
      <View style={styles.backdrop}>
        <Pressable accessibilityRole="button" accessibilityLabel="Закрыть чек" onPress={() => setOpened(null)} style={styles.close}>
          <Text style={{ color: '#fff', fontSize: 16 }}>Закрыть ×</Text>
        </Pressable>
        {opened && <Image source={{ uri: opened.data }} style={styles.fullImage} resizeMode="contain" />}
      </View>
    </Modal>
  </View>;
}
export default function TripFinance({ trip, request, employee, onChanged }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const lock = useRef(false);
  const pending = useRef(null); const [canRetry, setCanRetry] = useState(false);
  const [notice, setNotice] = useState('');
  const finance = trip.finance;
  if (!finance) return null;
  const eligible = employee && ['active', 'finished'].includes(trip.status);
  async function attach(retry = false) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try {
      if (!retry || !pending.current) {
        const selection = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], base64: false, quality: 1 });
        if (selection.canceled) return;
        pending.current = null; setCanRetry(false);
        const asset = selection.assets[0];
        pending.current = { requestId: randomUUID(), name: asset.fileName || 'Фото чека', data: await prepareReceipt(asset) };
        setCanRetry(true);
      }
      await request(`/trips/${encodeURIComponent(trip.id)}/receipts`, { method: 'POST', body: pending.current });
      setNotice('Фото чека сохранено. Откройте его и проверьте читаемость.');
      await onChanged();
      pending.current = null; setCanRetry(false);
    } catch (failure) { setError(failure.message || 'Не удалось прикрепить чек.'); }
    finally { lock.current = false; setBusy(false); }
  }
  return <View style={styles.card}>
    <Text accessibilityRole="header" style={styles.title}>Аванс и сверка расходов</Text>
    <Text style={styles.muted}>Расчёты по расходам поездки. Оплата работы по дневной ставке учитывается отдельно.</Text>
    <Text style={styles.amount}>Выдан аванс · {financeMoney(finance.advanceTotal)}</Text>
    <Text style={styles.muted}>{finance.reviewStatus === 'approved' ? 'Бухгалтер принял расходы.'
      : finance.reviewStatus === 'returned' ? 'Бухгалтер вернул расходы на уточнение.'
      : trip.status === 'finished' && finance.reviewStatus === 'pending' ? 'Расходы ожидают проверки бухгалтера.' : 'Сверка проводится после завершения поездки.'}</Text>
    {finance.reviewStatus === 'returned' && <Text style={styles.warning}>{finance.review?.reason}</Text>}
    {finance.reviewStatus === 'approved' && <Text style={styles.amount}>{finance.balance > 0 ? 'Осталось доплатить вам'
      : finance.balance < 0 ? 'Осталось вернуть' : 'Расчёты по расходам закрыты'}{finance.balance ? ' · ' + financeMoney(Math.abs(finance.balance)) : ''}</Text>}
    <Text style={styles.label}>Фото чеков · {trip.receipts?.length ?? 0}</Text>
    <ReceiptGallery receipts={trip.receipts} />
    {eligible && (trip.receipts?.length ?? 0) < 5 && <Pressable accessibilityRole="button" disabled={busy} onPress={() => attach()} style={styles.button}>
      <Icon name="upload" size={18} /><Text style={styles.link}>{busy ? 'Добавляем…' : 'Прикрепить фото чека'}</Text>
    </Pressable>}
    {error && canRetry && <Pressable accessibilityRole="button" disabled={busy} onPress={() => attach(true)} style={styles.button}>
      <Icon name="refresh" size={18} /><Text style={styles.link}>Повторить сохранение фото</Text>
    </Pressable>}
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.muted}>{notice}</Text> : null}
    <Text style={styles.muted}>Демо: фото и отметки сохраняются только в этом браузере.</Text>
    {error ? <Text accessibilityRole="alert" style={styles.warning}>{error}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({
  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 14, gap: 10 },
  title: { fontSize: 17, fontWeight: '700', color: colors.ink }, label: { fontWeight: '600', color: colors.ink, fontSize: 14 },
  amount: { fontSize: 15, fontWeight: '700', color: colors.ink }, muted: { color: '#536680', fontSize: 13, lineHeight: 19 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, receipt: { width: 90, gap: 5 }, thumbnail: { width: 90, height: 110, borderRadius: 8 },
  button: { backgroundColor: colors.tint, minHeight: 46, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  link: { color: colors.blue, fontSize: 14, fontWeight: '600' }, warning: { color: '#9F4026', fontSize: 14 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,.92)', padding: 20, paddingTop: 50 }, close: { minHeight: 48, alignSelf: 'flex-end', justifyContent: 'center' },
  fullImage: { flex: 1, width: '100%' },
});
