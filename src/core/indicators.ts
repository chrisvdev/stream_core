import type { Appearance } from "./appearance";
import type { ConfigRepository } from "./config/repository";
import type { EventBus } from "./events";
import type { LedCompositor } from "./leds";
import { createLogger } from "./logger";
import type { ModuleRegistry } from "./modules/registry";
import type { IndicatorHandle } from "./modules/types";

const log = createLogger("core.indicators");

export interface ActiveIndicator {
  module: string;
  indicator: string;
  state: string;
}

interface ActiveState extends ActiveIndicator {
  /** Activation order, used to break priority ties in favor of the most recent. */
  seq: number;
}

const id = (module: string, indicator: string) => `${module}\u0000${indicator}`;

export class IndicatorService {
  #leds: LedCompositor;
  #config: ConfigRepository;
  #modules: ModuleRegistry;
  #events: EventBus;
  #active = new Map<string, ActiveState>();
  #timers = new Map<string, ReturnType<typeof setTimeout>>();
  #seq = 0;
  #unsubscribe: (() => void)[] = [];

  constructor(leds: LedCompositor, config: ConfigRepository, modules: ModuleRegistry, events: EventBus) {
    this.#leds = leds;
    this.#config = config;
    this.#modules = modules;
    this.#events = events;
  }

  start() {
    this.#unsubscribe.push(
      this.#events.on("indicators-config", () => this.#refreshAll()),
      this.#events.on("catalog", ({ module }) => this.#pruneVanished(module))
    );
  }

  dispose() {
    for (const unsubscribe of this.#unsubscribe.splice(0)) unsubscribe();
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
  }

  handle(module: string, indicator: string): IndicatorHandle {
    if (!this.#modules.resolveIndicator(module, indicator)) {
      throw new Error(`Unknown indicator ${module}.${indicator}`);
    }
    return {
      set: (state) => this.set(module, indicator, state),
      clear: () => this.set(module, indicator, null),
      flash: (state, ms) => {
        this.set(module, indicator, state);
        this.#timers.set(
          id(module, indicator),
          setTimeout(() => {
            try {
              this.set(module, indicator, null);
            } catch (error) {
              log.warn(`Could not end flash of ${module}.${indicator}`, error);
            }
          }, ms)
        );
      },
      current: () => this.#active.get(id(module, indicator))?.state ?? null,
    };
  }

  set(module: string, indicator: string, state: string | null) {
    const definition = this.#modules.resolveIndicator(module, indicator);
    if (!definition) throw new Error(`Unknown indicator ${module}.${indicator}`);
    if (state !== null && !definition.states.some((s) => s.id === state)) {
      throw new Error(`Unknown state "${state}" for indicator ${module}.${indicator}`);
    }

    const key = id(module, indicator);
    clearTimeout(this.#timers.get(key));
    this.#timers.delete(key);
    log.debug(`${module}.${indicator} -> ${state ?? "cleared"}`);

    if (state === null) {
      if (!this.#active.delete(key)) return;
    } else {
      this.#active.set(key, { module, indicator, state, seq: ++this.#seq });
    }
    this.#events.emit("indicator", { module, indicator, state });

    for (const a of this.#config.listIndicators()) {
      if (a.module === module && a.indicator === indicator) this.#refresh(a.x, a.y);
    }
  }

  active(): ActiveIndicator[] {
    return [...this.#active.values()].map(({ module, indicator, state }) => ({ module, indicator, state }));
  }

  #refreshAll() {
    for (let x = 0; x < 9; x++) for (let y = 0; y < 9; y++) this.#refresh(x, y);
  }

  // Dynamic indicators (e.g. a deleted OBS scene) can disappear while active.
  #pruneVanished(module: string) {
    let pruned = false;
    for (const [key, active] of this.#active) {
      if (active.module !== module) continue;
      const definition = this.#modules.resolveIndicator(module, active.indicator);
      if (definition?.states.some((s) => s.id === active.state)) continue;
      this.#active.delete(key);
      clearTimeout(this.#timers.get(key));
      this.#timers.delete(key);
      this.#events.emit("indicator", { module, indicator: active.indicator, state: null });
      pruned = true;
    }
    if (pruned) this.#refreshAll();
  }

  #refresh(x: number, y: number) {
    let best: { priority: number; seq: number; appearance: Appearance } | undefined;

    for (const a of this.#config.listIndicators()) {
      if (a.x !== x || a.y !== y) continue;
      const active = this.#active.get(id(a.module, a.indicator));
      if (!active) continue;
      if (best && (a.priority < best.priority || (a.priority === best.priority && active.seq < best.seq))) continue;

      const appearance =
        a.states[active.state] ??
        this.#modules.resolveIndicator(a.module, a.indicator)?.states.find((s) => s.id === active.state)?.appearance;
      if (appearance) best = { priority: a.priority, seq: active.seq, appearance };
    }

    this.#leds.setOverlay(x, y, best?.appearance ?? null);
  }
}
