import json
from datetime import datetime
import os
from pathlib import Path
import subprocess
import sys
import time
from uuid import uuid4

import httpx
from redis import Redis
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session
from web.models.user import User
from web.security import encode
from web.verify_real_services import envelope, free_port, stop_child

root = Path.cwd()
name = 'eye_windows_delivery06_' + uuid4().hex
runtime = root / '.scratch/baseline-runtime' / name
runtime.mkdir(parents=True)
target = make_url(os.environ['REAL_SERVICES_MYSQL_ADMIN_URL'])
assert target.host in {'127.0.0.1', 'localhost'} and not target.database
admin = create_engine(target)
with admin.begin() as db:
    db.exec_driver_sql(f'CREATE DATABASE `{name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci')
admin.dispose()
url = target.set(database=name).render_as_string(hide_password=False)
subprocess.run([sys.executable, '-m', 'web.migrations', 'upgrade'], env={**os.environ, 'MIGRATION_MYSQL_URL': url}, check=True)
engine = create_engine(url)
password = 'Windows-isolated-demo06!'
with Session(engine) as db:
    now = datetime(2026, 1, 2, 10)
    db.add(User(id=9007199254740993, user_account='windows_alice', user_password=encode(password), user_name='Windows 验收',
                user_role='user', edit_time=now, create_time=now, update_time=now))
    db.commit()
engine.dispose()
api_port, redis_port = free_port(), free_port()
settings = dict(MYSQL_HOST=target.host, MYSQL_PORT=str(target.port), MYSQL_DATABASE=name, MYSQL_USER=target.username,
                MYSQL_PASSWORD=target.password, REDIS_HOST='127.0.0.1', REDIS_PORT=str(redis_port), REDIS_DB='8', WEB_PORT=str(api_port))
environment = runtime / 'runtime.env'
environment.write_text('\n'.join(f'{key}={value}' for key, value in settings.items()) + '\n', encoding='utf-8')
command = ['pwsh.exe', '-NoLogo', '-NoProfile', '-File', str(root / 'scripts/dev.ps1')]
report = {'status': 'FAIL', 'schema': name, 'python': sys.version.split()[0]}
with (runtime / 'redis.log').open('wb') as log:
    child = subprocess.Popen([os.environ['REAL_SERVICES_REDIS_SERVER'], '--bind', '127.0.0.1', '--port', str(redis_port),
                              '--save', '', '--appendonly', 'no', '--dir', str(runtime)], stdout=log, stderr=log,
                             creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    redis = Redis(host='127.0.0.1', port=redis_port, db=8, protocol=2)
    try:
        for _ in range(50):
            try:
                if redis.ping():
                    break
            except Exception:
                time.sleep(.1)
        subprocess.run([*command, 'start', '-EnvFile', str(environment)], check=True)
        subprocess.run([*command, 'status'], check=True)
        with httpx.Client(base_url=f'http://127.0.0.1:{api_port}', timeout=10, trust_env=False) as client:
            assert client.get('/ready').json() == {'status': 'ready'}
            envelope(client.post('/api/user/login', json={'userAccount': 'windows_alice', 'userPassword': password}))
            task = envelope(client.post('/api/diagnosis/workflows', data={'idempotencyKey': 'windows-stock'},
                files={'file': ('invalid.png', b'invalid-image', 'image/png')}), status=202)['workflowId']
            deadline = time.monotonic() + 60
            while True:
                view = envelope(client.get('/api/diagnosis/workflows/' + task))
                if view['status'] == 'REJECTED':
                    break
                assert time.monotonic() < deadline
                time.sleep(.1)
            assert view['stopReasonCode'] == 'INVALID_IMAGE'
        report.update(status='PASS', workflowId=task, checks=['install-pinned-python', 'pwsh-api-worker-start-status-stop',
                       'real-mysql-redis-readiness', 'real-python-login', 'stock-worker-durable-task'])
    finally:
        subprocess.run([*command, 'stop'], check=True)
        redis.close()
        stop_child(child)
        (root / '.scratch/python-project-migration/evidence/issue06/windows-smoke.json').write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
