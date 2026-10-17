"""Produce three genuinely different truck routes between two points.

Regional trips (straight line within Valhalla's request limit):
    Valhalla truck route + its alternates.

Long-haul trips:
    OSRM finds the corridors (it has no distance limit, but only a car
    profile); each corridor is then re-routed by Valhalla's truck model in
    several stitched requests, so every option respects truck restrictions.
    If Valhalla fails, that option keeps OSRM's geometry with truck-capped
    speeds and the plan says so.

Either way, near-duplicates are dropped (two routes are the same option
when most of their combined length is shared road), and missing options are
forced through a highway point offset to either side of the straight line
at the trip's midpoint. Different corridors are what make a weather
comparison meaningful: a storm over I-80 vs. a clear I-70.
"""

from __future__ import annotations

import logging
import math
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

from ..geo import (
    LatLon,
    PointIndex,
    densify,
    destination_point,
    great_circle_midpoint,
    haversine_m,
    initial_bearing_deg,
    point_at_distance,
)
from ..http import UpstreamError
from . import osrm, valhalla
from .types import RouteCandidate, RoutingError, TruckProfile
from .valhalla import Waypoint

log = logging.getLogger(__name__)

WANTED = 3
DUPLICATE_SHARE = 0.80  # shared length / union length at or above this = same option
MAX_TIME_RATIO = 1.40  # an option may be at most 40% slower than the fastest
# Corridor offsets as a fraction of the straight-line trip length, tried in pairs.
CORRIDOR_OFFSETS = ((0.18, -0.18), (0.32, -0.32))
SKELETON_STEP_M = 450_000.0  # waypoint spacing when re-routing a long corridor for trucks


@dataclass
class RouteOptions:
    routes: list[RouteCandidate]
    engine: str  # "valhalla" | "osrm"
    notes: list[str] = field(default_factory=list)


# --- comparing routes ----------------------------------------------------------

def shared_fraction(a: RouteCandidate, b: RouteCandidate) -> float:
    """Shared length over union length (a length-weighted Jaccard index)."""
    step = max(200.0, max(a.distance_m, b.distance_m) / 5_000)
    same_road = max(150.0, step * 0.75)
    pa, pb = densify(a.coords, step), densify(b.coords, step)
    cell = max(0.01, same_road / 50_000)
    ia, ib = PointIndex(pa, cell), PointIndex(pb, cell)
    on_b = sum(1 for p in pa if ib.within(p, same_road)) / len(pa)
    on_a = sum(1 for p in pb if ia.within(p, same_road)) / len(pb)
    shared = (on_b * a.distance_m + on_a * b.distance_m) / 2
    union = a.distance_m + b.distance_m - shared
    return shared / union if union > 0 else 1.0


def _is_new_option(candidate: RouteCandidate, kept: list[RouteCandidate]) -> bool:
    if kept and candidate.drive_s > min(r.drive_s for r in kept) * MAX_TIME_RATIO:
        return False
    return all(shared_fraction(candidate, r) < DUPLICATE_SHARE for r in kept)


def _keep_distinct(candidates: list[RouteCandidate], kept: list[RouteCandidate]) -> None:
    for candidate in sorted(candidates, key=lambda r: r.drive_s):
        if len(kept) < WANTED and _is_new_option(candidate, kept):
            kept.append(candidate)


# --- corridor points -----------------------------------------------------------

def _mean_heading(a: float, b: float) -> float:
    x = math.cos(math.radians(a)) + math.cos(math.radians(b))
    y = math.sin(math.radians(a)) + math.sin(math.radians(b))
    return math.degrees(math.atan2(y, x)) % 360


def corridor_vias(origin: LatLon, dest: LatLon, fractions: tuple[float, ...]) -> list[Waypoint]:
    """Highway waypoints offset sideways from the trip's midpoint."""
    crow = haversine_m(origin, dest)
    mid = great_circle_midpoint(origin, dest)
    heading = initial_bearing_deg(mid, dest)
    vias = []
    for f in fractions:
        point = destination_point(mid, heading + (90 if f > 0 else -90), abs(f) * crow)
        travel = _mean_heading(initial_bearing_deg(origin, point), initial_bearing_deg(point, dest))
        vias.append(Waypoint(point, heading=travel, highway=True))
    return vias


def skeleton_waypoints(skeleton: RouteCandidate) -> list[Waypoint]:
    """Waypoints along a corridor, spaced so they pack into Valhalla-sized requests."""
    total = skeleton.distance_m
    n = max(1, math.ceil(total / SKELETON_STEP_M))
    waypoints = [Waypoint(skeleton.coords[0])]
    for k in range(1, n):
        at = total * k / n
        before = point_at_distance(skeleton.coords, skeleton.cum_m, at - 2_000)
        after = point_at_distance(skeleton.coords, skeleton.cum_m, at + 2_000)
        waypoints.append(Waypoint(point_at_distance(skeleton.coords, skeleton.cum_m, at),
                                  heading=initial_bearing_deg(before, after), highway=True))
    waypoints.append(Waypoint(skeleton.coords[-1]))
    return waypoints


# --- engines ---------------------------------------------------------------------

def _try(fn, *args):
    try:
        return fn(*args)
    except (RoutingError, UpstreamError, valhalla.DistanceLimitExceeded) as exc:
        log.info("route attempt skipped: %s", exc)
        return None


def _valhalla_corridor(origin: LatLon, via: Waypoint, dest: LatLon, truck: TruckProfile) -> RouteCandidate | None:
    return _try(valhalla.route_through, [Waypoint(origin), via, Waypoint(dest)], truck, "corridor")


def _osrm_corridor(origin: LatLon, via: Waypoint, dest: LatLon, truck: TruckProfile) -> RouteCandidate | None:
    snapped = valhalla.snap_to_highway(via.point) or via.point
    found = _try(osrm.route, [origin, snapped, dest], truck)
    return found[0] if found else None


def _fill_with_corridors(kept: list[RouteCandidate], origin: LatLon, dest: LatLon, truck: TruckProfile, make) -> None:
    for fractions in CORRIDOR_OFFSETS:
        if len(kept) >= WANTED:
            return
        vias = corridor_vias(origin, dest, fractions)
        with ThreadPoolExecutor(max_workers=len(vias)) as pool:
            found = [r for r in pool.map(lambda v: make(origin, v, dest, truck), vias) if r]
        _keep_distinct(found, kept)


def _truck_along(skeleton: RouteCandidate, truck: TruckProfile) -> RouteCandidate:
    """Re-route an OSRM corridor with Valhalla's truck model; keep OSRM's on failure."""
    rerouted = _try(valhalla.route_through, skeleton_waypoints(skeleton), truck, skeleton.strategy)
    return rerouted or skeleton


def _regional(origin: LatLon, dest: LatLon, truck: TruckProfile, notes: list[str]) -> tuple[str, list[RouteCandidate]]:
    try:
        found = valhalla.route(origin, dest, truck, alternates=WANTED - 1)
    except (UpstreamError, valhalla.DistanceLimitExceeded) as exc:
        log.warning("Valhalla failed (%s); falling back to OSRM", exc)
        notes.append("The truck router is unavailable, so routes use OSRM's road network re-timed "
                     f"for a {truck.max_speed_mph:.0f} mph truck; heavy-vehicle restrictions are not checked.")
        kept: list[RouteCandidate] = []
        _keep_distinct(osrm.route([origin, dest], truck, alternatives=WANTED - 1), kept)
        _fill_with_corridors(kept, origin, dest, truck, _osrm_corridor)
        return "osrm", kept
    kept = []
    _keep_distinct(found, kept)
    _fill_with_corridors(kept, origin, dest, truck, _valhalla_corridor)
    return "valhalla", kept


def _long_haul(origin: LatLon, dest: LatLon, truck: TruckProfile, notes: list[str]) -> tuple[str, list[RouteCandidate]]:
    """Car-router corridors, each re-routed for trucks; search more when two converge."""
    skeletons: list[RouteCandidate] = []
    _keep_distinct(osrm.route([origin, dest], truck, alternatives=WANTED - 1), skeletons)
    kept: list[RouteCandidate] = []

    def search(pool: ThreadPoolExecutor, fractions: tuple[float, ...]):
        return [pool.submit(_osrm_corridor, origin, via, dest, truck) for via in corridor_vias(origin, dest, fractions)]

    with ThreadPoolExecutor(max_workers=4) as pool:
        routed = [pool.submit(_truck_along, s, truck) for s in skeletons]
        # OSRM rarely finds three corridors; look for more while the first ones are truck-routed.
        searches = search(pool, CORRIDOR_OFFSETS[0]) if len(skeletons) < WANTED else None
        _keep_distinct([f.result() for f in routed], kept)
        for i, fractions in enumerate(CORRIDOR_OFFSETS):
            if len(kept) >= WANTED:
                break
            found = [f.result() for f in (searches if i == 0 and searches is not None else search(pool, fractions))]
            fresh = [c for c in found if c and _is_new_option(c, skeletons)]
            skeletons.extend(fresh)
            _keep_distinct(list(pool.map(lambda c: _truck_along(c, truck), fresh)), kept)

    if any(r.engine != "valhalla-truck" for r in kept):
        notes.append("Some long-haul routes keep OSRM's car-network geometry re-timed for a "
                     f"{truck.max_speed_mph:.0f} mph truck, because the truck router could not route them.")
        return ("osrm" if all(r.engine != "valhalla-truck" for r in kept) else "valhalla"), kept
    return "valhalla", kept


def route_options(origin: LatLon, dest: LatLon, truck: TruckProfile) -> RouteOptions:
    if haversine_m(origin, dest) < 1000:
        raise RoutingError("Origin and destination are less than 1 km apart.", status_code=400)
    notes: list[str] = []
    if valhalla.within_limit([origin, dest]):
        engine, kept = _regional(origin, dest, truck, notes)
    else:
        engine, kept = _long_haul(origin, dest, truck, notes)
    if not kept:
        raise RoutingError("No route found between these points.")
    if len(kept) < WANTED:
        notes.append(f"Only {len(kept)} distinct route{'s' if len(kept) > 1 else ''} exist between these points.")
    kept.sort(key=lambda r: r.drive_s)
    return RouteOptions(routes=kept, engine=engine, notes=notes)
