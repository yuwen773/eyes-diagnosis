"""Fail-closed MySQL handoff with a separate Python history.

MySQL DDL commits implicitly. A durable RUNNING record precedes every upgrade;
FAILED/RUNNING records require investigation, never automatic DDL replay.
"""

from contextlib import contextmanager
from datetime import date, datetime
from decimal import Decimal
import base64
import hashlib
import json
from pathlib import Path
import re

import pymysql
from pymysql.cursors import DictCursor, SSCursor
from sqlalchemy.engine import make_url

from web.migrations.baseline import load_manifest, sha256, statements

HISTORY = "t_python_schema_history"
HISTORY_DDL = f"""CREATE TABLE {HISTORY} (
    version INT PRIMARY KEY,
    checksum CHAR(64) NOT NULL,
    state VARCHAR(16) NOT NULL,
    lastStatement INT NOT NULL DEFAULT 0,
    auditJson LONGTEXT NOT NULL,
    errorClass VARCHAR(64),
    startedAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    finishedAt DATETIME(6)
) ENGINE=InnoDB"""


class MigrationBlocked(Exception):
    def __init__(self, code: str, differences: list | None = None):
        self.code = code
        self.differences = differences or []
        super().__init__(code)


def connect(raw_url: str):
    url = make_url(raw_url)
    if url.drivername != "mysql+pymysql" or not url.database:
        raise MigrationBlocked("MYSQL_URL_REQUIRED")
    return pymysql.connect(host=url.host or "127.0.0.1", port=url.port or 3306,
                           user=url.username, password=url.password or "", database=url.database,
                           charset="utf8mb4", autocommit=False, connect_timeout=5,
                           read_timeout=60, write_timeout=60,
                           init_command="SET time_zone = '+08:00'")


def query(db, sql: str, args=None) -> list[dict]:
    with db.cursor(DictCursor) as cursor:
        cursor.execute(sql, args)
        return list(cursor.fetchall())


def execute(db, sql: str, args=None) -> None:
    with db.cursor() as cursor:
        cursor.execute(sql, args)


def identifier(name: str) -> str:
    return "`" + name.replace("`", "``") + "`"


def tables(db) -> list[str]:
    return [r["TABLE_NAME"] for r in query(db, "SELECT TABLE_NAME FROM information_schema.tables "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME")]


def schema_snapshot(db) -> dict[str, str]:
    result = {}
    case_sensitive = query(db, "SELECT @@lower_case_table_names AS mode")[0]["mode"] == 0
    for table in tables(db):
        normalized = table.lower()
        declared = "t_chatSession" if normalized == "t_chatsession" else normalized
        if case_sensitive and table != declared:
            raise MigrationBlocked("SCHEMA_TABLE_CASE", [{"table": table, "expected": declared}])
        if table in {HISTORY, "flyway_schema_history"}:
            continue
        if normalized in result:
            raise MigrationBlocked("SCHEMA_TABLE_CASE_COLLISION", [{"table": table}])
        row = query(db, f"SHOW CREATE TABLE {identifier(table)}")[0]
        ddl = row["Create Table"]
        ddl = re.sub(r" AUTO_INCREMENT=\d+", "", ddl)
        # Windows MySQL lower_case_table_names=1 versus Linux's case-sensitive 0.
        ddl = ddl.replace(f"CREATE TABLE `{table}`", f"CREATE TABLE `{table.lower()}`", 1)
        result[table.lower()] = ddl
    return result


def schema_differences(actual: dict, expected: dict) -> list[dict]:
    differences = []
    for name in sorted(actual.keys() | expected.keys()):
        if actual.get(name) == expected.get(name):
            continue
        columns = lambda ddl: dict(re.findall(r"(?m)^\s+`([^`]+)` (.+)$", ddl))
        old, new = columns(expected.get(name, "")), columns(actual.get(name, ""))
        differences.append({"code": "SCHEMA", "table": name,
                            "missingColumns": sorted(old.keys() - new.keys()),
                            "unexpectedColumns": sorted(new.keys() - old.keys()),
                            "changedColumns": sorted(k for k in old.keys() & new.keys() if old[k] != new[k]),
                            "expectedSha256": sha256(expected.get(name, "").encode()),
                            "actualSha256": sha256(actual.get(name, "").encode())})
    return differences


def canonical(value):
    if isinstance(value, bytes):
        return {"bytes": base64.b64encode(value).decode("ascii")}
    if isinstance(value, (datetime, date, Decimal)):
        return str(value)
    raise TypeError(type(value).__name__)


def digest(value) -> str:
    return sha256(json.dumps(value, default=canonical, sort_keys=True,
                             ensure_ascii=True, separators=(",", ":")).encode())


def increment_checksum(entry: dict, manifest: dict) -> str:
    schema_hash = next(file["sha256"] for file in manifest["files"] if file["asset"] == entry["schema"])
    return digest({**entry, "schemaSha256": schema_hash})


def data_snapshot(db, previous: dict | None = None) -> dict:
    """Whole-row digests, never values or individual password hashes in reports.

    On upgrade compare the original column projection, including checkpoint bytes,
    pending writes, ownership, AI provenance, review, consent and audit records.
    Operators must stop business writers before running this deployment step.
    """
    result = {}
    for table in (previous if previous is not None else tables(db)):
        if table == HISTORY:
            continue
        columns = (previous[table]["columns"] if previous is not None else
                   [r["Field"] for r in query(db, f"SHOW COLUMNS FROM {identifier(table)}")])
        primary = [r["Column_name"] for r in query(db, f"SHOW INDEX FROM {identifier(table)} "
                                                 "WHERE Key_name = 'PRIMARY'")]
        if not primary:
            raise MigrationBlocked("PRIMARY_KEY_REQUIRED", [{"table": table}])
        projection = ",".join(map(identifier, columns))
        order = ",".join(map(identifier, primary))
        hashed, count = hashlib.sha256(), 0
        with db.cursor(SSCursor) as cursor:
            cursor.execute(f"SELECT {projection} FROM {identifier(table)} ORDER BY {order}")
            for row in cursor:
                hashed.update((digest(row) + "\n").encode())
                count += 1
        result[table] = {"columns": columns, "count": count, "sha256": hashed.hexdigest()}
    return result


def legacy_version(db, manifest: dict) -> int:
    rows = query(db, "SELECT installed_rank, version, type, script, checksum, success "
                    "FROM flyway_schema_history ORDER BY installed_rank")
    expected = {str(e["version"]): e for e in manifest["legacy"]}
    differences, versions = [], []
    for index, row in enumerate(rows):
        version = row["version"]
        if not row["success"]:
            differences.append({"code": "FAILED_LEGACY_HISTORY", "rank": row["installed_rank"]})
        if row["type"] == "BASELINE":
            if index != 0 or version != "0" or row["checksum"] is not None:
                differences.append({"code": "LEGACY_BASELINE", "rank": row["installed_rank"]})
            continue
        entry = expected.get(version)
        if not entry or row["type"] != "SQL" or row["script"] != entry["script"]:
            differences.append({"code": "UNKNOWN_LEGACY_HISTORY", "rank": row["installed_rank"]})
            continue
        versions.append(int(version))
        if row["checksum"] != entry["checksum"]:
            differences.append({"code": "V8_CHECKSUM" if version == "8" else "LEGACY_CHECKSUM",
                                "version": version})
    if versions not in [list(range(1, 10)), list(range(1, 23))]:
        differences.append({"code": "UNSUPPORTED_LEGACY_START", "supported": [9, 22]})
    if [r["installed_rank"] for r in rows] != list(range(1, len(rows) + 1)):
        differences.append({"code": "LEGACY_RANK_GAP"})
    if differences:
        raise MigrationBlocked("LEGACY_BLOCKED", differences)
    return versions[-1]


def inspect_database(db, assets: Path) -> dict:
    version = query(db, "SELECT VERSION() AS version")[0]["version"]
    if not version.startswith("8.") or "MariaDB" in version:
        raise MigrationBlocked("UNSUPPORTED_MYSQL", [{"supported": "MySQL 8"}])
    defaults = query(db, "SELECT DEFAULT_CHARACTER_SET_NAME AS charset, DEFAULT_COLLATION_NAME AS collation "
                        "FROM information_schema.schemata WHERE SCHEMA_NAME=DATABASE()")[0]
    if defaults != {"charset": "utf8mb4", "collation": "utf8mb4_unicode_ci"}:
        raise MigrationBlocked("DATABASE_DEFAULTS", [{"code": "EXPECTED_UTF8MB4_UNICODE_CI"}])
    objects = []
    for kind, catalog, name, schema_column in [
        ("view", "views", "TABLE_NAME", "TABLE_SCHEMA"),
        ("trigger", "triggers", "TRIGGER_NAME", "TRIGGER_SCHEMA"),
        ("routine", "routines", "ROUTINE_NAME", "ROUTINE_SCHEMA"),
        ("event", "events", "EVENT_NAME", "EVENT_SCHEMA"),
    ]:
        objects += [{"code": "UNKNOWN_SCHEMA_OBJECT", "kind": kind, "name": row["name"]}
                    for row in query(db, f"SELECT {name} AS name FROM information_schema.{catalog} "
                                     f"WHERE {schema_column}=DATABASE() ORDER BY {name}")]
    if objects:
        raise MigrationBlocked("SCHEMA_BLOCKED", objects)
    manifest = load_manifest(assets)
    present = tables(db)
    if HISTORY in present:
        history = query(db, f"SELECT version, checksum, state, auditJson FROM {HISTORY} ORDER BY version")
        expected = {1: manifest["baselineChecksum"]}
        expected.update({e["version"]: increment_checksum(e, manifest) for e in manifest["increments"]})
        differences = []
        if not history:
            # Crash between CREATE history and durable RUNNING registration.
            raise MigrationBlocked("INCOMPLETE_UPGRADE", [{"code": "EMPTY_PYTHON_HISTORY"}])
        for row in history:
            if row["state"] != "APPLIED":
                differences.append({"code": "INCOMPLETE_UPGRADE", "version": row["version"], "state": row["state"]})
            if row["checksum"] != expected.get(row["version"]):
                differences.append({"code": "PYTHON_CHECKSUM", "version": row["version"]})
        if [r["version"] for r in history] != list(range(1, len(history) + 1)):
            differences.append({"code": "PYTHON_HISTORY_GAP"})
        if differences:
            raise MigrationBlocked("PYTHON_BLOCKED", differences)
        baseline = json.loads(history[0]["auditJson"])
        if baseline.get("legacyHistory") is not None:
            legacy_version(db, manifest)
            current_history = data_snapshot(db, {"flyway_schema_history": baseline["legacyHistory"]})
            if current_history["flyway_schema_history"] != baseline["legacyHistory"]:
                differences.append({"code": "LEGACY_HISTORY_CHANGED"})
        elif "flyway_schema_history" in present:
            differences.append({"code": "UNEXPECTED_LEGACY_HISTORY"})
        # Every Python increment freezes its resulting business schema separately.
        schema_file = "schema-v22.json" if len(history) == 1 else manifest["increments"][len(history) - 2]["schema"]
        expected_schema = json.loads((assets / schema_file).read_text(encoding="utf-8"))
        differences += schema_differences(schema_snapshot(db), expected_schema)
        if differences:
            raise MigrationBlocked("PYTHON_BLOCKED", differences)
        return {"status": "READY", "sourceVersion": "python", "pythonVersion": len(history),
                "pending": [e["version"] for e in manifest["increments"] if e["version"] > len(history)]}
    if not present:
        return {"status": "READY", "sourceVersion": "empty", "pythonVersion": 0}
    if "flyway_schema_history" not in present:
        raise MigrationBlocked("UNKNOWN_DATABASE", [{"code": "LEGACY_HISTORY_MISSING"}])
    source = legacy_version(db, manifest)
    expected_schema = json.loads((assets / f"schema-v{source}.json").read_text(encoding="utf-8"))
    differences = schema_differences(schema_snapshot(db), expected_schema)
    if differences:
        raise MigrationBlocked("SCHEMA_BLOCKED", differences)
    return {"status": "READY", "sourceVersion": source, "pythonVersion": 0}


@contextmanager
def migration_lock(db):
    name = "eye-python-migration:" + sha256(db.db)[:40]
    acquired = query(db, "SELECT GET_LOCK(%s, 0) AS acquired", (name,))[0]["acquired"]
    if acquired != 1:
        raise MigrationBlocked("UPGRADE_BUSY")
    try:
        yield
    finally:
        query(db, "SELECT RELEASE_LOCK(%s)", (name,))


def apply_step(db, version: int, checksum: str, sql: list[str], audit: dict, verify) -> None:
    execute(db, f"INSERT INTO {HISTORY} (version, checksum, state, auditJson) VALUES (%s,%s,'RUNNING',%s)",
            (version, checksum, json.dumps(audit, sort_keys=True)))
    db.commit()
    try:
        for index, statement in enumerate(sql, 1):
            execute(db, statement)
            execute(db, f"UPDATE {HISTORY} SET lastStatement=%s WHERE version=%s", (index, version))
            db.commit()
        db.commit()  # End any metadata read view before verifying committed DDL/data.
        verify()
        execute(db, f"UPDATE {HISTORY} SET state='APPLIED', finishedAt=CURRENT_TIMESTAMP(6) WHERE version=%s",
                (version,))
        db.commit()
    except Exception as error:
        db.rollback()
        code = error.code if isinstance(error, MigrationBlocked) else type(error).__name__
        differences = error.differences if isinstance(error, MigrationBlocked) else []
        execute(db, f"UPDATE {HISTORY} SET state='FAILED', errorClass=%s WHERE version=%s",
                (code, version))
        db.commit()
        raise MigrationBlocked("UPGRADE_FAILED", [{"version": version, "code": code}, *differences]) from None


def upgrade(db, assets: Path) -> dict:
    with migration_lock(db):
        # Inspect again inside the lock; never trust a prior preflight result.
        report = inspect_database(db, assets)
        manifest = load_manifest(assets)
        start = report["sourceVersion"]
        if report["pythonVersion"] == 0:
            before = data_snapshot(db)
            audit = {"sourceVersion": start, "data": before,
                     "legacyHistory": before.get("flyway_schema_history")}
            execute(db, HISTORY_DDL)
            db.commit()
            sql = []
            if start == "empty":
                for name in ["legacy/beforeMigrate__bootstrap_legacy_flyway_schema.sql", "business-bootstrap.sql"]:
                    sql += statements((assets / name).read_text(encoding="utf-8-sig"))
            for entry in manifest["legacy"]:
                if start == "empty" or entry["version"] > start:
                    sql += statements((assets / entry["asset"]).read_text(encoding="utf-8-sig"))

            def verify_baseline():
                expected = json.loads((assets / "schema-v22.json").read_text(encoding="utf-8"))
                differences = schema_differences(schema_snapshot(db), expected)
                if differences:
                    raise MigrationBlocked("SCHEMA_BLOCKED", differences)
                if data_snapshot(db, before) != before:
                    raise MigrationBlocked("DATA_CHANGED")

            apply_step(db, 1, manifest["baselineChecksum"],
                       sql, audit, verify_baseline)
            report["pythonVersion"] = 1
        changed = report["sourceVersion"] != "python"
        for entry in manifest["increments"]:
            if entry["version"] <= report["pythonVersion"]:
                continue
            if entry["version"] != report["pythonVersion"] + 1:
                raise MigrationBlocked("INCREMENT_GAP")
            before = data_snapshot(db)

            def verify_increment():
                expected = json.loads((assets / entry["schema"]).read_text(encoding="utf-8"))
                differences = schema_differences(schema_snapshot(db), expected)
                if differences or data_snapshot(db, before) != before:
                    raise MigrationBlocked("INCREMENT_VERIFICATION_FAILED", differences)

            apply_step(db, entry["version"], increment_checksum(entry, manifest),
                       statements((assets / entry["asset"]).read_text(encoding="utf-8-sig")),
                       {"data": before}, verify_increment)
            report["pythonVersion"] = entry["version"]
            changed = True
        return {"status": "APPLIED" if changed else "UNCHANGED", "sourceVersion": start,
                "pythonVersion": report["pythonVersion"], "differences": []}
