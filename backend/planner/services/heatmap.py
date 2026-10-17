"""Hour-by-hour weather grid over the trip corridor (0-48 h from departure).

The grid is regular in Web Mercator, so the browser can draw it as one image
stretched over its bounds and it lines up with the map exactly. Only cells
within the corridor are fetched: a buffer around every route, *closed* so
that narrow gaps between alternative routes are filled (a morphological
closing; wide-apart corridors stay separate). The cell size adapts to the
trip so the number of forecast locations stays bounded.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime

from django.conf import settings

from . import weather
from .geo import (
    EARTH_RADIUS_M,
    LatLon,
    cumulative_distances,
    densify,
    haversine_m,
    lat_to_mercator_y,
    lon_to_mercator_x,
    mercator_x_to_lon,
    mercator_y_to_lat,
)
from .risk import assess

HOURS = 48
MIN_CELL_M = 4_000.0


def corridor_radius_m(longest_route_m: float) -> float:
    return min(140_000.0, max(30_000.0, 0.085 * longest_route_m))


def closing_radius_m(radius_m: float) -> float:
    """Gaps narrower than twice this between corridors are filled."""
    return min(250_000.0, 1.2 * radius_m)


@dataclass(frozen=True)
class Grid:
    west: float  # Web Mercator metres
    east: float
    south: float
    north: float
    ncols: int
    nrows: int
    cell_m: float  # ground size of a cell
    cells: list[tuple[int, LatLon]]  # (row-major index from the north-west corner, centre)

    def as_dict(self, radius_m: float) -> dict:
        return {
            "ncols": self.ncols,
            "nrows": self.nrows,
            "bounds": [round(mercator_x_to_lon(self.west), 5), round(mercator_y_to_lat(self.south), 5),
                       round(mercator_x_to_lon(self.east), 5), round(mercator_y_to_lat(self.north), 5)],
            "cell_km": round(self.cell_m / 1000, 2),
            "radius_km": round(radius_m / 1000, 1),
            "closing_km": round(closing_radius_m(radius_m) / 1000, 1),
            "cells": [i for i, _ in self.cells],
        }


def _chamfer(dist: list[float], ncols: int, nrows: int, step: float) -> None:
    """In-place two-pass distance transform on a grid (8-neighbour, metres)."""
    diag = step * math.sqrt(2)
    for r in range(nrows):
        for c in range(ncols):
            k = r * ncols + c
            if c > 0:
                dist[k] = min(dist[k], dist[k - 1] + step)
            if r > 0:
                dist[k] = min(dist[k], dist[k - ncols] + step)
                if c > 0:
                    dist[k] = min(dist[k], dist[k - ncols - 1] + diag)
                if c < ncols - 1:
                    dist[k] = min(dist[k], dist[k - ncols + 1] + diag)
    for r in range(nrows - 1, -1, -1):
        for c in range(ncols - 1, -1, -1):
            k = r * ncols + c
            if c < ncols - 1:
                dist[k] = min(dist[k], dist[k + 1] + step)
            if r < nrows - 1:
                dist[k] = min(dist[k], dist[k + ncols] + step)
                if c < ncols - 1:
                    dist[k] = min(dist[k], dist[k + ncols + 1] + diag)
                if c > 0:
                    dist[k] = min(dist[k], dist[k + ncols - 1] + diag)


def corridor_grid(lines: list[list[LatLon]], radius_m: float, max_cells: int) -> Grid:
    corridor = [p for line in lines for p in densify(line, min(radius_m / 4, 5_000.0))]
    closing = closing_radius_m(radius_m)

    lats = [p[0] for p in corridor]
    lons = [p[1] for p in corridor]
    mid_lat = (min(lats) + max(lats)) / 2
    # The closing grows the corridor by `closing` before shrinking it back, so the
    # grid must reach that far for its border to count as "outside".
    pad_lat = math.degrees((radius_m + closing) / EARTH_RADIUS_M)
    pad_lon = pad_lat / max(0.1, math.cos(math.radians(mid_lat)))
    west, east = lon_to_mercator_x(min(lons) - pad_lon), lon_to_mercator_x(max(lons) + pad_lon)
    south, north = lat_to_mercator_y(min(lats) - pad_lat), lat_to_mercator_y(max(lats) + pad_lat)
    mercator_per_ground_m = 1 / math.cos(math.radians(mid_lat))

    def build(cell_m: float) -> Grid:
        step = cell_m * mercator_per_ground_m
        ncols = max(1, math.ceil((east - west) / step))
        nrows = max(1, math.ceil((north - south) / step))
        centres = [
            (mercator_y_to_lat(north - (r + 0.5) * (north - south) / nrows),
             mercator_x_to_lon(west + (c + 0.5) * (east - west) / ncols))
            for r in range(nrows) for c in range(ncols)
        ]
        # Distance to the routes: exact near each route point, chamfer elsewhere.
        to_route = [math.inf] * (ncols * nrows)
        for lat, lon in corridor:
            r = int((north - lat_to_mercator_y(lat)) / (north - south) * nrows)
            c = int((lon_to_mercator_x(lon) - west) / (east - west) * ncols)
            for rr in range(max(0, r - 1), min(nrows, r + 2)):
                for cc in range(max(0, c - 1), min(ncols, c + 2)):
                    k = rr * ncols + cc
                    to_route[k] = min(to_route[k], haversine_m((lat, lon), centres[k]))
        _chamfer(to_route, ncols, nrows, cell_m)
        # Closing: grow the corridor by `closing`, then keep what lies `closing` inside it.
        to_outside = [0.0 if d > radius_m + closing else math.inf for d in to_route]
        _chamfer(to_outside, ncols, nrows, cell_m)
        cells = [(k, centres[k]) for k in range(ncols * nrows) if to_outside[k] >= closing or to_route[k] <= radius_m]
        return Grid(west, east, south, north, ncols, nrows, cell_m, cells)

    # Start from the corridor's area, then resize toward the cell budget.
    length = sum(cumulative_distances(line)[-1] for line in lines)
    cell_m = max(MIN_CELL_M, math.sqrt(length * 2 * radius_m / max_cells))
    best: Grid | None = None
    for _ in range(10):
        grid = build(cell_m)
        n = len(grid.cells)
        if n > max_cells:
            cell_m *= 1.05 * math.sqrt(n / max_cells)
            continue
        best = grid
        if n >= 0.85 * max_cells or cell_m <= MIN_CELL_M:
            break
        cell_m = max(MIN_CELL_M, cell_m * math.sqrt(max(n, 1) / (0.95 * max_cells)))
    return best or build(cell_m * 2)


def build_heatmap(lines: list[list[LatLon]], departure: datetime, load_lb: float) -> dict:
    radius = corridor_radius_m(max(cumulative_distances(line)[-1] for line in lines))
    grid = corridor_grid(lines, radius, settings.WEATHER["MAX_HEATMAP_CELLS"])
    points = [p for _, p in grid.cells]

    start = weather.floor_hour(departure.timestamp())
    forecasts = weather.fetch_forecasts(points, start, start + HOURS * weather.HOUR) if points else {}

    # Flat arrays, hour-major: value for hour h and cell k is at h * len(cells) + k.
    layers: dict[str, list] = {"risk": [], "wind": [], "rain": [], "snow": []}
    for h in range(HOURS + 1):
        for p in points:
            wind, rain, snow = forecasts[p].frame(h)
            known = wind is not None and rain is not None and snow is not None
            layers["risk"].append(int(assess(wind, rain, snow, load_lb).level) if known else -1)
            layers["wind"].append(None if wind is None else round(wind, 1))
            layers["rain"].append(None if rain is None else round(rain, 3))
            layers["snow"].append(None if snow is None else round(snow, 3))

    return {
        "grid": grid.as_dict(radius),
        "start_utc": weather.iso_utc(start),
        "hours": HOURS,
        "layers": layers,
    }
