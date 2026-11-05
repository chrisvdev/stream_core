import type { APIRoute } from "astro";
import easymidi from "easymidi";
import { json } from "../../../lib/http";

export const GET: APIRoute = () => json({ inputs: easymidi.getInputs(), outputs: easymidi.getOutputs() });
