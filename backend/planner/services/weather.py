"""Hourly forecasts from Open-Meteo, sampled at the truck's arrival time.

Open-Meteo accepts many coordinates per request, so checkpoints (and heatmap
cells) are fetched in a handful of bulk calls and cached per location.
Units are requested in mph and inches, matching the risk thresholds.

Time semantics matter for a fair sample: wind is an instantaneous value at
each hour, but ``rain``/``showers``/``snowfall`` are totals for the hour
*ending* at the timestamp. A truck at a checkpoint at 14:00 or 14:20 is in
the 14:00-15:00 hour, so its precipitation comes from the 15:00 stamp, while
its wind is interpolated between the 14:00 and 15:00 values.
"""

from __future__ import annotations

import math
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime

from django.conf import settings
from django.core.cache import cache

from .geo import LatLon
from .http import UpstreamError, request_json

SERVICE = "Open-Meteo weather"
HOURLY_VARS = ("wind_speed_10m", "wind_gusts_10m", "rain", "showers", "snowfall", "temperature_2m", "weather_code")
CHUNK_SIZE = 50  # small chunks: one slow response only delays a third of the points
CACHE_SECONDS = 20 * 60
HOUR = 3600

# WMO weather interpretation codes (Open-Meteo docs), grouped for display.
WMO_CONDITIONS = {
    0: "Clear", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
    45: "Fog", 48: "Freezing fog",
    51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle", 56: "Freezing drizzle", 57: "Freezing drizzle",
    61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain", 67: "Freezing rain",
    71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains",
    80: "Rain showers", 81: "Rain showers", 82: "Violent rain showers",
    85: "Snow showers", 86: "Heavy snow showers",
    95: "Thunderstorm", 96: "Thunderstorm with hail", 99: "Thunderstorm with hail",
}


def floor_hour(epoch: float) -> int:
    return int(epoch // HOUR * HOUR)


def iso_utc(epoch: float) -> str:
    return datetime.fromtimestamp(epoch, UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


@dataclass(frozen=True)
class WeatherSample:
    wind_mph: float
    gust_mph: float | None
    rain_in_hr: float
    snow_in_hr: float
    temp_f: float | None
    code: int | None
    hour_start: int  # epoch of the forecast hour the sample represents

    def as_dict(self) -> dict:
        return {
            "wind_mph": round(self.wind_mph, 1),
            "gust_mph": None if self.gust_mph is None else round(self.gust_mph, 1),
            "rain_in_hr": round(self.rain_in_hr, 3),
            "snow_in_hr": round(self.snow_in_hr, 3),
            "temp_f": None if self.temp_f is None else round(self.temp_f, 1),
            "code": self.code,
            "condition": WMO_CONDITIONS.get(self.code, "Unknown") if self.code is not None else "Unknown",
            "hour_utc": iso_utc(self.hour_start),
        }


def _lerp(a: float | None, b: float | None, t: float) -> float | None:
    if a is None or b is None:
        return b if a is None else a  # one side missing: use the other
    return a + (b - a) * t


@dataclass(frozen=True)
class HourlyForecast:
    """Hourly series for one location, starting at ``start`` (UTC epoch)."""

    start: int
    wind: tuple[float | None, ...]
    gust: tuple[float | None, ...]
    rain: tuple[float | None, ...]  # rain + showers, in/hr
    snow: tuple[float | None, ...]  # in/hr
    temp: tuple[float | None, ...]
    code: tuple[int | None, ...]

    @property
    def end(self) -> int:
        return self.start + (len(self.wind) - 1) * HOUR

    def at(self, epoch: float) -> WeatherSample | None:
        """Conditions a truck meets at ``epoch`` (None if outside the series or missing)."""
        if not self.wind or epoch < self.start or epoch > self.end:
            return None
        pos = (epoch - self.start) / HOUR
        h0 = int(math.floor(pos))
        h1 = min(h0 + 1, len(self.wind) - 1)  # also the precip stamp for the hour starting at h0
        frac = pos - h0
        wind = _lerp(self.wind[h0], self.wind[h1], frac)
        rain, snow = self.rain[h1], self.snow[h1]
        if wind is None or rain is None or snow is None:
            return None
        return WeatherSample(
            wind_mph=wind,
            gust_mph=_lerp(self.gust[h0], self.gust[h1], frac),
            rain_in_hr=rain,
            snow_in_hr=snow,
            temp_f=_lerp(self.temp[h0], self.temp[h1], frac),
            code=self.code[h1],
            hour_start=self.start + h0 * HOUR,
        )

    def frame(self, i: int) -> tuple[float | None, float | None, float | None]:
        """(wind, rain, snow) for the hour beginning at ``start + i h`` (heatmap frames)."""
        hp = min(i + 1, len(self.wind) - 1)
        return self.wind[i], self.rain[hp], self.snow[hp]


def snap(point: LatLon, resolution_deg: float) -> LatLon:
    return (round(round(point[0] / resolution_deg) * resolution_deg, 4),
            round(round(point[1] / resolution_deg) * resolution_deg, 4))


def snap_all(points: list[LatLon], max_unique: int) -> list[LatLon]:
    """Snap to the finest grid (>= ~3 km) that keeps the unique locations under budget.

    Forecast models are gridded (HRRR 3 km, GFS ~13-25 km), so nearby
    checkpoints legitimately share a forecast; this keeps a cross-country
    plan inside Open-Meteo's free-tier limits.
    """
    for res in (0.03, 0.05, 0.1, 0.15, 0.2, 0.25, 0.35, 0.5, 0.75, 1.0):
        snapped = [snap(p, res) for p in points]
        if len(set(snapped)) <= max_unique:
            return snapped
    return snapped


def _endpoint() -> tuple[str, dict]:
    key = settings.WEATHER["OPEN_METEO_API_KEY"]
    base = settings.WEATHER["OPEN_METEO_URL"].rstrip("/")
    if key and base == "https://api.open-meteo.com":
        base = "https://customer-api.open-meteo.com"
    return f"{base}/v1/forecast", ({"apikey": key} if key else {})


def _fmt_hour(epoch: int) -> str:
    return datetime.fromtimestamp(epoch, UTC).strftime("%Y-%m-%dT%H:%M")


def _fetch_chunk(points: list[LatLon], start: int, end: int) -> list[HourlyForecast]:
    url, auth = _endpoint()
    params = {
        **auth,
        "latitude": ",".join(f"{p[0]:.4f}" for p in points),
        "longitude": ",".join(f"{p[1]:.4f}" for p in points),
        "hourly": ",".join(HOURLY_VARS),
        "wind_speed_unit": "mph",
        "precipitation_unit": "inch",
        "temperature_unit": "fahrenheit",
        "timezone": "GMT",
        "timeformat": "unixtime",
        "start_hour": _fmt_hour(start),
        "end_hour": _fmt_hour(end),
    }
    _, payload = request_json(SERVICE, "GET", url, params=params, timeout=settings.WEATHER["TIMEOUT_S"],
                              accept_status=(200, 400))
    if isinstance(payload, dict) and payload.get("error"):
        raise UpstreamError(SERVICE, payload.get("reason", "rejected the request"))
    results = payload if isinstance(payload, list) else [payload]
    if len(results) != len(points):
        raise UpstreamError(SERVICE, "returned an unexpected number of locations")
    return [_parse(r) for r in results]


def _parse(result: dict) -> HourlyForecast:
    hourly = result["hourly"]
    rain = tuple(
        None if r is None and s is None else (r or 0.0) + (s or 0.0)
        for r, s in zip(hourly["rain"], hourly["showers"])
    )
    return HourlyForecast(
        start=int(hourly["time"][0]),
        wind=tuple(hourly["wind_speed_10m"]),
        gust=tuple(hourly["wind_gusts_10m"]),
        rain=rain,
        snow=tuple(hourly["snowfall"]),
        temp=tuple(hourly["temperature_2m"]),
        code=tuple(hourly["weather_code"]),
    )


def fetch_forecasts(points: list[LatLon], start_epoch: float, end_epoch: float) -> dict[LatLon, HourlyForecast]:
    """Hourly series for each distinct point, covering every hour that starts in [start, end]."""
    start, end = floor_hour(start_epoch), floor_hour(end_epoch) + HOUR
    unique = list(dict.fromkeys(points))
    keys = {p: f"wx:v1:{p[0]:.4f},{p[1]:.4f}:{start}:{end}" for p in unique}
    cached = cache.get_many(list(keys.values()))
    found = {p: cached[k] for p, k in keys.items() if k in cached}
    missing = [p for p in unique if p not in found]

    if missing:
        chunks = [missing[i:i + CHUNK_SIZE] for i in range(0, len(missing), CHUNK_SIZE)]
        with ThreadPoolExecutor(max_workers=4) as pool:
            for chunk, series in zip(chunks, pool.map(lambda c: _fetch_chunk(c, start, end), chunks)):
                found.update(zip(chunk, series))
        cache.set_many({keys[p]: found[p] for p in missing}, CACHE_SECONDS)
    if settings.WEATHER.get("SIMULATE_STORM"):
        from . import storm_sim

        return {p: storm_sim.apply(p, series) for p, series in found.items()}
    return found
