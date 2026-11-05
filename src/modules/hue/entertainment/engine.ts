import type { Appearance, AppContext } from "../../../core";
import { createLogger } from "../../../core/logger";
import { appearanceToRgb, type Rgb } from "../../../lib/palette";
import { HueError } from "../client";
import type { HueConfig } from "../config";
import type { HueConnection } from "../connection";
import type { HueArea } from "../state";
import { openDtls } from "./dtls";
import { renderEffect, type EffectSpec } from "./effects";

const log = createLogger("hue.stream");

const HEADER = Buffer.from("HueStream", "ascii");
// Grace period before stopping an idle area, so back-to-back effects don't restart the stream.
const IDLE_STOP_MS = 1_000;
const DEFAULT_TEMPO = 120;

export interface EffectHandle {
  stop(): void;
}

interface RunningEffect {
  spec: EffectSpec;
  started: number;
}

interface Deps {
  connection: HueConnection;
  config(): HueConfig;
  app: AppContext;
  onChange(): void;
}

class AreaSession {
  readonly effects = new Map<number, RunningEffect>();
  mirror = false;
  ready: Promise<void>;
  #send: ((data: Buffer) => void) | null = null;
  #close: (() => void) | null = null;
  #timer: ReturnType<typeof setInterval> | undefined;
  #idleTimer: ReturnType<typeof setTimeout> | undefined;
  #seq = 0;
  #stopped = false;

  constructor(
    readonly area: HueArea,
    private deps: Deps,
    private onEnded: (session: AreaSession) => void,
    private colorAt: (coordinate: string) => Rgb
  ) {
    this.ready = this.#start();
  }

  async #start() {
    const config = this.deps.config();
    if (!config.applicationId || !config.clientKey) {
      throw new HueError("Falta la clave de entertainment; vuelve a emparejar el bridge");
    }
    const client = this.deps.connection.client;
    if (this.area.streamer && this.area.streamer !== config.applicationId) {
      throw new HueError(`El área «${this.area.name}» está en uso por otra app (p. ej. Hue Sync)`);
    }
    log.info(`Starting area «${this.area.name}»`, { channels: this.area.channels.length, fps: config.entertainment.fps });
    await client.put("entertainment_configuration", this.area.id, { action: "start" });
    try {
      const channel = await openDtls(
        { ip: client.ip, identity: config.applicationId, clientKey: config.clientKey },
        (error) => {
          if (!this.#stopped) log.warn(`Stream of «${this.area.name}» closed by the bridge`, error);
          void this.stop();
        }
      );
      this.#send = channel.send;
      this.#close = channel.close;
    } catch (error) {
      await client.put("entertainment_configuration", this.area.id, { action: "stop" }).catch(() => undefined);
      throw new HueError(`No se pudo abrir el canal DTLS: ${error instanceof Error ? error.message : String(error)}`);
    }
    this.#timer = setInterval(() => this.#frame(), 1000 / config.entertainment.fps);
  }

  addEffect(id: number, spec: EffectSpec) {
    this.effects.set(id, { spec, started: performance.now() });
    clearTimeout(this.#idleTimer);
  }

  removeEffect(id: number) {
    this.effects.delete(id);
    this.#maybeIdle();
  }

  setMirror(enabled: boolean) {
    this.mirror = enabled;
    if (enabled) clearTimeout(this.#idleTimer);
    else this.#maybeIdle();
  }

  #maybeIdle() {
    if (this.effects.size || this.mirror || this.#stopped) return;
    clearTimeout(this.#idleTimer);
    this.#idleTimer = setTimeout(() => void this.stop(), IDLE_STOP_MS);
  }

  #frame() {
    if (!this.#send) return;
    const now = performance.now();
    for (const [id, effect] of this.effects) {
      if (effect.spec.durationMs && now - effect.started > effect.spec.durationMs) {
        this.effects.delete(id);
        this.#maybeIdle();
      }
    }

    const mapping = this.deps.config().entertainment.mirror[this.area.id]?.channels ?? {};
    const channels = this.area.channels;
    const parts: Buffer[] = [];
    channels.forEach((channel, index) => {
      let color: Rgb = [0, 0, 0];
      const coordinate = mapping[String(channel.id)];
      if (this.mirror && coordinate) color = this.colorAt(coordinate);
      for (const effect of this.effects.values()) {
        if (effect.spec.channels && !effect.spec.channels.includes(channel.id)) continue;
        color = renderEffect(effect.spec, now - effect.started, index, channels.length);
      }
      const part = Buffer.alloc(7);
      part.writeUInt8(channel.id, 0);
      // 8-bit to 16-bit by repeating the byte (x * 257).
      part.writeUInt16BE(color[0] * 257, 1);
      part.writeUInt16BE(color[1] * 257, 3);
      part.writeUInt16BE(color[2] * 257, 5);
      parts.push(part);
    });

    const header = Buffer.alloc(16);
    HEADER.copy(header, 0);
    header.writeUInt8(0x02, 9); // API version 2.0
    header.writeUInt8(0x00, 10);
    header.writeUInt8(this.#seq++ & 0xff, 11);
    // bytes 12-13 reserved, 14 = color space RGB, 15 reserved
    try {
      this.#send(Buffer.concat([header, Buffer.from(this.area.id, "ascii"), ...parts]));
    } catch (error) {
      log.warn("Frame send failed", error);
    }
  }

  async stop() {
    if (this.#stopped) return;
    this.#stopped = true;
    clearInterval(this.#timer);
    clearTimeout(this.#idleTimer);
    this.effects.clear();
    try {
      this.#close?.();
    } catch (error) {
      log.debug("DTLS close failed", error);
    }
    try {
      // Stopping makes the bridge restore the lights to their state before streaming.
      await this.deps.connection.client.put("entertainment_configuration", this.area.id, { action: "stop" });
    } catch (error) {
      log.warn(`Could not stop area «${this.area.name}»`, error);
    }
    log.info(`Stopped area «${this.area.name}»`);
    this.onEnded(this);
  }
}

export class EntertainmentEngine {
  #sessions = new Map<string, AreaSession>();
  #leds = new Map<string, Appearance>();
  #nextId = 1;
  #unsubscribe: () => void;

  constructor(private deps: Deps) {
    for (const s of deps.app.leds.state()) this.#leds.set(`${s.x},${s.y}`, s.appearance);
    this.#unsubscribe = deps.app.events.on("appearance", ({ x, y, appearance }) => this.#leds.set(`${x},${y}`, appearance));
  }

  /** Area ids this app is currently streaming to. */
  streamingAreas(): string[] {
    return [...this.#sessions.keys()];
  }

  isMirroring(areaId: string) {
    return this.#sessions.get(areaId)?.mirror ?? false;
  }

  async effect(areaId: string, spec: EffectSpec): Promise<EffectHandle> {
    const session = await this.#session(areaId);
    const id = this.#nextId++;
    session.addEffect(id, spec);
    log.debug(`Effect ${spec.effect} on «${session.area.name}»`, spec);
    return { stop: () => session.removeEffect(id) };
  }

  async setMirror(areaId: string, enabled: boolean) {
    if (!enabled) {
      this.#sessions.get(areaId)?.setMirror(false);
      return;
    }
    const session = await this.#session(areaId);
    session.setMirror(true);
    this.deps.onChange();
  }

  async stopArea(areaId: string) {
    await this.#sessions.get(areaId)?.stop();
  }

  async stopAll() {
    await Promise.all([...this.#sessions.values()].map((s) => s.stop()));
  }

  async dispose() {
    this.#unsubscribe();
    await this.stopAll();
  }

  async #session(areaId: string): Promise<AreaSession> {
    const existing = this.#sessions.get(areaId);
    if (existing) {
      await existing.ready;
      return existing;
    }
    const area = this.deps.connection.data.areas().find((a) => a.id === areaId);
    if (!area) throw new HueError("Área de entertainment desconocida");
    const session = new AreaSession(
      area,
      this.deps,
      (ended) => {
        if (this.#sessions.get(areaId) === ended) this.#sessions.delete(areaId);
        this.deps.onChange();
      },
      (coordinate) => this.#colorAt(coordinate)
    );
    this.#sessions.set(areaId, session);
    try {
      await session.ready;
    } catch (error) {
      this.#sessions.delete(areaId);
      throw error;
    }
    this.deps.onChange();
    return session;
  }

  #colorAt(coordinate: string): Rgb {
    const appearance = this.#leds.get(coordinate);
    if (!appearance) return [0, 0, 0];
    const tempo = this.deps.app.config.getSettings().tempo ?? DEFAULT_TEMPO;
    const beatMs = 60_000 / tempo;
    return appearanceToRgb(appearance, (performance.now() % beatMs) / beatMs);
  }
}
