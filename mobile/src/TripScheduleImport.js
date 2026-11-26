import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import DeadlinePicker from './DeadlinePicker';
import { pickWorkbook } from './PlanningScreens';
import { organizationKey } from './TripDestinations';
import { colors, Icon } from './ui';

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const dateLabel = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' });

function dateKey(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function exactEmployee(name, employees) {
  const matches = employees.filter(employee => organizationKey(employee.name) === organizationKey(name));
  return matches.length === 1 ? String(matches[0].id) : null;
}

function exactObjects(entries, objects) {
  const names = new Set(entries.flatMap(({ text }) => [text, ...text.split(/\r?\n|;/)]).map(organizationKey));
  const ids = new Map();
  for (const { name, id } of objects) {
    const key = organizationKey(name);
    if (key) ids.set(key, ids.has(key) ? null : String(id));
  }
  return [...names].map(name => ids.get(name)).filter(Boolean);
}

function ScheduleButton({ children, icon, onPress, disabled, secondary }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled}
    onPress={onPress} style={({ pressed }) => [styles.button, secondary && styles.secondary,
      (pressed || disabled) && styles.dim]}>
    {icon && <Icon name={icon} size={17} color={secondary ? '#185DB0' : '#fff'} />}
    <Text style={[styles.buttonText, secondary && styles.secondaryText]}>{children}</Text>
  </Pressable>;
}

export default function TripScheduleImport({ request, offline = false, employees = [], contracts = [], Picker, onImported }) {
  const [from, setFrom] = useState(() => new Date());
  const [to, setTo] = useState(from);
  const [workbook, setWorkbook] = useState(null);
  const [preview, setPreview] = useState(null);
  const [columnKey, setColumnKey] = useState(null);
  const [employeeId, setEmployeeId] = useState(null);
  const [contractId, setContractId] = useState(null);
  const [objectIds, setObjectIds] = useState(null);
  const [purpose, setPurpose] = useState('Работы по графику');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(null);
  const [showEntries, setShowEntries] = useState(true);
  const locked = useRef(false);

  const disabled = offline || !request || Boolean(busy);
  const fromKey = dateKey(from);
  const toKey = dateKey(to);
  const validPeriod = toKey >= fromKey && (Date.parse(toKey) - Date.parse(fromKey)) / 86400000 < 31;
  const column = preview?.columns.find(item => item.key === columnKey);
  const employee = employees.find(item => String(item.id) === employeeId);
  const selectedContractId = contractId ?? (contracts.length === 1 ? String(contracts[0].id) : null);
  const contract = contracts.find(item => String(item.id) === selectedContractId);
  const objects = contract?.objects ?? [];
  const objectsById = new Map(objects.map(object => [String(object.id), object]));
  const selectedObjects = (objectIds ?? exactObjects(column?.entries ?? [], objects))
    .filter(id => objectsById.has(id));
  const selectedSites = selectedObjects.map(id => objectsById.get(id));
  const ready = Boolean(column?.entries.length && employee && contract
    && selectedObjects.length && selectedObjects.length <= 30 && purpose.trim());

  function clearOutcome() {
    setError('');
    setSaved(null);
  }

  function clearPreview() {
    setPreview(null);
    setColumnKey(null);
    setEmployeeId(null);
    setObjectIds(null);
  }

  function changeFrom(date) {
    setFrom(date);
    if (dateKey(date) > toKey) setTo(date);
    clearPreview();
    clearOutcome();
  }

  function changeTo(date) {
    setTo(date);
    clearPreview();
    clearOutcome();
  }

  function selectColumn(key, columns = preview.columns) {
    setColumnKey(key);
    setEmployeeId(exactEmployee(columns.find(item => item.key === key).name, employees));
    setObjectIds(null);
    setShowEntries(true);
    clearOutcome();
  }

  function selectEmployee(id) {
    setEmployeeId(id);
    clearOutcome();
  }

  function selectContract(id) {
    setContractId(id);
    setObjectIds(null);
    clearOutcome();
  }

  async function run(phase, action) {
    if (disabled || locked.current) return;
    locked.current = true;
    setBusy(phase);
    clearOutcome();
    try {
      await action();
    } catch (failure) {
      setError(failure?.message || 'Не удалось обработать график.');
    } finally {
      locked.current = false;
      setBusy(null);
    }
  }

  async function loadPreview(file) {
    clearPreview();
    const result = await request('/trip-offers/schedule/preview', {
      method: 'POST', body: { base64: file.base64, from: fromKey, to: toKey }, timeout: 60000,
    });
    if (!Array.isArray(result?.columns) || result.columns.some(item => !item || typeof item.key !== 'string'
        || typeof item.name !== 'string' || !Array.isArray(item.entries)
        || item.entries.some(entry => !entry || !DATE_KEY.test(entry.date) || !Number.isFinite(Date.parse(entry.date))
          || typeof entry.text !== 'string'))) {
      throw new Error('Сервер вернул неожиданный результат чтения графика.');
    }
    const columns = result.columns.filter(item => item.entries.length > 0);
    setPreview({ columns });
    if (columns.length === 1) selectColumn(columns[0].key, columns);
  }

  function chooseWorkbook() {
    return run('preview', async () => {
      const file = await pickWorkbook();
      if (!file) return;
      setWorkbook(file);
      await loadPreview(file);
    });
  }

  function saveDraft() {
    if (!ready || !preview || !validPeriod) return;
    return run('save', async () => {
      const draft = { employeeId, contractId: selectedContractId, objectIds: selectedObjects,
        from: fromKey, to: toKey, purpose: purpose.trim() };
      const result = await request('/trip-offers/schedule/draft', {
        method: 'POST', body: draft,
      });
      if (!result?.offerId) throw new Error('Сервер не подтвердил сохранение черновика.');
      setSaved({ id: result.offerId, employee: employee.name });
      if (onImported) void Promise.resolve().then(() => onImported(result)).catch(() => {});
    });
  }

  return <View style={styles.card}>
    <Text accessibilityRole="header" style={styles.title}>Импорт графика командировок</Text>
    <Text style={styles.muted}>Выберите даты одной поездки и загрузите график в формате Excel (.xlsx).</Text>
    <DeadlinePicker label="Начало периода" value={from} onChange={changeFrom} dateOnly required disabled={disabled} />
    <DeadlinePicker label="Конец периода" value={to} onChange={changeTo} minimumDate={from} dateOnly required disabled={disabled} />
    {!validPeriod && <Text style={styles.error}>Выберите период до 31 дня включительно.</Text>}
    {offline && <Text style={styles.error}>Для импорта нужен интернет.</Text>}
    {workbook && <Text style={styles.muted}>{workbook.name}</Text>}
    {workbook && !preview && <ScheduleButton onPress={() => run('preview', () => loadPreview(workbook))}
      disabled={disabled || !validPeriod} icon="calendar">
      {busy === 'preview' ? 'Читаем график…' : 'Показать записи за период'}
    </ScheduleButton>}
    <ScheduleButton onPress={chooseWorkbook} disabled={disabled || !validPeriod} icon="upload" secondary={Boolean(workbook)}>
      {busy === 'preview' && !workbook ? 'Читаем график…' : workbook ? 'Выбрать другой файл' : 'Выбрать Excel-файл'}
    </ScheduleButton>
    {preview && !preview.columns.length && <Text style={styles.muted}>За этот период нет записей о выездах.</Text>}
    {preview?.columns.length > 0 && <Picker label="Сотрудник в графике" icon="calendar" selected={columnKey}
      options={preview.columns.map(item => ({ id: item.key, label: item.name }))}
      onSelect={selectColumn} disabled={disabled} />}
    {column && <>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: showEntries }}
        onPress={() => setShowEntries(value => !value)} style={styles.entriesToggle}>
        <Text style={styles.label}>Записи за период · {column.entries.length}</Text>
        <Icon name={showEntries ? 'close' : 'chevron-right'} size={16} />
      </Pressable>
      {showEntries && <View style={styles.entries}>
        {column.entries.map((entry, index) => <View key={`${entry.date}-${index}`} style={styles.entry}>
          <Text style={styles.label}>{dateLabel.format(new Date(entry.date))}</Text>
          <Text style={styles.muted} selectable>{entry.text}</Text>
        </View>)}
      </View>}
      <Picker label="Сотрудник в Qwork" icon="user" selected={employeeId}
        options={employees.map(item => ({ id: String(item.id), label: item.name }))}
        onSelect={selectEmployee} disabled={disabled} empty="В Qwork ещё нет сотрудников для назначения." />
      <Picker label="Действующий договор" icon="clipboard" selected={selectedContractId}
        options={contracts.map(item => ({ id: String(item.id), label: `Договор ${item.number}` }))}
        onSelect={selectContract} disabled={disabled} empty="Нет действующих договоров с объектами." />
      {contract && <>
        <Picker label="Объекты поездки" icon="building" selected={selectedObjects}
          options={objects.map(item => ({ id: String(item.id), label: item.name, detail: item.address }))}
          onSelect={ids => { setObjectIds(ids); clearOutcome(); }} disabled={disabled}
          empty="В договоре нет объектов." />
        {selectedObjects.length > 30 && <Text style={styles.error}>В одной поездке может быть до 30 объектов.</Text>}
        {selectedSites.length > 0 ? <View style={styles.entries}>
          {selectedSites.map(site => <View key={String(site.id)} style={styles.entry}>
            <Text style={styles.label}>{site.name}</Text>
            {site.address ? <Text style={styles.muted}>{site.address}</Text> : null}
          </View>)}
        </View> : <Text style={styles.muted}>Сверьте записи графика и отметьте нужные объекты договора.</Text>}
      </>}
      <Text style={styles.label}>Задание</Text>
      <TextInput accessibilityLabel="Задание командировки" value={purpose}
        onChangeText={value => { setPurpose(value); clearOutcome(); }} editable={!disabled}
        maxLength={1000} multiline style={styles.input} />
      <ScheduleButton onPress={saveDraft} disabled={disabled || !ready || Boolean(saved)} icon="check">
        {busy === 'save' ? 'Сохраняем…' : 'Создать черновик командировки'}
      </ScheduleButton>
    </>}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {saved && <Text accessibilityLiveRegion="polite" style={styles.success}>
      Черновик №{saved.id} доступен сотруднику «{saved.employee}» в разделе «Выезды».
    </Text>}
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fff', borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: 14, gap: 10 },
  title: { color: colors.ink, fontSize: 17, fontWeight: '700' },
  label: { color: colors.ink, fontSize: 14, fontWeight: '600' },
  muted: { color: '#536680', fontSize: 13, lineHeight: 18 },
  button: { minHeight: 44, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 8, gap: 7,
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', backgroundColor: '#136BC9' },
  secondary: { backgroundColor: colors.tint },
  buttonText: { flexShrink: 1, color: '#fff', fontSize: 14, fontWeight: '600', textAlign: 'center' },
  secondaryText: { color: '#185DB0' },
  dim: { opacity: 0.55 },
  entriesToggle: { minHeight: 44, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 8, gap: 7, borderTopWidth: 1, borderColor: colors.border },
  entries: { backgroundColor: colors.canvas, borderRadius: 9, paddingHorizontal: 10 },
  entry: { borderBottomWidth: 1, borderColor: colors.border, paddingVertical: 8, gap: 4 },
  input: { borderColor: colors.border, borderWidth: 1, borderRadius: 9, minHeight: 44,
    paddingHorizontal: 10, paddingVertical: 8, color: colors.ink, fontSize: 14 },
  error: { color: '#9F2329', fontSize: 13, lineHeight: 18 },
  success: { color: '#176443', fontSize: 13, lineHeight: 18, fontWeight: '600' },
});
