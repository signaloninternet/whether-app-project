import pytest

from planner.services.geo import METERS_PER_MILE, cumulative_distances, destination_point
from planner.services.hos import HOUR, Stop, elapsed_for_drive, schedule_stops
from planner.services.routing import RouteCandidate
from planner.services.sampling import checkpoint_miles, mile_at_drive_time, place_checkpoints


def test_no_stops_on_short_trips():
    assert schedule_stops(7.9 * HOUR) == []
    assert schedule_stops(8 * HOUR) == []  # arriving exactly at the limit needs no break


def test_break_then_rest_pattern():
    stops = schedule_stops(30 * HOUR)
    assert [(s.kind, s.at_drive_s / HOUR, s.duration_s / HOUR) for s in stops] == [
        ("break", 8, 0.5), ("rest", 11, 10), ("break", 19, 0.5), ("rest", 22, 10),
    ]


@pytest.mark.parametrize(
    "drive_h, elapsed_h",
    [(4, 4), (8, 8), (9, 9.5), (11, 11.5), (12, 22.5), (20, 31)],
)
def test_elapsed_time_includes_stops_already_taken(drive_h, elapsed_h):
    stops = schedule_stops(40 * HOUR)
    assert elapsed_for_drive(drive_h * HOUR, stops) == pytest.approx(elapsed_h * HOUR)


def test_elapsed_without_stops_is_drive_time():
    assert elapsed_for_drive(5 * HOUR, []) == 5 * HOUR
    assert elapsed_for_drive(5 * HOUR, [Stop("rest", 6 * HOUR, 10 * HOUR)]) == 5 * HOUR


@pytest.mark.parametrize(
    "total, interval, expected",
    [
        (100.3, 25, [0, 25, 50, 75, 100.3]),  # destination merges into the last checkpoint
        (110, 25, [0, 25, 50, 75, 100, 110]),
        (40, 50, [0, 40]),
        (50, 50, [0, 50]),
    ],
)
def test_checkpoint_miles(total, interval, expected):
    assert checkpoint_miles(total, interval) == pytest.approx(expected)


def straight_route(miles: float, mph: float) -> RouteCandidate:
    """A due-north route driven at constant speed, vertices every mile."""
    start = (35.0, -100.0)
    coords = [destination_point(start, 0, k * METERS_PER_MILE) for k in range(int(miles) + 1)]
    cum = cumulative_distances(coords)
    return RouteCandidate(coords, cum, [d / METERS_PER_MILE / mph * HOUR for d in cum], "test", "fastest")


def test_checkpoints_positions_times_and_coverage():
    route = straight_route(120, mph=60)
    cps = place_checkpoints(route, 25)
    assert [round(cp.mile) for cp in cps] == [0, 25, 50, 75, 100, 120]
    assert cps[2].drive_s == pytest.approx(50 / 60 * HOUR, rel=1e-3)
    assert cps[0].covers == (0.0, 12.5)
    assert cps[-1].covers == pytest.approx((110.0, route.distance_m / METERS_PER_MILE))
    assert sum(cp.covered_miles for cp in cps) == pytest.approx(route.distance_m / METERS_PER_MILE)


def test_mile_at_drive_time_inverts_timing():
    route = straight_route(100, mph=50)
    assert mile_at_drive_time(route, 1 * HOUR) == pytest.approx(50, rel=1e-3)
