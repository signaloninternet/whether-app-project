"""Valhalla client using the ``truck`` costing model.

The public instance rejects requests whose summed straight-line legs exceed
~1,500 km. ``route_through`` lifts that limit: it splits a list of waypoints
into consecutive requests that each fit, routes them in parallel and stitches
the results. Junction waypoints carry the direction of travel (``heading``)
so each piece leaves the junction the way the previous one arrived instead
of turning around.
"""

from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

from django.conf import settings

from ..geo import LatLon, cumulative_distances, decode_polyline, haversine_m
from ..http import UpstreamError, request_json
from .types import RouteCandidate, RoutingError, TruckProfile, main_road_names, strategy_for

SERVICE = "Valhalla routing"

# Stitched long-haul plans fan out into several requests; stay polite to the
# shared public server however many threads ask at once.
_CONCURRENCY = threading.BoundedSemaphore(6)

# Valhalla error codes we can explain to the user instead of a generic 502.
DISTANCE_LIMIT = 154
NO_ROUTE_CODES = {170, 171, 442, 443}


class DistanceLimitExceeded(Exception):
    """The request is longer than the instance's max_distance for trucks."""


@dataclass(frozen=True)
class Waypoint:
    point: LatLon
    heading: float | None = None  # direction of travel through this point, degrees
    highway: bool = False  # snap to a primary-or-better road (corridor and junction points)


@dataclass
class _Trip:
    coords: list[LatLon]
    cum_drive_s: list[float]
    named: list[tuple[list[str], float]]


def _url(path: str) -> str:
    return settings.ROUTING["VALHALLA_URL"].rstrip("/") + path


def _params() -> dict | None:
    key = settings.ROUTING["VALHALLA_API_KEY"]
    return {"api_key": key} if key else None


def max_request_km() -> float:
    return settings.ROUTING["VALHALLA_MAX_KM"]


def path_crow_km(points: list[LatLon]) -> float:
    """Valhalla's limit applies to the summed straight-line legs of a request."""
    return sum(haversine_m(a, b) for a, b in zip(points, points[1:])) / 1000


def within_limit(points: list[LatLon]) -> bool:
    return path_crow_km(points) <= max_request_km()


def _location(wp: Waypoint, kind: str) -> dict:
    loc: dict = {"lat": wp.point[0], "lon": wp.point[1], "type": kind}
    if wp.highway:
        loc["search_filter"] = {"min_road_class": "primary"}
    if wp.heading is not None:
        loc.update(heading=round(wp.heading) % 360, heading_tolerance=60)
    return loc


def _request(waypoints: list[Waypoint], truck: TruckProfile, alternates: int) -> list[_Trip]:
    if not within_limit([w.point for w in waypoints]):
        raise DistanceLimitExceeded()
    last = len(waypoints) - 1
    body = {
        "locations": [_location(w, "break" if i in (0, last) else "through") for i, w in enumerate(waypoints)],
        "costing": "truck",
        "costing_options": {
            # Valhalla's own truck speed model (truck limits, slower urban
            # roads) beats a flat cap, which would make parallel US highways
            # look as fast as Interstates. Prefer highways like a trucker.
            "truck": {
                "weight": truck.gross_weight_t,
                "height": truck.height_m,
                "width": truck.width_m,
                "length": truck.length_m,
                "use_highways": 1.0,
            }
        },
        # Valhalla only computes alternates between two points.
        "alternates": alternates if len(waypoints) == 2 else 0,
        "units": "miles",
        "directions_type": "maneuvers",
        "language": "en-US",
    }
    with _CONCURRENCY:
        status, payload = request_json(
            SERVICE, "POST", _url("/route"), json=body, params=_params(),
            timeout=settings.ROUTING["TIMEOUT_S"], accept_status=(200, 400),
        )
    if status == 400:
        code = payload.get("error_code")
        if code == DISTANCE_LIMIT:
            raise DistanceLimitExceeded()
        if code in NO_ROUTE_CODES:
            raise RoutingError("No truck-legal road route connects these points.")
        raise UpstreamError(SERVICE, payload.get("error", "rejected the request"))
    trips = [payload["trip"]] + [alt["trip"] for alt in payload.get("alternates", [])]
    return [_parse_trip(t) for t in trips]


def _parse_trip(trip: dict) -> _Trip:
    """Shape plus a drive time for every vertex, spread over each maneuver by distance."""
    coords: list[LatLon] = []
    cum_drive: list[float] = []
    named: list[tuple[list[str], float]] = []
    elapsed = 0.0
    for leg in trip["legs"]:
        shape = decode_polyline(leg["shape"], precision=6)
        cum = cumulative_distances(shape)
        times = [0.0] * len(shape)
        for m in leg["maneuvers"]:
            b, e, t = m["begin_shape_index"], m["end_shape_index"], float(m.get("time", 0.0))
            span = cum[e] - cum[b]
            for k in range(b + 1, e + 1):
                times[k] = times[b] + t * ((cum[k] - cum[b]) / span if span > 0 else 1.0)
            if names := (m.get("street_names") or m.get("begin_street_names")):
                named.append((names, span))
        skip = 1 if coords else 0  # legs share their junction vertex
        coords.extend(shape[skip:])
        cum_drive.extend(elapsed + t for t in times[skip:])
        elapsed = cum_drive[-1]
    return _Trip(coords, cum_drive, named)


def _candidate(trips: list[_Trip], strategy: str) -> RouteCandidate:
    coords: list[LatLon] = []
    cum_drive: list[float] = []
    named: list[tuple[list[str], float]] = []
    for trip in trips:
        offset = cum_drive[-1] if cum_drive else 0.0
        skip = 1 if coords and trip.coords[0] == coords[-1] else 0
        coords.extend(trip.coords[skip:])
        cum_drive.extend(offset + t for t in trip.cum_drive_s[skip:])
        named.extend(trip.named)
    return RouteCandidate(
        coords=coords,
        cum_m=cumulative_distances(coords),
        cum_drive_s=cum_drive,
        engine="valhalla-truck",
        strategy=strategy,
        road_names=main_road_names(named),
    )


def route(origin: LatLon, dest: LatLon, truck: TruckProfile, alternates: int = 2) -> list[RouteCandidate]:
    """Direct truck route plus up to ``alternates`` alternatives."""
    trips = _request([Waypoint(origin), Waypoint(dest)], truck, alternates)
    return [_candidate([t], strategy_for(i, 2)) for i, t in enumerate(trips)]


def _split(waypoints: list[Waypoint]) -> list[list[Waypoint]]:
    """Consecutive groups that each fit one request; neighbours share a junction."""
    groups, current = [], [waypoints[0]]
    for wp in waypoints[1:]:
        if len(current) > 1 and not within_limit([w.point for w in current] + [wp.point]):
            groups.append(current)
            current = [current[-1]]
        current.append(wp)
        if not within_limit([w.point for w in current]):
            raise DistanceLimitExceeded()  # a single hop is longer than the limit
    groups.append(current)
    return groups


def route_through(waypoints: list[Waypoint], truck: TruckProfile, strategy: str) -> RouteCandidate:
    """Truck route visiting ``waypoints`` in order, split into as many requests as needed."""
    groups = _split(waypoints)
    with ThreadPoolExecutor(max_workers=min(3, len(groups))) as pool:
        trips = list(pool.map(lambda g: _request(g, truck, alternates=0)[0], groups))
    return _candidate(trips, strategy)


def snap_to_highway(point: LatLon) -> LatLon | None:
    """Nearest primary-or-better road to ``point`` (used for OSRM corridor points)."""
    body = {
        "locations": [{"lat": point[0], "lon": point[1], "search_filter": {"min_road_class": "primary"}}],
        "costing": "truck",
        "verbose": False,
    }
    try:
        _, payload = request_json(SERVICE, "POST", _url("/locate"), json=body, params=_params(),
                                  timeout=settings.ROUTING["TIMEOUT_S"])
    except UpstreamError:
        return None
    edges = (payload[0] if payload else {}).get("edges") or []
    if not edges:
        return None
    return edges[0]["correlated_lat"], edges[0]["correlated_lon"]
