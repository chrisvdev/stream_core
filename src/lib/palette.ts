import type { Appearance } from "../core";

// Mirrors palette.txt: 2 bits per channel, low bank scaled by 10 and high bank (64+) by 21, on a 0–63 scale.
export function paletteToRgb(code: number): [number, number, number] {
  const scale = code >= 64 ? 21 : 10;
  const c = code & 63;
  const to255 = (v: number) => Math.round((v * scale * 255) / 63);
  return [to255((c >> 4) & 3), to255((c >> 2) & 3), to255(c & 3)];
}

export const paletteCss = (code: number) => `rgb(${paletteToRgb(code).join(" ")})`;

export const rgb127ToCss = (r: number, g: number, b: number) =>
  `rgb(${[r, g, b].map((v) => Math.round((v * 255) / 127)).join(" ")})`;

export function appearanceColors(appearance: Appearance): [string, string?] {
  switch (appearance.mode) {
    case "static":
    case "pulsing":
      return [paletteCss(appearance.code)];
    case "flashing":
      return [paletteCss(appearance.code), paletteCss(appearance.code2)];
    case "rgb":
      return [rgb127ToCss(appearance.r, appearance.g, appearance.b)];
  }
}

export type Rgb = [number, number, number];

/**
 * Color an LED shows at a point in the beat (0–1), animating pulsing/flashing like the device does.
 * Approximation: the device's exact pulse curve isn't documented.
 */
export function appearanceToRgb(appearance: Appearance, beatPhase: number): Rgb {
  switch (appearance.mode) {
    case "static":
      return paletteToRgb(appearance.code);
    case "pulsing": {
      const level = 0.25 + 0.75 * (0.5 + 0.5 * Math.cos(beatPhase * 2 * Math.PI));
      return paletteToRgb(appearance.code).map((v) => Math.round(v * level)) as Rgb;
    }
    case "flashing":
      return paletteToRgb(beatPhase < 0.5 ? appearance.code : appearance.code2);
    case "rgb":
      return [appearance.r, appearance.g, appearance.b].map((v) => Math.round((v * 255) / 127)) as Rgb;
  }
}
