import type { HueEvent } from "./eventstream";

/** CLIP v2 resources are large and versioned; we only rely on the fields read below. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Resource = { id: string; type: string; [key: string]: any };

export type Gamut = { red: XY; green: XY; blue: XY };
export type XY = { x: number; y: number };

export interface HueLight {
  id: string;
  name: string;
  on: boolean;
  reachable: boolean;
  deviceId: string | null;
  gamut: Gamut | null;
  supportsColor: boolean;
  supportsColorTemp: boolean;
  effects: string[];
}

export interface HueGroup {
  /** room/zone id, or "home" for every light. */
  id: string;
  kind: "room" | "zone" | "home";
  name: string;
  groupedLightId: string | null;
  on: boolean;
}

export interface HueScene {
  id: string;
  name: string;
  groupId: string | null;
  groupName: string;
  active: "inactive" | "static" | "dynamic_palette";
}

export interface HueSmartScene {
  id: string;
  name: string;
  groupName: string;
  active: boolean;
}

export interface HueArea {
  id: string;
  name: string;
  active: boolean;
  /** auth id (application id) of whoever is streaming, if any. */
  streamer: string | null;
  channels: { id: number; position: { x: number; y: number; z: number } }[];
}

export interface HueDevice {
  id: string;
  name: string;
  connected: boolean;
}

// Updates to these fields change names/structure, so actions and indicator lists must be rebuilt.
const STRUCTURAL_KEYS = ["metadata", "children", "services", "group", "channels", "locations"];

function merge(target: Resource, patch: Record<string, unknown>) {
  for (const [key, value] of Object.entries(patch)) {
    const current = target[key];
    if (value && typeof value === "object" && !Array.isArray(value) && current && typeof current === "object" && !Array.isArray(current)) {
      merge(current as Resource, value as Record<string, unknown>);
    } else {
      target[key] = value;
    }
  }
}

const nameOf = (r: Resource | undefined, fallback = "?") => String(r?.metadata?.name ?? r?.name ?? fallback);

export class HueState {
  #byId = new Map<string, Resource>();

  load(resources: Resource[]) {
    this.#byId = new Map(resources.map((r) => [r.id, r]));
  }

  get size() {
    return this.#byId.size;
  }

  get(id: string | undefined | null): Resource | undefined {
    return id ? this.#byId.get(id) : undefined;
  }

  ofType(type: string): Resource[] {
    return [...this.#byId.values()].filter((r) => r.type === type);
  }

  apply(events: HueEvent[]): { catalog: boolean; state: boolean } {
    let catalog = false;
    let state = false;
    for (const event of events) {
      for (const item of event.data ?? []) {
        if (event.type === "add") {
          this.#byId.set(item.id, item as Resource);
          catalog = true;
        } else if (event.type === "delete") {
          catalog = this.#byId.delete(item.id) || catalog;
        } else if (event.type === "update") {
          const current = this.#byId.get(item.id);
          if (!current) continue;
          merge(current, item);
          if (STRUCTURAL_KEYS.some((k) => k in item)) catalog = true;
          else state = true;
        }
      }
    }
    return { catalog, state: state || catalog };
  }

  #serviceOf(owner: Resource | undefined, rtype: string): string | null {
    return owner?.services?.find((s: { rtype: string; rid: string }) => s.rtype === rtype)?.rid ?? null;
  }

  #deviceConnected(deviceId: string | null): boolean {
    const device = this.get(deviceId);
    const connectivity = this.get(this.#serviceOf(device, "zigbee_connectivity"));
    // Devices without zigbee connectivity (e.g. the bridge itself) count as connected.
    return !connectivity || connectivity.status === "connected";
  }

  lights(): HueLight[] {
    return this.ofType("light")
      .map((l) => {
        const deviceId = l.owner?.rtype === "device" ? (l.owner.rid as string) : null;
        return {
          id: l.id,
          name: nameOf(l, nameOf(this.get(deviceId))),
          on: Boolean(l.on?.on),
          reachable: this.#deviceConnected(deviceId),
          deviceId,
          gamut: (l.color?.gamut as Gamut | undefined) ?? null,
          supportsColor: Boolean(l.color),
          supportsColorTemp: Boolean(l.color_temperature),
          effects: ((l.effects?.effect_values ?? l.effects_v2?.action?.effect_values ?? []) as string[]).filter(
            (e) => e !== "no_effect"
          ),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  groups(): HueGroup[] {
    const groupedOn = (id: string | null) => Boolean(this.get(id)?.on?.on);
    const groups: HueGroup[] = [];
    for (const kind of ["room", "zone"] as const) {
      for (const r of this.ofType(kind)) {
        const groupedLightId = this.#serviceOf(r, "grouped_light");
        groups.push({ id: r.id, kind, name: nameOf(r), groupedLightId, on: groupedOn(groupedLightId) });
      }
    }
    const home = this.ofType("bridge_home")[0];
    const homeGrouped = this.#serviceOf(home, "grouped_light");
    if (homeGrouped) groups.push({ id: "home", kind: "home", name: "Toda la casa", groupedLightId: homeGrouped, on: groupedOn(homeGrouped) });
    return groups.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  }

  scenes(): HueScene[] {
    return this.ofType("scene")
      .map((s) => ({
        id: s.id,
        name: nameOf(s),
        groupId: (s.group?.rid as string) ?? null,
        groupName: nameOf(this.get(s.group?.rid)),
        active: (s.status?.active ?? "inactive") as HueScene["active"],
      }))
      .sort((a, b) => a.groupName.localeCompare(b.groupName) || a.name.localeCompare(b.name));
  }

  smartScenes(): HueSmartScene[] {
    return this.ofType("smart_scene")
      .map((s) => ({
        id: s.id,
        name: nameOf(s),
        groupName: nameOf(this.get(s.group?.rid)),
        active: s.state === "active",
      }))
      .sort((a, b) => a.groupName.localeCompare(b.groupName) || a.name.localeCompare(b.name));
  }

  areas(): HueArea[] {
    return this.ofType("entertainment_configuration")
      .map((a) => ({
        id: a.id,
        name: nameOf(a),
        active: a.status === "active",
        streamer: (a.active_streamer?.rid as string) ?? null,
        channels: ((a.channels ?? []) as { channel_id: number; position: { x: number; y: number; z: number } }[]).map(
          (c) => ({ id: c.channel_id, position: c.position })
        ),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  devices(): HueDevice[] {
    return this.ofType("device")
      .filter((d) => this.#serviceOf(d, "zigbee_connectivity"))
      .map((d) => ({ id: d.id, name: nameOf(d), connected: this.#deviceConnected(d.id) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  bridgeInfo() {
    const bridge = this.ofType("bridge")[0];
    const device = this.ofType("device").find((d) => d.services?.some((s: { rtype: string }) => s.rtype === "bridge"));
    return {
      bridgeId: (bridge?.bridge_id as string) ?? null,
      name: device ? nameOf(device) : null,
      softwareVersion: (device?.product_data?.software_version as string) ?? null,
    };
  }

  /** grouped_light id behind a room/zone id or "home". */
  groupedLightFor(groupId: string): string | null {
    return this.groups().find((g) => g.id === groupId)?.groupedLightId ?? null;
  }
}
