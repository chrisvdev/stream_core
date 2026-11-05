import type { APIRoute } from "astro";

export const GET: APIRoute = ({ locals }) =>
  new Response(JSON.stringify(locals.core.config.toFile({ redactSecrets: true }), null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": 'attachment; filename="config.json"',
    },
  });
