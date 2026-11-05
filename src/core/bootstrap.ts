import Launchpad from "@chrisvdev/launchpad-controller";
import { levelEnabled } from "../lib/log/shared";
import { modules as builtinModules } from "../modules";
import { Dispatcher } from "./bindings/dispatcher";
import { ConfigRepository } from "./config/repository";
import type { AppContext } from "./context";
import { DeviceController } from "./device";
import { EventBus } from "./events";
import { IndicatorService } from "./indicators";
import { LedCompositor } from "./leds";
import { createLogger, logManager } from "./logger";
import { ModuleRegistry } from "./modules/registry";

const log = createLogger("core.bootstrap");

// Stored on globalThis so Vite HMR and the separate Astro bundle share one instance.
const KEY = Symbol.for("stream_core.context");

interface Registry {
  promise: Promise<AppContext>;
  context?: AppContext;
  teardown?: () => Promise<void>;
}

const store = globalThis as typeof globalThis & { [KEY]?: Registry };

async function create(): Promise<{ context: AppContext; cleanups: (() => void)[] }> {
  const started = performance.now();
  const cleanups: (() => void)[] = [];
  const events = new EventBus();
  const modules = new ModuleRegistry(events);
  for (const module of builtinModules) modules.register(module);
  log.debug("Modules registered", { modules: builtinModules.map((m) => m.id) });

  const config = new ConfigRepository(events, modules);
  await config.load();
  logManager.configure(config.getSettings().logging);
  log.info("Config loaded", { path: config.path, logLevel: logManager.baseLevel, logDir: logManager.dir });
  cleanups.push(
    events.on("settings", ({ settings, changed }) => {
      if (!changed.includes("logging")) return;
      logManager.configure(settings.logging);
      log.info("Logging settings applied", settings.logging);
    }),
    logManager.onRecord((record) => {
      if (levelEnabled(record.level, logManager.options.browserLevel)) events.emit("log", record);
    })
  );

  log.info("Connecting Launchpad", config.getSettings().midi);
  const launchpad = await Launchpad.connect(config.getSettings().midi);
  const leds = new LedCompositor(launchpad, events);
  const indicators = new IndicatorService(leds, config, modules, events);
  const dispatcher = new Dispatcher(launchpad, config, modules, events, leds, indicators);
  const device = new DeviceController(launchpad, config, events, leds);
  dispatcher.setLockCheck(() => device.isLocked());
  const context: AppContext = { launchpad, events, modules, config, leds, indicators, dispatcher, device };
  try {
    dispatcher.attach();
    indicators.start();
    device.start();
    await modules.initAll(context);
  } catch (error) {
    log.error("Startup failed, rolling back", error);
    await teardown(context, cleanups);
    throw error;
  }
  log.info(`Ready in ${Math.round(performance.now() - started)} ms`);
  return { context, cleanups };
}

async function teardown(context: AppContext, cleanups: (() => void)[]) {
  log.info("Shutting down");
  await context.modules.disposeAll();
  context.indicators.dispose();
  context.dispatcher.detach();
  context.device.dispose();
  context.launchpad.disconnect();
  for (const cleanup of cleanups.splice(0)) cleanup();
  log.info("Shutdown complete");
}

export function bootstrap(): Promise<AppContext> {
  const existing = store[KEY];
  if (existing) return existing.promise;

  const registry: Registry = {
    promise: create().then(
      ({ context, cleanups }) => {
        registry.context = context;
        registry.teardown = () => teardown(context, cleanups);
        return context;
      },
      (error: unknown) => {
        delete store[KEY];
        throw error;
      }
    ),
  };
  store[KEY] = registry;
  return registry.promise;
}

export function getContext(): AppContext {
  const context = store[KEY]?.context;
  if (!context) throw new Error("stream_core is not bootstrapped");
  return context;
}

export async function shutdown(): Promise<void> {
  const registry = store[KEY];
  if (!registry) return;
  delete store[KEY];
  const context = await registry.promise.catch((error) => {
    log.debug("Shutdown skipped: startup had failed", error);
    return undefined;
  });
  if (!context) return;
  // A registry left by older code (dev restarts) may predate `teardown`.
  if (registry.teardown) await registry.teardown();
  else context.launchpad.disconnect();
}
