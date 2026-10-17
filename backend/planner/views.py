from __future__ import annotations

import re

from rest_framework.response import Response
from rest_framework.views import APIView

from .serializers import (
    CoordinateQuerySerializer,
    GeocodeQuerySerializer,
    HeatmapRequestSerializer,
    PlanRequestSerializer,
    check_departure_window,
)
from .services import places
from .services.heatmap import build_heatmap
from .services.planner import PlanRequest, build_plan
from .services.risk import rules_table

COORDINATE_QUERY = re.compile(r"^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$")


class HealthView(APIView):
    def get(self, request):
        return Response({"status": "ok"})


class RulesView(APIView):
    def get(self, request):
        return Response(rules_table())


class GeocodeView(APIView):
    """Place search for the origin/destination fields (debounced by the client)."""

    throttle_scope = "geocode"

    def get(self, request):
        query = GeocodeQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        q = query.validated_data["q"]
        if match := COORDINATE_QUERY.match(q):
            lat, lon = float(match.group(1)), float(match.group(2))
            if -90 <= lat <= 90 and -180 <= lon <= 180:
                return Response({"results": [{"name": f"{lat:.5f}, {lon:.5f}", "label": "Coordinates",
                                              "lat": lat, "lon": lon, "kind": "coordinates"}]})
        bias = None
        if "lat" in query.validated_data and "lon" in query.validated_data:
            bias = (query.validated_data["lat"], query.validated_data["lon"])
        return Response({"results": [p.as_dict() for p in places.search(q, bias)]})


class ReverseGeocodeView(APIView):
    throttle_scope = "geocode"

    def get(self, request):
        query = CoordinateQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        place = places.reverse((query.validated_data["lat"], query.validated_data["lon"]))
        return Response({"place": place.as_dict() if place else None})


class TimezoneView(APIView):
    throttle_scope = "geocode"

    def get(self, request):
        query = CoordinateQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        return Response(places.timezone_at((query.validated_data["lat"], query.validated_data["lon"])).as_dict())


class PlanView(APIView):
    """Three routes with timed checkpoints, weather risk and a recommendation."""

    throttle_scope = "plan"

    def post(self, request):
        body = PlanRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        data = body.validated_data
        origin = (data["origin"]["lat"], data["origin"]["lon"])
        tz = data.get("timezone") or places.timezone_at(origin).name
        plan_request = PlanRequest(
            origin=origin,
            origin_label=data["origin"]["label"],
            destination=(data["destination"]["lat"], data["destination"]["lon"]),
            destination_label=data["destination"]["label"],
            departure_local=data["departure"],
            timezone=tz,
            load_lb=data["load_weight_lb"],
            interval_mi=data["interval_mi"],
            hos_breaks=data["hos_breaks"],
        )
        check_departure_window(plan_request.departure_utc)
        return Response(build_plan(plan_request))


class HeatmapView(APIView):
    """Corridor weather grid for the 0-48 h slider (body = a plan's ``heatmap_request``)."""

    throttle_scope = "heatmap"

    def post(self, request):
        body = HeatmapRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        data = body.validated_data
        return Response(build_heatmap(data["routes"], data["departure_utc"], data["load_weight_lb"]))
