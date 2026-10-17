"""Route risk summaries and the recommendation.

The brief's preference order is applied lexicographically, with one
addition in front: miles in **No Travel** conditions. The brief does not
list them, but a route that crosses No Travel weather is never "safer" than
one that does not, whatever its Severe mileage.

    1. fewest No Travel miles   (added)
    2. fewest Severe miles
    3. fewest High miles
    4. lowest average risk      (mile-weighted, Low=0 ... No Travel=4)
    5. shortest travel time

Mileages are compared at 0.1 mi and average risk at 0.01 so floating-point
noise never decides a recommendation; ties fall through to the next rule.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .risk import Risk


@dataclass
class RiskSummary:
    miles: dict[Risk, float] = field(default_factory=lambda: {r: 0.0 for r in Risk})
    unknown_miles: float = 0.0

    def add(self, level: Risk | None, miles: float) -> None:
        if level is None:
            self.unknown_miles += miles
        else:
            self.miles[level] += miles

    @property
    def known_miles(self) -> float:
        return sum(self.miles.values())

    @property
    def avg_risk(self) -> float:
        known = self.known_miles
        return sum(int(r) * m for r, m in self.miles.items()) / known if known else 0.0

    @property
    def max_level(self) -> Risk | None:
        present = [r for r, m in self.miles.items() if m > 0]
        return max(present) if present else None

    def as_dict(self) -> dict:
        return {
            "miles_by_level": {r.key: round(m, 1) for r, m in self.miles.items()},
            "unknown_miles": round(self.unknown_miles, 1),
            "avg_risk": round(self.avg_risk, 2),
            "max_level": None if self.max_level is None else int(self.max_level),
        }


@dataclass(frozen=True)
class Criterion:
    key: str
    label: str
    unit: str

    def value(self, summary: RiskSummary, travel_s: float) -> float:
        if self.key == "travel_time":
            return travel_s
        if self.key == "avg_risk":
            return round(summary.avg_risk, 2)
        return round(summary.miles[Risk[self.key.removesuffix("_miles").upper()]], 1)


CRITERIA = (
    Criterion("no_travel_miles", "No Travel miles", "mi"),
    Criterion("severe_miles", "Severe miles", "mi"),
    Criterion("high_miles", "High miles", "mi"),
    Criterion("avg_risk", "Average risk", "score"),
    Criterion("travel_time", "Travel time", "s"),
)


@dataclass(frozen=True)
class ScoredRoute:
    id: str
    summary: RiskSummary
    travel_s: float

    def key(self) -> tuple[float, ...]:
        return tuple(c.value(self.summary, self.travel_s) for c in CRITERIA)


def _fmt(criterion: Criterion, value: float) -> str:
    if criterion.unit == "mi":
        return f"{value:,.0f} mi" if value >= 10 or value == 0 else f"{value:.1f} mi"
    if criterion.unit == "s":
        h, m = divmod(round(value / 60), 60)
        return f"{h}h {m:02d}m"
    return f"{value:.2f}"


def recommend(routes: list[ScoredRoute]) -> dict:
    ordered = sorted(routes, key=ScoredRoute.key)
    best = ordered[0]
    result = {
        "route_id": best.id,
        "ranking": [r.id for r in ordered],
        "decided_by": None,
        "headline": "",
        "reasons": [],
        "criteria": [
            {"key": c.key, "label": c.label, "unit": c.unit,
             "values": {r.id: c.value(r.summary, r.travel_s) for r in routes}}
            for c in CRITERIA
        ],
    }
    if len(ordered) == 1:
        result["headline"] = f"Route {best.id} is the only route available."
        return result
    if all(r.summary.known_miles == 0 for r in routes):
        result["decided_by"] = "travel_time"
        result["headline"] = f"Route {best.id}: fastest. Weather risk is unknown."
        result["reasons"].append("No forecast was available, so routes are ranked by travel time only.")
        return result

    runner_up = ordered[1]
    decisive = next(c for c, a, b in zip(CRITERIA, best.key(), runner_up.key()) if a != b) \
        if best.key() != runner_up.key() else CRITERIA[-1]
    result["decided_by"] = decisive.key

    if decisive.key == "travel_time":
        result["headline"] = f"Route {best.id}: same weather risk, shortest travel time."
    elif decisive.key == "avg_risk":
        result["headline"] = f"Route {best.id}: lowest overall weather risk."
    else:
        result["headline"] = f"Route {best.id}: fewest {decisive.label.removesuffix(' miles')} miles."

    # Explain each rule up to and including the decisive one. A route drops out of
    # the comparison at the rule that ruled it out, so later lines only compare
    # routes still in contention (the sort guarantees the best is lowest among them).
    contenders = ordered[1:]
    for c in CRITERIA[: CRITERIA.index(decisive) + 1]:
        mine = c.value(best.summary, best.travel_s)
        worse = [o for o in contenders if c.value(o.summary, o.travel_s) != mine]
        if worse:
            theirs = ", ".join(f"{_fmt(c, c.value(o.summary, o.travel_s))} on {o.id}" for o in worse)
            result["reasons"].append(f"{c.label}: {_fmt(c, mine)} vs {theirs}.")
            contenders = [o for o in contenders if o not in worse]
        elif c.unit == "mi":
            result["reasons"].append(f"{c.label}: tied at {_fmt(c, mine)}.")
    return result


def plan_warnings(best: RiskSummary) -> list[str]:
    if best.miles[Risk.NO_TRAVEL] > 0:
        return ["Every route crosses No Travel conditions at this departure time. Delay the trip or re-check later."]
    if best.miles[Risk.SEVERE] > 0:
        return ["Severe weather is forecast on every route. Drive with extra caution or consider delaying."]
    return []
