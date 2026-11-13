"""Bind successful TASK-07 engineering checks to exact candidate contents; no network."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'docs/testing/realtime-safety-release-20261111/results.json'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(name):
    # npm may append update notices after a JSON reporter. Preserve raw bytes/hash,
    # decode exactly the first JSON value, and accept only npm notices afterward.
    text = (ROOT / name).read_text(encoding='utf-8-sig').lstrip()
    value, end = json.JSONDecoder().raw_decode(text)
    trailing = text[end:].strip()
    if trailing and not all(line.startswith('npm notice') for line in trailing.splitlines() if line):
        raise ValueError('Unexpected reporter output: ' + name)
    return value


def browser(name, expected):
    data = read(name)
    assert data['stats']['expected'] == expected
    assert all(data['stats'][key] == 0 for key in ('skipped', 'unexpected', 'flaky'))
    assert not data['errors']

    def cases(suites):
        for suite in suites:
            for spec in suite.get('specs', []):
                for test in spec['tests']:
                    assert test['status'] == 'expected'
                    assert len(test['results']) == 1 and test['results'][0]['status'] == 'passed'
                    yield {'name': spec['title'], 'seconds': test['results'][0]['duration'] / 1000}
            yield from cases(suite.get('suites', []))

    tests = list(cases(data['suites']))
    assert len(tests) == expected
    return {'stats': data['stats'], 'cases': tests, 'sha256': sha(ROOT / name)}


def main():
    subprocess.run([sys.executable, str(ROOT / 'scripts/task07_inputs.py')], cwd=ROOT, check=True)
    subprocess.run(['git', 'diff', '--cached', '--quiet'], cwd=ROOT, check=True)
    backend = []
    expected = {
        'collaboration.CollaborationRunTest': 31, 'collaboration.GraphExecutionTest': 32,
        'doctorreview.DoctorReviewApiTest': 36, 'patientauthorization.PatientAuthorizationApiTest': 37,
        'patientdraft.PatientDraftTest': 41, 'patientexplanation.PatientExplanationApiTest': 37,
        'poc.CoordinationPocTest': 4, 'poc.realtime.RealtimeGraphSpikeTest': 12,
    }
    for name, count in expected.items():
        path = ROOT / f'target/surefire-reports/TEST-com.csust.eyediagnosis.{name}.xml'
        suite = ET.parse(path).getroot()
        assert int(suite.attrib['tests']) == count
        assert all(int(suite.attrib.get(key, 0)) == 0 for key in ('failures', 'errors', 'skipped'))
        assert len(suite.findall('testcase')) == count
        backend.append({'suite': suite.attrib['name'], 'tests': count, 'sha256': sha(path),
                        'cases': [{'name': case.attrib['name'], 'seconds': case.attrib.get('time')}
                                  for case in suite.findall('testcase')]})
    vitest = read('target/task07-vitest.json')
    assert vitest['numPassedTests'] == 332
    assert vitest['numFailedTests'] == vitest['numPendingTests'] == 0
    unit = [{'file': Path(suite['name']).relative_to(ROOT).as_posix(),
             'cases': [{'name': test['fullName'], 'status': test['status']} for test in suite['assertionResults']]}
            for suite in vitest['testResults']]
    assert all(test['status'] == 'passed' for suite in unit for test in suite['cases'])
    cleanup = read('target/task07-cleanup.json')
    assert cleanup['allClosed'] is True
    paths = set(subprocess.check_output(['git', 'ls-files', '-m', '-o', '--exclude-standard', '-z'], cwd=ROOT).decode().split('\0')) - {''}
    candidate = {path: sha(ROOT / path) if (ROOT / path).is_file() else None
                 for path in sorted(paths) if ROOT / path != OUTPUT}
    sources = read('docs/testing/realtime-safety-release-20261111/inputs.json')['sources']
    task07 = {path: digest for path, digest in candidate.items()
              if all(sources[source]['files'].get(path) != digest for source in ('realtime-graph-runtime', 'realtime-collaboration-ui'))}
    result = {
        'recordedAt': datetime.now(timezone.utc).isoformat(),
        'evidence': 'REAL_HTTP_SSE_MYSQL_GRAPH_SYNTHETIC_MODEL_INFERENCE_STORAGE_SESSION_BOOTSTRAP',
        'engineeringScope': 'PASS', 'overall': 'PARTIAL', 'realProviderCalls': 0,
        'head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT).decode().strip(),
        'branch': subprocess.check_output(['git', 'branch', '--show-current'], cwd=ROOT).decode().strip(),
        'backend': backend,
        'frontend': {'passed': 332, 'sha256': sha(ROOT / 'target/task07-vitest.json'), 'suites': unit},
        'browserSafety': browser('target/task07-playwright.json', 4),
        'browserDefaultOffSyntheticChat': browser('target/task07-default-off.json', 1),
        'wireContract': read('target/task07-wire.json'),
        'cleanup': cleanup,
        'candidateFileSha256': candidate, 'task07FileSha256': task07,
        'backendLogSha256': sha(ROOT / 'target/task07-tests.log'),
        'notRun': ['real medical input/OOD', 'real provider', 'full backend', 'hosted CI',
                   'React doctor decision and patient save UI', 'production history upgrade',
                   'production configuration rollout', 'old binary rollback', 'load/SLO/alert delivery'],
    }
    OUTPUT.write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(f'TASK-07 PASS: {sum(expected.values())} backend, 332 frontend, 5 browser; {len(candidate)} bound files; seven input trees intact')


if __name__ == '__main__':
    main()
