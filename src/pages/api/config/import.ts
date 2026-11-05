import type { APIRoute } from "astro";
import { importSchema } from "../../../core/config/schema";
import { badRequest, handleError, json, readBody } from "../../../lib/http";

export const POST: APIRoute = async ({ locals, request }) => {
  try {
    const file = await readBody(request, importSchema);
    const errors = await locals.core.config.replaceAll(file);
    if (errors.length) return badRequest(errors);
    return json({ ok: true });
  } catch (error) {
    return handleError(error);
  }
};
