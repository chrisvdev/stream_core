import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Appearance, IndicatorDefinition, ModuleContext, ModuleHealth, StreamModule } from "../../core";
import { logManager } from "../../core/logger";
import { createActions, panic, setTempo, TapTempo } from "./actions";
import { DEFAULT_HOST, DEFAULT_PORT, systemConfigSchema, type SystemConfig } from "./config";

const ERROR_FLASH_MS = 3_000;
const BEAT_FLASH_MS = 100;
const DEFAULT_TEMPO = 120;
const ENV_KEYS = ["PORT", "HOST", "LOG_LEVEL", "LOG_DIR", "CONFIG_FILE", "NODE_ENV"] as const;

// High-bank palette codes (see palette.txt).
const RED = 112;
const YELLOW = 124;
const BLUE = 67;
const WHITE = 127;
const fixed = (code: number): Appearance => ({ mode: "static", code });
const pulse = (code: number): Appearance => ({ mode: "pulsing", code });
const flash = (code: number, code2 = 0): Appearance => ({ mode: "flashing", code, code2 });

const FIXED_INDICATORS: IndicatorDefinition[] = [
  { id: "locked", name: "Botones bloqueados", states: [{ id: "on", name: "Bloqueados", appearance: fixed(YELLOW) }] },
  { id: "beat", name: "Metrónomo (beat)", states: [{ id: "on", name: "Beat", appearance: fixed(WHITE) }] },
  { id: "error", name: "Error reciente de acción", states: [{ id: "on", name: "Error", appearance: fixed(RED) }] },
  { id: "panel", name: "Panel web abierto", states: [{ id: "open", name: "Abierto", appearance: fixed(BLUE) }] },
  {
    id: "modules",
    name: "Salud de los módulos",
    states: [
      { id: "warn", name: "Algún aviso", appearance: pulse(YELLOW) },
      { id: "error", name: "Algún error", appearance: flash(RED) },
    ],
  },
];

const HEALTH_STATES = [
  { id: "warn", name: "Aviso", appearance: pulse(YELLOW) },
  { id: "error", name: "Error", appearance: flash(RED) },
];

const WAKE_ACTIONS = new Set(["leds", "lock"]);

export interface SystemStatus {
  version: string | null;
  node: string;
  platform: string;
  mode: string;
  pid: number;
  uptimeSec: number;
  memoryMb: { rss: number; heapUsed: number };
  paths: { config: string; logs: string; data: string; cwd: string };
  env: Partial<Record<(typeof ENV_KEYS)[number], string>>;
  server: {
    configured: { port: number; host: string };
    effective: { port: number; host: string };
    /** Where each effective value came from. */
    source: { port: "env" | "config"; host: "env" | "config" };
    restartRequired: boolean;
  };
  panelClients: number;
  device: ReturnType<ModuleContext["app"]["device"]["status"]>;
  modules: (ModuleHealth & { id: string; name: string })[];
  lastTempoTap: number | null;
  /** Buttons bound to "Encender/apagar LEDs"; without one the device can only be woken from the panel. */
  wakeButtons: { x: number; y: number }[];
}

let ctx: ModuleContext<SystemConfig> | null = null;
let panelClients = 0;
let lastTap: number | null = null;
let beatTimer: ReturnType<typeof setInterval> | undefined;
const cleanups: (() => void)[] = [];
const tapTempo = new TapTempo();
// Captured at startup: the server only binds once, so later config edits need a restart.
let boundServer: { port: number; host: string } | null = null;

const readVersion = () => {
  try {
    return (JSON.parse(readFileSync(resolve("package.json"), "utf8")) as { version?: string }).version ?? null;
  } catch {
    return null;
  }
};
const version = readVersion();

/** Effective server address: PORT/HOST env vars win over the saved config. */
export function resolveServerAddress(config: SystemConfig | undefined) {
  const envPort = Number(process.env.PORT);
  const port = Number.isInteger(envPort) && envPort > 0 ? envPort : (config?.server.port ?? DEFAULT_PORT);
  const host = process.env.HOST || config?.server.host || DEFAULT_HOST;
  return {
    port,
    host,
    source: { port: process.env.PORT ? "env" : "config", host: process.env.HOST ? "env" : "config" } as const,
  };
}

function set(c: ModuleContext<SystemConfig>, id: string, state: string | null) {
  try {
    const handle = c.indicator(id);
    if (handle.current() === state) return;
    if (state) handle.set(state);
    else handle.clear();
  } catch (error) {
    c.log.warn(`Could not update indicator ${id}`, error);
  }
}

function syncHealth(c: ModuleContext<SystemConfig>) {
  const health = c.app.modules.healthAll();
  const worst = health.some((h) => h.state === "error") ? "error" : health.some((h) => h.state === "warn") ? "warn" : null;
  set(c, "modules", worst);
  for (const h of health) set(c, `module:${h.id}`, h.state === "ok" ? null : h.state);
}

/** Locations bound to actions that turn the LEDs back on or unlock, kept dimly lit while off. */
function wakeButtons(c: ModuleContext<SystemConfig>): Map<string, Appearance> {
  const { showWakeButton, wakeAppearance } = c.config.get().sleep;
  const keep = new Map<string, Appearance>();
  if (!showWakeButton) return keep;
  for (const b of c.app.config.list()) {
    if (b.action?.module === "system" && WAKE_ACTIONS.has(b.action.action)) keep.set(`${b.x},${b.y}`, wakeAppearance);
  }
  return keep;
}

function applySleepStrategy(c: ModuleContext<SystemConfig>) {
  c.app.device.setSleepStrategy({ mode: c.config.get().sleep.mode, keep: () => wakeButtons(c) });
}

/** The metronome only runs while some location shows it, to avoid a constant stream of indicator events. */
function syncMetronome(c: ModuleContext<SystemConfig>) {
  clearInterval(beatTimer);
  beatTimer = undefined;
  const used = c.app.config.listIndicators().some((a) => a.module === "system" && a.indicator === "beat");
  if (!used) return;
  const tempo = c.app.config.getSettings().tempo ?? DEFAULT_TEMPO;
  const beat = c.indicator("beat");
  beatTimer = setInterval(() => beat.flash("on", BEAT_FLASH_MS), 60_000 / tempo);
}

const system: StreamModule<SystemConfig> = {
  id: "system",
  name: "Sistema",
  description: "LEDs, bloqueo de botones, tempo, brillo, pánico, salud de módulos y configuración del servidor.",
  admin: { label: "Sistema" },
  config: { schema: systemConfigSchema },
  actions: createActions(() => ctx, tapTempo),
  indicators: () => {
    const healthy = ctx?.app.modules.healthAll() ?? [];
    return [
      ...FIXED_INDICATORS,
      ...healthy.map((h) => ({ id: `module:${h.id}`, name: `Módulo: ${h.name}`, states: HEALTH_STATES })),
    ];
  },
  status: (): SystemStatus | null => {
    if (!ctx) return null;
    const config = ctx.config.get();
    const effective = boundServer ?? resolveServerAddress(config);
    const wanted = resolveServerAddress(config);
    const memory = process.memoryUsage();
    return {
      version,
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      mode: process.env.NODE_ENV ?? "production",
      pid: process.pid,
      uptimeSec: Math.round(process.uptime()),
      memoryMb: { rss: Math.round(memory.rss / 1e6), heapUsed: Math.round(memory.heapUsed / 1e6) },
      paths: { config: ctx.app.config.path, logs: logManager.dir, data: resolve("data"), cwd: process.cwd() },
      env: Object.fromEntries(ENV_KEYS.flatMap((k) => (process.env[k] ? [[k, process.env[k]]] : []))),
      server: {
        configured: config.server,
        effective: { port: effective.port, host: effective.host },
        source: wanted.source,
        restartRequired: Boolean(boundServer) && (boundServer!.port !== wanted.port || boundServer!.host !== wanted.host),
      },
      panelClients,
      device: ctx.app.device.status(),
      modules: ctx.app.modules.healthAll(),
      lastTempoTap: lastTap,
      wakeButtons: ctx.app.config
        .list()
        .filter((b) => b.action?.module === "system" && b.action.action === "leds")
        .map((b) => ({ x: b.x, y: b.y })),
    };
  },
  health: () => {
    if (ctx?.config.get().sleep.mode === "hardware") {
      return { state: "warn", message: "Apagado por sleep del aparato: puede no despertar desde un botón" };
    }
    return { state: "ok" };
  },
  commands: {
    setSleep: (input) => ctx?.app.device.setSleep(Boolean((input as { sleeping?: unknown })?.sleeping)),
    setLock: (input) => ctx?.app.device.setLocked(Boolean((input as { locked?: unknown })?.locked)),
    tap: async () => {
      if (!ctx) return null;
      const bpm = tapTempo.tap(2_000);
      if (bpm !== null) {
        lastTap = bpm;
        await setTempo(ctx, bpm);
      }
      return bpm;
    },
    panic: async () => {
      if (ctx) await panic(ctx, "admin panel");
    },
    mark: (input) => {
      const label = String((input as { label?: unknown })?.label ?? "").slice(0, 200);
      ctx?.log.info(`──── MARCA: ${label || "desde el panel"} ────`);
    },
  },
  init(c) {
    ctx = c;
    c.app.device.setLockWhenAsleep(c.config.get().lock.whenAsleep);
    applySleepStrategy(c);
    const refresh = () => c.notifyStatusChanged();

    cleanups.push(
      c.config.onChange((config) => {
        c.app.device.setLockWhenAsleep(config.lock.whenAsleep);
        applySleepStrategy(c);
        refresh();
      }),
      c.app.events.on("bindings", () => {
        c.app.device.refreshSleep();
        refresh();
      }),
      c.app.events.on("device", (status) => {
        set(c, "locked", status.locked ? "on" : null);
        refresh();
      }),
      c.app.events.on("action-error", () => {
        try {
          c.indicator("error").flash("on", ERROR_FLASH_MS);
        } catch (error) {
          c.log.warn("Could not flash error indicator", error);
        }
      }),
      c.app.events.on("panel-clients", ({ count }) => {
        panelClients = count;
        set(c, "panel", count > 0 ? "open" : null);
      }),
      c.app.events.on("module-status", ({ module }) => {
        if (module !== "system") syncHealth(c);
      }),
      c.app.events.on("settings", ({ changed }) => {
        if (changed.includes("tempo")) syncMetronome(c);
      }),
      c.app.events.on("indicators-config", () => syncMetronome(c))
    );

    // Runs after every module's init so their health is available.
    setTimeout(() => {
      if (ctx !== c) return;
      c.notifyCatalogChanged();
      syncHealth(c);
      syncMetronome(c);
    }, 0);
  },
  dispose() {
    clearInterval(beatTimer);
    for (const cleanup of cleanups.splice(0)) cleanup();
    ctx = null;
  },
};

/** Called by the Express server once it is listening, so the panel can tell when a restart is needed. */
export function reportBoundServer(address: { port: number; host: string }) {
  boundServer = address;
}

export default system;
