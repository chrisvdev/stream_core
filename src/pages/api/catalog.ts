import type { APIRoute } from "astro";
import { json } from "../../lib/http";

export const GET: APIRoute = ({ locals }) => json(locals.core.modules.catalog());
