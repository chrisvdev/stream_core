import type { StreamModule } from "../../core";

const toggled = new Set<string>();
const pressedAt = new Map<string, number>();
// Flip to true to blink the "status" indicator periodically without touching the device.
const HEARTBEAT = false;
let heartbeat: ReturnType<typeof setInterval> | undefined;

const label = (x: number, y: number, name?: string) =>
  `(${x},${y})${name ? ` "${name}"` : ""}`;

const debug: StreamModule = {
  id: "debug",
  name: "Debug",
  description: "Acciones de prueba que escriben en consola y juegan con el color del botón.",
  indicators: [
    {
      id: "status",
      name: "Estado de prueba",
      description: "Indicador de ejemplo para probar overlays.",
      states: [
        { id: "ok", name: "OK", appearance: { mode: "static", code: 76 } },
        { id: "busy", name: "Ocupado", appearance: { mode: "pulsing", code: 124 } },
        { id: "alert", name: "Alerta", appearance: { mode: "flashing", code: 112, code2: 0 } },
      ],
    },
  ],
  init({ indicator }) {
    if (!HEARTBEAT) return;
    const status = indicator("status");
    heartbeat = setInterval(() => status.flash("ok", 300), 5_000);
  },
  actions: [
    {
      id: "log",
      name: "Log",
      description: "Escribe el evento en consola.",
      params: [
        { key: "message", label: "Mensaje", type: "string", default: "" },
        { key: "logRelease", label: "Registrar también al soltar", type: "boolean", default: true },
      ],
      handle({ event, coordinate: { x, y }, binding, params, log }) {
        if (event === "release" && !params.logRelease) return;
        log.info(`${label(x, y, binding.name)} ${event}`, params.message ? { message: params.message } : undefined);
      },
    },
    {
      id: "feedback",
      name: "Feedback visual",
      description: "Cambia el color mientras el botón está presionado.",
      params: [
        { key: "color", label: "Color (paleta)", type: "number", min: 0, max: 127, default: 112 },
        {
          key: "mode",
          label: "Modo",
          type: "select",
          default: "pulsing",
          options: [
            { value: "pulsing", label: "Pulsante" },
            { value: "flashing", label: "Intermitente" },
            { value: "static", label: "Fijo" },
          ],
        },
      ],
      handle({ event, params, button }) {
        if (event === "release") return button.restore();
        const color = params.color as number;
        if (params.mode === "flashing") button.setFlashing(color, 0);
        else if (params.mode === "static") button.setStatic(color);
        else button.setPulsing(color);
      },
    },
    {
      id: "toggle",
      name: "Toggle",
      description: "Alterna entre encendido (intermitente) y el color de identificación.",
      params: [{ key: "onColor", label: "Color encendido", type: "number", min: 0, max: 127, default: 76 }],
      handle({ event, coordinate: { x, y }, binding, params, button, log }) {
        if (event !== "press") return;
        const key = `${x},${y}`;
        const on = !toggled.has(key);
        if (on) {
          toggled.add(key);
          button.setFlashing(params.onColor as number, 0);
        } else {
          toggled.delete(key);
          button.restore();
        }
        log.info(`${label(x, y, binding.name)} toggle ${on ? "ON" : "OFF"}`);
      },
    },
    {
      id: "hold",
      name: "Tiempo presionado",
      description: "Se pone verde al presionar e informa cuánto tiempo se mantuvo.",
      handle({ event, coordinate: { x, y }, binding, button, log }) {
        const key = `${x},${y}`;
        if (event === "press") {
          pressedAt.set(key, performance.now());
          button.setRGB(0, 127, 0);
          return;
        }
        const start = pressedAt.get(key);
        pressedAt.delete(key);
        button.restore();
        if (start !== undefined) {
          log.info(`${label(x, y, binding.name)} held ${Math.round(performance.now() - start)} ms`);
        }
      },
    },
    {
      id: "indicator",
      name: "Activar indicador",
      description: "Activa el indicador «Estado de prueba» en las ubicaciones asignadas.",
      params: [
        {
          key: "state",
          label: "Estado",
          type: "select",
          default: "alert",
          options: [
            { value: "ok", label: "OK" },
            { value: "busy", label: "Ocupado" },
            { value: "alert", label: "Alerta" },
          ],
        },
        {
          key: "mode",
          label: "Modo",
          type: "select",
          default: "toggle",
          options: [
            { value: "hold", label: "Mientras se presiona" },
            { value: "toggle", label: "Alternar" },
            { value: "flash", label: "Destello de 2 s" },
          ],
        },
      ],
      handle({ event, params, indicator }) {
        const status = indicator("status");
        const state = params.state as string;
        if (params.mode === "hold") {
          if (event === "press") status.set(state);
          else status.clear();
        } else if (event === "press") {
          if (params.mode === "flash") status.flash(state, 2_000);
          else if (status.current() === state) status.clear();
          else status.set(state);
        }
      },
    },
  ],
  dispose() {
    clearInterval(heartbeat);
    heartbeat = undefined;
    toggled.clear();
    pressedAt.clear();
  },
};

export default debug;
