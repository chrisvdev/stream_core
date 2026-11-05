import type { APIRoute } from "astro";
import { z } from "astro/zod";
import { handleError, json, readBody } from "../../lib/http";

const bodySchema = z.object({ sleep: z.boolean() });

export const GET: APIRoute = ({ locals }) => json(locals.core.device.status());

export const POST: APIRoute = async ({ locals, request }) => {
  try {
    const { sleep } = await readBody(request, bodySchema);
    locals.core.device.setSleep(sleep);
    return json(locals.core.device.status());
  } catch (error) {
    return handleError(error);
  }
};
