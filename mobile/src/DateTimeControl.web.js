import React from 'react';

const pad = value => String(value).padStart(2, '0');
const dateValue = value => value ? `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` : undefined;

export default function DateTimeControl({ value, mode, minimumDate, maximumDate, disabled, onChange }) {
  const time = mode === 'time';
  return <input type={time ? 'time' : 'date'} aria-label={time ? 'Время' : 'Дата'}
    value={time ? `${pad(value.getHours())}:${pad(value.getMinutes())}` : dateValue(value)}
    min={time ? undefined : dateValue(minimumDate)} max={time ? undefined : dateValue(maximumDate)} disabled={disabled}
    style={{ width: '100%', minHeight: 48, boxSizing: 'border-box', border: '1px solid #E8EEF6', borderRadius: 12,
      padding: 12, font: 'inherit', fontSize: 16, color: '#142034', background: '#F5F7FC' }}
    onChange={event => {
      if (!event.target.value || !event.target.validity.valid) return;
      const parts = event.target.value.split(time ? ':' : '-').map(Number);
      const next = new Date(value);
      if (time) next.setHours(parts[0], parts[1], 0, 0);
      else next.setFullYear(parts[0], parts[1] - 1, parts[2]);
      if (Number.isFinite(next.getTime())) onChange({ type: 'set' }, next);
    }} />;
}
