import type Launchpad from "@chrisvdev/launchpad-controller";
import type { MIDIData } from "@chrisvdev/launchpad-controller";
import type { Appearance } from "../appearance";
import type { ConfigRepository } from "../config/repository";
import type { EventBus } from "../events";
import type { IndicatorService } from "../indicators";
import type { LedCompositor } from "../leds";
import { createLogger } from "../logger";
import type { ModuleRegistry } from "../modules/registry";
import type { ButtonControl, ButtonEvent } from "../modules/types";

const log = createLogger("core.dispatcher");

export class Dispatcher {
  #launchpad: Launchpad;
  #bindings: ConfigRepository;
  #modules: ModuleRegistry;
  #events: EventBus;
  #leds: LedCompositor;
  #indicators: IndicatorService;
  #isLocked: () => boolean = () => false;
  #unsubscribe: (() => void)[] = [];

  constructor(
    launchpad: Launchpad,
    bindings: ConfigRepository,
    modules: ModuleRegistry,
    events: EventBus,
    leds: LedCompositor,
    indicators: IndicatorService
  ) {
    this.#launchpad = launchpad;
    this.#bindings = bindings;
    this.#modules = modules;
    this.#events = events;
    this.#leds = leds;
    this.#indicators = indicators;
  }

  attach() {
    if (this.#unsubscribe.length) return;
    this.#launchpad.buttons.forEach((button, x, y) => {
      this.#unsubscribe.push(
        button.onPress((_b, _l, message) => void this.#dispatch(x, y, "press", message)),
        button.onRelease((_b, _l, message) => void this.#dispatch(x, y, "release", message))
      );
      this.applyIdentity(x, y);
    });
    this.#unsubscribe.push(
      this.#events.on("bindings", (target) => {
        if (target) this.applyIdentity(target.x, target.y);
        else this.#applyAllIdentities();
      }),
      this.#events.on("settings", ({ changed }) => {
        if (changed.includes("idleAppearance")) this.#applyAllIdentities();
      })
    );
  }

  setLockCheck(isLocked: () => boolean) {
    this.#isLocked = isLocked;
  }

  #applyAllIdentities() {
    this.#launchpad.buttons.forEach((_b, x, y) => this.applyIdentity(x, y));
  }

  detach() {
    for (const unsubscribe of this.#unsubscribe.splice(0)) unsubscribe();
  }

  applyIdentity(x: number, y: number) {
    this.#leds.setIdentity(x, y, this.#identity(x, y));
  }

  simulate(x: number, y: number, event: ButtonEvent) {
    return this.#dispatch(x, y, event);
  }

  #identity(x: number, y: number): Appearance {
    return this.#bindings.get(x, y)?.appearance ?? this.#bindings.getSettings().idleAppearance;
  }

  #control(x: number, y: number): ButtonControl {
    const set = (appearance: Appearance) => this.#leds.setAction(x, y, appearance);
    return {
      set,
      setStatic: (code) => set({ mode: "static", code }),
      setPulsing: (code) => set({ mode: "pulsing", code }),
      setFlashing: (code, code2) => set({ mode: "flashing", code, code2 }),
      setRGB: (r, g, b) => set({ mode: "rgb", r, g, b }),
      restore: () => this.#leds.setAction(x, y, null),
    };
  }

  async #dispatch(x: number, y: number, event: ButtonEvent, message?: MIDIData) {
    const binding = this.#bindings.get(x, y);
    const action = binding?.action ? this.#modules.resolve(binding.action.module, binding.action.action) : undefined;
    // Only physical presses are locked; panel simulations always run.
    const blocked = Boolean(message) && this.#isLocked() && !action?.allowWhenLocked;
    this.#events.emit("button", { x, y, event, simulated: !message, blocked });

    log.debug(`(${x},${y}) ${event}${message ? "" : " (simulated)"}${blocked ? " blocked" : ""}`, {
      action: binding?.action ? `${binding.action.module}.${binding.action.action}` : null,
    });
    if (!binding?.action || blocked) return;

    const { module, action: actionId, params: rawParams } = binding.action;
    const fail = (error: unknown) => {
      const text = error instanceof Error ? error.message : String(error);
      log.error(`${module}.${actionId} failed at (${x},${y}) on ${event}`, error instanceof Error ? error : new Error(text), {
        params: rawParams,
      });
      this.#events.emit("action-error", {
        x,
        y,
        module,
        action: actionId,
        message: text,
        at: new Date().toISOString(),
      });
    };

    if (!action) return fail(new Error(`Unknown action ${module}.${actionId}`));
    const params = this.#modules.validateParams(action, rawParams);
    if (!params.ok) return fail(new Error(params.errors.join("; ")));

    const started = performance.now();
    try {
      await action.handle({
        event,
        coordinate: { x, y },
        binding: { name: binding.name, description: binding.description },
        params: params.params,
        message,
        button: this.#control(x, y),
        indicator: (id) => this.#indicators.handle(module, id),
        log: createLogger(`module.${module}`),
      });
      log.debug(`${module}.${actionId} done in ${Math.round(performance.now() - started)} ms`);
    } catch (error) {
      fail(error);
    }
  }
}
