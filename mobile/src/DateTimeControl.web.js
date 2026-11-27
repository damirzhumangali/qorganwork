import React from 'react';
import MonthCalendar from './MonthCalendar';

const pad = value => String(value).padStart(2, '0');
const dateValue = value => value ? `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` : undefined;

export default function DateTimeControl({ value, mode, minimumDate, maximumDate, disabled, onChange }) {
  const time = mode === 'time';
  if (!time) return <MonthCalendar value={value} minimumDate={minimumDate} maximumDate={maximumDate}
    disabled={disabled} onSelect={date => onChange({ type: 'set' }, date)} />;
  function change(event) {
    if (!event.target.value || !event.target.validity.valid) return;
    const [hours, minutes] = event.target.value.split(':').map(Number);
    const next = new Date(value);
    next.setHours(hours, minutes, 0, 0);
    if (Number.isFinite(next.getTime())) onChange({ type: 'set' }, next);
  }
  return <input type={time ? 'time' : 'date'} aria-label={time ? 'Время' : 'Дата'}
    value={time ? `${pad(value.getHours())}:${pad(value.getMinutes())}` : dateValue(value)}
    min={time ? undefined : dateValue(minimumDate)} max={time ? undefined : dateValue(maximumDate)} disabled={disabled}
    style={{ width: '100%', minHeight: 48, boxSizing: 'border-box', border: '1px solid #E8EEF6', borderRadius: 12,
      padding: 12, font: 'inherit', fontSize: 16, color: '#142034', background: '#F5F7FC' }}
    onInput={change} onChange={change} />;
}
