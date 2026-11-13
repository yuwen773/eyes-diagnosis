"""Freeze eight prerequisite trees and copy the exact TASK-07 candidate for product acceptance."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'docs/testing/product-acceptance-20261112/inputs.json'
NAMES = ('java-multi-agent-arch', 'realtime-graph-spike', 'realtime-coordinator-events',
         'realtime-react-events', 'realtime-collaboration-ui', 'realtime-graph-runtime',
         'realtime-model-evaluation', 'realtime-safety-release')


def inventory(root):
    paths = set(subprocess.check_output(['git', 'ls-files', '-m', '-o', '--exclude-standard', '-z'], cwd=root).decode().split('\0')) - {''}
    return {
        'head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root).decode().strip(),
        'index': hashlib.sha256(subprocess.check_output(['git', 'diff', '--cached', '--binary'], cwd=root)).hexdigest(),
        'files': {path: hashlib.sha256((root / path).read_bytes()).hexdigest() if (root / path).is_file() else None for path in sorted(paths)},
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prepare', action='store_true')
    args = parser.parse_args()
    if args.prepare:
        if OUTPUT.exists():
            raise SystemExit('Refusing to overwrite the input freeze')
        sources = {name: inventory(ROOT.parent / name) for name in NAMES}
        for path in sources['realtime-safety-release']['files']:
            source = ROOT.parent / 'realtime-safety-release' / path
            if not source.is_file():
                raise SystemExit('Deleted input requires explicit integration: ' + path)
            target = ROOT / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(source.read_bytes())
        # The existing unapplied Java-line V15 is a required fresh-login dependency,
        # copied explicitly instead of bringing unrelated OOD or Vue changes.
        path = 'src/main/resources/db/migration/V15__bootstrap_user_table.sql'
        target = ROOT / path
        target.write_bytes((ROOT.parent / 'java-multi-agent-arch' / path).read_bytes())
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT.write_text(json.dumps({'sources': sources, 'additionalDependency': path}, indent=2) + '\n')
    for name, expected in json.loads(OUTPUT.read_text())['sources'].items():
        if inventory(ROOT.parent / name) != expected:
            raise SystemExit('Input changed: ' + name)
        print(f'PASS {name}: {len(expected["files"])} files, HEAD and index unchanged')


if __name__ == '__main__':
    main()
