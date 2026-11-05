import type { APIRoute } from "astro";
import { indicatorsSchema } from "../../../core/config/schema";
import { badRequest, handleError, json, readBody } from "../../../lib/http";

export const GET: APIRoute = ({ locals }) =>
  json({ assignments: locals.core.config.listIndicators(), active: locals.core.indicators.active() });

export const PUT: APIRoute = async ({ locals, request }) => {
  try {
    const assignments = await readBody(request, indicatorsSchema);
    const { modules, config } = locals.core;

    const errors: string[] = [];
    for (const a of assignments) {
      const module = modules.get(a.module);
      if (!module) {
        errors.push(`Unknown module ${a.module}`);
        continue;
      }
      const definition = modules.resolveIndicator(a.module, a.indicator);
      if (!definition) {
        // Dynamic indicators may be temporarily missing (e.g. OBS offline), so keep those assignments.
        if (typeof module.indicators !== "function") errors.push(`Unknown indicator ${a.module}.${a.indicator}`);
        continue;
      }
      for (const stateId of Object.keys(a.states)) {
        if (!definition.states.some((s) => s.id === stateId)) {
          errors.push(`Unknown state "${stateId}" for ${a.module}.${a.indicator}`);
        }
      }
    }
    if (errors.length) return badRequest(errors);

    await config.replaceIndicators(assignments);
    return json({ assignments, active: locals.core.indicators.active() });
  } catch (error) {
    return handleError(error);
  }
};
