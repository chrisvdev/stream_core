import type { Rgb } from "../../lib/palette";
import type { Gamut, XY } from "./state";

/** "#rrggbb" or "rrggbb" → [r, g, b]; returns null for anything else. */
export function hexToRgb(value: string): Rgb | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const n = Number.parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Gamut C, the widest current Hue gamut; used when a light doesn't report one.
const DEFAULT_GAMUT: Gamut = { red: { x: 0.6915, y: 0.3083 }, green: { x: 0.17, y: 0.7 }, blue: { x: 0.1532, y: 0.0475 } };

const cross = (a: XY, b: XY) => a.x * b.y - a.y * b.x;

function inGamut(p: XY, g: Gamut) {
  const v1 = { x: g.green.x - g.red.x, y: g.green.y - g.red.y };
  const v2 = { x: g.blue.x - g.red.x, y: g.blue.y - g.red.y };
  const q = { x: p.x - g.red.x, y: p.y - g.red.y };
  const s = cross(q, v2) / cross(v1, v2);
  const t = cross(v1, q) / cross(v1, v2);
  return s >= 0 && t >= 0 && s + t <= 1;
}

function closestOnLine(a: XY, b: XY, p: XY): XY {
  const ab = { x: b.x - a.x, y: b.y - a.y };
  const t = Math.min(1, Math.max(0, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / (ab.x * ab.x + ab.y * ab.y)));
  return { x: a.x + ab.x * t, y: a.y + ab.y * t };
}

/** sRGB → CIE xy (Hue's color model), clamped into the light's gamut. Brightness is returned separately (0–100). */
export function rgbToXy([r, g, b]: Rgb, gamut: Gamut | null = null): { xy: XY; brightness: number } {
  const linear = (c: number) => {
    const v = c / 255;
    return v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92;
  };
  const [R, G, B] = [linear(r), linear(g), linear(b)];
  const X = R * 0.4124 + G * 0.3576 + B * 0.1805;
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const Z = R * 0.0193 + G * 0.1192 + B * 0.9505;
  const sum = X + Y + Z;
  let xy: XY = sum === 0 ? { x: 0.3127, y: 0.329 } : { x: X / sum, y: Y / sum };

  const g2 = gamut ?? DEFAULT_GAMUT;
  if (!inGamut(xy, g2)) {
    const candidates = [
      closestOnLine(g2.red, g2.green, xy),
      closestOnLine(g2.green, g2.blue, xy),
      closestOnLine(g2.blue, g2.red, xy),
    ];
    const dist = (p: XY) => (p.x - xy.x) ** 2 + (p.y - xy.y) ** 2;
    xy = candidates.reduce((best, p) => (dist(p) < dist(best) ? p : best));
  }
  const brightness = Math.max(r, g, b) / 2.55;
  return { xy: { x: round4(xy.x), y: round4(xy.y) }, brightness: Math.round(brightness * 10) / 10 };
}

const round4 = (v: number) => Math.round(v * 10_000) / 10_000;

export function hsvToRgb(h: number, s = 1, v = 1): Rgb {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const [r, g, b] = [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q],
  ][((i % 6) + 6) % 6];
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}
