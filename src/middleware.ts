import { defineMiddleware } from "astro:middleware";
import { createLogger, getContext } from "./core";

const log = createLogger("http");
const SLOW_MS = 1000;

const errorJson = (status: number, message: string, requestId: string) =>
  new Response(JSON.stringify({ errors: [message], requestId }), {
    status,
    headers: { "Content-Type": "application/json", "x-request-id": requestId },
  });

export const onRequest = defineMiddleware(async (context, next) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  const { method } = context.request;
  const path = context.url.pathname;
  const isApi = path.startsWith("/api/");
  const isStream = path === "/api/events";
  const started = performance.now();
  context.locals.requestId = requestId;

  try {
    context.locals.core = getContext();
  } catch (error) {
    log.error(`${method} ${path}: core not available`, error, { requestId });
    if (isApi) return errorJson(503, "El núcleo no está iniciado; revisa el log del servidor", requestId);
    throw error;
  }

  let response: Response;
  try {
    response = await next();
  } catch (error) {
    log.error(`${method} ${path} threw`, error, { requestId });
    if (isApi) {
      return errorJson(500, error instanceof Error ? error.message : String(error), requestId);
    }
    throw error;
  }

  try {
    response.headers.set("x-request-id", requestId);
  } catch {
    // Some responses (e.g. redirects) have immutable headers.
  }
  const ms = Math.round(performance.now() - started);
  const line = `${method} ${path} ${response.status} ${ms}ms`;
  if (isStream) log.trace(`${line} (stream opened)`, { requestId });
  else if (response.status >= 500) log.error(line, { requestId });
  else if (response.status >= 400) log.warn(line, { requestId });
  else if (ms > SLOW_MS) log.warn(`${line} (slow)`, { requestId });
  else log.debug(line, { requestId });
  return response;
});
