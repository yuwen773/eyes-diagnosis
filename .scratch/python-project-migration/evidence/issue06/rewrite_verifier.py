"""One-time ticket06 edit; preserves HTTP behavioral assertions."""
import ast
from pathlib import Path

p = Path('algorithm/web/verify_real_services.py')
s = p.read_text(encoding='utf-8')
helpers = s[s.index('def free_port():'):s.index('def verify_http(')]
http = s[s.index('def verify_http('):s.rindex('\nif __name__')]
http = http.replace('def verify_http(clients, java_port, engine, collection, worker, report, *, proxy=None, legacy_clients):',
                    'def verify_http(clients, engine, collection, worker, report, restart_api):')
http = http.replace('    java_url = f"http://127.0.0.1:{java_port}/api"\n', '')
start = http.index('    java_news = ')
end = http.index('    def table_doc', start)
http = http[:start] + '''    assert py_news["id"] == news_id and py_news["publishTime"] == "2026-01-02 02:00:00"
    body = {"id": news_id, "title": "Issue19", "content": "Synthetic news for compatibility regression only.", "status": 1}
    envelope(admin.post("/api/news/edit", json=body))
    with engine.begin() as db:
        affected = db.execute(text("UPDATE t_news SET title=title WHERE id=:id"), {"id": int(news_id)}).rowcount
    report["affectedRows"] = {"sqlalchemyNoopRowcount": affected}
    check("real-mysql-noop-and-frozen-news-date-contract")

''' + http[end:]
start = http.index('    java_result = ')
end = http.index('    governance = ', start)
http = http[:start] + '''    bob_citations = envelope(bob.post("/api/knowledge/search", json={"query": reference}))
    assert public["id"] not in {c["documentId"] for c in bob_citations}
    check("doc-docx-real-chroma-large-id-private-scope")
''' + http[end:]
start = http.index('    java_history = ')
end = http.index('    def review(', start)
http = http[:start] + '''    assert history["total"] == "1"
    assert isinstance(history["records"][0]["id"], str)
    assert envelope(bob.post("/api/diagnosis/list/page/my", json={"userId": "9007199254740993"}))["total"] == "0"
    check("user-consent-save-conflict-and-replay-exactly-once")

''' + http[end:]
http = http.replace('    if proxy:\n        proxy.preserve_wait(alice, save_url, report)\n',
                    '    restart_api()\n    assert envelope(alice.get(save_url)) == confirmation\n')
http = http.replace('        if proxy:\n            proxy.preserve_wait(doctor, url, report)\n',
                    '        restart_api()\n        assert envelope(doctor.get(url)) == detail\n')
http = http.replace('real-java-doctor', 'real-python-doctor')
http = http.replace('    if proxy:\n        proxy.verify_supplement(alice, task, report)\n', '')
assert 'java' not in http.lower() and 'proxy' not in http
p.write_text(Path('.scratch/python-project-migration/evidence/issue06/verifier_head.txt').read_text(encoding='utf-8')
             + '\n\n' + helpers + http + '\n\nif __name__ == "__main__":\n    raise SystemExit(main())\n', encoding='utf-8')
