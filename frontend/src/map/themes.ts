/**
 * Map views. The first nine reproduce the reference's "Themes" picker
 * (palettes sampled from the screenshots); Midnight, Satellite and Terrain are
 * practical views for drivers (night driving, ground truth, mountain passes).
 */

export type ThemeId =
  | "glacier"
  | "lagoon"
  | "canyon"
  | "meadow"
  | "grotto"
  | "forest"
  | "oasis"
  | "sahara"
  | "harbor"
  | "midnight"
  | "satellite"
  | "terrain";

export interface Palette {
  land: string;
  water: string;
  waterLine: string;
  wave: string; // the hand-drawn squiggles on water
  park: string;
  wood: string;
  ice: string;
  building: string;
  buildingLine: string;
  roadMotorway: string;
  roadMajor: string;
  roadMinor: string;
  roadCasing: string;
  rail: string;
  boundary: string;
  label: string;
  labelStrong: string;
  labelHalo: string;
  roadLabel: string;
  waterLabel: string;
  shieldFill: string;
  shieldText: string;
  accent: string; // primary-button colour while this theme is active (as in the reference)
}

export interface Theme {
  id: ThemeId;
  name: string;
  kind: "vector" | "satellite" | "terrain";
  palette: Palette;
}

const base: Palette = {
  land: "#fafaf8",
  water: "#d8e8ec",
  waterLine: "#c6dade",
  wave: "#8fa9b1",
  park: "#ecf2e6",
  wood: "#eff3ea",
  ice: "#ffffff",
  building: "#efefed",
  buildingLine: "#e2e2df",
  roadMotorway: "#dcdcd8",
  roadMajor: "#e4e4e0",
  roadMinor: "#ececea",
  roadCasing: "#d9d9d5",
  rail: "#d2d2ce",
  boundary: "#b9b9b4",
  label: "#8b8b86",
  labelStrong: "#55554f",
  labelHalo: "#ffffff",
  roadLabel: "#9a9a95",
  waterLabel: "#7f9aa3",
  shieldFill: "#ffffff",
  shieldText: "#55554f",
  accent: "#3b7be0",
};

export const THEMES: Theme[] = [
  { id: "glacier", name: "Glacier", kind: "vector", palette: base },
  {
    id: "lagoon", name: "Lagoon", kind: "vector",
    palette: { ...base, land: "#f4f4fc", water: "#6f9be0", waterLine: "#5f8bd3", wave: "#c9dbf7", park: "#e2f1e7",
      wood: "#e7f2ea", building: "#e9ebf8", buildingLine: "#dadef3", roadMotorway: "#b9cff4", roadMajor: "#c9daf6",
      roadMinor: "#dde6f8", roadCasing: "#b3c7ee", label: "#7d86a3", labelStrong: "#4b5372", waterLabel: "#eef4ff",
      roadLabel: "#8c94b0", accent: "#3b6fd6" },
  },
  {
    id: "canyon", name: "Canyon", kind: "vector",
    palette: { ...base, land: "#fdf3ef", water: "#c8d9e9", waterLine: "#b6cbdf", wave: "#8ea7bf", park: "#e3f2e1",
      wood: "#e8f2e3", building: "#f8e6de", buildingLine: "#f0d6ca", roadMotorway: "#f6c9b5", roadMajor: "#f9d6c6",
      roadMinor: "#fbe3d8", roadCasing: "#f1bea8", label: "#a08479", labelStrong: "#6d5246", roadLabel: "#ad9084",
      accent: "#d1683a" },
  },
  {
    id: "meadow", name: "Meadow", kind: "vector",
    palette: { ...base, land: "#ffffff", water: "#c5e3f7", waterLine: "#b1d6ef", wave: "#86b7d6", park: "#e1f5e8",
      wood: "#e6f6ec", building: "#f6eef2", buildingLine: "#eedde6", roadMotorway: "#f6c2d4", roadMajor: "#f9d4e0",
      roadMinor: "#fbe3eb", roadCasing: "#f0b5c9", label: "#9b8790", labelStrong: "#674f5a", roadLabel: "#a8939c",
      accent: "#d64f86" },
  },
  {
    id: "grotto", name: "Grotto", kind: "vector",
    palette: { ...base, land: "#f4f4fc", water: "#2c3854", waterLine: "#3a4766", wave: "#56658a", park: "#e4ecf1",
      wood: "#e8eef4", building: "#e6e9f6", buildingLine: "#d6dbef", roadMotorway: "#bccdf2", roadMajor: "#cdd9f4",
      roadMinor: "#dfe6f7", roadCasing: "#aebfe8", label: "#7a829c", labelStrong: "#3f4763", waterLabel: "#aab6d4",
      roadLabel: "#8890aa", accent: "#3456a8" },
  },
  {
    id: "forest", name: "Forest", kind: "vector",
    palette: { ...base, land: "#f2f2f0", water: "#2f5753", waterLine: "#3b6662", wave: "#5d8580", park: "#dbe6dc",
      wood: "#dfe8df", building: "#e6e6e3", buildingLine: "#d8d8d4", roadMotorway: "#d0d0cb", roadMajor: "#dadad6",
      roadMinor: "#e4e4e1", roadCasing: "#c6c6c1", label: "#7f8580", labelStrong: "#46504a", waterLabel: "#a7c3bf",
      accent: "#2f6d55" },
  },
  {
    id: "oasis", name: "Oasis", kind: "vector",
    palette: { ...base, land: "#fdf0e8", water: "#0b3a9e", waterLine: "#16469f", wave: "#3d66c2", park: "#fbf6dc",
      wood: "#f8f2d8", building: "#fae2d6", buildingLine: "#f3cfbd", roadMotorway: "#f8bf9d", roadMajor: "#fbcdb2",
      roadMinor: "#fcdccb", roadCasing: "#f4b08a", label: "#b08a76", labelStrong: "#7a5340", waterLabel: "#9fb7ec",
      roadLabel: "#bc9886", accent: "#c4733a" },
  },
  {
    id: "sahara", name: "Sahara", kind: "vector",
    palette: { ...base, land: "#fbe6d3", water: "#de9548", waterLine: "#cf8338", wave: "#f2c48f", park: "#f6dcb9",
      wood: "#f3d8b5", building: "#f6d7bd", buildingLine: "#efc6a4", roadMotorway: "#f3b77c", roadMajor: "#f6c592",
      roadMinor: "#f9d6b1", roadCasing: "#eaa665", label: "#a47a55", labelStrong: "#6e4b2d", waterLabel: "#fff1e0",
      roadLabel: "#b08661", accent: "#c66a1c" },
  },
  {
    id: "harbor", name: "Harbor", kind: "vector",
    palette: { ...base, land: "#ffffff", water: "#dde8ef", waterLine: "#cfdde7", wave: "#9fb4c2", park: "#f0f4ee",
      wood: "#f2f5ef", building: "#f3f3f3", buildingLine: "#e7e7e7", roadMotorway: "#e1e1e1", roadMajor: "#e7e7e7",
      roadMinor: "#eeeeee", roadCasing: "#dadada", accent: "#3b7be0" },
  },
  {
    id: "midnight", name: "Midnight", kind: "vector",
    palette: { ...base, land: "#1d2027", water: "#10151d", waterLine: "#1a212c", wave: "#2c3a4d", park: "#1f2a26",
      wood: "#1e2724", ice: "#2a2f38", building: "#262a33", buildingLine: "#2f343e", roadMotorway: "#4a505c",
      roadMajor: "#3a3f4a", roadMinor: "#2f343e", roadCasing: "#14171d", rail: "#3a3f4a", boundary: "#5a606c",
      label: "#8e95a3", labelStrong: "#c9ced8", labelHalo: "#14171d", roadLabel: "#7e8593", waterLabel: "#5d6c80",
      shieldFill: "#2c313b", shieldText: "#d5d9e1", accent: "#3b7be0" },
  },
  {
    id: "satellite", name: "Satellite", kind: "satellite",
    palette: { ...base, land: "#0d1410", roadMotorway: "rgba(255,240,200,0.85)", roadMajor: "rgba(255,255,255,0.6)",
      roadMinor: "rgba(255,255,255,0.32)", roadCasing: "rgba(0,0,0,0.35)", boundary: "rgba(255,255,255,0.6)",
      label: "#f2f2f2", labelStrong: "#ffffff", labelHalo: "rgba(0,0,0,0.75)", roadLabel: "#f1f1f1",
      waterLabel: "#cfe3f5", shieldFill: "rgba(20,20,20,0.75)", shieldText: "#ffffff" },
  },
  {
    id: "terrain", name: "Terrain", kind: "terrain",
    palette: { ...base, land: "#f3f1ea", water: "#c3d9ea", waterLine: "#adc9df", wave: "#86a8c2", park: "#dfe8d2",
      wood: "#d9e4cc", ice: "#ffffff", building: "#e9e5db", buildingLine: "#dcd6c8", roadMotorway: "#f3d38a",
      roadMajor: "#ffffff", roadMinor: "#fbfaf6", roadCasing: "#cfc8b6", label: "#7d7666", labelStrong: "#4d473a",
      roadLabel: "#8b8473", accent: "#3b7be0" },
  },
];

export const THEME_BY_ID = Object.fromEntries(THEMES.map((t) => [t.id, t])) as Record<ThemeId, Theme>;
export const DEFAULT_THEME: ThemeId = "glacier";
