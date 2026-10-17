"""OSRM client for trips beyond Valhalla's distance limit (or when it is down).

The public OSRM server only has a car profile, so per-segment durations are
re-timed for a truck: no segment may be driven faster than the truck's top
speed. Road restrictions for heavy vehicles are *not* applied on this path;
the plan response says so.
"""

from __future__ import annotations

from django.conf import settings

from ..geo import LatLon, cumulative_distances, decode_polyline
from ..http import UpstreamError, request_json
from .types import RouteCandidate, RoutingError, TruckProfile, main_road_names, strategy_for

SERVICE = "OSRM routing"


def route(points: list[LatLon], truck: TruckProfile, alternatives: int = 0) -> list[RouteCandidate]:
    coords = ";".join(f"{lon:.6f},{lat:.6f}" for lat, lon in points)
    url = f"{settings.ROUTING['OSRM_URL'].rstrip('/')}/route/v1/driving/{coords}"
    params = {
        # OSRM only computes alternatives between two points.
        "alternatives": str(alternatives) if len(points) == 2 and alternatives else "false",
        "overview": "full",
        "geometries": "polyline6",
        "annotations": "duration,distance",
        "steps": "true",
        "continue_straight": "true",
    }
    status, payload = request_json(SERVICE, "GET", url, params=params,
                                   timeout=settings.ROUTING["TIMEOUT_S"], accept_status=(200, 400))
    code = payload.get("code")
    if code in {"NoRoute", "NoSegment"}:
        raise RoutingError("No road route connects these points.")
    if status != 200 or code != "Ok":
        raise UpstreamError(SERVICE, payload.get("message") or code or f"HTTP {status}")

    return [_candidate(r, truck, strategy_for(i, len(points))) for i, r in enumerate(payload["routes"])]


def _candidate(osrm_route: dict, truck: TruckProfile, strategy: str) -> RouteCandidate:
    coords = decode_polyline(osrm_route["geometry"], precision=6)
    cum = cumulative_distances(coords)

    seg_durations: list[float] = []
    seg_distances: list[float] = []
    named: list[tuple[list[str], float]] = []
    for leg in osrm_route["legs"]:
        ann = leg.get("annotation") or {}
        seg_durations.extend(ann.get("duration", []))
        seg_distances.extend(ann.get("distance", []))
        for step in leg.get("steps", []):
            label = step.get("ref") or step.get("name")
            if label:
                named.append(([label], float(step.get("distance", 0.0))))

    vmax = truck.max_speed_mps
    if len(seg_durations) == len(coords) - 1:
        cum_drive = [0.0]
        for dur, dist in zip(seg_durations, seg_distances):
            cum_drive.append(cum_drive[-1] + max(float(dur), float(dist) / vmax))
    else:
        # Annotation/geometry mismatch: spread the (speed-capped) total by distance.
        total = max(float(osrm_route["duration"]), cum[-1] / vmax)
        cum_drive = [total * d / cum[-1] if cum[-1] else 0.0 for d in cum]

    return RouteCandidate(
        coords=coords,
        cum_m=cum,
        cum_drive_s=cum_drive,
        engine="osrm-car",
        strategy=strategy,
        road_names=main_road_names(named),
    )
