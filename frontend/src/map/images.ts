import type { Map as MapLibreMap } from "maplibre-gl";
import { riskColor } from "../lib/risk";
import { SHIELD_IMAGE, WAVES_IMAGE } from "./style";
import type { Palette } from "./themes";

/**
 * Images drawn at runtime instead of shipping a sprite: the reference's
 * hand-drawn water squiggles, stretchable road shields and route pills, and
 * emoji "stickers" with a die-cut white outline (the reference marks places
 * with sticker emoji; here they show the weather at each checkpoint).
 */

const PR = 2; // draw at 2x for crisp edges on retina screens

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w * PR;
  c.height = h * PR;
  const ctx = c.getContext("2d")!;
  ctx.scale(PR, PR);
  return [c, ctx];
}

function imageData(c: HTMLCanvasElement): ImageData {
  return c.getContext("2d")!.getImageData(0, 0, c.width, c.height);
}

function squiggle(ctx: CanvasRenderingContext2D, x: number, y: number, rows: number) {
  for (let r = 0; r < rows; r++) {
    ctx.beginPath();
    const yy = y + r * 5;
    ctx.moveTo(x, yy);
    for (let k = 0; k < 3; k++) {
      ctx.quadraticCurveTo(x + k * 7 + 1.75, yy - 2.6, x + k * 7 + 3.5, yy);
      ctx.quadraticCurveTo(x + k * 7 + 5.25, yy + 2.6, x + k * 7 + 7, yy);
    }
    ctx.stroke();
  }
}

export function addWaves(map: MapLibreMap, palette: Palette) {
  const [c, ctx] = canvas(150, 110);
  ctx.strokeStyle = palette.wave;
  ctx.lineWidth = 1.1;
  ctx.lineCap = "round";
  squiggle(ctx, 18, 26, 2);
  squiggle(ctx, 96, 80, 2);
  if (map.hasImage(WAVES_IMAGE)) map.removeImage(WAVES_IMAGE);
  map.addImage(WAVES_IMAGE, imageData(c), { pixelRatio: PR });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** A 9-slice image MapLibre can stretch around text (icon-text-fit). */
function addStretchable(map: MapLibreMap, id: string, fill: string, stroke: string | null, radius: number) {
  const w = 24;
  const h = 20;
  const [c, ctx] = canvas(w, h);
  roundRect(ctx, 1, 1, w - 2, h - 2, radius);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  if (map.hasImage(id)) map.removeImage(id);
  map.addImage(id, imageData(c), {
    pixelRatio: PR,
    stretchX: [[radius * PR, (w - radius) * PR]],
    stretchY: [[radius * PR, (h - radius) * PR]],
    content: [radius * PR, 4 * PR, (w - radius) * PR, (h - 4) * PR],
  });
}

export const PILL_IMAGES = { gray: "pill-gray", dark: "pill-dark", blue: "pill-blue" } as const;

export function addChrome(map: MapLibreMap, palette: Palette) {
  addWaves(map, palette);
  addStretchable(map, SHIELD_IMAGE, palette.shieldFill, "rgba(0,0,0,0.18)", 4);
  addStretchable(map, PILL_IMAGES.gray, "#7b8287", "rgba(255,255,255,0.9)", 8);
  addStretchable(map, PILL_IMAGES.dark, "#2f3439", "rgba(255,255,255,0.95)", 8);
  addStretchable(map, PILL_IMAGES.blue, "#3b7be0", "rgba(255,255,255,0.95)", 8);
}

// --- stickers -------------------------------------------------------------------

const EMOJI_FONT = `"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Twemoji Mozilla",sans-serif`;

/** Sticker id: `sticker:<emoji>:<badge level or "">:<size>` */
export function stickerId(emoji: string, badgeLevel: number | null = null, size = 30): string {
  return `sticker:${emoji}:${badgeLevel ?? ""}:${size}`;
}

function drawSticker(emoji: string, badgeLevel: number | null, size: number): ImageData {
  const pad = Math.ceil(size * 0.22);
  const box = size + pad * 2;
  const [glyph, g] = canvas(box, box);
  g.font = `${size * 0.82}px ${EMOJI_FONT}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(emoji, box / 2, box / 2 + size * 0.06);

  // White silhouette of the glyph, stamped around it = die-cut outline.
  const [mask, m] = canvas(box, box);
  m.drawImage(glyph, 0, 0, box, box);
  m.globalCompositeOperation = "source-in";
  m.fillStyle = "#ffffff";
  m.fillRect(0, 0, box, box);

  const [out, o] = canvas(box, box);
  o.shadowColor = "rgba(0,0,0,0.28)";
  o.shadowBlur = 3;
  o.shadowOffsetY = 1;
  const ring = Math.max(2, size * 0.08);
  for (let a = 0; a < 16; a++) {
    const t = (a / 16) * Math.PI * 2;
    o.drawImage(mask, Math.cos(t) * ring, Math.sin(t) * ring, box, box);
  }
  o.shadowColor = "transparent";
  o.drawImage(glyph, 0, 0, box, box);

  if (badgeLevel != null) {
    const r = Math.max(5, size * 0.2);
    const cx = box - pad - r * 0.35;
    const cy = pad + r * 0.55;
    o.beginPath();
    o.arc(cx, cy, r + 1.6, 0, Math.PI * 2);
    o.fillStyle = "#ffffff";
    o.fill();
    o.beginPath();
    o.arc(cx, cy, r, 0, Math.PI * 2);
    o.fillStyle = riskColor(badgeLevel);
    o.fill();
  }
  return imageData(out);
}

/** Lazily create sticker images the first time a layer asks for them. */
export function handleMissingImage(map: MapLibreMap, id: string) {
  if (!id.startsWith("sticker:") || map.hasImage(id)) return;
  const [, emoji, badge, size] = id.split(":");
  map.addImage(id, drawSticker(emoji, badge === "" ? null : Number(badge), Number(size) || 30), { pixelRatio: PR });
}
