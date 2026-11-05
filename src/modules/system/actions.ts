import type { ActionDefinition, ModuleContext } from "../../core";
import { TEMPO_RANGE } from "../../core/limits";
import type { SystemConfig } from "./config";

type Ctx = ModuleContext<SystemConfig>;

const DEFAULT_TEMPO = 120;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const modeParam = (options: { value: string; label: string }[], fallback: string) =>
  ({ key: "mode", label: "Modo", type: "select", options, default: fallback }) as const;

/** Keeps recent tap timestamps and turns them into a BPM. */
export class TapTempo {
  #taps: number[] = [];

  /** Returns the detected BPM once there are at least two taps in the current sequence. */
  tap(resetAfterMs: number, now = performance.now()): number | null {
    const last = this.#taps.at(-1);
    if (last !== undefined && now - last > resetAfterMs) this.#taps = [];
    this.#taps.push(now);
    this.#taps = this.#taps.slice(-5);
    if (this.#taps.length < 2) return null;
    const intervals = this.#taps.slice(1).map((t, i) => t - this.#taps[i]);
    const average = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    return clamp(Math.round(60_000 / average), TEMPO_RANGE.min, TEMPO_RANGE.max);
  }
}

export async function setTempo(ctx: Ctx, tempo: number) {
  const settings = ctx.app.config.getSettings();
  await ctx.app.config.updateSettings({ ...settings, tempo: clamp(Math.round(tempo), TEMPO_RANGE.min, TEMPO_RANGE.max) });
}

export async function panic(ctx: Ctx, source: string) {
  ctx.log.warn(`PANIC triggered from ${source}`);
  await ctx.app.modules.panicAll();
  ctx.app.leds.clearActions();
}

export function createActions(getCtx: () => Ctx | null, tapTempo: TapTempo): ActionDefinition[] {
  const ctx = () => {
    const c = getCtx();
    if (!c) throw new Error("Módulo sistema no iniciado");
    return c;
  };

  return [
    {
      id: "leds",
      name: "Encender/apagar LEDs",
      description: "Con los LEDs apagados los botones quedan bloqueados (configurable), salvo esta acción.",
      allowWhenLocked: true,
      params: [
        modeParam(
          [
            { value: "toggle", label: "Alternar" },
            { value: "off", label: "Apagar" },
            { value: "on", label: "Encender" },
          ],
          "toggle"
        ),
      ],
      handle({ event, params }) {
        if (event !== "press") return;
        const device = ctx().app.device;
        const sleeping = params.mode === "off" ? true : params.mode === "on" ? false : !device.status().sleeping;
        device.setSleep(sleeping);
      },
    },
    {
      id: "lock",
      name: "Bloquear botones",
      description: "Bloquea los botones sin apagar los LEDs; esta acción siempre funciona para poder desbloquear.",
      allowWhenLocked: true,
      params: [
        modeParam(
          [
            { value: "toggle", label: "Alternar" },
            { value: "lock", label: "Bloquear" },
            { value: "unlock", label: "Desbloquear" },
            { value: "hold", label: "Bloquear mientras se presiona" },
          ],
          "toggle"
        ),
      ],
      handle({ event, params }) {
        const device = ctx().app.device;
        if (params.mode === "hold") return device.setLocked(event === "press");
        if (event !== "press") return;
        const manual = device.status().lockReason === "manual";
        device.setLocked(params.mode === "lock" ? true : params.mode === "unlock" ? false : !manual);
      },
    },
    {
      id: "tap-tempo",
      name: "Tap tempo",
      description: "Toca al ritmo deseado; desde el segundo toque ajusta el tempo de pulso e intermitencia.",
      params: [{ key: "resetAfterMs", label: "Reiniciar tras (ms sin tocar)", type: "number", min: 500, max: 10_000, default: 2_000 }],
      async handle({ event, params, log }) {
        if (event !== "press") return;
        const bpm = tapTempo.tap(Number(params.resetAfterMs));
        if (bpm === null) return;
        log.debug(`Tap tempo: ${bpm} BPM`);
        await setTempo(ctx(), bpm);
      },
    },
    {
      id: "tempo-step",
      name: "Tempo +/−",
      params: [{ key: "delta", label: "Cambio en BPM", type: "number", min: -50, max: 50, default: 5 }],
      async handle({ event, params }) {
        if (event !== "press") return;
        const current = ctx().app.config.getSettings().tempo ?? DEFAULT_TEMPO;
        await setTempo(ctx(), current + Number(params.delta));
      },
    },
    {
      id: "brightness-step",
      name: "Brillo +/−",
      params: [{ key: "delta", label: "Cambio (0–127)", type: "number", min: -127, max: 127, default: 16 }],
      async handle({ event, params }) {
        if (event !== "press") return;
        const settings = ctx().app.config.getSettings();
        await ctx().app.config.updateSettings({
          ...settings,
          brightness: clamp(settings.brightness + Number(params.delta), 0, 127),
        });
      },
    },
    {
      id: "reset-leds",
      name: "Restablecer LEDs",
      description: "Quita los colores temporales que pusieron las acciones.",
      handle({ event }) {
        if (event === "press") ctx().app.leds.clearActions();
      },
    },
    {
      id: "mark",
      name: "Marca en el log",
      description: "Escribe una marca visible en /admin/logs para ubicar un momento al depurar.",
      params: [{ key: "label", label: "Texto", type: "string", default: "" }],
      handle({ event, params, coordinate, log }) {
        if (event !== "press") return;
        log.info(`──── MARCA: ${params.label || `botón (${coordinate.x},${coordinate.y})`} ────`);
      },
    },
    {
      id: "panic",
      name: "Pánico (detener todo)",
      description: "Corta efectos, streaming de Hue y colores temporales de las acciones.",
      allowWhenLocked: true,
      async handle({ event, coordinate }) {
        if (event !== "press") return;
        await panic(ctx(), `button (${coordinate.x},${coordinate.y})`);
      },
    },
  ];
}
