import { tripBudgetTotals } from './tripBudgetCalculation';

const check = (condition, message) => { if (!condition) throw new Error(message); };
const clone = value => JSON.parse(JSON.stringify(value));
const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty', year: 'numeric', month: '2-digit', day: '2-digit' });
export const accountingDay = timestamp => {
  const parts = Object.fromEntries(dayFormatter.formatToParts(new Date(timestamp)).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};
function validDay(day, today) {
  return typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day))
    && new Date(day).toISOString().slice(0, 10) === day && day <= today;
}
export function accountingTrip(trip) {
  const ledger = trip.finance ?? { revision: 0, transactions: [], review: null };
  const sum = kind => ledger.transactions.filter(row => row.kind === kind).reduce((total, row) => total + row.amount, 0);
  const advance = sum('advance'); const payment = sum('payment'); const refund = sum('refund');
  const actual = trip.actualExpenses?.expensesTotal;
  const currentReview = ledger.review?.actualRevision === trip.actualExpenses?.revision
    && ledger.review?.receiptRevision === (trip.receiptRevision ?? 0);
  return { ...trip, receipts: trip.receipts ?? [], receiptRevision: trip.receiptRevision ?? 0,
    finance: { ...ledger, advanceTotal: advance, paymentTotal: payment, refundTotal: refund,
      balance: actual == null ? null : actual - advance - payment + refund,
      remainingAdvance: Math.max(0, (trip.estimate?.expensesTotal ?? 0) - advance),
      reviewStatus: actual == null ? 'missing' : currentReview ? ledger.review.status : 'pending' } };
}
function contractView(contract) {
  const payments = contract.payments.map((row, paymentIndex) => {
    const paidAmount = (row.receipts ?? []).reduce((sum, receipt) => sum + receipt.amount, 0);
    return { ...row, paymentIndex, paidAmount, outstandingAmount: row.installationAmount + row.supportAmount - paidAmount };
  });
  const paidAmount = payments.reduce((sum, row) => sum + row.paidAmount, 0);
  return { ...contract, payments, paidAmount,
    outstandingAmount: contract.installationAmount + contract.supportAmount - paidAmount };
}

export function seedAccountingExamples({ state, now, nextId, stages }) {
  if (state.accountingExamplesLoaded) return;
  const today = accountingDay(now());
  const date = (offset, hour) => {
    const day = new Date(today + `T${hour}:00:00+05:00`); day.setUTCDate(day.getUTCDate() + offset); return day.toISOString();
  };
  function example(city, offset, status, expenses, actual, advance) {
    const plannedStart = date(offset, '09'); const plannedEnd = date(offset + 1, '18');
    const budget = { dailyRate: 10000, transport: expenses, lodging: 0, meals: 0, other: 0 };
    const estimate = { ...budget, ...tripBudgetTotals(budget, plannedStart, plannedEnd) };
    const offer = { id: nextId(), employeeId: 'demo-employee', employeeName: 'Демо-сотрудник', sample: true,
      selfRequested: true, requestId: `example-${city}`, revision: 1, status: status === 'waiting' ? 'awaiting_approval' : 'confirmed',
      destination: city, purpose: 'Учебный пример · обслуживание оборудования', comment: 'Вымышленные данные для проверки кабинета.',
      plannedStart, plannedEnd, plannedDays: estimate.days, estimate, dailyRate: budget.dailyRate, stops: [], createdAt: now(),
      approvalStages: stages.map((stage, index) => ({ ...stage, status: status === 'waiting' ? index ? 'pending' : 'waiting' : 'approved' })) };
    state.offers.push(offer);
    if (status === 'waiting') return;
    const trip = { ...offer, id: nextId(), offerId: offer.id, status, taskCount: 0,
      actualExpenses: { revision: actual == null ? 0 : 1, expensesTotal: actual,
        plannedExpensesTotal: expenses, plannedTotal: estimate.total, workTotal: estimate.workTotal,
        ...(actual == null ? {} : { transport: actual, lodging: 0, meals: 0, other: 0, actualTotal: actual + estimate.workTotal, expenseDelta: actual - expenses, note: 'Учебная сумма. Документы сверяются отдельно.' }) } };
    offer.tripId = trip.id;
    if (status === 'finished') { trip.startedAt = plannedStart; trip.finishedAt = plannedEnd; }
    if (advance) trip.finance = { revision: 1, review: null, transactions: [{ id: nextId(), requestId: 'sample-advance',
      kind: 'advance', amount: advance, date: accountingDay(plannedStart), note: 'Учебный аванс', recordedBy: 'Демо-бухгалтер', createdAt: now() }] };
    state.trips.push(trip);
  }
  example('Актобе', 2, 'waiting', 28000, null, 0);
  example('Павлодар', 3, 'planned', 45000, null, 0);
  example('Алматы', -4, 'finished', 40000, 36500, 40000);
  state.accountingContracts = [...(state.accountingContracts ?? []), { id: 'example-contract', number: 'ПРИМЕР-01', sample: true,
    signedOn: accountingDay(date(-30, '09')), customer: 'Учебный бизнес-центр', legalEntity: 'Демо-компания',
    objectIds: [], status: 'active', paymentMode: 'combined', installationAmount: 200000, supportAmount: 100000,
    payments: [{ dueOn: accountingDay(date(-2, '09')), installationAmount: 200000, supportAmount: 100000, receipts: [] }],
    closingDocuments: [{ id: 'example-document', taskId: 'ПРИМЕР', taskTitle: 'Обслуживание оборудования · учебный пример', canRecord: true }] }];
  state.accountingExamplesLoaded = true;
}

// Demo-only ledger. Reuses the trips adapter's serialized queue and storage commit.
// Recording a transaction never calls a bank, 1C or any other external service.
export async function handleDemoAccounting({ state, role, path, method, body, now, nextId, save, stages }) {
  const accountant = role === 'accountant';
  if (method === 'GET' && path === '/accounting') {
    check(accountant, 'Кабинет доступен бухгалтеру.');
    return clone({ offers: state.offers, trips: state.trips.map(accountingTrip),
      contracts: (state.accountingContracts ?? []).map(contractView), examplesLoaded: Boolean(state.accountingExamplesLoaded) });
  }
  if (method === 'POST' && path === '/accounting/examples') {
    check(accountant, 'Примеры загружает бухгалтер.');
    if (state.accountingExamplesLoaded) return { loaded: true };
    seedAccountingExamples({ state, now, nextId, stages });
    return save({ loaded: true });
  }
  const financeMatch = path.match(/^\/accounting\/trips\/([^/]+)\/(transactions|review)$/);
  if (method === 'POST' && financeMatch) {
    check(accountant, 'Финансовые отметки доступны бухгалтеру.');
    const trip = state.trips.find(item => item.id === financeMatch[1]);
    check(trip, 'Поездка не найдена.');
    const current = accountingTrip(trip);
    const ledger = trip.finance ?? { revision: 0, transactions: [], review: null };
    if (financeMatch[2] === 'transactions') {
      check(typeof body.requestId === 'string' && body.requestId.length > 0, 'Повторите сохранение.');
      const previous = ledger.transactions.find(row => row.requestId === body.requestId);
      if (previous) {
        check(previous.amount === body.amount && previous.kind === body.kind && previous.date === body.date && (previous.documentId ?? null) === (body.documentId ?? null), 'Повторная операция отличается от сохранённой.');
        return clone({ trip: current });
      }
    }
    check(body.expectedRevision === ledger.revision, 'Данные изменились. Обновите карточку.');
    check(['planned', 'active', 'finished'].includes(trip.status), 'Поездка ещё не согласована.');
    if (financeMatch[2] === 'review') {
      check(trip.status === 'finished' && trip.actualExpenses?.expensesTotal != null, 'Дождитесь завершения поездки и фактических расходов.');
      check(body.actualRevision === trip.actualExpenses.revision && body.receiptRevision === (trip.receiptRevision ?? 0), 'Сотрудник обновил отчёт. Проверьте новую версию.');
      check(['approved', 'returned'].includes(body.action), 'Выберите решение.');
      const reason = String(body.reason ?? '').trim();
      check(body.action !== 'returned' || reason, 'Укажите замечание для сотрудника.');
      check(body.action !== 'approved' || body.documentsChecked === true, 'Подтвердите сверку документов.');
      ledger.review = { status: body.action, reason, actualRevision: body.actualRevision, receiptRevision: body.receiptRevision,
        documentsChecked: body.documentsChecked === true, recordedBy: 'Демо-бухгалтер', createdAt: now() };
      ledger.reviews = [...(ledger.reviews ?? []), clone(ledger.review)];
    } else {
      check(['advance', 'payment', 'refund'].includes(body.kind), 'Выберите вид операции.');
      check(Number.isInteger(body.amount) && body.amount > 0 && body.amount <= 999999999, 'Введите положительную сумму в целых тенге.');
      check(validDay(body.date, accountingDay(now())), 'Дата операции должна быть не позднее сегодняшнего дня.');
      if (body.kind === 'advance') {
        check(trip.status !== 'finished' && body.amount <= current.finance.remainingAdvance, 'Аванс не должен превышать оставшиеся плановые расходы.');
      } else {
        check(trip.status === 'finished' && current.finance.reviewStatus === 'approved', 'Сначала примите актуальный отчёт по расходам.');
        check((body.kind === 'payment' && current.finance.balance > 0) || (body.kind === 'refund' && current.finance.balance < 0), 'Проверьте направление расчёта.');
        check(body.amount <= Math.abs(current.finance.balance), 'Сумма превышает остаток к расчёту.');
      }
      if (body.documentId) {
        const document = (state.documents ?? []).find(item => item.id === body.documentId);
        check(body.kind === 'advance' && document?.kind === 'advance' && document.tripId === trip.id && document.status === 'approved', 'Сначала примите заявление на аванс.');
        const paid = ledger.transactions.filter(item => item.documentId === document.id).reduce((sum, item) => sum + item.amount, 0);
        check(body.amount <= document.content.amount - paid, 'Сумма превышает остаток по заявлению.');
      }
      ledger.transactions.push({ id: nextId(), requestId: body.requestId, kind: body.kind, amount: body.amount, date: body.date,
        documentId: body.documentId ?? null, note: String(body.note ?? '').trim().slice(0, 1000), recordedBy: 'Демо-бухгалтер', createdAt: now() });
    }
    ledger.revision++; trip.finance = ledger;
    return save({ trip: accountingTrip(trip) });
  }
  const receiptMatch = path.match(/^\/trips\/([^/]+)\/receipts$/);
  if (method === 'POST' && receiptMatch) {
    check(role === 'employee', 'Чеки прикрепляет сотрудник.');
    const trip = state.trips.find(item => item.id === receiptMatch[1]);
    check(trip && ['active', 'finished'].includes(trip.status), 'Чеки доступны после начала поездки.');
    check(typeof body.requestId === 'string' && body.requestId.length > 0, 'Повторите добавление чека.');
    if ((trip.receipts ?? []).some(item => item.requestId === body.requestId)) return clone({ trip: accountingTrip(trip) });
    check((trip.receipts ?? []).length < 5, 'Для демо можно прикрепить до пяти фото чеков.');
    check(typeof body.data === 'string' && body.data.length < 2000000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(body.data), 'Выберите фото чека до 1,5 МБ.');
    trip.receipts = [...(trip.receipts ?? []), { id: nextId(), requestId: body.requestId, name: String(body.name || 'Фото чека').slice(0, 120), data: body.data, createdAt: now() }];
    trip.receiptRevision = (trip.receiptRevision ?? 0) + 1;
    return save({ trip: accountingTrip(trip) });
  }
  if (path === '/contracts' || path.startsWith('/contracts/')) {
    check(role === 'accountant' || role === 'manager', 'Договоры доступны бухгалтеру и руководителю.');
    const contracts = state.accountingContracts ?? [];
    if (method === 'GET' && path === '/contracts') return clone({ contracts: contracts.map(contractView) });
    const match = path.match(/^\/contracts\/([^/]+)(?:\/(receipts|closing-documents\/([^/]+)\/(avr|esf)))?$/);
    check(match, 'Действие недоступно в демо.');
    const contract = contracts.find(item => item.id === match[1]); check(contract, 'Договор не найден.');
    const result = () => ({ contract: contractView(contract), permissions: { canIssueDocuments: accountant } });
    if (method === 'GET' && !match[2]) return clone(result());
    check(method === 'POST' && accountant, 'Отметки вносит бухгалтер.');
    const today = accountingDay(now());
    if (match[2] === 'receipts') {
      const row = contract.payments[body.paymentIndex]; check(row, 'Платёж не найден.');
      check(typeof body.requestId === 'string' && body.requestId.length > 0, 'Повторите сохранение.');
      const existing = row.receipts.find(item => item.requestId === body.requestId);
      if (existing) { check(existing.amount === body.amount && existing.receivedOn === body.receivedOn, 'Повторная операция отличается от сохранённой.'); return clone(result()); }
      check(Number.isInteger(body.amount) && body.amount > 0 && body.amount <= contractView(contract).payments[body.paymentIndex].outstandingAmount, 'Сумма превышает остаток по платежу.');
      check(validDay(body.receivedOn, today), 'Проверьте дату поступления.');
      row.receipts.push({ id: nextId(), ...body, recordedBy: { name: 'Демо-бухгалтер' } });
    } else {
      const document = contract.closingDocuments.find(item => item.id === match[3]); const kind = match[4];
      check(document && ['avr', 'esf'].includes(kind), 'Документ не найден.');
      check(body.number?.trim() && validDay(body.issuedOn, today), 'Укажите номер и дату документа.');
      check(kind !== 'esf' || document.avr && body.issuedOn >= document.avr.issuedOn, 'Сначала отметьте АВР; дата ЭСФ не должна быть раньше АВР.');
      if (document[kind]) { check(document[kind].number === body.number.trim() && document[kind].issuedOn === body.issuedOn, 'Документ уже отмечен.'); return clone(result()); }
      document[kind] = { number: body.number.trim(), issuedOn: body.issuedOn, recordedByName: 'Демо-бухгалтер' };
    }
    return save(result());
  }
  return null;
}
