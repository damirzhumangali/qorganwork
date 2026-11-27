import { tripBudgetTotals } from './tripBudgetCalculation';
import { handleDemoDocuments } from './demoDocuments';
import { accountingTrip, handleDemoAccounting } from './demoAccounting';

const STORAGE_KEY = 'qwork.demo-trips.v1';
const employee = { employeeId: 'demo-employee', employeeName: 'Демо-сотрудник' };
const stages = [
  { position: 1, title: 'Бухгалтер · проверка расходов', approverId: 'demo-accountant', approverName: 'Демо-бухгалтер' },
  { position: 2, title: 'Руководитель', approverId: 'demo-manager', approverName: 'Демо-руководитель' },
];
const freshStages = () => stages.map((stage, index) => ({ ...stage, status: index ? 'pending' : 'waiting' }));
const expenseKeys = ['transport', 'lodging', 'meals', 'other'];
const copy = value => JSON.parse(JSON.stringify(value));

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function amounts(body, keys) {
  return Object.fromEntries(keys.map(key => {
    const value = body[key] ?? 0;
    requireValue(Number.isInteger(value) && value >= 0 && value <= 999999999, 'Проверьте суммы расходов.');
    return [key, value];
  }));
}

// This adapter only reads/writes demo storage. It never authenticates or contacts the company API.
export function createDemoTrips(storage, now = () => new Date().toISOString()) {
  let queue = Promise.resolve();

  async function handle(role, path, { method = 'GET', body = {} } = {}) {
    requireValue(['employee', 'manager', 'accountant'].includes(role), 'Выберите роль для демонстрации.');
    let state;
    try {
      const saved = await storage.getItem(STORAGE_KEY);
      state = saved ? JSON.parse(saved) : { version: 1, nextId: 1, offers: [], trips: [], organizations: [] };
      requireValue(state.version === 1 && Number.isInteger(state.nextId)
        && ['offers', 'trips', 'organizations'].every(key => Array.isArray(state[key])), 'Invalid demo data');
    } catch {
      throw new Error('Не удалось прочитать демо-командировки. Обновите страницу и попробуйте снова.');
    }
    const offerView = offer => ({ ...offer, canDecideApproval: role !== 'employee' && offer.status === 'awaiting_approval'
      && offer.approvalStages?.find(stage => stage.status === 'waiting')?.approverId === `demo-${role}` });
    const save = async result => {
      try { await storage.setItem(STORAGE_KEY, JSON.stringify(state)); }
      catch { throw new Error('Не удалось сохранить командировку в браузере. Освободите место и попробуйте снова.'); }
      return copy(result);
    };
    const nextId = () => String(state.nextId++);

    const documents = await handleDemoDocuments({ state, role, path, method, body, now, nextId, save, stages });
    if (documents !== null) return documents;

    const accounting = await handleDemoAccounting({ state, role, path, method, body, now, nextId, save, stages });
    if (accounting !== null) return accounting;

    if (method === 'GET') {
      if (path === '/trip-offers') return copy({
        offers: state.offers.map(offerView), organizations: state.organizations,
        supportsTripSelfService: true, supportsTripOrganizations: true,
        supportsTripRoutes: true, supportsSingleStopRoutes: true,
        supportsTripImport: false, supportsTripScheduleImport: false,
      });
      if (path === '/trips') return copy({ trips: state.trips.map(accountingTrip) });
      if (path === '/trip-requests') return { requests: [] };
      if (path === '/trip-destinations') return { objects: [], contracts: [] };
      if (path === '/trip-approval-settings') return {
        configured: true, supportsSingleApprover: false, canEdit: false, stages: copy(stages),
      };
      const reportMatch = path.match(/^\/trips\/([^/]+)\/report$/);
      if (reportMatch) {
        const trip = state.trips.find(item => item.id === reportMatch[1]);
        requireValue(trip, 'Командировка не найдена.');
        return copy({ trip: accountingTrip(trip), tasks: [], summary: { completed: 0, awaitingReview: 0,
          elapsedMinutes: trip.startedAt && trip.finishedAt
            ? Math.max(0, Math.round((Date.parse(trip.finishedAt) - Date.parse(trip.startedAt)) / 60000)) : null } });
      }
    }

    if (method === 'POST' && path === '/trip-organizations') {
      requireValue(role === 'employee', 'Организацию добавляет сотрудник.');
      const name = String(body.name ?? '').trim();
      requireValue(name && name.length <= 200, 'Укажите название организации.');
      let organization = state.organizations.find(item => item.name.toLocaleLowerCase('ru') === name.toLocaleLowerCase('ru'));
      if (!organization) {
        organization = { id: nextId(), name };
        state.organizations.push(organization);
      }
      return save({ organization });
    }

    if (method === 'POST' && path === '/trip-offers') {
      requireValue(role === 'employee', 'Командировку создаёт сотрудник.');
      requireValue(typeof body.requestId === 'string' && body.requestId.length > 0, 'Повторите отправку формы.');
      const previous = state.offers.find(item => item.requestId === body.requestId);
      if (previous) return copy({ offer: offerView(previous) });
      const purpose = String(body.purpose ?? '').trim();
      const destinations = body.destinations;
      const destination = destinations?.[0] ?? String(body.destination ?? '').trim();
      requireValue(purpose && destination, 'Укажите место и цель поездки.');
      const budget = amounts(body, ['dailyRate', ...expenseKeys]);
      requireValue(body.dailyRate != null, 'Укажите ставку за день.');
      const totals = tripBudgetTotals(budget, body.plannedStart, body.plannedEnd);
      requireValue(totals.days > 0, 'Окончание поездки должно быть позже начала.');
      requireValue(!destinations || (Array.isArray(destinations) && destinations.length > 0
        && Array.isArray(body.visitTimes) && body.visitTimes.length === destinations.length), 'Проверьте маршрут поездки.');
      const stops = (destinations ?? []).map((name, index) => {
        const plannedAt = body.visitTimes[index];
        const time = Date.parse(plannedAt);
        requireValue(typeof name === 'string' && name.trim() && Number.isFinite(time)
          && time >= Date.parse(body.plannedStart) && time <= Date.parse(body.plannedEnd)
          && (index === 0 || time >= Date.parse(body.visitTimes[index - 1])), 'Укажите время посещения каждого объекта в пределах поездки.');
        return { id: nextId(), position: index + 1, destination: name.trim(), plannedAt,
          visitedAt: null, skippedAt: null, skipReason: null };
      });
      const timestamp = now();
      const offer = { id: nextId(), ...employee, requestId: body.requestId, revision: 1,
        selfRequested: true, status: 'awaiting_approval', destination, purpose,
        comment: String(body.comment ?? '').trim(), plannedStart: body.plannedStart, plannedEnd: body.plannedEnd,
        plannedDays: totals.days, dailyRate: budget.dailyRate, estimate: { ...budget, ...totals }, stops,
        approvalStages: freshStages(), createdAt: timestamp, updatedAt: timestamp };
      state.offers.unshift(offer);
      return save({ offer: offerView(offer) });
    }

    const proposalMatch = path.match(/^\/trip-offers\/([^/]+)\/proposal$/);
    if (method === 'POST' && proposalMatch) {
      requireValue(role === 'employee', 'Условия изменяет сотрудник.');
      const offer = state.offers.find(item => item.id === proposalMatch[1]);
      requireValue(offer && offer.status === 'awaiting_employee' && body.expectedRevision === offer.revision, 'Заявка уже изменена. Откройте её заново.');
      const budget = amounts(body, ['dailyRate', ...expenseKeys]);
      requireValue(body.dailyRate != null, 'Укажите ставку за день.');
      const totals = tripBudgetTotals(budget, body.plannedStart, body.plannedEnd);
      requireValue(totals.days > 0, 'Окончание поездки должно быть позже начала.');
      const route = body.stops ?? [];
      requireValue(route.length === offer.stops.length && new Set(route.map(stop => stop.id)).size === route.length, 'Проверьте маршрут.');
      const stops = route.map((item, index) => {
        const original = offer.stops.find(stop => stop.id === item.id); const time = Date.parse(item.plannedAt);
        requireValue(original && Number.isFinite(time) && time >= Date.parse(body.plannedStart) && time <= Date.parse(body.plannedEnd)
          && (!index || time > Date.parse(route[index - 1].plannedAt)), 'Проверьте время посещений.');
        return { ...original, plannedAt: item.plannedAt, position: index + 1 };
      });
      Object.assign(offer, { status: 'awaiting_approval', plannedStart: body.plannedStart, plannedEnd: body.plannedEnd,
        plannedDays: totals.days, dailyRate: budget.dailyRate, estimate: { ...budget, ...totals }, stops,
        approvalStages: freshStages(), revisionReason: null, revision: offer.revision + 1, updatedAt: now() });
      return save({ offer: offerView(offer) });
    }

    const approvalMatch = path.match(/^\/trip-offers\/([^/]+)\/approval$/);
    if (method === 'POST' && approvalMatch) {
      requireValue(role !== 'employee', 'Согласование доступно бухгалтеру и руководителю.');
      const offer = state.offers.find(item => item.id === approvalMatch[1]);
      requireValue(offer, 'Командировка не найдена.');
      requireValue(body.expectedRevision === offer.revision && offer.status === 'awaiting_approval',
        'Командировка уже изменена. Откройте её заново.');
      const pending = offer.approvalStages.find(stage => stage.status === 'waiting');
      requireValue(pending?.approverId === `demo-${role}` && body.stage === pending.position, 'Дождитесь своего этапа согласования.');
      requireValue(['approve', 'reject'].includes(body.action), 'Выберите решение.');
      const reason = String(body.reason ?? '').trim();
      requireValue(body.action !== 'reject' || reason, 'Укажите причину отклонения.');
      const timestamp = now();
      pending.status = body.action === 'approve' ? 'approved' : 'rejected';
      pending.decidedAt = timestamp; pending.reason = reason;
      offer.approvalHistory = [...(offer.approvalHistory ?? []), copy(pending)];
      offer.revision += 1; offer.updatedAt = timestamp;
      const next = offer.approvalStages.find(stage => stage.status === 'pending');
      const approved = body.action === 'approve' && !next;
      if (body.action === 'approve') {
        if (next) next.status = 'waiting';
        offer.status = approved ? 'confirmed' : 'awaiting_approval';
      } else if (role === 'accountant') {
        offer.status = 'awaiting_employee'; offer.revisionReason = reason;
        offer.previousProposal = { plannedStart: offer.plannedStart, plannedEnd: offer.plannedEnd, estimate: copy(offer.estimate) };
      } else offer.status = 'rejected';
      if (approved) {
        const id = nextId();
        offer.tripId = id;
        state.trips.unshift({ id, ...employee, sample: Boolean(offer.sample), offerId: offer.id, selfRequested: true, status: 'planned',
          destination: offer.destination, purpose: offer.purpose, comment: offer.comment,
          plannedStart: offer.plannedStart, plannedEnd: offer.plannedEnd, plannedDays: offer.plannedDays,
          estimate: copy(offer.estimate), stops: copy(offer.stops), taskCount: 0, createdAt: timestamp,
          actualExpenses: { revision: 0, expensesTotal: null, workTotal: offer.estimate.workTotal,
            plannedExpensesTotal: offer.estimate.expensesTotal, plannedTotal: offer.estimate.total } });
      }
      return save({ offer: offerView(offer) });
    }

    const actionMatch = path.match(/^\/trips\/([^/]+)\/(start|finish|actual-expenses|stops\/([^/]+))$/);
    if (method === 'POST' && actionMatch) {
      requireValue(role === 'employee', 'Отметки поездки вносит сотрудник.');
      const trip = state.trips.find(item => item.id === actionMatch[1]);
      requireValue(trip, 'Командировка не найдена.');
      const action = actionMatch[2];
      const timestamp = now();
      if (action === 'start') {
        requireValue(trip.status === 'planned', 'Поездка уже начата.');
        trip.status = 'active'; trip.startedAt = timestamp;
      } else if (action === 'finish') {
        requireValue(trip.status === 'active', 'Сначала начните поездку.');
        requireValue(trip.stops.every(stop => stop.visitedAt || stop.skippedAt), 'Отметьте все остановки перед завершением.');
        trip.status = 'finished'; trip.finishedAt = timestamp;
      } else if (action === 'actual-expenses') {
        requireValue(['active', 'finished'].includes(trip.status), 'Расходы доступны после начала поездки.');
        requireValue(body.expectedRevision === trip.actualExpenses.revision, 'Расходы уже изменены. Откройте поездку заново.');
        const values = amounts(body, expenseKeys);
        const expensesTotal = Object.values(values).reduce((sum, value) => sum + value, 0);
        trip.actualExpenses = { ...trip.actualExpenses, ...values, expensesTotal,
          expenseDelta: expensesTotal - trip.estimate.expensesTotal,
          actualTotal: trip.estimate.workTotal + expensesTotal, revision: trip.actualExpenses.revision + 1,
          note: String(body.note ?? '').trim(), updatedAt: timestamp };
        return save({ actualExpenses: trip.actualExpenses });
      } else {
        const stop = trip.stops.find(item => item.id === actionMatch[3]);
        requireValue(trip.status === 'active' && stop && !stop.visitedAt && !stop.skippedAt, 'Эта остановка недоступна для отметки.');
        requireValue(['visited', 'skipped'].includes(body.outcome), 'Выберите результат посещения.');
        if (body.outcome === 'visited') stop.visitedAt = timestamp;
        else {
          const reason = String(body.reason ?? '').trim();
          requireValue(reason, 'Укажите причину пропуска.');
          stop.skippedAt = timestamp; stop.skipReason = reason;
        }
        return save({ stop });
      }
      return save({ trip });
    }
    throw new Error('Это действие недоступно в демо-командировках.');
  }

  return (role, path, options) => {
    const result = queue.then(() => handle(role, path, options));
    queue = result.catch(() => {});
    return result;
  };
}
