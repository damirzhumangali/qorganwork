const companyDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Almaty', year: 'numeric', month: '2-digit', day: '2-digit',
});

function dayNumber(value) {
  const parts = Object.fromEntries(companyDay.formatToParts(value).map(({ type, value: part }) => [type, Number(part)]));
  return Date.UTC(parts.year, parts.month - 1, parts.day) / 86_400_000;
}

export function tripBudgetDays(start, end) {
  const first = start ? new Date(start) : null;
  const last = end ? new Date(end) : null;
  return first && last && Number.isFinite(+first) && Number.isFinite(+last) && last > first
    ? dayNumber(last) - dayNumber(first) + 1 : 0;
}

export function tripBudgetTotals(budget, start, end) {
  const days = tripBudgetDays(start, end);
  const dailyRate = budget?.dailyRate ?? 0;
  const workTotal = dailyRate * days;
  const expensesTotal = ['transport', 'lodging', 'meals', 'other'].reduce((sum, key) => sum + (budget?.[key] ?? 0), 0);
  return { days, dailyRate, workTotal, expensesTotal, total: workTotal + expensesTotal };
}

