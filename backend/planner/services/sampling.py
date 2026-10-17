"""Checkpoints every N miles along a route, each with its driving time.

Every checkpoint stands for the stretch of road halfway to its neighbours,
so the miles a route spends at each risk level add up exactly to its length
(the origin covers the first half-interval, the destination the last).
"""

from __future__ import annotations

from dataclasses import dataclass

from .geo import METERS_PER_MILE, LatLon, point_at_distance, value_at_distance
from .routing import RouteCandidate

ALLOWED_INTERVALS_MI = (10, 25, 50)
MERGE_TAIL_MI = 0.5  # a destination this close to the last checkpoint replaces it


@dataclass(frozen=True)
class Checkpoint:
    index: int
    mile: float
    point: LatLon
    drive_s: float
    covers: tuple[float, float]  # (from_mile, to_mile)

    @property
    def covered_miles(self) -> float:
        return self.covers[1] - self.covers[0]


def checkpoint_miles(total_mi: float, interval_mi: float) -> list[float]:
    miles = [k * interval_mi for k in range(int(total_mi // interval_mi) + 1)]
    if total_mi - miles[-1] < MERGE_TAIL_MI and len(miles) > 1:
        miles[-1] = total_mi
    elif miles[-1] < total_mi:
        miles.append(total_mi)
    return miles


def place_checkpoints(route: RouteCandidate, interval_mi: float) -> list[Checkpoint]:
    total_mi = route.distance_m / METERS_PER_MILE
    miles = checkpoint_miles(total_mi, interval_mi)
    out: list[Checkpoint] = []
    for i, mile in enumerate(miles):
        lo = 0.0 if i == 0 else (miles[i - 1] + mile) / 2
        hi = total_mi if i == len(miles) - 1 else (mile + miles[i + 1]) / 2
        at_m = mile * METERS_PER_MILE
        out.append(Checkpoint(
            index=i,
            mile=mile,
            point=point_at_distance(route.coords, route.cum_m, at_m),
            drive_s=value_at_distance(route.cum_m, route.cum_drive_s, at_m),
            covers=(lo, hi),
        ))
    return out


def mile_at_drive_time(route: RouteCandidate, drive_s: float) -> float:
    """Inverse lookup: how far the truck has driven after ``drive_s`` seconds."""
    return value_at_distance(route.cum_drive_s, route.cum_m, drive_s) / METERS_PER_MILE
