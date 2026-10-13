"""COS storage boundary and persisted attachment ownership (never trust URL prefixes)."""

import asyncio
from typing import Protocol

from fastapi import Depends

from web.config import WebConfig
from web.deps import config_from_request
from web.files import build_upload_path


class AttachmentStore(Protocol):
    async def put(self, data: bytes, name: str, user_id: int) -> str: ...
    async def delete(self, url: str) -> None: ...


class CosAttachmentStore:
    def __init__(self, config: WebConfig):
        self.config = config

    def client(self):
        import qcloud_cos

        return qcloud_cos.COSClient(qcloud_cos.CosConfig(Region=self.config.cos_region,
            SecretId=self.config.cos_secret_id, SecretKey=self.config.cos_secret_key))

    async def put(self, data: bytes, name: str, user_id: int) -> str:
        if not self.config.cos_host.startswith("https://"):
            raise RuntimeError("COS host must be configured with HTTPS")
        key = build_upload_path(f"agent-chat/{user_id}", name).lstrip("/")
        await asyncio.to_thread(self.client().put_object, Bucket=self.config.cos_bucket, Key=key, Body=data)
        return f"{self.config.cos_host.rstrip('/')}/{key}"

    async def delete(self, url: str) -> None:
        prefix = self.config.cos_host.rstrip("/") + "/"
        if not url.startswith(prefix):
            raise ValueError("attachment storage host has changed")
        await asyncio.to_thread(self.client().delete_object, Bucket=self.config.cos_bucket, Key=url[len(prefix):])


def attachment_store(config: WebConfig = Depends(config_from_request)) -> AttachmentStore:
    return CosAttachmentStore(config)
