package qwork;

import java.sql.Connection;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeParseException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

import static qwork.Domain.error;
import static qwork.Domain.field;
import static qwork.Domain.number;

final class ContractClosingDocuments {
    static final String SQLITE_SCHEMA = """
        CREATE TABLE IF NOT EXISTS contract_closing_document_tasks (
            id INTEGER PRIMARY KEY,
            contract_id INTEGER NOT NULL REFERENCES work_contracts(id),
            task_id INTEGER NOT NULL UNIQUE REFERENCES tasks(id),
            created_at TEXT NOT NULL,
            created_by INTEGER NOT NULL REFERENCES users(id),
            created_by_name TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS contract_closing_tasks_by_contract
            ON contract_closing_document_tasks(contract_id, id);
        CREATE TABLE IF NOT EXISTS contract_closing_document_marks (
            closing_task_id INTEGER NOT NULL REFERENCES contract_closing_document_tasks(id),
            kind TEXT NOT NULL CHECK (kind IN ('avr', 'esf')),
            document_number TEXT NOT NULL,
            issued_on TEXT NOT NULL,
            recorded_at TEXT NOT NULL,
            recorded_by INTEGER NOT NULL REFERENCES users(id),
            recorded_by_name TEXT NOT NULL,
            PRIMARY KEY (closing_task_id, kind)
        );
        """;

    private static final ZoneId COMPANY_ZONE = ZoneId.of("Asia/Almaty");
    private static final Pattern DATE = Pattern.compile("[0-9]{4}-[0-9]{2}-[0-9]{2}");
    private static final String INSERT_FROM_ACCEPTED_TASKS = """
        INSERT INTO contract_closing_document_tasks(contract_id, task_id, created_at, created_by, created_by_name)
        SELECT contract.id, task.id, accepted.created_at, accepted.actor_id, accepted.actor_name
        FROM tasks task
        JOIN work_trip_tasks link ON link.task_id = task.id
        JOIN work_trips trip ON trip.id = link.trip_id AND trip.company_id = task.company_id
        JOIN work_trip_offers offer ON offer.trip_id = trip.id AND offer.company_id = trip.company_id
        JOIN work_contracts contract ON contract.id = offer.contract_id AND contract.company_id = trip.company_id
        JOIN task_events accepted ON accepted.id = (
            SELECT MAX(event.id) FROM task_events event WHERE event.task_id = task.id AND event.status = 'done'
        )
        WHERE task.status = 'done' AND contract.status = 'active'
          AND NOT EXISTS (SELECT 1 FROM contract_closing_document_tasks documents WHERE documents.task_id = task.id)
        """;

    private ContractClosingDocuments() {}

    // Called inside the transaction that accepts the report or attaches it to a contract trip.
    static void ensureForAcceptedTask(Connection db, Map<String, Object> user, long taskId) throws SQLException {
        Db.update(db, INSERT_FROM_ACCEPTED_TASKS + """
            AND task.company_id = ? AND task.id = ?
            ON CONFLICT (task_id) DO NOTHING
            """, number(user, "company_id"), taskId);
    }

    static int backfill(Connection db) throws SQLException {
        return Db.update(db, INSERT_FROM_ACCEPTED_TASKS + "ON CONFLICT (task_id) DO NOTHING");
    }

    static List<Map<String, Object>> list(Connection db, long companyId, long contractId) throws SQLException {
        return Db.rows(db, """
            SELECT documents.id, documents.task_id, documents.created_at, documents.created_by_name,
                task.title AS task_title, task.status AS task_status, contract.status AS contract_status,
                avr.document_number AS avr_number, avr.issued_on AS avr_issued_on,
                avr.recorded_at AS avr_recorded_at, avr.recorded_by_name AS avr_recorded_by_name,
                esf.document_number AS esf_number, esf.issued_on AS esf_issued_on,
                esf.recorded_at AS esf_recorded_at, esf.recorded_by_name AS esf_recorded_by_name
            FROM contract_closing_document_tasks documents
            JOIN work_contracts contract ON contract.id = documents.contract_id
            JOIN tasks task ON task.id = documents.task_id AND task.company_id = contract.company_id
            LEFT JOIN contract_closing_document_marks avr ON avr.closing_task_id = documents.id AND avr.kind = 'avr'
            LEFT JOIN contract_closing_document_marks esf ON esf.closing_task_id = documents.id AND esf.kind = 'esf'
            WHERE contract.company_id = ? AND contract.id = ?
            ORDER BY documents.created_at DESC, documents.id DESC
            """, companyId, contractId).stream().map(ContractClosingDocuments::json).toList();
    }

    static void record(Connection db, Map<String, Object> user, long contractId, long documentId,
                       String kind, Map<String, Object> payload) throws SQLException {
        if (!Accounts.isAccountant(user)) throw error(403, "Выставление документов может отметить бухгалтер.");
        String name = switch (kind) {
            case "avr" -> "АВР";
            case "esf" -> "ЭСФ";
            default -> throw error(404, "Вид документа не найден.");
        };
        long company = number(user, "company_id");
        var document = Db.one(db, """
            SELECT documents.task_id, contract.status AS contract_status
            FROM contract_closing_document_tasks documents
            JOIN work_contracts contract ON contract.id = documents.contract_id
            JOIN tasks task ON task.id = documents.task_id AND task.company_id = contract.company_id
            WHERE documents.id = ? AND contract.id = ? AND contract.company_id = ?
            """, documentId, contractId, company);
        if (document == null) throw error(404, "Задача на АВР не найдена.");

        String documentNumber = field(payload, "number", "Номер " + name, 120, false);
        LocalDate issuedOn = issueDate(payload.get("issuedOn"));
        long taskId = number(document, "task_id");
        // Share the report's lock with acceptance and reopening to serialize issuance against them.
        Db.lockTask(db, company, taskId);
        var prior = findMark(db, documentId, kind);
        if (prior != null) {
            if (documentNumber.equals(prior.get("document_number")) && issuedOn.toString().equals(prior.get("issued_on"))) {
                return;
            }
            throw error(409, name + " уже отмечен. Откройте карточку договора заново.",
                "contract_document_already_recorded");
        }
        var task = Db.one(db, "SELECT status FROM tasks WHERE id = ? AND company_id = ?", taskId, company);
        if (!"done".equals(task.get("status")) || !"active".equals(document.get("contract_status"))) {
            throw error(409, "Выставление можно отметить после приёмки отчёта по действующему договору.",
                "contract_document_report_not_accepted");
        }
        if (kind.equals("esf")) {
            var avr = findMark(db, documentId, "avr");
            if (avr == null) {
                throw error(409, "Сначала отметьте выставление АВР.", "contract_document_avr_required");
            }
            if (issuedOn.isBefore(LocalDate.parse((String) avr.get("issued_on")))) {
                throw error(400, "Дата ЭСФ не может быть раньше даты АВР.");
            }
        }
        Db.update(db, """
            INSERT INTO contract_closing_document_marks(
                closing_task_id, kind, document_number, issued_on, recorded_at, recorded_by, recorded_by_name)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """, documentId, kind, documentNumber, issuedOn.toString(), Instant.now().toString(),
            number(user, "id"), user.get("name"));
    }

    private static Map<String, Object> findMark(Connection db, long documentId, String kind) throws SQLException {
        return Db.one(db, """
            SELECT document_number, issued_on FROM contract_closing_document_marks
            WHERE closing_task_id = ? AND kind = ?
            """, documentId, kind);
    }

    private static LocalDate issueDate(Object value) {
        if (!(value instanceof String text) || !DATE.matcher(text).matches()) {
            throw error(400, "Укажите корректную дату выставления.");
        }
        LocalDate date;
        try {
            date = LocalDate.parse(text);
        } catch (DateTimeParseException invalid) {
            throw error(400, "Укажите корректную дату выставления.");
        }
        if (date.getYear() < 1) throw error(400, "Укажите корректную дату выставления.");
        if (date.isAfter(LocalDate.now(COMPANY_ZONE))) {
            throw error(400, "Дата выставления не может быть позже сегодняшней даты.");
        }
        return date;
    }

    private static Map<String, Object> json(Map<String, Object> row) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", row.get("id").toString());
        result.put("taskId", row.get("task_id").toString());
        result.put("taskTitle", row.get("task_title"));
        result.put("createdAt", row.get("created_at"));
        result.put("createdByName", row.get("created_by_name"));
        result.put("canRecord", "done".equals(row.get("task_status")) && "active".equals(row.get("contract_status")));
        result.put("avr", markJson(row, "avr"));
        result.put("esf", markJson(row, "esf"));
        return result;
    }

    private static Map<String, Object> markJson(Map<String, Object> row, String kind) {
        if (row.get(kind + "_number") == null) return null;
        return Map.of(
            "number", row.get(kind + "_number"),
            "issuedOn", row.get(kind + "_issued_on"),
            "recordedAt", row.get(kind + "_recorded_at"),
            "recordedByName", row.get(kind + "_recorded_by_name")
        );
    }
}
