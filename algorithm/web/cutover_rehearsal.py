"""Opt-in isolated Nginx rehearsal using the issue19 real-service harness."""

import hashlib
import json
from pathlib import Path
import subprocess

import httpx

from web.cutover import ROOT, render
from web.verify_real_services import envelope, free_port, stop_child, wait_http


class Proxy:
    def __init__(self, nginx: str, runtime: Path, java_port: int, python_port: int):
        self.nginx, self.runtime = nginx, runtime / "proxy"
        self.java_port, self.python_port = java_port, python_port
        self.port = free_port()
        self.child: subprocess.Popen | None = None
        self.runtime.mkdir()
        for name in ("logs", "temp", "client_temp", "proxy_temp"):
            (self.runtime / name).mkdir()

    def switch(self, business: str, agent: str, policy: str) -> None:
        content = render(business=business, agent=agent, workflows=policy,
            listen_port=self.port, java_port=self.java_port, python_port=self.python_port,
            frontend=ROOT / "frontend/dist", runtime=self.runtime)
        config = self.runtime / "nginx.conf"
        # Rehearsal intentionally restarts this runner's isolated proxy only.
        # Operational hot reload is documented separately in the runbook.
        self.close()
        config.write_text(content, encoding="utf-8")
        command = [self.nginx, "-p", self.runtime.as_posix() + "/", "-c", config.as_posix()]
        checked = subprocess.run([*command, "-t"], capture_output=True, timeout=15)
        (self.runtime / "syntax.log").write_bytes(checked.stdout + checked.stderr)
        assert checked.returncode == 0, "Nginx syntax failed; inspect private log"
        self.child = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0)
        wait_http(self.child, f"http://127.0.0.1:{self.port}/health")

    def close(self) -> None:
        if self.child is not None:
            stop_child(self.child)
            self.child = None

    def preserve_wait(self, client: httpx.Client, path: str, report: dict) -> None:
        before = envelope(client.get(path))
        self.switch("java", "java", "pause")
        after = envelope(client.get(path))
        assert after == before
        assert client.post(path, json={}).status_code == 503
        assert client.post("/api/diagnosis/workflows").status_code == 503
        assert client.get("/api/python-recovery/sessions").status_code == 200
        self.switch("java", "python", "drain")
        assert envelope(client.get(path)) == before
        assert client.post("/api/diagnosis/workflows").status_code == 503
        assert client.post("/api/agent/chat/stream", json={}).status_code == 503
        digest = hashlib.sha256(json.dumps(before, sort_keys=True).encode()).hexdigest()
        kind = "save" if "save-confirmation" in path else "supplement" if "supplements" in path else "review"
        report.setdefault("cutoverWaits", []).append({"kind": kind,
            "beforeSha256": digest, "afterSha256": hashlib.sha256(json.dumps(after, sort_keys=True).encode()).hexdigest(), "pauseWriteStatus": 503})
        self.switch("python", "python", "active")
        assert envelope(client.get(path)) == before

    def verify_supplement(self, client: httpx.Client, workflow_id: str, report: dict) -> None:
        from web.tests.test_chat_workflow import workflow_event
        from web.tests.test_supplement import supplement_event

        thread = "issue20-supplement"
        workflow_event(client.post("/api/agent/chat/stream", json={"threadId": thread,
            "message": "", "diagnosis": {"workflowId": workflow_id}}))
        waiting = supplement_event(client.post("/api/agent/chat/stream", json={"threadId": thread,
            "message": "Synthetic supplement", "supplement": {"workflowId": workflow_id, "idempotencyKey": "cutover-wait"}}))
        path = "/api/agent/supplements/" + waiting["requestId"]
        self.preserve_wait(client, path, report)
        original = envelope(client.get("/api/diagnosis/workflows/" + workflow_id))
        self.switch("java", "java", "drain")
        reply = {"sessionId": thread, "workflowId": workflow_id,
            "expectedVersion": waiting["version"], "text": "Synthetic continuation"}
        recovered_path = "/api/python-recovery/supplements/" + waiting["requestId"] + "/reply"
        answered = envelope(client.post(recovered_path, json=reply))
        assert answered["status"] == "ANSWERED"
        assert envelope(client.post(recovered_path, json=reply)) == answered
        assert envelope(client.get("/api/diagnosis/workflows/" + workflow_id)) == original
        self.switch("python", "python", "active")
        report["checks"].append("supplement-wait-survives-rollback-drain-reply-replays-without-clinical-write")

    def verify_agent_rollback(self, client: httpx.Client, report: dict) -> None:
        before = envelope(client.get("/api/agent/history/issue19-chat-0"))
        self.switch("java", "java", "pause")
        assert envelope(client.get("/api/python-recovery/history/issue19-chat-0")) == before
        assert client.post("/api/python-recovery/chat/stream", json={}).status_code == 503
        self.switch("python", "python", "active")
        assert envelope(client.get("/api/agent/history/issue19-chat-0")) == before
        report["checks"].append("nginx-independent-business-agent-routes-pause-drain-and-python-history-recovery")
