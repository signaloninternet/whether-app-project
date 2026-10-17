"""Upstream adapters against mocked HTTP: request shape, parsing, error mapping, caching."""

import json

import pytest
import responses
from django.core.cache import cache

from planner.services import places, weather
from planner.services.geo import destination_point, encode_polyline
from planner.services.http import UpstreamError, UpstreamRateLimited, request_json
from planner.services.routing import RoutingError, TruckProfile, osrm, valhalla

TRUCK = TruckProfile(load_lb=42_000, tare_lb=35_000, max_speed_mph=65)
VALHALLA = "https://valhalla1.openstreetmap.de/route"


@pytest.fixture(autouse=True)
def clear_cache():
    cache.clear()


def line(n=3):
    return [destination_point((40.0, -100.0), 90, 1000 * i) for i in range(n)]


def valhalla_trip(coords, seconds=120):
    return {"legs": [{"shape": encode_polyline(coords, 6), "maneuvers": [
        {"begin_shape_index": 0, "end_shape_index": len(coords) - 1, "time": seconds, "street_names": ["I 80"]},
        {"begin_shape_index": len(coords) - 1, "end_shape_index": len(coords) - 1, "time": 0},
    ]}]}


@responses.activate
def test_http_maps_rate_limits_and_server_errors():
    responses.get("https://example.test/a", status=429)
    responses.get("https://example.test/b", status=500)
    with pytest.raises(UpstreamRateLimited):
        request_json("Test", "GET", "https://example.test/a", timeout=1)
    with pytest.raises(UpstreamError):
        request_json("Test", "GET", "https://example.test/b", timeout=1)


@responses.activate
def test_valhalla_request_uses_truck_costing_and_returns_alternates():
    responses.post(VALHALLA, json={"trip": valhalla_trip(line()), "alternates": [{"trip": valhalla_trip(line(), 150)}]})
    routes = valhalla.route((40.0, -100.0), (40.0, -99.98), TRUCK, alternates=2)
    body = json.loads(responses.calls[0].request.body)
    assert body["costing"] == "truck" and body["alternates"] == 2
    assert body["costing_options"]["truck"]["weight"] == TRUCK.gross_weight_t
    assert [r.strategy for r in routes] == ["fastest", "alternate"]
    assert routes[0].road_names == ["I-80"] and routes[1].drive_s == pytest.approx(150)


@responses.activate
def test_valhalla_error_codes():
    responses.post(VALHALLA, status=400, json={"error_code": 442, "error": "No path could be found"})
    with pytest.raises(RoutingError):
        valhalla.route((40.0, -100.0), (40.0, -99.0), TRUCK)
    responses.replace(responses.POST, VALHALLA, status=400, json={"error_code": 154, "error": "too far"})
    with pytest.raises(valhalla.DistanceLimitExceeded):
        valhalla.route((40.0, -100.0), (40.0, -99.0), TRUCK)


@responses.activate
def test_valhalla_stitches_long_requests_with_headings(settings):
    settings.ROUTING = {**settings.ROUTING, "VALHALLA_MAX_KM": 300}
    points = [destination_point((40.0, -100.0), 90, k * 200_000) for k in range(4)]  # 600 km in 3 hops
    seen = []

    def reply(request):
        body = json.loads(request.body)
        seen.append(body["locations"])
        coords = [(loc["lat"], loc["lon"]) for loc in body["locations"]]
        return 200, {}, json.dumps({"trip": valhalla_trip(coords, 3600)})

    responses.add_callback(responses.POST, VALHALLA, callback=reply)
    waypoints = [valhalla.Waypoint(points[0])] + [valhalla.Waypoint(p, heading=90, highway=True) for p in points[1:-1]] \
        + [valhalla.Waypoint(points[-1])]
    route = valhalla.route_through(waypoints, TRUCK, "corridor")
    assert len(seen) == 3  # 200 km hops, 300 km budget: one hop per request
    # Requests run in parallel, so order them by where they start (the route runs east).
    ordered = sorted(seen, key=lambda locs: locs[0]["lon"])
    assert "heading" not in ordered[0][0]  # the real origin has no forced direction
    junctions = [locs[0] for locs in ordered[1:]]
    assert all(j["heading"] == 90 and j["search_filter"] == {"min_road_class": "primary"} for j in junctions)
    assert route.drive_s == pytest.approx(3 * 3600)
    assert route.cum_drive_s == sorted(route.cum_drive_s)


@responses.activate
def test_osrm_route_and_errors():
    url = "https://router.project-osrm.org/route/v1/driving/-100.000000,40.000000;-99.900000,40.000000"
    coords = line()
    responses.get(url, json={"code": "Ok", "routes": [{
        "geometry": encode_polyline(coords, 6), "duration": 60, "distance": 2000,
        "legs": [{"annotation": {"duration": [30, 30], "distance": [1000, 1000]}, "steps": [{"ref": "I 70", "distance": 2000}]}],
    }]})
    routes = osrm.route([(40.0, -100.0), (40.0, -99.9)], TRUCK, alternatives=2)
    assert responses.calls[0].request.params["alternatives"] == "2"
    assert routes[0].engine == "osrm-car" and routes[0].road_names == ["I-70"]
    responses.replace(responses.GET, url, status=400, json={"code": "NoRoute", "message": "Impossible route"})
    with pytest.raises(RoutingError):
        osrm.route([(40.0, -100.0), (40.0, -99.9)], TRUCK)


def open_meteo_location(start, hours, wind=12.0):
    return {"hourly": {
        "time": [start + h * 3600 for h in range(hours)],
        "wind_speed_10m": [wind] * hours, "wind_gusts_10m": [wind + 5] * hours,
        "rain": [0.05] * hours, "showers": [0.01] * hours, "snowfall": [0.0] * hours,
        "temperature_2m": [40.0] * hours, "weather_code": [61] * hours,
    }}


@responses.activate
def test_weather_bulk_fetch_units_window_and_cache():
    start = 1_800_000_000 // 3600 * 3600
    points = [(40.0, -100.0), (41.0, -101.0)]
    responses.get("https://api.open-meteo.com/v1/forecast",
                  json=[open_meteo_location(start, 4), open_meteo_location(start, 4, wind=30)])
    series = weather.fetch_forecasts(points, start + 600, start + 2 * 3600 + 60)
    params = responses.calls[0].request.params
    assert params["wind_speed_unit"] == "mph" and params["precipitation_unit"] == "inch"
    assert params["start_hour"] == "2027-01-15T08:00" and params["end_hour"] == "2027-01-15T11:00"
    assert series[points[1]].wind[0] == 30 and series[points[0]].rain[0] == pytest.approx(0.06)
    weather.fetch_forecasts(points, start + 600, start + 2 * 3600 + 60)
    assert len(responses.calls) == 1  # second call served from cache


@responses.activate
def test_weather_rejects_mismatched_payloads():
    responses.get("https://api.open-meteo.com/v1/forecast", json={"error": True, "reason": "Latitude must be in range"})
    with pytest.raises(UpstreamError):
        weather.fetch_forecasts([(95.0, 0.0)], 0, 3600)


@responses.activate
def test_geocoding_labels_dedupe_and_reverse():
    feature = lambda name, **props: {"geometry": {"coordinates": [-87.62, 41.88]},  # noqa: E731
                                     "properties": {"name": name, **props}}
    responses.get("https://photon.komoot.io/api/", json={"features": [
        feature("Chicago", state="Illinois", country="United States", type="city"),
        feature("Chicago", state="Illinois", country="United States", type="city"),  # duplicate
        feature("Willis Tower", street="South Wacker Drive", housenumber="233", city="Chicago",
                state="Illinois", country="United States", type="house"),
    ]})
    found = places.search("chicago")
    assert [(p.name, p.label) for p in found] == [
        ("Chicago", "Illinois, United States"),
        ("Willis Tower", "233 South Wacker Drive, Chicago, Illinois, United States"),
    ]
    places.search("chicago")
    assert len(responses.calls) == 1  # cached
    responses.get("https://photon.komoot.io/reverse", json={"features": []})
    assert places.reverse((0.0, 0.0)) is None


@responses.activate
def test_timezone_lookup():
    responses.get("https://api.open-meteo.com/v1/forecast",
                  json={"timezone": "America/Chicago", "timezone_abbreviation": "CDT", "utc_offset_seconds": -18000})
    tz = places.timezone_at((41.88, -87.62))
    assert (tz.name, tz.abbreviation, tz.utc_offset_s) == ("America/Chicago", "CDT", -18000)
    assert responses.calls[0].request.params["timezone"] == "auto"
