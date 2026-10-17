import type { ExpressionSpecification, LayerSpecification, StyleSpecification } from "maplibre-gl";
import type { Palette, Theme } from "./themes";

/**
 * Builds a complete MapLibre style for a theme on OpenFreeMap's OpenMapTiles
 * vector tiles (keyless). Satellite adds Esri World Imagery, Terrain adds
 * hillshading from AWS Terrain Tiles; every style carries a DEM source so the
 * 3D toggle works on any view.
 *
 * Two invisible anchor layers mark where overlays go: weather heat and route
 * lines sit above roads but under every label, so names stay readable.
 */

export const ANCHOR_HEAT = "anchor-heat";
export const ANCHOR_ROUTES = "anchor-routes";
export const WAVES_IMAGE = "water-waves";
export const SHIELD_IMAGE = "road-shield";
export const DEM_SOURCE = "dem-terrain";

const OSM = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>';
const FONT_REGULAR = ["Noto Sans Regular"];
const FONT_BOLD = ["Noto Sans Bold"];
const FONT_ITALIC = ["Noto Sans Italic"];

const NAME: ExpressionSpecification = ["coalesce", ["get", "name:en"], ["get", "name_en"], ["get", "name"]];

function width(stops: [number, number][], base = 1.5): ExpressionSpecification {
  return ["interpolate", ["exponential", base], ["zoom"], ...stops.flat()] as ExpressionSpecification;
}

function roadFilter(classes: string[]): ExpressionSpecification {
  return ["all", ["==", ["geometry-type"], "LineString"], ["in", ["get", "class"], ["literal", classes]]];
}

const MAJOR_STOPS: [number, number][] = [[7, 0.5], [10, 1.2], [14, 5], [17, 16]];
const MOTORWAY_W = width([[5, 0.7], [8, 1.5], [12, 3.6], [16, 16]]);
const MAJOR_W = width(MAJOR_STOPS);
// Zoom expressions can't be nested in arithmetic, so the casing gets its own stops.
const MAJOR_CASING_W = width(MAJOR_STOPS.map(([z, w]) => [z, w + 1.5]));
const SECONDARY_W = width([[9, 0.4], [12, 1.2], [15, 5], [18, 18]]);
const MINOR_W = width([[12, 0.4], [14, 1.8], [17, 9], [19, 22]]);

function baseLayers(p: Palette, kind: Theme["kind"]): LayerSpecification[] {
  const vectorGround: LayerSpecification[] = [
    { id: "background", type: "background", paint: { "background-color": p.land } },
    {
      id: "landcover-wood", type: "fill", source: "omt", "source-layer": "landcover",
      filter: ["in", ["get", "class"], ["literal", ["wood", "forest"]]],
      paint: { "fill-color": p.wood, "fill-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0.4, 10, 0.9] },
    },
    {
      id: "landcover-ice", type: "fill", source: "omt", "source-layer": "landcover",
      filter: ["==", ["get", "class"], "ice"], paint: { "fill-color": p.ice, "fill-opacity": 0.8 },
    },
    {
      id: "park", type: "fill", source: "omt", "source-layer": "park",
      paint: { "fill-color": p.park, "fill-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.5, 10, 0.9] },
    },
    {
      id: "landuse-green", type: "fill", source: "omt", "source-layer": "landuse", minzoom: 10,
      filter: ["in", ["get", "class"], ["literal", ["park", "cemetery", "grass", "recreation_ground"]]],
      paint: { "fill-color": p.park },
    },
  ];

  const satellite: LayerSpecification[] = [
    { id: "background", type: "background", paint: { "background-color": p.land } },
    { id: "satellite", type: "raster", source: "satellite", paint: { "raster-fade-duration": 150 } },
  ];

  const water: LayerSpecification[] = kind === "satellite" ? [] : [
    {
      id: "water", type: "fill", source: "omt", "source-layer": "water",
      filter: ["!=", ["get", "brunnel"], "tunnel"], paint: { "fill-color": p.water },
    },
    {
      id: "water-waves", type: "fill", source: "omt", "source-layer": "water", minzoom: 4,
      filter: ["all", ["!=", ["get", "brunnel"], "tunnel"], ["in", ["get", "class"], ["literal", ["ocean", "lake", "river", "bay", "sea"]]]],
      paint: { "fill-pattern": WAVES_IMAGE, "fill-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0.35, 9, 0.8] },
    },
    {
      id: "waterway", type: "line", source: "omt", "source-layer": "waterway", minzoom: 8,
      filter: ["in", ["get", "class"], ["literal", ["river", "canal"]]],
      paint: { "line-color": p.waterLine, "line-width": width([[8, 0.6], [14, 3]]) },
    },
  ];

  const hillshade: LayerSpecification[] = kind !== "terrain" ? [] : [
    {
      id: "hillshade", type: "hillshade", source: "dem-hillshade",
      paint: {
        "hillshade-exaggeration": 0.55,
        "hillshade-shadow-color": "#5e5444",
        "hillshade-highlight-color": "#ffffff",
        "hillshade-accent-color": "#7c705c",
        "hillshade-illumination-direction": 315,
      },
    },
  ];

  const buildings: LayerSpecification[] = kind === "satellite" ? [] : [
    {
      id: "building", type: "fill", source: "omt", "source-layer": "building", minzoom: 13,
      paint: {
        "fill-color": p.building,
        "fill-outline-color": p.buildingLine,
        "fill-opacity": ["interpolate", ["linear"], ["zoom"], 13, 0, 14, 1],
      },
    },
  ];

  const boundaries: LayerSpecification[] = [
    {
      id: "boundary-state", type: "line", source: "omt", "source-layer": "boundary", minzoom: 3,
      filter: ["all", ["==", ["get", "admin_level"], 4], ["!=", ["get", "maritime"], 1]],
      paint: { "line-color": p.boundary, "line-width": width([[3, 0.5], [10, 1.2]]), "line-dasharray": [3, 2], "line-opacity": 0.7 },
    },
    {
      id: "boundary-country", type: "line", source: "omt", "source-layer": "boundary",
      filter: ["all", ["==", ["get", "admin_level"], 2], ["!=", ["get", "maritime"], 1], ["!=", ["get", "disputed"], 1]],
      paint: { "line-color": p.boundary, "line-width": width([[2, 0.6], [10, 2]]) },
    },
  ];

  const satelliteRoads = kind === "satellite";
  const roads: LayerSpecification[] = [
    {
      id: "road-minor", type: "line", source: "omt", "source-layer": "transportation", minzoom: 12,
      filter: roadFilter(["minor", "service"]),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": p.roadMinor, "line-width": MINOR_W },
    },
    {
      id: "road-secondary", type: "line", source: "omt", "source-layer": "transportation", minzoom: 9,
      filter: roadFilter(["secondary", "tertiary"]),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": p.roadMajor, "line-width": SECONDARY_W },
    },
    {
      id: "road-major-casing", type: "line", source: "omt", "source-layer": "transportation", minzoom: 10,
      filter: roadFilter(["primary", "trunk", "motorway"]),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": p.roadCasing, "line-width": MAJOR_CASING_W, "line-opacity": satelliteRoads ? 0.6 : 0.8 },
    },
    {
      id: "road-major", type: "line", source: "omt", "source-layer": "transportation", minzoom: 6,
      filter: roadFilter(["primary", "trunk"]),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": p.roadMajor, "line-width": MAJOR_W },
    },
    {
      id: "road-motorway", type: "line", source: "omt", "source-layer": "transportation", minzoom: 4,
      filter: roadFilter(["motorway"]),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": p.roadMotorway, "line-width": MOTORWAY_W },
    },
    {
      id: "rail", type: "line", source: "omt", "source-layer": "transportation", minzoom: 11,
      filter: roadFilter(["rail"]),
      paint: { "line-color": p.rail, "line-width": width([[11, 0.6], [16, 1.6]]), "line-dasharray": [4, 3] },
    },
  ];

  const anchors: LayerSpecification[] = [
    { id: ANCHOR_HEAT, type: "background", layout: { visibility: "none" }, paint: {} },
    { id: ANCHOR_ROUTES, type: "background", layout: { visibility: "none" }, paint: {} },
  ];

  const halo = { "text-halo-color": p.labelHalo, "text-halo-width": 1.4, "text-halo-blur": 0.4 };
  const labels: LayerSpecification[] = [
    {
      id: "label-road", type: "symbol", source: "omt", "source-layer": "transportation_name", minzoom: 13,
      filter: ["!", ["in", ["get", "class"], ["literal", ["motorway"]]]],
      layout: { "symbol-placement": "line", "text-field": NAME, "text-font": FONT_REGULAR, "text-size": 11.5, "text-letter-spacing": 0.02 },
      paint: { "text-color": p.roadLabel, ...halo },
    },
    {
      id: "label-shield", type: "symbol", source: "omt", "source-layer": "transportation_name", minzoom: 6,
      filter: ["all", ["has", "ref"], ["in", ["get", "class"], ["literal", ["motorway", "trunk", "primary"]]],
        ["<=", ["length", ["get", "ref"]], 6]],
      layout: {
        "symbol-placement": "line",
        "symbol-spacing": 420,
        "text-field": ["case",
          ["==", ["get", "network"], "us-interstate"], ["concat", "I-", ["get", "ref"]],
          ["==", ["get", "network"], "us-highway"], ["concat", "US ", ["get", "ref"]],
          ["get", "ref"]],
        "text-font": FONT_BOLD,
        "text-size": 10.5,
        "text-rotation-alignment": "viewport",
        "icon-image": SHIELD_IMAGE,
        "icon-text-fit": "both",
        "icon-text-fit-padding": [2, 4, 2, 4],
        "icon-rotation-alignment": "viewport",
      },
      paint: { "text-color": p.shieldText },
    },
    {
      id: "label-water", type: "symbol", source: "omt", "source-layer": "water_name",
      layout: { "text-field": NAME, "text-font": FONT_ITALIC, "text-size": 12, "text-letter-spacing": 0.08, "symbol-placement": "point" },
      paint: { "text-color": p.waterLabel, ...halo },
    },
    {
      id: "label-neighbourhood", type: "symbol", source: "omt", "source-layer": "place", minzoom: 12,
      filter: ["in", ["get", "class"], ["literal", ["suburb", "neighbourhood", "quarter"]]],
      layout: { "text-field": NAME, "text-font": FONT_BOLD, "text-size": 10.5, "text-transform": "uppercase", "text-letter-spacing": 0.12, "text-max-width": 8 },
      paint: { "text-color": p.label, ...halo },
    },
    {
      id: "label-village", type: "symbol", source: "omt", "source-layer": "place", minzoom: 9,
      filter: ["in", ["get", "class"], ["literal", ["village", "hamlet"]]],
      layout: { "text-field": NAME, "text-font": FONT_REGULAR, "text-size": 11.5, "text-max-width": 8 },
      paint: { "text-color": p.label, ...halo },
    },
    {
      id: "label-town", type: "symbol", source: "omt", "source-layer": "place", minzoom: 7,
      filter: ["==", ["get", "class"], "town"],
      layout: { "text-field": NAME, "text-font": FONT_REGULAR, "text-size": width([[7, 11], [12, 14]], 1.2), "text-max-width": 8 },
      paint: { "text-color": p.labelStrong, ...halo },
    },
    {
      id: "label-city", type: "symbol", source: "omt", "source-layer": "place", minzoom: 3,
      filter: ["==", ["get", "class"], "city"],
      layout: {
        "text-field": NAME,
        "text-font": FONT_BOLD,
        "text-size": ["interpolate", ["linear"], ["zoom"], 3, ["case", ["<=", ["get", "rank"], 2], 12, 10.5], 10, ["case", ["<=", ["get", "rank"], 2], 18, 15]],
        "text-max-width": 8,
        "symbol-sort-key": ["get", "rank"],
      },
      paint: { "text-color": p.labelStrong, ...halo },
    },
    {
      id: "label-state", type: "symbol", source: "omt", "source-layer": "place", minzoom: 3, maxzoom: 8,
      filter: ["==", ["get", "class"], "state"],
      layout: { "text-field": NAME, "text-font": FONT_BOLD, "text-size": 10.5, "text-transform": "uppercase", "text-letter-spacing": 0.18, "text-max-width": 9 },
      paint: { "text-color": p.label, "text-opacity": 0.85, ...halo },
    },
    {
      id: "label-country", type: "symbol", source: "omt", "source-layer": "place", maxzoom: 6,
      filter: ["==", ["get", "class"], "country"],
      layout: { "text-field": NAME, "text-font": FONT_BOLD, "text-size": width([[1, 11], [5, 15]], 1.2), "text-transform": "uppercase", "text-letter-spacing": 0.12, "text-max-width": 8 },
      paint: { "text-color": p.labelStrong, ...halo },
    },
  ];

  const ground = kind === "satellite" ? satellite : vectorGround;
  return [...ground, ...water, ...hillshade, ...buildings, ...boundaries, ...roads, ...anchors, ...labels];
}

export function buildStyle(theme: Theme): StyleSpecification {
  const sources: StyleSpecification["sources"] = {
    omt: {
      type: "vector",
      url: "https://tiles.openfreemap.org/planet",
      attribution: `<a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> ${OSM}`,
    },
    [DEM_SOURCE]: {
      type: "raster-dem",
      tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
      encoding: "terrarium",
      tileSize: 256,
      maxzoom: 14,
      attribution: "Terrain: Mapzen, AWS Open Data",
    },
  };
  if (theme.kind === "satellite") {
    sources.satellite = {
      type: "raster",
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256,
      maxzoom: 19,
      attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
    };
  }
  if (theme.kind === "terrain") {
    sources["dem-hillshade"] = {
      type: "raster-dem",
      tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
      encoding: "terrarium",
      tileSize: 256,
      maxzoom: 14,
    };
  }
  return {
    version: 8,
    name: theme.name,
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sources,
    layers: baseLayers(theme.palette, theme.kind),
  };
}
