"""Capture R5 evidence from the sealed private ledger and the isolated domain schema; never calls the provider."""
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/testing/product-acceptance-r5'
PRIVATE = ROOT / 'target/r5-provider-private'
MYSQL = 'D:/Work/Backend/MySQL-8.0.26/mysql-8.0.26-winx64/bin/mysql.exe'
DB = ['--no-defaults', '--protocol=TCP', '--host=127.0.0.1', '--port=3307',
      '--user=product_provider', '--password=product_provider', '--batch', '--raw', 'product_provider_test']


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def query(sql):
    result = subprocess.check_output([MYSQL, *DB, '--execute=' + sql], stderr=subprocess.DEVNULL).decode().splitlines()
    return [dict(zip(result[0].split('\t'), row.split('\t'))) for row in result[1:]]


def main():
    public = json.loads((OUT / 'real-provider-requests.json').read_text(encoding='utf-8'))
    rows = []
    for entry in public['requests']:
        path = PRIVATE / f'response-{entry["id"]:02d}.json'
        if not path.exists():
            rows.append({'id': entry['id'], 'role': entry['role'], 'response': 'NOT_AVAILABLE'})
            continue
        outer = json.loads(path.read_text())
        text = outer.get('choices', [{}])[0].get('message', {}).get('content', '')
        try:
            obj = json.loads(text)
        except ValueError:
            rows.append({'id': entry['id'], 'role': entry['role'], 'validJson': False})
            continue
        row = {'id': entry['id'], 'role': entry['role'], 'validJson': True, 'topLevelKeys': list(obj)}
        if entry['role'] == 'CRITIC':
            row['action'] = obj.get('action')
            row['objections'] = [{key: item.get(key) for key in ('target', 'reason')} for item in obj.get('objections', [])]
        rows.append(row)
    (OUT / 'real-provider-structure.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    audit = {
        'evidenceKind': 'SYNTHETIC_UPSTREAM_REAL_PROVIDER',
        'runs': query('SELECT taskId,status,stopReason,callCount,supplementCount,rewriteCount FROM t_patient_draft_run ORDER BY startedAt'),
        'drafts': query('SELECT taskId,version,evidenceVersion FROM t_patient_draft_version ORDER BY taskId,version'),
        'evidence': query('SELECT taskId,version,JSON_LENGTH(citations) AS citationCount FROM t_patient_evidence_version ORDER BY taskId,version'),
        'publicEvents': query('SELECT runId,seq,type,actor,visibility,payloadJson FROM t_agent_collab_event ORDER BY runId,seq'),
        'sideEffects': query('SELECT (SELECT COUNT(*) FROM t_doctor_review) AS reviewCount,(SELECT COUNT(*) FROM t_patient_authorization) AS authorizationCount,(SELECT COUNT(*) FROM t_diagnosis) AS diagnosisCount'),
    }
    (OUT / 'real-provider-domain-audit.json').write_text(json.dumps(audit, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    observations = json.loads((OUT / 'real-provider-observations.json').read_text(encoding='utf-8'))
    normal_ready = sum(1 for row in observations['observations']
                       if row.get('cell') in ('GRAPH', 'COORDINATOR') and row.get('status') == 'SUCCEEDED')
    seal = {
        'sealedAt': __import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat(),
        'experimentId': 'r5-2026-11-13',
        'hardLimit': public['hardLimit'],
        'spentRequests': public['realRequests'],
        'experimentClosed': True,
        'restartForbidden': True,
        'automaticRetries': 0,
        'ledgerSha256': sha(OUT / 'real-provider-requests.json'),
        'preregistrationSha256': sha(OUT / 'live-preregistration.json'),
        'allHttp200': all(row.get('httpStatus') == 200 for row in public['requests']),
        'providerTimeouts': sum(1 for row in public['requests'] if 'TIMEOUT' in str(row.get('failureType', '')).upper()),
        'providerFailures': sum(1 for row in public['requests'] if row.get('state') == 'FAILED'),
        'normalReadyCells': normal_ready,
        'plannedNormalCells': 2,
        'restrictedCells': [row.get('cell') for row in observations['observations'] if row.get('status') == 'RESTRICTED'],
    }
    (OUT / 'live-seal.json').write_text(json.dumps(seal, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'realRequests': public['realRequests'], 'hardLimit': public['hardLimit'],
                      'domainRuns': audit['runs'], 'sideEffects': audit['sideEffects'], 'seal': seal},
                     ensure_ascii=False))


if __name__ == '__main__':
    main()
