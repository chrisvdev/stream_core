import type Launchpad from "@chrisvdev/launchpad-controller";
import { applyAppearance, type Appearance } from "./appearance";
import type { EventBus, LedLayer } from "./events";
import { createLogger } from "./logger";

const log = createLogger("core.leds");

const BLACK: Appearance = { mode: "rgb", r: 0, g: 0, b: 0 };

export interface ButtonState {
  x: number;
  y: number;
  appearance: Appearance;
  layer: LedLayer;
}

interface Layers {
  identity: Appearance;
  action?: Appearance;
  overlay?: Appearance;
  shown?: string;
}

/** Resolves what each LED shows: indicator overlay, else an action's temporary color, else the identity color. */
export class LedCompositor {
  #launchpad: Launchpad;
  #events: EventBus;
  #layers = new Map<string, Layers>();
  /** While set, every LED is black except these locations (e.g. a dim "wake" button). */
  #blackout: Map<string, Appearance> | null = null;

  constructor(launchpad: Launchpad, events: EventBus) {
    this.#launchpad = launchpad;
    this.#events = events;
  }

  setIdentity(x: number, y: number, appearance: Appearance) {
    const layers = this.#layers.get(key(x, y));
    if (layers) layers.identity = appearance;
    else this.#layers.set(key(x, y), { identity: appearance });
    this.#render(x, y);
  }

  setAction(x: number, y: number, appearance: Appearance | null) {
    this.#update(x, y, "action", appearance);
  }

  setOverlay(x: number, y: number, appearance: Appearance | null) {
    this.#update(x, y, "overlay", appearance);
  }

  /** Drops every temporary color set by actions, showing overlays/identity again. */
  clearActions() {
    for (const [k, layers] of this.#layers) {
      if (!layers.action) continue;
      delete layers.action;
      const [x, y] = k.split(",").map(Number);
      this.#render(x, y);
    }
  }

  /**
   * Software "LEDs off": a top layer that paints everything black but keeps the device sending presses
   * (the Launchpad's own sleep mode may not). Underlying layers keep updating and reappear when disabled.
   */
  setBlackout(enabled: boolean, keep: Map<string, Appearance> = new Map()) {
    this.#blackout = enabled ? keep : null;
    for (const k of this.#layers.keys()) {
      const [x, y] = k.split(",").map(Number);
      this.#render(x, y);
    }
  }

  get blackout() {
    return this.#blackout !== null;
  }

  state(): ButtonState[] {
    return [...this.#layers.entries()].map(([k, layers]) => {
      const [x, y] = k.split(",").map(Number);
      return { x, y, ...this.#resolve(k, layers) };
    });
  }

  #update(x: number, y: number, layer: "action" | "overlay", appearance: Appearance | null) {
    const layers = this.#layers.get(key(x, y));
    if (!layers) return;
    if (appearance) layers[layer] = appearance;
    else delete layers[layer];
    this.#render(x, y);
  }

  #render(x: number, y: number) {
    const layers = this.#layers.get(key(x, y));
    const button = this.#launchpad.buttons.at(x, y);
    if (!layers || !button) return;

    const { appearance, layer } = this.#resolve(key(x, y), layers);
    const signature = `${layer}:${JSON.stringify(appearance)}`;
    if (signature === layers.shown) return;
    layers.shown = signature;
    applyAppearance(button, appearance);
    log.trace(`(${x},${y}) ${layer}`, appearance);
    this.#events.emit("appearance", { x, y, appearance, layer });
  }

  #resolve(k: string, layers: Layers): { appearance: Appearance; layer: LedLayer } {
    if (this.#blackout) return { appearance: this.#blackout.get(k) ?? BLACK, layer: "blackout" };
    return resolve(layers);
  }
}

const key = (x: number, y: number) => `${x},${y}`;

function resolve(layers: Layers): { appearance: Appearance; layer: LedLayer } {
  if (layers.overlay) return { appearance: layers.overlay, layer: "overlay" };
  if (layers.action) return { appearance: layers.action, layer: "action" };
  return { appearance: layers.identity, layer: "identity" };
}
