"""Weather risk classification for a single checkpoint.

The thresholds come straight from the brief. Its ranges share end points
("0.10-0.25", "0.25-0.50"), so we read every band as *inclusive at the lower
bound*: 0.25 in/hr is High, 34.9 mph is Moderate, 35 mph is High. The two
top bands are written differently in the brief and we keep that difference:
wind is No Travel at ``>= 55`` mph, while rain and snow are No Travel only
*above* 1.00 / 3.0 in/hr (so exactly 1.00 in/hr rain is still Severe).

Load rules only ever escalate the wind level:

* ``>= 55 mph``                     -> No Travel for any load (already the base rule)
* ``45-54 mph`` and load ``> 30,000 lb`` -> No Travel
* ``35-44 mph`` and load ``> 40,000 lb`` -> Severe

A checkpoint's level is the worst of wind (after load rules), rain and snow.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import IntEnum


class Risk(IntEnum):
    LOW = 0
    MODERATE = 1
    HIGH = 2
    SEVERE = 3
    NO_TRAVEL = 4

    @property
    def label(self) -> str:
        return RISK_LABELS[self]

    @property
    def key(self) -> str:
        return self.name.lower()


RISK_LABELS = {
    Risk.LOW: "Low",
    Risk.MODERATE: "Moderate",
    Risk.HIGH: "High",
    Risk.SEVERE: "Severe",
    Risk.NO_TRAVEL: "No Travel",
}

# Lower bounds of Moderate, High, Severe for each condition, and the No Travel
# boundary with whether it is inclusive (wind) or exclusive (rain, snow).
WIND_MPH = {"moderate": 25.0, "high": 35.0, "severe": 45.0, "no_travel": 55.0, "no_travel_inclusive": True}
RAIN_IN_HR = {"moderate": 0.10, "high": 0.25, "severe": 0.50, "no_travel": 1.00, "no_travel_inclusive": False}
SNOW_IN_HR = {"moderate": 0.5, "high": 1.0, "severe": 2.0, "no_travel": 3.0, "no_travel_inclusive": False}

HEAVY_LOAD_NO_TRAVEL_LB = 30_000  # with 45-54 mph wind
HEAVY_LOAD_SEVERE_LB = 40_000  # with 35-44 mph wind


def _classify(value: float, bands: dict) -> Risk:
    no_travel = bands["no_travel"]
    if value > no_travel or (bands["no_travel_inclusive"] and value >= no_travel):
        return Risk.NO_TRAVEL
    if value >= bands["severe"]:
        return Risk.SEVERE
    if value >= bands["high"]:
        return Risk.HIGH
    if value >= bands["moderate"]:
        return Risk.MODERATE
    return Risk.LOW


def classify_wind(mph: float) -> Risk:
    return _classify(mph, WIND_MPH)


def classify_rain(in_per_hr: float) -> Risk:
    return _classify(in_per_hr, RAIN_IN_HR)


def classify_snow(in_per_hr: float) -> Risk:
    return _classify(in_per_hr, SNOW_IN_HR)


@dataclass(frozen=True)
class LoadRule:
    id: str
    description: str


LOAD_RULE_HIGH_WIND = LoadRule("wind_45_54_over_30k", "45–54 mph wind with load over 30,000 lb → No Travel")
LOAD_RULE_STRONG_WIND = LoadRule("wind_35_44_over_40k", "35–44 mph wind with load over 40,000 lb → Severe")


def wind_with_load(mph: float, load_lb: float) -> tuple[Risk, LoadRule | None]:
    """Wind level after the load rules, and the rule that escalated it (if any)."""
    base = classify_wind(mph)
    if base == Risk.SEVERE and load_lb > HEAVY_LOAD_NO_TRAVEL_LB:
        return Risk.NO_TRAVEL, LOAD_RULE_HIGH_WIND
    if base == Risk.HIGH and load_lb > HEAVY_LOAD_SEVERE_LB:
        return Risk.SEVERE, LOAD_RULE_STRONG_WIND
    return base, None


@dataclass(frozen=True)
class RiskAssessment:
    level: Risk
    wind: Risk
    rain: Risk
    snow: Risk
    load_rule: LoadRule | None

    @property
    def drivers(self) -> list[str]:
        """Which conditions set the overall level (empty when everything is Low)."""
        if self.level == Risk.LOW:
            return []
        return [name for name, lvl in (("wind", self.wind), ("rain", self.rain), ("snow", self.snow)) if lvl == self.level]

    def as_dict(self) -> dict:
        return {
            "level": int(self.level),
            "label": self.level.label,
            "factors": {"wind": int(self.wind), "rain": int(self.rain), "snow": int(self.snow)},
            "drivers": self.drivers,
            "load_rule": self.load_rule.description if self.load_rule else None,
        }


def assess(wind_mph: float, rain_in_hr: float, snow_in_hr: float, load_lb: float) -> RiskAssessment:
    wind, rule = wind_with_load(wind_mph, load_lb)
    rain = classify_rain(rain_in_hr)
    snow = classify_snow(snow_in_hr)
    return RiskAssessment(level=max(wind, rain, snow), wind=wind, rain=rain, snow=snow, load_rule=rule)


def rules_table() -> dict:
    """Thresholds as data, so the UI legend never drifts from the backend."""

    def bands(spec: dict, unit: str) -> dict:
        return {
            "unit": unit,
            "moderate": spec["moderate"],
            "high": spec["high"],
            "severe": spec["severe"],
            "no_travel": spec["no_travel"],
            "no_travel_inclusive": spec["no_travel_inclusive"],
        }

    return {
        "levels": [{"level": int(r), "key": r.key, "label": r.label} for r in Risk],
        "wind": bands(WIND_MPH, "mph"),
        "rain": bands(RAIN_IN_HR, "in/hr"),
        "snow": bands(SNOW_IN_HR, "in/hr"),
        "load_rules": [
            {"id": LOAD_RULE_HIGH_WIND.id, "description": LOAD_RULE_HIGH_WIND.description,
             "min_wind_mph": WIND_MPH["severe"], "max_wind_mph": WIND_MPH["no_travel"],
             "load_over_lb": HEAVY_LOAD_NO_TRAVEL_LB, "result": int(Risk.NO_TRAVEL)},
            {"id": LOAD_RULE_STRONG_WIND.id, "description": LOAD_RULE_STRONG_WIND.description,
             "min_wind_mph": WIND_MPH["high"], "max_wind_mph": WIND_MPH["severe"],
             "load_over_lb": HEAVY_LOAD_SEVERE_LB, "result": int(Risk.SEVERE)},
        ],
        "notes": [
            "Wind is the sustained 10 m wind speed for the forecast hour; gusts are shown for context.",
            "Rain is liquid precipitation (rain + showers); snow is snowfall, both per hour.",
            "Bands include their lower bound; rain and snow are No Travel only above the top value.",
        ],
    }
