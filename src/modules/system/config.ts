import { z } from "astro/zod";
import type { Appearance } from "../../core/appearance";
import { appearanceSchema } from "../../core/config/schema";

export const DEFAULT_PORT = 4321;
export const DEFAULT_HOST = "127.0.0.1";
// Low-bank getColor(1, 1, 1): the dimmest palette white.
const DIM_WHITE: Appearance = { mode: "static", code: 21 };

export const systemConfigSchema = z.object({
  server: z
    .object({
      port: z.number().int().min(1).max(65_535).default(DEFAULT_PORT),
      host: z.string().min(1).default(DEFAULT_HOST),
    })
    .default({ port: DEFAULT_PORT, host: DEFAULT_HOST }),
  lock: z
    .object({
      /** Turning the LEDs off also locks the buttons (except actions allowed while locked). */
      whenAsleep: z.boolean().default(true),
    })
    .default({ whenAsleep: true }),
  sleep: z
    .object({
      mode: z.enum(["blackout", "hardware"]).default("blackout"),
      /** Keep the buttons that turn the LEDs back on (and unlock) dimly lit while off. */
      showWakeButton: z.boolean().default(true),
      wakeAppearance: appearanceSchema.default(DIM_WHITE),
    })
    .default({ mode: "blackout", showWakeButton: true, wakeAppearance: DIM_WHITE }),
});

export type SystemConfig = z.infer<typeof systemConfigSchema>;
