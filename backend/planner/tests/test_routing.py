import pytest

from planner.services.geo import METERS_PER_MILE, cumulative_distances, destination_point, encode_polyline
from planner.services.routing import RouteCandidate, TruckProfile, options, osrm, valhalla
from planner.services.routing.types import distinct_labels, main_road_names, normalise_ref

TRUCK = TruckProfile(load_lb=40_000, tare_lb=35_000, max_speed_mph=65)


def line_east(start, km, n=40):
    return [destination_point(start, 90, km * 1000 * i / n) for i in range(n + 1)]


def candidate(coords, drive_s, strategy="fastest") -> RouteCandidate:
    cum = cumulative_distances(coords)
    return RouteCandidate(coords, cum, [drive_s * d / cum[-1] for d in cum], "test", strategy)


def test_gross_weight_in_metric_tons():
    assert TRUCK.gross_weight_t == pytest.approx(75_000 / 2204.62, abs=0.01)


def test_valhalla_maneuver_times_spread_over_shape():
    coords = line_east((40.0, -100.0), 4, n=4)
    trip = {"legs": [{
        "shape": encode_polyline(coords, 6),
        "maneuvers": [
            {"begin_shape_index": 0, "end_shape_index": 2, "time": 100, "street_names": ["I 80"]},
            {"begin_shape_index": 2, "end_shape_index": 4, "time": 300, "street_names": ["US 6"]},
            {"begin_shape_index": 4, "end_shape_index": 4, "time": 0},
        ],
    }]}
    route = valhalla._candidate([valhalla._parse_trip(trip)], "fastest")
    assert route.cum_drive_s == pytest.approx([0, 50, 100, 250, 400], abs=0.5)
    assert route.road_names == ["I-80", "US-6"]  # different maneuvers, so both count


def test_valhalla_legs_are_joined_once():
    a = line_east((40.0, -100.0), 2, n=2)
    b = line_east(a[-1], 2, n=2)
    trip = {"legs": [
        {"shape": encode_polyline(a, 6), "maneuvers": [{"begin_shape_index": 0, "end_shape_index": 2, "time": 60}]},
        {"shape": encode_polyline(b, 6), "maneuvers": [{"begin_shape_index": 0, "end_shape_index": 2, "time": 60}]},
    ]}
    route = valhalla._candidate([valhalla._parse_trip(trip)], "corridor")
    assert len(route.coords) == 5
    assert route.cum_drive_s[-1] == pytest.approx(120)
    assert route.cum_drive_s == sorted(route.cum_drive_s)


def test_osrm_segments_are_capped_at_truck_speed():
    coords = line_east((40.0, -100.0), 2, n=2)
    payload_route = {
        "geometry": encode_polyline(coords, 6),
        "duration": 20,
        "legs": [{"annotation": {"duration": [10, 10], "distance": [1000, 1000]},
                  "steps": [{"ref": "I 70", "distance": 2000}]}],
    }
    route = osrm._candidate(payload_route, TRUCK, "fastest")
    per_km = 1000 / (65 * METERS_PER_MILE / 3600)  # ~34.4 s at 65 mph
    assert route.cum_drive_s == pytest.approx([0, per_km, 2 * per_km], rel=1e-3)
    assert route.road_names == ["I-70"]


def test_road_name_ranking_prefers_highway_refs():
    names = main_road_names([(["Main Street"], 50_000), (["I 80;US 6"], 30_000), (["I 76 West"], 20_000)], limit=2)
    assert names == ["I-80", "I-76"]  # US-6 rides along I-80; Interstates win the label
    # Weighted distance decides: US-36 400 km x1.2 beats I-70 300 km x1.5; IL-110 misses the cut.
    assert main_road_names([(["US 36"], 400_000), (["I 70"], 300_000), (["IL 110"], 350_000)], limit=2) == ["US-36", "I-70"]


def test_distinct_labels_tell_similar_routes_apart():
    ranked = [["I-80", "I-76"], ["I-70", "US-36", "I-55"], ["I-70", "US-36", "US-24"]]
    assert distinct_labels(ranked) == [["I-80", "I-76"], ["I-70", "US-36"], ["I-70", "US-24"]]
    assert distinct_labels([["I-45"], ["I-45"]]) == [["I-45"], ["I-45"]]  # nothing else to tell them apart


def test_normalise_ref():
    assert normalise_ref("SR 99") == "SR-99"
    assert normalise_ref("I 80 Alt") == "I-80"
    assert normalise_ref("US 30 West") == "US-30"
    assert normalise_ref("Broadway") is None
    assert normalise_ref("Chicago-Kansas City Expressway") is None


def test_shared_fraction():
    base = candidate(line_east((40.0, -100.0), 100), 3600)
    same = candidate(line_east((40.0, -100.0), 100), 3700)
    far = candidate(line_east((41.0, -100.0), 100), 3600)
    assert options.shared_fraction(base, same) == pytest.approx(1.0, abs=0.02)
    assert options.shared_fraction(base, far) == pytest.approx(0.0, abs=0.02)


def test_route_options_dedupes_and_fills_with_corridors(monkeypatch):
    origin, dest = (40.0, -100.0), destination_point((40.0, -100.0), 90, 300_000)
    main = candidate(line_east(origin, 300), 4 * 3600)
    duplicate = candidate(line_east(origin, 300), 4.1 * 3600, "alternate")
    north = candidate(line_east((40.6, -100.0), 300), 4.4 * 3600, "corridor")
    south = candidate(line_east((39.4, -100.0), 300), 4.6 * 3600, "corridor")
    monkeypatch.setattr(valhalla, "route", lambda *a, **k: [main, duplicate])
    corridor_results = iter([north, south])
    monkeypatch.setattr(options, "_valhalla_corridor", lambda *a: next(corridor_results))

    result = options.route_options(origin, dest, TRUCK)
    assert result.engine == "valhalla"
    assert [r.strategy for r in result.routes] == ["fastest", "corridor", "corridor"]
    assert result.notes == []


def test_route_options_rejects_slow_corridors(monkeypatch):
    origin, dest = (40.0, -100.0), destination_point((40.0, -100.0), 90, 300_000)
    main = candidate(line_east(origin, 300), 4 * 3600)
    slow = candidate(line_east((40.6, -100.0), 300), 6 * 3600, "corridor")  # 50% slower
    monkeypatch.setattr(valhalla, "route", lambda *a, **k: [main])
    monkeypatch.setattr(options, "_valhalla_corridor", lambda *a: slow)

    result = options.route_options(origin, dest, TRUCK)
    assert len(result.routes) == 1
    assert "Only 1 distinct route" in result.notes[-1]


def test_regional_falls_back_to_osrm_when_valhalla_is_down(monkeypatch):
    origin, dest = (40.0, -100.0), destination_point((40.0, -100.0), 90, 300_000)

    def down(*a, **k):
        raise options.UpstreamError("Valhalla routing", "unreachable")

    monkeypatch.setattr(valhalla, "route", down)
    monkeypatch.setattr(osrm, "route", lambda *a, **k: [candidate(line_east(origin, 300), 4 * 3600)])
    monkeypatch.setattr(options, "_osrm_corridor", lambda *a: None)
    result = options.route_options(origin, dest, TRUCK)
    assert result.engine == "osrm" and "unavailable" in result.notes[0]


def test_long_haul_reroutes_osrm_corridors_for_trucks(monkeypatch):
    origin, dest = (40.0, -100.0), destination_point((40.0, -100.0), 90, 2_500_000)
    skeletons = [candidate(line_east(origin, 2500), 30 * 3600),
                 candidate(line_east((41.5, -100.0), 2500), 32 * 3600, "alternate")]
    monkeypatch.setattr(osrm, "route", lambda *a, **k: skeletons)
    monkeypatch.setattr(options, "_osrm_corridor", lambda *a: None)
    seen = []

    def truck_route(waypoints, truck, strategy):
        seen.append(waypoints)
        rerouted = candidate([w.point for w in waypoints], 33 * 3600, strategy)
        rerouted.engine = "valhalla-truck"
        return rerouted

    monkeypatch.setattr(valhalla, "route_through", truck_route)
    result = options.route_options(origin, dest, TRUCK)
    assert result.engine == "valhalla"
    assert {r.engine for r in result.routes} == {"valhalla-truck"}
    assert len(seen) == 2 and all(w.heading is not None for w in seen[0][1:-1])


def test_long_haul_keeps_osrm_geometry_when_truck_router_fails(monkeypatch):
    origin, dest = (40.0, -100.0), destination_point((40.0, -100.0), 90, 2_500_000)
    skeleton = candidate(line_east(origin, 2500), 30 * 3600)
    skeleton.engine = "osrm-car"
    monkeypatch.setattr(osrm, "route", lambda *a, **k: [skeleton])
    monkeypatch.setattr(options, "_osrm_corridor", lambda *a: None)

    def fail(*a):
        raise valhalla.DistanceLimitExceeded()

    monkeypatch.setattr(valhalla, "route_through", fail)
    result = options.route_options(origin, dest, TRUCK)
    assert result.engine == "osrm" and result.routes[0] is skeleton
    assert any("OSRM" in n for n in result.notes)


def test_split_packs_waypoints_into_requests_under_the_limit(settings):
    settings.ROUTING = {**settings.ROUTING, "VALHALLA_MAX_KM": 1000}
    start = (40.0, -100.0)
    waypoints = [valhalla.Waypoint(destination_point(start, 90, k * 400_000)) for k in range(6)]  # 2,000 km
    groups = valhalla._split(waypoints)
    assert all(valhalla.within_limit([w.point for w in g]) for g in groups)
    assert [len(g) for g in groups] == [3, 3, 2] and groups[0][-1] == groups[1][0]


def test_skeleton_waypoints_are_spaced_and_carry_headings():
    skeleton = candidate(line_east((40.0, -100.0), 2000, n=200), 30 * 3600)
    wps = options.skeleton_waypoints(skeleton)
    assert wps[0].point == skeleton.coords[0] and wps[-1].point == skeleton.coords[-1]
    assert len(wps) == 1 + 5  # ceil(2000 / 450) hops
    # An eastbound great circle from 40N slowly turns south-east.
    headings = [w.heading for w in wps[1:-1]]
    assert all(85 < h < 115 for h in headings) and headings == sorted(headings)
    assert all(w.highway for w in wps[1:-1])


def test_too_close_points_are_rejected():
    with pytest.raises(options.RoutingError):
        options.route_options((40.0, -100.0), (40.001, -100.0), TRUCK)
