import { hostname } from "node:os";
import { request, type Dispatcher } from "undici";
import { createLogger } from "../../core/logger";
import { createDispatcher, HueError } from "./client";

const log = createLogger("hue.pairing");

export interface PairingResult {
  appKey: string;
  clientKey: string;
  applicationId: string;
  fingerprint: string;
  bridgeId: string;
}

export interface PairingProgress {
  state: "waiting" | "done" | "failed" | "cancelled";
  remainingMs: number;
  message?: string;
}

const LINK_BUTTON_NOT_PRESSED = 101;

/**
 * Polls the bridge until its link button is pressed (Hue requires it to grant a new app key).
 * `signal` cancels the wait.
 */
export async function pairBridge(
  ip: string,
  { timeoutMs = 30_000, intervalMs = 2_000, signal, onProgress }: {
    timeoutMs?: number;
    intervalMs?: number;
    signal?: AbortSignal;
    onProgress?(progress: PairingProgress): void;
  } = {}
): Promise<PairingResult> {
  let fingerprint = "";
  let cn = "";
  const dispatcher = createDispatcher({ ip }, (fp, commonName) => {
    fingerprint = fp;
    cn = commonName;
  });
  const deadline = Date.now() + timeoutMs;
  const devicetype = `stream_core#${hostname().slice(0, 19)}`;
  log.info("Waiting for the bridge link button", { ip, timeoutMs });

  try {
    while (Date.now() < deadline) {
      if (signal?.aborted) {
        onProgress?.({ state: "cancelled", remainingMs: 0 });
        throw new HueError("Emparejamiento cancelado");
      }
      onProgress?.({ state: "waiting", remainingMs: deadline - Date.now() });

      const response = await request(`https://${ip}/api`, {
        method: "POST",
        dispatcher,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ devicetype, generateclientkey: true }),
        headersTimeout: 5_000,
        bodyTimeout: 5_000,
      });
      const result = (await response.body.json()) as {
        success?: { username: string; clientkey: string };
        error?: { type: number; description: string };
      }[];
      const success = result[0]?.success;
      if (success) {
        const applicationId = await fetchApplicationId(ip, success.username, dispatcher);
        log.info("Paired with bridge", { ip, bridgeId: cn });
        onProgress?.({ state: "done", remainingMs: 0 });
        return { appKey: success.username, clientKey: success.clientkey, applicationId, fingerprint, bridgeId: cn };
      }
      const error = result[0]?.error;
      if (error && error.type !== LINK_BUTTON_NOT_PRESSED) throw new HueError(error.description, undefined, error.type);

      await new Promise((r) => setTimeout(r, intervalMs));
    }
    onProgress?.({ state: "failed", remainingMs: 0, message: "No se presionó el botón del bridge a tiempo" });
    throw new HueError("No se presionó el botón del bridge a tiempo (30 s)");
  } catch (error) {
    if (!(error instanceof HueError && error.message === "Emparejamiento cancelado")) {
      onProgress?.({ state: "failed", remainingMs: 0, message: error instanceof Error ? error.message : String(error) });
    }
    throw error;
  } finally {
    await dispatcher.close().catch(() => undefined);
  }
}

/** The DTLS identity for entertainment is the application id, only exposed as a response header. */
async function fetchApplicationId(ip: string, appKey: string, dispatcher: Dispatcher) {
  const response = await request(`https://${ip}/auth/v1`, {
    method: "GET",
    dispatcher,
    headers: { "hue-application-key": appKey },
    headersTimeout: 5_000,
  });
  await response.body.dump();
  const id = response.headers["hue-application-id"];
  if (typeof id !== "string" || !id) throw new HueError("El bridge no devolvió hue-application-id");
  return id;
}
