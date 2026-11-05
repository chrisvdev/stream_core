import { z } from "astro/zod";

const coordinate = z.string().regex(/^[0-8],[0-8]$/, "Debe ser una coordenada x,y entre 0 y 8");

export const hueConfigSchema = z.object({
  bridgeIp: z.string().optional(),
  bridgeId: z.string().optional(),
  appKey: z.string().optional(),
  clientKey: z.string().optional(),
  /** `hue-application-id`; the PSK identity for entertainment streaming. */
  applicationId: z.string().optional(),
  /** SHA-256 fingerprint of the bridge certificate, pinned at pairing time (trust on first use). */
  certFingerprint: z.string().optional(),
  autoConnect: z.boolean().default(true),
  reconnectMs: z.number().int().min(1_000).max(60_000).default(5_000),
  entertainment: z
    .object({
      /** Hue recommends ~50 Hz: the bridge renders at 25 Hz and UDP frames may be dropped. */
      fps: z.number().int().min(10).max(60).default(50),
      /** Per entertainment area: Launchpad coordinate mirrored on each channel id. */
      mirror: z
        .record(
          z.string(),
          z.object({
            enabled: z.boolean().default(false),
            channels: z.record(z.string(), coordinate).default({}),
          })
        )
        .default({}),
    })
    .default({ fps: 50, mirror: {} }),
});

export type HueConfig = z.infer<typeof hueConfigSchema>;
