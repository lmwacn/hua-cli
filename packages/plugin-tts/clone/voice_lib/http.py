from __future__ import annotations

import json
from pathlib import Path
import urllib.error
import urllib.request

from .errors import ApiError


class HttpClient:
    def __init__(self, timeout: float = 60):
        self.timeout = timeout

    def json_request(
        self,
        method: str,
        url: str,
        *,
        headers: dict[str, str] | None = None,
        payload: dict | None = None,
    ) -> dict:
        request_headers = {"Accept": "application/json", **(headers or {})}
        body = None
        if payload is not None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            request_headers.setdefault("Content-Type", "application/json")
        request = urllib.request.Request(url, data=body, headers=request_headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                raw = response.read().decode("utf-8")
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode("utf-8", errors="replace")
            try:
                detail = json.loads(raw)
            except Exception:
                detail = raw[:1000]
            raise ApiError(f"HTTP {exc.code}: {url}", status=exc.code, detail=detail) from exc
        except urllib.error.URLError as exc:
            raise ApiError(f"网络请求失败：{url}：{exc.reason}") from exc
        except json.JSONDecodeError as exc:
            raise ApiError(f"API 返回了非 JSON 响应：{url}") from exc

    def download(self, url: str, destination: Path) -> Path:
        request = urllib.request.Request(url, headers={"User-Agent": "digital-human/0.1"})
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                destination.parent.mkdir(parents=True, exist_ok=True)
                with destination.open("wb") as handle:
                    while chunk := response.read(1024 * 1024):
                        handle.write(chunk)
        except urllib.error.URLError as exc:
            raise ApiError(f"下载失败：{url}：{exc.reason}") from exc
        if not destination.exists() or destination.stat().st_size == 0:
            raise ApiError(f"下载结果为空：{destination}")
        return destination
