"""Freeze prerequisite worktrees and prepare the TASK-07 integration candidate."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT = ROOT / 'docs/testing/realtime-safety-release-20261111/inputs.json'
NAMES = ('java-multi-agent-arch', 'realtime-graph-spike', 'realtime-coordinator-events',
         'realtime-react-events', 'realtime-collaboration-ui', 'realtime-graph-runtime',
         'realtime-model-evaluation')


def inventory(root):
    paths = set(subprocess.check_output(
        ['git', 'ls-files', '-m', '-o', '--exclude-standard', '-z'], cwd=root
    ).decode().split('\0')) - {''}
    return {
        'head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root).decode().strip(),
        'index': hashlib.sha256(subprocess.check_output(['git', 'diff', '--cached', '--binary'], cwd=root)).hexdigest(),
        'files': {p: hashlib.sha256((root / p).read_bytes()).hexdigest()
                  if (root / p).is_file() else None for p in sorted(paths)},
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prepare', action='store_true')
    args = parser.parse_args()
    if args.prepare:
        if SNAPSHOT.exists():
            raise SystemExit('Refusing to overwrite input freeze')
        sources = {name: inventory(ROOT.parent / name) for name in NAMES}
        conflicts = []
        for name in ('realtime-collaboration-ui', 'realtime-graph-runtime'):
            for path in sources[name]['files']:
                source = ROOT.parent / name / path
                if not source.is_file():
                    raise SystemExit('Deleted input requires explicit integration: ' + path)
                target = ROOT / path
                if name == 'realtime-graph-runtime' and path in sources['realtime-collaboration-ui']['files']:
                    if target.read_bytes() != source.read_bytes():
                        conflicts.append(path)
                        if path in ('AGENTS.md', 'CLAUDE.md', '.github/workflows/ci.yml'):
                            continue
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(source.read_bytes())
        SNAPSHOT.parent.mkdir(parents=True, exist_ok=True)
        SNAPSHOT.write_text(json.dumps({'sources': sources, 'overlap_differences': conflicts}, indent=2) + '\n')
        print('Integration overlaps requiring review:', conflicts)
    expected = json.loads(SNAPSHOT.read_text())['sources']
    for name, snapshot in expected.items():
        if inventory(ROOT.parent / name) != snapshot:
            raise SystemExit('Input changed: ' + name)
        print(f'PASS {name}: {len(snapshot["files"])} files, HEAD and index unchanged')


if __name__ == '__main__':
    main()
