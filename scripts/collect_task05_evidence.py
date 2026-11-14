"""Bind local successful TASK-05 results and candidate files to an auditable manifest."""
import hashlib
import json
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path

root = Path(__file__).resolve().parent.parent
output = root / 'docs/testing/realtime-collaboration-ui-20261111/results.json'

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def read(name):
    return json.loads((root / name).read_text(encoding='utf-8-sig'))

vitest = read('target/task05-vitest.json')
assert vitest['numPassedTests'] == 332
assert vitest['numFailedTests'] == vitest['numPendingTests'] == 0
unit = [{ 'file': Path(s['name']).relative_to(root).as_posix(), 'tests': [
    {'name': t['fullName'], 'status': t['status']} for t in s['assertionResults']
]} for s in vitest['testResults']]
assert all(t['status'] == 'passed' for s in unit for t in s['tests'])

def browser(name, expected):
    data = read(name)
    assert data['stats']['expected'] == expected
    assert data['stats']['skipped'] == data['stats']['unexpected'] == data['stats']['flaky'] == 0
    assert not data['errors']
    def suites(items):
        for suite in items:
            for spec in suite.get('specs', []):
                for test in spec['tests']:
                    assert test['status'] == 'expected'
                    yield {'name': spec['title'], 'results': [r['status'] for r in test['results']]}
            yield from suites(suite.get('suites', []))
    return {'stats': data['stats'], 'tests': list(suites(data['suites'])), 'sha256': sha(root / name)}

backend = []
for name, expected in [('collaboration.CollaborationRunTest', 22), ('patientdraft.PatientDraftTest', 41), ('poc.CoordinationPocTest', 4)]:
    path = root / f'target/surefire-reports/TEST-com.csust.eyediagnosis.{name}.xml'
    suite = ET.parse(path).getroot()
    assert int(suite.attrib['tests']) == expected
    assert all(int(suite.attrib.get(field, 0)) == 0 for field in ['failures', 'errors', 'skipped'])
    backend.append({'suite': suite.attrib['name'], 'tests': expected, 'sha256': sha(path),
                    'cases': [{'name': t.attrib['name'], 'seconds': t.attrib.get('time')} for t in suite.findall('testcase')]})

subprocess.run(['python', str(root / 'scripts/check_task05_inputs.py')], check=True, cwd=root)
for tree in ['java-multi-agent-arch', 'realtime-coordinator-events', 'realtime-react-events']:
    subprocess.run(['git', '-C', str(root.parent / tree), 'diff', '--cached', '--quiet'], check=True)
names = subprocess.check_output(['git', 'ls-files', '-m', '-o', '--exclude-standard', '-z'], cwd=root).decode().split('\0')
files = {name: sha(root / name) for name in sorted(set(names)) if name and (root / name).is_file() and root / name != output}
result = {
    'evidence': 'LOCAL_ENGINEERING_ACCEPTANCE_SYNTHETIC_INPUTS',
    'overall': 'PARTIAL',
    'metadataUiScope': 'PASS',
    'head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root).decode().strip(),
    'branch': subprocess.check_output(['git', 'branch', '--show-current'], cwd=root).decode().strip(),
    'environment': {'powershell': '7.6.9', 'jdk': 'Corretto 21.0.7', 'maven': '3.9.9', 'node': '22.21.0', 'playwright': '1.65.0', 'chromium': '151.0.7922.34'},
    'vitest': {'passed': 332, 'failed': 0, 'skipped': 0, 'sha256': sha(root / 'target/task05-vitest.json'), 'suites': unit},
    'backend': backend,
    'browserFixtures': browser('target/task05-playwright.json', 12),
    'browserRealJavaMySqlSyntheticProviders': browser('target/task05-playwright-backend.json', 1),
    'browserDefaultOffSyntheticChat': browser('target/task05-playwright-default-off.json', 1),
    'buildLogSha256': sha(root / 'target/task05-build.log'),
    'realProviderCalls': 0,
    'candidateFileSha256': files,
}
output.write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
print(f'TASK-05 evidence collected: {len(files)} files; 332 frontend, 67 backend, 14 browser tests; no skips')
