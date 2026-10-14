"""Real loopback HTTPS + official MCP server; controlled model and Java identity."""

import hashlib
import ipaddress
import json
import socket
import ssl
import threading
import time
from datetime import datetime, timedelta, timezone

import httpx
import pytest
import uvicorn
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations

from web.tests.test_chat import chat, chat_api
from web.tests.test_history_retrieval import tool_stream
from web.tests.test_mcp_chat import CODE, server


@pytest.fixture(params=["SSE", "STREAMABLE_HTTP"])
def https_mcp(request, tmp_path):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "controlled-loopback")])
    now = datetime.now(timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
        .serial_number(x509.random_serial_number()).not_valid_before(now - timedelta(minutes=1))
        .not_valid_after(now + timedelta(days=1)).add_extension(
            x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address("127.0.0.1"))]), critical=False)
        .sign(key, hashes.SHA256()))
    cert_path, key_path = tmp_path / "cert.pem", tmp_path / "key.pem"
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    key_path.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                          serialization.NoEncryption()))
    mcp = FastMCP("controlled HTTPS", json_response=True)
    calls = []

    @mcp.tool(annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False))
    def lookup(query: str) -> str:
        calls.append(query)
        return "controlled HTTPS reference: " + query

    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    app = mcp.sse_app() if request.param == "SSE" else mcp.streamable_http_app()
    service = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port,
        ssl_certfile=str(cert_path), ssl_keyfile=str(key_path), log_level="error"))
    thread = threading.Thread(target=service.run, kwargs={"sockets": [sock]}, daemon=True)
    thread.start()
    deadline = time.monotonic() + 10
    try:
        while not service.started and thread.is_alive() and time.monotonic() < deadline:
            time.sleep(0.02)
        assert service.started, "controlled HTTPS MCP did not start"
        origin = f"https://127.0.0.1:{port}"
        yield origin, request.param, ssl.create_default_context(cafile=str(cert_path)), calls
    finally:
        service.should_exit = True
        thread.join(timeout=10)
        sock.close()
        assert not thread.is_alive(), "controlled MCP did not stop"


def test_chat_discovers_and_invokes_over_real_https_mcp(chat_api, https_mcp):
    build, _ = chat_api
    origin, transport, tls, calls = https_mcp
    endpoint = origin + ("/sse" if transport == "SSE" else "/mcp")
    alias = "mcp_" + hashlib.sha256(f"{CODE}/lookup".encode()).hexdigest()[:32]
    client = build(lambda request: tool_stream('{"query":"retina"}', name=alias),
                   seed=lambda db: db.add(server(url=endpoint, transport=transport)))
    client.app.state.config.mcp_allowed_origins = origin
    client.app.state.config.mcp_readonly_tools = f"{CODE}/lookup"
    client.app.state.mcp_transport = httpx.AsyncHTTPTransport(verify=tls)
    response = chat(client, "https", "受控网络调用", enabledMcpServers=[CODE])
    assert "event: done" in response.text, response.text
    assert "SUCCEEDED" in response.text and "controlled HTTPS reference: retina" in response.text
    assert calls == ["retina"]
