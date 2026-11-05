import type { Appearance, Binding, LedLayer } from "../../core";
import { AppearancePreview } from "./AppearanceEditor";

export interface LedView {
  appearance: Appearance;
  layer: LedLayer;
}

interface Props {
  leds: Map<string, LedView>;
  bindings: Map<string, Binding>;
  pressed: Set<string>;
  selected: { x: number; y: number } | null;
  /** Locations with at least one indicator assigned. */
  indicatorCoords: Set<string>;
  picking: boolean;
  /** Locations whose last press was ignored because buttons are locked. */
  blocked?: Set<string>;
  onSelect(x: number, y: number): void;
}

const AXIS = [0, 1, 2, 3, 4, 5, 6, 7, 8];
// y = 0 is the bottom row on the device (MIDI code 11).
const ROWS = [...AXIS].reverse();

export default function LaunchpadGrid({ leds, bindings, pressed, selected, indicatorCoords, picking, blocked, onSelect }: Props) {
  return (
    <div class={`grid${picking ? " picking" : ""}`}>
      {ROWS.map((y) =>
        AXIS.map((x) => {
          const key = `${x},${y}`;
          const binding = bindings.get(key);
          const led = leds.get(key);
          const round = x === 8 || y === 8;
          const classes = [
            "cell",
            round && "round",
            x === 8 && y === 8 && "logo",
            pressed.has(key) && "pressed",
            selected?.x === x && selected.y === y && "selected",
            binding?.action && "bound",
            indicatorCoords.has(key) && "has-indicator",
            led?.layer === "overlay" && "overlay",
            blocked?.has(key) && "blocked",
          ]
            .filter(Boolean)
            .join(" ");
          const title = [`(${x},${y})`, binding?.name, binding?.action && `${binding.action.module}.${binding.action.action}`]
            .filter(Boolean)
            .join(" · ");
          return (
            <button type="button" key={key} class={classes} title={title} onClick={() => onSelect(x, y)}>
              {led && <AppearancePreview appearance={led.appearance} size="100%" />}
              {binding?.name && <span class="cell-name">{binding.name}</span>}
            </button>
          );
        })
      )}
    </div>
  );
}
