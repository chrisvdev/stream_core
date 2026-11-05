import { dtls } from "node-dtls-client";
import { createLogger } from "../../../core/logger";

const log = createLogger("hue.dtls");

export interface DtlsTarget {
  ip: string;
  /** hue-application-id */
  identity: string;
  /** clientkey as returned at pairing (hex). */
  clientKey: string;
}

/** Opens the DTLS 1.2 PSK channel the bridge expects for entertainment streaming (UDP 2100). */
export function openDtls(target: DtlsTarget, onClose: (error?: Error) => void): Promise<{ send(data: Buffer): void; close(): void }> {
  return new Promise((resolve, reject) => {
    let connected = false;
    const socket = dtls.createSocket({
      type: "udp4",
      address: target.ip,
      port: 2100,
      psk: { [target.identity]: Buffer.from(target.clientKey, "hex") },
      timeout: 5_000,
      ciphers: ["TLS_PSK_WITH_AES_128_GCM_SHA256"],
    });
    socket
      .on("connected", () => {
        connected = true;
        log.info("DTLS connected", { ip: target.ip });
        resolve({
          send: (data) => socket.send(data),
          close: () => socket.close(),
        });
      })
      .on("error", (error: Error) => {
        log.warn("DTLS error", error);
        if (!connected) reject(error);
        else onClose(error);
      })
      .on("close", () => {
        log.debug("DTLS closed");
        if (connected) onClose();
      });
  });
}
