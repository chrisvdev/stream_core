import type Launchpad from "@chrisvdev/launchpad-controller";
import type { Appearance } from "./appearance";
import type { ConfigRepository } from "./config/repository";
import type { DeviceStatus, EventBus } from "./events";
import type { LedCompositor } from "./leds";
import { createLogger } from "./logger";

const log = createLogger("core.device");

export interface SleepStrategy {
  /**
   * `blackout` paints the LEDs black in software so presses keep arriving; `hardware` uses the
   * Launchpad's own sleep, which may stop it from reporting presses (so it can't be woken from a pad).
   */
  mode: "blackout" | "hardware";
  /** Locations kept visible (dim) while blacked out, keyed "x,y". */
  keep(): Map<string, Appearance>;
}

/** Applies device-wide settings (tempo, brightness) and holds the runtime sleep/lock state. */
export class DeviceController {
  #launchpad: Launchpad;
  #config: ConfigRepository;
  #events: EventBus;
  #leds: LedCompositor;
  #sleeping = false;
  #manualLock = false;
  #lockWhenAsleep = true;
  #strategy: SleepStrategy = { mode: "blackout", keep: () => new Map() };
  #unsubscribe?: () => void;

  constructor(launchpad: Launchpad, config: ConfigRepository, events: EventBus, leds: LedCompositor) {
    this.#launchpad = launchpad;
    this.#config = config;
    this.#events = events;
    this.#leds = leds;
  }

  start() {
    // The device keeps its own sleep state across restarts (e.g. if the process was killed while asleep).
    this.#launchpad.setSleep(false);
    log.info("Launchpad woken on startup");
    const { tempo, brightness } = this.#config.getSettings();
    this.#launchpad.setTempo(tempo);
    this.#launchpad.setBrightness(brightness);
    log.info("Device settings applied", { tempo, brightness });
    this.#unsubscribe = this.#events.on("settings", ({ settings, changed }) => {
      if (changed.includes("tempo")) {
        this.#launchpad.setTempo(settings.tempo);
        log.info("Tempo changed", { tempo: settings.tempo });
      }
      if (changed.includes("brightness")) {
        this.#launchpad.setBrightness(settings.brightness);
        log.info("Brightness changed", { brightness: settings.brightness });
      }
      if (changed.includes("tempo") || changed.includes("brightness")) this.#emit();
    });
  }

  setSleep(sleeping: boolean) {
    this.#sleeping = sleeping;
    this.#applySleep();
    log.info(sleeping ? `LEDs off (${this.#strategy.mode})` : "LEDs on");
    this.#emit();
  }

  setSleepStrategy(strategy: SleepStrategy) {
    const previous = this.#strategy.mode;
    this.#strategy = strategy;
    // Leaving hardware mode while asleep must wake the device, or it stays dark.
    if (previous === "hardware" && strategy.mode !== "hardware") this.#launchpad.setSleep(false);
    if (previous === "blackout" && strategy.mode !== "blackout") this.#leds.setBlackout(false);
    this.#applySleep();
  }

  /** Re-applies the off state, e.g. after the set of buttons kept visible changed. */
  refreshSleep() {
    if (this.#sleeping) this.#applySleep();
  }

  #applySleep() {
    if (this.#strategy.mode === "hardware") {
      this.#launchpad.setSleep(this.#sleeping);
    } else {
      this.#leds.setBlackout(this.#sleeping, this.#sleeping ? this.#strategy.keep() : undefined);
    }
  }

  setLocked(locked: boolean) {
    if (this.#manualLock === locked) return;
    this.#manualLock = locked;
    log.info(locked ? "Buttons locked" : "Buttons unlocked");
    this.refreshSleep();
    this.#emit();
  }

  setLockWhenAsleep(enabled: boolean) {
    if (this.#lockWhenAsleep === enabled) return;
    this.#lockWhenAsleep = enabled;
    this.#emit();
  }

  isLocked() {
    return this.#lockReason() !== null;
  }

  #lockReason(): DeviceStatus["lockReason"] {
    if (this.#manualLock) return "manual";
    if (this.#sleeping && this.#lockWhenAsleep) return "asleep";
    return null;
  }

  status(): DeviceStatus {
    const lockReason = this.#lockReason();
    return {
      sleeping: this.#sleeping,
      tempo: this.#launchpad.getTempo(),
      brightness: this.#config.getSettings().brightness,
      locked: lockReason !== null,
      lockReason,
    };
  }

  dispose() {
    this.#unsubscribe?.();
    this.#launchpad.setTempo(null);
    this.#leds.setBlackout(false);
    this.#launchpad.setSleep(false);
  }

  #emit() {
    this.#events.emit("device", this.status());
  }
}
