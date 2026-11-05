import type { ModuleContext, StreamModule } from "../../core";
import { createActions } from "./actions";
import { ObsClient, testConnection, type ObsChange } from "./client";
import { obsConfigSchema, type ObsConfig } from "./config";
import { buildIndicators, desiredStates } from "./indicators";

let client: ObsClient | null = null;
let currentPassword: string | undefined;
let unsubscribeConfig: (() => void) | undefined;

function syncIndicators(ctx: ModuleContext<ObsConfig>) {
  if (!client) return;
  for (const [id, state] of desiredStates(client.snapshot(), client.state)) {
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

const obs: StreamModule<ObsConfig> = {
  id: "obs",
  name: "OBS",
  description: "Controla OBS Studio (30+) vía obs-websocket: escenas, audio, fuentes, filtros, stream y grabación.",
  admin: { label: "OBS" },
  config: { schema: obsConfigSchema, secrets: ["password"] },
  actions: createActions(() => client),
  indicators: () => buildIndicators(client?.snapshot()),
  status: () => client?.status() ?? null,
  health: () => {
    const status = client?.status();
    if (!status || status.state === "disconnected") return { state: "ok", message: "Desconectado" };
    if (status.state === "connected") return { state: "ok" };
    if (status.state === "connecting") return { state: "warn", message: "Conectando" };
    return { state: "error", message: status.error ?? "Error de conexión" };
  },
  commands: {
    connect: () => client?.connect(),
    disconnect: () => client?.disconnect(),
    refresh: () => client?.refresh(),
    /** Accepts `{ url, password? }`; an empty password falls back to the saved one. */
    test: async (input) => {
      const { url, password } = (input ?? {}) as { url?: unknown; password?: unknown };
      const parsed = obsConfigSchema.pick({ url: true }).safeParse({ url });
      if (!parsed.success) throw new Error("URL inválida: debe empezar con ws:// o wss://");
      return testConnection(parsed.data.url, typeof password === "string" && password ? password : currentPassword);
    },
  },
  init(ctx) {
    const onChange = (change: ObsChange) => {
      if (change === "catalog") ctx.notifyCatalogChanged();
      if (change === "status") ctx.notifyStatusChanged();
      syncIndicators(ctx);
    };
    client = new ObsClient(onChange);
    currentPassword = ctx.config.get().password;
    client.configure(ctx.config.get());
    unsubscribeConfig = ctx.config.onChange((config) => {
      ctx.log.info("Config changed", { url: config.url, autoConnect: config.autoConnect });
      currentPassword = config.password;
      client?.configure(config);
    });
  },
  async dispose() {
    unsubscribeConfig?.();
    await client?.disconnect();
    client = null;
  },
};

export default obs;
