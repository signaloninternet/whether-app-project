"""Geocoding (Photon / OpenStreetMap) and origin time zones (Open-Meteo)."""

from __future__ import annotations

from dataclasses import dataclass

from django.conf import settings
from django.core.cache import cache

from .geo import LatLon
from .http import UpstreamError, request_json

PHOTON = "Photon geocoding"
GEOCODE_CACHE_S = 24 * 3600


@dataclass(frozen=True)
class Place:
    name: str
    label: str
    lat: float
    lon: float
    kind: str

    def as_dict(self) -> dict:
        return {"name": self.name, "label": self.label, "lat": self.lat, "lon": self.lon, "kind": self.kind}


def _describe(props: dict) -> tuple[str, str]:
    """('Chicago', 'Illinois, United States') or ('Walmart', '1200 Main St, Springfield, ...')."""
    street = " ".join(filter(None, [props.get("housenumber"), props.get("street")]))
    name = props.get("name") or street or props.get("city") or props.get("county") or ""
    parts = [street, props.get("city"), props.get("state"), props.get("country")]
    detail = ", ".join(dict.fromkeys(p for p in parts if p and p != name))
    return name, detail


def _places(payload: dict) -> list[Place]:
    out: list[Place] = []
    seen: set[tuple[str, str]] = set()
    for feature in payload.get("features", []):
        props = feature.get("properties", {})
        lon, lat = feature["geometry"]["coordinates"]
        name, detail = _describe(props)
        if not name or (name, detail) in seen:
            continue
        seen.add((name, detail))
        out.append(Place(name=name, label=detail, lat=round(lat, 6), lon=round(lon, 6), kind=props.get("type", "place")))
    return out


def search(query: str, bias: LatLon | None = None, limit: int = 6) -> list[Place]:
    key = f"geo:v1:{query.lower()}:{bias and (round(bias[0], 1), round(bias[1], 1))}:{limit}"
    if (hit := cache.get(key)) is not None:
        return hit
    params: dict = {"q": query, "limit": limit + 2, "lang": "en"}
    if bias:
        params.update(lat=bias[0], lon=bias[1])
    _, payload = request_json(PHOTON, "GET", settings.GEOCODING["PHOTON_URL"].rstrip("/") + "/api/",
                              params=params, timeout=settings.GEOCODING["TIMEOUT_S"])
    places = _places(payload)[:limit]
    cache.set(key, places, GEOCODE_CACHE_S)
    return places


def reverse(point: LatLon) -> Place | None:
    key = f"rev:v1:{point[0]:.3f},{point[1]:.3f}"
    if (hit := cache.get(key)) is not None:
        return hit or None
    _, payload = request_json(PHOTON, "GET", settings.GEOCODING["PHOTON_URL"].rstrip("/") + "/reverse",
                              params={"lat": point[0], "lon": point[1], "lang": "en", "limit": 1},
                              timeout=settings.GEOCODING["TIMEOUT_S"])
    places = _places(payload)
    cache.set(key, places[0] if places else False, GEOCODE_CACHE_S)
    return places[0] if places else None


@dataclass(frozen=True)
class TimeZoneInfo:
    name: str
    abbreviation: str
    utc_offset_s: int

    def as_dict(self) -> dict:
        return {"name": self.name, "abbreviation": self.abbreviation, "utc_offset_s": self.utc_offset_s}


def timezone_at(point: LatLon) -> TimeZoneInfo:
    """IANA time zone for a coordinate (Open-Meteo resolves it with ``timezone=auto``)."""
    key = f"tz:v1:{point[0]:.2f},{point[1]:.2f}"
    if (hit := cache.get(key)) is not None:
        return hit
    url = settings.WEATHER["OPEN_METEO_URL"].rstrip("/") + "/v1/forecast"
    _, payload = request_json("Open-Meteo time zone", "GET", url, timeout=settings.WEATHER["TIMEOUT_S"],
                              params={"latitude": point[0], "longitude": point[1], "timezone": "auto",
                                      "current": "temperature_2m", "forecast_days": 1})
    if "timezone" not in payload:
        raise UpstreamError("Open-Meteo time zone", "no time zone in response")
    info = TimeZoneInfo(payload["timezone"], payload.get("timezone_abbreviation", ""),
                        int(payload.get("utc_offset_seconds", 0)))
    cache.set(key, info, 24 * 3600)
    return info
