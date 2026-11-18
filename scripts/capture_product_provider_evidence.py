"""Read the sealed synthetic live experiment; never calls the provider."""
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/testing/product-acceptance-20261112'


def main():
    public = json.loads((OUT / 'real-provider-requests.json').read_text())
    rows = []
    for entry in public['requests']:
        path = ROOT / f'target/product-provider-private/response-{entry["id"]:02d}.json'
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
    mysql = 'D:/Work/Backend/MySQL-8.0.26/mysql-8.0.26-winx64/bin/mysql.exe'
    def query(sql):
        result = subprocess.check_output([mysql, '--no-defaults', '--protocol=TCP', '--host=127.0.0.1', '--port=3322',
                                          '--user=product_provider', '--password=product_provider', '--batch', '--raw',
                                          'product_provider_test', '--execute=' + sql], stderr=subprocess.DEVNULL).decode().splitlines()
        return [dict(zip(result[0].split('\t'), row.split('\t'))) for row in result[1:]]
    audit = {
        'evidenceKind': 'SYNTHETIC_UPSTREAM_REAL_PROVIDER',
        'runs': query('SELECT taskId,status,stopReason,callCount,supplementCount,rewriteCount FROM t_patient_draft_run ORDER BY startedAt'),
        'drafts': query('SELECT taskId,version,evidenceVersion FROM t_patient_draft_version ORDER BY taskId,version'),
        'evidence': query('SELECT taskId,version,JSON_LENGTH(citations) AS citationCount FROM t_patient_evidence_version ORDER BY taskId,version'),
        'publicEvents': query('SELECT runId,seq,type,actor,visibility,payloadJson FROM t_agent_collab_event ORDER BY runId,seq'),
        'sideEffects': query('SELECT (SELECT COUNT(*) FROM t_doctor_review) AS reviewCount,(SELECT COUNT(*) FROM t_patient_authorization) AS authorizationCount,(SELECT COUNT(*) FROM t_diagnosis) AS diagnosisCount'),
    }
    (OUT / 'real-provider-domain-audit.json').write_text(json.dumps(audit, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'realRequests': public['realRequests'], 'domainRuns': audit['runs'], 'sideEffects': audit['sideEffects']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
