"""Ticket 03: binary Word extraction through a local, non-JVM tool boundary."""

from pathlib import Path
import io
import shutil
import subprocess
import sys
import tempfile

import pytest

from web.doc_parser import extract_doc

FIXTURES = Path(__file__).parent / "fixtures" / "documents"


def test_word97_body_is_extracted_without_java(monkeypatch):
    monkeypatch.delenv("JAVA_HOME", raising=False)
    assert "This is a simple file created with Word 97-SR2." in extract_doc(
        (FIXTURES / "simple.doc").read_bytes())


def test_chinese_body_table_and_header_footer_survive_binary_word():
    text = extract_doc((FIXTURES / "chinese-stories.doc").read_bytes())
    for marker in ("中文眼底检查正文", "合并单元格", "眼底随访", "嵌套复查", "文档页眉", "文档页脚"):
        assert marker in text, text
    assert "\ufffd" not in text


def test_empty_binary_word_has_no_effective_text():
    assert not extract_doc((FIXTURES / "empty.doc").read_bytes()).strip()


def test_upstream_word_header_and_footer_keep_unicode_encoding():
    # Expected strings come from Apache POI REL_5_4_1 TestHeaderStories.
    text = extract_doc((FIXTURES / "HeaderFooterUnicode.doc").read_bytes())
    assert "This is a simple header, with a € euro symbol in it." in text
    assert "The footer, with Molière, has Unicode in it." in text


def test_encrypted_binary_word_is_explicitly_rejected():
    with pytest.raises(ValueError, match="加密"):
        extract_doc((FIXTURES / "PasswordProtected.doc").read_bytes())


def test_install_rejects_unverified_package_before_writing_tool(tmp_path):
    from web.doc_tool import install

    package, destination = tmp_path / "bad-package", tmp_path / "tool"
    package.write_bytes(b"unverified archive")
    with pytest.raises(ValueError, match="SHA-256 mismatch"):
        install(package, destination)
    assert not destination.exists()


def test_transient_filesystem_lock_does_not_turn_extracted_text_into_failure(monkeypatch, tmp_path):
    from docx import Document

    document = Document()
    document.add_paragraph("Known conversion output after a transient filesystem lock.")
    output = io.BytesIO()
    document.save(output)
    launch, remove = subprocess.Popen, shutil.rmtree
    locked = []

    def converter(command, **kwargs):
        Path(command[-1]).with_suffix(".docx").write_bytes(output.getvalue())
        return launch([sys.executable, "-c", "pass"], **kwargs)

    def temporarily_locked(path, *args, **kwargs):
        if not locked:
            locked.append(path)
            raise PermissionError("temporary filesystem handle")
        return remove(path, *args, **kwargs)

    monkeypatch.setattr(subprocess, "Popen", converter)
    monkeypatch.setattr(shutil, "rmtree", temporarily_locked)
    monkeypatch.setattr(tempfile, "tempdir", str(tmp_path))
    assert "Known conversion output" in extract_doc((FIXTURES / "simple.doc").read_bytes())
    assert list(tmp_path.iterdir()) == []


def test_converter_timeout_reaps_process_and_cleans_private_files(monkeypatch, tmp_path):
    # Substitute the external converter at the OS boundary with a real sleeper.
    # The application still owns process termination and temporary files.
    import web.doc_parser as converter

    launch = subprocess.Popen
    children = []

    def sleeping_converter(command, **kwargs):
        if Path(command[0]).name not in {"soffice.com", "soffice"}:
            return launch(command, **kwargs)
        child = launch([sys.executable, "-c", "import time; time.sleep(60)"], **kwargs)
        children.append(child)
        return child

    monkeypatch.setattr(subprocess, "Popen", sleeping_converter)
    monkeypatch.setattr(converter, "TIMEOUT_SECONDS", .2)
    monkeypatch.setattr(tempfile, "tempdir", str(tmp_path))
    with pytest.raises(RuntimeError, match="超时"):
        extract_doc((FIXTURES / "simple.doc").read_bytes())
    assert children[0].poll() is not None
    assert list(tmp_path.iterdir()) == []
