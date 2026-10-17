/** Types for the Django API (see backend/planner/services/planner.py). */

export type RiskLevel = 0 | 1 | 2 | 3 | 4;
export type RiskKey = "low" | "moderate" | "high" | "severe" | "no_travel";
export type IntervalMi = 10 | 25 | 50;

export interface Place {
  name: string;
  label: string;
  lat: number;
  lon: number;
  kind: string;
}

export interface TimeZoneInfo {
  name: string;
  abbreviation: string;
  utc_offset_s: number;
}

export interface PlanInputs {
  origin: { lat: number; lon: number; label: string };
  destination: { lat: number; lon: number; label: string };
  departure: string; // wall-clock at the origin, YYYY-MM-DDTHH:MM
  timezone?: string; // the origin's IANA zone; the API resolves it from the origin when omitted
  load_weight_lb: number;
  interval_mi: IntervalMi;
  hos_breaks: boolean;
}

export interface Weather {
  wind_mph: number;
  gust_mph: number | null;
  rain_in_hr: number;
  snow_in_hr: number;
  temp_f: number | null;
  code: number | null;
  condition: string;
  hour_utc: string;
}

export interface CheckpointRisk {
  level: RiskLevel;
  label: string;
  factors: { wind: RiskLevel; rain: RiskLevel; snow: RiskLevel };
  drivers: ("wind" | "rain" | "snow")[];
  load_rule: string | null;
}

export interface Checkpoint {
  index: number;
  mile: number;
  lat: number;
  lon: number;
  eta_utc: string;
  elapsed_s: number;
  covers: [number, number];
  weather: Weather | null;
  risk: CheckpointRisk | null;
}

export interface RiskSegment {
  level: RiskLevel | -1;
  from_mile: number;
  to_mile: number;
  polyline: string;
}

export interface HosStop {
  kind: "break" | "rest";
  mile: number;
  lat: number;
  lon: number;
  start_utc: string;
  end_utc: string;
  duration_s: number;
}

export interface RouteRisk {
  miles_by_level: Record<RiskKey, number>;
  unknown_miles: number;
  avg_risk: number;
  max_level: RiskLevel | null;
}

export interface Route {
  id: string;
  name: string;
  roads: string[];
  strategy: "fastest" | "alternate" | "corridor";
  engine: "valhalla-truck" | "osrm-car";
  distance_mi: number;
  drive_time_s: number;
  travel_time_s: number;
  arrival_utc: string;
  bbox: [number, number, number, number];
  polyline: string;
  segments: RiskSegment[];
  timeline: [number, number][]; // [elapsed_s, mile]
  stops: HosStop[];
  checkpoints: Checkpoint[];
  risk: RouteRisk;
  rank: number;
  recommended: boolean;
}

export interface Criterion {
  key: "no_travel_miles" | "severe_miles" | "high_miles" | "avg_risk" | "travel_time";
  label: string;
  unit: "mi" | "score" | "s";
  values: Record<string, number>;
}

export interface Recommendation {
  route_id: string;
  ranking: string[];
  decided_by: Criterion["key"] | null;
  headline: string;
  reasons: string[];
  criteria: Criterion[];
}

export interface Bands {
  unit: string;
  moderate: number;
  high: number;
  severe: number;
  no_travel: number;
  no_travel_inclusive: boolean;
}

export interface Rules {
  levels: { level: RiskLevel; key: RiskKey; label: string }[];
  wind: Bands;
  rain: Bands;
  snow: Bands;
  load_rules: {
    id: string;
    description: string;
    min_wind_mph: number;
    max_wind_mph: number;
    load_over_lb: number;
    result: RiskLevel;
  }[];
  notes: string[];
}

export interface HeatmapRequest {
  routes: string[];
  departure_utc: string;
  load_weight_lb: number;
}

export interface Plan {
  plan_id: string;
  generated_utc: string;
  inputs: {
    origin: { lat: number; lon: number; label: string };
    destination: { lat: number; lon: number; label: string };
    departure_local: string;
    timezone: string;
    load_weight_lb: number;
    interval_mi: IntervalMi;
    hos_breaks: boolean;
  };
  departure_utc: string;
  truck: { gross_weight_lb: number; max_speed_mph: number };
  engine: "valhalla" | "osrm";
  notes: string[];
  warnings: string[];
  rules: Rules;
  routes: Route[];
  recommendation: Recommendation;
  heatmap_request: HeatmapRequest;
}

export type HeatLayer = "risk" | "wind" | "rain" | "snow";

export interface Heatmap {
  grid: {
    ncols: number;
    nrows: number;
    bounds: [number, number, number, number]; // west, south, east, north
    cell_km: number;
    radius_km: number;
    closing_km: number; // gaps narrower than twice this between corridors are filled
    cells: number[]; // row-major indices from the north-west corner
  };
  start_utc: string;
  hours: number;
  layers: Record<HeatLayer, (number | null)[]>; // hour-major: [h * cells + k]
}
