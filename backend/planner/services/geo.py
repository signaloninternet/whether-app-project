"""Small, dependency-free geodesy helpers.

Coordinates are ``(lat, lon)`` tuples in degrees throughout the backend. Route
lines carry a parallel ``cum_m`` list (cumulative metres at each vertex) so
positions can be looked up by distance with a binary search.
"""

from __future__ import annotations

import math
from bisect import bisect_right
from collections.abc import Sequence
from datetime import UTC, datetime

LatLon = tuple[float, float]

EARTH_RADIUS_M = 6_371_008.8
METERS_PER_MILE = 1609.344
WEB_MERCATOR_MAX_LAT = 85.051_128_78


def haversine_m(a: LatLon, b: LatLon) -> float:
    lat1, lon1 = map(math.radians, a)
    lat2, lon2 = map(math.radians, b)
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(h)))


def initial_bearing_deg(a: LatLon, b: LatLon) -> float:
    lat1, lon1 = map(math.radians, a)
    lat2, lon2 = map(math.radians, b)
    dlon = lon2 - lon1
    x = math.sin(dlon) * math.cos(lat2)
    y = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlon)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def destination_point(origin: LatLon, bearing_deg: float, distance_m: float) -> LatLon:
    lat1, lon1 = map(math.radians, origin)
    brg = math.radians(bearing_deg)
    d = distance_m / EARTH_RADIUS_M
    lat2 = math.asin(math.sin(lat1) * math.cos(d) + math.cos(lat1) * math.sin(d) * math.cos(brg))
    lon2 = lon1 + math.atan2(math.sin(brg) * math.sin(d) * math.cos(lat1), math.cos(d) - math.sin(lat1) * math.sin(lat2))
    return math.degrees(lat2), (math.degrees(lon2) + 540) % 360 - 180


def great_circle_midpoint(a: LatLon, b: LatLon) -> LatLon:
    return destination_point(a, initial_bearing_deg(a, b), haversine_m(a, b) / 2)


# --- encoded polylines (Google algorithm; Valhalla/OSRM use precision 6) -----

def decode_polyline(encoded: str, precision: int = 6) -> list[LatLon]:
    factor = 10**precision
    coords: list[LatLon] = []
    index = lat = lon = 0
    length = len(encoded)
    while index < length:
        deltas = []
        for _ in range(2):
            shift = result = 0
            while True:
                byte = ord(encoded[index]) - 63
                index += 1
                result |= (byte & 0x1F) << shift
                shift += 5
                if byte < 0x20:
                    break
            deltas.append(~(result >> 1) if result & 1 else result >> 1)
        lat += deltas[0]
        lon += deltas[1]
        coords.append((lat / factor, lon / factor))
    return coords


def encode_polyline(coords: Sequence[LatLon], precision: int = 5) -> str:
    factor = 10**precision
    out: list[str] = []
    prev_lat = prev_lon = 0
    for lat, lon in coords:
        ilat, ilon = round(lat * factor), round(lon * factor)
        for delta in (ilat - prev_lat, ilon - prev_lon):
            value = ~(delta << 1) if delta < 0 else delta << 1
            while value >= 0x20:
                out.append(chr((0x20 | (value & 0x1F)) + 63))
                value >>= 5
            out.append(chr(value + 63))
        prev_lat, prev_lon = ilat, ilon
    return "".join(out)


# --- measuring and walking along a line --------------------------------------

def cumulative_distances(coords: Sequence[LatLon]) -> list[float]:
    cum = [0.0]
    for i in range(1, len(coords)):
        cum.append(cum[-1] + haversine_m(coords[i - 1], coords[i]))
    return cum


def interpolate_index(cum: Sequence[float], target: float) -> tuple[int, float]:
    """Return ``(i, t)`` so that ``target`` lies ``t`` of the way from vertex i to i+1."""
    if target <= cum[0]:
        return 0, 0.0
    if target >= cum[-1]:
        return max(0, len(cum) - 2), 1.0
    i = bisect_right(cum, target) - 1
    span = cum[i + 1] - cum[i]
    return i, (target - cum[i]) / span if span > 0 else 0.0


def point_at_distance(coords: Sequence[LatLon], cum: Sequence[float], target_m: float) -> LatLon:
    if len(coords) == 1:
        return coords[0]
    i, t = interpolate_index(cum, target_m)
    (lat1, lon1), (lat2, lon2) = coords[i], coords[i + 1]
    return lat1 + (lat2 - lat1) * t, lon1 + (lon2 - lon1) * t


def value_at_distance(cum: Sequence[float], values: Sequence[float], target_m: float) -> float:
    """Linearly interpolate a per-vertex quantity (e.g. elapsed seconds) by distance."""
    if len(values) == 1:
        return values[0]
    i, t = interpolate_index(cum, target_m)
    return values[i] + (values[i + 1] - values[i]) * t


def slice_line(coords: Sequence[LatLon], cum: Sequence[float], start_m: float, end_m: float) -> list[LatLon]:
    """Sub-line between two distances, with interpolated end points."""
    start_m, end_m = max(0.0, start_m), min(cum[-1], end_m)
    if end_m <= start_m:
        p = point_at_distance(coords, cum, start_m)
        return [p, p]
    out = [point_at_distance(coords, cum, start_m)]
    first = bisect_right(cum, start_m)
    last = bisect_right(cum, end_m)
    out.extend(coords[first:last])
    out.append(point_at_distance(coords, cum, end_m))
    return out


def densify(coords: Sequence[LatLon], step_m: float) -> list[LatLon]:
    """Points every ``step_m`` metres along the line (vertices are not kept)."""
    cum = cumulative_distances(coords)
    total = cum[-1]
    if total == 0:
        return [coords[0]]
    n = max(1, math.ceil(total / step_m))
    return [point_at_distance(coords, cum, total * k / n) for k in range(n + 1)]


def simplify(coords: Sequence[LatLon], tolerance_m: float) -> list[LatLon]:
    """Douglas-Peucker on a local equirectangular projection (iterative)."""
    n = len(coords)
    if n <= 2:
        return list(coords)
    mean_lat = math.radians(sum(c[0] for c in coords) / n)
    kx = math.cos(mean_lat) * math.pi / 180 * EARTH_RADIUS_M
    ky = math.pi / 180 * EARTH_RADIUS_M
    pts = [(lon * kx, lat * ky) for lat, lon in coords]
    keep = [False] * n
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    tol2 = tolerance_m * tolerance_m
    while stack:
        first, last = stack.pop()
        ax, ay = pts[first]
        bx, by = pts[last]
        dx, dy = bx - ax, by - ay
        seg2 = dx * dx + dy * dy
        worst, worst_d2 = -1, tol2
        for i in range(first + 1, last):
            px, py = pts[i]
            if seg2 == 0:
                d2 = (px - ax) ** 2 + (py - ay) ** 2
            else:
                t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / seg2))
                d2 = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2
            if d2 > worst_d2:
                worst, worst_d2 = i, d2
        if worst != -1:
            keep[worst] = True
            stack.append((first, worst))
            stack.append((worst, last))
    return [c for c, k in zip(coords, keep) if k]


def bbox(coords: Sequence[LatLon]) -> tuple[float, float, float, float]:
    """``(west, south, east, north)``."""
    lats = [c[0] for c in coords]
    lons = [c[1] for c in coords]
    return min(lons), min(lats), max(lons), max(lats)


# --- Sun position (day or night at a checkpoint) -----------------------------

SUNSET_ELEVATION_DEG = -0.833  # sun's upper edge on the horizon, with refraction


def sun_elevation_deg(point: LatLon, epoch: float) -> float:
    """Height of the sun above the horizon (NOAA general solar position, ~1-2 min at sunrise/sunset)."""
    t = datetime.fromtimestamp(epoch, UTC)
    minutes = t.hour * 60 + t.minute + t.second / 60
    g = 2 * math.pi / 365 * (t.timetuple().tm_yday - 1 + (minutes / 60 - 12) / 24)
    eq_time = 229.18 * (0.000075 + 0.001868 * math.cos(g) - 0.032077 * math.sin(g)
                        - 0.014615 * math.cos(2 * g) - 0.040849 * math.sin(2 * g))
    decl = (0.006918 - 0.399912 * math.cos(g) + 0.070257 * math.sin(g) - 0.006758 * math.cos(2 * g)
            + 0.000907 * math.sin(2 * g) - 0.002697 * math.cos(3 * g) + 0.00148 * math.sin(3 * g))
    hour_angle = math.radians((minutes + eq_time + 4 * point[1]) / 4 - 180)
    lat = math.radians(point[0])
    cos_zenith = math.sin(lat) * math.sin(decl) + math.cos(lat) * math.cos(decl) * math.cos(hour_angle)
    return 90 - math.degrees(math.acos(max(-1.0, min(1.0, cos_zenith))))


def is_daylight(point: LatLon, epoch: float) -> bool:
    """Between sunrise and sunset at the point (what a driver sees, whatever the clock says)."""
    return sun_elevation_deg(point, epoch) > SUNSET_ELEVATION_DEG


# --- Web Mercator (the heatmap grid is regular in projected space) -----------

def lat_to_mercator_y(lat: float) -> float:
    lat = max(-WEB_MERCATOR_MAX_LAT, min(WEB_MERCATOR_MAX_LAT, lat))
    return EARTH_RADIUS_M * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


def mercator_y_to_lat(y: float) -> float:
    return math.degrees(2 * math.atan(math.exp(y / EARTH_RADIUS_M)) - math.pi / 2)


def lon_to_mercator_x(lon: float) -> float:
    return EARTH_RADIUS_M * math.radians(lon)


def mercator_x_to_lon(x: float) -> float:
    return math.degrees(x / EARTH_RADIUS_M)


class PointIndex:
    """Uniform-grid spatial hash for "is anything within r metres?" queries."""

    def __init__(self, points: Sequence[LatLon], cell_deg: float):
        self.cell = cell_deg
        self.buckets: dict[tuple[int, int], list[LatLon]] = {}
        for p in points:
            self.buckets.setdefault(self._key(p), []).append(p)

    def _key(self, p: LatLon) -> tuple[int, int]:
        return int(math.floor(p[0] / self.cell)), int(math.floor(p[1] / self.cell))

    def within(self, p: LatLon, radius_m: float) -> bool:
        """True if any indexed point lies within ``radius_m`` of ``p``."""
        lat_cells = math.ceil(radius_m / 111_000 / self.cell)
        lon_scale = max(0.05, math.cos(math.radians(p[0])))
        lon_cells = math.ceil(radius_m / (111_000 * lon_scale) / self.cell)
        ki, kj = self._key(p)
        for di in range(-lat_cells, lat_cells + 1):
            for dj in range(-lon_cells, lon_cells + 1):
                for q in self.buckets.get((ki + di, kj + dj), ()):
                    if haversine_m(p, q) <= radius_m:
                        return True
        return False
