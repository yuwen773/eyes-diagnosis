"""Recompute product acceptance evidence; never performs network/model calls.

Two evaluation tracks are strictly isolated:

* The 2026-11-12 baseline experiment (`docs/testing/product-acceptance-20261112/`,
  candidate HEAD 65727431 + uncommitted content) is sealed history. This script
  never rewrites its results.json, live-preregistration.json, live-seal.json,
  request ledger or the target/product-provider-private RUN_STARTED marker.
  Use --verify-baseline to re-check the sealed files' hashes without mutation.
* A new candidate evaluation writes to a fresh `--out` directory (default
  `docs/testing/product-acceptance-r5/`). It must never point at the sealed
  baseline directory; counts are computed from the actual reports instead of
  being asserted against historical numbers.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import subprocess
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
BASELINE = ROOT / 'docs/testing/product-acceptance-20261112'
DEFAULT_OUT = ROOT / 'docs/testing/product-acceptance-r5'

# Historical experiment constants, kept for reference only — never re-asserted
# against a new candidate. The 32-request ledger and its RUN_STARTED marker
# belong to that experiment and stay untouched.
BASELINE_HEAD = '6572743169027bb1e7c27d7d969a26ed89d99cd1'
BASELINE_BACKEND_COUNTS = {'PASS': 414, 'SKIPPED': 3}
BASELINE_FRONTEND_TOTAL = 339


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def collect_backend():
    suites = []
    for path in sorted((ROOT / 'target/surefire-reports').glob('TEST-*.xml')):
        suite = ET.parse(path).getroot()
        suites.append({'suite': suite.get('name'), 'reportSha256': sha(path), 'cases': [
            {'name': case.get('name'), 'status': 'SKIPPED' if case.find('skipped') is not None else
             'FAILED' if case.find('failure') is not None or case.find('error') is not None else 'PASS'}
            for case in suite.findall('testcase')]})
    counts = Counter(case['status'] for suite in suites for case in suite['cases'])
    return suites, dict(counts)


def collect_browser(label, name):
    path = f'target/{name}.json'
    report = read(path)
    entry = {'stats': report['stats'], 'sha256': sha(ROOT / path), 'tests': []}

    def walk(suites):
        for suite in suites:
            for spec in suite.get('specs', []):
                entry['tests'].append({'title': spec['title'], 'statuses': [test['status'] for test in spec['tests']]})
            walk(suite.get('suites', []))
    walk(report['suites'])
    return entry


def verify_baseline():
    """Re-check the sealed 2026-11-12 evidence without touching anything."""
    result = read(BASELINE / 'results.json')
    assert result['head'] == BASELINE_HEAD, 'baseline results.json no longer binds the sealed HEAD'
    changed = [rel for rel, digest in result['evidence'].items()
               if sha(ROOT / rel) != digest]
    assert not changed, f'sealed baseline evidence changed: {changed}'
    assert sha(ROOT / 'docs/testing/2026-11-12-realtime-product-acceptance.md') == result['acceptanceReportSha256'], \
        'acceptance report no longer matches the sealed hash'
    seal = read(BASELINE / 'live-seal.json')
    assert seal['experimentClosed'] and seal['restartForbidden'], 'live experiment must stay closed'
    ledger_path = ROOT / 'target/product-provider-private' / 'real-provider-requests.json'
    if ledger_path.exists():
        assert sha(ledger_path) == seal['ledgerSha256'], 'request ledger drifted from the sealed hash'
    assert (ROOT / 'target/product-provider-private/RUN_STARTED').exists(), 'RUN_STARTED marker must be preserved'
    print(json.dumps({'baseline': 'VERIFIED', 'evidenceFiles': len(result['evidence']),
                      'head': result['head'], 'experimentClosed': True}, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, default=DEFAULT_OUT,
                        help='fresh evidence directory for the new candidate')
    parser.add_argument('--verify-baseline', action='store_true',
                        help='re-check sealed 2026-11-12 evidence, write nothing')
    args = parser.parse_args()
    if args.verify_baseline:
        verify_baseline()
        return
    out = args.out if args.out.is_absolute() else ROOT / args.out
    out = out.resolve()
    if out == BASELINE or out in BASELINE.parents or BASELINE in out.parents:
        raise SystemExit('refusing to write into or above the sealed baseline directory')
    if (out / 'results.json').exists():
        raise SystemExit(f'refusing to overwrite an existing evaluation: {out}')

    subprocess.run(['python', 'scripts/product_acceptance_inputs.py'], cwd=ROOT, check=True)

    suites, counts = collect_backend()
    # Gate on the contract, not on historical numbers: every case must PASS or
    # be an explicitly-contracted skip, and nothing may FAIL.
    assert 'FAILED' not in counts, counts
    if not counts or counts.get('PASS', 0) == 0:
        raise SystemExit(f'no passing backend cases found — run the full suite first: {counts}')
    skip_gate = subprocess.run(['python', 'scripts/check_surefire_skips.py',
                                'target/surefire-reports', 'product'],
                               cwd=ROOT, capture_output=True, text=True)
    product_skip_gate = 'PASS' if skip_gate.returncode == 0 else f'FAIL: {skip_gate.stderr.strip()}'

    frontend = read('target/product-vitest.json')
    assert frontend['numFailedTests'] == frontend['numPendingTests'] == 0, frontend
    if frontend['numPassedTests'] == 0:
        raise SystemExit('no passing frontend tests found — run the Vitest suite first')

    browsers = {}
    for label, name in [('product', 'product-playwright'), ('fixtures', 'product-fixture-playwright'),
                        ('defaultOff', 'product-default-off-playwright'), ('liveHarness', 'product-real-playwright')]:
        report = read(f'target/{name}.json')
        assert report['stats']['skipped'] == report['stats']['unexpected'] == report['stats']['flaky'] == 0, (label, report['stats'])
        browsers[label] = collect_browser(label, name)

    # The 32-request historical ledger is read-only context for the new track:
    # reported as-is, never re-validated against new budgets and never reset.
    baseline_ledger = read(BASELINE / 'real-provider-requests.json')
    baseline_seal = read(BASELINE / 'live-seal.json')
    assert baseline_seal['experimentClosed'] and baseline_seal['restartForbidden']

    cleanup = read(BASELINE / 'cleanup.json')
    assert cleanup['taskPortsClosed'] and cleanup['temporaryCredentialConfigRemoved'] and cleanup['ownedRedisRemoved']
    assert not (ROOT / 'target/application-product-context.yml').exists()

    names = set(subprocess.check_output(['git', 'ls-files', '-c', '-m', '-o', '--exclude-standard', '-z'],
                                        cwd=ROOT).decode().split('\0')) - {''}
    source = {name: sha(ROOT / name) for name in sorted(names)
              if (ROOT / name).is_file() and not name.startswith('docs/testing/')}
    staged = subprocess.check_output(['git', 'diff', '--cached', '--binary'], cwd=ROOT)
    assert not staged, 'Acceptance must not stage existing changes'

    out.mkdir(parents=True, exist_ok=True)
    evidence = {path.relative_to(out).as_posix(): sha(path) for path in sorted(out.iterdir())
                if path.is_file() and path.name != 'results.json'}
    result = {
        'generatedAt': datetime.now(timezone.utc).isoformat(),
        'overall': 'PENDING_LIVE',  # R5 live-model track has not been authorized/run yet
        'baseline': {
            'head': BASELINE_HEAD,
            'acceptanceReport': 'docs/testing/2026-11-12-realtime-product-acceptance.md',
            'acceptanceReportSha256': sha(ROOT / 'docs/testing/2026-11-12-realtime-product-acceptance.md'),
            'evidenceDir': BASELINE.relative_to(ROOT).as_posix(),
            'experimentClosed': True, 'restartForbidden': True,
            'realRequests': len(baseline_ledger['requests']), 'hardLimit': baseline_ledger['hardLimit'],
            'backendCounts': BASELINE_BACKEND_COUNTS, 'frontendTotal': BASELINE_FRONTEND_TOTAL,
        },
        'head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT).decode().strip(),
        'branch': subprocess.check_output(['git', 'branch', '--show-current'], cwd=ROOT).decode().strip(),
        'candidateFiles': source,
        'backend': {'counts': counts, 'suites': suites, 'productSkipGate': product_skip_gate},
        'frontend': {key: frontend[key] for key in ['numTotalTests', 'numPassedTests', 'numFailedTests', 'numPendingTests']},
        'browser': {name: row['stats'] for name, row in browsers.items()},
        'rawReports': {path: sha(ROOT / path) for path in [
            'target/product-backend-all.log', 'target/product-backend-first.log', 'target/product-context-first.xml',
            'target/product-vitest.json', 'target/product-skip-gate.log', 'target/product-fixture-before-update.json',
            'target/product-date-red.json', 'target/product-date-green.json',
            'target/product-history-date-red.json', 'target/product-history-date-green.json',
            'target/product-playwright.json', 'target/product-fixture-playwright.json',
            'target/product-default-off-playwright.json', 'target/product-real-playwright.json']},
        'liveTrack': {
            'status': 'NOT_AUTHORIZED',
            'note': 'R5 real-model acceptance requires separate user authorization; '
                    'the sealed 32-request budget is history and is never reused.',
            'modelGate': 'NOT_PASSED',
        },
        'limitations': ['SYNTHETIC_UPSTREAM', 'CLINICAL_NOT_EVALUATED', 'NORMAL_MEDICAL_OOD_INPUTS_MISSING',
                        'PRODUCTION_OPERATIONS_NOT_RUN', 'LIVE_MODEL_TRACK_NOT_AUTHORIZED'],
        'evidence': evidence,
    }
    (out / 'results.json').write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(json.dumps({'backend': counts, 'frontend': result['frontend'],
                      'browser': result['browser'], 'productSkipGate': product_skip_gate,
                      'out': out.relative_to(ROOT).as_posix(), 'overall': result['overall']},
                     ensure_ascii=False))


if __name__ == '__main__':
    main()
