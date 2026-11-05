import type { Appearance, IndicatorDefinition } from "../../core";
import type { ObsSnapshot, ConnectionState } from "./client";

// Palette codes from the high bank (see palette.txt): getColor(r, g, b, true).
const GREEN = 76;
const RED = 112;
const YELLOW = 124;
const ORANGE = 116;
const BLUE = 67;
const PURPLE = 115;
const CYAN = 79;
const DIM_RED = 80;

const fixed = (code: number): Appearance => ({ mode: "static", code });
const pulse = (code: number): Appearance => ({ mode: "pulsing", code });
const flash = (code: number, code2 = 0): Appearance => ({ mode: "flashing", code, code2 });

const FIXED: IndicatorDefinition[] = [
  {
    id: "connection",
    name: "Conexión con OBS",
    states: [
      { id: "connected", name: "Conectado", appearance: fixed(GREEN) },
      { id: "connecting", name: "Conectando", appearance: pulse(YELLOW) },
      { id: "error", name: "Error", appearance: flash(RED) },
    ],
  },
  {
    id: "stream",
    name: "Stream",
    states: [
      { id: "live", name: "En vivo", appearance: pulse(RED) },
      { id: "starting", name: "Iniciando", appearance: flash(YELLOW) },
      { id: "stopping", name: "Deteniendo", appearance: flash(ORANGE) },
      { id: "reconnecting", name: "Reconectando", appearance: flash(RED, YELLOW) },
    ],
  },
  {
    id: "record",
    name: "Grabación",
    states: [
      { id: "recording", name: "Grabando", appearance: fixed(RED) },
      { id: "paused", name: "En pausa", appearance: pulse(YELLOW) },
      { id: "starting", name: "Iniciando", appearance: flash(YELLOW) },
      { id: "stopping", name: "Deteniendo", appearance: flash(ORANGE) },
    ],
  },
  { id: "virtualcam", name: "Cámara virtual", states: [{ id: "on", name: "Activa", appearance: fixed(PURPLE) }] },
  { id: "replay", name: "Replay buffer", states: [{ id: "on", name: "Activo", appearance: fixed(CYAN) }] },
  { id: "studio", name: "Modo estudio", states: [{ id: "on", name: "Activo", appearance: fixed(BLUE) }] },
];

const SCENE_STATES = [
  { id: "program", name: "En programa", appearance: fixed(GREEN) },
  { id: "preview", name: "En preview", appearance: fixed(YELLOW) },
];
const MUTE_STATES = [
  { id: "muted", name: "Muteado", appearance: fixed(RED) },
  { id: "live", name: "Con audio", appearance: fixed(GREEN) },
];
const VISIBILITY_STATES = [
  { id: "visible", name: "Visible", appearance: fixed(GREEN) },
  { id: "hidden", name: "Oculta", appearance: fixed(DIM_RED) },
];
const FILTER_STATES = [
  { id: "on", name: "Activo", appearance: fixed(CYAN) },
  { id: "off", name: "Inactivo", appearance: fixed(DIM_RED) },
];

const sceneId = (uuid: string) => `scene:${uuid}`;
const muteId = (uuid: string) => `mute:${uuid}`;
const itemId = (sceneUuid: string, id: number) => `item:${sceneUuid}:${id}`;
const filterId = (sourceUuid: string, name: string) => `filter:${sourceUuid}:${name}`;

export function buildIndicators(snapshot: Readonly<ObsSnapshot> | undefined): IndicatorDefinition[] {
  if (!snapshot) return FIXED;
  const sceneNames = new Map(snapshot.scenes.map((s) => [s.uuid, s.name]));
  return [
    ...FIXED,
    ...snapshot.scenes.map((s) => ({ id: sceneId(s.uuid), name: `Escena: ${s.name}`, states: SCENE_STATES })),
    ...snapshot.inputs
      .filter((i) => i.muted !== undefined)
      .map((i) => ({ id: muteId(i.uuid), name: `Audio: ${i.name}`, states: MUTE_STATES })),
    ...snapshot.items.map((i) => ({
      id: itemId(i.sceneUuid, i.id),
      name: `Fuente: ${sceneNames.get(i.sceneUuid) ?? "?"} / ${i.sourceName}`,
      states: VISIBILITY_STATES,
    })),
    ...snapshot.filters.map((f) => ({
      id: filterId(f.sourceUuid, f.name),
      name: `Filtro: ${f.sourceName} / ${f.name}`,
      states: FILTER_STATES,
    })),
  ];
}

/** Desired state for every known indicator; `null` means cleared. */
export function desiredStates(snapshot: Readonly<ObsSnapshot>, connection: ConnectionState): Map<string, string | null> {
  const states = new Map<string, string | null>();
  const live = connection === "connected";

  states.set("connection", connection === "disconnected" ? null : connection);
  states.set("stream", live && snapshot.stream !== "off" ? snapshot.stream : null);
  states.set("record", live && snapshot.record !== "off" ? snapshot.record : null);
  states.set("virtualcam", live && snapshot.virtualcam ? "on" : null);
  states.set("replay", live && snapshot.replayBuffer ? "on" : null);
  states.set("studio", live && snapshot.studioMode ? "on" : null);

  for (const scene of snapshot.scenes) {
    const state = !live ? null : scene.uuid === snapshot.programScene ? "program" : scene.uuid === snapshot.previewScene ? "preview" : null;
    states.set(sceneId(scene.uuid), state);
  }
  for (const input of snapshot.inputs) {
    if (input.muted === undefined) continue;
    states.set(muteId(input.uuid), live ? (input.muted ? "muted" : "live") : null);
  }
  for (const item of snapshot.items) {
    states.set(itemId(item.sceneUuid, item.id), live ? (item.enabled ? "visible" : "hidden") : null);
  }
  for (const filter of snapshot.filters) {
    states.set(filterId(filter.sourceUuid, filter.name), live ? (filter.enabled ? "on" : "off") : null);
  }
  return states;
}
