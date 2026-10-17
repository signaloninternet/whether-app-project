from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass, field

from django.conf import settings

from ..geo import METERS_PER_MILE, LatLon

LB_PER_METRIC_TON = 2204.62


class RoutingError(Exception):
    """No usable route (bad input, unroutable points, or every engine failed)."""

    def __init__(self, message: str, status_code: int = 422):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


@dataclass(frozen=True)
class TruckProfile:
    """Vehicle used for routing. Dimensions are a standard 53' dry van combo."""

    load_lb: float
    tare_lb: float
    max_speed_mph: float
    height_m: float = 4.11
    width_m: float = 2.6
    length_m: float = 21.64

    @classmethod
    def for_load(cls, load_lb: float) -> "TruckProfile":
        return cls(
            load_lb=load_lb,
            tare_lb=settings.TRUCK["TARE_WEIGHT_LB"],
            max_speed_mph=settings.TRUCK["MAX_SPEED_MPH"],
        )

    @property
    def gross_weight_t(self) -> float:
        return round((self.load_lb + self.tare_lb) / LB_PER_METRIC_TON, 2)

    @property
    def max_speed_mps(self) -> float:
        return self.max_speed_mph * METERS_PER_MILE / 3600


@dataclass
class RouteCandidate:
    """One drivable route, normalised across engines.

    ``cum_m`` and ``cum_drive_s`` are per-vertex cumulative distance and
    driving time, so any point along the route has a precise drive time.
    """

    coords: list[LatLon]
    cum_m: list[float]
    cum_drive_s: list[float]
    engine: str  # "valhalla-truck" | "osrm-car"
    strategy: str  # "fastest" | "alternate" | "corridor"
    road_names: list[str] = field(default_factory=list)

    @property
    def distance_m(self) -> float:
        return self.cum_m[-1]

    @property
    def drive_s(self) -> float:
        return self.cum_drive_s[-1]


def strategy_for(index: int, n_points: int) -> str:
    """How an engine result was produced: its own best/alternate, or via a corridor point."""
    if n_points > 2:
        return "corridor"
    return "fastest" if index == 0 else "alternate"


# Highway refs like "I 80", "US-6", "SR 99", "A1" (1-3 capitals + number),
# optionally followed by a direction or variant: "I 76 West", "I 80 Alt".
_REF = re.compile(r"^([A-Z]{1,3})[\s-]?(\d{1,4}[A-Z]?)(?:\s+(?:North|South|East|West|[NSEW]|Alt|Alternate|Bus|Business|Byp|Bypass|Spur|Truck))*$")
# Interstates first, then US highways, when a route rides concurrent refs.
_REF_WEIGHT = {"I": 1.5, "US": 1.2}


def normalise_ref(name: str) -> str | None:
    """'I 76 West' -> 'I-76', 'US 6' -> 'US-6'; None when it is not a highway ref."""
    m = _REF.match(name.strip())
    return f"{m.group(1)}-{m.group(2)}" if m else None


def main_road_names(weighted: list[tuple[list[str], float]], limit: int = 4) -> list[str]:
    """The route's signature roads by distance driven, e.g. ['I-80', 'I-76'].

    ``weighted`` holds (names, metres) per maneuver. Highway refs win over
    street names, Interstates over US and state routes, and a ref that mostly
    rides concurrently with an already chosen one (US-6 on I-80) is skipped.
    """
    ref_metres: dict[str, float] = defaultdict(float)
    ref_segments: dict[str, set[int]] = defaultdict(set)
    name_metres: dict[str, float] = defaultdict(float)
    for i, (names, metres) in enumerate(weighted):
        parts = {p.strip() for raw in names for p in raw.split(";") if p.strip()}
        refs = {r for p in parts if (r := normalise_ref(p))}
        for ref in refs:
            ref_metres[ref] += metres
            ref_segments[ref].add(i)
        if not refs:
            for part in parts:
                name_metres[part] += metres

    if not ref_metres:
        return [n for n, _ in sorted(name_metres.items(), key=lambda kv: -kv[1])[:limit]]

    def score(ref: str) -> float:
        return ref_metres[ref] * _REF_WEIGHT.get(ref.split("-")[0], 1.0)

    chosen: list[str] = []
    for ref in sorted(ref_metres, key=score, reverse=True):
        shared = sum(weighted[i][1] for i in ref_segments[ref] if any(i in ref_segments[c] for c in chosen))
        if ref_metres[ref] and shared / ref_metres[ref] > 0.5:
            continue
        chosen.append(ref)
        if len(chosen) == limit:
            break
    return chosen


def distinct_labels(ranked: list[list[str]], size: int = 2) -> list[list[str]]:
    """Pick ``size`` signature roads per route so that no two routes read the same.

    ``ranked`` holds each route's roads, best first. A route whose top roads
    repeat an earlier label swaps in its next-best road that tells it apart.
    """
    labels: list[list[str]] = []
    for roads in ranked:
        label = roads[:size]
        if label in labels:
            for alt in roads[size:]:
                candidate = [*roads[: size - 1], alt]
                if candidate not in labels:
                    label = candidate
                    break
        labels.append(label)
    return labels
