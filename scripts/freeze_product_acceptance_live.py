"""Freeze the product live smoke before its first request; preserve the independent 32-request authorization."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'docs/testing/product-acceptance-20261112/live-preregistration.json'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--freeze', action='store_true')
    args = parser.parse_args()
    if args.freeze:
        if OUTPUT.exists() or (ROOT / 'target/product-provider-private/RUN_STARTED').exists():
            raise SystemExit('Refusing to reset a frozen/live experiment')
        names = set(subprocess.check_output(['git', 'ls-files', '-c', '-m', '-o', '--exclude-standard', '-z'], cwd=ROOT).decode().split('\0')) - {''}
        paths = [path for path in names if path.startswith(('src/main/', 'src/test/', 'web/src/', 'web/e2e/')) or path in {
            'pom.xml', 'web/package.json', 'web/package-lock.json', 'web/vite.config.ts', 'web/playwright.config.ts',
            'docs/plans/2026-11-12-product-acceptance-live-protocol.md', 'scripts/freeze_product_acceptance_live.py',
        }]
        for prefix in ('target/classes/com/csust/eyediagnosis', 'target/test-classes/com/csust/eyediagnosis/collaboration'):
            paths += [path.relative_to(ROOT).as_posix() for path in (ROOT / prefix).rglob('*.class')]
        files = {path: hashlib.sha256((ROOT / path).read_bytes()).hexdigest() for path in sorted(set(paths)) if (ROOT / path).is_file()}
        OUTPUT.write_text(json.dumps({'frozenAt': datetime.now(timezone.utc).isoformat(), 'hardLimit': 32,
                                     'cells': ['GRAPH', 'COORDINATOR'], 'negativeCells': ['OOD', 'QUALITY'],
                                     'realMedicalInput': False, 'files': files}, indent=2) + '\n')
    data = json.loads(OUTPUT.read_text())
    for path, digest in data['files'].items():
        if hashlib.sha256((ROOT / path).read_bytes()).hexdigest() != digest:
            raise SystemExit('Frozen candidate changed: ' + path)
    print(f'Live smoke frozen and verified: {len(data["files"])} files; max32, two planned product cells, no retries')


if __name__ == '__main__':
    main()
