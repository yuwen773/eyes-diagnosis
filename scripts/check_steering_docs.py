#!/usr/bin/env python3
"""Fail CI when steering docs cache facts the environment already owns.

`CLAUDE.md` and `AGENTS.md` each carry a copy of the Flyway head, the key
table list, and the controller endpoint table. Copies go stale: a 2026-11-07
commit updated CLAUDE.md to V12 and left AGENTS.md at V10. The migration
directory and the `@RequestMapping` annotations are the sources of truth.

Checks (mechanical, so they belong here and not in CODING_STANDARDS.md):
  * both steering files name the highest `V*.sql` migration as current head;
  * both list every controller path from the Java annotations;
  * both name the same head, so the two copies cannot diverge silently.

Usage:
    python3 scripts/check_steering_docs.py [repo_root]
"""

import argparse
import re
import sys
from pathlib import Path

STEERING = (Path("CLAUDE.md"), Path("AGENTS.md"))
MIGRATIONS = Path("src/main/resources/db/migration")
CONTROLLERS = Path("src/main/java/com/csust/eyediagnosis/controller")

HEAD_PATTERN = re.compile(r"Current head is\s+V?([0-9]+)")
MAPPING_PATTERN = re.compile(r'@RequestMapping\("(/[^"]+)"\)')


def migration_head(root: Path):
    versions = []
    for path in (root / MIGRATIONS).glob("V*.sql"):
        match = re.match(r"V([0-9]+)__", path.name)
        if match:
            versions.append(int(match.group(1)))
    if not versions:
        return None, f"{MIGRATIONS}: no versioned migrations found"
    return max(versions), None


def controller_paths(root: Path):
    paths = set()
    for path in (root / CONTROLLERS).glob("*.java"):
        for value in MAPPING_PATTERN.findall(path.read_text(encoding="utf-8")):
            paths.add("/api" + value)
    if not paths:
        return None, f"{CONTROLLERS}: no @RequestMapping paths found"
    return paths, None


def check(root: Path):
    errors = []
    head, error = migration_head(root)
    if error:
        errors.append(error)
    paths, error = controller_paths(root)
    if error:
        errors.append(error)
    if errors:
        return errors

    heads = {}
    for doc in STEERING:
        file = root / doc
        if not file.is_file():
            errors.append(f"{doc}: missing steering file")
            continue
        text = file.read_text(encoding="utf-8")
        found = HEAD_PATTERN.search(text)
        if not found:
            errors.append(f"{doc}: no `Current head is V<n>` statement")
        else:
            heads[doc] = int(found.group(1))
            if heads[doc] != head:
                errors.append(
                    f"{doc}: states V{heads[doc]}, but migrations reach V{head}"
                )
        missing = sorted(path for path in paths if path not in text)
        if missing:
            errors.append(f"{doc}: missing controller paths {missing}")

    if len(set(heads.values())) > 1:
        errors.append(f"steering files disagree on migration head: {heads}")
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", nargs="?", default=".", type=Path)
    args = parser.parse_args()
    errors = check(args.root.resolve())
    if errors:
        for error in errors:
            print(f"steering docs gate failed: {error}", file=sys.stderr)
        return 1
    print("steering docs gate passed: both files match migrations and controllers")
    return 0


if __name__ == "__main__":
    sys.exit(main())
