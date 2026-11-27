import { accountingTrip, accountingDay, seedAccountingExamples } from './demoAccounting';

const check = (condition, message) => { if (!condition) throw new Error(message); };
const clone = value => JSON.parse(JSON.stringify(value));
const names = { employee: 'Демо-сотрудник', accountant: 'Демо-бухгалтер' };
export const documentTitles = { advance: 'Заявление на аванс', report: 'Авансовый отчёт', writeoff: 'Акт списания' };
export const documentStatuses = { draft: 'Черновик', returned: 'На исправлении', awaiting_accountant: 'На проверке бухгалтера',
  awaiting_employee: 'Подпись сотрудника', awaiting_accountant_signature: 'Подпись бухгалтера', approved: 'Заявление принято', signed: 'Подписан в демо' };
const owner = document => document.kind === 'advance' ? 'employee' : 'accountant';
const final = document => ['approved', 'signed'].includes(document.status);
// Only source facts used in the report are compared. Reviewing it does not change its content.
const reportSource = trip => JSON.stringify({ actual: trip.actualExpenses, receipts: (trip.receipts ?? []).map(r => r.id),
  advances: (trip.finance?.transactions ?? []).filter(r => r.kind === 'advance').map(r => [r.id, r.amount]) });
function view(document, state) {
  const trip = state.trips.find(t => t.id === document.tripId);
  const paid = (trip?.finance?.transactions ?? []).filter(t => t.documentId === document.id).reduce((sum, t) => sum + t.amount, 0);
  return { ...document, paid, outstanding: document.kind === 'advance' ? Math.max(0, document.content.amount - paid) : 0,
    outdated: document.kind === 'report' && document.source !== reportSource(trip) };
}
function advanceAllowed(document, state) {
  const trip = state.trips.find(t => t.id === document.tripId);
  check(trip && ['planned', 'active'].includes(trip.status), 'Аванс доступен для согласованной незавершённой поездки.');
  check(document.content.amount <= accountingTrip(trip).finance.remainingAdvance, 'Остаток аванса изменился. Исправьте сумму заявления.');
  check(!(state.documents ?? []).some(d => d.id !== document.id && d.kind === 'advance' && d.tripId === trip.id
    && view(d, state).outstanding > 0), 'Для этой поездки уже есть незакрытое заявление. Откройте его в списке.');
}
function contentFor(kind, trip, body, now) {
  const base = { company: 'Демо-компания', employee: trip.employeeName, destination: trip.destination, purpose: trip.purpose,
    plannedStart: trip.plannedStart, plannedEnd: trip.plannedEnd, date: accountingDay(now()), note: String(body.note ?? '').trim().slice(0, 1500) };
  if (kind === 'advance') {
    const amount = body.amount ?? accountingTrip(trip).finance.remainingAdvance;
    check(Number.isInteger(amount) && amount > 0 && amount <= 999999999, 'Укажите положительную сумму аванса в целых тенге.');
    return { ...base, amount };
  }
  if (kind === 'report') {
    check(trip.status === 'finished' && trip.actualExpenses?.expensesTotal != null, 'Для отчёта нужна завершённая поездка с фактическими расходами.');
    return { ...base, amount: trip.actualExpenses.expensesTotal, expenses: clone(trip.actualExpenses),
      advance: accountingTrip(trip).finance.advanceTotal, receipts: (trip.receipts ?? []).map(r => ({ id: r.id, name: r.name })) };
  }
  const details = String(body.details ?? '').trim();
  check(details && details.length <= 3000, 'Укажите материалы, количество и основание списания (до 3000 символов).');
  return { ...base, details };
}
function makeDocument({ state, kind, trip, body, now, nextId }) {
  check(documentTitles[kind], 'Выберите тип документа.');
  check(trip && trip.employeeId === 'demo-employee', 'Выберите командировку сотрудника.');
  const document = { id: nextId(), kind, tripId: trip.id, employeeId: trip.employeeId, sample: Boolean(trip.sample),
    revision: 1, version: 1, status: 'draft', content: contentFor(kind, trip, body, now),
    source: kind === 'report' ? reportSource(trip) : null, signatures: [], versions: [], history: [], operations: [], createdAt: now(), updatedAt: now() };
  if (kind === 'advance') advanceAllowed(document, state);
  document.history.push({ action: 'Создан черновик', role: owner(document), name: names[owner(document)], at: now(), version: 1 });
  return document;
}

// Demonstration records, never cryptographic signatures or official accounting forms.
// All writes use the trips adapter's serialized storage transaction.
export async function handleDemoDocuments({ state, role, path, method, body, now, nextId, save, stages }) {
  if (!path.startsWith('/documents')) return null;
  check(role === 'employee' || role === 'accountant', 'Документы доступны сотруднику и бухгалтеру.');
  state.documents ??= [];
  if (method === 'GET' && path === '/documents') return clone({ documents: state.documents.map(d => view(d, state)),
    trips: state.trips.map(accountingTrip), examplesLoaded: Boolean(state.documentsExamplesLoaded) });
  if (method === 'POST' && path === '/documents/examples') {
    if (state.documentsExamplesLoaded) return { loaded: true };
    seedAccountingExamples({ state, now, nextId, stages });
    const trip = state.trips.find(t => t.sample && t.status === 'finished' && t.actualExpenses?.expensesTotal != null);
    check(trip, 'Сначала завершите учебную поездку и укажите расходы.');
    for (const kind of ['report', 'writeoff']) {
      const document = makeDocument({ state, kind, trip, now, nextId,
        body: { details: 'Кабель UTP — 20 м. Использован при обслуживании оборудования на объекте. Учебный пример.' } });
      document.status = 'awaiting_employee';
      document.history.push({ action: 'Отправлен сотруднику · учебный пример', role: 'accountant', name: names.accountant, version: 1, at: now() });
      state.documents.unshift(document);
    }
    state.documentsExamplesLoaded = true;
    return save({ loaded: true });
  }
  check(method === 'POST', 'Действие недоступно.');
  check(typeof body.requestId === 'string' && body.requestId.length > 0 && body.requestId.length <= 150, 'Повторите сохранение документа.');
  const match = path.match(/^\/documents\/([^/]+)\/(update|send|sign|approve|return)$/);
  const action = path === '/documents' ? 'create' : match?.[2];
  check(action, 'Действие недоступно.');
  const payload = JSON.stringify({ role, path, body });
  const previous = state.documents.find(d => d.operations.some(op => op.id === body.requestId));
  if (previous) {
    check(previous.operations.find(op => op.id === body.requestId).payload === payload, 'Повторный запрос отличается от сохранённого.');
    return clone({ document: view(previous, state) });
  }
  let document;
  if (action === 'create') {
    check(body.kind === 'advance' ? role === 'employee' : role === 'accountant', 'Этот документ создаёт другая роль.');
    document = makeDocument({ state, kind: body.kind, trip: state.trips.find(t => t.id === body.tripId), body, now, nextId });
    state.documents.unshift(document);
  } else {
    document = state.documents.find(d => d.id === match[1]);
    check(document, 'Документ не найден.');
    check(body.expectedRevision === document.revision, 'Документ изменился. Обновите карточку.');
    check(!final(document), 'Принятый или подписанный документ нельзя изменить.');
    const trip = state.trips.find(t => t.id === document.tripId);
    const addSignature = () => {
      check(body.confirmDemo === true, 'Подтвердите учебное подписание. ЭЦП не подключена.');
      check(!document.signatures.some(s => s.role === role && s.version === document.version), 'Ваша учебная подпись уже сохранена.');
      document.signatures.push({ role, name: names[role], version: document.version, at: now(), demo: true });
    };
    let event;
    if (action === 'update') {
      check(role === owner(document), 'Исправления вносит автор документа.');
      const content = contentFor(document.kind, trip, body, now);
      if (document.kind === 'advance') advanceAllowed({ ...document, content }, state);
      document.versions.push({ version: document.version, content: clone(document.content), signatures: clone(document.signatures), status: document.status, source: document.source });
      document.version++; document.content = content; document.status = 'draft'; document.signatures = []; document.returnReason = null;
      document.source = document.kind === 'report' ? reportSource(trip) : null;
      event = 'Создана новая версия · требуется повторное подписание';
    } else if (action === 'send') {
      check(role === owner(document) && document.status === 'draft', 'Отправить можно свой черновик.');
      check(!view(document, state).outdated, 'Расходы или чеки изменились. Обновите документ перед отправкой.');
      if (document.kind === 'advance') { advanceAllowed(document, state); addSignature(); }
      document.status = document.kind === 'advance' ? 'awaiting_accountant' : 'awaiting_employee';
      event = document.kind === 'advance' ? 'Подписано в демо и отправлено бухгалтеру' : 'Отправлено сотруднику';
    } else if (action === 'sign') {
      check(document.kind !== 'advance' && (role === 'employee' && document.status === 'awaiting_employee'
        || role === 'accountant' && document.status === 'awaiting_accountant_signature'), 'Дождитесь своего этапа подписания.');
      check(!view(document, state).outdated, 'Расходы или чеки изменились. Бухгалтеру нужно обновить документ.');
      addSignature(); document.status = role === 'employee' ? 'awaiting_accountant_signature' : 'signed';
      event = 'Подписано в демо';
    } else if (action === 'approve') {
      check(role === 'accountant' && document.kind === 'advance' && document.status === 'awaiting_accountant', 'Дождитесь заявления сотрудника.');
      advanceAllowed(document, state); document.status = 'approved'; event = 'Заявление принято бухгалтером';
    } else {
      check(role === 'accountant' && ['awaiting_accountant', 'awaiting_accountant_signature'].includes(document.status)
        || role === 'employee' && document.status === 'awaiting_employee', 'Возврат недоступен на этом этапе.');
      const reason = String(body.reason ?? '').trim();
      check(reason && reason.length <= 1000, 'Укажите, что нужно исправить (до 1000 символов).');
      document.status = 'returned'; document.returnReason = reason; event = 'Возвращено: ' + reason;
    }
    document.history.push({ action: event, role, name: names[role], at: now(), version: document.version });
    document.revision++; document.updatedAt = now();
  }
  document.operations.push({ id: body.requestId, payload });
  return save({ document: view(document, state) });
}
