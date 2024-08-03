export const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID ?? ("" as string);
export const TWITCH_CLIENT_SECRET =
  process.env.TWITCH_CLIENT_SECRET ?? ("" as string);
export const HTTP_PORT = Number(process.env.HTTP_PORT ?? 3000);
export const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
export const REDIRECT_PATH = process.env.REDIRECT_PATH ?? "/twitch/user_token";
export const SCOPES = ["user:bot", "channel:bot", "user:read:chat"]; // scopes necesarios para las funciones implementadas
