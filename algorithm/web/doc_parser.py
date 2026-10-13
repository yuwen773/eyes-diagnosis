"""Pinned, local Apache Tika CLI for binary Word; never downloads at request time."""

import hashlib
import io
import os
from pathlib import Path
import subprocess

TIKA_VERSION = "3.3.2"
TIKA_SHA512 = (
    "88c2032cba0d45feea361e6eebd2918bd04707614cdda5d89a1b167da5503c98e"
    "7b4cd368336f0402d559abcaf5006fcc7c825c32c749ae0417ea2f3b8423aba"
)
DEFAULT_JAR = Path(__file__).resolve().parents[1] / ".tools" / f"tika-app-{TIKA_VERSION}.jar"


def extract_doc(data: bytes) -> str:
    """Accept OLE Word only, then parse in a bounded child process over stdin."""
    import olefile

    with olefile.OleFileIO(io.BytesIO(data)) as document:
        if not document.exists("WordDocument"):
            raise ValueError("不是旧版 Word 二进制文档")
        with document.openstream("WordDocument") as word:
            if word.read(2) != b"\xec\xa5":
                raise ValueError("Word 文档头损坏或不是受支持的 Word 97–2003 格式")
    jar = Path(os.getenv("TIKA_APP_JAR") or DEFAULT_JAR)
    if not jar.is_file():
        raise RuntimeError(".doc 解析器未安装，请运行 python -m web.doc_parser")
    java_home = os.getenv("JAVA_HOME")
    java = str(Path(java_home) / "bin" / ("java.exe" if os.name == "nt" else "java")) if java_home else "java"
    try:
        result = subprocess.run(
            [java, "-Xmx512m", "-jar", str(jar), "--text", "--encoding=UTF-8"],
            input=data, capture_output=True, timeout=60, check=True,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(".doc 解析超时") from exc
    except subprocess.CalledProcessError as exc:
        raise ValueError("旧版 Word 文档损坏、加密或无法解析") from exc
    except OSError as exc:
        raise RuntimeError("无法启动 .doc 解析器，请检查 JAVA_HOME 与 Java 21 安装") from exc
    return result.stdout.decode("utf-8")


def install() -> None:
    """Explicit deployment step; verify the pinned official digest before replace."""
    from urllib.request import urlopen

    url = (f"https://repo.maven.apache.org/maven2/org/apache/tika/tika-app/{TIKA_VERSION}/"
           f"tika-app-{TIKA_VERSION}.jar")
    with urlopen(url, timeout=60) as response:
        data = response.read()
    if hashlib.sha512(data).hexdigest() != TIKA_SHA512:
        raise RuntimeError("Tika SHA-512 mismatch; installation aborted")
    DEFAULT_JAR.parent.mkdir(parents=True, exist_ok=True)
    DEFAULT_JAR.write_bytes(data)
    print(f"Installed verified Apache Tika {TIKA_VERSION}: {DEFAULT_JAR}")


if __name__ == "__main__":
    install()
