import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { colors, Icon } from './ui';
import { TripBudgetSummary } from './TripBudget';
import { ReceiptGallery, financeDate as date, financeMoney as money } from './TripFinance';
import { accountingDay } from './demoAccounting';
import DeadlinePicker from './DeadlinePicker';
import ContractsScreen from './ContractsScreen';

export const accountantDemoTabs = [
  ['accounting', 'Главная', 'home'], ['accounting-review', 'Проверка', 'check'],
  ['accounting-advances', 'Авансы', 'briefcase'], ['accounting-reports', 'Отчёты', 'chart'], ['contracts', 'Договоры', 'clipboard'],
];
const statuses = { awaiting_approval: 'На согласовании', awaiting_employee: 'На уточнении', confirmed: 'Согласована', rejected: 'Отклонена' };
const paymentLabels = { advance: 'Аванс', payment: 'Доплата', refund: 'Возврат' };
const pendingFinance = offer => offer.status === 'awaiting_approval' && offer.approvalStages?.some(stage => stage.approverId === 'demo-accountant' && stage.status === 'waiting');
const pendingReport = trip => trip.status === 'finished' && (trip.finance.reviewStatus === 'pending'
  || trip.finance.reviewStatus === 'approved' && trip.finance.balance !== 0);
function Action({ children, onPress, primary, disabled, danger }) {
  return <Pressable accessibilityRole="button" disabled={disabled} accessibilityState={{ disabled }} onPress={onPress}
    style={[styles.action, primary && styles.primary, danger && styles.danger, disabled && { opacity: 0.5 }]}>
    <Text style={[styles.actionText, primary && styles.white, danger && { color: '#9F4026' }]}>{children}</Text>
  </Pressable>;
}
function Card({ title, children }) {
  return <View style={styles.card}>{title && <Text accessibilityRole="header" style={styles.cardTitle}>{title}</Text>}{children}</View>;
}
function Badge({ children, green }) { return <Text style={[styles.badge, green && styles.green]}>{children}</Text>; }
function Fact({ label, value }) { return <View style={styles.fact}><Text style={styles.muted}>{label}</Text><Text style={styles.number}>{value}</Text></View>; }
function Record({ item, status, amount, onPress }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`Открыть · ${item.destination} · ${status}`} onPress={onPress} style={styles.record}>
    <View style={styles.row}><View style={styles.avatar}><Icon name="briefcase" size={20} /></View><View style={styles.flex}>
      <Text style={styles.label}>{item.employeeName}</Text><Text style={styles.muted}>{date(item.plannedStart)} — {date(item.plannedEnd)}</Text>
    </View><Icon name="chevron-right" size={18} /></View>
    <Text style={styles.cardTitle} numberOfLines={2}>{item.stops?.length > 1 ? `${item.destination.split(' · ')[0]} · ${item.stops.length} объектов` : item.destination}</Text>
    <View style={[styles.row, { justifyContent: 'space-between' }]}><Badge>{status}</Badge>{amount != null && <Text style={styles.number}>{money(amount)}</Text>}</View>
    {item.sample && <Text style={styles.example}>Учебный пример</Text>}
  </Pressable>;
}
function TripHeader({ item }) {
  return <Card title={item.destination}>
    <Text style={styles.label}>{item.employeeName}</Text>
    <Text style={styles.muted}>{date(item.plannedStart)} — {date(item.plannedEnd)} · {item.plannedDays} дн.</Text>
    <Text style={styles.body}>{item.purpose}</Text>
    {item.comment ? <Text style={styles.muted}>{item.comment}</Text> : null}
    {item.sample && <Badge>Учебный пример · вымышленные данные</Badge>}
    {(item.stops ?? []).length > 0 && <View style={styles.inset}>
      <Text style={styles.label}>Организации и объекты</Text>{item.stops.map(stop => <Text key={stop.id} style={styles.muted}>{stop.destination}</Text>)}
    </View>}
  </Card>;
}
function ReviewOffer({ offer, busy, onAction }) {
  const [reason, setReason] = useState(''); const [returning, setReturning] = useState(false);
  const pending = offer.approvalStages.find(stage => stage.status === 'waiting');
  return <>
    <TripHeader item={offer} />
    <TripBudgetSummary title="План расходов и оплаты" value={offer.estimate} />
    <Card title="Проверка расходов">
      <Badge green={offer.status === 'confirmed'}>{statuses[offer.status]}</Badge>
      {pendingFinance(offer) ? <>
        <Text style={styles.muted}>Проверьте суммы и обоснование поездки. После согласования заявка поступит руководителю.</Text>
        {returning ? <>
          <TextInput accessibilityLabel="Замечание сотруднику" placeholder="Что нужно исправить" value={reason} onChangeText={setReason} multiline maxLength={500} style={styles.input} />
          <Action primary disabled={busy || !reason.trim()} onPress={() => onAction(`/trip-offers/${offer.id}/approval`, {
            action: 'reject', reason: reason.trim(), stage: pending.position, expectedRevision: offer.revision,
          })}>Вернуть сотруднику</Action>
          <Action disabled={busy} onPress={() => setReturning(false)}>Отмена</Action>
        </> : <>
          <Action primary disabled={busy} onPress={() => onAction(`/trip-offers/${offer.id}/approval`, {
            action: 'approve', stage: pending.position, expectedRevision: offer.revision,
          })}>Согласовать расходы</Action>
          <Action disabled={busy} onPress={() => setReturning(true)}>Вернуть с замечанием</Action>
        </>}
      </> : <Text style={styles.muted}>{offer.revisionReason || (pending ? `Следующий этап · ${pending.approverName}` : 'Решение по заявке сохранено.')}</Text>}
      {offer.approvalStages.filter(stage => stage.decidedAt).map(stage => <Text key={stage.position} style={styles.muted}>
        {stage.approverName} · {stage.status === 'approved' ? 'согласовано' : 'возвращено'} · {date(stage.decidedAt)}{stage.reason ? ' · ' + stage.reason : ''}
      </Text>)}
    </Card>
  </>;
}
function TransactionForm({ trip, kind, busy, onSave, onCancel }) {
  const initial = kind === 'advance' ? trip.finance.remainingAdvance : Math.abs(trip.finance.balance);
  const [amount, setAmount] = useState(String(initial)); const [note, setNote] = useState('');
  const [day, setDay] = useState(() => new Date(accountingDay(new Date()) + 'T12:00:00+05:00'));
  const submission = useRef(null);
  const valid = /^\d{1,9}$/.test(amount) && Number(amount) > 0 && Number(amount) <= initial;
  function save() {
    const fields = { kind, amount: Number(amount), date: accountingDay(day), note: note.trim(), expectedRevision: trip.finance.revision };
    const draft = JSON.stringify(fields);
    if (submission.current?.draft !== draft) submission.current = { draft, requestId: randomUUID() };
    onSave({ ...fields, requestId: submission.current.requestId });
  }
  return <Card title={`Записать ${paymentLabels[kind].toLowerCase()}`}>
    <Text style={styles.muted}>Отметка уже выполненной операции. Приложение не переводит деньги.</Text>
    <TextInput accessibilityLabel="Сумма операции в тенге" keyboardType="number-pad" value={amount} onChangeText={setAmount} maxLength={9} style={styles.input} />
    <Text style={styles.muted}>Доступно к расчёту · {money(initial)}</Text>
    <DeadlinePicker dateOnly required label="Дата операции" value={day} onChange={setDay} maximumDate={new Date()} disabled={busy} />
    <TextInput accessibilityLabel="Комментарий к операции" placeholder="Номер документа или комментарий" value={note} onChangeText={setNote} maxLength={1000} style={styles.input} />
    <Action primary disabled={busy || !valid} onPress={save}>Сохранить отметку</Action>
    <Action disabled={busy} onPress={onCancel}>Отмена</Action>
  </Card>;
}
function TripDetails({ trip, busy, onAction }) {
  const [editor, setEditor] = useState(null); const [reason, setReason] = useState('');
  const [returning, setReturning] = useState(false); const [checked, setChecked] = useState(false);
  const f = trip.finance; const hasActual = trip.actualExpenses?.expensesTotal != null;
  async function record(fields) { if (await onAction(`/accounting/trips/${trip.id}/transactions`, fields)) setEditor(null); }
  async function review(action) {
    if (await onAction(`/accounting/trips/${trip.id}/review`, { action, reason: reason.trim(), documentsChecked: checked,
      expectedRevision: f.revision, actualRevision: trip.actualExpenses.revision, receiptRevision: trip.receiptRevision })) setReturning(false);
  }
  return <>
    <TripHeader item={trip} />
    <Card title="Расчёты по расходам">
      <View style={styles.grid}><Fact label="По плану" value={money(trip.estimate.expensesTotal)} /><Fact label="По факту" value={money(trip.actualExpenses?.expensesTotal)} /></View>
      <Fact label="Выдано авансом" value={money(f.advanceTotal)} />
      <Fact label="Доплачено / возвращено" value={`${money(f.paymentTotal)} / ${money(f.refundTotal)}`} />
      {hasActual && <View style={styles.balance}><Text style={styles.label}>{f.balance > 0 ? 'К доплате сотруднику' : f.balance < 0 ? 'К возврату от сотрудника' : 'Остаток по расходам'}</Text>
        <Text style={styles.balanceAmount}>{money(Math.abs(f.balance))}</Text>
        {f.reviewStatus !== 'approved' && <Text style={styles.muted}>Предварительный расчёт — отчёт ещё не принят.</Text>}
      </View>}
      <Text style={styles.muted}>Оплата работы {money(trip.estimate.workTotal)} учитывается отдельно и не входит в этот аванс.</Text>
    </Card>
    {trip.status !== 'finished' && <Card title="Аванс на поездку">
      <Text style={styles.muted}>Поездка согласована. Отметьте фактически выданную сумму на расходы.</Text>
      {f.remainingAdvance > 0 && !editor && <Action primary disabled={busy} onPress={() => setEditor('advance')}>Записать выдачу аванса</Action>}
      {!f.remainingAdvance && <Badge green>Плановые расходы покрыты авансом</Badge>}
    </Card>}
    {trip.status === 'finished' && <Card title="Сверка отчёта">
      {hasActual ? <>
        <Badge green={f.reviewStatus === 'approved'}>{f.reviewStatus === 'approved' ? 'Отчёт принят' : f.reviewStatus === 'returned' ? 'Возвращён сотруднику' : 'Ждёт проверки'}</Badge>
        {['transport', 'lodging', 'meals', 'other'].map((key, i) => <Fact key={key} label={['Проезд', 'Жильё', 'Питание', 'Прочее'][i]} value={money(trip.actualExpenses[key] ?? 0)} />)}
        {trip.actualExpenses.note ? <Text style={styles.body}>{trip.actualExpenses.note}</Text> : null}
        <ReceiptGallery receipts={trip.receipts} />
        {f.reviewStatus === 'returned' && <Text style={styles.warning}>{f.review.reason}</Text>}
        {f.reviewStatus !== 'approved' && <>
          <Pressable accessibilityRole="checkbox" aria-checked={checked} onPress={() => setChecked(!checked)} style={styles.checkbox}>
            <Icon name={checked ? 'check' : 'clipboard'} size={20} /><Text style={[styles.body, styles.flex]}>Суммы сверены с чеками или оригиналами документов</Text>
          </Pressable>
          {returning ? <>
            <TextInput accessibilityLabel="Замечание к отчёту" placeholder="Что нужно исправить" value={reason} onChangeText={setReason} multiline style={styles.input} />
            <Action disabled={busy || !reason.trim()} primary onPress={() => review('returned')}>Вернуть отчёт сотруднику</Action>
            <Action disabled={busy} onPress={() => setReturning(false)}>Отмена</Action>
          </> : <>
            <Action primary disabled={busy || !checked} onPress={() => review('approved')}>Принять расходы</Action>
            <Action disabled={busy} onPress={() => setReturning(true)}>Вернуть отчёт с замечанием</Action>
          </>}
        </>}
        {f.reviewStatus === 'approved' && !editor && (f.balance === 0 ? <Badge green>Расчёты по расходам закрыты</Badge>
          : <Action primary disabled={busy} onPress={() => setEditor(f.balance > 0 ? 'payment' : 'refund')}>{f.balance > 0 ? 'Записать доплату' : 'Записать возврат остатка'}</Action>)}
      </> : <Text style={styles.muted}>Сотрудник ещё не указал фактические расходы.</Text>}
    </Card>}
    {editor && <TransactionForm key={editor} trip={trip} kind={editor} busy={busy} onSave={record} onCancel={() => setEditor(null)} />}
    <Card title="История операций">
      {!f.transactions.length && <Text style={styles.muted}>Финансовых отметок пока нет.</Text>}
      {[...f.transactions].reverse().map(row => <View key={row.id} style={styles.inset}>
        <Fact label={paymentLabels[row.kind]} value={money(row.amount)} />
        <Text style={styles.muted}>{date(row.date)} · {row.recordedBy}</Text>{row.note ? <Text style={styles.muted}>{row.note}</Text> : null}
      </View>)}
    </Card>
  </>;
}
export default function AccountantScreen({ request, section, onSectionChange }) {
  const [data, setData] = useState(null); const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const lock = useRef(false); const scroll = useRef(null);
  const top = () => scroll.current?.scrollTo({ y: 0, animated: false });
  async function reload() { const result = await request('/accounting'); setData(result); }
  useEffect(() => { let current = true; request('/accounting').then(value => { if (current) setData(value); }).catch(failure => { if (current) setError(failure.message); }); return () => { current = false; }; }, [request]);
  async function act(path, body = {}) {
    if (lock.current) return false;
    lock.current = true; setBusy(true); setError('');
    try { await request(path, { method: 'POST', body }); await reload(); return true; }
    catch (failure) { setError(failure.message || 'Не удалось сохранить.'); return false; }
    finally { lock.current = false; setBusy(false); }
  }
  const open = (type, id) => { setSelected({ type, id }); setError(''); top(); };
  const offers = data?.offers ?? []; const trips = data?.trips ?? [];
  const waiting = offers.filter(pendingFinance);
  const advances = trips.filter(trip => trip.status !== 'finished' && trip.finance.remainingAdvance > 0);
  const reports = trips.filter(pendingReport);
  const overdue = (data?.contracts ?? []).flatMap(contract => contract.payments).filter(row => row.outstandingAmount > 0 && row.dueOn < accountingDay(new Date()));
  const item = selected?.type === 'offer' ? offers.find(offer => offer.id === selected.id) : trips.find(trip => trip.id === selected?.id);
  const title = accountantDemoTabs.find(([key]) => key === section)?.[1] ?? 'Главная';
  return <ScrollView ref={scroll} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
    <View style={styles.heading}><Text accessibilityRole="header" style={styles.title}>{selected ? 'Карточка поездки' : section === 'accounting' ? 'Кабинет бухгалтера' : title}</Text>
      <Text style={styles.muted}>Демо · данные общие для ролей в этом браузере. Без переводов денег и связи с 1С.</Text></View>
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {!data ? <><ActivityIndicator color={colors.blue} />{error && <Action onPress={() => { setError(''); reload().catch(e => setError(e.message)); }}>Повторить загрузку</Action>}</>
      : selected && item ? <>
        <Action disabled={busy} onPress={() => { setSelected(null); setError(''); top(); }}>‹ К списку</Action>
        {selected.type === 'offer' ? <ReviewOffer key={item.id} offer={item} busy={busy} onAction={act} /> : <TripDetails key={item.id} trip={item} busy={busy} onAction={act} />}
      </> : <>
        {section === 'accounting' && <>
          <View style={styles.hero}><Text style={styles.heroCaption}>РАБОЧИЙ ДЕНЬ</Text><Text style={styles.heroTitle}>{'Все расчёты —\nв одном месте'}</Text>
            <Text style={styles.heroText}>{waiting.length + advances.length + reports.length + overdue.length ? 'Проверьте новые заявки и завершите расчёты по поездкам.' : 'Здесь появятся заявки сотрудников и расходы по поездкам.'}</Text></View>
          <View style={styles.grid}>{[
            ['accounting-review', 'На проверке', waiting.length, 'check'], ['accounting-advances', 'Авансы к выдаче', advances.length, 'briefcase'],
            ['accounting-reports', 'Отчёты и расчёты', reports.length, 'chart'], ['contracts', 'Просроченные оплаты', overdue.length, 'calendar'],
          ].map(([key, label, count, icon]) => <Pressable key={key} accessibilityRole="button" accessibilityLabel={`${label} · ${count}`}
            onPress={() => onSectionChange(key)} style={styles.tile}><Icon name={icon} size={23} /><Text style={styles.tileNumber}>{count}</Text><Text style={styles.muted}>{label}</Text></Pressable>)}</View>
          <Text accessibilityRole="header" style={styles.cardTitle}>Ближайшие действия</Text>
          {waiting.slice(0, 2).map(offer => <Record key={'o'+offer.id} item={offer} status="Проверить расходы" amount={offer.estimate.total} onPress={() => open('offer', offer.id)} />)}
          {advances.slice(0, 1).map(trip => <Record key={'a'+trip.id} item={trip} status="Выдать аванс" amount={trip.finance.remainingAdvance} onPress={() => open('trip', trip.id)} />)}
          {reports.slice(0, 1).map(trip => <Record key={'r'+trip.id} item={trip} status={trip.finance.reviewStatus === 'approved' ? 'Завершить расчёт' : 'Сверить отчёт'} amount={trip.finance.reviewStatus === 'approved' ? Math.abs(trip.finance.balance) : trip.actualExpenses.expensesTotal} onPress={() => open('trip', trip.id)} />)}
          {!data.examplesLoaded && <Card title="Посмотреть заполненный кабинет">
            <Text style={styles.muted}>Добавьте учебные заявки, аванс, отчёт и договор. Они будут помечены как примеры.</Text>
            <Action disabled={busy} onPress={() => act('/accounting/examples')}>Добавить учебные примеры</Action>
          </Card>}
        </>}
        {section === 'accounting-review' && <>
          <Text style={styles.muted}>Сначала проверка расходов бухгалтером, затем согласование руководителем.</Text>
          {!offers.length && <Card title="Новых заявок пока нет"><Text style={styles.muted}>Создайте командировку в роли сотрудника — она появится здесь.</Text></Card>}
          {[...offers].sort((a,b) => Number(pendingFinance(b)) - Number(pendingFinance(a))).map(offer => <Record key={offer.id} item={offer}
            status={pendingFinance(offer) ? 'Проверить расходы' : statuses[offer.status]} amount={offer.estimate.total} onPress={() => open('offer', offer.id)} />)}
        </>}
        {section === 'accounting-advances' && <>
          <Text style={styles.muted}>Согласованные поездки. Можно записать частичную выдачу и видеть остаток.</Text>
          {!trips.length && <Card title="Нет согласованных поездок"><Text style={styles.muted}>Они появятся после решения руководителя.</Text></Card>}
          {trips.map(trip => <Record key={trip.id} item={trip} status={trip.status === 'finished' ? 'Поездка завершена' : trip.finance.remainingAdvance > 0 ? 'К выдаче' : 'Аванс выдан'}
            amount={trip.status !== 'finished' && trip.finance.remainingAdvance > 0 ? trip.finance.remainingAdvance : trip.finance.advanceTotal} onPress={() => open('trip', trip.id)} />)}
        </>}
        {section === 'accounting-reports' && <>
          <Text style={styles.muted}>Сравните план и факт. Фото чеков и замечания находятся в карточке.</Text>
          {!trips.some(trip => trip.status === 'finished') && <Card title="Завершённых поездок пока нет"><Text style={styles.muted}>Отчёты появятся после завершения командировки сотрудником.</Text></Card>}
          {trips.filter(trip => trip.status === 'finished').map(trip => <Record key={trip.id} item={trip}
            status={{ pending: 'Проверить отчёт', missing: 'Ждём расходы', returned: 'На уточнении', approved: trip.finance.balance === 0 ? 'Расчёты закрыты' : 'Остался расчёт' }[trip.finance.reviewStatus]}
            amount={trip.actualExpenses.expensesTotal} onPress={() => open('trip', trip.id)} />)}
        </>}
        {section === 'contracts' && <>
          <Text style={styles.muted}>Отметки АВР, ЭСФ и поступлений. Сами документы оформляются во внешних системах.</Text>
          <ContractsScreen request={request} role="accountant" onNavigate={top} />
        </>}
      </>}
    {busy && <Text accessibilityLiveRegion="polite" style={styles.muted}>Сохраняем…</Text>}
  </ScrollView>;
}
const styles = StyleSheet.create({
  page: { padding: 16, gap: 14, paddingBottom: 28 }, heading: { gap: 6 }, title: { fontSize: 27, fontWeight: '800', color: colors.ink, letterSpacing: -0.5 },
  hero: { padding: 22, borderRadius: 22, backgroundColor: '#174BB9', gap: 10 }, heroCaption: { fontSize: 11, color: '#B9D7FF', fontWeight: '700', letterSpacing: 1.3 },
  heroTitle: { fontSize: 27, fontWeight: '700', color: '#fff', lineHeight: 34 }, heroText: { color: '#E3EDFF', fontSize: 14, lineHeight: 21 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, tile: { width: '48%', flexGrow: 1, backgroundColor: '#fff', padding: 16, borderRadius: 18, borderWidth: 1, borderColor: colors.border, gap: 8 },
  tileNumber: { color: colors.ink, fontSize: 29, fontWeight: '800' }, card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, gap: 12, borderWidth: 1, borderColor: colors.border },
  cardTitle: { fontSize: 17, color: colors.ink, fontWeight: '700' }, record: { padding: 16, gap: 12, backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }, flex: { flex: 1 }, avatar: { width: 42, height: 42, backgroundColor: colors.tint, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  label: { color: colors.ink, fontSize: 14, fontWeight: '700' }, muted: { color: '#536680', fontSize: 13, lineHeight: 19 }, body: { color: colors.ink, fontSize: 14, lineHeight: 21 },
  badge: { color: '#8A5800', backgroundColor: '#FFF2D9', fontSize: 12, fontWeight: '700', paddingVertical: 6, paddingHorizontal: 9, borderRadius: 8, alignSelf: 'flex-start' },
  green: { color: '#176443', backgroundColor: '#EAF8F0' }, example: { color: '#7C62A5', fontSize: 12 }, number: { color: colors.ink, fontWeight: '700', fontSize: 15 },
  action: { minHeight: 46, borderRadius: 11, padding: 12, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.tint }, primary: { backgroundColor: colors.blue }, danger: { backgroundColor: '#FFF0ED' },
  actionText: { color: colors.blue, fontWeight: '700', fontSize: 14, textAlign: 'center' }, white: { color: '#fff' },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, color: colors.ink, fontSize: 15, backgroundColor: colors.canvas },
  fact: { flexGrow: 1, gap: 5 }, inset: { borderTopWidth: 1, borderColor: colors.border, paddingTop: 12, gap: 6 },
  balance: { padding: 16, gap: 6, backgroundColor: colors.tint, borderRadius: 12 }, balanceAmount: { color: '#1553A4', fontWeight: '800', fontSize: 26 },
  checkbox: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.canvas, padding: 10, borderRadius: 10 },
  warning: { color: '#9F4026', fontSize: 14, lineHeight: 20 }, error: { backgroundColor: '#FFF0ED', color: '#9F4026', padding: 12, borderRadius: 10, fontSize: 14 },
});
