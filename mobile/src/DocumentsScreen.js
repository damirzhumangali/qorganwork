import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { colors, Icon } from './ui';
import { financeDate as date, financeMoney as money, ReceiptGallery } from './TripFinance';
import { TransactionForm } from './AccountantScreen';
import { advanceSubmissionIssue, documentTitles, documentStatuses } from './demoDocuments';

function Button({ children, onPress, primary, disabled }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: Boolean(disabled) }} disabled={disabled} onPress={onPress}
    style={[s.button, primary && s.primary, disabled && { opacity: 0.45 }]}>
    <Text style={[s.buttonText, primary && { color: '#fff' }]}>{children}</Text>
  </Pressable>;
}
function Card({ children }) { return <View style={s.card}>{children}</View>; }
function Badge({ children, done }) { return <Text style={[s.badge, done && s.done]}>{children}</Text>; }
const isDone = d => ['signed', 'approved'].includes(d.status);
const needsAction = (d, role) => role === 'employee'
  ? d.status === 'awaiting_employee' || d.kind === 'advance' && ['draft', 'returned'].includes(d.status)
  : ['awaiting_accountant', 'awaiting_accountant_signature'].includes(d.status) || d.kind !== 'advance' && ['draft', 'returned'].includes(d.status)
    || d.kind === 'advance' && d.status === 'approved' && d.outstanding > 0;
function Fact({ label, children }) { return <View style={s.fact}><Text style={s.muted}>{label}</Text><Text selectable style={s.body}>{children}</Text></View>; }
function TripInfo({ trip }) {
  return <>
    <Fact label="Сотрудник">{trip.employeeName}</Fact>
    <Fact label="Куда и когда">{trip.destination}{'\n'}{date(trip.plannedStart)} — {date(trip.plannedEnd)}</Fact>
    <Fact label="Цель поездки">{trip.purpose}</Fact>
  </>;
}
function AdvanceBudget({ trip, issue, draft = false }) {
  return <View style={s.budget}>
    <View style={s.line}><Text style={s.muted}>Расходы по плану</Text><Text style={s.label}>{money(trip.estimate.expensesTotal)}</Text></View>
    <View style={s.line}><Text style={s.muted}>Уже выдано авансом</Text><Text style={s.label}>{money(trip.finance.advanceTotal)}</Text></View>
    <View style={s.line}><Text style={s.label}>Доступно на расходы</Text><Text style={s.label}>{money(trip.finance.remainingAdvance)}</Text></View>
    <Text style={s.muted}>Оплата работы в аванс не входит.</Text>
    {issue && <Text accessibilityRole="alert" style={s.warning}>{issue}</Text>}
    {draft && <Text style={s.muted}>{issue ? 'Черновик можно сохранить с этой суммой. Подписание и отправка пока недоступны.' : 'Сначала сохраните черновик и проверьте его. Подписание и отправка — отдельный шаг.'}</Text>}
  </View>;
}
function Editor({ kind, document, data, busy, onSave, onCancel }) {
  const trips = data.trips.filter(t => kind === 'advance'
    ? ['planned', 'active'].includes(t.status) && t.finance.remainingAdvance > 0
      && !data.documents.some(d => d.kind === 'advance' && d.id !== document?.id && d.tripId === t.id && d.outstanding > 0)
    : kind === 'report' ? t.status === 'finished' && t.actualExpenses?.expensesTotal != null : true);
  const [tripId, setTripId] = useState(document?.tripId ?? (trips.length === 1 ? trips[0].id : null));
  const trip = data.trips.find(t => t.id === tripId);
  const [amount, setAmount] = useState(String(document?.content.amount ?? trip?.finance.remainingAdvance ?? ''));
  const [note, setNote] = useState(document?.content.note ?? '');
  const [details, setDetails] = useState(document?.content.details ?? '');
  const amountValid = /^\d{1,9}$/.test(amount) && Number(amount) > 0;
  const advanceIssue = kind === 'advance' && trip && amountValid ? advanceSubmissionIssue(trip, Number(amount)) : null;
  const valid = trip && (kind !== 'advance' || amountValid)
    && (kind !== 'writeoff' || details.trim().length > 0);
  return <>
    <Button disabled={busy} onPress={onCancel}>‹ Отмена</Button>
    <Card><Text accessibilityRole="header" style={s.section}>{document ? 'Исправить документ' : documentTitles[kind]}</Text>
      <Text style={s.muted}>{kind === 'advance' ? document ? 'Измените сумму или комментарий и сохраните черновик. Данные поездки уже заполнены.' : 'Выберите согласованную поездку. Основные поля заполнятся автоматически.'
        : 'Учебный шаблон для демонстрации. Документ из 1С пока не загружается.'}</Text>
      {!document && <>
        <Text style={s.label}>Командировка</Text>
        {trips.map(t => <Pressable key={t.id} accessibilityRole="radio" accessibilityState={{ checked: t.id === tripId }}
          accessibilityLabel={`${t.destination} · ${date(t.plannedStart)}`} disabled={busy} onPress={() => { setTripId(t.id); setAmount(String(t.finance.remainingAdvance)); }}
          style={[s.choice, tripId === t.id && s.choiceActive]}>
          <View style={s.row}><Icon name={tripId === t.id ? 'check' : 'briefcase'} size={20} /><Text style={[s.label, s.flex]}>{t.destination}</Text></View>
          <Text style={s.muted}>{date(t.plannedStart)} — {date(t.plannedEnd)}{t.sample ? ' · Учебный пример' : ''}</Text>
        </Pressable>)}
        {!trips.length && <Text style={s.warning}>{kind === 'advance' ? 'Нет поездок для нового заявления. Нужна согласованная незавершённая поездка с остатком аванса. Уже созданные заявления доступны в списке.'
          : 'Для авансового отчёта завершите поездку и заполните фактические расходы. Можно добавить учебные примеры в списке документов.'}</Text>}
      </>}
      {trip && <>
        <TripInfo trip={trip} />
        {kind === 'advance' && <>
          <Text style={s.label}>Прошу выдать, ₸</Text>
          <TextInput accessibilityLabel="Сумма заявления в тенге" value={amount} onChangeText={setAmount} keyboardType="number-pad" maxLength={9} editable={!busy} style={s.input} />
          {!amountValid && <Text accessibilityRole="alert" style={s.warning}>Укажите положительную сумму в целых тенге, до 9 цифр.</Text>}
          <AdvanceBudget trip={trip} issue={advanceIssue} draft />
        </>}
        {kind === 'report' && <Fact label="Фактические расходы">{money(trip.actualExpenses.expensesTotal)}</Fact>}
        {kind === 'writeoff' && <>
          <Text style={s.label}>Материалы и основание списания</Text>
          <TextInput accessibilityLabel="Материалы и основание списания" value={details} onChangeText={setDetails} editable={!busy} multiline maxLength={3000}
            placeholder="Например: кабель UTP — 20 м. Использован при обслуживании объекта." style={[s.input, s.multiline]} />
        </>}
        <Text style={s.label}>Комментарий · необязательно</Text>
        <TextInput accessibilityLabel="Комментарий к документу" value={note} onChangeText={setNote} editable={!busy} multiline maxLength={1500} style={[s.input, s.multiline]} />
        {document && <Text style={s.warning}>Сохранится новая версия. Для неё подписи нужно будет поставить заново; предыдущая версия останется в истории.</Text>}
        <Button primary disabled={busy || !valid} onPress={() => onSave({ kind, tripId, amount: Number(amount), note, details })}>Сохранить и посмотреть</Button>
      </>}
    </Card>
  </>;
}
function Preview({ document, content = document.content, version = document.version }) {
  const c = content;
  return <View style={s.paper}>
    <View style={s.row}><Icon name="clipboard" size={24} /><Text style={s.eyebrow}>УЧЕБНЫЙ ДОКУМЕНТ</Text></View>
    <Text selectable accessibilityRole="header" style={s.section}>{documentTitles[document.kind]}</Text>
    <Text style={s.muted}>№ ДЕМО-{document.id} · версия {version} · {date(c.date + 'T12:00:00+05:00')}</Text>
    <View style={s.rule} />
    <Fact label="Организация / сотрудник">{c.company}{'\n'}{c.employee}</Fact>
    <Fact label="Командировка">{c.destination}{'\n'}{date(c.plannedStart)} — {date(c.plannedEnd)}</Fact>
    <Fact label="Цель">{c.purpose}</Fact>
    {document.kind === 'advance' ? <>
      <Text selectable style={s.body}>Прошу выдать аванс на расходы по указанной командировке в размере {money(c.amount)}.</Text>
      <Text style={s.amount}>{money(c.amount)}</Text>
    </> : document.kind === 'report' ? <>
      <Fact label="Получено авансом на момент формирования">{money(c.advance)}</Fact>
      {Object.entries({ transport: 'Проезд', lodging: 'Проживание', meals: 'Питание', other: 'Прочие расходы' }).map(([key, label]) => <View key={key} style={s.line}>
        <Text style={s.muted}>{label}</Text><Text style={s.label}>{money(c.expenses[key] ?? 0)}</Text>
      </View>)}
      <Fact label="Итого фактических расходов">{money(c.amount)}</Fact>
      <Fact label={c.amount >= c.advance ? 'Превышение расходов над авансом' : 'Неиспользованный аванс'}>{money(Math.abs(c.amount - c.advance))}</Fact>
      <Text style={s.muted}>Расчёт на дату формирования. Последующие выплаты и возвраты отображаются в разделе «Отчёты».</Text>
      <Fact label="Приложения">{c.receipts.length ? c.receipts.map(r => r.name).join('\n') : 'Фото чеков не приложены. Оригиналы сверяются отдельно.'}</Fact>
    </> : <Fact label="Материалы и основание списания">{c.details}</Fact>}
    {c.note ? <Fact label="Комментарий">{c.note}</Fact> : null}
    <View style={s.rule} /><Text style={s.muted}>Учебный шаблон. Не является официальным документом. ЭЦП и обмен с 1С не подключены.</Text>
  </View>;
}
function Details({ document: d, trip, role, busy, onAction, onEdit, onPayment, onNavigate }) {
  const [confirm, setConfirm] = useState(false); const [returning, setReturning] = useState(false);
  const [reason, setReason] = useState(''); const [pay, setPay] = useState(false); const [oldVersion, setOldVersion] = useState(null);
  const author = d.kind === 'advance' ? 'employee' : 'accountant';
  const advanceIssue = d.kind === 'advance' && !isDone(d) ? advanceSubmissionIssue(trip, d.content.amount) : null;
  const signable = role === 'employee' && (d.kind === 'advance' && d.status === 'draft' || d.status === 'awaiting_employee')
    || role === 'accountant' && d.status === 'awaiting_accountant_signature';
  const returnable = role === 'employee' && d.status === 'awaiting_employee'
    || role === 'accountant' && ['awaiting_accountant', 'awaiting_accountant_signature'].includes(d.status);
  async function action(name, extra) { if (await onAction(name, extra)) { setConfirm(false); setReturning(false); } }
  return <>
    <Card><Badge done={isDone(d)}>{documentStatuses[d.status]}</Badge>
      <Text style={s.muted}>{d.kind === 'advance' ? 'Сотрудник → проверка бухгалтером → отметка выдачи' : 'Бухгалтер готовит → сотрудник подписывает → бухгалтер подписывает'}</Text>
      {d.returnReason && <Text style={s.warning}>Замечание: {d.returnReason}</Text>}
      {d.outdated && <Text style={s.warning}>{isDone(d) ? 'После подписания данные поездки изменились. Здесь сохранена подписанная версия.' : 'Расходы или чеки изменились. Бухгалтеру нужно обновить документ перед подписанием.'}</Text>}
      {advanceIssue && <AdvanceBudget trip={trip} issue={advanceIssue} />}
    </Card>
    <Preview document={d} />
    {d.kind === 'report' && trip?.receipts.length > 0 && <Card><Text style={s.label}>Фото приложений к этой версии</Text>
      <ReceiptGallery receipts={trip.receipts.filter(r => d.content.receipts.some(saved => saved.id === r.id))} />
    </Card>}
    <Card>
      <Text accessibilityRole="header" style={s.section}>Подписи и решение</Text>
      {!d.signatures.length && <Text style={s.muted}>Учебных подписей пока нет.</Text>}
      {d.signatures.map(sig => <View key={sig.role} style={s.signature}><Icon name="check" color="#177A55" size={20} /><View style={s.flex}>
        <Text style={s.label}>{sig.name}</Text><Text style={s.muted}>Подписано в демо · версия {sig.version}{'\n'}{new Date(sig.at).toLocaleString('ru-RU', { timeZone: 'Asia/Almaty' })}</Text>
      </View></View>)}
      {d.status === 'returned' && d.signatures.length > 0 && <Text style={s.warning}>Документ возвращён. Сохранённые подписи относятся только к показанной версии.</Text>}
      {confirm ? <View style={s.confirm}>
        <Text style={s.label}>Учебное подписание</Text><Text style={s.body}>Вы подписываете версию {d.version} от роли «{role === 'employee' ? 'Сотрудник' : 'Бухгалтер'}». Это демонстрация, а не ЭЦП. Ключ и пароль не требуются.</Text>
        <Button primary disabled={busy || d.outdated || Boolean(advanceIssue)} onPress={() => action(d.kind === 'advance' ? 'send' : 'sign', { confirmDemo: true })}>Подтвердить учебную подпись</Button>
        <Button disabled={busy} onPress={() => setConfirm(false)}>Отмена</Button>
      </View> : signable && <Button primary disabled={busy || d.outdated || Boolean(advanceIssue)} onPress={() => setConfirm(true)}>{d.kind === 'advance' ? 'Подписать в демо и отправить' : 'Подписать в демо'}</Button>}
      {role === 'accountant' && d.kind !== 'advance' && d.status === 'draft' && <Button primary disabled={busy || d.outdated} onPress={() => action('send')}>Отправить сотруднику</Button>}
      {role === 'accountant' && d.status === 'awaiting_accountant' && <Button primary disabled={busy || Boolean(advanceIssue)} onPress={() => action('approve')}>Принять заявление</Button>}
      {returning ? <>
        <TextInput accessibilityLabel="Причина возврата документа" placeholder="Что нужно исправить" value={reason} onChangeText={setReason} editable={!busy} multiline maxLength={1000} style={[s.input, s.multiline]} />
        <Button disabled={busy || !reason.trim()} onPress={() => action('return', { reason })}>Отправить замечание</Button>
        <Button disabled={busy} onPress={() => setReturning(false)}>Отмена возврата</Button>
      </> : returnable && <Button disabled={busy} onPress={() => { setReturning(true); setConfirm(false); }}>Вернуть на исправление</Button>}
      {role === author && !isDone(d) && !confirm && <Button disabled={busy} onPress={onEdit}>{d.outdated ? 'Обновить документ' : 'Исправить документ'}</Button>}
      {d.status === 'awaiting_employee' && role === 'accountant' && <Text style={s.muted}>Ожидаем сотрудника. Для проверки переключитесь на роль «Сотрудник» и откройте «Документы».</Text>}
      {['awaiting_accountant', 'awaiting_accountant_signature'].includes(d.status) && role === 'employee' && <Text style={s.muted}>Отправлено бухгалтеру. Для проверки переключитесь на роль «Бухгалтер» и откройте «Документы».</Text>}
      {d.status === 'signed' && <Badge done>Обе учебные подписи сохранены</Badge>}
    </Card>
    {d.kind === 'advance' && d.status === 'approved' && <Card>
      <Text style={s.section}>Выдача по заявлению</Text><Fact label="Отмечено выданным">{money(d.paid)}</Fact>
      <Fact label="Осталось по заявлению">{money(d.outstanding)}</Fact>
      <Text style={s.muted}>Принятие заявления не означает выдачу денег. Бухгалтер отдельно записывает выполненную операцию.</Text>
      {role === 'accountant' && d.outstanding > 0 && trip.status !== 'finished' && trip.finance.remainingAdvance > 0 && !pay && <Button primary disabled={busy} onPress={() => setPay(true)}>Записать выдачу по заявлению</Button>}
      {d.outstanding > 0 && (trip.status === 'finished' || !trip.finance.remainingAdvance) && <Text style={s.warning}>Поездка завершена или аванс уже покрыт другими операциями. Новая выдача здесь недоступна; проверьте расчёты по поездке.</Text>}
    </Card>}
    {pay && <TransactionForm trip={trip} kind="advance" maximum={Math.min(d.outstanding, trip.finance.remainingAdvance)} busy={busy}
      onCancel={() => setPay(false)} onSave={async fields => { if (await onPayment({ ...fields, documentId: d.id })) setPay(false); }} />}
    {role === 'accountant' && d.kind === 'report' && <Button onPress={() => onNavigate('accounting-reports')}>Открыть сверку расходов и расчёты</Button>}
    <Card><Text accessibilityRole="header" style={s.section}>История документа</Text>
      {[...d.history].reverse().map((event, i) => <View key={i} style={s.history}>
        <Text style={s.body}>{event.action}</Text><Text style={s.muted}>{event.name} · версия {event.version}{'\n'}{new Date(event.at).toLocaleString('ru-RU', { timeZone: 'Asia/Almaty' })}</Text>
      </View>)}
      {d.versions.map(v => <Button key={v.version} onPress={() => setOldVersion(oldVersion === v.version ? null : v.version)}>{oldVersion === v.version ? 'Скрыть' : 'Посмотреть'} версию {v.version}</Button>)}
    </Card>
    {oldVersion && <><Preview document={d} version={oldVersion} content={d.versions.find(v => v.version === oldVersion).content} />
      <Card><Text style={s.label}>Учебные подписи прежней версии</Text>
        {d.versions.find(v => v.version === oldVersion).signatures.length ? d.versions.find(v => v.version === oldVersion).signatures.map(sig => <Text key={sig.role} style={s.body}>{sig.name} · {new Date(sig.at).toLocaleString('ru-RU', { timeZone: 'Asia/Almaty' })}</Text>) : <Text style={s.muted}>Подписей не было.</Text>}
      </Card></>}
  </>;
}

export default function DocumentsScreen({ role, request, onNavigate }) {
  const [data, setData] = useState(null); const [selected, setSelected] = useState(null); const [editor, setEditor] = useState(null);
  const [filter, setFilter] = useState('all'); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const lock = useRef(false); const retry = useRef(null); const scroll = useRef(null);
  const top = () => scroll.current?.scrollTo({ y: 0, animated: false });
  const reload = async () => { const result = await request('/documents'); setData(result); return result; };
  useEffect(() => { reload().catch(e => setError(e.message)); }, [request]);
  async function act(path, fields = {}) {
    if (lock.current) return null;
    lock.current = true; setBusy(true); setError('');
    const payload = JSON.stringify({ path, fields });
    if (retry.current?.payload !== payload) retry.current = { payload, requestId: fields.requestId ?? randomUUID() };
    try {
      const result = await request(path, { method: 'POST', body: { ...fields, requestId: retry.current.requestId } });
      await reload(); retry.current = null; return result;
    } catch (failure) { setError(failure.message || 'Не удалось сохранить документ.'); top(); return null; }
    finally { lock.current = false; setBusy(false); }
  }
  const document = data?.documents.find(d => d.id === selected);
  const trip = data?.trips.find(t => t.id === document?.tripId);
  const pending = data?.documents.filter(d => needsAction(d, role)).length ?? 0;
  async function save(fields) {
    const result = await act(editor.id ? `/documents/${editor.id}/update` : '/documents', { ...fields,
      ...(editor.id ? { expectedRevision: document.revision } : {}) });
    if (result) { setSelected(result.document.id); setEditor(null); top(); }
  }
  function create(kind) { setSelected(null); setEditor({ kind }); setError(''); top(); }
  return <ScrollView ref={scroll} contentContainerStyle={s.page} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
    <Text accessibilityRole="header" style={s.title}>Документы</Text>
    <Text style={s.muted}>Демо · без ЭЦП и 1С. Данные общие для ролей только в этом браузере.</Text>
    {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
    <View style={s.row}><View style={s.flex} /><Button disabled={busy} onPress={() => { setError(''); reload().catch(e => setError(e.message)); }}>Обновить</Button></View>
    {!data ? <ActivityIndicator color={colors.blue} /> : editor ? <Editor key={editor.id ?? editor.kind} kind={editor.kind} document={editor.id ? document : null}
      data={data} busy={busy} onSave={save} onCancel={() => { setEditor(null); top(); }} />
      : document ? <>
        <Button disabled={busy} onPress={() => { setSelected(null); setError(''); top(); }}>‹ К документам</Button>
        <Details key={`${document.id}:${document.revision}`} document={document} trip={trip} role={role} busy={busy}
          onAction={(action, fields) => act(`/documents/${document.id}/${action}`, { ...fields, expectedRevision: document.revision })}
          onEdit={() => { setEditor({ id: document.id, kind: document.kind }); setError(''); top(); }}
          onPayment={fields => act(`/accounting/trips/${trip.id}/transactions`, fields)} onNavigate={onNavigate} />
      </> : <>
        <View style={s.hero}><Text style={s.eyebrow}>БЕЗ БУМАЖНЫХ ЗАЯВЛЕНИЙ</Text><Text style={s.heroTitle}>{role === 'employee' ? 'Прочитать. Проверить.\nПодписать в демо.' : 'Подготовить документ.\nПолучить подписи.'}</Text>
          <Text style={s.body}>{pending ? `Требуют вашего действия: ${pending}` : 'Все документы и этапы согласования — здесь.'}</Text>
        </View>
        {role === 'employee' ? <Button primary disabled={busy} onPress={() => create('advance')}>+ Заявление на аванс</Button> : <Card>
          <Text style={s.section}>Подготовить документ</Text>
          <Button primary disabled={busy} onPress={() => create('report')}>+ Авансовый отчёт</Button>
          <Button disabled={busy} onPress={() => create('writeoff')}>+ Акт списания</Button>
        </Card>}
        <View style={s.filters}>{[['all', 'Все'], ['action', `Мне (${pending})`], ['done', 'Завершённые']].map(([key, text]) => <Pressable key={key} accessibilityRole="tab"
          accessibilityState={{ selected: key === filter }} onPress={() => setFilter(key)} style={[s.filter, key === filter && s.filterActive]}><Text style={s.filterText}>{text}</Text></Pressable>)}</View>
        {data.documents.filter(d => filter === 'all' || filter === 'action' && needsAction(d, role) || filter === 'done' && isDone(d)).map(d => <Pressable key={d.id}
          accessibilityRole="button" accessibilityLabel={`Открыть ${documentTitles[d.kind]} № ${d.id}`} onPress={() => { setSelected(d.id); setError(''); top(); }} style={s.card}>
          <View style={s.row}><Icon name={d.kind === 'advance' ? 'briefcase' : 'clipboard'} size={24} /><Text style={[s.section, s.flex]}>{documentTitles[d.kind]}</Text><Icon name="chevron-right" size={18} /></View>
          <Text style={s.body}>{d.content.destination}</Text><Text style={s.muted}>{d.content.employee} · № ДЕМО-{d.id} · версия {d.version}</Text>
          <Badge done={isDone(d)}>{documentStatuses[d.status]}</Badge>
          {d.kind === 'advance' && d.status === 'approved' ? <Text style={s.label}>Выдано {money(d.paid)} из {money(d.content.amount)}</Text> : d.content.amount != null && <Text style={s.label}>{money(d.content.amount)}</Text>}
          {d.sample && <Text style={s.muted}>Учебный пример</Text>}
        </Pressable>)}
        {!data.documents.length && <Card><Text style={s.section}>Начните с заявления или примера</Text><Text style={s.muted}>После отправки документ появится у другой роли. Переключение роли находится вверху экрана.</Text></Card>}
        {!data.examplesLoaded && <Card><Text style={s.section}>Попробовать готовый сценарий</Text><Text style={s.muted}>Добавим учебные поездки, авансовый отчёт и акт списания на подпись сотруднику. Ваши данные сохранятся.</Text>
          <Button disabled={busy} onPress={() => act('/documents/examples')}>Добавить примеры документов</Button></Card>}
      </>}
    {busy && <Text accessibilityLiveRegion="polite" style={s.muted}>Сохраняем…</Text>}
  </ScrollView>;
}
const s = StyleSheet.create({
  page: { padding: 16, paddingBottom: 30, gap: 14 }, title: { color: colors.ink, fontSize: 29, fontWeight: '800' },
  section: { color: colors.ink, fontSize: 18, fontWeight: '700', lineHeight: 24 }, label: { color: colors.ink, fontSize: 14, fontWeight: '700', lineHeight: 20 },
  body: { color: colors.ink, fontSize: 15, lineHeight: 23 }, muted: { color: '#536680', fontSize: 13, lineHeight: 19 },
  card: { backgroundColor: '#fff', borderRadius: 18, padding: 17, borderWidth: 1, borderColor: colors.border, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 }, flex: { flex: 1, minWidth: 0 },
  button: { backgroundColor: colors.tint, padding: 13, borderRadius: 12, minHeight: 46, alignItems: 'center', justifyContent: 'center' },
  primary: { backgroundColor: colors.blue }, buttonText: { color: '#0860CE', fontSize: 14, fontWeight: '700', textAlign: 'center' },
  badge: { color: '#825609', backgroundColor: '#FFF2D9', padding: 8, borderRadius: 8, alignSelf: 'flex-start', fontSize: 12, fontWeight: '700' },
  done: { color: '#176443', backgroundColor: '#EAF8F0' }, hero: { backgroundColor: '#DFEDFF', padding: 21, borderRadius: 22, gap: 12 },
  heroTitle: { color: '#123666', fontSize: 25, fontWeight: '800', lineHeight: 32 }, eyebrow: { color: '#3B6394', fontSize: 11, letterSpacing: 1, fontWeight: '700' },
  input: { color: colors.ink, fontSize: 16, padding: 12, minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: '#D6E1F0', backgroundColor: colors.canvas },
  multiline: { minHeight: 84, textAlignVertical: 'top' }, fact: { gap: 4 }, choice: { gap: 6, padding: 13, borderWidth: 1, borderColor: colors.border, borderRadius: 12 },
  choiceActive: { borderColor: colors.blue, backgroundColor: colors.tint }, paper: { backgroundColor: '#fff', padding: 20, borderRadius: 6, borderWidth: 1, borderColor: '#D9E2EE', gap: 16 },
  rule: { height: 1, backgroundColor: colors.border }, amount: { fontSize: 29, fontWeight: '800', color: '#174BB9' },
  budget: { backgroundColor: colors.canvas, borderRadius: 12, padding: 12, gap: 10 },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 }, signature: { flexDirection: 'row', gap: 10, padding: 12, borderRadius: 12, backgroundColor: '#EAF8F0' },
  confirm: { backgroundColor: '#EAF4FF', padding: 14, borderRadius: 14, gap: 12 }, history: { borderLeftWidth: 2, borderColor: '#C6D9F3', paddingLeft: 12, paddingVertical: 5, gap: 5 },
  filters: { flexDirection: 'row', backgroundColor: '#E8EEF7', padding: 4, borderRadius: 12, gap: 3 }, filter: { paddingVertical: 12, flex: 1, alignItems: 'center', borderRadius: 9 },
  filterActive: { backgroundColor: '#fff' }, filterText: { color: '#385575', fontSize: 12, fontWeight: '700' },
  warning: { color: '#9F5426', fontSize: 14, lineHeight: 21 }, error: { color: '#AD3726', backgroundColor: '#FFF0ED', padding: 14, borderRadius: 12, fontSize: 14 },
});
