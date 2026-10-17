FROM eye-python:ticket06
USER root
RUN apt-get update && apt-get install -y --no-install-recommends redis-server \
    && rm -rf /var/lib/apt/lists/* \
    && python -m pip install --no-cache-dir uv==0.13.0
WORKDIR /workspace
COPY pyproject.toml MANIFEST.in ./
COPY README.md AGENTS.md ./
COPY docs/python-delivery.md docs/python-delivery.md
COPY deploy/python/Dockerfile deploy/python/Verify.Dockerfile deploy/python/Frontend.Dockerfile deploy/python/
COPY algorithm/requirements-web.lock algorithm/requirements-web.lock
COPY algorithm/web algorithm/web
COPY algorithm/eye_diagnosis algorithm/eye_diagnosis
COPY algorithm/mcp_server algorithm/mcp_server
COPY algorithm/eye_disease_model.py algorithm/eye_disease_model.py
COPY algorithm/grpc_server.py algorithm/grpc_server.py
COPY algorithm/checkpoints/registry.json algorithm/checkpoints/registry.json
COPY algorithm/configs algorithm/configs
COPY deploy/python-migrations deploy/python-migrations
COPY deploy/nginx.conf deploy/nginx.conf
COPY deploy/mime.types deploy/mime.types
COPY deploy/snippets deploy/snippets
COPY contracts contracts
COPY scripts scripts
COPY frontend/src frontend/src
COPY frontend/package.json frontend/package.json
ENV PYTHONPATH=/workspace/algorithm DOC_TOOL_HOME=/opt/eye-doc
HEALTHCHECK NONE
CMD ["python", "scripts/verify.py", "web"]
