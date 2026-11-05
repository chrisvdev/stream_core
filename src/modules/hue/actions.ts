import type { ActionContext, ActionDefinition, ParamSchema } from "../../core";
import type { Rgb } from "../../lib/palette";
import { HueError } from "./client";
import { hexToRgb, rgbToXy } from "./colors";
import type { HueConnection } from "./connection";
import type { EffectHandle, EntertainmentEngine } from "./entertainment/engine";
import { EFFECTS, type EffectName } from "./entertainment/effects";

type Option = { value: string; label: string };

interface Deps {
  connection(): HueConnection | null;
  engine(): EntertainmentEngine | null;
}

const select = (key: string, label: string, options: Option[], extra: Partial<ParamSchema> = {}): ParamSchema =>
  ({ key, label, type: "select", options, required: true, ...extra }) as ParamSchema;

const modeParam = (options: Option[], fallback: string): ParamSchema =>
  ({ key: "mode", label: "Modo", type: "select", options, default: fallback }) as ParamSchema;

const TOGGLE_MODES: Option[] = [
  { value: "toggle", label: "Alternar" },
  { value: "on", label: "Encender" },
  { value: "off", label: "Apagar" },
  { value: "hold", label: "Encendido mientras se presiona" },
];

const START_STOP: Option[] = [
  { value: "toggle", label: "Alternar" },
  { value: "start", label: "Iniciar" },
  { value: "stop", label: "Detener" },
];

const EFFECT_LABELS: Record<EffectName, string> = {
  solid: "Color fijo",
  strobe: "Strobe",
  pulse: "Pulso",
  rainbow: "Arcoíris",
  chase: "Persecución",
};

/** Targets are `light:<id>` or `group:<room|zone id|home>`. */
interface Target {
  type: "light" | "grouped_light";
  id: string;
  on: boolean;
  gamut: import("./state").Gamut | null;
}

export function createActions({ connection, engine }: Deps): ActionDefinition[] {
  const conn = () => {
    const c = connection();
    if (!c) throw new HueError("Hue no conectado");
    return c;
  };
  const eng = () => {
    const e = engine();
    if (!e) throw new HueError("Hue no conectado");
    return e;
  };
  const data = () => connection()?.data;

  const targetOptions = (): Option[] => [
    ...(data()?.groups() ?? []).map((g) => ({
      value: `group:${g.id}`,
      label: g.kind === "home" ? g.name : `${g.kind === "room" ? "Room" : "Zone"}: ${g.name}`,
    })),
    ...(data()?.lights() ?? []).map((l) => ({ value: `light:${l.id}`, label: `Luz: ${l.name}` })),
  ];
  const areaOptions = (): Option[] => (data()?.areas() ?? []).map((a) => ({ value: a.id, label: a.name }));

  const resolveTarget = (value: string): Target => {
    const c = conn();
    const [kind, id] = [value.slice(0, value.indexOf(":")), value.slice(value.indexOf(":") + 1)];
    if (kind === "light") {
      const light = c.data.lights().find((l) => l.id === id);
      if (!light) throw new HueError("La luz ya no existe en el bridge");
      return { type: "light", id, on: light.on, gamut: light.gamut };
    }
    const group = c.data.groups().find((g) => g.id === id);
    if (!group?.groupedLightId) throw new HueError("El grupo ya no existe en el bridge");
    return { type: "grouped_light", id: group.groupedLightId, on: group.on, gamut: null };
  };

  const holds = new Map<string, EffectHandle>();
  const holdKey = (ctx: ActionContext) => `${ctx.coordinate.x},${ctx.coordinate.y}`;

  return [
    {
      id: "light",
      name: "Luz / grupo",
      description: "Enciende, apaga o cambia el color de una luz, room, zone o toda la casa.",
      params: () => [
        select("target", "Destino", targetOptions(), { dynamic: true }),
        modeParam(TOGGLE_MODES, "toggle"),
        { key: "brightness", label: "Brillo % (opcional)", type: "number", min: 0, max: 100 },
        { key: "color", label: "Color #rrggbb (opcional)", type: "string" },
        { key: "colorTemp", label: "Temperatura en mirek 153–500 (opcional)", type: "number", min: 153, max: 500 },
        { key: "transitionMs", label: "Transición ms (opcional)", type: "number", min: 0, max: 60_000 },
      ],
      handle: async ({ event, params }) => {
        const target = resolveTarget(String(params.target));
        let on: boolean;
        if (params.mode === "hold") on = event === "press";
        else if (event !== "press") return;
        else on = params.mode === "on" ? true : params.mode === "off" ? false : !target.on;

        const body: Record<string, unknown> = { on: { on } };
        if (on) {
          if (typeof params.brightness === "number") body.dimming = { brightness: params.brightness };
          if (typeof params.color === "string" && params.color) {
            const rgb = hexToRgb(params.color);
            if (!rgb) throw new HueError(`Color inválido: ${params.color}`);
            body.color = { xy: rgbToXy(rgb, target.gamut).xy };
          } else if (typeof params.colorTemp === "number") {
            body.color_temperature = { mirek: params.colorTemp };
          }
        }
        if (typeof params.transitionMs === "number") body.dynamics = { duration: params.transitionMs };
        await conn().client.put(target.type, target.id, body);
      },
    },
    {
      id: "brightness-step",
      name: "Brillo +/−",
      params: () => [
        select("target", "Destino", targetOptions(), { dynamic: true }),
        { key: "delta", label: "Cambio en % (negativo baja)", type: "number", min: -100, max: 100, default: 10 },
      ],
      handle: async ({ event, params }) => {
        if (event !== "press") return;
        const target = resolveTarget(String(params.target));
        const delta = Number(params.delta);
        await conn().client.put(target.type, target.id, {
          dimming_delta: { action: delta >= 0 ? "up" : "down", brightness_delta: Math.abs(delta) },
        });
      },
    },
    {
      id: "scene",
      name: "Escena",
      params: () => [
        select(
          "scene",
          "Escena",
          (data()?.scenes() ?? []).map((s) => ({ value: s.id, label: `${s.groupName} / ${s.name}` })),
          { dynamic: true }
        ),
        modeParam(
          [
            { value: "active", label: "Activar" },
            { value: "static", label: "Activar estática" },
            { value: "dynamic_palette", label: "Activar con paleta dinámica" },
          ],
          "active"
        ),
        { key: "toggle", label: "Si ya está activa, apagar su grupo", type: "boolean", default: false },
        { key: "transitionMs", label: "Transición ms (opcional)", type: "number", min: 0, max: 60_000 },
      ],
      handle: async ({ event, params }) => {
        if (event !== "press") return;
        const c = conn();
        const scene = c.data.scenes().find((s) => s.id === params.scene);
        if (!scene) throw new HueError("La escena ya no existe en el bridge");
        if (params.toggle && scene.active !== "inactive" && scene.groupId) {
          const grouped = c.data.groupedLightFor(scene.groupId);
          if (grouped) return void (await c.client.put("grouped_light", grouped, { on: { on: false } }));
        }
        const recall: Record<string, unknown> = { action: params.mode };
        if (typeof params.transitionMs === "number") recall.duration = params.transitionMs;
        await c.client.put("scene", scene.id, { recall });
      },
    },
    {
      id: "smart-scene",
      name: "Smart scene",
      params: () => [
        select(
          "smartScene",
          "Smart scene",
          (data()?.smartScenes() ?? []).map((s) => ({ value: s.id, label: `${s.groupName} / ${s.name}` })),
          { dynamic: true }
        ),
        modeParam(START_STOP.map((o) => ({ ...o, label: o.label.replace("Iniciar", "Activar").replace("Detener", "Desactivar") })), "toggle"),
      ],
      handle: async ({ event, params }) => {
        if (event !== "press") return;
        const c = conn();
        const smart = c.data.smartScenes().find((s) => s.id === params.smartScene);
        if (!smart) throw new HueError("La smart scene ya no existe en el bridge");
        const activate = params.mode === "start" ? true : params.mode === "stop" ? false : !smart.active;
        await c.client.put("smart_scene", smart.id, { recall: { action: activate ? "activate" : "deactivate" } });
      },
    },
    {
      id: "identify",
      name: "Identificar (respirar)",
      params: () => [select("target", "Destino", targetOptions(), { dynamic: true })],
      handle: async ({ event, params }) => {
        if (event !== "press") return;
        const target = resolveTarget(String(params.target));
        await conn().client.put(target.type, target.id, { alert: { action: "breathe" } });
      },
    },
    {
      id: "light-effect",
      name: "Efecto de luz",
      description: "Efectos integrados de la luz (vela, fuego, etc.), según lo que soporte cada modelo.",
      params: () => {
        const lights = (data()?.lights() ?? []).filter((l) => l.effects.length);
        const effects = [...new Set(lights.flatMap((l) => l.effects))];
        return [
          select("light", "Luz", lights.map((l) => ({ value: l.id, label: l.name })), { dynamic: true }),
          select(
            "effect",
            "Efecto",
            [{ value: "no_effect", label: "Sin efecto" }, ...effects.map((e) => ({ value: e, label: e }))],
            { dynamic: true }
          ),
        ];
      },
      handle: async ({ event, params }) => {
        if (event !== "press") return;
        await conn().client.put("light", String(params.light), { effects: { effect: String(params.effect) } });
      },
    },
    {
      id: "area",
      name: "Área entertainment",
      description: "Inicia o detiene un área sin enviar colores (para apps como Hue Sync).",
      params: () => [select("area", "Área", areaOptions(), { dynamic: true }), modeParam(START_STOP, "toggle")],
      handle: async ({ event, params }) => {
        if (event !== "press") return;
        const c = conn();
        const area = c.data.areas().find((a) => a.id === params.area);
        if (!area) throw new HueError("El área ya no existe en el bridge");
        const start = params.mode === "start" ? true : params.mode === "stop" ? false : !area.active;
        if (!start && engine()?.streamingAreas().includes(area.id)) return void (await eng().stopArea(area.id));
        await c.client.put("entertainment_configuration", area.id, { action: start ? "start" : "stop" });
      },
    },
    {
      id: "stream-effect",
      name: "Efecto entertainment",
      description: "Efecto en tiempo real sobre un área (streaming). Al terminar, las luces vuelven a su estado anterior.",
      params: () => [
        select("area", "Área", areaOptions(), { dynamic: true }),
        {
          key: "effect",
          label: "Efecto",
          type: "select",
          default: "strobe",
          options: EFFECTS.map((e) => ({ value: e, label: EFFECT_LABELS[e] })),
        },
        { key: "color", label: "Color #rrggbb", type: "string", default: "#ffffff" },
        { key: "color2", label: "Color 2 #rrggbb (strobe/persecución)", type: "string" },
        { key: "speed", label: "Velocidad (ciclos/s)", type: "number", min: 0.1, max: 20, default: 4 },
        { key: "channels", label: "Canales (ej. 0,2,5; vacío = todos)", type: "string" },
        {
          key: "mode",
          label: "Duración",
          type: "select",
          default: "timed",
          options: [
            { value: "timed", label: "Por tiempo" },
            { value: "hold", label: "Mientras se presiona" },
          ],
        },
        { key: "durationMs", label: "Duración ms (modo por tiempo)", type: "number", min: 100, max: 600_000, default: 2_000 },
      ],
      handle: async (ctx) => {
        const { event, params } = ctx;
        const key = holdKey(ctx);
        if (params.mode === "hold" && event === "release") {
          holds.get(key)?.stop();
          holds.delete(key);
          return;
        }
        if (event !== "press") return;
        const parse = (v: unknown): Rgb | undefined => {
          if (typeof v !== "string" || !v) return undefined;
          const rgb = hexToRgb(v);
          if (!rgb) throw new HueError(`Color inválido: ${v}`);
          return rgb;
        };
        const channels =
          typeof params.channels === "string" && params.channels.trim()
            ? params.channels.split(",").map((c) => Number.parseInt(c.trim(), 10)).filter((n) => Number.isInteger(n))
            : undefined;
        const handle = await eng().effect(String(params.area), {
          effect: params.effect as EffectName,
          color: parse(params.color),
          color2: parse(params.color2),
          speed: Number(params.speed),
          channels,
          durationMs: params.mode === "hold" ? undefined : Number(params.durationMs),
        });
        if (params.mode === "hold") {
          holds.get(key)?.stop();
          holds.set(key, handle);
        }
      },
    },
    {
      id: "mirror",
      name: "Espejo del Launchpad",
      description: "Copia en las luces del área los colores de los botones asignados a cada canal (se configura en el panel Hue).",
      params: () => [select("area", "Área", areaOptions(), { dynamic: true }), modeParam(START_STOP, "toggle")],
      handle: async ({ event, params }) => {
        if (event !== "press") return;
        const e = eng();
        const area = String(params.area);
        const enable = params.mode === "start" ? true : params.mode === "stop" ? false : !e.isMirroring(area);
        await e.setMirror(area, enable);
      },
    },
  ];
}
