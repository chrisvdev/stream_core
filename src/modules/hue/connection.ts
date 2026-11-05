import type { Agent } from "undici";
import { createLogger } from "../../core/logger";
import { createDispatcher, HueClient, HueError } from "./client";
import type { HueConfig } from "./config";
import { openEventStream, type EventStreamHandle } from "./eventstream";
import { HueState, type Resource } from "./state";

const log = createLogger("hue.connection");

export type HueConnectionState = "unpaired" | "disconnected" | "connecting" | "connected" | "error";
/** `catalog`: resources added/removed/renamed. `state`: live values changed. `status`: connection changed. */
export type HueChange = "catalog" | "state" | "status";

const LOAD_TIMEOUT_MS = 10_000;

export interface HueStatus {
  state: HueConnectionState;
  error: string | null;
  bridgeIp: string | null;
  bridgeId: string | null;
  bridgeName: string | null;
  softwareVersion: string | null;
  counts: { lights: number; rooms: number; zones: number; scenes: number; smartScenes: number; areas: number; devices: number };
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

export class HueConnection {
  readonly data = new HueState();
  #config: HueConfig | null = null;
  #state: HueConnectionState = "unpaired";
  #error: string | null = null;
  #client: HueClient | null = null;
  #dispatcher: Agent | null = null;
  #stream: EventStreamHandle | null = null;
  #wanted = false;
  #connecting = false;
  #reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  #onChange: (change: HueChange) => void;

  constructor(onChange: (change: HueChange) => void) {
    this.#onChange = (change) => {
      try {
        onChange(change);
      } catch (error) {
        log.error(`Change handler failed for "${change}"`, error);
      }
    };
  }

  get state() {
    return this.#state;
  }

  get config() {
    return this.#config;
  }

  /** Client for commands; throws a user-facing error while not connected. REST still works if only the eventstream dropped. */
  get client(): HueClient {
    if (!this.#client || this.#connecting) throw new HueError("Hue no conectado");
    return this.#client;
  }

  status(): HueStatus {
    const info = this.data.bridgeInfo();
    const groups = this.data.groups();
    return {
      state: this.#state,
      error: this.#error,
      bridgeIp: this.#config?.bridgeIp ?? null,
      bridgeId: info.bridgeId ?? this.#config?.bridgeId ?? null,
      bridgeName: info.name,
      softwareVersion: info.softwareVersion,
      counts: {
        lights: this.data.ofType("light").length,
        rooms: groups.filter((g) => g.kind === "room").length,
        zones: groups.filter((g) => g.kind === "zone").length,
        scenes: this.data.ofType("scene").length,
        smartScenes: this.data.ofType("smart_scene").length,
        areas: this.data.ofType("entertainment_configuration").length,
        devices: this.data.devices().length,
      },
    };
  }

  configure(config: HueConfig) {
    const previous = this.#config;
    this.#config = config;
    const paired = Boolean(config.bridgeIp && config.appKey);
    const targetChanged =
      !previous ||
      previous.bridgeIp !== config.bridgeIp ||
      previous.appKey !== config.appKey ||
      previous.certFingerprint !== config.certFingerprint;

    if (!paired) {
      void this.disconnect().then(() => this.#setState("unpaired", null));
      return;
    }
    if (targetChanged && (this.#wanted || config.autoConnect)) void this.reconnect();
    else if (previous && !previous.autoConnect && config.autoConnect && this.#state !== "connected") void this.connect();
    else if (this.#state === "unpaired") this.#setState("disconnected", null);
  }

  async connect() {
    const config = this.#config;
    if (!config?.bridgeIp || !config.appKey) {
      this.#setState("unpaired", null);
      return;
    }
    this.#wanted = true;
    clearTimeout(this.#reconnectTimer);
    if (this.#connecting || this.#state === "connected") return;

    this.#connecting = true;
    this.#setState("connecting", null);
    log.info("Connecting", { ip: config.bridgeIp, bridgeId: config.bridgeId });
    try {
      this.#dispatcher = createDispatcher({
        ip: config.bridgeIp,
        bridgeId: config.bridgeId,
        fingerprint: config.certFingerprint,
      });
      this.#client = new HueClient(config.bridgeIp, config.appKey, this.#dispatcher);
      await this.#load();
      this.#openStream();
      this.#connecting = false;
      this.#setState("connected", null);
      log.info("Connected", this.status().counts);
    } catch (error) {
      this.#connecting = false;
      await this.#teardown();
      this.#setState("error", errorMessage(error));
      log.warn(`Connection failed: ${errorMessage(error)}`, error, { retryInMs: config.reconnectMs });
      this.#scheduleReconnect();
    }
  }

  async disconnect() {
    this.#wanted = false;
    clearTimeout(this.#reconnectTimer);
    await this.#teardown();
    if (this.#state !== "unpaired") this.#setState("disconnected", null);
  }

  async reconnect() {
    await this.disconnect();
    await this.connect();
  }

  async refresh() {
    if (!this.#client) throw new HueError("Hue no conectado");
    await this.#load();
  }

  async #load() {
    if (!this.#client) return;
    const started = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const resources = await Promise.race([
      this.#client.get<Resource>("/resource"),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new HueError(`El bridge no respondió en ${LOAD_TIMEOUT_MS / 1000} s`)), LOAD_TIMEOUT_MS);
      }),
    ]).finally(() => clearTimeout(timer));
    this.data.load(resources);
    log.debug(`Loaded ${resources.length} resources in ${Math.round(performance.now() - started)} ms`);
    this.#onChange("catalog");
    this.#onChange("state");
  }

  #openStream() {
    if (!this.#client) return;
    let first = true;
    this.#stream = openEventStream(this.#client, {
      onOpen: () => {
        // Resync after a reconnect: events sent while we were away are lost.
        if (!first) {
          this.#load()
            .then(() => this.#setState("connected", null))
            .catch((error) => log.warn("Resync failed", error));
        }
        first = false;
      },
      onEvents: (events) => {
        const changes = this.data.apply(events);
        if (changes.catalog) this.#onChange("catalog");
        if (changes.state) this.#onChange("state");
      },
      onDown: (error) => {
        if (this.#state === "connected") this.#setState("connecting", `Eventos en tiempo real cortados: ${errorMessage(error)}`);
      },
    });
  }

  async #teardown() {
    this.#stream?.close();
    this.#stream = null;
    this.#client = null;
    await this.#dispatcher?.close().catch((error) => log.debug("Dispatcher close failed", error));
    this.#dispatcher = null;
  }

  #setState(state: HueConnectionState, error: string | null) {
    if (state === this.#state && error === this.#error) return;
    this.#state = state;
    this.#error = error;
    this.#onChange("status");
  }

  #scheduleReconnect() {
    if (!this.#wanted || !this.#config) return;
    clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = setTimeout(() => void this.connect(), this.#config.reconnectMs);
  }
}
