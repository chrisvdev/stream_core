import type { TLSSocket } from "node:tls";
import { Agent, buildConnector, request, type Dispatcher } from "undici";
import { createLogger } from "../../core/logger";

const log = createLogger("hue.client");

export interface BridgeTarget {
  ip: string;
  bridgeId?: string;
  /** Pinned SHA-256 fingerprint; when absent the first certificate seen is reported via `onCertificate`. */
  fingerprint?: string;
}

export class HueError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly hueType?: number
  ) {
    super(message);
    this.name = "HueError";
  }
}

/**
 * The bridge uses a self-signed certificate, so instead of CA validation we pin its fingerprint
 * (trust on first use) and check the CN matches the bridge id.
 */
export function createDispatcher(target: BridgeTarget, onCertificate?: (fingerprint: string, cn: string) => void): Agent {
  const base = buildConnector({ rejectUnauthorized: false });
  return new Agent({
    connect: (options, callback) => {
      base(options, (error, socket) => {
        if (error || !socket) return callback(error ?? new Error("No socket"), null);
        const cert = (socket as TLSSocket).getPeerCertificate?.();
        const fingerprint = cert?.fingerprint256 ?? "";
        const cn = String(cert?.subject?.CN ?? "").toLowerCase();
        if (target.fingerprint && fingerprint !== target.fingerprint) {
          socket.destroy();
          return callback(
            new HueError(
              "El certificado del bridge no coincide con el guardado al emparejar. Si cambiaste de bridge, usa «Olvidar bridge» y vuelve a emparejar."
            ),
            null
          );
        }
        if (target.bridgeId && cn && cn !== target.bridgeId.toLowerCase()) {
          socket.destroy();
          return callback(new HueError(`El certificado pertenece a otro bridge (${cn})`), null);
        }
        onCertificate?.(fingerprint, cn);
        callback(null, socket);
      });
    },
    // Keep few sockets: the bridge is a small device and the eventstream holds one permanently.
    connections: 4,
  });
}

type Body = Record<string, unknown>;

interface ClipResponse<T> {
  errors?: { description: string }[];
  data?: T[];
}

/** Spaces requests per bucket and coalesces bursts for the same key (latest body wins). */
class RateLimiter {
  #queues = new Map<string, Promise<unknown>>();
  #pending = new Map<string, { body: Body; resolvers: { resolve(v: unknown): void; reject(e: unknown): void }[] }>();

  run<T>(bucket: string, intervalMs: number, key: string, body: Body, send: (body: Body) => Promise<T>): Promise<T> {
    const existing = this.#pending.get(key);
    if (existing) {
      existing.body = body;
      return new Promise<T>((resolve, reject) =>
        existing.resolvers.push({ resolve: resolve as (v: unknown) => void, reject })
      );
    }
    const entry = { body, resolvers: [] as { resolve(v: unknown): void; reject(e: unknown): void }[] };
    this.#pending.set(key, entry);
    const result = new Promise<T>((resolve, reject) => entry.resolvers.push({ resolve: resolve as (v: unknown) => void, reject }));

    const previous = this.#queues.get(bucket) ?? Promise.resolve();
    const next = previous.then(async () => {
      this.#pending.delete(key);
      try {
        const value = await send(entry.body);
        for (const r of entry.resolvers) r.resolve(value);
      } catch (error) {
        for (const r of entry.resolvers) r.reject(error);
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    });
    this.#queues.set(bucket, next);
    return result;
  }
}

// Hue guidance: ~10 light commands/s and 1 group command/s.
const LIMITS: Record<string, number> = { light: 100, grouped_light: 1_000 };

export class HueClient {
  readonly ip: string;
  #appKey: string;
  #dispatcher: Dispatcher;
  #limiter = new RateLimiter();

  constructor(ip: string, appKey: string, dispatcher: Dispatcher) {
    this.ip = ip;
    this.#appKey = appKey;
    this.#dispatcher = dispatcher;
  }

  get dispatcher() {
    return this.#dispatcher;
  }

  get appKey() {
    return this.#appKey;
  }

  async get<T = Record<string, unknown>>(path: string): Promise<T[]> {
    return this.#call<T>("GET", path);
  }

  /** PUT to `/clip/v2/resource/<type>/<id>`, rate limited per resource type. */
  put(type: string, id: string, body: Body): Promise<unknown> {
    const interval = LIMITS[type] ?? 100;
    const bucket = type === "grouped_light" ? `${type}:${id}` : type;
    return this.#limiter.run(bucket, interval, `${type}:${id}`, body, (b) => this.#call("PUT", `/resource/${type}/${id}`, b));
  }

  async #call<T>(method: "GET" | "PUT", path: string, body?: Body): Promise<T[]> {
    const started = performance.now();
    let response: Dispatcher.ResponseData;
    try {
      response = await request(`https://${this.ip}/clip/v2${path}`, {
        method,
        dispatcher: this.#dispatcher,
        headers: { "hue-application-key": this.#appKey, "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
        headersTimeout: 8_000,
        bodyTimeout: 8_000,
      });
    } catch (error) {
      log.warn(`${method} ${path} failed to reach bridge`, error);
      throw error instanceof HueError ? error : new HueError(`Bridge inalcanzable en ${this.ip}`, undefined, undefined);
    }
    const text = await response.body.text();
    let parsed: ClipResponse<T> = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      // Non-JSON bodies happen on 5xx; the status below is enough.
    }
    const ms = Math.round(performance.now() - started);
    if (response.statusCode === 403 || response.statusCode === 401) {
      throw new HueError("La clave de aplicación fue rechazada; vuelve a emparejar el bridge", response.statusCode);
    }
    if (response.statusCode >= 400 || parsed.errors?.length) {
      const message = parsed.errors?.map((e) => e.description).join("; ") || `HTTP ${response.statusCode}`;
      log.warn(`${method} ${path} -> ${response.statusCode} in ${ms}ms: ${message}`, { body });
      throw new HueError(message, response.statusCode);
    }
    log.debug(`${method} ${path} -> ${response.statusCode} in ${ms}ms`, body);
    return parsed.data ?? [];
  }
}
