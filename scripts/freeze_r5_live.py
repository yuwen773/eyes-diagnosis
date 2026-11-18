"""Freeze the R5 live experiment before its first request; verify frozen candidate afterwards.

Independent of the sealed 2026-11-12 experiment: separate output, budget (16) and private
directory. Never resets or reopens a started experiment.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'docs/testing/product-acceptance-r5/live-preregistration.json'
RUN_MARKER = ROOT / 'target/r5-provider-private/RUN_STARTED'

FROZEN_PATHS = {
    'pom.xml', 'web/package.json', 'web/package-lock.json', 'web/vite.config.ts',
    'web/playwright.config.ts', 'docs/plans/2026-11-13-r5-live-protocol.md',
    'scripts/freeze_r5_live.py',
}
COMPILED_PREFIXES = (
    'target/classes/com/csust/eyediagnosis',
    'target/test-classes/com/csust/eyediagnosis/collaboration',
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--freeze', action='store_true')
    args = parser.parse_args()
    if args.freeze:
        if OUTPUT.exists() or RUN_MARKER.exists():
            raise SystemExit('Refusing to reset a frozen/live experiment')
        names = set(subprocess.check_output(
            ['git', 'ls-files', '-c', '-m', '-o', '--exclude-standard', '-z'], cwd=ROOT).decode().split('\0')) - {''}
        paths = [path for path in names
                 if path.startswith(('src/main/', 'src/test/', 'web/src/', 'web/e2e/')) or path in FROZEN_PATHS]
        for prefix in COMPILED_PREFIXES:
            paths += [path.relative_to(ROOT).as_posix() for path in (ROOT / prefix).rglob('*.class')]
        files = {path: hashlib.sha256((ROOT / path).read_bytes()).hexdigest()
                 for path in sorted(set(paths)) if (ROOT / path).is_file()}
        registration = {
            'experimentId': 'r5-2026-11-13',
            'frozenAt': datetime.now(timezone.utc).isoformat(),
            'authorizedBy': 'repository owner (user dialogue, 2026-11-13)',
            'authorizedBudget': 16,
            'hardLimit': 16,
            'cells': ['GRAPH', 'COORDINATOR'],
            'negativeCells': ['OOD', 'QUALITY'],
            'perRunLimit': 8,
            'requestTimeoutSeconds': 20,
            'runTimeoutMillis': 90000,
            'model': {'name': 'qwen3.5-plus', 'temperature': 0.2, 'enableThinking': False,
                      'maxTokens': 4000, 'stream': False, 'endpoint': 'dashscope-compatible-mode'},
            'inputs': {'kind': 'SYNTHETIC_ONLY', 'image': '1px synthetic PNG',
                       'references': 'harness-seeded synthetic engineering text',
                       'realMedicalInput': False, 'patientData': False},
            'noRetries': True,
            'stopConditions': ['BUDGET_16', 'HTTP_401_403_429', 'NEGATIVE_CELL_REQUEST', 'UNSAFE_OUTBOUND_FIELDS'],
            'baselineExperiment': {'id': '2026-11-12', 'sealed': True, 'restartForbidden': True,
                                   'budgetReused': False},
            'files': files,
        }
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT.write_text(json.dumps(registration, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    data = json.loads(OUTPUT.read_text(encoding='utf-8'))
    for path, digest in data['files'].items():
        if hashlib.sha256((ROOT / path).read_bytes()).hexdigest() != digest:
            raise SystemExit('Frozen candidate changed: ' + path)
    print(f"R5 live experiment frozen and verified: {len(data['files'])} files; "
          f"hardLimit {data['hardLimit']}, cells {data['cells']}, synthetic inputs only")


if __name__ == '__main__':
    main()
