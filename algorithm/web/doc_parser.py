"""Binary Word → DOCX in a private, bounded non-JVM child process."""

import io
import json
from contextlib import contextmanager
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import time
from typing import Iterator
import zipfile

from web.doc_tool import BUILD, DEFAULT_HOME, SHA256, VERSION, executable

MAX_INPUT_BYTES = 20 * 1024 * 1024
MAX_OUTPUT_BYTES = 64 * 1024 * 1024
# Windows initializes a private Writer profile and font cache on every call.
TIMEOUT_SECONDS = 120 if os.name == "nt" else 60


@contextmanager
def _private_workspace() -> Iterator[Path]:
    directory = tempfile.TemporaryDirectory(prefix="eye-doc-")
    try:
        yield Path(directory.name)
    finally:
        # Windows scanners can briefly retain a handle after Writer exits.
        for attempt in range(51):
            try:
                directory.cleanup()
                break
            except PermissionError:
                if attempt == 50:
                    raise
                time.sleep(.1)


def extract_doc(data: bytes) -> str:
    """Validate Word 97–2003, convert locally, reuse the DOCX story extractor."""
    import olefile  # type: ignore[import-untyped]

    from web.extract import extract_docx

    if len(data) > MAX_INPUT_BYTES:
        raise ValueError("旧版 Word 文档超过 20 MiB 限制")
    with olefile.OleFileIO(io.BytesIO(data)) as document:
        if not document.exists("WordDocument"):
            raise ValueError("不是旧版 Word 二进制文档")
        header = document.openstream("WordDocument").read(32)
        if len(header) != 32 or header[:2] != b"\xec\xa5":
            raise ValueError("Word 文档头损坏或不是受支持的 Word 97–2003 格式")
        flags = int.from_bytes(header[10:12], "little")
        if flags & 0x8100:
            raise ValueError("不支持加密的旧版 Word 文档")
        if not document.exists("1Table" if flags & 0x200 else "0Table"):
            raise ValueError("Word 文档表流损坏")
    home = Path(os.getenv("DOC_TOOL_HOME") or DEFAULT_HOME).resolve()
    program = executable(home)
    try:
        stamp = json.loads((home / "eye-doc-tool.json").read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise RuntimeError(f".doc 解析器未核验，请部署固定 LibreOffice {VERSION}") from exc
    platform = "windows" if os.name == "nt" else "linux"
    if (not isinstance(stamp, dict) or not program.is_file() or stamp.get("version") != BUILD or
            stamp.get("archiveSha256") != SHA256[platform] or stamp.get("platform") != platform):
        raise RuntimeError(f".doc 解析器未安装，请部署固定 LibreOffice {VERSION}")
    with _private_workspace() as work:
        profile = work / "profile"
        profile.mkdir()
        # Disable macros, external link updates and Java even on a host with a JRE.
        (profile / "user").mkdir()
        (work / "java-disabled.xml").write_text(
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<java xmlns="http://openoffice.org/2004/java/framework/1.0">'
            '<enabled>false</enabled></java>', encoding="utf-8")
        (profile / "user/registrymodifications.xcu").write_text(
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<oor:items xmlns:oor="http://openoffice.org/2001/registry">'
            '<item oor:path="/org.openoffice.Office.Common/Security/Scripting">'
            '<prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>'
            '<item oor:path="/org.openoffice.Office.Writer/Content/Update">'
            '<prop oor:name="Link" oor:op="fuse"><value>2</value></prop></item>'
            '</oor:items>', encoding="utf-8")
        (work / "input.doc").write_bytes(data)
        command = [str(program), f"-env:UserInstallation={profile.as_uri()}",
            f"-env:URE_OVERRIDE_JAVA_JFW_USER_DATA={(work / 'java-disabled.xml').as_uri()}",
            "--headless", "--nologo", "--nodefault", "--norestore",
            "--convert-to", "docx:Office Open XML Text", "--outdir", str(work), str(work / "input.doc")]
        env = os.environ.copy()
        env.pop("JAVA_HOME", None)
        env["JRE_HOME"] = str(work / "no-jre")
        if os.name != "nt":
            env["SAL_USE_VCLPLUGIN"] = "svp"
        try:
            process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL, cwd=work, env=env, start_new_session=os.name != "nt",
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        except OSError as exc:
            raise RuntimeError("无法启动本地 .doc 解析器") from exc
        try:
            process.wait(timeout=TIMEOUT_SECONDS)
        except subprocess.TimeoutExpired as exc:
            if os.name == "nt":
                subprocess.run(["taskkill.exe", "/PID", str(process.pid), "/T", "/F"],
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10,
                    creationflags=subprocess.CREATE_NO_WINDOW)
            else:
                os.killpg(process.pid, signal.SIGKILL)  # type: ignore[attr-defined]
            process.wait(timeout=10)
            raise RuntimeError(".doc 解析超时") from exc
        output = work / "input.docx"
        if process.returncode != 0 or not output.is_file():
            raise ValueError("旧版 Word 文档损坏或无法解析")
        if output.stat().st_size > MAX_OUTPUT_BYTES:
            raise ValueError("Word 转换输出超过限制")
        with zipfile.ZipFile(output) as archive:
            if sum(item.file_size for item in archive.infolist()) > MAX_OUTPUT_BYTES:
                raise ValueError("Word 解压内容超过限制")
        return extract_docx(output.read_bytes())


if __name__ == "__main__":
    from web.doc_tool import main

    main()
