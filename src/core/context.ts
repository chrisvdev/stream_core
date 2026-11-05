import type Launchpad from "@chrisvdev/launchpad-controller";
import type { Dispatcher } from "./bindings/dispatcher";
import type { ConfigRepository } from "./config/repository";
import type { DeviceController } from "./device";
import type { EventBus } from "./events";
import type { IndicatorService } from "./indicators";
import type { LedCompositor } from "./leds";
import type { ModuleRegistry } from "./modules/registry";

export interface AppContext {
  launchpad: Launchpad;
  events: EventBus;
  modules: ModuleRegistry;
  config: ConfigRepository;
  leds: LedCompositor;
  indicators: IndicatorService;
  dispatcher: Dispatcher;
  device: DeviceController;
}
