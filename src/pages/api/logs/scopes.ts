import type { APIRoute } from "astro";
import { logManager } from "../../../core";
import { json } from "../../../lib/http";

export const GET: APIRoute = () =>
  json({
    scopes: logManager.knownScopes(),
    dir: logManager.dir,
    effectiveLevel: logManager.baseLevel,
    envLevel: process.env.LOG_LEVEL ?? null,
  });
