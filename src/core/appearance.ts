import type { Button } from "@chrisvdev/launchpad-controller";

export type Appearance =
  | { mode: "static"; code: number }
  | { mode: "pulsing"; code: number }
  | { mode: "flashing"; code: number; code2: number }
  | { mode: "rgb"; r: number; g: number; b: number };

// Matches the library's initial pixel for buttons without an identity color.
export const DEFAULT_APPEARANCE: Appearance = { mode: "rgb", r: 2, g: 2, b: 2 };

export function applyAppearance(button: Button, appearance: Appearance) {
  switch (appearance.mode) {
    case "static":
      return button.setStatic(appearance.code);
    case "pulsing":
      return button.setPulsing(appearance.code);
    case "flashing":
      return button.setFlashing(appearance.code, appearance.code2);
    case "rgb":
      return button.setRGB(appearance.r, appearance.g, appearance.b);
  }
}
