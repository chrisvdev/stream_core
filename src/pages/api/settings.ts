import type { APIRoute } from "astro";
import { settingsSchema } from "../../core/config/schema";
import { handleError, json, readBody } from "../../lib/http";

export const GET: APIRoute = ({ locals }) => json(locals.core.config.getSettings());

export const PUT: APIRoute = async ({ locals, request }) => {
  try {
    const settings = await readBody(request, settingsSchema);
    const changed = await locals.core.config.updateSettings(settings);
    return json({ settings, restartRequired: changed.includes("midi") });
  } catch (error) {
    return handleError(error);
  }
};
