import { Bonjour } from "bonjour-service";
import { createLogger } from "../../core/logger";

const log = createLogger("hue.discovery");

export interface DiscoveredBridge {
  id: string;
  ip: string;
  name?: string;
  source: "cloud" | "mdns";
}

async function cloud(): Promise<DiscoveredBridge[]> {
  try {
    const response = await fetch("https://discovery.meethue.com", { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const list = (await response.json()) as { id: string; internalipaddress: string }[];
    return list.map((b) => ({ id: b.id.toLowerCase(), ip: b.internalipaddress, source: "cloud" }));
  } catch (error) {
    // The cloud endpoint is rate limited and needs internet; mDNS covers the offline case.
    log.debug("Cloud discovery failed", error);
    return [];
  }
}

function mdns(timeoutMs: number): Promise<DiscoveredBridge[]> {
  return new Promise((resolve) => {
    const found: DiscoveredBridge[] = [];
    let bonjour: Bonjour;
    try {
      bonjour = new Bonjour();
    } catch (error) {
      log.debug("mDNS unavailable", error);
      resolve([]);
      return;
    }
    const browser = bonjour.find({ type: "hue" }, (service) => {
      const ip = service.addresses?.find((a) => a.includes(".")) ?? service.referer?.address;
      const id = String(service.txt?.bridgeid ?? service.name ?? "").toLowerCase();
      if (ip && id) found.push({ id, ip, name: service.name, source: "mdns" });
    });
    setTimeout(() => {
      browser.stop();
      bonjour.destroy();
      resolve(found);
    }, timeoutMs);
  });
}

export async function discoverBridges(timeoutMs = 4_000): Promise<DiscoveredBridge[]> {
  const [fromCloud, fromMdns] = await Promise.all([cloud(), mdns(timeoutMs)]);
  const byId = new Map<string, DiscoveredBridge>();
  for (const bridge of [...fromMdns, ...fromCloud]) if (!byId.has(bridge.id)) byId.set(bridge.id, bridge);
  const result = [...byId.values()];
  log.info(`Discovered ${result.length} bridge(s)`, result);
  return result;
}
