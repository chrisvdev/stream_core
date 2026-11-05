import OBSWebSocket, {
  EventSubscription,
  type EventTypes,
  type OBSEventTypes,
  type OBSRequestTypes,
  type OBSResponseTypes,
} from "obs-websocket-js";
import { createLogger } from "../../core/logger";
import type { ObsConfig } from "./config";

const log = createLogger("obs.client");

export type ConnectionState = "disconnected" | "connecting" | "connected" | "error";
export type StreamState = "off" | "starting" | "live" | "stopping" | "reconnecting";
export type RecordState = "off" | "starting" | "recording" | "paused" | "stopping";

export interface ObsScene {
  uuid: string;
  name: string;
}

export interface ObsInput {
  uuid: string;
  name: string;
  kind: string;
  /** `undefined` for inputs without audio. */
  muted?: boolean;
  media: boolean;
}

export interface ObsSceneItem {
  sceneUuid: string;
  id: number;
  sourceName: string;
  enabled: boolean;
}

export interface ObsFilter {
  sourceUuid: string;
  sourceName: string;
  name: string;
  enabled: boolean;
}

/** Lists survive disconnects so assignments keep their names; live flags are reset instead. */
export interface ObsSnapshot {
  scenes: ObsScene[];
  inputs: ObsInput[];
  items: ObsSceneItem[];
  filters: ObsFilter[];
  transitions: string[];
  hotkeys: string[];
  programScene: string | null;
  previewScene: string | null;
  studioMode: boolean;
  currentTransition: string | null;
  stream: StreamState;
  record: RecordState;
  virtualcam: boolean;
  replayBuffer: boolean;
}

export interface ObsStatus {
  state: ConnectionState;
  error: string | null;
  url: string | null;
  obsVersion: string | null;
  obsWebSocketVersion: string | null;
  programScene: string | null;
  stream: StreamState;
  record: RecordState;
  counts: { scenes: number; inputs: number; audioInputs: number; mediaInputs: number; items: number; filters: number };
}

/** `catalog`: lists or names changed. `state`: live flags changed. `status`: connection changed. */
export type ObsChange = "catalog" | "state" | "status";

const MIN_WEBSOCKET_VERSION = [5, 5, 0];
// A host that drops packets never answers the WebSocket handshake; don't keep callers waiting forever.
const CONNECT_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what}: sin respuesta en ${ms / 1000} s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
const MEDIA_KINDS = new Set(["ffmpeg_source", "vlc_source"]);
const STRUCTURAL_EVENTS = [
  "SceneCreated",
  "SceneRemoved",
  "SceneNameChanged",
  "SceneListChanged",
  "InputCreated",
  "InputRemoved",
  "InputNameChanged",
  "SceneItemCreated",
  "SceneItemRemoved",
  "SourceFilterCreated",
  "SourceFilterRemoved",
  "SourceFilterNameChanged",
  "CurrentSceneCollectionChanged",
] as const satisfies (keyof OBSEventTypes)[];

const emptySnapshot = (): ObsSnapshot => ({
  scenes: [],
  inputs: [],
  items: [],
  filters: [],
  transitions: [],
  hotkeys: [],
  programScene: null,
  previewScene: null,
  studioMode: false,
  currentTransition: null,
  stream: "off",
  record: "off",
  virtualcam: false,
  replayBuffer: false,
});

type BatchResult = { requestStatus: { result: boolean; comment?: string }; responseData?: unknown };

export class ObsClient {
  #obs = new OBSWebSocket();
  #config: ObsConfig | null = null;
  #state: ConnectionState = "disconnected";
  #error: string | null = null;
  #versions: { obs: string; websocket: string } | null = null;
  #snapshot = emptySnapshot();
  /** True while the user wants a connection (auto or manual); drives reconnects. */
  #wanted = false;
  #connecting = false;
  #reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  #refreshTimer: ReturnType<typeof setTimeout> | undefined;
  #onChange: (change: ObsChange) => void;

  constructor(onChange: (change: ObsChange) => void) {
    this.#onChange = (change) => {
      try {
        onChange(change);
      } catch (error) {
        log.error(`Change handler failed for "${change}"`, error);
      }
    };
    this.#listen();
  }

  snapshot(): Readonly<ObsSnapshot> {
    return this.#snapshot;
  }

  get state() {
    return this.#state;
  }

  status(): ObsStatus {
    const s = this.#snapshot;
    return {
      state: this.#state,
      error: this.#error,
      url: this.#config?.url ?? null,
      obsVersion: this.#versions?.obs ?? null,
      obsWebSocketVersion: this.#versions?.websocket ?? null,
      programScene: s.scenes.find((scene) => scene.uuid === s.programScene)?.name ?? null,
      stream: s.stream,
      record: s.record,
      counts: {
        scenes: s.scenes.length,
        inputs: s.inputs.length,
        audioInputs: s.inputs.filter((i) => i.muted !== undefined).length,
        mediaInputs: s.inputs.filter((i) => i.media).length,
        items: s.items.length,
        filters: s.filters.length,
      },
    };
  }

  /** Applies new settings, reconnecting if the connection target changed. */
  configure(config: ObsConfig) {
    const previous = this.#config;
    this.#config = config;
    const targetChanged = previous && (previous.url !== config.url || previous.password !== config.password);
    if (targetChanged && this.#wanted) void this.reconnect();
    else if (!previous && config.autoConnect) void this.connect();
    else if (previous && !previous.autoConnect && config.autoConnect && this.#state !== "connected") void this.connect();
  }

  async connect() {
    this.#wanted = true;
    clearTimeout(this.#reconnectTimer);
    if (this.#connecting || this.#state === "connected" || !this.#config) return;

    this.#connecting = true;
    this.#setState("connecting", null);
    const { url, password } = this.#config;
    log.info("Connecting", { url, auth: !!password });
    try {
      await withTimeout(
        this.#obs.connect(url, password || undefined, { rpcVersion: 1, eventSubscriptions: EventSubscription.All }),
        CONNECT_TIMEOUT_MS,
        "Conexión con OBS"
      );
      const version = await this.#obs.call("GetVersion");
      if (!versionAtLeast(version.obsWebSocketVersion, MIN_WEBSOCKET_VERSION)) {
        throw new Error(
          `obs-websocket ${version.obsWebSocketVersion} no soportado: se requiere ${MIN_WEBSOCKET_VERSION.join(".")} o superior (OBS 30+)`
        );
      }
      this.#versions = { obs: version.obsVersion, websocket: version.obsWebSocketVersion };
      await this.#refresh();
      this.#connecting = false;
      this.#setState("connected", null);
      log.info("Connected", { obs: version.obsVersion, websocket: version.obsWebSocketVersion, ...this.status().counts });
    } catch (error) {
      this.#connecting = false;
      await this.#obs.disconnect().catch((e) => log.debug("Disconnect after failed connect also failed", e));
      this.#resetLiveState();
      this.#setState("error", errorMessage(error));
      log.warn(`Connection failed: ${errorMessage(error)}`, error, {
        retryInMs: this.#wanted ? this.#config.reconnectMs : null,
      });
      this.#scheduleReconnect();
    }
  }

  async disconnect() {
    this.#wanted = false;
    clearTimeout(this.#reconnectTimer);
    clearTimeout(this.#refreshTimer);
    await this.#obs.disconnect().catch((e) => log.debug("Disconnect failed", e));
    this.#resetLiveState();
    this.#setState("disconnected", null);
    log.info("Disconnected");
  }

  async reconnect() {
    await this.disconnect();
    await this.connect();
  }

  async refresh() {
    this.#assertConnected();
    await this.#refresh();
  }

  /** Typed call that fails clearly while OBS isn't connected. */
  async call<T extends keyof OBSRequestTypes>(type: T, data?: OBSRequestTypes[T]): Promise<OBSResponseTypes[T]> {
    this.#assertConnected();
    const started = performance.now();
    try {
      const result = await this.#obs.call(type, data);
      log.debug(`${type} ok in ${Math.round(performance.now() - started)} ms`, data);
      return result;
    } catch (error) {
      log.warn(`${type} failed: ${errorMessage(error)}`, error, { data });
      throw error;
    }
  }

  #assertConnected() {
    if (this.#state !== "connected") throw new Error("OBS no conectado");
  }

  #setState(state: ConnectionState, error: string | null) {
    this.#state = state;
    this.#error = error;
    this.#onChange("status");
  }

  #scheduleReconnect() {
    if (!this.#wanted || !this.#config) return;
    clearTimeout(this.#reconnectTimer);
    log.debug(`Reconnecting in ${this.#config.reconnectMs} ms`);
    this.#reconnectTimer = setTimeout(() => void this.connect(), this.#config.reconnectMs);
  }

  #resetLiveState() {
    Object.assign(this.#snapshot, {
      programScene: null,
      previewScene: null,
      studioMode: false,
      stream: "off",
      record: "off",
      virtualcam: false,
      replayBuffer: false,
    } satisfies Partial<ObsSnapshot>);
    for (const input of this.#snapshot.inputs) if (input.muted !== undefined) input.muted = false;
    this.#onChange("state");
  }

  async #refresh() {
    const started = performance.now();
    const [version, sceneList, studio, inputList, transitions, hotkeys, stream, record, virtualcam, replay] =
      (await this.#obs.callBatch(
        [
          { requestType: "GetVersion" },
          { requestType: "GetSceneList", requestData: {} },
          { requestType: "GetStudioModeEnabled" },
          { requestType: "GetInputList", requestData: {} },
          { requestType: "GetSceneTransitionList" },
          { requestType: "GetHotkeyList" },
          { requestType: "GetStreamStatus" },
          { requestType: "GetRecordStatus" },
          { requestType: "GetVirtualCamStatus" },
          { requestType: "GetReplayBufferStatus" },
        ],
        { haltOnFailure: false }
      )) as BatchResult[];

    const data = <T extends keyof OBSResponseTypes>(result: BatchResult | undefined, _type: T) =>
      result?.requestStatus.result ? (result.responseData as OBSResponseTypes[T]) : undefined;

    const versionData = data(version, "GetVersion");
    if (versionData) this.#versions = { obs: versionData.obsVersion, websocket: versionData.obsWebSocketVersion };

    const scenesData = data(sceneList, "GetSceneList");
    // OBS lists scenes bottom-up; reverse to match the UI order.
    const scenes = (scenesData?.scenes ?? [])
      .map((s) => ({ uuid: String(s.sceneUuid), name: String(s.sceneName), index: Number(s.sceneIndex) }))
      .sort((a, b) => b.index - a.index)
      .map(({ uuid, name }) => ({ uuid, name }));

    const rawInputs = (data(inputList, "GetInputList")?.inputs ?? []).map((i) => ({
      uuid: String(i.inputUuid),
      name: String(i.inputName),
      kind: String(i.unversionedInputKind ?? i.inputKind),
    }));

    const sources = [...scenes, ...rawInputs];
    const details = (await this.#obs.callBatch(
      [
        ...rawInputs.map((i) => ({ requestType: "GetInputMute" as const, requestData: { inputUuid: i.uuid } })),
        ...scenes.map((s) => ({ requestType: "GetSceneItemList" as const, requestData: { sceneUuid: s.uuid } })),
        ...sources.map((s) => ({ requestType: "GetSourceFilterList" as const, requestData: { sourceUuid: s.uuid } })),
      ],
      { haltOnFailure: false }
    )) as BatchResult[];

    const muteResults = details.slice(0, rawInputs.length);
    const itemResults = details.slice(rawInputs.length, rawInputs.length + scenes.length);
    const filterResults = details.slice(rawInputs.length + scenes.length);

    const inputs: ObsInput[] = rawInputs.map((input, i) => ({
      ...input,
      // Non-audio inputs reject GetInputMute, which is how audio capability is detected.
      muted: data(muteResults[i], "GetInputMute")?.inputMuted,
      media: MEDIA_KINDS.has(input.kind),
    }));

    const items: ObsSceneItem[] = scenes.flatMap((scene, i) =>
      (data(itemResults[i], "GetSceneItemList")?.sceneItems ?? []).map((item) => ({
        sceneUuid: scene.uuid,
        id: Number(item.sceneItemId),
        sourceName: String(item.sourceName),
        enabled: Boolean(item.sceneItemEnabled),
      }))
    );

    const filters: ObsFilter[] = sources.flatMap((source, i) =>
      (data(filterResults[i], "GetSourceFilterList")?.filters ?? []).map((filter) => ({
        sourceUuid: source.uuid,
        sourceName: source.name,
        name: String(filter.filterName),
        enabled: Boolean(filter.filterEnabled),
      }))
    );

    const streamData = data(stream, "GetStreamStatus");
    const recordData = data(record, "GetRecordStatus");
    const transitionData = data(transitions, "GetSceneTransitionList");

    this.#snapshot = {
      scenes,
      inputs,
      items,
      filters,
      transitions: (transitionData?.transitions ?? []).map((t) => String(t.transitionName)),
      hotkeys: data(hotkeys, "GetHotkeyList")?.hotkeys ?? [],
      programScene: scenesData?.currentProgramSceneUuid ?? null,
      previewScene: scenesData?.currentPreviewSceneUuid ?? null,
      studioMode: data(studio, "GetStudioModeEnabled")?.studioModeEnabled ?? false,
      currentTransition: transitionData?.currentSceneTransitionName ?? null,
      stream: streamData?.outputActive ? (streamData.outputReconnecting ? "reconnecting" : "live") : "off",
      record: recordData?.outputActive ? (recordData.outputPaused ? "paused" : "recording") : "off",
      virtualcam: data(virtualcam, "GetVirtualCamStatus")?.outputActive ?? false,
      replayBuffer: data(replay, "GetReplayBufferStatus")?.outputActive ?? false,
    };
    const failed = [version, sceneList, studio, inputList, transitions, hotkeys, stream, record, virtualcam]
      .filter((r) => r && !r.requestStatus.result)
      .map((r) => r?.requestStatus.comment);
    if (failed.length) log.warn("Some OBS requests failed during refresh", { failed });
    log.debug(`Refreshed in ${Math.round(performance.now() - started)} ms`, this.status().counts);
    this.#onChange("catalog");
    this.#onChange("state");
  }

  #scheduleRefresh() {
    clearTimeout(this.#refreshTimer);
    this.#refreshTimer = setTimeout(() => {
      if (this.#state !== "connected") return;
      this.#refresh().catch((error) => log.error("Refresh failed", error));
    }, 250);
  }

  #listen() {
    // Wraps every handler with trace logging and error isolation so a bad event can't break the socket.
    const obs = {
      on: <K extends keyof EventTypes>(event: K, handler: (data: EventTypes[K]) => void) => {
        this.#obs.on(event, ((data: EventTypes[K]) => {
          log.trace(`event ${String(event)}`, data);
          try {
            handler(data);
          } catch (error) {
            log.error(`Handler for ${String(event)} failed`, error, { data });
          }
        }) as never);
      },
    };
    const s = () => this.#snapshot;
    const changed = () => this.#onChange("state");

    for (const event of STRUCTURAL_EVENTS) obs.on(event, () => this.#scheduleRefresh());

    obs.on("ConnectionClosed", (error) => {
      // connect() handles its own failures; this covers drops of an established connection.
      if (this.#connecting || this.#state !== "connected") return;
      log.warn("Connection closed", error);
      this.#resetLiveState();
      this.#setState("error", "Conexión con OBS cerrada");
      this.#scheduleReconnect();
    });
    obs.on("ExitStarted", () => {
      log.info("OBS is shutting down");
      this.#setState("error", "OBS se está cerrando");
    });

    obs.on("CurrentProgramSceneChanged", ({ sceneUuid }) => {
      s().programScene = sceneUuid;
      changed();
    });
    obs.on("CurrentPreviewSceneChanged", ({ sceneUuid }) => {
      s().previewScene = sceneUuid;
      changed();
    });
    obs.on("StudioModeStateChanged", ({ studioModeEnabled }) => {
      s().studioMode = studioModeEnabled;
      if (!studioModeEnabled) s().previewScene = null;
      changed();
    });
    obs.on("CurrentSceneTransitionChanged", ({ transitionName }) => {
      s().currentTransition = transitionName;
      changed();
    });
    obs.on("InputMuteStateChanged", ({ inputUuid, inputMuted }) => {
      const input = s().inputs.find((i) => i.uuid === inputUuid);
      if (input) input.muted = inputMuted;
      changed();
    });
    obs.on("SceneItemEnableStateChanged", ({ sceneUuid, sceneItemId, sceneItemEnabled }) => {
      const item = s().items.find((i) => i.sceneUuid === sceneUuid && i.id === sceneItemId);
      if (item) item.enabled = sceneItemEnabled;
      changed();
    });
    obs.on("SourceFilterEnableStateChanged", ({ sourceName, filterName, filterEnabled }) => {
      // Filter events only carry the source name.
      const filter = s().filters.find((f) => f.sourceName === sourceName && f.name === filterName);
      if (filter) filter.enabled = filterEnabled;
      changed();
    });
    obs.on("StreamStateChanged", ({ outputState }) => {
      s().stream = streamState(outputState);
      changed();
      this.#onChange("status");
    });
    obs.on("RecordStateChanged", ({ outputState }) => {
      s().record = recordState(outputState, s().record);
      changed();
      this.#onChange("status");
    });
    obs.on("VirtualcamStateChanged", ({ outputActive }) => {
      s().virtualcam = outputActive;
      changed();
    });
    obs.on("ReplayBufferStateChanged", ({ outputActive }) => {
      s().replayBuffer = outputActive;
      changed();
    });
  }
}

/** One-off connection check that doesn't touch the main client. */
export async function testConnection(url: string, password: string | undefined) {
  const obs = new OBSWebSocket();
  try {
    await withTimeout(
      obs.connect(url, password || undefined, { rpcVersion: 1, eventSubscriptions: EventSubscription.None }),
      CONNECT_TIMEOUT_MS,
      "Prueba de conexión"
    );
    const version = await obs.call("GetVersion");
    return {
      obsVersion: version.obsVersion,
      obsWebSocketVersion: version.obsWebSocketVersion,
      supported: versionAtLeast(version.obsWebSocketVersion, MIN_WEBSOCKET_VERSION),
    };
  } finally {
    await obs.disconnect().catch(() => undefined);
  }
}

function streamState(outputState: string): StreamState {
  switch (outputState) {
    case "OBS_WEBSOCKET_OUTPUT_STARTING":
      return "starting";
    case "OBS_WEBSOCKET_OUTPUT_STARTED":
    case "OBS_WEBSOCKET_OUTPUT_RECONNECTED":
      return "live";
    case "OBS_WEBSOCKET_OUTPUT_RECONNECTING":
      return "reconnecting";
    case "OBS_WEBSOCKET_OUTPUT_STOPPING":
      return "stopping";
    default:
      return "off";
  }
}

function recordState(outputState: string, previous: RecordState): RecordState {
  switch (outputState) {
    case "OBS_WEBSOCKET_OUTPUT_STARTING":
      return "starting";
    case "OBS_WEBSOCKET_OUTPUT_STARTED":
    case "OBS_WEBSOCKET_OUTPUT_RESUMED":
      return "recording";
    case "OBS_WEBSOCKET_OUTPUT_PAUSED":
      return "paused";
    case "OBS_WEBSOCKET_OUTPUT_STOPPING":
      return "stopping";
    case "OBS_WEBSOCKET_OUTPUT_STOPPED":
      return "off";
    default:
      return previous;
  }
}

function versionAtLeast(version: string, minimum: number[]) {
  const parts = version.split(".").map((p) => Number.parseInt(p, 10) || 0);
  for (let i = 0; i < minimum.length; i++) {
    if ((parts[i] ?? 0) !== minimum[i]) return (parts[i] ?? 0) > minimum[i];
  }
  return true;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    const code = (error as { code?: number }).code;
    if (code === 4009) return "Contraseña de OBS incorrecta";
    return error.message || `Error de conexión${code ? ` (código ${code})` : ""}`;
  }
  return String(error);
}
