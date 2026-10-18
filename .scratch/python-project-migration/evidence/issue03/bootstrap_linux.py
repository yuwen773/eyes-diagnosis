import hashlib
from pathlib import Path
import subprocess
import tarfile

root = Path(__file__).resolve().parents[4]
archive = root / "algorithm/.tools/libreoffice-probe/linux-ustc.tar.gz"
assert hashlib.sha256(archive.read_bytes()).hexdigest() == "fd0e8f8f2408dd2e5b90286e60f3f97cf566ba441cd48cfc5bcc68067303e0bc"
work = Path.home() / ".cache/eye-doc-issue03"
source, tool = work / "packages", work / "libreoffice"
source.mkdir(parents=True, exist_ok=True)
tool.mkdir(parents=True, exist_ok=True)
with tarfile.open(archive) as package:
    package.extractall(source, filter="data")
for deb in sorted(source.glob("*/DEBS/*.deb")):
    subprocess.run(["dpkg-deb", "-x", str(deb), str(tool)], check=True, timeout=90)
print("Extracted", flush=True)
subprocess.run([str(tool / "opt/libreoffice26.2/program/soffice"), "--version"], timeout=20)
subprocess.run(["ldd", str(tool / "opt/libreoffice26.2/program/libmergedlo.so")], timeout=20)
