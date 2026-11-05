import { request } from "undici";
import { createLogger } from "../../core/logger";
import type { HueClient } from "./client";

const log = createLogger("hue.events");

export interface HueEvent {
  type: "update" | "add" | "delete" | "error";
  data: { id: string; type: string; [key: string]: unknown }[];
}

export interface EventStreamHandle {
  close(): void;
}

/**
 * Keeps `/eventstream/clip/v2` open, reconnecting with backoff. `onOpen` fires on every (re)connect
 * so the caller can resync anything missed while disconnected.
 */
export function openEventStream(
  client: HueClient,
  handlers: { onEvents(events: HueEvent[]): void; onOpen(): void; onDown(error: unknown): void }
): EventStreamHandle {
  let closed = false;
  let abort: AbortController | null = null;
  let retryMs = 1_000;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const connect = async () => {
    if (closed) return;
    abort = new AbortController();
    try {
      const response = await request(`https://${client.ip}/eventstream/clip/v2`, {
        method: "GET",
        dispatcher: client.dispatcher,
        headers: { "hue-application-key": client.appKey, accept: "text/event-stream" },
        signal: abort.signal,
        headersTimeout: 10_000,
        // The stream is long-lived; the bridge sends a keep-alive comment roughly every minute.
        bodyTimeout: 0,
      });
      if (response.statusCode !== 200) {
        await response.body.dump();
        throw new Error(`eventstream HTTP ${response.statusCode}`);
      }
      log.info("Event stream connected");
      retryMs = 1_000;
      handlers.onOpen();

      let buffer = "";
      let data = "";
      for await (const chunk of response.body) {
        buffer += chunk.toString("utf8");
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline).replace(/\r$/, "");
          buffer = buffer.slice(newline + 1);
          if (line === "") {
            if (data) dispatch(data);
            data = "";
          } else if (line.startsWith("data:")) {
            data += line.slice(5).trimStart();
          }
        }
      }
      throw new Error("eventstream ended");
    } catch (error) {
      if (closed) return;
      log.warn(`Event stream down; retrying in ${retryMs} ms`, error);
      handlers.onDown(error);
      timer = setTimeout(connect, retryMs);
      retryMs = Math.min(retryMs * 2, 30_000);
    }
  };

  const dispatch = (raw: string) => {
    try {
      const events = JSON.parse(raw) as HueEvent[];
      log.trace(`${events.length} event(s)`, events);
      handlers.onEvents(events);
    } catch (error) {
      log.warn("Malformed eventstream payload", error, { raw: raw.slice(0, 500) });
    }
  };

  void connect();

  return {
    close() {
      closed = true;
      clearTimeout(timer);
      abort?.abort();
    },
  };
}
