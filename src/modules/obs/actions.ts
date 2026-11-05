import type { ActionContext, ActionDefinition, ParamSchema } from "../../core";
import type { ObsClient, ObsSnapshot } from "./client";

type GetClient = () => ObsClient | null;
type Option = { value: string; label: string };

/** Values that carry two ids use the first "|" as separator; OBS UUIDs never contain it. */
const SEP = "|";
const split = (value: string): [string, string] => {
  const i = value.indexOf(SEP);
  return i < 0 ? [value, ""] : [value.slice(0, i), value.slice(i + 1)];
};

const select = (key: string, label: string, options: Option[], extra: Partial<ParamSchema> = {}): ParamSchema =>
  ({ key, label, type: "select", options, required: true, ...extra }) as ParamSchema;

const modeParam = (options: Option[], fallback: string): ParamSchema =>
  ({ key: "mode", label: "Modo", type: "select", options, default: fallback }) as ParamSchema;

const sceneName = (s: Readonly<ObsSnapshot>, uuid: string) => s.scenes.find((x) => x.uuid === uuid)?.name ?? uuid;

function options(getClient: GetClient) {
  const s = () => getClient()?.snapshot();
  return {
    scenes: (): Option[] => (s()?.scenes ?? []).map((x) => ({ value: x.uuid, label: x.name })),
    audioInputs: (): Option[] =>
      (s()?.inputs ?? []).filter((i) => i.muted !== undefined).map((i) => ({ value: i.uuid, label: i.name })),
    mediaInputs: (): Option[] => (s()?.inputs ?? []).filter((i) => i.media).map((i) => ({ value: i.uuid, label: i.name })),
    items: (): Option[] => {
      const snap = s();
      if (!snap) return [];
      return snap.items.map((i) => ({
        value: `${i.sceneUuid}${SEP}${i.id}`,
        label: `${sceneName(snap, i.sceneUuid)} / ${i.sourceName}`,
      }));
    },
    filters: (): Option[] =>
      (s()?.filters ?? []).map((f) => ({ value: `${f.sourceUuid}${SEP}${f.name}`, label: `${f.sourceName} / ${f.name}` })),
    transitions: (): Option[] => (s()?.transitions ?? []).map((t) => ({ value: t, label: t })),
    hotkeys: (): Option[] => (s()?.hotkeys ?? []).map((h) => ({ value: h, label: h })),
  };
}

const TOGGLE_MODES: Option[] = [
  { value: "toggle", label: "Alternar" },
  { value: "start", label: "Iniciar" },
  { value: "stop", label: "Detener" },
];

const VISIBILITY_MODES: Option[] = [
  { value: "toggle", label: "Alternar" },
  { value: "on", label: "Activar" },
  { value: "off", label: "Desactivar" },
  { value: "hold", label: "Activar mientras se presiona" },
];

/** Resolves the target boolean for toggle/on/off/hold modes, or `null` when the event should be ignored. */
function targetState(mode: string, event: ActionContext["event"], current: boolean): boolean | null {
  if (mode === "hold") return event === "press";
  if (event !== "press") return null;
  if (mode === "on") return true;
  if (mode === "off") return false;
  return !current;
}

export function createActions(getClient: GetClient): ActionDefinition[] {
  const opts = options(getClient);
  const client = () => {
    const c = getClient();
    if (!c) throw new Error("OBS no conectado");
    return c;
  };
  const onPress =
    (run: (ctx: ActionContext) => Promise<unknown>) =>
    async (ctx: ActionContext) => {
      if (ctx.event === "press") await run(ctx);
    };

  return [
    {
      id: "scene",
      name: "Cambiar escena",
      params: () => [
        select("scene", "Escena", opts.scenes(), { dynamic: true }),
        {
          key: "target",
          label: "Destino",
          type: "select",
          default: "program",
          options: [
            { value: "program", label: "Programa" },
            { value: "preview", label: "Preview (modo estudio)" },
          ],
        },
      ],
      handle: onPress(({ params }) =>
        params.target === "preview"
          ? client().call("SetCurrentPreviewScene", { sceneUuid: String(params.scene) })
          : client().call("SetCurrentProgramScene", { sceneUuid: String(params.scene) })
      ),
    },
    {
      id: "studio-transition",
      name: "Transición de estudio",
      description: "Pasa la escena de preview a programa.",
      handle: onPress(() => client().call("TriggerStudioModeTransition")),
    },
    {
      id: "studio-mode",
      name: "Modo estudio",
      params: [modeParam(VISIBILITY_MODES.slice(0, 3), "toggle")],
      handle: async ({ event, params }) => {
        const c = client();
        const enabled = targetState(String(params.mode), event, c.snapshot().studioMode);
        if (enabled !== null) await c.call("SetStudioModeEnabled", { studioModeEnabled: enabled });
      },
    },
    {
      id: "stream",
      name: "Stream",
      params: [modeParam(TOGGLE_MODES, "toggle")],
      handle: onPress(({ params }) => {
        const c = client();
        if (params.mode === "start") return c.call("StartStream");
        if (params.mode === "stop") return c.call("StopStream");
        return c.call("ToggleStream");
      }),
    },
    {
      id: "record",
      name: "Grabación",
      params: [
        modeParam(
          [
            ...TOGGLE_MODES,
            { value: "pause", label: "Pausar / reanudar" },
            { value: "split", label: "Dividir archivo" },
            { value: "chapter", label: "Crear capítulo" },
          ],
          "toggle"
        ),
        { key: "chapterName", label: "Nombre del capítulo (opcional)", type: "string" },
      ],
      handle: onPress(({ params }) => {
        const c = client();
        switch (params.mode) {
          case "start":
            return c.call("StartRecord");
          case "stop":
            return c.call("StopRecord");
          case "pause":
            return c.call("ToggleRecordPause");
          case "split":
            return c.call("SplitRecordFile");
          case "chapter":
            return c.call("CreateRecordChapter", params.chapterName ? { chapterName: String(params.chapterName) } : {});
          default:
            return c.call("ToggleRecord");
        }
      }),
    },
    {
      id: "virtualcam",
      name: "Cámara virtual",
      params: [modeParam(TOGGLE_MODES, "toggle")],
      handle: onPress(({ params }) => {
        const c = client();
        if (params.mode === "start") return c.call("StartVirtualCam");
        if (params.mode === "stop") return c.call("StopVirtualCam");
        return c.call("ToggleVirtualCam");
      }),
    },
    {
      id: "replay",
      name: "Replay buffer",
      params: [modeParam([...TOGGLE_MODES, { value: "save", label: "Guardar replay" }], "save")],
      handle: onPress(({ params }) => {
        const c = client();
        if (params.mode === "start") return c.call("StartReplayBuffer");
        if (params.mode === "stop") return c.call("StopReplayBuffer");
        if (params.mode === "save") return c.call("SaveReplayBuffer");
        return c.call("ToggleReplayBuffer");
      }),
    },
    {
      id: "mute",
      name: "Mute de audio",
      params: () => [
        select("input", "Entrada de audio", opts.audioInputs(), { dynamic: true }),
        modeParam(
          [
            { value: "toggle", label: "Alternar" },
            { value: "mute", label: "Mutear" },
            { value: "unmute", label: "Desmutear" },
            { value: "push-to-talk", label: "Push-to-talk (audio mientras se presiona)" },
            { value: "push-to-mute", label: "Push-to-mute (mute mientras se presiona)" },
          ],
          "toggle"
        ),
      ],
      handle: async ({ event, params }) => {
        const c = client();
        const inputUuid = String(params.input);
        const current = c.snapshot().inputs.find((i) => i.uuid === inputUuid)?.muted ?? false;
        let muted: boolean | null;
        switch (params.mode) {
          case "push-to-talk":
            muted = event !== "press";
            break;
          case "push-to-mute":
            muted = event === "press";
            break;
          case "mute":
            muted = event === "press" ? true : null;
            break;
          case "unmute":
            muted = event === "press" ? false : null;
            break;
          default:
            muted = event === "press" ? !current : null;
        }
        if (muted !== null) await c.call("SetInputMute", { inputUuid, inputMuted: muted });
      },
    },
    {
      id: "scene-item",
      name: "Fuente en escena",
      description: "Muestra u oculta una fuente dentro de una escena.",
      params: () => [select("item", "Escena / fuente", opts.items(), { dynamic: true }), modeParam(VISIBILITY_MODES, "toggle")],
      handle: async ({ event, params }) => {
        const c = client();
        const [sceneUuid, rawId] = split(String(params.item));
        const sceneItemId = Number(rawId);
        const current = c.snapshot().items.find((i) => i.sceneUuid === sceneUuid && i.id === sceneItemId)?.enabled ?? false;
        const enabled = targetState(String(params.mode), event, current);
        if (enabled !== null) await c.call("SetSceneItemEnabled", { sceneUuid, sceneItemId, sceneItemEnabled: enabled });
      },
    },
    {
      id: "filter",
      name: "Filtro",
      params: () => [select("filter", "Fuente / filtro", opts.filters(), { dynamic: true }), modeParam(VISIBILITY_MODES, "toggle")],
      handle: async ({ event, params }) => {
        const c = client();
        const [sourceUuid, filterName] = split(String(params.filter));
        const current =
          c.snapshot().filters.find((f) => f.sourceUuid === sourceUuid && f.name === filterName)?.enabled ?? false;
        const enabled = targetState(String(params.mode), event, current);
        if (enabled !== null) await c.call("SetSourceFilterEnabled", { sourceUuid, filterName, filterEnabled: enabled });
      },
    },
    {
      id: "media",
      name: "Control de media",
      params: () => [
        select("input", "Fuente de media", opts.mediaInputs(), { dynamic: true }),
        {
          key: "action",
          label: "Acción",
          type: "select",
          default: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY",
          options: [
            { value: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY", label: "Reproducir" },
            { value: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PAUSE", label: "Pausar" },
            { value: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART", label: "Reiniciar" },
            { value: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_STOP", label: "Detener" },
            { value: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_NEXT", label: "Siguiente" },
            { value: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PREVIOUS", label: "Anterior" },
          ],
        },
      ],
      handle: onPress(({ params }) =>
        client().call("TriggerMediaInputAction", { inputUuid: String(params.input), mediaAction: String(params.action) })
      ),
    },
    {
      id: "transition",
      name: "Elegir transición",
      params: () => [select("transition", "Transición", opts.transitions(), { dynamic: true })],
      handle: onPress(({ params }) =>
        client().call("SetCurrentSceneTransition", { transitionName: String(params.transition) })
      ),
    },
    {
      id: "hotkey",
      name: "Disparar hotkey",
      params: () => [select("hotkey", "Hotkey", opts.hotkeys(), { dynamic: true })],
      handle: onPress(({ params }) => client().call("TriggerHotkeyByName", { hotkeyName: String(params.hotkey) })),
    },
  ];
}
