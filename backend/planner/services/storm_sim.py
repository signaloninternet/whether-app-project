"""Development aid: overlay a synthetic storm on real forecasts.

Only active with ``DEBUG=1`` and ``SIMULATE_STORM=1``. It lets the risk
colours, load rules and recommendation be exercised on a calm day. The
storm is a band of wind, rain and (north of 41°N) snow centred on the
Great Plains that drifts east at 40 km/h; it is applied after caching, so
real forecasts are never polluted.
"""

from __future__ import annotations

import math
from dataclasses import replace

from .geo import LatLon, haversine_m

CENTER: LatLon = (40.2, -99.0)
DRIFT_EAST_KMH = 40.0


def apply(point: LatLon, series):
    wind, rain, snow = list(series.wind), list(series.rain), list(series.snow)
    for h in range(len(wind)):
        hours = (series.start // 3600 + h) % (24 * 7)  # moves with wall-clock time, deterministic per week
        lon = CENTER[1] + (DRIFT_EAST_KMH * (hours % 48)) / (111.0 * math.cos(math.radians(CENTER[0])))
        d_km = haversine_m(point, (CENTER[0], lon)) / 1000
        core = math.exp(-((d_km / 260) ** 2))
        if wind[h] is not None:
            wind[h] = max(wind[h], 58 * core)
        if rain[h] is not None:
            rain[h] = max(rain[h], 0.75 * core if point[0] < 41 else 0.2 * core)
        if snow[h] is not None and point[0] >= 41:
            snow[h] = max(snow[h], 2.6 * core)
    return replace(series, wind=tuple(wind), rain=tuple(rain), snow=tuple(snow))
