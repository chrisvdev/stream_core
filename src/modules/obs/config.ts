import { z } from "astro/zod";

export const obsConfigSchema = z.object({
  url: z
    .string()
    .regex(/^wss?:\/\/.+/, "Debe empezar con ws:// o wss://")
    .default("ws://127.0.0.1:4455"),
  password: z.string().optional(),
  autoConnect: z.boolean().default(true),
  reconnectMs: z.number().int().min(1_000).max(60_000).default(5_000),
});

export type ObsConfig = z.infer<typeof obsConfigSchema>;
