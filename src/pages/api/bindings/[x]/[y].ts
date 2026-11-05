import type { APIRoute } from "astro";
import { bindingDataSchema } from "../../../../core/config/schema";
import { badRequest, handleError, json, readBody, readCoordinate } from "../../../../lib/http";

export const PUT: APIRoute = async ({ locals, params, request }) => {
  try {
    const { x, y } = readCoordinate(params);
    const data = await readBody(request, bindingDataSchema);
    const { modules, config } = locals.core;

    if (data.action) {
      const action = modules.resolve(data.action.module, data.action.action);
      if (!action) return badRequest(`Unknown action ${data.action.module}.${data.action.action}`);
      const result = modules.validateParams(action, data.action.params);
      if (!result.ok) return badRequest(result.errors);
      data.action.params = result.params;
    }

    return json(await config.upsert(x, y, data));
  } catch (error) {
    return handleError(error);
  }
};

export const DELETE: APIRoute = async ({ locals, params }) => {
  try {
    const { x, y } = readCoordinate(params);
    await locals.core.config.remove(x, y);
    return new Response(null, { status: 204 });
  } catch (error) {
    return handleError(error);
  }
};
