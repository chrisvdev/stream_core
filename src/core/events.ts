import { EventEmitter } from "node:events";
import type { LogRecord } from "../lib/log/shared";
import type { Appearance } from "./appearance";
import type { Settings } from "./config/schema";
import type { ButtonEvent } from "./modules/types";
import { createLogger } from "./logger";

const log = createLogger("core.events");

export type SettingsKey = keyof Settings;

export interface DeviceStatus {
  sleeping: boolean;
  tempo: number | null;
  brightness: number;
  /** Physical button presses are ignored except for actions with `allowWhenLocked`. */
  locked: boolean;
  lockReason: "manual" | "asleep" | null;
}

export type LedLayer = "identity" | "action" | "overlay" | "blackout";

export interface CoreEvents {
  button: { x: number; y: number; event: ButtonEvent; simulated: boolean; blocked?: boolean };
  appearance: { x: number; y: number; appearance: Appearance; layer: LedLayer };
  /** `null` means every button may have changed (e.g. import). */
  bindings: { x: number; y: number } | null;
  settings: { settings: Settings; changed: SettingsKey[] };
  indicator: { module: string; indicator: string; state: string | null };
  "indicators-config": null;
  device: DeviceStatus;
  /** Number of browsers connected to the live event stream (admin panels open). */
  "panel-clients": { count: number };
  /** A module's dynamic params or indicators changed. */
  catalog: { module: string };
  "module-config": { module: string };
  "module-status": { module: string; status: unknown };
  /** Server log records at or above `settings.logging.browserLevel`. */
  log: LogRecord;
  "action-error": { x: number; y: number; module: string; action: string; message: string; at: string };
}

export type CoreEventName = keyof CoreEvents;

export class EventBus {
  #emitter = new EventEmitter().setMaxListeners(0);

  emit<K extends CoreEventName>(name: K, payload: CoreEvents[K]) {
    this.#emitter.emit(name, payload);
  }

  on<K extends CoreEventName>(name: K, listener: (payload: CoreEvents[K]) => void) {
    // A throwing listener would otherwise abort the emitter's caller (e.g. a config save) far from the cause.
    const safe = (payload: CoreEvents[K]) => {
      try {
        listener(payload);
      } catch (error) {
        if (name !== "log") log.error(`Listener for "${name}" threw`, error);
      }
    };
    this.#emitter.on(name, safe);
    return () => {
      this.#emitter.off(name, safe);
    };
  }
}
