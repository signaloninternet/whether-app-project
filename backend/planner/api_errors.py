"""Every error leaves the API as ``{"error": {"code", "message", ...}}``."""

from __future__ import annotations

import logging

from rest_framework import exceptions, status
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler

from .services.http import UpstreamError, UpstreamRateLimited
from .services.routing import RoutingError

log = logging.getLogger(__name__)


def _first_message(detail) -> str:
    if isinstance(detail, dict):
        key, value = next(iter(detail.items()))
        message = _first_message(value)
        return message if key == "non_field_errors" else f"{key.replace('_', ' ').capitalize()}: {message}"
    if isinstance(detail, list) and detail:
        return _first_message(detail[0])
    return str(detail)


def error(code: str, message: str, http_status: int, **extra) -> Response:
    return Response({"error": {"code": code, "message": message, **extra}}, status=http_status)


def exception_handler(exc, context):
    if isinstance(exc, RoutingError):
        return error("no_route", exc.message, exc.status_code)
    if isinstance(exc, UpstreamRateLimited):
        return error("upstream_busy", f"{exc.service} is busy ({exc.message}).", exc.status_code, service=exc.service)
    if isinstance(exc, UpstreamError):
        return error("upstream_unavailable", f"{exc.service} is unavailable right now ({exc.message}). Please retry.",
                     exc.status_code, service=exc.service)
    if isinstance(exc, exceptions.ValidationError):
        return error("invalid", _first_message(exc.detail), status.HTTP_400_BAD_REQUEST, fields=exc.detail)
    if isinstance(exc, exceptions.Throttled):
        wait = f" Try again in {int(exc.wait)} s." if exc.wait else ""
        return error("rate_limited", "Too many requests." + wait, status.HTTP_429_TOO_MANY_REQUESTS)

    response = drf_exception_handler(exc, context)
    if response is not None:
        return error("request_failed", _first_message(response.data), response.status_code)
    log.exception("Unhandled API error", exc_info=exc)
    return error("server_error", "Something went wrong on our side.", status.HTTP_500_INTERNAL_SERVER_ERROR)
