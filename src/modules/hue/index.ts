import type { ModuleContext, StreamModule } from "../../core";
import { createActions } from "./actions";
import { HueError } from "./client";
import { hexToRgb } from "./colors";
import { hueConfigSchema, type HueConfig } from "./config";
import { HueConnection, type HueChange, type HueStatus } from "./connection";
import { discoverBridges } from "./discovery";
import { EntertainmentEngine, type EffectHandle } from "./entertainment/engine";
import type { EffectSpec } from "./entertainment/effects";
import { buildIndicators, desiredStates } from "./indicators";
import { pairBridge, type PairingProgress } from "./pairing";
import type { HueArea, HueGroup, HueScene, HueSmartScene } from "./state";

/** Public API for other modules: `ctx.module<HueApi>("hue")`. */
export interface HueApi {
  areas(): { id: string; name: string }[];
  effect(areaId: string, spec: EffectSpec): Promise<EffectHandle>;
  flash(areaId: string, color: string, ms?: number): Promise<EffectHandle>;
  stopAll(): Promise<void>;
}

export type HueModuleStatus = HueStatus & {
  pairing: PairingProgress | null;
  streaming: string[];
  areas: HueArea[];
  lights: { id: string; name: string; on: boolean; reachable: boolean }[];
  groups: HueGroup[];
  scenes: HueScene[];
  smartScenes: HueSmartScene[];
};

let connection: HueConnection | null = null;
let engine: EntertainmentEngine | null = null;
let context: ModuleContext<HueConfig> | null = null;
let pairing: { abort: AbortController; progress: PairingProgress } | null = null;
let unsubscribeConfig: (() => void) | undefined;

const requireEngine = () => {
  if (!engine) throw new HueError("Hue no está iniciado");
  return engine;
};

function syncIndicators(ctx: ModuleContext<HueConfig>) {
  if (!connection) return;
  const states = desiredStates(
    connection.data,
    connection.state,
    ctx.config.get().applicationId,
    engine?.streamingAreas() ?? []
  );
  for (const [id, state] of states) {
    try {
      const handle = ctx.indicator(id);
      if (handle.current() === state) continue;
      if (state) handle.set(state);
      else handle.clear();
    } catch (error) {
      ctx.log.warn(`Could not update indicator ${id}`, error, { state });
    }
  }
}

/** Mirrors saved as enabled start streaming again once the bridge is reachable. */
function resumeMirrors(ctx: ModuleContext<HueConfig>) {
  for (const [areaId, mirror] of Object.entries(ctx.config.get().entertainment.mirror)) {
    if (!mirror.enabled || engine?.isMirroring(areaId)) continue;
    engine?.setMirror(areaId, true).catch((error) => ctx.log.warn(`Could not resume mirror on ${areaId}`, error));
  }
}

const hue: StreamModule<HueConfig> = {
  id: "hue",
  name: "Philips Hue",
  description: "Controla luces, rooms, zones, escenas y áreas de entertainment de un Hue Bridge v2 (API CLIP v2).",
  admin: { label: "Hue" },
  config: { schema: hueConfigSchema, secrets: ["appKey", "clientKey"] },
  actions: createActions({ connection: () => connection, engine: () => engine }),
  indicators: () => buildIndicators(connection?.data),
  status: (): HueModuleStatus | null =>
    connection
      ? {
          ...connection.status(),
          pairing: pairing?.progress ?? null,
          streaming: engine?.streamingAreas() ?? [],
          areas: connection.data.areas(),
          lights: connection.data.lights().map((l) => ({ id: l.id, name: l.name, on: l.on, reachable: l.reachable })),
          groups: connection.data.groups(),
          scenes: connection.data.scenes(),
          smartScenes: connection.data.smartScenes(),
        }
      : null,
  health: () => {
    const state = connection?.state ?? "disconnected";
    if (state === "connected" || state === "disconnected") return { state: "ok" };
    if (state === "unpaired") return { state: "warn", message: "Falta emparejar el bridge" };
    if (state === "connecting") return { state: "warn", message: connection?.status().error ?? "Conectando" };
    return { state: "error", message: connection?.status().error ?? "Error de conexión" };
  },
  panic: async () => {
    await engine?.stopAll();
  },
  commands: {
    discover: () => discoverBridges(),
    /** `{ ip }`: starts waiting up to 30 s for the link button; progress is reported through `status().pairing`. */
    pair: (input) => {
      const ip = String((input as { ip?: unknown })?.ip ?? "").trim();
      if (!/^[\w.:-]+$/.test(ip)) throw new HueError("IP del bridge inválida");
      if (!context) throw new HueError("Hue no está iniciado");
      const ctx = context;
      pairing?.abort.abort();
      const abort = new AbortController();
      pairing = { abort, progress: { state: "waiting", remainingMs: 30_000 } };
      ctx.notifyStatusChanged();
      // Runs in the background so the HTTP request doesn't sit open for 30 s.
      void (async () => {
        try {
          const result = await pairBridge(ip, {
            signal: abort.signal,
            onProgress: (progress) => {
              if (pairing?.abort === abort) pairing.progress = progress;
              ctx.notifyStatusChanged();
            },
          });
          const current = ctx.config.get();
          const saved = await ctx.app.config.setModuleConfig("hue", {
            ...current,
            bridgeIp: ip,
            bridgeId: result.bridgeId || current.bridgeId,
            appKey: result.appKey,
            clientKey: result.clientKey,
            applicationId: result.applicationId,
            certFingerprint: result.fingerprint,
          });
          if (!saved.ok) throw new HueError(saved.errors.join("; "));
          if (pairing?.abort === abort) pairing = null;
        } catch (error) {
          ctx.log.warn("Pairing failed", error);
          if (pairing?.abort === abort) {
            pairing.progress = {
              state: abort.signal.aborted ? "cancelled" : "failed",
              remainingMs: 0,
              message: error instanceof Error ? error.message : String(error),
            };
          }
        } finally {
          ctx.notifyStatusChanged();
        }
      })();
      return { started: true };
    },
    cancelPair: () => {
      pairing?.abort.abort();
    },
    connect: () => connection?.connect(),
    disconnect: () => connection?.disconnect(),
    refresh: () => connection?.refresh(),
    /** Removes keys and the pinned certificate; the bridge must be paired again. */
    forget: async () => {
      if (!context) return;
      await engine?.stopAll();
      const { appKey: _a, clientKey: _c, applicationId: _i, certFingerprint: _f, bridgeId: _b, ...rest } = context.config.get();
      // null clears secrets (see ConfigRepository.setModuleConfig).
      await context.app.config.setModuleConfig("hue", { ...rest, appKey: null, clientKey: null });
    },
    /** `{ areaId, effect, color?, ms? }` from the panel's test buttons. */
    testEffect: async (input) => {
      const { areaId, effect, color, ms } = (input ?? {}) as { areaId?: string; effect?: EffectSpec["effect"]; color?: string; ms?: number };
      if (!areaId || !effect) throw new HueError("Falta área o efecto");
      await requireEngine().effect(areaId, {
        effect,
        color: color ? (hexToRgb(color) ?? undefined) : undefined,
        speed: 4,
        durationMs: ms ?? 3_000,
      });
    },
    setMirror: async (input) => {
      const { areaId, enabled } = (input ?? {}) as { areaId?: string; enabled?: boolean };
      if (!areaId) throw new HueError("Falta el área");
      await requireEngine().setMirror(areaId, Boolean(enabled));
    },
    stopStreaming: () => engine?.stopAll(),
  },
  api: {
    areas: () => connection?.data.areas().map((a) => ({ id: a.id, name: a.name })) ?? [],
    effect: (areaId, spec) => requireEngine().effect(areaId, spec),
    flash: (areaId, color, ms = 1_000) =>
      requireEngine().effect(areaId, { effect: "strobe", color: hexToRgb(color) ?? [255, 255, 255], speed: 8, durationMs: ms }),
    stopAll: async () => {
      await engine?.stopAll();
    },
  } satisfies HueApi,
  init(ctx) {
    context = ctx;
    const onChange = (change: HueChange) => {
      if (change === "catalog") ctx.notifyCatalogChanged();
      if (change === "status" || change === "catalog") ctx.notifyStatusChanged();
      syncIndicators(ctx);
      if (change === "status" && connection?.state === "connected") resumeMirrors(ctx);
    };
    connection = new HueConnection(onChange);
    engine = new EntertainmentEngine({
      connection,
      config: () => ctx.config.get(),
      app: ctx.app,
      onChange: () => {
        ctx.notifyStatusChanged();
        syncIndicators(ctx);
      },
    });
    connection.configure(ctx.config.get());
    unsubscribeConfig = ctx.config.onChange((config) => {
      ctx.log.info("Config changed", { bridgeIp: config.bridgeIp, paired: Boolean(config.appKey) });
      connection?.configure(config);
    });
  },
  async dispose() {
    unsubscribeConfig?.();
    pairing?.abort.abort();
    await engine?.dispose();
    await connection?.disconnect();
    engine = null;
    connection = null;
    context = null;
  },
};

export default hue;
