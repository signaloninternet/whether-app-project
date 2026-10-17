from planner.services.risk import Risk
from planner.services.scoring import RiskSummary, ScoredRoute, plan_warnings, recommend


def summary(**miles) -> RiskSummary:
    s = RiskSummary()
    for key, value in miles.items():
        s.add(Risk[key.upper()], value)
    return s


def test_average_risk_is_mile_weighted():
    s = summary(low=75, high=25)
    assert s.avg_risk == 0.5
    assert s.max_level == Risk.HIGH
    s.add(None, 10)
    assert s.unknown_miles == 10 and s.avg_risk == 0.5  # unknown stretches don't dilute the average


def test_fewest_severe_beats_faster_route():
    routes = [
        ScoredRoute("A", summary(low=900, severe=50), travel_s=10 * 3600),
        ScoredRoute("B", summary(low=950, high=100), travel_s=13 * 3600),
    ]
    rec = recommend(routes)
    assert rec["route_id"] == "B" and rec["decided_by"] == "severe_miles"
    assert rec["reasons"][-1].startswith("Severe miles: 0 mi vs 50 mi on A")


def test_no_travel_miles_rank_before_severe():
    routes = [
        ScoredRoute("A", summary(low=990, no_travel=10), travel_s=10 * 3600),
        ScoredRoute("B", summary(low=900, severe=100), travel_s=11 * 3600),
    ]
    assert recommend(routes)["route_id"] == "B"


def test_high_miles_then_average_then_time():
    by_high = [
        ScoredRoute("A", summary(low=900, high=30), travel_s=1),
        ScoredRoute("B", summary(low=900, high=20, moderate=500), travel_s=2),
    ]
    assert recommend(by_high)["decided_by"] == "high_miles"
    assert recommend(by_high)["route_id"] == "B"

    by_avg = [
        ScoredRoute("A", summary(low=500, moderate=500), travel_s=1),
        ScoredRoute("B", summary(low=900, moderate=100), travel_s=2),
    ]
    assert recommend(by_avg)["route_id"] == "B" and recommend(by_avg)["decided_by"] == "avg_risk"

    by_time = [
        ScoredRoute("A", summary(low=1000), travel_s=20 * 3600),
        ScoredRoute("B", summary(low=1100), travel_s=18 * 3600),
        ScoredRoute("C", summary(low=1200), travel_s=19 * 3600),
    ]
    rec = recommend(by_time)
    assert rec["ranking"] == ["B", "C", "A"] and rec["decided_by"] == "travel_time"
    assert "shortest travel time" in rec["headline"]


def test_float_noise_does_not_decide():
    routes = [
        ScoredRoute("A", summary(low=900, high=20.04), travel_s=10 * 3600),
        ScoredRoute("B", summary(low=900, high=20.0), travel_s=12 * 3600),
    ]
    assert recommend(routes)["route_id"] == "A"  # 20.04 and 20.0 tie at 0.1 mi, A is faster


def test_criteria_table_lists_every_route():
    rec = recommend([ScoredRoute("A", summary(low=10), 60), ScoredRoute("B", summary(low=10), 90)])
    keys = [c["key"] for c in rec["criteria"]]
    assert keys == ["no_travel_miles", "severe_miles", "high_miles", "avg_risk", "travel_time"]
    assert rec["criteria"][-1]["values"] == {"A": 60, "B": 90}


def test_single_route():
    rec = recommend([ScoredRoute("A", summary(low=10), 60)])
    assert rec["route_id"] == "A" and rec["decided_by"] is None


def test_plan_warnings():
    assert plan_warnings(summary(low=10)) == []
    assert "Severe" in plan_warnings(summary(low=10, severe=5))[0]
    assert "No Travel" in plan_warnings(summary(low=10, no_travel=5))[0]
