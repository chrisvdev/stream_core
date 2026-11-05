import express, { type RequestHandler } from "express";
import { fileURLToPath } from "node:url";
import { bootstrap, createLogger, installProcessHandlers, logManager, shutdown } from "../src/core";
import type { SystemConfig } from "../src/modules/system/config";
import { reportBoundServer, resolveServerAddress } from "../src/modules/system";

const log = createLogger("server");
installProcessHandlers();

const dist = new URL("../dist/", import.meta.url);

let systemConfig: SystemConfig | undefined;
try {
  const context = await bootstrap();
  systemConfig = context.config.getModuleConfig<SystemConfig>("system");
} catch (error) {
  log.error("Startup failed", error);
  logManager.close();
  process.exit(1);
}

// PORT/HOST env vars win over the panel setting; the panel has no auth, so the default host is local only.
const { port: PORT, host: HOST, source } = resolveServerAddress(systemConfig);

// Built by `astro build`; resolved at runtime because it doesn't exist until then.
const { handler } = (await import(new URL("server/entry.mjs", dist).href)) as {
  handler: RequestHandler;
};

const app = express();
app.use(express.static(fileURLToPath(new URL("client/", dist))));
app.use(handler);

const server = app.listen(PORT, HOST, () => {
  reportBoundServer({ port: PORT, host: HOST });
  log.info(`Listening on http://${HOST}:${PORT}`, source);
});
server.on("error", (error) => {
  log.error(`Could not listen on ${HOST}:${PORT}`, error);
});

let closing = false;
async function close(signal: string) {
  if (closing) return;
  closing = true;
  log.info(`Received ${signal}, closing`);
  server.close();
  try {
    await shutdown();
  } catch (error) {
    log.error("Shutdown failed", error);
  }
  logManager.close();
  process.exit(0);
}

process.on("SIGINT", close);
process.on("SIGTERM", close);
