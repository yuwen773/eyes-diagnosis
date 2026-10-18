"""Serial ticket-08 gates; own random containers/volumes, retain all evidence."""
from datetime import datetime, timezone
import argparse
import json
from pathlib import Path
import secrets
import subprocess
import time
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[5]
parser = argparse.ArgumentParser(__doc__)
parser.add_argument("--suite", choices=["all", "infrastructure"], default="all")
parser.add_argument("--output-dir", type=Path, default=Path(__file__).resolve().parent)
args = parser.parse_args()
OUT = args.output_dir.resolve()
OUT.mkdir(parents=True, exist_ok=True)
if (OUT / "run.json").exists():
    raise SystemExit("Existing run evidence; choose a fresh --output-dir")
IMAGE = "eye-verify:closeout08"
PREFIX = "eye-closeout08-" + uuid4().hex[:10]
META = {"atUtc": datetime.now(timezone.utc).isoformat(), "prefix": PREFIX,
        "head": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
        "status": "RUNNING", "phases": {}, "productionOrPush": False}


def save():
    (OUT / "run.json").write_text(json.dumps(META, indent=2) + "\n", encoding="utf-8")


def run(name, args, timeout=3600):
    print("START " + name, flush=True)
    started = time.monotonic()
    with (OUT / (name + ".log")).open("wb") as log:
        try:
            result = subprocess.run(["docker", *args], cwd=ROOT, stdout=log, stderr=log, timeout=timeout)
        except subprocess.TimeoutExpired:
            META["phases"][name] = {"status": "TIMEOUT", "seconds": round(time.monotonic() - started, 3)}
            save()
            raise
    META["phases"][name] = {"exitCode": result.returncode, "seconds": round(time.monotonic() - started, 3)}
    save()
    print(f"END {name}: {result.returncode}", flush=True)
    if result.returncode:
        raise RuntimeError(name + " failed; see phase log")


mysql = PREFIX + "-mysql"
owned_containers = []
save()
try:
    if args.suite == "all":
        run("build", ["build", "-f", "deploy/python/Verify.Dockerfile", "-t", IMAGE, "."])
    run("image", ["image", "inspect", IMAGE, "--format", "{{json .}}"], 30)
    run("clock", ["run", "--rm", "--init", IMAGE, "python", "-c",
        "import json,shutil,time; from pathlib import Path; "
        "assert not shutil.which('java') and not shutil.which('mvn') and not Path('/usr/lib/jvm').exists(); "
        "samples=[]; end=time.monotonic()+30; w=time.time_ns(); m=time.monotonic_ns(); "
        "exec('while time.monotonic()<end:\\n time.sleep(.05)\\n nw=time.time_ns(); nm=time.monotonic_ns()\\n samples.append((nw-w,nm-m)); w,m=nw,nm'); "
        "print(json.dumps({'samples':len(samples),'minimumWallStepNs':min(a for a,b in samples),"
        "'maximumWallMonotonicDifferenceNs':max(abs(a-b) for a,b in samples),'clockModified':False,'noJVM':True}))"], 90)
    mount = ["--mount", "type=bind,source=" + OUT.as_posix() + ",target=/evidence"]
    if args.suite == "all":
        owned_containers.append((PREFIX + "-web", "web-stop"))
        run("linux-full", ["run", "--name", PREFIX + "-web", "--init", *mount, IMAGE,
            "python", "scripts/verify.py", "web", "--output-dir", "/evidence/linux-full"])
    password = secrets.token_urlsafe(24)
    META["mysqlContainer"] = mysql
    META["mysqlVolume"] = PREFIX + "-mysql-data"
    META["runtimeVolume"] = PREFIX + "-runtime"
    save()
    owned_containers.append((mysql, "mysql-stop"))
    run("mysql-start", ["run", "-d", "--name", mysql, "--label", "eye.ticket=08-closeout",
        "--mount", "type=volume,source=" + META["mysqlVolume"] + ",target=/var/lib/mysql",
        "-e", "MYSQL_ROOT_PASSWORD=" + password, "mysql:8.0.26"], 180)
    deadline = time.monotonic() + 120
    while True:
        probe = subprocess.run(["docker", "exec", mysql, "mysql", "-uroot", "-p" + password,
                                "-Nse", "SELECT 1"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
        if probe.returncode == 0:
            break
        if time.monotonic() > deadline:
            raise RuntimeError("Isolated MySQL readiness timed out")
        time.sleep(1)
    owned_containers.append((PREFIX + "-infra", "infrastructure-stop"))
    run("linux-infrastructure", ["run", "--name", PREFIX + "-infra", "--init", "--network", "container:" + mysql,
        *mount, "--mount", "type=volume,source=" + META["runtimeVolume"] + ",target=/workspace/.scratch/baseline-runtime",
        "-e", "REAL_SERVICES_MYSQL_ADMIN_URL=mysql+pymysql://root:" + password + "@127.0.0.1:3306",
        IMAGE, "python", "scripts/verify.py", "infrastructure", "--output-dir", "/evidence/linux-infrastructure"])
    META["status"] = "PASS_WITH_LIMITATIONS"
except Exception as exc:
    META.update(status="FAIL", error=type(exc).__name__ + ": " + str(exc))
    raise
finally:
    cleanup_errors = []
    META["containerCleanup"] = {}
    for container, phase in reversed(owned_containers):
        try:
            state = subprocess.run(["docker", "inspect", container, "--format", "{{.State.Running}}"],
                                   capture_output=True, text=True, timeout=30)
            if state.returncode == 0:
                if state.stdout.strip() == "true":
                    run(phase, ["stop", "--time", "15", container], 45)
                META["containerCleanup"][container] = "STOPPED"
            elif "No such object" in state.stderr:
                META["containerCleanup"][container] = "NOT_CREATED"
            else:
                raise RuntimeError("Cannot inspect owned container")
        except Exception as exc:
            cleanup_errors.append(container + ": " + type(exc).__name__)
    if cleanup_errors:
        META.update(status="FAIL", cleanupErrors=cleanup_errors)
    save()
    if cleanup_errors:
        raise RuntimeError("Owned container cleanup failed; see run.json")
