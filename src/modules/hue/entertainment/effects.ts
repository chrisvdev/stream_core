import type { Rgb } from "../../../lib/palette";
import { hsvToRgb } from "../colors";

export const EFFECTS = ["solid", "strobe", "pulse", "rainbow", "chase"] as const;
export type EffectName = (typeof EFFECTS)[number];

export interface EffectSpec {
  effect: EffectName;
  color?: Rgb;
  /** Second color for strobe/chase; black when omitted. */
  color2?: Rgb;
  /** Cycles per second. */
  speed?: number;
  /** Channel ids to affect; all channels when omitted. */
  channels?: number[];
  /** Auto-stop after this many ms; runs until stopped when omitted. */
  durationMs?: number;
}

const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];

const scale = (c: Rgb, k: number): Rgb => [Math.round(c[0] * k), Math.round(c[1] * k), Math.round(c[2] * k)];

/** Pure frame function: color of `index`-th channel (of `count`) `elapsedMs` after the effect started. */
export function renderEffect(spec: EffectSpec, elapsedMs: number, index: number, count: number): Rgb {
  const color = spec.color ?? WHITE;
  const color2 = spec.color2 ?? BLACK;
  const cycles = (elapsedMs / 1000) * (spec.speed ?? 2);
  switch (spec.effect) {
    case "solid":
      return color;
    case "strobe":
      return cycles % 1 < 0.5 ? color : color2;
    case "pulse":
      return scale(color, 0.5 + 0.5 * Math.cos(cycles * 2 * Math.PI));
    case "rainbow":
      return hsvToRgb((cycles * 0.25 + index / Math.max(count, 1)) % 1);
    case "chase":
      return Math.floor(cycles) % Math.max(count, 1) === index ? color : color2;
  }
}
