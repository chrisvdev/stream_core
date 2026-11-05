import type { APIRoute } from "astro";
import { logManager } from "../../../core";
import { isLogLevel } from "../../../lib/log/shared";
import { json } from "../../../lib/http";

export const GET: APIRoute = ({ url }) => {
  const level = url.searchParams.get("level");
  const scope = url.searchParams.get("scope") || undefined;
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 300, 1), 1000);
  return json(logManager.recent({ level: isLogLevel(level) ? level : undefined, scope, limit }));
};
