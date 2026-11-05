import type { APIRoute } from "astro";
import { z } from "astro/zod";
import { badRequest, handleError, json, readBody } from "../../../lib/http";

const bodySchema = z.object({
  module: z.string().min(1),
  indicator: z.string().min(1),
  state: z.string().min(1).nullable(),
});

export const POST: APIRoute = async ({ locals, request }) => {
  try {
    const { module, indicator, state } = await readBody(request, bodySchema);
    const { indicators, modules } = locals.core;
    const definition = modules.resolveIndicator(module, indicator);
    if (!definition) return badRequest(`Unknown indicator ${module}.${indicator}`);
    if (state !== null && !definition.states.some((s) => s.id === state)) {
      return badRequest(`Unknown state "${state}"`);
    }
    indicators.set(module, indicator, state);
    return json(indicators.active());
  } catch (error) {
    return handleError(error);
  }
};
