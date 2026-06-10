from __future__ import annotations

import io
import logging

from minio import Minio
from minio.error import S3Error

logger = logging.getLogger(__name__)


class ModelStore:
    def __init__(
        self,
        endpoint: str,
        access_key: str,
        secret_key: str,
        bucket: str,
        secure: bool = False,
    ) -> None:
        self._client = Minio(endpoint, access_key=access_key, secret_key=secret_key, secure=secure)
        self._bucket = bucket
        self._ensure_bucket()

    def _ensure_bucket(self) -> None:
        if not self._client.bucket_exists(self._bucket):
            self._client.make_bucket(self._bucket)
            logger.info("Created MinIO bucket: %s", self._bucket)

    def _key(self, symbol: str) -> str:
        return f"{symbol}/prophet_model.json"

    def save(self, symbol: str, json_str: str) -> None:
        data = json_str.encode()
        self._client.put_object(
            self._bucket,
            self._key(symbol),
            io.BytesIO(data),
            length=len(data),
            content_type="application/json",
        )
        logger.info("Saved model for %s to MinIO", symbol)

    def load(self, symbol: str) -> str | None:
        try:
            response = self._client.get_object(self._bucket, self._key(symbol))
            return response.read().decode()
        except S3Error as exc:
            if exc.code == "NoSuchKey":
                return None
            raise
