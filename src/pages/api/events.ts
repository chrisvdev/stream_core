import type { APIRoute } from "astro";
import type { CoreEventName } from "../../core";
import { createLogger } from "../../core";

// A Record keyed by every event name makes the compiler flag any event not forwarded here.
const FORWARDED: Record<CoreEventName, true> = {
  button: true,
  appearance: true,
  bindings: true,
  settings: true,
  device: true,
  indicator: true,
  "indicators-config": true,
  catalog: true,
  "module-config": true,
  "module-status": true,
  "panel-clients": true,
  log: true,
  "action-error": true,
};
const EVENTS = Object.keys(FORWARDED) as CoreEventName[];
const log = createLogger("api.events");
const HEARTBEAT_MS = 10_000;
// One tab should hold a single stream; more than this usually means connections aren't being released.
const CLIENT_WARNING = 3;
// Bytes queued for a client that stopped reading (e.g. a half-closed socket).
const MAX_BACKLOG = 64 * 1024;
let clients = 0;

export const GET: APIRoute = ({ locals, request }) => {
  const { events } = locals.core;
  const { requestId } = locals;
  const encoder = new TextEncoder();
  const cleanup: (() => void)[] = [];
  let finished = false;
  const finish = (reason: string) => {
    for (const fn of cleanup.splice(0)) fn();
    if (finished) return;
    finished = true;
    clients--;
    log.debug(`Client ${reason}`, { requestId, clients });
    events.emit("panel-clients", { count: clients });
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          close();
        }
      };
      const close = () => {
        finish("disconnected");
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      clients++;
      if (clients > CLIENT_WARNING) {
        log.warn(`${clients} live event streams open; a browser only allows ~6 connections per host`, { requestId });
      } else {
        log.debug("Client connected", { requestId, clients });
      }

      if (request.signal.aborted) {
        close();
        return;
      }
      for (const name of EVENTS) {
        cleanup.push(events.on(name, (payload) => send(`event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`)));
      }
      events.emit("panel-clients", { count: clients });
      const heartbeat = setInterval(() => {
        if ((controller.desiredSize ?? 0) < -MAX_BACKLOG) {
          log.debug("Dropping client that stopped reading", { requestId, backlog: -(controller.desiredSize ?? 0) });
          close();
          return;
        }
        send(": ping\n\n");
      }, HEARTBEAT_MS);
      cleanup.push(() => clearInterval(heartbeat));
      request.signal.addEventListener("abort", close, { once: true });
      send("retry: 3000\n: connected\n\n");
    },
    cancel() {
      finish("cancelled the stream");
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
};
