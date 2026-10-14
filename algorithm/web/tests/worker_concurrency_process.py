"""Run the production Worker in a separate process with a controlled engine.

Only test code loads this module; no fault injection routes or adapters are
installed into the production API/Worker entry point.
"""

import argparse
import os
from pathlib import Path
import time

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from web.config import WebConfig
from web.tests.test_workflow_inference import ControlledEngine, prediction
from web.workflow.inference import WorkflowInference
from web.workflow.worker import Worker


def wait_for_release(gate: Path | None):
    if gate:
        gate.with_suffix(".started").touch()
        deadline = time.monotonic() + 30
        while not gate.with_suffix(".release").exists():
            if time.monotonic() >= deadline:
                raise TimeoutError("controlled adapter gate timed out")
            time.sleep(.02)


class GatedEngine(ControlledEngine):
    def __init__(self, gate: Path | None, mode: str):
        super().__init__(prediction(predicted_label="normal" if mode == "normal" else "glaucoma"))
        self.gate, self.mode = gate, mode

    def diagnose(self, image, content_type=None):
        if not self.mode.startswith("retrieval-"):
            wait_for_release(self.gate)
        if self.mode == "timeout":
            raise TimeoutError("controlled model timeout")
        return super().diagnose(image, content_type)


def main():
    parser = argparse.ArgumentParser(__doc__)
    parser.add_argument("--gate", type=Path)
    parser.add_argument("--mode", choices=["normal", "glaucoma", "timeout", "retrieval-timeout", "retrieval-empty"], default="normal")
    parser.add_argument("--lease-seconds", type=int, default=30)
    args = parser.parse_args()
    if args.mode.startswith("retrieval-"):
        from web import evidence

        def controlled_query(*query_args, **kwargs):
            wait_for_release(args.gate)
            if args.mode == "retrieval-timeout":
                raise TimeoutError("controlled retrieval timeout")
            return {key: [[]] for key in ("ids", "documents", "metadatas", "distances")}

        evidence.query_chunks = controlled_query
    url = os.environ["WORKER_TEST_DATABASE_URL"]
    engine = create_engine(url, connect_args={"init_command": "SET time_zone = '+08:00'"}
                           if url.startswith("mysql") else {})
    try:
        worker = Worker(sessionmaker(engine, autoflush=False, expire_on_commit=False),
                        lease_seconds=args.lease_seconds,
                        inference=WorkflowInference(WebConfig(), engine=GatedEngine(args.gate, args.mode)))
        print("worked" if worker.run_once() else "idle", flush=True)
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
