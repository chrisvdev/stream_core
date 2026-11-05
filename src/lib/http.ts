import type { APIContext } from "astro";
import type { z } from "astro/zod";
import { coordinateSchema } from "../core/config/schema";

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export const badRequest = (errors: string[] | string) =>
  json({ errors: Array.isArray(errors) ? errors : [errors] }, 400);

export class HttpError extends Error {
  constructor(readonly response: Response) {
    super(`HTTP ${response.status}`);
  }
}

// Requiring JSON keeps cross-site form posts from reaching mutating endpoints.
export async function readBody<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T>> {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    throw new HttpError(json({ errors: ["Content-Type must be application/json"] }, 415));
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(badRequest("Invalid JSON"));
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new HttpError(
      badRequest(result.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`))
    );
  }
  return result.data;
}

export function readCoordinate(params: APIContext["params"]) {
  const x = coordinateSchema.safeParse(Number(params.x));
  const y = coordinateSchema.safeParse(Number(params.y));
  if (!x.success || !y.success) throw new HttpError(badRequest("Invalid coordinate"));
  return { x: x.data, y: y.data };
}

export function handleError(error: unknown) {
  if (error instanceof HttpError) return error.response;
  throw error;
}
