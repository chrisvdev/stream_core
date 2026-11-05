import type {
  ActiveIndicator,
  Binding,
  BindingData,
  ButtonEvent,
  ButtonState,
  DeviceStatus,
  IndicatorAssignment,
  MaskedModuleConfig,
  ModuleCatalogEntry,
  Settings,
} from "../../core";
import { createLogger } from "../../lib/log/browser";
import type { LogRecord } from "../../lib/log/shared";

const log = createLogger("api");

export class ApiError extends Error {
  constructor(
    readonly errors: string[],
    readonly status = 0,
    readonly requestId: string | null = null,
    /** True when the request was cancelled because the user left the page. */
    readonly aborted = false
  ) {
    super(errors.join("\n"));
    this.name = "ApiError";
  }
}

// Above the server's own timeouts (e.g. 10 s for OBS connect) so those report their real error.
const TIMEOUT_MS = 15_000;
const pending = new Set<AbortController>();
let leaving = false;

if (typeof window !== "undefined") {
  // Free the browser's connections for the next page instead of letting in-flight requests hold them.
  window.addEventListener("pagehide", () => {
    leaving = true;
    for (const controller of pending) controller.abort();
  });
  window.addEventListener("pageshow", () => {
    leaving = false;
  });
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? "GET";
  const started = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  pending.add(controller);
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (leaving) throw new ApiError(["Petición cancelada al salir de la página"], 0, null, true);
    const ms = Math.round(performance.now() - started);
    if (controller.signal.aborted) {
      log.warn(`${method} ${url} timed out after ${ms}ms`);
      throw new ApiError([`El servidor no respondió en ${TIMEOUT_MS / 1000} s`]);
    }
    log.error(`${method} ${url} network error after ${ms}ms`, error);
    throw new ApiError(["No se pudo contactar al servidor"]);
  } finally {
    clearTimeout(timeout);
    pending.delete(controller);
  }

  const requestId = response.headers.get("x-request-id");
  const ms = Math.round(performance.now() - started);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const errors: string[] = body.errors ?? [`HTTP ${response.status}`];
    const details = { status: response.status, requestId: requestId ?? body.requestId ?? null, errors };
    if (response.status >= 500) log.error(`${method} ${url} failed in ${ms}ms`, details);
    else log.warn(`${method} ${url} rejected in ${ms}ms`, details);
    throw new ApiError(errors, response.status, details.requestId);
  }
  log.debug(`${method} ${url} ${response.status} ${ms}ms`, requestId ? { requestId } : undefined);
  return response.status === 204 ? (undefined as T) : response.json();
}

const sendJson = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  catalog: () => request<ModuleCatalogEntry[]>("/api/catalog"),
  bindings: () => request<Binding[]>("/api/bindings"),
  state: () => request<ButtonState[]>("/api/state"),
  save: (x: number, y: number, data: BindingData) =>
    request<Binding>(`/api/bindings/${x}/${y}`, sendJson("PUT", data)),
  remove: (x: number, y: number) => request<void>(`/api/bindings/${x}/${y}`, { method: "DELETE" }),
  import: (file: unknown) => request<{ ok: true }>("/api/config/import", sendJson("POST", file)),
  settings: () => request<Settings>("/api/settings"),
  saveSettings: (settings: Settings) =>
    request<{ settings: Settings; restartRequired: boolean }>("/api/settings", sendJson("PUT", settings)),
  device: () => request<DeviceStatus>("/api/device"),
  setSleep: (sleep: boolean) => request<DeviceStatus>("/api/device", sendJson("POST", { sleep })),
  midiPorts: () => request<{ inputs: string[]; outputs: string[] }>("/api/midi/ports"),
  test: (x: number, y: number, event: ButtonEvent) =>
    request<{ ok: true }>(`/api/buttons/${x}/${y}/test`, sendJson("POST", { event })),
  indicators: () => request<IndicatorsResponse>("/api/indicators"),
  saveIndicators: (assignments: IndicatorAssignment[]) =>
    request<IndicatorsResponse>("/api/indicators", sendJson("PUT", assignments)),
  testIndicator: (module: string, indicator: string, state: string | null) =>
    request<ActiveIndicator[]>("/api/indicators/test", sendJson("POST", { module, indicator, state })),
  moduleConfig: (id: string) => request<MaskedModuleConfig>(`/api/modules/${encodeURIComponent(id)}/config`),
  saveModuleConfig: (id: string, values: Record<string, unknown>) =>
    request<MaskedModuleConfig>(`/api/modules/${encodeURIComponent(id)}/config`, sendJson("PUT", values)),
  moduleStatus: <T>(id: string) =>
    request<{ status: T | null }>(`/api/modules/${encodeURIComponent(id)}/status`).then((r) => r.status),
  moduleCommand: <T = unknown>(id: string, name: string, input: unknown = {}) =>
    request<{ result: T }>(
      `/api/modules/${encodeURIComponent(id)}/commands/${encodeURIComponent(name)}`,
      sendJson("POST", input)
    ).then((r) => r.result),
  logs: (filter: { level?: string; scope?: string; limit?: number } = {}) => {
    const query = new URLSearchParams(
      Object.entries(filter).flatMap(([k, v]) => (v === undefined || v === "" ? [] : [[k, String(v)]]))
    );
    return request<LogRecord[]>(`/api/logs?${query}`);
  },
  logScopes: () =>
    request<{ scopes: string[]; dir: string; effectiveLevel: string; envLevel: string | null }>("/api/logs/scopes"),
};

export interface IndicatorsResponse {
  assignments: IndicatorAssignment[];
  active: ActiveIndicator[];
}
