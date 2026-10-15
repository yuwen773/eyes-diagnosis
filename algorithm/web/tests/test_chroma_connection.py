"""Real Chroma IO: configured scheme must not discard a separate server port."""

import os
import socket
import subprocess
import sys

import pytest

from web.config import WebConfig
from web.knowledge import ChunkPayload
from web.vectorstore import ChromaWriter
from web.verify_real_services import stop_child, wait_http


@pytest.fixture(scope="module")
def chroma_server(tmp_path_factory):
    directory = tmp_path_factory.mktemp("chroma-connection")
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    with (directory / "server.log").open("wb") as log:
        process = subprocess.Popen([sys.executable, "-c", "from chromadb.cli.cli import app; app()",
            "run", "--host", "127.0.0.1", "--port", str(port), "--path", str(directory / "data")],
            stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        try:
            wait_http(process, f"http://127.0.0.1:{port}/api/v2/heartbeat")
            yield port
        finally:
            stop_child(process)


@pytest.mark.parametrize("host", ["http://127.0.0.1", "127.0.0.1"])
def test_writer_uses_configured_port_and_reads_back_real_vectors(chroma_server, host):
    writer = ChromaWriter(WebConfig(chroma_host=host, chroma_port=chroma_server,
        chroma_collection="connection-" + ("scheme" if "://" in host else "hostname")))
    writer.add([ChunkPayload(id="doc_7_chunk_0", text="Known source excerpt", metadata={"documentId": 7})], [[1.0, 0.0]])
    result = writer.query([[1.0, 0.0]], [7])
    assert result["documents"] == [["Known source excerpt"]]
    assert result["ids"] == [["doc_7_chunk_0"]]
    writer.delete(["doc_7_chunk_0"])
    assert writer.query([[1.0, 0.0]], [7])["ids"] == [[]]
