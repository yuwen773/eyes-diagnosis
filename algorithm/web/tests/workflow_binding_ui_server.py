"""Local issue06 UI fixture: real HTTP/graph/SQLite, synthetic sessions/model/COS."""

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from web.tests.chat_ui_server import app, DIRECTORY
from web.workflow.worker import Worker


@app.post("/fixture/run-worker")
def run_worker():
    engine = create_engine(f"sqlite:///{DIRECTORY / 'chat.db'}")
    try:
        worker = Worker(sessionmaker(engine, expire_on_commit=False))
        count = 0
        while worker.run_once():
            count += 1
            if count > 10:
                raise RuntimeError("Fixture exceeded segment limit")
        return {"segments": count}
    finally:
        engine.dispose()
