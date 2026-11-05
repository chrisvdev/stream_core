import type { APIRoute } from "astro";
import { z } from "astro/zod";
import { handleError, json, readBody } from "../../../../../lib/http";

export const POST: APIRoute = async ({ locals, params, request }) => {
  let input: unknown;
  try {
    input = await readBody(request, z.unknown());
  } catch (error) {
    return handleError(error);
  }

  try {
    const result = await locals.core.modules.runCommand(params.id ?? "", params.name ?? "", input);
    if (!result.ok) return json({ errors: [result.error] }, 404);
    return json({ result: result.result ?? null });
  } catch (error) {
    return json({ errors: [error instanceof Error ? error.message : String(error)] }, 500);
  }
};
