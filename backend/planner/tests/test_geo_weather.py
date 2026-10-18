import pytest

from planner.services import weather
from planner.services.geo import (
    cumulative_distances,
    decode_polyline,
    encode_polyline,
    haversine_m,
    is_daylight,
    lat_to_mercator_y,
    mercator_y_to_lat,
    simplify,
    slice_line,
)
from planner.services.weather import HOUR, HourlyForecast, snap_all


def test_polyline_reference_example():
    # Example from Google's polyline algorithm documentation.
    coords = decode_polyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@", precision=5)
    assert coords == pytest.approx([(38.5, -120.2), (40.7, -120.95), (43.252, -126.453)])
    assert encode_polyline(coords, precision=5) == "_p~iF~ps|U_ulLnnqC_mqNvxq`@"


def test_polyline_round_trip_precision_6():
    coords = [(41.875562, -87.624421), (39.739235, -104.990251), (-33.8688, 151.2093)]
    assert decode_polyline(encode_polyline(coords, 6), 6) == pytest.approx(coords, abs=1e-6)


def test_haversine_known_distance():
    # Chicago -> Denver is ~1,480 km in a straight line.
    assert haversine_m((41.8781, -87.6298), (39.7392, -104.9903)) == pytest.approx(1_479_000, rel=0.01)


def test_simplify_keeps_ends_and_drops_collinear_points():
    line = [(40.0, -100.0 + i * 0.01) for i in range(101)]
    simple = simplify(line, 5)
    assert simple[0] == line[0] and simple[-1] == line[-1] and len(simple) == 2


def test_slice_line_endpoints():
    line = [(40.0, -100.0), (40.0, -99.0), (40.0, -98.0)]
    cum = cumulative_distances(line)
    part = slice_line(line, cum, cum[-1] * 0.25, cum[-1] * 0.75)
    assert part[0][1] == pytest.approx(-99.5, abs=1e-3)
    assert part[-1][1] == pytest.approx(-98.5, abs=1e-3)
    assert (40.0, -99.0) in part


def test_mercator_round_trip():
    for lat in (-60.0, 0.0, 33.3, 51.5):
        assert mercator_y_to_lat(lat_to_mercator_y(lat)) == pytest.approx(lat)


@pytest.mark.parametrize("point, sunrise, sunset", [
    # Open-Meteo's daily sunrise/sunset for 2026-10-18 (UTC epochs).
    ((32.7849, -96.8036), 1_792_326_822, 1_792_367_430),  # Dallas
    ((39.7469, -104.9871), 1_792_329_210, 1_792_368_963),  # Denver
    ((61.2654, -149.9274), 1_792_342_254, 1_792_377_452),  # Anchorage
])
def test_daylight_follows_the_sun_at_the_point(point, sunrise, sunset):
    five_min = 5 * 60
    assert not is_daylight(point, sunrise - five_min)
    assert is_daylight(point, sunrise + five_min)
    assert is_daylight(point, sunset - five_min)
    assert not is_daylight(point, sunset + five_min)


def test_sky_conditions_have_night_names():
    assert weather.condition_name(0, daylight=True) == "Clear sky"
    assert weather.condition_name(0, daylight=False) == "Clear night"
    assert weather.condition_name(2, daylight=False) == "Partly cloudy night"
    assert weather.condition_name(61, daylight=False) == "Light rain"  # rain reads the same after dark
    assert weather.condition_name(None, daylight=True) == "Unknown"
    night = series().at(1_000 * HOUR + 60).as_dict(daylight=False)
    assert night["is_day"] is False and night["condition"] == "Light rain"


def series(**overrides) -> HourlyForecast:
    base = dict(
        start=1_000 * HOUR,
        wind=(10.0, 20.0, 30.0),
        gust=(15.0, 25.0, 35.0),
        rain=(0.0, 0.2, 0.6),  # hour ending at each stamp
        snow=(0.0, 0.0, 1.2),
        temp=(40.0, 41.0, 42.0),
        code=(0, 61, 63),
    )
    return HourlyForecast(**{**base, **overrides})


def test_sample_interpolates_wind_and_uses_the_hour_being_driven():
    s = series().at(1_000 * HOUR + 0.25 * HOUR)
    assert s.wind_mph == pytest.approx(12.5)
    assert s.rain_in_hr == 0.2  # 00:15 falls in the hour ending at the 01:00 stamp
    assert s.code == 61
    assert s.hour_start == 1_000 * HOUR


def test_sample_on_the_hour_uses_the_following_hour():
    s = series().at(1_001 * HOUR)
    assert s.wind_mph == 20.0
    assert s.rain_in_hr == 0.6 and s.snow_in_hr == 1.2


def test_sample_outside_series_or_missing_is_none():
    assert series().at(999 * HOUR) is None
    assert series().at(1_003 * HOUR) is None
    assert series(rain=(0.0, None, 0.6)).at(1_000 * HOUR + 60) is None


def test_heatmap_frame_matches_sampling():
    s = series()
    wind, rain, snow = s.frame(1)
    sample = s.at(1_001 * HOUR)
    assert (wind, rain, snow) == (sample.wind_mph, sample.rain_in_hr, sample.snow_in_hr)


def test_snap_all_respects_budget():
    points = [(40 + i * 0.01, -100 + i * 0.01) for i in range(500)]
    snapped = snap_all(points, max_unique=60)
    assert len(set(snapped)) <= 60
    assert len(snapped) == len(points)


def test_parse_sums_rain_and_showers():
    parsed = weather._parse({"hourly": {
        "time": [0, 3600], "wind_speed_10m": [5, 6], "wind_gusts_10m": [7, 8], "rain": [0.1, None],
        "showers": [0.05, None], "snowfall": [0, 0], "temperature_2m": [30, 31], "weather_code": [61, 3],
    }})
    assert parsed.rain == (pytest.approx(0.15), None)
