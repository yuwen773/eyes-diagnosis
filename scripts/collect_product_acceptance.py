"""Recompute current product acceptance evidence; never performs network/model calls."""
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import subprocess
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/testing/product-acceptance-20261112'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(path):
    return json.loads((ROOT / path).read_text(encoding='utf-8-sig'))


def main():
    subprocess.run(['python', 'scripts/product_acceptance_inputs.py'], cwd=ROOT, check=True)
    subprocess.run(['python', 'scripts/freeze_product_acceptance_live.py'], cwd=ROOT, check=True)
    backend = []
    for path in sorted((ROOT / 'target/surefire-reports').glob('TEST-*.xml')):
        suite = ET.parse(path).getroot()
        backend.append({'suite': suite.get('name'), 'reportSha256': sha(path), 'cases': [
            {'name': case.get('name'), 'status': 'SKIPPED' if case.find('skipped') is not None else
             'FAILED' if case.find('failure') is not None or case.find('error') is not None else 'PASS'}
            for case in suite.findall('testcase')]})
    counts = Counter(case['status'] for suite in backend for case in suite['cases'])
    assert counts == {'PASS': 414, 'SKIPPED': 3}, counts
    frontend = read('target/product-vitest.json')
    assert frontend['numPassedTests'] == 339 and frontend['numFailedTests'] == frontend['numPendingTests'] == 0
    browsers = {}
    for label, name, expected in [('product', 'product-playwright', 16), ('fixtures', 'product-fixture-playwright', 12),
                                  ('defaultOff', 'product-default-off-playwright', 1), ('liveHarness', 'product-real-playwright', 1)]:
        path = f'target/{name}.json'
        report = read(path)
        assert report['stats']['expected'] == expected and all(report['stats'][key] == 0 for key in ['skipped', 'unexpected', 'flaky']), (label, report['stats'])
        browsers[label] = {'stats': report['stats'], 'sha256': sha(ROOT / path), 'tests': []}
        def walk(suites):
            for suite in suites:
                for spec in suite.get('specs', []):
                    browsers[label]['tests'].append({'title': spec['title'], 'statuses': [test['status'] for test in spec['tests']]})
                walk(suite.get('suites', []))
        walk(report['suites'])
    ledger = read('docs/testing/product-acceptance-20261112/real-provider-requests.json')
    private = ROOT / 'target/product-provider-private'
    rows = ledger['requests']
    assert ledger['hardLimit'] == 32 and ledger['realRequests'] == len(rows) <= 32
    assert len(list(private.glob('reservation-*.json'))) == len(list(private.glob('request-*.json'))) == len(rows)
    for row in rows:
        assert sha(private / f'request-{row["id"]:02d}.json') == row['requestSha256']
        if 'responseSha256' in row:
            assert sha(private / f'response-{row["id"]:02d}.json') == row['responseSha256']
    observations = read('docs/testing/product-acceptance-20261112/real-provider-observations.json')
    assert [row['cell'] for row in observations['observations']] == ['OOD', 'QUALITY', 'GRAPH', 'COORDINATOR']
    assert sum(row['realRequests'] for row in observations['observations']) == len(rows)
    cleanup = read('docs/testing/product-acceptance-20261112/cleanup.json')
    assert cleanup['taskPortsClosed'] and cleanup['temporaryCredentialConfigRemoved'] and cleanup['ownedRedisRemoved']
    assert not (ROOT / 'target/application-product-context.yml').exists()
    gates = read('docs/testing/product-acceptance-20261112/release-gates.json')
    assert gates['backendSkipGate']['status'] == 'FAIL_BASELINE_MISMATCH'
    names = set(subprocess.check_output(['git', 'ls-files', '-c', '-m', '-o', '--exclude-standard', '-z'], cwd=ROOT).decode().split('\0')) - {''}
    source = {name: sha(ROOT / name) for name in sorted(names)
              if (ROOT / name).is_file() and not name.startswith('docs/testing/')}
    staged = subprocess.check_output(['git', 'diff', '--cached', '--binary'], cwd=ROOT)
    assert not staged, 'Acceptance must not stage existing changes'
    evidence = {path.relative_to(ROOT).as_posix(): sha(path) for path in sorted(OUT.iterdir()) if path.is_file() and path.name != 'results.json'}
    result = {'generatedAt': datetime.now(timezone.utc).isoformat(), 'overall': 'PARTIAL',
              'acceptanceReportSha256': sha(ROOT / 'docs/testing/2026-11-12-realtime-product-acceptance.md'),
              'head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT).decode().strip(),
              'branch': subprocess.check_output(['git', 'branch', '--show-current'], cwd=ROOT).decode().strip(),
              'candidateFiles': source, 'indexEmpty': True, 'backend': {'counts': dict(counts), 'suites': backend},
              'rawReports': {path: sha(ROOT / path) for path in [
                  'target/product-backend-all.log', 'target/product-backend-first.log', 'target/product-context-first.xml',
                  'target/product-vitest.json', 'target/product-skip-gate.log', 'target/product-fixture-before-update.json',
                  'target/product-date-red.json', 'target/product-date-green.json',
                  'target/product-history-date-red.json', 'target/product-history-date-green.json']},
              'frontend': {key: frontend[key] for key in ['numTotalTests', 'numPassedTests', 'numFailedTests', 'numPendingTests']},
              'browser': browsers, 'provider': {'realRequests': len(rows), 'hardLimit': 32, 'states': dict(Counter(row['state'] for row in rows)),
               'normalReadyCells': sum(row['status'] == 'SUCCEEDED' for row in observations['observations'] if row['cell'] in ['GRAPH', 'COORDINATOR']),
               'modelGate': 'NOT_PASSED',
               'usage': dict(sum((Counter({key: value for key, value in row.get('usage', {}).items()
                                          if isinstance(value, int)}) for row in rows), Counter())),
               'cells': observations['observations']}, 'evidence': evidence,
              'limitations': ['SYNTHETIC_UPSTREAM', 'CLINICAL_NOT_EVALUATED', 'NORMAL_MEDICAL_OOD_INPUTS_MISSING',
                              'THREE_EXTERNAL_CASES_SKIPPED', 'BASELINE_SKIP_CONTRACT_MISMATCH_15_VS_7',
                              'PRODUCTION_OPERATIONS_NOT_RUN', 'HOSTED_CI_NOT_RUN']}
    (OUT / 'results.json').write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(json.dumps({'backend': dict(counts), 'frontend': result['frontend'], 'browser': {name: row['stats'] for name, row in browsers.items()},
                      'realRequests': len(rows), 'overall': 'PARTIAL'}, ensure_ascii=False))


if __name__ == '__main__':
    main()
