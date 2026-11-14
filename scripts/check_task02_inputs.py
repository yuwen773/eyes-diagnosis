"""Verify the other worktrees' dirty files and indexes were left intact by TASK-02."""
import hashlib
import json
from pathlib import Path
import subprocess


def inventory(root):
    names = subprocess.check_output(
        ["git", "ls-files", "-m", "-o", "--exclude-standard", "-z"], cwd=root
    ).decode().split("\0")
    return {
        name: hashlib.sha256((root / name).read_bytes()).hexdigest()
        if (root / name).is_file() else None
        for name in sorted(set(names) - {""})
    }


def main():
    root = Path(__file__).resolve().parents[1]
    snapshot = json.loads((root / "docs/testing/realtime-graph-runtime-20261111/inputs.json").read_text())
    for name, expected in snapshot["sources"].items():
        source = root.parent / name
        if inventory(source) != expected:
            raise SystemExit(f"Input worktree changed: {name}")
        if subprocess.check_output(["git", "diff", "--cached", "--name-only"], cwd=source).strip():
            raise SystemExit(f"Input index no longer empty: {name}")
        print(f"PASS {name}: {len(expected)} unchanged files; index empty")


if __name__ == "__main__":
    main()
