"""User-authorized temporary service stop, with restoration on every exit."""
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import sys

OUT = Path(__file__).resolve().parent
ACCEPTED = OUT / "after-timesync-stop"
ACCEPTED.mkdir(exist_ok=True)
assert not (ACCEPTED / "run.json").exists(), "Preserve prior attempts; use a fresh output directory"


def service(*args):
    return subprocess.run(["wsl.exe", "-d", "Ubuntu-22.04", "-u", "root", "--exec", "systemctl", *args,
                           "systemd-timesyncd"], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30)


report = {"atUtc": datetime.now(timezone.utc).isoformat(),
          "authorization": "User explicitly allowed temporary stop and restoration",
          "initialActive": service("is-active").stdout.strip(),
          "initialEnabled": service("is-enabled").stdout.strip(),
          "configurationChanged": False, "databaseRestarted": False}
assert report["initialActive"] == "active"
try:
    stopped = service("stop")
    assert stopped.returncode == 0, "Temporary stop failed"
    report["duringActive"] = service("is-active").stdout.strip()
    assert report["duringActive"] == "inactive"
    print("Time sync temporarily stopped; running identical Linux gates", flush=True)
    result = subprocess.run([sys.executable, str(OUT / "run_linux.py"), "--output-dir", str(ACCEPTED)])
    report["verificationExitCode"] = result.returncode
finally:
    restored = service("start")
    report["restoreExitCode"] = restored.returncode
    report["finalActive"] = service("is-active").stdout.strip()
    report["finalEnabled"] = service("is-enabled").stdout.strip()
    report["restored"] = (restored.returncode == 0 and report["finalActive"] == report["initialActive"]
                          and report["finalEnabled"] == report["initialEnabled"])
    report["finishedAtUtc"] = datetime.now(timezone.utc).isoformat()
    (OUT / "service-restoration.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print("Time sync restored: " + str(report["restored"]), flush=True)
    assert report["restored"], "Original time sync service state was not restored"
raise SystemExit(report["verificationExitCode"])
