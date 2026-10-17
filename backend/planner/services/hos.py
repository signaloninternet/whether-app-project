"""Optional FMCSA hours-of-service model for long-haul ETAs.

Weather is sampled at the truck's *arrival time* at each checkpoint, so on
multi-day trips the difference between "drive straight through" and "a real
driver's schedule" moves the forecast hour by many hours. When enabled we use
the property-carrying limits in their simplest form:

* a 30-minute break after 8 hours of cumulative driving, and
* a 10-hour off-duty reset after 11 hours of driving in a shift.

So a shift is 8h drive + 30m break + 3h drive, then 10h off. On-duty
non-driving time (fuel, inspections) and the 70-hour/8-day cycle are not
modelled; trips here are a few days at most.
"""

from __future__ import annotations

from dataclasses import dataclass

HOUR = 3600.0


@dataclass(frozen=True)
class HosRules:
    drive_before_break_s: float = 8 * HOUR
    break_s: float = 0.5 * HOUR
    drive_per_shift_s: float = 11 * HOUR
    off_duty_s: float = 10 * HOUR


@dataclass(frozen=True)
class Stop:
    kind: str  # "break" | "rest"
    at_drive_s: float  # cumulative driving time when the stop starts
    duration_s: float


def schedule_stops(total_drive_s: float, rules: HosRules = HosRules()) -> list[Stop]:
    """Stops a driver must take *before* reaching ``total_drive_s`` of driving."""
    stops: list[Stop] = []
    shift_start = 0.0
    while True:
        brk = shift_start + rules.drive_before_break_s
        rest = shift_start + rules.drive_per_shift_s
        if brk < total_drive_s:
            stops.append(Stop("break", brk, rules.break_s))
        else:
            break
        if rest < total_drive_s:
            stops.append(Stop("rest", rest, rules.off_duty_s))
        else:
            break
        shift_start = rest
    return stops


def elapsed_for_drive(drive_s: float, stops: list[Stop]) -> float:
    """Wall-clock seconds since departure when ``drive_s`` of driving is done.

    A point reached exactly when a stop begins is reached *before* the stop.
    """
    return drive_s + sum(s.duration_s for s in stops if s.at_drive_s < drive_s)
