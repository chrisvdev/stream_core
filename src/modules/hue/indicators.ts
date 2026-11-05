import type { Appearance, IndicatorDefinition } from "../../core";
import type { HueConnectionState } from "./connection";
import type { HueState } from "./state";

// High-bank palette codes (see palette.txt): getColor(r, g, b, true).
const GREEN = 76;
const RED = 112;
const YELLOW = 124;
const ORANGE = 116;
const BLUE = 67;
const PURPLE = 115;
const CYAN = 79;
const DIM_RED = 80;
const WHITE = 127;

const fixed = (code: number): Appearance => ({ mode: "static", code });
const pulse = (code: number): Appearance => ({ mode: "pulsing", code });
const flash = (code: number, code2 = 0): Appearance => ({ mode: "flashing", code, code2 });

const FIXED: IndicatorDefinition[] = [
  {
    id: "connection",
    name: "Conexión con el bridge",
    states: [
      { id: "connected", name: "Conectado", appearance: fixed(GREEN) },
      { id: "connecting", name: "Conectando", appearance: pulse(YELLOW) },
      { id: "error", name: "Error", appearance: flash(RED) },
      { id: "unpaired", name: "Falta emparejar", appearance: flash(ORANGE) },
    ],
  },
  {
    id: "streaming",
    name: "Streaming entertainment",
    states: [
      { id: "ours", name: "Activo (esta app)", appearance: pulse(PURPLE) },
      { id: "other", name: "En uso por otra app", appearance: fixed(ORANGE) },
    ],
  },
];

const ON_OFF = [
  { id: "on", name: "Encendida", appearance: fixed(WHITE) },
  { id: "off", name: "Apagada", appearance: fixed(DIM_RED) },
];
const LIGHT_STATES = [...ON_OFF, { id: "unreachable", name: "Inalcanzable", appearance: flash(RED) }];
const SCENE_STATES = [
  { id: "static", name: "Activa", appearance: fixed(GREEN) },
  { id: "dynamic_palette", name: "Activa (dinámica)", appearance: pulse(GREEN) },
];
const AREA_STATES = [
  { id: "ours", name: "Streaming (esta app)", appearance: pulse(PURPLE) },
  { id: "other", name: "Activa por otra app", appearance: fixed(ORANGE) },
];

export const ids = {
  light: (id: string) => `light:${id}`,
  group: (id: string) => `group:${id}`,
  scene: (id: string) => `scene:${id}`,
  smartScene: (id: string) => `smart:${id}`,
  area: (id: string) => `area:${id}`,
  device: (id: string) => `device:${id}`,
};

export function buildIndicators(data: HueState | undefined): IndicatorDefinition[] {
  if (!data) return FIXED;
  return [
    ...FIXED,
    ...data.lights().map((l) => ({ id: ids.light(l.id), name: `Luz: ${l.name}`, states: LIGHT_STATES })),
    ...data.groups().map((g) => ({
      id: ids.group(g.id),
      name: g.kind === "home" ? g.name : `${g.kind === "room" ? "Room" : "Zone"}: ${g.name}`,
      states: ON_OFF,
    })),
    ...data.scenes().map((s) => ({ id: ids.scene(s.id), name: `Escena: ${s.groupName} / ${s.name}`, states: SCENE_STATES })),
    ...data.smartScenes().map((s) => ({
      id: ids.smartScene(s.id),
      name: `Smart scene: ${s.groupName} / ${s.name}`,
      states: [{ id: "active", name: "Activa", appearance: fixed(CYAN) }],
    })),
    ...data.areas().map((a) => ({ id: ids.area(a.id), name: `Área: ${a.name}`, states: AREA_STATES })),
    ...data.devices().map((d) => ({
      id: ids.device(d.id),
      name: `Dispositivo: ${d.name}`,
      states: [{ id: "disconnected", name: "Desconectado", appearance: flash(RED, BLUE) }],
    })),
  ];
}

/** Desired state of every known indicator; `null` clears it. */
export function desiredStates(
  data: HueState,
  connection: HueConnectionState,
  applicationId: string | undefined,
  streamingAreas: string[]
): Map<string, string | null> {
  const states = new Map<string, string | null>();
  const live = connection === "connected";
  states.set("connection", connection === "disconnected" ? null : connection);

  const areas = data.areas();
  const anyOurs = streamingAreas.length > 0;
  const anyOther = areas.some((a) => a.active && a.streamer && a.streamer !== applicationId);
  states.set("streaming", !live ? null : anyOurs ? "ours" : anyOther ? "other" : null);

  for (const l of data.lights()) states.set(ids.light(l.id), !live ? null : !l.reachable ? "unreachable" : l.on ? "on" : "off");
  for (const g of data.groups()) states.set(ids.group(g.id), live ? (g.on ? "on" : "off") : null);
  for (const s of data.scenes()) states.set(ids.scene(s.id), live && s.active !== "inactive" ? s.active : null);
  for (const s of data.smartScenes()) states.set(ids.smartScene(s.id), live && s.active ? "active" : null);
  for (const a of areas) {
    const ours = streamingAreas.includes(a.id);
    states.set(ids.area(a.id), !live ? null : ours ? "ours" : a.active ? "other" : null);
  }
  for (const d of data.devices()) states.set(ids.device(d.id), live && !d.connected ? "disconnected" : null);
  return states;
}
