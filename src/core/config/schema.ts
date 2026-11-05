import { z } from "astro/zod";
import { LOG_LEVELS } from "../../lib/log/shared";
import { DEFAULT_APPEARANCE } from "../appearance";
import { TEMPO_RANGE } from "../limits";

const coordinate = z.number().int().min(0).max(8);
const paletteCode = z.number().int().min(0).max(127);
const rgbComponent = z.number().int().min(0).max(127);
const logLevel = z.enum(LOG_LEVELS);

export const appearanceSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("static"), code: paletteCode }),
  z.object({ mode: z.literal("pulsing"), code: paletteCode }),
  z.object({ mode: z.literal("flashing"), code: paletteCode, code2: paletteCode }),
  z.object({ mode: z.literal("rgb"), r: rgbComponent, g: rgbComponent, b: rgbComponent }),
]);

export const actionRefSchema = z.object({
  module: z.string().min(1),
  action: z.string().min(1),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
});

export const bindingDataSchema = z.object({
  name: z.string().max(100).optional(),
  description: z.string().max(1000).optional(),
  appearance: appearanceSchema.optional(),
  action: actionRefSchema.optional(),
});

export const bindingSchema = bindingDataSchema.extend({ x: coordinate, y: coordinate });

const buttonsSchema = z.array(bindingSchema).superRefine((buttons, ctx) => {
  const seen = new Set<string>();
  buttons.forEach((button, index) => {
    const key = `${button.x},${button.y}`;
    if (seen.has(key)) ctx.addIssue({ code: "custom", message: `Duplicate button ${key}`, path: [index] });
    seen.add(key);
  });
});

export const settingsSchema = z.object({
  /** `null` lets the device use its internal 120 BPM. */
  tempo: z.number().int().min(TEMPO_RANGE.min).max(TEMPO_RANGE.max).nullable().default(null),
  brightness: z.number().int().min(0).max(127).default(127),
  idleAppearance: appearanceSchema.default(DEFAULT_APPEARANCE),
  midi: z
    .object({
      inputName: z.string().min(1).optional(),
      outputName: z.string().min(1).optional(),
      log: z.boolean().default(false),
    })
    .default({ log: false }),
  logging: z
    .object({
      /** `null` falls back to the LOG_LEVEL env var. */
      level: logLevel.nullable().default(null),
      /** Per-scope overrides; the longest matching prefix wins (e.g. `obs` covers `obs.client`). */
      scopes: z.record(z.string().min(1), logLevel).default({}),
      /** Minimum level forwarded to the browser console. */
      browserLevel: logLevel.default("warn"),
      file: z
        .object({
          enabled: z.boolean().default(true),
          retentionDays: z.number().int().min(1).max(365).default(7),
        })
        .default({ enabled: true, retentionDays: 7 }),
    })
    .default({ level: null, scopes: {}, browserLevel: "warn", file: { enabled: true, retentionDays: 7 } }),
});

export const indicatorAssignmentSchema = z.object({
  module: z.string().min(1),
  indicator: z.string().min(1),
  x: coordinate,
  y: coordinate,
  priority: z.number().int().min(-100).max(100).default(0),
  /** Per-state color overrides keyed by state id. */
  states: z.record(z.string(), appearanceSchema).default({}),
});

export const indicatorsSchema = z.array(indicatorAssignmentSchema).superRefine((list, ctx) => {
  const seen = new Set<string>();
  list.forEach((a, index) => {
    const key = `${a.module}.${a.indicator}@${a.x},${a.y}`;
    if (seen.has(key)) ctx.addIssue({ code: "custom", message: `Duplicate indicator assignment ${key}`, path: [index] });
    seen.add(key);
  });
});

export const configFileSchema = z.object({
  version: z.literal(2),
  settings: settingsSchema.default(settingsSchema.parse({})),
  buttons: buttonsSchema,
  indicators: indicatorsSchema.default([]),
  /** Per-module sections, validated against each module's own schema at load/import time. */
  modules: z.record(z.string(), z.unknown()).default({}),
});

export const legacyBindingsFileSchema = z.object({
  version: z.literal(1),
  buttons: buttonsSchema,
});

export const importSchema = z.discriminatedUnion("version", [configFileSchema, legacyBindingsFileSchema]);

export const coordinateSchema = coordinate;

export type ActionRef = z.infer<typeof actionRefSchema>;
export type BindingData = z.infer<typeof bindingDataSchema>;
export type Binding = z.infer<typeof bindingSchema>;
export type Settings = z.infer<typeof settingsSchema>;
export type IndicatorAssignment = z.infer<typeof indicatorAssignmentSchema>;
export type ConfigFile = z.infer<typeof configFileSchema>;
export type ImportFile = z.infer<typeof importSchema>;
