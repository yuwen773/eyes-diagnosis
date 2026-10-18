import json
import os
import time
from sqlalchemy import create_engine, text

engine = create_engine(os.environ['WORKER_TEST_MYSQL_URL'])
schema = engine.url.database
assert schema.startswith('eye_worker_issue16_')
for _ in range(15):
    with engine.connect() as db:
        rows = db.execute(text('SELECT OBJECT_NAME,INDEX_NAME,LOCK_TYPE,LOCK_MODE,LOCK_STATUS,LOCK_DATA '
                               'FROM performance_schema.data_locks WHERE OBJECT_SCHEMA=:schema'), {'schema': schema}).mappings().all()
        if any(row['LOCK_STATUS'] == 'WAITING' for row in rows):
            print(json.dumps([dict(row) for row in rows], indent=2), flush=True)
            break
    time.sleep(1)
engine.dispose()
