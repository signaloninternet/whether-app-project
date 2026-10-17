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


def route(lat_shift: float, hours: float, name: str) -> RouteCandidate:
    start = (ORIGIN[0] + lat_shift, ORIGIN[1])
    coords = [destination_point(start, 270, 400_000 * i / 80) for i in range(81)]
    cum = cumulative_distances(coords)
    r = RouteCandidate(coords, cum, [hours * HOUR * d / cum[-1] for d in cum], "valhalla-truck", "fastest")
    r.road_names = [name]
    return r


@pytest.fixture
def fake_world(monkeypatch):
    """Three routes; only the northern one (B) avoids 40 mph wind, and A is fastest."""
    routes = [route(0.0, 4.0, "I-80"), route(0.5, 4.3, "I-90"), route(-0.5, 4.5, "I-70")]
    monkeypatch.setattr(planner_service, "route_options",
                        lambda o, d, truck: RouteOptions(routes=routes, engine="valhalla"))

    def fake_fetch(points, start, end):
        start_h, n = weather.floor_hour(start), int((weather.floor_hour(end) - weather.floor_hour(start)) // HOUR) + 2
        out = {}
        for p in points:
            wind = 10.0 if p[0] > ORIGIN[0] + 0.25 else 40.0
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
        "destination": {"lat": 41.8, "lon": -92.4, "label": "Iowa"},
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
