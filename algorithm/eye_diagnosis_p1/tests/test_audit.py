"""Tests for p1.audit.read_source_manifest (seam 1 of P1 baseline).

The audit reads ``Traning_Dataset.xlsx`` and ``Training_Dataset/`` and
returns a fail-closed :class:`SourceManifest`. Tests cover:

- Synthetic fixtures (workbooks we author) using the real schema.
- AppleDouble ``._*`` filename rejection with a named error.
- Opt-in integration test against the real source dataset, gated behind
  ``--eye-data-root=PATH`` or ``EYE_DATA_ROOT``.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

import pandas as pd
import pytest


EXPECTED_CLASS_ORDER = ("N", "D", "G", "C", "A", "H", "M", "O")


def _write_minimal_jpeg(path: Path) -> None:
    """Create an empty placeholder file. Audit only checks existence."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"\x00\x00")


def _build_fixture(
    root: Path,
    *,
    missing: tuple[tuple[str, str], ...] = (),
    extra_files: tuple[str, ...] = (),
) -> dict:
    """Build a minimal source-dataset fixture using the REAL workbook schema.

    Columns: ID, Patient Age, Patient Sex, Left-Fundus, Right-Fundus,
    Left-Diagnostic Keywords, Right-Diagnostic Keywords, N, D, G, C, A, H, M, O.
    """
    images_dir = root / "Training_Dataset"
    workbook_path = root / "Traning_Dataset.xlsx"

    rows = [
        # ID, Age, Sex, Left-Fundus, Right-Fundus, Left-KW, Right-KW, N, D, G, C, A, H, M, O
        (1, 60, "Male", "1_left.jpg", "1_right.jpg", "normal", "normal", 1, 0, 0, 0, 0, 0, 0, 0),
        (2, 45, "Female", "2_left.jpg", "2_right.jpg", "diabetes", "diabetes", 0, 1, 0, 0, 0, 0, 0, 0),
        (3, 70, "Male", "3_left.jpg", "3_right.jpg", "cataract amd", "cataract amd", 0, 0, 0, 1, 1, 0, 0, 0),
        # Multilabel case: diabetes + hypertension
        (4, 55, "Female", "4_left.jpg", "4_right.jpg", "diabetes hypertension", "diabetes hypertension", 0, 1, 0, 0, 0, 1, 0, 0),
    ]
    df = pd.DataFrame(rows, columns=[
        "ID", "Patient Age", "Patient Sex",
        "Left-Fundus", "Right-Fundus",
        "Left-Diagnostic Keywords", "Right-Diagnostic Keywords",
        *EXPECTED_CLASS_ORDER,
    ])
    df.to_excel(workbook_path, index=False)

    file_map: dict[tuple[int, str], Path] = {}
    for pid, _age, _sex, lf, rf, *_ in rows:
        for lat, fname in (("OS", lf), ("OD", rf)):
            if (pid, lat) in missing:
                continue
            f = images_dir / fname
            _write_minimal_jpeg(f)
            file_map[(pid, lat)] = f

    for fname in extra_files:
        (images_dir / fname).write_bytes(b"\x00\x00")

    return {
        "workbook": workbook_path,
        "file_map": file_map,
        "rows": rows,
    }


# ---- Public-contract invariants --------------------------------------------


def test_class_order_is_pinned() -> None:
    from p1.audit import CLASS_ORDER
    assert CLASS_ORDER == EXPECTED_CLASS_ORDER


# ---- Row layout -------------------------------------------------------------


def test_audit_returns_one_row_per_eye(tmp_path: Path) -> None:
    from p1.audit import read_source_manifest

    _build_fixture(tmp_path)
    manifest = read_source_manifest(tmp_path)
    assert len(manifest.eye_rows) == 8  # 4 patients × 2 eyes


def test_audit_patient_ids_match_workbook_order(tmp_path: Path) -> None:
    from p1.audit import read_source_manifest

    _build_fixture(tmp_path)
    manifest = read_source_manifest(tmp_path)
    assert manifest.patient_ids == ("1", "2", "3", "4")


def test_audit_relative_paths_use_workbook_filenames(tmp_path: Path) -> None:
    """Filenames come from the workbook's Left-Fundus/Right-Fundus columns, not assumed."""
    from p1.audit import read_source_manifest

    _build_fixture(tmp_path)
    manifest = read_source_manifest(tmp_path)

    paths = {row.relative_path for row in manifest.eye_rows}
    assert "Training_Dataset/1_left.jpg" in paths
    assert "Training_Dataset/1_right.jpg" in paths
    assert "Training_Dataset/4_left.jpg" in paths


def test_audit_relative_paths_are_posix(tmp_path: Path) -> None:
    from p1.audit import read_source_manifest

    _build_fixture(tmp_path)
    manifest = read_source_manifest(tmp_path)
    for row in manifest.eye_rows:
        assert "\\" not in row.relative_path
        assert not Path(row.relative_path).is_absolute()


# ---- Label vectors ----------------------------------------------------------


def test_audit_labels_from_workbook_binary_columns(tmp_path: Path) -> None:
    """Labels come from the workbook's 8 binary columns, not parsed from keywords."""
    from p1.audit import read_source_manifest

    _build_fixture(tmp_path)
    manifest = read_source_manifest(tmp_path)

    # Patient 2 is diabetes-only per fixture
    labels = manifest.labels_for("2")
    expected = (0, 1, 0, 0, 0, 0, 0, 0)
    assert labels == expected


def test_audit_multilabel_patient_has_correct_vector(tmp_path: Path) -> None:
    from p1.audit import read_source_manifest

    _build_fixture(tmp_path)
    manifest = read_source_manifest(tmp_path)
    label_dict = dict(zip(EXPECTED_CLASS_ORDER, manifest.labels_for("4")))
    assert label_dict["D"] == 1
    assert label_dict["H"] == 1
    for cls in EXPECTED_CLASS_ORDER:
        if cls in ("D", "H"):
            continue
        assert label_dict[cls] == 0, f"{cls} should be 0 for patient 4"


def test_audit_records_diagnostic_keywords(tmp_path: Path) -> None:
    from p1.audit import read_source_manifest

    _build_fixture(tmp_path)
    manifest = read_source_manifest(tmp_path)
    p3_rows = [r for r in manifest.eye_rows if r.patient_id == "3"]
    assert any("cataract" in r.diagnostic_keywords for r in p3_rows)


# ---- Failure modes ----------------------------------------------------------


def test_audit_fails_closed_when_a_jpeg_is_missing(tmp_path: Path) -> None:
    from p1.audit import read_source_manifest

    _build_fixture(tmp_path, missing=((3, "OD"),))
    with pytest.raises(FileNotFoundError):
        read_source_manifest(tmp_path)


def test_audit_fails_closed_when_workbook_is_missing(tmp_path: Path) -> None:
    from p1.audit import read_source_manifest

    (tmp_path / "Training_Dataset").mkdir()
    with pytest.raises(FileNotFoundError):
        read_source_manifest(tmp_path)


def test_audit_rejects_apple_double_file_with_named_error(tmp_path: Path) -> None:
    """AppleDouble files start with `._`. They must be rejected with a NAMED error.

    Pillow decode-failure is not enough — the message must explicitly call
    out Mac OS AppleDouble metadata so the cause is unambiguous.
    """
    from p1.audit import read_source_manifest

    _build_fixture(tmp_path)
    # Drop a `._` file where the audit looks for a real image.
    (tmp_path / "Training_Dataset" / "._1_left.jpg").write_bytes(b"\x00\x00")

    with pytest.raises(Exception) as exc:
        read_source_manifest(tmp_path)
    msg = str(exc.value).lower()
    assert "appledouble" in msg or "mac os" in msg, (
        f"AppleDouble rejection must name the cause; got: {exc.value!r}"
    )


def test_audit_rejects_extra_unreferenced_real_jpegs(tmp_path: Path) -> None:
    """If a real JPEG exists in Training_Dataset/ that no workbook row references,
    the audit must reject it. Otherwise the eye_index will be wrong."""
    from p1.audit import read_source_manifest

    _build_fixture(tmp_path, extra_files=("999_left.jpg",))
    with pytest.raises(Exception):
        read_source_manifest(tmp_path)


def test_audit_is_read_only(tmp_path: Path) -> None:
    from p1.audit import read_source_manifest

    _build_fixture(tmp_path)
    before = {p: p.read_bytes() for p in tmp_path.rglob("*") if p.is_file()}
    read_source_manifest(tmp_path)
    after = {p: p.read_bytes() for p in tmp_path.rglob("*") if p.is_file()}
    assert before == after


def test_audit_reports_workbook_sha256(tmp_path: Path) -> None:
    from p1.audit import read_source_manifest

    _build_fixture(tmp_path)
    manifest = read_source_manifest(tmp_path)
    expected_sha = hashlib.sha256((tmp_path / "Traning_Dataset.xlsx").read_bytes()).hexdigest()
    assert manifest.workbook_sha256 == expected_sha


def test_audit_records_image_dir_sha256(tmp_path: Path) -> None:
    """Capturing the images-dir hash gives us an audit anchor for reproducibility."""
    from p1.audit import read_source_manifest

    _build_fixture(tmp_path)
    manifest = read_source_manifest(tmp_path)
    assert manifest.images_dir_sha256
    assert len(manifest.images_dir_sha256) == 64  # sha256 hex


# ---- Real-dataset integration test -----------------------------------------


@pytest.mark.skipif(
    "not config.getoption('--eye-data-root')",
    reason="set --eye-data-root=PATH (or EYE_DATA_ROOT env) to run integration test",
)
def test_audit_against_eye_data_root(pytestconfig) -> None:
    """Run against the real source dataset. Asserts the audited invariants:

    - 2,885 patients
    - 5,770 real JPEGs (no AppleDouble metadata files)
    - 2,885 complete left/right pairs
    - 550 multilabel patients (19.06%)
    - Label totals match: N=1136 D=525 G=215 C=211 A=161 H=77 M=174 O=964
    - No zero-label patients
    - No Normal/disease conflicts (a patient with N=1 must have all diseases=0)
    - No missing age/sex
    """
    from p1.audit import read_source_manifest

    root = Path(pytestconfig.getoption("--eye-data-root"))
    manifest = read_source_manifest(root)

    # Patient and image counts
    assert len(manifest.patient_ids) == 2885
    assert len(manifest.eye_rows) == 5770

    # Each patient has both eyes
    for pid in manifest.patient_ids:
        lats = {r.laterality for r in manifest.eye_rows if r.patient_id == pid}
        assert lats == {"OD", "OS"}, f"patient {pid} missing an eye: {lats}"

    # No zero-label patients
    for pid in manifest.patient_ids:
        if sum(manifest.labels_for(pid)) == 0:
            pytest.fail(f"zero-label patient: {pid}")

    # No Normal/disease conflict
    for pid in manifest.patient_ids:
        bits = dict(zip(EXPECTED_CLASS_ORDER, manifest.labels_for(pid)))
        if bits["N"] == 1:
            disease_sum = sum(bits[c] for c in EXPECTED_CLASS_ORDER if c != "N")
            assert disease_sum == 0, (
                f"patient {pid} has N=1 but also diseases: "
                + ",".join(c for c in EXPECTED_CLASS_ORDER if c != "N" and bits[c] == 1)
            )

    # Multilabel patient count
    multilabel_count = sum(
        1 for pid in manifest.patient_ids if sum(manifest.labels_for(pid)) >= 2
    )
    assert multilabel_count == 550

    # Label totals
    label_totals = {cls: 0 for cls in EXPECTED_CLASS_ORDER}
    for pid in manifest.patient_ids:
        for cls, bit in zip(EXPECTED_CLASS_ORDER, manifest.labels_for(pid)):
            label_totals[cls] += bit
    assert label_totals == {
        "N": 1136, "D": 525, "G": 215, "C": 211,
        "A": 161, "H": 77, "M": 174, "O": 964,
    }

    # No missing age or sex
    for row in manifest.eye_rows:
        assert row.age is not None
        assert row.sex not in ("", None)

    # Audit observation: report age distribution rather than silently filtering.
    ages = sorted({row.age for row in manifest.eye_rows})
    age_min = min(ages)
    age_max = max(ages)
    # Sanity: ages must be in a biologically plausible range. The real source
    # dataset contains 16 patients with age=1 — likely a source-data entry
    # artefact. We surface it via a soft check; do not silently drop rows.
    assert 0 < age_min <= 120, f"implausible age_min={age_min}"
    assert 0 < age_max <= 120, f"implausible age_max={age_max}"