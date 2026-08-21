from __future__ import annotations

import asyncio
import email.utils
import logging
import random
import time
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any

import httpx

logger = logging.getLogger(__name__)


class SourceHttpClient:
    def __init__(
        self,
        *,
        headers: dict[str, str] | None = None,
        timeout_seconds: float = 30.0,
        max_retries: int = 4,
        requests_per_second: float | None = None,
    ) -> None:
        self._client = httpx.AsyncClient(
            headers=headers,
            timeout=httpx.Timeout(timeout_seconds),
            follow_redirects=True,
        )
        self._max_retries = max_retries
        self._min_interval = 1.0 / requests_per_second if requests_per_second else 0.0
        self._last_request_at = 0.0
        self._rate_lock = asyncio.Lock()

    async def __aenter__(self) -> SourceHttpClient:
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        await self._client.aclose()

    async def _throttle(self) -> None:
        if self._min_interval <= 0:
            return
        async with self._rate_lock:
            now = time.monotonic()
            delay = self._last_request_at + self._min_interval - now
            if delay > 0:
                await asyncio.sleep(delay)
            self._last_request_at = time.monotonic()

    @staticmethod
    def _retry_after(response: httpx.Response) -> float | None:
        header = response.headers.get("Retry-After")
        if not header:
            return None
        try:
            return max(0.0, float(header))
        except ValueError:
            try:
                target = email.utils.parsedate_to_datetime(header)
            except (TypeError, ValueError):
                return None
            if target.tzinfo is None:
                target = target.replace(tzinfo=UTC)
            return max(0.0, (target - datetime.now(UTC)).total_seconds())

    async def request(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        last_error: Exception | None = None
        for attempt in range(self._max_retries + 1):
            await self._throttle()
            try:
                response = await self._client.request(method, url, **kwargs)
            except (httpx.TimeoutException, httpx.NetworkError) as exc:
                last_error = exc
                if attempt >= self._max_retries:
                    raise
                delay = min(30.0, (2**attempt) + random.random())
                logger.warning("HTTP transport retry url=%s attempt=%s delay=%.2f error=%s", url, attempt + 1, delay, exc)
                await asyncio.sleep(delay)
                continue

            if response.status_code not in {429, 500, 502, 503, 504}:
                response.raise_for_status()
                return response

            if attempt >= self._max_retries:
                response.raise_for_status()
            delay = self._retry_after(response)
            if delay is None:
                delay = min(60.0, (2**attempt) + random.random())
            logger.warning("HTTP status retry url=%s status=%s attempt=%s delay=%.2f", url, response.status_code, attempt + 1, delay)
            await asyncio.sleep(delay)

        if last_error:
            raise last_error
        raise RuntimeError(f"Request failed without response: {url}")

    async def get_json(self, url: str, *, params: dict[str, Any] | None = None) -> dict[str, Any]:
        response = await self.request("GET", url, params=params)
        payload = response.json()
        if not isinstance(payload, dict):
            raise ValueError(f"Expected object JSON from {url}")
        return payload

    async def get_text(
        self,
        url: str,
        *,
        params: dict[str, Any] | None = None,
        max_bytes: int | None = None,
    ) -> str:
        for attempt in range(self._max_retries + 1):
            await self._throttle()
            try:
                async with self._client.stream("GET", url, params=params) as response:
                    if response.status_code in {429, 500, 502, 503, 504}:
                        if attempt >= self._max_retries:
                            response.raise_for_status()
                        delay = self._retry_after(response)
                        if delay is None:
                            delay = min(60.0, (2**attempt) + random.random())
                    else:
                        response.raise_for_status()
                        chunks: list[bytes] = []
                        size = 0
                        async for chunk in response.aiter_bytes():
                            size += len(chunk)
                            if max_bytes is not None and size > max_bytes:
                                raise ValueError(f"Response exceeds {max_bytes} bytes: {url}")
                            chunks.append(chunk)
                        content = b"".join(chunks)
                        encoding = response.encoding or "utf-8"
                        return content.decode(encoding, errors="replace")
            except (httpx.TimeoutException, httpx.NetworkError) as exc:
                if attempt >= self._max_retries:
                    raise
                delay = min(30.0, (2**attempt) + random.random())
                logger.warning(
                    "HTTP stream retry url=%s attempt=%s delay=%.2f error=%s",
                    url,
                    attempt + 1,
                    delay,
                    exc,
                )
            logger.warning("HTTP stream status retry url=%s attempt=%s delay=%.2f", url, attempt + 1, delay)
            await asyncio.sleep(delay)
        raise RuntimeError(f"Text request failed without response: {url}")

    async def stream_lines(self, url: str, *, params: dict[str, Any] | None = None) -> AsyncIterator[str]:
        await self._throttle()
        async with self._client.stream("GET", url, params=params) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                yield line
