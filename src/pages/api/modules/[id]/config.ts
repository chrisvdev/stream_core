import type { APIRoute } from "astro";
import { z } from "astro/zod";
import { badRequest, handleError, json, readBody } from "../../../../lib/http";

const notFound = (id: string) => json({ errors: [`Module "${id}" has no configuration`] }, 404);

export const GET: APIRoute = ({ locals, params }) => {
  const id = params.id ?? "";
  if (!locals.core.modules.hasConfig(id)) return notFound(id);
  return json(locals.core.config.getMaskedModuleConfig(id));
};

export const PUT: APIRoute = async ({ locals, params, request }) => {
  try {
    const id = params.id ?? "";
    if (!locals.core.modules.hasConfig(id)) return notFound(id);
    const raw = await readBody(request, z.record(z.string(), z.unknown()));
    const result = await locals.core.config.setModuleConfig(id, raw);
    if (!result.ok) return badRequest(result.errors);
    return json(locals.core.config.getMaskedModuleConfig(id));
  } catch (error) {
    return handleError(error);
  }
};
