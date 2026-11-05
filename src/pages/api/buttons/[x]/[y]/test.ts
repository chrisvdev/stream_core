import type { APIRoute } from "astro";
import { z } from "astro/zod";
import { handleError, json, readBody, readCoordinate } from "../../../../../lib/http";

const bodySchema = z.object({ event: z.enum(["press", "release"]) });

export const POST: APIRoute = async ({ locals, params, request }) => {
  try {
    const { x, y } = readCoordinate(params);
    const { event } = await readBody(request, bodySchema);
    await locals.core.dispatcher.simulate(x, y, event);
    return json({ ok: true });
  } catch (error) {
    return handleError(error);
  }
};
