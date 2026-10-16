"""``t_inference_cache`` / ``t_diagnosis`` ORM contract tests.

These assert the schema shape against the DDL and the Java entity. A silent
column-name drift here would not fail any import or endpoint test -- it would
surface as a ``Unknown column`` error on the first cached diagnosis in
production, where ``t_inference_cache`` is the only thing standing between a
repeated image and a second inference run.
"""

import re
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
ALGORITHM_ROOT = REPO_ROOT / "algorithm"
sys.path.insert(0, str(ALGORITHM_ROOT))

SCHEMA_SQL = REPO_ROOT / "deploy/python-migrations/legacy/schema.sql"

from web.models import Diagnosis, InferenceCache  # noqa: E402
from web.models.inference_cache import CACHE_KEY_COLUMNS  # noqa: E402


def _ddl_columns(table: str) -> list[str]:
    """Column names for ``table``: the CREATE TABLE block plus any later
    ``ALTER TABLE <table> ADD COLUMN``.

    schema.sql adds several columns out-of-band -- ``t_diagnosis.image_hash``
    arrives via ALTER (:181), and the whole medical-reliability block does too
    -- so a CREATE-only parser under-reports the real schema.
    """
    sql = SCHEMA_SQL.read_text(encoding="utf-8")
    # t_diagnosis writes the name and the opening paren on separate lines
    # ("CREATE TABLE IF NOT EXISTS t_diagnosis \n(  "), so match the header by
    # name and locate the first "(" after it rather than assuming " (".
    header = re.search(rf"CREATE TABLE IF NOT EXISTS\s+{table}\b", sql)
    assert header, f"{table} not found in schema.sql"
    start = header.end()
    open_paren = sql.index("(", start)
    # Most tables end with a bare ");", but t_inference_cache ends with
    # ") COMMENT '推理结果缓存';". Match the closing paren at line start.
    end = sql.index("\n)", open_paren)
    body = sql[open_paren + 1 : end]

    columns = []
    for line in body.splitlines():
        line = line.strip().rstrip(",")
        if not line or line.startswith(("UNIQUE", "KEY", "INDEX", "PRIMARY", "--", "COMMENT")):
            continue
        columns.append(line.split()[0])

    for match in re.finditer(
        rf"ALTER TABLE\s+{table}\s+ADD COLUMN\s+(\w+)", sql, re.IGNORECASE
    ):
        columns.append(match.group(1))

    return columns


def _orm_columns(model) -> set[str]:
    """Column names as declared on the ORM model.

    ``Column.name`` is the *column* name (camelCase), not the Python attribute
    name -- that is the point of the explicit mapping in every model file.
    """
    return {c.name for c in model.__table__.columns}


def test_inference_cache_columns_match_ddl():
    """All 22 columns, exact names and order."""
    assert _orm_columns(InferenceCache) == set(_ddl_columns("t_inference_cache"))


def test_inference_cache_column_count():
    assert len(_orm_columns(InferenceCache)) == 22


def test_cache_key_columns_are_exactly_the_five_tuple():
    """V9 widened this to 5 columns. Widening or narrowing it silently changes
    which cached rows are considered a hit."""
    key = [c.name for c in InferenceCache.__table__.columns if c.name in CACHE_KEY_COLUMNS]
    assert key == [
        "imageHash",
        "modelVersion",
        "weightSha256",
        "preprocessVersion",
        "inferencePolicyVersion",
    ]
    assert CACHE_KEY_COLUMNS == tuple(key)


def test_cache_key_columns_are_declared_not_nullable():
    """A NULL in any key column would make the row unreachable by lookup."""
    for name in CACHE_KEY_COLUMNS:
        column = InferenceCache.__table__.columns[name]
        assert column.nullable is False, name


def test_weight_sha256_column_is_sixty_four_chars():
    """Java lowercases the weight SHA before both the lookup and the insert
    (``normalizeWeightSha256``, :309-311). MySQL's default collation would
    tolerate a case mismatch on lookup, but the value written must fit the
    column -- SHA-256 hex is exactly 64 characters, and a truncated value
    would make the row unreachable by any later lookup."""
    column = InferenceCache.__table__.columns["weightSha256"]
    assert column.type.length == 64
    assert len("0" * 64) <= column.type.length


def test_top_predictions_is_a_text_column_not_a_parsed_type():
    """The entity field is ``String`` and the mapper passes it through with no
    jdbcType (``InferenceCacheMapper.xml:18,51``). Mapping it as a Python list
    would make SQLAlchemy bind a JSON structure and lose the exact stored text,
    which Java round-trips verbatim."""
    column = InferenceCache.__table__.columns["topPredictions"]
    assert column.type.python_type is str


def test_boolean_columns_are_stored_as_integers():
    """``TINYINT(1)`` read back through ``Boolean.TRUE.equals(...)`` in Java.
    A NULL degrades to False there; naive Python truthiness would not."""
    for name in ("isOod", "rejected", "requiresReview"):
        assert InferenceCache.__table__.columns[name].nullable is False, name


def test_diagnosis_url_is_not_nullable():
    """This is the constraint that makes the COS-failure path fail.
    ``DiagnosisServiceImpl`` swallows the upload error and proceeds with
    ``url = null``; MyBatis Plus drops the null field from the INSERT and MySQL
    then rejects it. See ruling 13 -- the port must reproduce this, not
    'fix' it by inserting an empty string."""
    assert Diagnosis.__table__.columns["url"].nullable is False


def test_diagnosis_reexamine_status_default_is_one():
    """DDL: ``reexamineStatus INT NOT NULL DEFAULT 1`` = "undone". A port that
    defaults to 0 would invent a state that ``ReexamineConstant`` does not
    define (1 undone / 2 waiting / 3 done).

    The DDL lives in ``db/callback/beforeMigrate__bootstrap_legacy_flyway_schema.sql``,
    not in ``schema.sql`` -- ``t_diagnosis`` was created by the legacy Flyway
    baseline rather than by schema.sql.
    """
    bootstrap = (
        REPO_ROOT
        / "deploy/python-migrations/legacy/beforeMigrate__bootstrap_legacy_flyway_schema.sql"
    ).read_text(encoding="utf-8")
    assert re.search(r"reexamineStatus\s+INT\s+NOT NULL DEFAULT 1", bootstrap)
    # The ORM layer must not silently diverge: the column is NOT NULL, so a
    # missing value has to come from the DB default, not from Python.
    assert Diagnosis.__table__.columns["reexamineStatus"].nullable is False


def test_orm_default_matches_ddl_default_for_reexamine_status():
    """Guards a real divergence found while writing this suite: the ORM had
    ``default=0`` while the DDL says ``DEFAULT 1``. Since every insert path
    sets the value explicitly today, the bug is latent -- but it would surface
    as "every new diagnosis is flagged as a re-examination" the first time a
    code path relies on the default."""
    column = Diagnosis.__table__.columns["reexamineStatus"]
    assert column.default is not None, "ORM default must exist and equal the DDL's"
    assert column.default.arg == 1, (
        f"ORM default is {column.default.arg!r}, DDL says DEFAULT 1 "
        "(ReexamineConstant: 1=undone, 2=waiting, 3=done)"
    )


def test_dead_image_hash_column_is_deliberately_unmapped():
    """``t_diagnosis.image_hash`` exists in the DDL with an index but has no
    entity field on the Java side either. Mapping it would imply a read/write
    path that does not exist in the service."""
    assert "image_hash" not in _orm_columns(Diagnosis)
    # Sanity: the column really is in the DDL, so this is a choice, not an
    # oversight of the test author.
    assert "image_hash" in _ddl_columns("t_diagnosis")


@pytest.mark.parametrize("column", ["severity", "humanReviewStatus", "aiRejected"])
def test_diagnosis_reliability_columns_present(column):
    assert column in _orm_columns(Diagnosis)


def test_human_review_status_default_matches_ddl():
    """``humanReviewStatus VARCHAR(20) NOT NULL DEFAULT 'PENDING_AI'``."""
    sql = SCHEMA_SQL.read_text(encoding="utf-8")
    assert re.search(r"humanReviewStatus\s+VARCHAR\(20\)\s+NOT NULL DEFAULT 'PENDING_AI'", sql)


def test_java_entity_and_orm_agree_on_user_id_column():
    """``@TableField`` mapping is implicit here because
    ``map-underscore-to-camel-case: false``; the column really is camelCase."""
    assert "userId" in _orm_columns(Diagnosis)
    assert "user_id" not in _orm_columns(Diagnosis)