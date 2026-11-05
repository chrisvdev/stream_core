// @ts-check
import { defineConfig } from 'astro/config';
import { readFileSync } from 'node:fs';

import node from '@astrojs/node';
import core from './src/integrations/core.ts';

import preact from '@astrojs/preact';

/** Dev server address from the system module config (panel → Sistema); PORT/HOST env vars win. */
function serverAddress() {
  /** @type {{ port?: number; host?: string }} */
  let saved = {};
  try {
    const file = JSON.parse(readFileSync(process.env.CONFIG_FILE ?? 'data/config.json', 'utf8'));
    saved = file?.modules?.system?.server ?? {};
  } catch {
    // Missing or invalid config: fall back to defaults; the app reports the real error at startup.
  }
  const envPort = Number(process.env.PORT);
  return {
    port: Number.isInteger(envPort) && envPort > 0 ? envPort : (saved.port ?? 4321),
    host: process.env.HOST || saved.host || '127.0.0.1',
  };
}

// https://astro.build/config
export default defineConfig({
  // The Launchpad only exists at runtime, so pages can't be prerendered.
  output: 'server',
  server: serverAddress(),
  integrations: [core(), preact()],
  adapter: node({
    mode: 'middleware'
  })
});