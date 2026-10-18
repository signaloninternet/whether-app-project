import math
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from rest_framework.test import APIClient

from planner.services import planner as planner_service
from planner.services import weather
from planner.services.geo import cumulative_distances, destination_point
from planner.services.routing import RouteCandidate, RouteOptions
from planner.services.weather import HOUR, HourlyForecast

ORIGIN = (41.8756, -87.6244)
DEST = (41.8756, -92.4)


def route(bulge_deg: float, hours: float, name: str) -> RouteCandidate:
    """An alternative from ORIGIN to DEST that bows north (+) or south (-) mid-trip."""
    coords = [
        (ORIGIN[0] + bulge_deg * math.sin(math.pi * t), ORIGIN[1] + (DEST[1] - ORIGIN[1]) * t)
        for t in (i / 80 for i in range(81))
    ]
    cum = cumulative_distances(coords)
    r = RouteCandidate(coords, cum, [hours * HOUR * d / cum[-1] for d in cum], "valhalla-truck", "fastest")
    r.road_names = [name]
    return r


@pytest.fixture
def fake_world(monkeypatch):
    """Three routes; a 40 mph wind band sits mid-trip and only the northern one (B) bows around it."""
    routes = [route(0.0, 4.0, "I-80"), route(0.5, 4.3, "I-90"), route(-0.5, 4.5, "I-70")]
    monkeypatch.setattr(planner_service, "route_options",
                        lambda o, d, truck: RouteOptions(routes=routes, engine="valhalla"))

    def fake_fetch(points, start, end):
        start_h, n = weather.floor_hour(start), int((weather.floor_hour(end) - weather.floor_hour(start)) // HOUR) + 2
        out = {}
        for p in points:
            in_band = -91.0 < p[1] < -89.0 and p[0] < ORIGIN[0] + 0.25
            wind = 40.0 if in_band else 10.0
            out[p] = HourlyForecast(start_h, (wind,) * n, (wind + 10,) * n, (0.0,) * n, (0.0,) * n, (50.0,) * n, (3,) * n)
        return out

    monkeypatch.setattr(weather, "fetch_forecasts", fake_fetch)
    return routes


def departure_in(hours: float) -> str:
    local = datetime.now(ZoneInfo("America/Chicago")) + timedelta(hours=hours)
    return local.replace(tzinfo=None).isoformat(timespec="minutes")


def plan_body(**overrides):
    body = {
        "origin": {"lat": ORIGIN[0], "lon": ORIGIN[1], "label": "Chicago"},
        "destination": {"lat": DEST[0], "lon": DEST[1], "label": "Iowa"},
        "departure": departure_in(2),
        "timezone": "America/Chicago",
        "load_weight_lb": 42_000,
        "interval_mi": 25,
        "hos_breaks": False,
    }
    body.update(overrides)
    return body


@pytest.mark.django_db(databases=[])
def test_plan_end_to_end(fake_world):
    res = APIClient().post("/api/plan", plan_body(), format="json")
    assert res.status_code == 200, res.json()
    plan = res.json()
    assert [r["id"] for r in plan["routes"]] == ["A", "B", "C"]
    a, b, _ = plan["routes"]
    # 40 mph wind with a 42,000 lb load is escalated from High to Severe.
    assert a["risk"]["max_level"] == 3
    assert any(cp["risk"]["load_rule"] for cp in a["checkpoints"])
    # The slower but calm route wins over the fastest one.
    assert plan["recommendation"]["route_id"] == "B" and b["recommended"]
    assert plan["recommendation"]["decided_by"] == "severe_miles"
    assert plan["warnings"] == []
    assert sum(a["risk"]["miles_by_level"].values()) == pytest.approx(a["distance_mi"], abs=0.2)
    assert a["checkpoints"][0]["eta_utc"] == plan["departure_utc"]
    assert all(isinstance(cp["weather"]["is_day"], bool) for cp in a["checkpoints"])
    assert len(plan["heatmap_request"]["routes"]) == 3


@pytest.mark.django_db(databases=[])
def test_plan_with_hos_breaks_stretches_arrival(fake_world, monkeypatch):
    long_route = route(0.0, 13.0, "I-80")
    monkeypatch.setattr(planner_service, "route_options",
                        lambda o, d, truck: RouteOptions(routes=[long_route], engine="valhalla"))
    plan = APIClient().post("/api/plan", plan_body(hos_breaks=True), format="json").json()
    only = plan["routes"][0]
    assert [s["kind"] for s in only["stops"]] == ["break", "rest"]
    assert only["travel_time_s"] == pytest.approx((13 + 0.5 + 10) * HOUR, abs=2)
    knots = only["timeline"]
    parked = [(t1, t2) for (t1, m1), (t2, m2) in zip(knots, knots[1:]) if m1 == m2 and t2 > t1]
    assert [round((t2 - t1) / HOUR, 1) for t1, t2 in parked] == [0.5, 10.0]


@pytest.mark.parametrize(
    "overrides, field",
    [
        ({"interval_mi": 15}, "interval_mi"),
        ({"load_weight_lb": 120_000}, "load_weight_lb"),
        ({"departure": "tomorrow"}, "departure"),
        ({"departure": "2026-01-01T08:00+02:00"}, "departure"),
        ({"timezone": "Mars/Olympus"}, "timezone"),
    ],
)
@pytest.mark.django_db(databases=[])
def test_plan_validation_errors(overrides, field):
    res = APIClient().post("/api/plan", plan_body(**overrides), format="json")
    assert res.status_code == 400
    assert field in res.json()["error"]["fields"]


@pytest.mark.django_db(databases=[])
def test_plan_rejects_past_and_far_future_departures(fake_world):
    for hours in (-3, 24 * 9):
        res = APIClient().post("/api/plan", plan_body(departure=departure_in(hours)), format="json")
        assert res.status_code == 400
        assert res.json()["error"]["code"] == "invalid"


@pytest.mark.django_db(databases=[])
def test_heatmap_grid_and_layers(fake_world):
    plan = APIClient().post("/api/plan", plan_body(), format="json").json()
    res = APIClient().post("/api/heatmap", plan["heatmap_request"], format="json")
    assert res.status_code == 200, res.json()
    heat = res.json()
    cells = len(heat["grid"]["cells"])
    assert 0 < cells <= 120
    assert all(len(layer) == cells * (heat["hours"] + 1) for layer in heat["layers"].values())
    assert set(heat["layers"]["risk"]) <= {0, 1, 2, 3}
    assert max(heat["grid"]["cells"]) < heat["grid"]["ncols"] * heat["grid"]["nrows"]


@pytest.mark.django_db(databases=[])
def test_geocode_accepts_raw_coordinates():
    res = APIClient().get("/api/geocode", {"q": "39.74, -104.99"})
    assert res.json()["results"][0]["kind"] == "coordinates"


@pytest.mark.django_db(databases=[])
def test_rules_endpoint():
    rules = APIClient().get("/api/rules").json()
    assert rules["wind"]["no_travel"] == 55 and len(rules["load_rules"]) == 2


def test_corridor_closing_fills_narrow_gaps_but_not_wide_ones():
    from planner.services.heatmap import corridor_grid

    def line(lat):
        return [destination_point((lat, -100.0), 90, 600_000 * i / 60) for i in range(61)]

    near = corridor_grid([line(40.0), line(41.6)], radius_m=60_000, max_cells=400)  # ~178 km apart
    far = corridor_grid([line(40.0), line(45.0)], radius_m=60_000, max_cells=400)  # ~556 km apart

    def covered_between(grid, lat):
        from planner.services.geo import haversine_m
        mid = (lat, -97.0)
        return any(haversine_m(p, mid) < grid.cell_m for _, p in grid.cells)

    assert covered_between(near, 40.8)  # gap between corridors filled
    assert not covered_between(far, 42.5)  # distinct corridors stay distinct


@pytest.mark.django_db(databases=[])
def test_plan_survives_a_forecast_outage(fake_world, monkeypatch):
    from planner.services.http import UpstreamRateLimited

    def down(*a, **k):
        raise UpstreamRateLimited("Open-Meteo weather", "rate limit reached")

    monkeypatch.setattr(weather, "fetch_forecasts", down)
    res = APIClient().post("/api/plan", plan_body(load_weight_lb=1234), format="json")
    assert res.status_code == 200
    plan = res.json()
    assert plan["forecast_available"] is False and "couldn't be assessed" in plan["warnings"][0]
    assert all(r["risk"]["unknown_miles"] > 0 and r["risk"]["max_level"] is None for r in plan["routes"])
    assert all(cp["risk"] is None for cp in plan["routes"][0]["checkpoints"])
    assert plan["recommendation"]["route_id"] == "A" and "unknown" in plan["recommendation"]["headline"]


@pytest.mark.django_db(databases=[])
def test_cached_plan_echoes_this_requests_labels(fake_world):
    first = APIClient().post("/api/plan", plan_body(), format="json").json()
    body = plan_body()
    body["origin"]["label"] = "Chicago, IL (yard 7)"
    second = APIClient().post("/api/plan", body, format="json").json()
    assert second["plan_id"] == first["plan_id"]
    assert second["inputs"]["origin"]["label"] == "Chicago, IL (yard 7)"


@pytest.mark.django_db(databases=[])
def test_missing_forecast_hours_are_flagged(fake_world, monkeypatch):
    real = weather.fetch_forecasts

    def gappy(points, start, end):
        out = real(points, start, end)
        # Blank every forecast west of -91 (no data for the last stretch of each route).
        return {p: (s if p[1] > -91 else HourlyForecast(s.start, (None,) * len(s.wind), s.gust, s.rain, s.snow, s.temp, s.code))
                for p, s in out.items()}

    monkeypatch.setattr(weather, "fetch_forecasts", gappy)
    plan = APIClient().post("/api/plan", plan_body(load_weight_lb=4321), format="json").json()
    assert any("No forecast for" in w for w in plan["warnings"])
    assert all(r["risk"]["unknown_miles"] > 0 for r in plan["routes"])


@pytest.mark.parametrize("routes, message", [
    (["_p~iF~ps|U_ulLnnqC", "_ibE_seK_seK_seK"], "share their origin"),
    (["_ibE_seK", "_ibE_seK"], "Each route needs"),
])
@pytest.mark.django_db(databases=[])
def test_heatmap_rejects_unrelated_or_degenerate_routes(routes, message):
    res = APIClient().post("/api/heatmap", {"routes": routes, "departure_utc": departure_in_utc(2),
                                            "load_weight_lb": 1000}, format="json")
    assert res.status_code == 400 and message in res.json()["error"]["message"]


@pytest.mark.django_db(databases=[])
def test_heatmap_rejects_huge_spans():
    from planner.services.geo import encode_polyline
    a = encode_polyline([(10.0, -170.0), (60.0, 170.0)])
    res = APIClient().post("/api/heatmap", {"routes": [a, a], "departure_utc": departure_in_utc(2),
                                            "load_weight_lb": 1000}, format="json")
    assert res.status_code == 400 and "too large" in res.json()["error"]["message"]


def test_corridor_grid_border_is_never_fetched():
    from planner.services.heatmap import corridor_grid

    lines = [[destination_point((40.0, -100.0), 90, 800_000 * i / 80) for i in range(81)],
             [destination_point((41.2, -100.0), 90, 800_000 * i / 80) for i in range(81)]]
    grid = corridor_grid(lines, radius_m=70_000, max_cells=200)
    border = {k for k in range(grid.ncols * grid.nrows)
              if k < grid.ncols or k >= grid.ncols * (grid.nrows - 1) or k % grid.ncols in (0, grid.ncols - 1)}
    assert not border & {k for k, _ in grid.cells}


def departure_in_utc(hours: float) -> str:
    return (datetime.now(ZoneInfo("UTC")) + timedelta(hours=hours)).isoformat()
