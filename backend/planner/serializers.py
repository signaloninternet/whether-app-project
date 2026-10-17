from __future__ import annotations

import math
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from rest_framework import serializers

from .services.geo import decode_polyline, haversine_m
from .services.sampling import ALLOWED_INTERVALS_MI

MAX_LOAD_LB = 80_000
MAX_CORRIDOR_SPAN_KM = 7_000  # coast to coast is ~4,500 km
SHARED_ENDPOINT_KM = 50
MAX_DEPARTURE_AHEAD = timedelta(days=7)
DEPARTURE_GRACE = timedelta(hours=1)


class PlaceSerializer(serializers.Serializer):
    lat = serializers.FloatField(min_value=-90, max_value=90)
    lon = serializers.FloatField(min_value=-180, max_value=180)
    label = serializers.CharField(max_length=200, required=False, allow_blank=True, default="")


class PlanRequestSerializer(serializers.Serializer):
    origin = PlaceSerializer()
    destination = PlaceSerializer()
    departure = serializers.CharField(
        max_length=19, help_text="Wall-clock departure at the origin, e.g. 2026-10-18T08:00."
    )
    timezone = serializers.CharField(
        max_length=64, required=False, help_text="IANA zone for `departure`; resolved from the origin if omitted."
    )
    load_weight_lb = serializers.IntegerField(min_value=0, max_value=MAX_LOAD_LB)
    interval_mi = serializers.ChoiceField(choices=ALLOWED_INTERVALS_MI)
    hos_breaks = serializers.BooleanField(default=False)

    def validate_departure(self, value: str) -> datetime:
        try:
            parsed = datetime.fromisoformat(value)
        except ValueError as exc:
            raise serializers.ValidationError("Use the format YYYY-MM-DDTHH:MM.") from exc
        if parsed.tzinfo is not None:
            raise serializers.ValidationError("Give local time at the origin without a UTC offset.")
        return parsed

    def validate_timezone(self, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise serializers.ValidationError("Unknown time zone.") from exc
        return value


def check_departure_window(departure_utc: datetime, now: datetime | None = None) -> None:
    now = now or datetime.now(UTC)
    if departure_utc < now - DEPARTURE_GRACE:
        raise serializers.ValidationError({"departure": "Departure time is in the past."})
    if departure_utc > now + MAX_DEPARTURE_AHEAD:
        raise serializers.ValidationError({"departure": "Pick a departure within the next 7 days (forecast range)."})


class HeatmapRequestSerializer(serializers.Serializer):
    routes = serializers.ListField(
        child=serializers.CharField(max_length=40_000), min_length=1, max_length=3,
        help_text="Encoded polylines (precision 5), as returned in `heatmap_request`.",
    )
    departure_utc = serializers.DateTimeField()
    load_weight_lb = serializers.IntegerField(min_value=0, max_value=MAX_LOAD_LB)

    def validate_routes(self, value: list[str]) -> list[list[tuple[float, float]]]:
        lines = []
        for encoded in value:
            try:
                line = decode_polyline(encoded, precision=5)
            except (IndexError, ValueError) as exc:
                raise serializers.ValidationError("Malformed polyline.") from exc
            if len(line) < 2 or any(not (-90 <= lat <= 90 and -180 <= lon <= 180) for lat, lon in line):
                raise serializers.ValidationError("Each route needs at least two valid points.")
            lines.append(line)
        # These are alternatives for one trip: same ends, continental extent at most.
        if any(haversine_m(line[0], lines[0][0]) > SHARED_ENDPOINT_KM * 1000
               or haversine_m(line[-1], lines[0][-1]) > SHARED_ENDPOINT_KM * 1000 for line in lines):
            raise serializers.ValidationError("Routes must share their origin and destination.")
        # Measure the box the grid will actually cover (it does not wrap the antimeridian).
        lats = [lat for line in lines for lat, _ in line]
        lons = [lon for line in lines for _, lon in line]
        mid_lat = math.radians((min(lats) + max(lats)) / 2)
        height_km = (max(lats) - min(lats)) * 111.2
        width_km = (max(lons) - min(lons)) * 111.2 * max(0.1, math.cos(mid_lat))
        if max(height_km, width_km) > MAX_CORRIDOR_SPAN_KM:
            raise serializers.ValidationError("The routes cover too large an area for a corridor heatmap.")
        return lines

    def validate_departure_utc(self, value: datetime) -> datetime:
        check_departure_window(value)
        return value


class CoordinateQuerySerializer(serializers.Serializer):
    lat = serializers.FloatField(min_value=-90, max_value=90)
    lon = serializers.FloatField(min_value=-180, max_value=180)


class GeocodeQuerySerializer(serializers.Serializer):
    q = serializers.CharField(min_length=2, max_length=120, trim_whitespace=True)
    lat = serializers.FloatField(min_value=-90, max_value=90, required=False)
    lon = serializers.FloatField(min_value=-180, max_value=180, required=False)
