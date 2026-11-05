import type { APIRoute } from "astro";
import { json } from "../../../../lib/http";

export const GET: APIRoute = ({ locals, params }) => {
  const id = params.id ?? "";
  if (!locals.core.modules.get(id)) return json({ errors: [`Unknown module "${id}"`] }, 404);
  return json({ status: locals.core.modules.status(id) ?? null });
};
