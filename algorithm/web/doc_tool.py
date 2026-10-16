"""Offline deployment of the pinned LibreOffice binary Word converter."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile

VERSION = "26.2.6"
BUILD = "LibreOffice 26.2.6.3 8221e31b3ac356a1623c672912a3d2b492f7e3d1"
SHA256 = {
    "windows": "f9877032fd908beb9c0ddf06df4af5c2e85f419c42e14876c4cce5aae5fb2660",
    "linux": "fd0e8f8f2408dd2e5b90286e60f3f97cf566ba441cd48cfc5bcc68067303e0bc",
}
DEFAULT_HOME = Path(__file__).resolve().parents[1] / ".tools" / f"libreoffice-{VERSION}"


def executable(home: Path) -> Path:
    return home / ("program/soffice.com" if os.name == "nt" else "opt/libreoffice26.2/program/soffice")


def install(archive: Path, home: Path) -> None:
    """Extract a verified local package; no global installation and no downloads."""
    platform = "windows" if os.name == "nt" else "linux"
    with archive.open("rb") as source:
        digest = hashlib.file_digest(source, "sha256").hexdigest()
    if digest != SHA256[platform]:
        raise ValueError("LibreOffice SHA-256 mismatch; installation aborted")
    home = home.resolve()
    if home.exists():
        raise ValueError("Tool destination already exists; use a new empty destination")
    home.mkdir(parents=True)
    if os.name == "nt":
        subprocess.run(["msiexec.exe", "/a", str(archive.resolve()), "/qn", f"TARGETDIR={home}"],
            check=True, timeout=300, creationflags=subprocess.CREATE_NO_WINDOW)
    else:
        with tempfile.TemporaryDirectory(prefix="eye-doc-install-") as directory:
            with tarfile.open(archive) as package:
                package.extractall(directory, filter="data")
            for deb in sorted(Path(directory).glob("*/DEBS/*.deb")):
                subprocess.run(["dpkg-deb", "-x", str(deb), str(home)], check=True, timeout=60)
    program = executable(home)
    result = subprocess.run([str(program), "--version"], check=True, capture_output=True,
                            timeout=20, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    version = result.stdout.decode("utf-8").strip()
    if version != BUILD:
        raise ValueError("Unexpected LibreOffice version")
    (home / "eye-doc-tool.json").write_text(json.dumps({"version": version,
        "archiveSha256": digest, "platform": platform}, indent=2) + "\n", encoding="utf-8")
    print(version)


def main() -> None:
    parser = argparse.ArgumentParser(__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--home", type=Path, default=DEFAULT_HOME)
    args = parser.parse_args()
    install(args.archive, args.home)


if __name__ == "__main__":
    main()
