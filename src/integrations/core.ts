import type { AstroIntegration } from "astro";
import { readdirSync } from "node:fs";
import { bootstrap, createLogger, installProcessHandlers, shutdown } from "../core";
import { reportBoundServer } from "../modules/system";

const log = createLogger("astro");

// The core context lives on globalThis and survives HMR, so its code needs a full dev-server restart.
const RESTART_DIRS = ["src/core", "src/modules"];

export default function core(): AstroIntegration {
  return {
    name: "stream-core",
    hooks: {
      "astro:config:setup": ({ command, config, addWatchFile }) => {
        if (command !== "dev") return;
        for (const dir of RESTART_DIRS) {
          const root = new URL(`${dir}/`, config.root);
          for (const file of readdirSync(root, { recursive: true, encoding: "utf8" })) {
            if (/\.(ts|js|mjs)$/.test(file)) addWatchFile(new URL(file.replaceAll("\\", "/"), root));
          }
        }
      },
      "astro:server:setup": async () => {
        installProcessHandlers();
        // Astro restarts in-process, so drop any context built by previous code before booting.
        await shutdown();
        try {
          await bootstrap();
        } catch (error) {
          log.error("Bootstrap failed; the admin panel will not work until this is fixed", error);
          throw error;
        }
      },
      "astro:server:start": ({ address }) => {
        reportBoundServer({ port: address.port, host: address.address });
      },
      "astro:server:done": async () => {
        await shutdown();
      },
    },
  };
}
