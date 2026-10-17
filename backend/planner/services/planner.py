"""Build a full trip plan: routes, timed checkpoints, weather, risk, recommendation."""

from __future__ import annotations

import hashlib
import json
import logging
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from django.conf import settings
from django.core.cache import cache

from . import hos, weather
from .weather import iso_utc
from .geo import METERS_PER_MILE, LatLon, bbox, encode_polyline, point_at_distance, simplify, slice_line
from .risk import Risk, assess, rules_table
from .routing import RouteCandidate, TruckProfile, route_options
from .routing.types import distinct_labels
from .sampling import Checkpoint, mile_at_drive_time, place_checkpoints
from .scoring import RiskSummary, ScoredRoute, plan_warnings, recommend

log = logging.getLogger(__name__)

PLAN_CACHE_S = 10 * 60
PLAN_CACHE_VERSION = "v2"  # bump when the plan payload or routing logic changes
ROUTE_IDS = "ABC"


@dataclass(frozen=True)
class PlanRequest:
    origin: LatLon
    origin_label: str
    destination: LatLon
    destination_label: str
    departure_local: datetime  # naive, wall-clock time at the origin
    timezone: str
    load_lb: float
    interval_mi: int
    hos_breaks: bool

    @property
    def departure_utc(self) -> datetime:
        return self.departure_local.replace(tzinfo=ZoneInfo(self.timezone)).astimezone(UTC)

    def cache_key(self) -> str:
        raw = json.dumps([self.origin, self.destination, self.departure_utc.isoformat(), self.load_lb,
                          self.interval_mi, self.hos_breaks], default=str)
        return hashlib.sha1(raw.encode()).hexdigest()[:16]


def _display_tolerance_m(distance_m: float) -> float:
    return 12.0 if distance_m < 300_000 else 25.0 if distance_m < 1_500_000 else 40.0


@dataclass
class _TimedRoute:
    id: str
    route: RouteCandidate
    checkpoints: list[Checkpoint]
    stops: list[hos.Stop]
    elapsed: list[float]  # per checkpoint, seconds after departure

    @property
    def travel_s(self) -> float:
        return hos.elapsed_for_drive(self.route.drive_s, self.stops)


def _time_route(route_id: str, route: RouteCandidate, req: PlanRequest) -> _TimedRoute:
    checkpoints = place_checkpoints(route, req.interval_mi)
    stops = hos.schedule_stops(route.drive_s) if req.hos_breaks else []
    elapsed = [hos.elapsed_for_drive(cp.drive_s, stops) for cp in checkpoints]
    return _TimedRoute(route_id, route, checkpoints, stops, elapsed)


def _risk_segments(timed: _TimedRoute, levels: list[Risk | None], tolerance_m: float) -> list[dict]:
    """Merge consecutive checkpoints with the same level into drawable stretches."""
    runs: list[list] = []
    for cp, level in zip(timed.checkpoints, levels):
        if runs and runs[-1][0] == level:
            runs[-1][2] = cp.covers[1]
        else:
            runs.append([level, cp.covers[0], cp.covers[1]])
    route = timed.route
    out = []
    for level, start_mi, end_mi in runs:
        line = slice_line(route.coords, route.cum_m, start_mi * METERS_PER_MILE, end_mi * METERS_PER_MILE)
        out.append({
            "level": -1 if level is None else int(level),
            "from_mile": round(start_mi, 2),
            "to_mile": round(end_mi, 2),
            "polyline": encode_polyline(simplify(line, tolerance_m)),
        })
    return out


def _timeline(timed: _TimedRoute) -> list[list[float]]:
    """[elapsed_s, mile] knots, including the flat spots where the truck is parked."""
    knots = [[round(t), round(cp.mile, 3)] for cp, t in zip(timed.checkpoints, timed.elapsed)]
    for stop in timed.stops:
        mile = mile_at_drive_time(timed.route, stop.at_drive_s)
        begins = hos.elapsed_for_drive(stop.at_drive_s, timed.stops)
        knots.append([round(begins), round(mile, 3)])
        knots.append([round(begins + stop.duration_s), round(mile, 3)])
    knots.sort()
    return knots


def _stops_payload(timed: _TimedRoute, departure: float) -> list[dict]:
    out = []
    for stop in timed.stops:
        mile = mile_at_drive_time(timed.route, stop.at_drive_s)
        lat, lon = point_at_distance(timed.route.coords, timed.route.cum_m, mile * METERS_PER_MILE)
        begins = departure + hos.elapsed_for_drive(stop.at_drive_s, timed.stops)
        out.append({
            "kind": stop.kind,
            "mile": round(mile, 1),
            "lat": round(lat, 5),
            "lon": round(lon, 5),
            "start_utc": iso_utc(begins),
            "end_utc": iso_utc(begins + stop.duration_s),
            "duration_s": int(stop.duration_s),
        })
    return out


def build_plan(req: PlanRequest) -> dict:
    simulated = "-storm" if settings.WEATHER.get("SIMULATE_STORM") else ""
    cache_key = f"plan:{PLAN_CACHE_VERSION}{simulated}:{req.cache_key()}"
    if (hit := cache.get(cache_key)) is not None:
        return hit

    started = time.perf_counter()
    departure = req.departure_utc.timestamp()
    truck = TruckProfile.for_load(req.load_lb)
    options = route_options(req.origin, req.destination, truck)
    timed = [_time_route(ROUTE_IDS[i], r, req) for i, r in enumerate(options.routes)]
    routed = time.perf_counter()

    # One bulk weather fetch for every checkpoint of every route.
    raw_points = [cp.point for t in timed for cp in t.checkpoints]
    snapped = weather.snap_all(raw_points, settings.WEATHER["MAX_CHECKPOINT_LOCATIONS"])
    last_eta = departure + max(t.elapsed[-1] for t in timed)
    forecasts = weather.fetch_forecasts(snapped, departure, last_eta)
    fetched = time.perf_counter()
    snapped_iter = iter(snapped)

    labels = distinct_labels([t.route.road_names for t in timed])
    routes_payload, scored = [], []
    for t, roads in zip(timed, labels):
        summary = RiskSummary()
        levels: list[Risk | None] = []
        checkpoints_payload = []
        for cp, elapsed in zip(t.checkpoints, t.elapsed):
            eta = departure + elapsed
            sample = forecasts[next(snapped_iter)].at(eta)
            assessment = assess(sample.wind_mph, sample.rain_in_hr, sample.snow_in_hr, req.load_lb) if sample else None
            level = assessment.level if assessment else None
            summary.add(level, cp.covered_miles)
            levels.append(level)
            checkpoints_payload.append({
                "index": cp.index,
                "mile": round(cp.mile, 1),
                "lat": round(cp.point[0], 5),
                "lon": round(cp.point[1], 5),
                "eta_utc": iso_utc(eta),
                "elapsed_s": round(elapsed),
                "covers": [round(cp.covers[0], 2), round(cp.covers[1], 2)],
                "weather": sample.as_dict() if sample else None,
                "risk": assessment.as_dict() if assessment else None,
            })

        route = t.route
        tolerance = _display_tolerance_m(route.distance_m)
        line = simplify(route.coords, tolerance)
        travel_s = t.travel_s
        scored.append(ScoredRoute(t.id, summary, travel_s))
        routes_payload.append({
            "id": t.id,
            "name": "via " + " & ".join(roads) if roads else f"Route {t.id}",
            "roads": route.road_names,
            "strategy": route.strategy,
            "engine": route.engine,
            "distance_mi": round(route.distance_m / METERS_PER_MILE, 1),
            "drive_time_s": round(route.drive_s),
            "travel_time_s": round(travel_s),
            "arrival_utc": iso_utc(departure + travel_s),
            "bbox": [round(v, 5) for v in bbox(line)],
            "polyline": encode_polyline(line),
            "segments": _risk_segments(t, levels, tolerance),
            "timeline": _timeline(t),
            "stops": _stops_payload(t, departure),
            "checkpoints": checkpoints_payload,
            "risk": summary.as_dict(),
        })

    recommendation = recommend(scored)
    best_summary = next(s.summary for s in scored if s.id == recommendation["route_id"])
    for payload in routes_payload:
        payload["rank"] = recommendation["ranking"].index(payload["id"]) + 1
        payload["recommended"] = payload["id"] == recommendation["route_id"]

    plan = {
        "plan_id": req.cache_key(),
        "generated_utc": iso_utc(datetime.now(UTC).timestamp()),
        "inputs": {
            "origin": {"lat": req.origin[0], "lon": req.origin[1], "label": req.origin_label},
            "destination": {"lat": req.destination[0], "lon": req.destination[1], "label": req.destination_label},
            "departure_local": req.departure_local.isoformat(timespec="minutes"),
            "timezone": req.timezone,
            "load_weight_lb": req.load_lb,
            "interval_mi": req.interval_mi,
            "hos_breaks": req.hos_breaks,
        },
        "departure_utc": iso_utc(departure),
        "truck": {"gross_weight_lb": round(truck.load_lb + truck.tare_lb), "max_speed_mph": truck.max_speed_mph},
        "engine": options.engine,
        "notes": options.notes,
        "warnings": plan_warnings(best_summary),
        "rules": rules_table(),
        "routes": routes_payload,
        "recommendation": recommendation,
        "heatmap_request": {
            "routes": [encode_polyline(simplify(t.route.coords, 1500.0)) for t in timed],
            "departure_utc": iso_utc(departure),
            "load_weight_lb": req.load_lb,
        },
    }
    cache.set(cache_key, plan, PLAN_CACHE_S)
    log.info("plan %s: %d routes via %s in %.1fs, %d forecast points in %.1fs, total %.1fs",
             plan["plan_id"], len(timed), options.engine, routed - started, len(forecasts),
             fetched - routed, time.perf_counter() - started)
    return plan
