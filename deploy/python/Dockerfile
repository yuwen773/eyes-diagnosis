FROM python:3.11.14-slim-bookworm@sha256:65a93d69fa75478d554f4ad27c85c1e69fa184956261b4301ebaf6dbb0a3543d AS build
WORKDIR /build
COPY pyproject.toml MANIFEST.in ./
COPY algorithm/requirements-web.lock algorithm/requirements-web.lock
RUN python -m pip install --no-cache-dir setuptools==80.9.0 wheel==0.45.1 build==1.2.2.post1 uv==0.13.0
RUN --mount=type=cache,target=/root/.cache/uv uv pip install --prefix /install -r algorithm/requirements-web.lock
COPY algorithm/web algorithm/web
COPY algorithm/eye_diagnosis algorithm/eye_diagnosis
COPY algorithm/mcp_server algorithm/mcp_server
COPY algorithm/eye_disease_model.py algorithm/eye_disease_model.py
COPY deploy/python-migrations deploy/python-migrations
RUN python -m build --wheel --no-isolation --outdir /wheels

FROM python:3.11.14-slim-bookworm@sha256:65a93d69fa75478d554f4ad27c85c1e69fa184956261b4301ebaf6dbb0a3543d AS document-tool
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 TZ=Asia/Shanghai
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl libxinerama1 libxrender1 libxext6 libsm6 libcairo2 libcups2 \
    libdbus-1-3 libfontconfig1 libfreetype6 libglu1-mesa libnss3 libxslt1.1 libglib2.0-0 libx11-xcb1 fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*
COPY algorithm/web/doc_tool.py /tmp/doc_tool.py
ADD --checksum=sha256:fd0e8f8f2408dd2e5b90286e60f3f97cf566ba441cd48cfc5bcc68067303e0bc \
    https://download.documentfoundation.org/libreoffice/stable/26.2.6/deb/x86_64/LibreOffice_26.2.6_Linux_x86-64_deb.tar.gz \
    /tmp/libreoffice.tar.gz
RUN python /tmp/doc_tool.py --archive /tmp/libreoffice.tar.gz --home /opt/eye-doc \
    || (find /opt/eye-doc -name soffice.bin -exec ldd {} \; | grep 'not found'; exit 1)
RUN rm /tmp/libreoffice.tar.gz /tmp/doc_tool.py
ENV DOC_TOOL_HOME=/opt/eye-doc WEB_HOST=0.0.0.0 WEB_PORT=8080

FROM document-tool AS web
COPY --from=build /install /usr/local
RUN python -m pip check
COPY --from=build /wheels /wheels
RUN python -m pip install --no-deps --no-cache-dir /wheels/*.whl && rm -rf /wheels
RUN useradd --create-home --uid 10001 eye && mkdir /app && chown eye:eye /app
WORKDIR /app
USER eye
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=10s --retries=4 CMD ["eye-health"]
CMD ["eye-api"]

FROM web AS cpu
USER root
COPY algorithm/requirements-model-linux.lock /tmp/model-linux.lock
RUN --mount=type=cache,target=/root/.cache/uv \
    python -m pip install --no-cache-dir uv==0.13.0 \
    && uv pip install --system --require-hashes --torch-backend cpu -r /tmp/model-linux.lock \
    && python -m pip check && rm /tmp/model-linux.lock
COPY algorithm/checkpoints/registry.json /opt/eye-model/registry.json
COPY algorithm/configs/calibration/efficientnet_b4_temperature.json /opt/eye-model/efficientnet_b4_temperature.json
ENV MODEL_REGISTRY_PATH=/opt/eye-model/registry.json MODEL_CALIBRATION_PATH=/opt/eye-model/efficientnet_b4_temperature.json
USER eye
