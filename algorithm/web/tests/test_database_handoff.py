"""The database handoff's public CLI and frozen HTTP contracts."""

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[3]
ASSETS = ROOT / "deploy/python-migrations"


class SecretEnv(dict):
    def __repr__(self):
        return "<isolated child environment; values redacted>"


def isolated_env(**overrides):
    names = {"SYSTEMROOT", "WINDIR", "TEMP", "TMP", "LOCALAPPDATA", "APPDATA", "USERPROFILE",
             "HOMEDRIVE", "HOMEPATH", "OS", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "PATHEXT"}
    return SecretEnv({**{key: value for key, value in os.environ.items() if key.upper() in names},
                      "JAVA_HOME": "unavailable", "PATH": "", **overrides})


@dataclass
class MysqlCase:
    url: str = field(repr=False)
    env: dict = field(repr=False)

    def __iter__(self):
        yield self.url
        yield self.env


def cli(*args, env=None):
    return subprocess.run([sys.executable, "-m", "web.migrations", *args],
                          cwd=ROOT / "algorithm", env=env, capture_output=True, text=True)


def test_frozen_baseline_is_checkable_without_database_or_jvm():
    env = isolated_env(MIGRATION_MYSQL_URL="")
    result = cli("baseline-check", env=env)
    assert result.returncode == 0, result.stdout + result.stderr
    report = json.loads(result.stdout)
    assert report["status"] == "BASELINE_OK"
    assert report["legacyMigrations"] == 22
    assert report["differences"] == []


def test_changed_sql_bytes_are_reported_without_rebaselining(tmp_path):
    import shutil

    shutil.copytree(ASSETS, tmp_path / "assets")
    file = next((tmp_path / "assets/legacy").glob("V8__*.sql"))
    file.write_bytes(file.read_bytes() + b"\n-- drift\n")
    result = cli("baseline-check", "--assets", str(tmp_path / "assets"))
    assert result.returncode == 2
    assert "V8__add_mcp_server_description.sql" in result.stdout
    assert "ASSET_DIGEST" in result.stdout


def test_connection_errors_never_expose_secrets():
    env = isolated_env(MIGRATION_MYSQL_URL=
                       "mysql+pymysql://private-user:private-password@127.0.0.1:1/private-schema")
    result = cli("inspect", env=env)
    assert result.returncode == 2
    assert "private-password" not in result.stdout + result.stderr
    assert "private-user" not in result.stdout + result.stderr
    assert json.loads(result.stdout)["status"] == "CONNECTION_FAILED"


@pytest.fixture
def mysql_case():
    admin = os.getenv("HANDOFF_TEST_MYSQL_ADMIN_URL")
    if not admin:
        pytest.skip("Opt-in isolated real MySQL acceptance")
    from web.tests.handoff_fixtures import isolated_database

    url, _ = isolated_database(admin)
    return MysqlCase(url, isolated_env(MIGRATION_MYSQL_URL=url))


@pytest.mark.parametrize("source", ["empty", 9, 22])
def test_mysql_handoff_and_repeat_preserve_legacy_history_and_data(mysql_case, source):
    from web.migrations.runner import connect, data_snapshot, query, schema_snapshot
    from web.tests.handoff_fixtures import legacy_database

    url, env = mysql_case
    if source != "empty":
        legacy_database(url, source)
        with connect(url) as db:
            with db.cursor() as cursor:
                cursor.execute("INSERT INTO t_user (id,userAccount,userPassword,userName) "
                               "VALUES (9007199254740993,'synthetic-handoff','opaque-test-secret','Synthetic')")
                cursor.execute("INSERT INTO t_diagnosis (id,url,userId,result,modelVersion,humanReviewStatus) "
                               "VALUES (9007199254740995,'https://fixture.invalid/eye.png',9007199254740993,"
                               "'synthetic-ai','frozen-model','AI_ONLY')")
            db.commit()
            before = data_snapshot(db)
    result = cli("upgrade", env=env)
    assert result.returncode == 0, result.stdout + result.stderr
    assert json.loads(result.stdout)["status"] == "APPLIED"
    with connect(url) as db:
        assert schema_snapshot(db) == json.loads((ASSETS / "schema-v22.json").read_text())
        if source != "empty":
            assert data_snapshot(db, before) == before
        history = query(db, "SELECT version,state,lastStatement FROM t_python_schema_history")
        assert history[0]["state"] == "APPLIED" and history[0]["version"] == 1
    again = cli("upgrade", env=env)
    assert again.returncode == 0, again.stdout
    assert json.loads(again.stdout)["status"] == "UNCHANGED"
    assert cli("inspect", env=env).returncode == 0


@pytest.mark.parametrize("fault,expected", [
    ("v8", "V8_CHECKSUM"), ("checksum", "LEGACY_CHECKSUM"),
    ("failed", "FAILED_LEGACY_HISTORY"), ("unknown", "UNKNOWN_LEGACY_HISTORY"),
    ("schema", "SCHEMA"),
])
def test_unknown_legacy_states_are_rejected_before_any_write(mysql_case, fault, expected):
    from web.migrations.runner import connect, data_snapshot, schema_snapshot, tables
    from web.tests.handoff_fixtures import legacy_database

    url, env = mysql_case
    legacy_database(url, 22)
    sql = {
        "v8": "UPDATE flyway_schema_history SET checksum=17 WHERE version='8'",
        "checksum": "UPDATE flyway_schema_history SET checksum=17 WHERE version='9'",
        "failed": "UPDATE flyway_schema_history SET success=0 WHERE version='22'",
        "unknown": "UPDATE flyway_schema_history SET version='99' WHERE version='22'",
        "schema": "ALTER TABLE t_user CHANGE COLUMN userAccount user_account VARCHAR(256) NOT NULL",
    }[fault]
    with connect(url) as db:
        with db.cursor() as cursor:
            cursor.execute(sql)
        db.commit()
        before, structure = data_snapshot(db), schema_snapshot(db)
    for command in ["inspect", "upgrade"]:
        result = cli(command, env=env)
        assert result.returncode == 2, result.stdout
        assert expected in result.stdout
    with connect(url) as db:
        assert data_snapshot(db) == before
        assert schema_snapshot(db) == structure
        assert "t_python_schema_history" not in tables(db)


def increment_assets(tmp_path, sql, schema):
    import shutil
    from web.migrations.baseline import sha256

    assets = tmp_path / "increment-assets"
    shutil.copytree(ASSETS, assets)
    (assets / "P0002__acceptance.sql").write_text(sql, encoding="utf-8")
    (assets / "schema-p2.json").write_text(json.dumps(schema), encoding="utf-8")
    manifest = json.loads((assets / "manifest.json").read_text())
    for name in ["P0002__acceptance.sql", "schema-p2.json"]:
        manifest["files"].append({"asset": name, "sha256": sha256((assets / name).read_bytes())})
    manifest["increments"] = [{"version": 2, "asset": "P0002__acceptance.sql", "schema": "schema-p2.json",
                               "sha256": sha256((assets / "P0002__acceptance.sql").read_bytes())}]
    (assets / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    return assets


def test_independent_increment_runs_once_without_changing_legacy_history(mysql_case, tmp_path):
    from web.migrations.runner import connect, data_snapshot, schema_snapshot
    from web.tests.handoff_fixtures import legacy_database

    url, env = mysql_case
    legacy_database(url, 22)
    assert cli("upgrade", env=env).returncode == 0
    with connect(url) as db:
        before = data_snapshot(db)
        # Separate fixture database obtains the expected MySQL rendering.
    from web.tests.handoff_fixtures import isolated_database
    reference, _ = isolated_database(os.environ["HANDOFF_TEST_MYSQL_ADMIN_URL"])
    legacy_database(reference, 22)
    sql = "ALTER TABLE t_news ADD COLUMN handoffProbe VARCHAR(32) NULL;"
    with connect(reference) as db:
        with db.cursor() as cursor:
            cursor.execute(sql)
        structure = schema_snapshot(db)
    assets = increment_assets(tmp_path, sql, structure)
    result = cli("upgrade", "--assets", str(assets), env=env)
    assert result.returncode == 0, result.stdout
    assert json.loads(result.stdout)["pythonVersion"] == 2
    assert json.loads(cli("upgrade", "--assets", str(assets), env=env).stdout)["status"] == "UNCHANGED"
    with connect(url) as db:
        assert data_snapshot(db, before) == before
        with db.cursor() as cursor:
            cursor.execute("ALTER TABLE t_news MODIFY COLUMN handoffProbe VARCHAR(64) NULL")
        changed_structure = schema_snapshot(db)
    # Rewriting a published target snapshot must not legitimize manual drift.
    from web.migrations.baseline import sha256
    (assets / "schema-p2.json").write_text(json.dumps(changed_structure), encoding="utf-8")
    manifest = json.loads((assets / "manifest.json").read_text())
    for entry in manifest["files"]:
        if entry["asset"] == "schema-p2.json":
            entry["sha256"] = sha256((assets / "schema-p2.json").read_bytes())
    (assets / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    result = cli("inspect", "--assets", str(assets), env=env)
    assert result.returncode == 2 and "PYTHON_CHECKSUM" in result.stdout


def test_failed_nontransactional_ddl_is_not_replayed_or_marked_success(mysql_case, tmp_path):
    from web.migrations.runner import connect, query, tables

    url, env = mysql_case
    assert cli("upgrade", env=env).returncode == 0
    assets = increment_assets(tmp_path, "CREATE TABLE handoff_partial (id INT PRIMARY KEY); "
                              "ALTER TABLE handoff_missing ADD COLUMN x INT;",
                              json.loads((ASSETS / "schema-v22.json").read_text()))
    first = cli("upgrade", "--assets", str(assets), env=env)
    assert first.returncode == 2 and "UPGRADE_FAILED" in first.stdout
    with connect(url) as db:
        assert "handoff_partial" in tables(db)
        row = query(db, "SELECT state,lastStatement FROM t_python_schema_history WHERE version=2")[0]
        assert row == {"state": "FAILED", "lastStatement": 1}
    again = cli("upgrade", "--assets", str(assets), env=env)
    assert again.returncode == 2 and "INCOMPLETE_UPGRADE" in again.stdout
    with connect(url) as db:
        assert query(db, "SELECT state,lastStatement FROM t_python_schema_history WHERE version=2")[0] == row


def test_concurrent_upgrader_cannot_write(mysql_case):
    from web.migrations.runner import connect, migration_lock, tables

    url, env = mysql_case
    with connect(url) as db, migration_lock(db):
        result = cli("upgrade", env=env)
        assert result.returncode == 2
        assert json.loads(result.stdout)["status"] == "UPGRADE_BUSY"
        assert tables(db) == []
    assert cli("upgrade", env=env).returncode == 0


def test_empty_python_history_is_an_interrupted_registration(mysql_case):
    from web.migrations.runner import connect, HISTORY_DDL, query

    url, env = mysql_case
    with connect(url) as db:
        with db.cursor() as cursor:
            cursor.execute(HISTORY_DDL)
        db.commit()
    result = cli("upgrade", env=env)
    assert result.returncode == 2 and "EMPTY_PYTHON_HISTORY" in result.stdout
    with connect(url) as db:
        assert query(db, "SELECT version FROM t_python_schema_history") == []


def test_unknown_schema_objects_are_not_treated_as_an_empty_database(mysql_case):
    from web.migrations.runner import connect, tables

    url, env = mysql_case
    with connect(url) as db:
        with db.cursor() as cursor:
            cursor.execute("CREATE VIEW handoff_unknown_view AS SELECT 1 AS id")
        db.commit()
    result = cli("upgrade", env=env)
    assert result.returncode == 2 and "UNKNOWN_SCHEMA_OBJECT" in result.stdout
    with connect(url) as db:
        assert tables(db) == []


def test_applied_handoff_still_rejects_changed_original_history(mysql_case):
    from web.migrations.runner import connect
    from web.tests.handoff_fixtures import legacy_database

    url, env = mysql_case
    legacy_database(url, 22)
    assert cli("upgrade", env=env).returncode == 0
    with connect(url) as db:
        with db.cursor() as cursor:
            cursor.execute("UPDATE flyway_schema_history SET installed_by='changed-fixture' WHERE version='22'")
        db.commit()
    result = cli("upgrade", env=env)
    assert result.returncode == 2 and "LEGACY_HISTORY_CHANGED" in result.stdout


def test_interrupted_baseline_cannot_register_success_or_replay(mysql_case, tmp_path):
    import shutil
    import time
    from web.migrations.baseline import sha256
    from web.migrations.runner import connect, query

    url, env = mysql_case
    assets = tmp_path / "interrupted-assets"
    shutil.copytree(ASSETS, assets)
    # Independent fault fixture: delay before DDL, after durable registration.
    file = assets / "business-bootstrap.sql"
    file.write_bytes(b"SELECT SLEEP(6);\n" + file.read_bytes())
    manifest = json.loads((assets / "manifest.json").read_text())
    for entry in manifest["files"]:
        if entry["asset"] == file.name:
            entry["sha256"] = sha256(file.read_bytes())
    # Deliberate isolated test bundle, with a distinct baseline identity.
    from web.migrations.runner import digest
    manifest["baselineFiles"] = [e["asset"] for e in manifest["files"]]
    manifest["baselineChecksum"] = digest({"files": manifest["files"], "legacy": manifest["legacy"]})
    (assets / "manifest.json").write_text(json.dumps(manifest))
    child = subprocess.Popen([sys.executable, "-m", "web.migrations", "upgrade", "--assets", str(assets)],
                             cwd=ROOT / "algorithm", env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            with connect(url) as db:
                rows = query(db, "SELECT TABLE_NAME FROM information_schema.tables "
                             "WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='t_python_schema_history'")
                if rows and query(db, "SELECT state,lastStatement FROM t_python_schema_history") == [
                        {"state": "RUNNING", "lastStatement": 2}]:
                    break
            assert child.poll() is None
            time.sleep(0.1)
        else:
            pytest.fail("Upgrade never reached the durable baseline boundary")
    finally:
        # Only the subprocess created above is terminated; no port/process discovery.
        child.terminate()
        child.communicate(timeout=10)
    # A server-side statement can briefly outlive its disconnected client.
    deadline = time.monotonic() + 15
    while True:
        result = cli("upgrade", "--assets", str(assets), env=env)
        if "UPGRADE_BUSY" not in result.stdout:
            break
        assert time.monotonic() < deadline
        time.sleep(.1)
    assert result.returncode == 2 and "INCOMPLETE_UPGRADE" in result.stdout
    with connect(url) as db:
        assert query(db, "SELECT state FROM t_python_schema_history") == [{"state": "RUNNING"}]


@pytest.mark.parametrize("source", ["empty", 9, 22])
def test_stock_api_public_business_read_works_without_jvm(mysql_case, source):
    import socket
    import time
    import httpx
    from sqlalchemy.engine import make_url
    from web.migrations.runner import connect
    from web.tests.handoff_fixtures import legacy_database

    url, env = mysql_case
    if source != "empty":
        legacy_database(url, source)
    else:
        assert cli("upgrade", env=env).returncode == 0
    with connect(url) as db:
        with db.cursor() as cursor:
            cursor.execute("INSERT INTO t_user (id,userAccount,userPassword,userName) VALUES "
                           "(9007199254740993,'public-synthetic','opaque-test-secret','Synthetic')")
            cursor.execute("INSERT INTO t_news (id,title,userId,content,coverImg,status,publishTime) "
                           "VALUES (9007199254740995,'Synthetic news',9007199254740993,'Synthetic content',"
                           "'https://fixture.invalid/cover.png',1,'2026-03-04 05:06:07')")
        db.commit()
    if source != "empty":
        assert cli("upgrade", env=env).returncode == 0
    target = make_url(url)
    env.update(MYSQL_HOST=target.host, MYSQL_PORT=str(target.port), MYSQL_USER=target.username,
               MYSQL_PASSWORD=target.password, MYSQL_DATABASE=target.database)
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    child = subprocess.Popen([sys.executable, "-m", "uvicorn", "web.app:app", "--host", "127.0.0.1",
                              "--port", str(port), "--no-access-log"], cwd=ROOT / "algorithm", env=env,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        with httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=5, trust_env=False) as client:
            deadline = time.monotonic() + 20
            while True:
                assert child.poll() is None, "Stock API exited"
                try:
                    health = client.get("/health")
                    if health.status_code == 200 and health.json() == {"status": "up"}:
                        break
                except httpx.TransportError:
                    pass
                assert time.monotonic() < deadline
                time.sleep(.1)
            response = client.get("/api/news/get/9007199254740995")
            assert response.status_code == 200 and response.json()["code"] == 0, response.text
            assert response.json()["data"]["id"] == "9007199254740995"
            assert response.json()["data"]["title"] == "Synthetic news"
            assert "opaque-test-secret" not in response.text
            page = client.post("/api/news/list/page/vo", json={"current": 1, "pageSize": 10})
            assert page.status_code == 200 and page.json()["code"] == 0
            assert page.json()["data"]["total"] == "1"
            assert page.json()["data"]["records"][0]["id"] == "9007199254740995"
    finally:
        child.terminate()
        child.wait(timeout=10)
