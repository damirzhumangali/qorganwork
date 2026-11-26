#!/usr/bin/env python3
"""Exercise contract schedules and closing documents against a disposable database."""

from base64 import b64encode
from contextlib import contextmanager
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
import json
import os
from pathlib import Path
import re
import struct
import subprocess
import tempfile
import time
import zlib
from urllib.error import HTTPError, URLError
from urllib.request import ProxyHandler, Request, build_opener
from uuid import uuid4
from zoneinfo import ZoneInfo


@contextmanager
def local_api(jar, directory):
    # Inherit the Java launcher setup without inheriting production database or service settings.
    env = {key: os.environ[key] for key in ("PATH", "JAVA_HOME", "LANG", "TMPDIR") if key in os.environ}
    env.update(QWORK_DB=str(directory / "contracts.sqlite3"), QWORK_PORT="0", QWORK_HOST="127.0.0.1")
    log_path = directory / "api.log"
    with log_path.open("wb") as log:
        server = subprocess.Popen(["java", "-jar", str(jar)], env=env, stdout=log, stderr=subprocess.STDOUT)
        opener = build_opener(ProxyHandler({}))
        try:
            deadline = time.monotonic() + 45
            while server.poll() is None and time.monotonic() < deadline:
                started = re.search(r"Tomcat started on port (\d+)", log_path.read_text(errors="replace"))
                if started:
                    base_url = f"http://127.0.0.1:{started.group(1)}"
                    try:
                        with opener.open(base_url + "/health", timeout=1) as response:
                            if response.status == 200:
                                break
                    except (URLError, TimeoutError):
                        pass
                time.sleep(0.1)
            else:
                raise RuntimeError(f"Local API did not start.\n{log_path.read_text(errors='replace')}")

            def call(method, path, expected=200, *, token=None, payload=None):
                headers = {"Accept": "application/json"}
                if token:
                    headers["Authorization"] = "Bearer " + token
                data = None
                if payload is not None:
                    headers["Content-Type"] = "application/json"
                    data = json.dumps(payload).encode("utf-8")
                request = Request(base_url + path, method=method, headers=headers, data=data)
                try:
                    response = opener.open(request, timeout=8)
                except HTTPError as error:
                    response = error
                with response:
                    status = response.status
                    raw = response.read()
                if status != expected:
                    raise AssertionError(f"{method} {path}: expected {expected}, got {status}: {raw.decode(errors='replace')}")
                return json.loads(raw)

            yield call
        finally:
            if server.poll() is None:
                server.terminate()
                try:
                    server.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    server.kill()
                    server.wait()


def report_photo():
    """Generate a valid, high-contrast proof image without external fixtures."""
    width, height = 640, 480
    scanlines = b"".join(
        b"\x00" + bytes(220 if (x // 20 + y // 20) % 2 else 50 for x in range(width))
        for y in range(height)
    )

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0))
    return b64encode(png + chunk(b"IDAT", zlib.compress(scanlines)) + chunk(b"IEND", b"")).decode("ascii")


def check_closing_documents(call, path, trip_id, site, today, manager, employee, accountant, other_accountant):
    original = call("GET", path, token=accountant)
    assert original["permissions"]["canIssueDocuments"] is True
    assert original["contract"]["closingDocuments"] == []
    assert call("GET", path, token=manager)["permissions"]["canIssueDocuments"] is False

    employee_id = call("GET", "/auth/me", token=employee)["user"]["id"]
    task = call("POST", "/tasks", 201, token=manager, payload={
        "title": "Монтаж и обучение заказчика",
        "objectId": site,
        "assigneeId": employee_id,
        "checklist": [{"id": "work", "title": "Работы выполнены"}],
    })["task"]
    task_path = f'/tasks/{task["id"]}'
    call("POST", f"/trips/{trip_id}/tasks", token=manager, payload={"taskIds": [task["id"]]})

    for status in ("accepted", "travel", "arrived"):
        transition = {"status": status, "expectedRevision": task["revision"]}
        if status == "arrived":
            transition["arrival"] = {"reason": "Тестовая отметка прибытия"}
        task = call("PATCH", task_path, token=employee, payload=transition)["task"]
    photo = report_photo()
    def upload(kind):
        return call("POST", task_path + "/photos", 201, token=employee, payload={
            "kind": kind, "imageBase64": photo,
        })["task"]

    upload("before")
    task = call("PATCH", task_path, token=employee, payload={"status": "work"})["task"]
    submission = {
        "status": "review", "checklist": [{"id": "work", "status": "done"}],
        "outcome": {"work": "Монтаж и обучение завершены"},
    }
    review = call("PATCH", task_path, token=employee, payload={
        **submission, "expectedRevision": upload("after")["revision"],
    })["task"]
    assert call("GET", path, token=accountant)["contract"]["closingDocuments"] == []

    acceptance = {"status": "done", "expectedRevision": review["revision"]}
    assert call("PATCH", task_path, token=manager, payload=acceptance)["task"]["status"] == "done"
    call("PATCH", task_path, 409, token=manager, payload=acceptance)
    documents = call("GET", path, token=accountant)["contract"]["closingDocuments"]
    assert len(documents) == 1
    document = documents[0]
    assert document["taskId"] == task["id"] and document["taskTitle"] == task["title"]
    assert document["createdByName"] == "Руководитель" and document["createdAt"]
    assert document["canRecord"] is True and document["avr"] is None and document["esf"] is None

    document_path = f'{path}/closing-documents/{document["id"]}'
    avr = {"number": "АВР-15", "issuedOn": today.isoformat()}
    esf = {"number": "ЭСФ-33", "issuedOn": today.isoformat()}
    call("POST", document_path + "/avr", 403, token=manager, payload=avr)
    call("POST", document_path + "/avr", 403, token=employee, payload=avr)
    call("POST", document_path + "/avr", 404, token=other_accountant, payload=avr)
    call("POST", document_path + "/esf", 409, token=accountant, payload=esf)
    call("POST", document_path + "/avr", 400, token=accountant, payload={
        **avr, "issuedOn": (today + timedelta(days=1)).isoformat(),
    })

    marked = call("POST", document_path + "/avr", token=accountant, payload=avr)
    assert marked == call("POST", document_path + "/avr", token=accountant, payload=avr)
    call("POST", document_path + "/avr", 409, token=accountant, payload={**avr, "number": "Другой АВР"})
    marked_task, = marked["contract"]["closingDocuments"]
    assert marked_task["esf"] is None
    call("PATCH", task_path, token=manager, payload={"status": "reopened", "reopenReason": "Дополнительная проверка"})
    reopened, = call("GET", path, token=accountant)["contract"]["closingDocuments"]
    assert reopened == {**marked_task, "canRecord": False}
    call("POST", document_path + "/esf", 409, token=accountant, payload=esf)
    call("PATCH", task_path, token=employee, payload={"status": "work"})
    review = call("PATCH", task_path, token=employee, payload={
        **submission, "expectedRevision": upload("after")["revision"],
    })["task"]
    call("PATCH", task_path, token=manager, payload={"status": "done", "expectedRevision": review["revision"]})
    assert call("GET", path, token=accountant)["contract"]["closingDocuments"] == [marked_task]
    call("POST", document_path + "/esf", 400, token=accountant, payload={
        **esf, "issuedOn": (today - timedelta(days=1)).isoformat(),
    })
    completed = call("POST", document_path + "/esf", token=accountant, payload=esf)["contract"]
    assert completed == call("GET", path, token=manager)["contract"]
    closing_task, = completed["closingDocuments"]
    for kind, fields in (("avr", avr), ("esf", esf)):
        mark = closing_task[kind]
        assert all(mark[key] == value for key, value in fields.items())
        assert mark["recordedAt"] and mark["recordedByName"] == "Бухгалтер"
    for field in ("paidAmount", "outstandingAmount", "payments"):
        assert completed[field] == original["contract"][field]
    return completed


def check_contracts(call):
    def register(company, email):
        return call("POST", "/auth/register", 201, payload={
            "company": company, "owner": "Руководитель", "email": email, "password": "test-owner-pass",
        })["token"]

    manager = register("Монтажная компания", "manager@example.test")
    outsider = register("Другая компания", "outside@example.test")

    def invite(owner, name, login, role):
        invitation = call("POST", "/employees", 201, token=owner, payload={
            "name": name, "login": login, "role": role,
        })
        session = call("POST", "/auth/login", payload={
            "login": login, "inviteToken": invitation["inviteToken"],
            "password": invitation["temporaryPassword"], "newPassword": "test-staff-pass",
        })
        assert session["user"]["role"] == role
        return session["token"]

    employee = invite(manager, "Инженер", "contracts-test-engineer", "employee")
    other_employee = invite(outsider, "Другой инженер", "contracts-other-engineer", "employee")
    accountant = invite(manager, "Бухгалтер", "contracts-test-accountant", "accountant")
    other_accountant = invite(outsider, "Другой бухгалтер", "contracts-other-accountant", "accountant")
    site = call("POST", "/objects", 201, token=manager, payload={
        "name": "Объект монтажа", "location": {"latitude": 51.13, "longitude": 71.43},
    })["object"]["id"]
    foreign_site = call("POST", "/objects", 201, token=outsider, payload={
        "name": "Чужой объект", "location": {"latitude": 51.14, "longitude": 71.44},
    })["object"]["id"]

    def payment(day, installation, support):
        return {"dueOn": day, "installationAmount": installation, "supportAmount": support}

    def plan(contract):
        return [payment(row["dueOn"], row["installationAmount"], row["supportAmount"]) for row in contract["payments"]]

    combined = {
        "number": "Д-2026/01", "signedOn": "2026-01-12", "customer": "Заказчик",
        "legalEntity": "ТОО Монтажная компания", "objectIds": [site],
        "installationAmount": 500_000, "supportAmount": 300_000, "paymentMode": "combined",
        "payments": [payment("2026-02-01", 500_000, 300_000)],
    }
    call("GET", "/contracts", 401)
    call("GET", "/contracts", 403, token=employee)
    call("POST", "/contracts", 403, token=employee, payload=combined)
    call("POST", "/contracts", 403, token=accountant, payload=combined)
    call("GET", "/tasks", 403, token=accountant)
    call("GET", "/employees", 403, token=accountant)
    call("POST", "/contracts", 400, token=manager, payload={**combined, "objectIds": [foreign_site]})
    draft = call("POST", "/contracts", 201, token=manager, payload=combined)["contract"]
    path = "/contracts/" + draft["id"]
    assert draft["status"] == "draft"
    assert draft["objectIds"] == [site]
    assert plan(draft) == combined["payments"]
    assert draft["paidAmount"] == 0 and draft["outstandingAmount"] == 800_000
    assert call("GET", path, token=manager)["contract"] == draft
    assert [row["id"] for row in call("GET", "/contracts", token=manager)["contracts"]] == [draft["id"]]
    assert call("GET", "/contracts", token=outsider)["contracts"] == []
    call("GET", path, 404, token=outsider)
    call("GET", path, 403, token=employee)
    call("GET", path, 404, token=other_accountant)
    call("POST", "/contracts", 409, token=manager, payload=combined)
    assert call("GET", "/trip-destinations", token=employee)["contracts"] == []

    today = datetime.now(ZoneInfo("Asia/Almaty")).date()

    def receipt(index, value, day=today):
        return {"paymentIndex": index, "amount": value, "receivedOn": day.isoformat(), "requestId": str(uuid4())}

    receipts_path = path + "/receipts"
    call("POST", receipts_path, 409, token=accountant, payload=receipt(0, 1))

    separate = {**combined, "paymentMode": "separate", "revision": draft["revision"], "payments": [
        payment("2026-02-01", 500_000, 0),
        payment("2026-03-01", 0, 100_000),
        payment("2026-04-01", 0, 200_000),
    ]}
    # Keep the grand total correct while misallocating the types, which must still be rejected.
    invalid = {**separate, "payments": [payment("2026-02-01", 490_000, 0), payment("2026-03-01", 0, 310_000)]}
    call("PUT", path, 400, token=manager, payload=invalid)
    assert call("GET", path, token=manager)["contract"] == draft
    call("PUT", path, 404, token=outsider, payload=separate)
    updated = call("PUT", path, token=manager, payload=separate)["contract"]
    assert updated["paymentMode"] == "separate"
    assert plan(updated) == separate["payments"]
    assert updated["revision"] > draft["revision"]
    call("PUT", path, 409, token=manager, payload=separate)
    call("POST", path + "/activate", 409, token=manager, payload={"revision": draft["revision"]})
    call("POST", path + "/activate", 403, token=accountant, payload={"revision": updated["revision"]})
    active = call("POST", path + "/activate", token=manager, payload={"revision": updated["revision"]})["contract"]
    assert active["status"] == "active"
    assert plan(active) == separate["payments"]
    assert call("POST", path + "/activate", token=manager,
                payload={"revision": updated["revision"]})["contract"] == active
    call("PUT", path, 409, token=manager, payload={**separate, "revision": active["revision"]})
    assert call("GET", path, token=accountant)["contract"] == active
    call("PUT", path, 403, token=accountant, payload={**separate, "revision": active["revision"]})

    first_receipt = receipt(0, 200_000)
    call("POST", receipts_path, 403, token=manager, payload=first_receipt)
    call("POST", receipts_path, 403, token=employee, payload=first_receipt)
    call("POST", receipts_path, 404, token=other_accountant, payload=first_receipt)
    call("POST", receipts_path, 400, token=accountant, payload=receipt(0, 1, today + timedelta(days=1)))
    call("POST", receipts_path, 409, token=accountant, payload=receipt(1, 100_001))

    partial = call("POST", receipts_path, 201, token=accountant, payload=first_receipt)["contract"]
    assert partial["paidAmount"] == 200_000 and partial["outstandingAmount"] == 600_000
    assert partial["payments"][0]["outstandingAmount"] == 300_000
    history = partial["payments"][0]["receipts"]
    assert len(history) == 1 and history[0]["recordedBy"]["name"] == "Бухгалтер"
    assert history[0]["receivedOn"] == today.isoformat() and history[0]["amount"] == 200_000
    assert call("POST", receipts_path, 201, token=accountant, payload=first_receipt)["contract"] == partial
    call("POST", receipts_path, 409, token=accountant, payload={**first_receipt, "amount": 1})

    def post_competing_payment(_):
        try:
            call("POST", receipts_path, 201, token=accountant, payload=receipt(0, 200_000))
            return True
        except AssertionError as failure:
            assert "got 409" in str(failure), str(failure)
            return False

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sum(pool.map(post_competing_payment, range(2))) == 1
    result = call("GET", path, token=manager)["contract"]
    assert result["paidAmount"] == 400_000 and result["outstandingAmount"] == 400_000
    assert result["payments"][0]["paidAmount"] == 400_000 and len(result["payments"][0]["receipts"]) == 2
    row = call("GET", "/contracts", token=accountant)["contracts"][0]
    assert row["paidAmount"] == 400_000 and row["outstandingAmount"] == 400_000
    assert call("GET", "/trip-destinations", token=employee)["contracts"] == [{
        "id": active["id"], "number": active["number"], "objects": [{"id": site, "name": "Объект монтажа"}],
    }]
    assert call("GET", "/trip-destinations", token=other_employee)["contracts"] == []

    # An existing contract may contain 50 objects. None can disappear from the trip route.
    names = ["Объект монтажа", "Объект монтажа"] + [f"Объект {index}" for index in range(3, 51)]
    all_sites = [site] + [call("POST", "/objects", 201, token=manager, payload={
        "name": name, "location": {"latitude": 51.13, "longitude": 71.43},
    })["object"]["id"] for name in names[1:]]
    route_contract = call("POST", "/contracts", 201, token=manager, payload={
        **combined, "number": "Д-2026/02", "objectIds": all_sites,
    })["contract"]
    route_contract_path = f'/contracts/{route_contract["id"]}'
    base = datetime(2030, 2, 1, 9, tzinfo=ZoneInfo("Asia/Almaty"))
    trip_payload = {
        "requestId": str(uuid4()), "contractId": route_contract["id"], "objectIds": list(reversed(all_sites)),
        "purpose": "Монтаж", "city": "Алматы", "dailyRate": 0,
        "plannedStart": base.isoformat(), "plannedEnd": (base + timedelta(days=3)).isoformat(),
        "visitTimes": [(base + timedelta(minutes=30 * index)).isoformat() for index in range(50)],
    }
    manager_id = call("GET", "/auth/me", token=manager)["user"]["id"]
    call("POST", "/trip-approval-settings", token=manager, payload={"approverIds": [manager_id]})
    call("POST", "/trip-offers", 404, token=employee, payload=trip_payload)
    call("POST", route_contract_path + "/activate", token=manager, payload={"revision": route_contract["revision"]})
    call("POST", "/trip-offers", 404, token=other_employee, payload=trip_payload)
    call("POST", "/trip-offers", 400, token=employee, payload={**trip_payload, "objectIds": [site]})
    call("POST", "/trip-offers", 400, token=employee, payload={
        **trip_payload, "objectIds": [foreign_site, *trip_payload["objectIds"][1:]],
    })
    trip = call("POST", "/trip-offers", 201, token=employee, payload=trip_payload)["offer"]
    assert trip["contractId"] == route_contract["id"] and trip["contractNumber"] == route_contract["number"]
    assert [stop["destination"] for stop in trip["stops"]] == [
        f"Алматы · {name} · объект №{object_id}" for object_id, name in reversed(list(zip(all_sites, names)))
    ]
    assert call("POST", "/trip-offers", 201, token=employee, payload=trip_payload)["offer"] == trip
    approved = call("POST", f'/trip-offers/{trip["id"]}/approval', token=manager, payload={
        "expectedRevision": trip["revision"], "stage": 1, "action": "approve",
    })["offer"]
    report_path = f'/trips/{approved["tripId"]}/report'
    report = call("GET", report_path, token=employee)["trip"]
    assert report["contractId"] == route_contract["id"] and report["stops"] == trip["stops"]
    closed = check_closing_documents(call, route_contract_path, approved["tripId"], site, today,
                                    manager, employee, accountant, other_accountant)
    assert call("GET", path, token=manager)["contract"] == result
    report = call("GET", report_path, token=employee)["trip"]

    standalone = {key: value for key, value in trip_payload.items()
                  if key not in ("contractId", "objectIds", "visitTimes", "city")}
    standalone.update(requestId=str(uuid4()), destination="Офис")
    offer = call("POST", "/trip-offers", 201, token=employee, payload=standalone)["offer"]
    assert offer["contractId"] is None and offer["stops"] == []
    return manager, path, result, report_path, report, route_contract_path, closed


def main():
    default_jar = Path(__file__).resolve().parents[1] / "target" / "qwork-api.jar"
    jar = Path(os.environ.get("QWORK_TEST_JAR", default_jar)).resolve()
    if not jar.is_file():
        raise SystemExit("Build the backend first, or set QWORK_TEST_JAR to the packaged API jar.")
    with tempfile.TemporaryDirectory(prefix="qwork-contracts-") as directory:
        directory = Path(directory)
        with local_api(jar, directory) as call:
            manager, path, active, report_path, report, closed_path, closed = check_contracts(call)
        with local_api(jar, directory) as call:
            assert call("GET", path, token=manager)["contract"] == active
            assert call("GET", report_path, token=manager)["trip"] == report
            assert call("GET", closed_path, token=manager)["contract"] == closed
    print("PASS contracts: schedules, activation, accountant access, receipts, trip routes, and closing documents")


if __name__ == "__main__":
    main()
