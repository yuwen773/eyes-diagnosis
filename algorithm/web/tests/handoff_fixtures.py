"""Synthetic isolated legacy databases, built with MySQL's own script parser.

No Java or production database access. Schemas are retained for audit.
"""

from pathlib import Path
from uuid import uuid4

import pymysql
from pymysql.constants import CLIENT
from sqlalchemy.engine import make_url

from web.migrations.baseline import ASSETS, load_manifest


def isolated_database(admin_url: str, prefix="eye_pyhandoff_") -> tuple[str, str]:
    url = make_url(admin_url)
    if url.drivername != "mysql+pymysql" or url.host not in {"127.0.0.1", "localhost"}:
        raise ValueError("Use local MySQL for handoff acceptance")
    if prefix not in {"eye_pyhandoff_", "eye_human_wait_issue17_"}:
        raise ValueError("Unapproved acceptance schema prefix")
    name = prefix + uuid4().hex
    with pymysql.connect(host=url.host, port=url.port or 3306, user=url.username,
                         password=url.password or "", charset="utf8mb4", autocommit=True) as db:
        with db.cursor() as cursor:
            cursor.execute(f"CREATE DATABASE `{name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
    return url.set(database=name).render_as_string(hide_password=False), name


def legacy_database(url: str, version: int, assets: Path = ASSETS) -> None:
    if version not in {9, 22}:
        raise ValueError("Only independently frozen V9/V22 profiles are supported")
    target = make_url(url)
    if target.host not in {"127.0.0.1", "localhost"} or not (target.database or "").startswith(
            ("eye_pyhandoff_", "eye_human_wait_issue17_")):
        raise ValueError("Refusing non-acceptance database")
    manifest = load_manifest(assets)
    with pymysql.connect(host=target.host, port=target.port or 3306, user=target.username,
                         password=target.password or "", database=target.database,
                         charset="utf8mb4", autocommit=True, client_flag=CLIENT.MULTI_STATEMENTS) as db:
        with db.cursor() as cursor:
            cursor.execute("""CREATE TABLE flyway_schema_history (
                installed_rank INT NOT NULL PRIMARY KEY, version VARCHAR(50),
                description VARCHAR(200) NOT NULL, type VARCHAR(20) NOT NULL,
                script VARCHAR(1000) NOT NULL, checksum INT, installed_by VARCHAR(100) NOT NULL,
                installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                execution_time INT NOT NULL, success TINYINT(1) NOT NULL,
                KEY flyway_schema_history_s_idx (success)) ENGINE=InnoDB""")
            for name in ["legacy/beforeMigrate__bootstrap_legacy_flyway_schema.sql", "business-bootstrap.sql"]:
                cursor.execute((assets / name).read_text(encoding="utf-8-sig"))
                while cursor.nextset():
                    pass
            for entry in manifest["legacy"]:
                if entry["version"] > version:
                    continue
                cursor.execute((assets / entry["asset"]).read_text(encoding="utf-8-sig"))
                while cursor.nextset():
                    pass
                cursor.execute("INSERT INTO flyway_schema_history "
                               "(installed_rank,version,description,type,script,checksum,installed_by,execution_time,success) "
                               "VALUES (%s,%s,%s,'SQL',%s,%s,'synthetic-fixture',0,1)",
                               (entry["version"], str(entry["version"]), "synthetic legacy snapshot",
                                entry["script"], entry["checksum"]))
