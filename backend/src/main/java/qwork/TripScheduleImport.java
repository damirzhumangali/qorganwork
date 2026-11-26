package qwork;

import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.SQLException;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

import static qwork.Domain.error;
import static qwork.Domain.field;

final class TripScheduleImport {
    private static final int YEAR_DAYS = 366;
    private static final int MAX_PERIOD_DAYS = 31;
    private static final Pattern EMPLOYEE_COLUMN = Pattern.compile("[B-M]");
    private static final Pattern SPACES = Pattern.compile("\\s+", Pattern.UNICODE_CHARACTER_CLASS);
    private static final Set<String> NON_VISITS = Set.of("выходной", "праздник", "отпуск", "отп", "отгул", "больничный",
        "б/с", "бс", "?", "сопровождение в офисе", "сопрвождение в офисе", "работы в офисе", "сопровождение из дома");

    record Period(LocalDate from, LocalDate to) {}

    private record Column(String key, String name, List<Map<String, String>> entries) {}

    private TripScheduleImport() {}

    static Map<String, Object> preview(Map<String, Object> user, Map<String, Object> payload) {
        Accounts.requireManager(user);
        var period = period(payload);
        var sheet = XlsxImport.readPayload(payload, YEAR_DAYS);
        var header = sheet.rows().getFirst();
        var dateHeader = header.cells().get("A");
        if (header.number() != 1 || dateHeader == null || dateHeader.formula()
                || !"№".equals(dateHeader.text().strip())) {
            throw error(400, "В ячейке A1 годового графика должен быть заголовок «№».");
        }
        var columns = new LinkedHashMap<String, Column>();
        for (char letter = 'B'; letter <= 'M'; letter++) {
            String key = String.valueOf(letter);
            var name = header.cells().get(key);
            if (name != null && (name.formula() || name.numeric() || name.text().length() > 120)) {
                throw error(400, "Проверьте имя сотрудника в ячейке " + key + "1.");
            }
            if (name != null && !name.text().isBlank()) {
                columns.put(key, new Column(key, name.text().strip(), new ArrayList<>()));
            }
        }
        if (columns.isEmpty()) throw error(400, "Укажите имена сотрудников в первой строке графика.");

        LocalDate last = null;
        for (var row : sheet.rows().subList(1, sheet.rows().size())) {
            var cell = row.cells().get("A");
            if (cell == null && row.cells().keySet().stream().noneMatch(key -> EMPLOYEE_COLUMN.matcher(key).matches())) {
                continue;
            }
            LocalDate date = dateCell(cell, sheet.dates1904(), row.number());
            if (last != null && !date.isAfter(last)) {
                throw error(400, "Даты в столбце A должны идти по порядку без повторов. Проверьте строку " + row.number() + ".");
            }
            last = date;
            if (date.isBefore(period.from()) || date.isAfter(period.to())) continue;
            for (var column : columns.values()) {
                var work = row.cells().get(column.key());
                if (work == null) continue;
                if (work.formula() || work.text().length() > 4_000) {
                    throw error(400, "Проверьте текст в ячейке " + column.key() + row.number() + ".");
                }
                String text = work.text().strip();
                String normalized = SPACES.matcher(text).replaceAll(" ").toLowerCase(Locale.ROOT);
                if (!text.isEmpty() && !NON_VISITS.contains(normalized)) {
                    column.entries().add(Map.of("date", date.toString(), "text", text));
                }
            }
        }
        return Map.of("columns", columns.values().stream()
            .map(column -> Map.of("key", column.key(), "name", column.name(), "entries", column.entries())).toList());
    }

    static Map<String, Object> draft(Connection db, Map<String, Object> user, Map<String, Object> payload)
            throws SQLException {
        Accounts.requireManager(user);
        long employee = Trips.identifier(payload.get("employeeId"), "Сотрудник");
        long contract = Trips.identifier(payload.get("contractId"), "Договор");
        long offer = TripOffers.createScheduleDraft(db, user, payload, employee, contract, period(payload));
        return Map.of("offerId", Long.toString(offer));
    }

    private static Period period(Map<String, Object> payload) {
        LocalDate from = date(field(payload, "from", "Начало периода", 10, false), "начала");
        LocalDate to = date(field(payload, "to", "Конец периода", 10, false), "окончания");
        long days = ChronoUnit.DAYS.between(from, to);
        if (days < 0 || days >= MAX_PERIOD_DAYS) throw error(400, "Выберите период от 1 до 31 дня.");
        return new Period(from, to);
    }

    private static LocalDate date(String value, String label) {
        try {
            if (value.length() == 10) return LocalDate.parse(value);
        } catch (DateTimeParseException invalid) {
            // Report the field name without reflecting input.
        }
        throw error(400, "Проверьте дату " + label + " периода.");
    }

    private static LocalDate dateCell(XlsxImport.Cell cell, boolean dates1904, int row) {
        try {
            if (cell != null && cell.numeric() && !cell.formula()) {
                return XlsxImport.excelDate(new BigDecimal(cell.text()).longValueExact(), dates1904);
            }
        } catch (IllegalArgumentException | ArithmeticException invalid) {
            // A date must be a valid whole Excel day.
        }
        throw error(400, "Проверьте дату Excel в ячейке A" + row + ".");
    }
}
