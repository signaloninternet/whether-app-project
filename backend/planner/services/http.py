"""One pooled HTTP session for every upstream API, plus typed failures."""

from __future__ import annotations

import logging
import threading
from typing import Any

import requests
from django.conf import settings
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

log = logging.getLogger(__name__)


class UpstreamError(Exception):
    """A third-party service failed or returned something unusable."""

    status_code = 502

    def __init__(self, service: str, message: str):
        super().__init__(f"{service}: {message}")
        self.service = service
        self.message = message


class UpstreamRateLimited(UpstreamError):
    status_code = 503


_local = threading.local()


def session() -> requests.Session:
    """Thread-local session (requests.Session is not guaranteed thread-safe)."""
    s = getattr(_local, "session", None)
    if s is None:
        s = requests.Session()
        retry = Retry(
            total=1,
            backoff_factor=0.5,
            status_forcelist=(500, 502, 503, 504),
            allowed_methods=frozenset({"GET", "POST"}),
            raise_on_status=False,
        )
        adapter = HTTPAdapter(max_retries=retry, pool_connections=8, pool_maxsize=16)
        s.mount("https://", adapter)
        s.mount("http://", adapter)
        s.headers["User-Agent"] = settings.HTTP_USER_AGENT
        _local.session = s
    return s


def request_json(
    service: str,
    method: str,
    url: str,
    *,
    timeout: float,
    params: dict[str, Any] | None = None,
    json: Any = None,
    accept_status: tuple[int, ...] = (200,),
) -> tuple[int, Any]:
    """Perform a request and decode JSON, mapping transport errors to UpstreamError.

    Returns ``(status, payload)`` so callers can interpret documented error
    bodies (e.g. Valhalla's 400s) themselves via ``accept_status``.
    """
    try:
        resp = session().request(method, url, params=params, json=json, timeout=timeout)
    except requests.Timeout as exc:
        raise UpstreamError(service, "timed out") from exc
    except requests.RequestException as exc:
        log.warning("%s request failed: %s", service, exc)
        raise UpstreamError(service, "unreachable") from exc

    if resp.status_code == 429:
        raise UpstreamRateLimited(service, "rate limit reached, try again in a minute")
    if resp.status_code not in accept_status:
        log.warning("%s HTTP %s: %s", service, resp.status_code, resp.text[:300])
        raise UpstreamError(service, f"HTTP {resp.status_code}")
    try:
        return resp.status_code, resp.json()
    except ValueError as exc:
        raise UpstreamError(service, "returned invalid JSON") from exc
