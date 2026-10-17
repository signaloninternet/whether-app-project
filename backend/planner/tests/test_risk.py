import pytest

from planner.services.risk import (
    LOAD_RULE_HIGH_WIND,
    LOAD_RULE_STRONG_WIND,
    Risk,
    assess,
    classify_rain,
    classify_snow,
    classify_wind,
    rules_table,
    wind_with_load,
)

L, M, H, S, X = Risk.LOW, Risk.MODERATE, Risk.HIGH, Risk.SEVERE, Risk.NO_TRAVEL


@pytest.mark.parametrize(
    "mph, level",
    [(0, L), (24.9, L), (25, M), (34, M), (34.9, M), (35, H), (44.9, H), (45, S), (54.9, S), (55, X), (80, X)],
)
def test_wind_bands(mph, level):
    assert classify_wind(mph) == level


@pytest.mark.parametrize(
    "inches, level",
    [(0, L), (0.099, L), (0.10, M), (0.249, M), (0.25, H), (0.499, H), (0.50, S), (1.00, S), (1.001, X)],
)
def test_rain_bands(inches, level):
    assert classify_rain(inches) == level


@pytest.mark.parametrize(
    "inches, level",
    [(0, L), (0.49, L), (0.5, M), (0.99, M), (1.0, H), (1.99, H), (2.0, S), (3.0, S), (3.01, X)],
)
def test_snow_bands(inches, level):
    assert classify_snow(inches) == level


@pytest.mark.parametrize(
    "mph, load, level, rule",
    [
        (60, 0, X, None),  # >= 55 mph is No Travel for any load, no load rule involved
        (50, 30_000, S, None),  # rule needs strictly more than 30,000 lb
        (50, 30_001, X, LOAD_RULE_HIGH_WIND),
        (45, 45_000, X, LOAD_RULE_HIGH_WIND),
        (40, 40_000, H, None),  # rule needs strictly more than 40,000 lb
        (40, 40_001, S, LOAD_RULE_STRONG_WIND),
        (35, 80_000, S, LOAD_RULE_STRONG_WIND),
        (40, 35_000, H, None),  # 30k-40k load only matters from 45 mph
        (30, 80_000, M, None),  # load rules never touch Moderate wind
    ],
)
def test_load_rules(mph, load, level, rule):
    assert wind_with_load(mph, load) == (level, rule)


def test_assessment_takes_worst_condition_and_names_drivers():
    a = assess(wind_mph=20, rain_in_hr=0.3, snow_in_hr=0.6, load_lb=10_000)
    assert (a.level, a.wind, a.rain, a.snow) == (H, L, H, M)
    assert a.drivers == ["rain"]

    tie = assess(wind_mph=37, rain_in_hr=0.3, snow_in_hr=0, load_lb=10_000)
    assert tie.level == H and tie.drivers == ["wind", "rain"]

    calm = assess(wind_mph=5, rain_in_hr=0, snow_in_hr=0, load_lb=45_000)
    assert calm.level == L and calm.drivers == [] and calm.load_rule is None


def test_load_rule_escalates_overall_level():
    a = assess(wind_mph=47, rain_in_hr=0.12, snow_in_hr=0, load_lb=42_000)
    assert a.level == X and a.load_rule is LOAD_RULE_HIGH_WIND
    assert a.as_dict()["load_rule"] == LOAD_RULE_HIGH_WIND.description


def test_rules_table_matches_classifiers():
    table = rules_table()
    assert [lvl["label"] for lvl in table["levels"]] == ["Low", "Moderate", "High", "Severe", "No Travel"]
    assert classify_wind(table["wind"]["high"]) == H
    assert classify_rain(table["rain"]["no_travel"]) == S  # exactly the top value is not No Travel
    assert classify_snow(table["snow"]["severe"]) == S
