import { useEffect, useRef, useState } from "preact/hooks";
import type {
  ActiveIndicator,
  Binding,
  CoreEvents,
  DeviceStatus,
  IndicatorAssignment,
  ModuleCatalogEntry,
  Settings,
} from "../../core";
import { api } from "./api";
import type { LedView } from "./LaunchpadGrid";
import { createLogger, installBrowserErrorCapture, printServerRecord } from "../../lib/log/browser";

const log = createLogger("sse");

type CoreEventName = keyof CoreEvents;
type Listener<K extends CoreEventName> = (payload: CoreEvents[K]) => void;
type AnyListener = (payload: unknown) => void;

interface Hub {
  source: EventSource | null;
  connected: boolean;
  reconnects: number;
  /** EventSources opened by this tab since load; more than one per page means connections are leaking. */
  opened: number;
  connectionListeners: Set<(connected: boolean) => void>;
  listeners: Map<string, Set<AnyListener>>;
  attached: Set<string>;
}

const createHub = (): Hub => ({
  source: null,
  connected: false,
  reconnects: 0,
  opened: 0,
  connectionListeners: new Set(),
  listeners: new Map(),
  attached: new Set(),
});

// Kept on window so islands and scripts bundled with their own copy of this module still share one
// connection: each EventSource holds one of the browser's ~6 HTTP/1.1 connections per host.
const hub: Hub =
  typeof window === "undefined"
    ? createHub()
    : ((window as unknown as { __streamCoreSse?: Hub }).__streamCoreSse ??= createHub());

function setConnected(value: boolean) {
  if (value === hub.connected) return;
  hub.connected = value;
  for (const listener of hub.connectionListeners) listener(value);
}

function attach(source: EventSource, name: string) {
  if (hub.attached.has(name)) return;
  hub.attached.add(name);
  source.addEventListener(name, (e) => {
    let payload: unknown;
    try {
      payload = JSON.parse((e as MessageEvent).data);
    } catch (error) {
      log.error(`Malformed "${name}" event`, error, { data: (e as MessageEvent).data });
      return;
    }
    for (const l of hub.listeners.get(name) ?? []) {
      try {
        l(payload);
      } catch (error) {
        log.error(`Listener for "${name}" failed`, error);
      }
    }
  });
}

function ensureSource() {
  if (hub.source) return hub.source;
  const source = new EventSource("/api/events");
  hub.source = source;
  hub.opened++;
  hub.attached.clear();
  for (const name of hub.listeners.keys()) attach(source, name);
  source.onopen = () => {
    if (hub.reconnects) log.info(`Reconnected to server (attempt ${hub.reconnects})`);
    else log.debug("Connected to server");
    setConnected(true);
  };
  source.onerror = () => {
    // EventSource retries on its own; only log the transition to avoid spamming while the server is down.
    if (hub.connected) log.warn("Lost connection to server; retrying…");
    hub.reconnects++;
    setConnected(false);
  };
  return source;
}

function closeSource() {
  if (!hub.source) return;
  hub.source.close();
  hub.source = null;
  setConnected(false);
}

if (typeof window !== "undefined" && !(window as unknown as { __streamCoreSseHooks?: boolean }).__streamCoreSseHooks) {
  (window as unknown as { __streamCoreSseHooks?: boolean }).__streamCoreSseHooks = true;
  // Release the connection as soon as we leave; waiting for the browser can stall the next page.
  window.addEventListener("pagehide", closeSource);
  window.addEventListener("pageshow", (event) => {
    if (event.persisted && hub.listeners.size) ensureSource();
  });
}

export function onCoreEvent<K extends CoreEventName>(name: K, listener: Listener<K>) {
  const source = ensureSource();
  const set = hub.listeners.get(name) ?? new Set<AnyListener>();
  hub.listeners.set(name, set);
  attach(source, name);
  set.add(listener as AnyListener);
  return () => {
    set.delete(listener as AnyListener);
  };
}

export function useCoreEvent<K extends CoreEventName>(name: K, listener: Listener<K>) {
  const ref = useRef(listener);
  ref.current = listener;
  useEffect(() => onCoreEvent(name, (payload) => ref.current(payload)), [name]);
}

export function useConnected() {
  const [value, setValue] = useState(hub.connected);
  useEffect(() => {
    ensureSource();
    hub.connectionListeners.add(setValue);
    setValue(hub.connected);
    return () => {
      hub.connectionListeners.delete(setValue);
    };
  }, []);
  return value;
}

/** Loads data once and reloads it whenever one of `reloadOn` events arrives. */
function useLoaded<T>(load: () => Promise<T>, initial: T, reloadOn: CoreEventName[]) {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    const reload = () => {
      load().then(setValue, (error) => log.error("Initial load failed", error));
    };
    reload();
    const unsubscribe = reloadOn.map((name) => onCoreEvent(name, reload));
    return () => unsubscribe.forEach((u) => u());
  }, []);
  return [value, setValue] as const;
}

export const keyOf = (x: number, y: number) => `${x},${y}`;

export function useCatalog() {
  return useLoaded<ModuleCatalogEntry[]>(api.catalog, [], ["catalog"])[0];
}

export function useBindings() {
  const [list] = useLoaded<Binding[]>(api.bindings, [], ["bindings"]);
  return new Map(list.map((b) => [keyOf(b.x, b.y), b]));
}

export function useIndicators() {
  const [data, setData] = useLoaded<{ assignments: IndicatorAssignment[]; active: ActiveIndicator[] }>(
    api.indicators,
    { assignments: [], active: [] },
    ["indicators-config"]
  );
  useCoreEvent("indicator", ({ module, indicator, state }) =>
    setData((prev) => {
      const rest = prev.active.filter((a) => a.module !== module || a.indicator !== indicator);
      return { ...prev, active: state ? [...rest, { module, indicator, state }] : rest };
    })
  );
  return data;
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    api.settings().then(setSettings);
  }, []);
  useCoreEvent("settings", ({ settings }) => setSettings(settings));
  return [settings, setSettings] as const;
}

export function useDevice() {
  const [device, setDevice] = useState<DeviceStatus | null>(null);
  useEffect(() => {
    api.device().then(setDevice);
  }, []);
  useCoreEvent("device", setDevice);
  return [device, setDevice] as const;
}

export function useLeds() {
  const [leds, setLeds] = useState(new Map<string, LedView>());
  useEffect(() => {
    api.state().then((state) =>
      setLeds(new Map(state.map((s) => [keyOf(s.x, s.y), { appearance: s.appearance, layer: s.layer }])))
    );
  }, []);
  useCoreEvent("appearance", ({ x, y, appearance, layer }) =>
    setLeds((prev) => new Map(prev).set(keyOf(x, y), { appearance, layer }))
  );
  return leds;
}

export function usePressed() {
  const [pressed, setPressed] = useState(new Set<string>());
  useCoreEvent("button", ({ x, y, event }) =>
    setPressed((prev) => {
      const next = new Set(prev);
      if (event === "press") next.add(keyOf(x, y));
      else next.delete(keyOf(x, y));
      return next;
    })
  );
  return pressed;
}

/** Locations whose last physical press was ignored because the buttons are locked (shown briefly). */
export function useBlocked(durationMs = 800) {
  const [blocked, setBlocked] = useState(new Set<string>());
  useCoreEvent("button", ({ x, y, event, blocked: wasBlocked }) => {
    if (!wasBlocked || event !== "press") return;
    const key = keyOf(x, y);
    setBlocked((prev) => new Set(prev).add(key));
    setTimeout(
      () =>
        setBlocked((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        }),
      durationMs
    );
  });
  return blocked;
}

export function useActionErrors() {
  const [errors, setErrors] = useState<CoreEvents["action-error"][]>([]);
  useCoreEvent("action-error", (error) => setErrors((prev) => [error, ...prev].slice(0, 20)));
  return [errors, () => setErrors([])] as const;
}

const DEVICE_TEMPO = 120;

let loggingInstalled = false;

/** Captures uncaught browser errors and prints forwarded server logs; called once per page by the admin layout. */
export function installBrowserLogging() {
  if (loggingInstalled) return;
  loggingInstalled = true;
  installBrowserErrorCapture();
  onCoreEvent("log", printServerRecord);
  reportPageLoad();
}

function reportPageLoad() {
  const pageLog = createLogger("page");
  const measure = () => {
    const [nav] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
    if (!nav) return;
    const timings = {
      path: location.pathname,
      totalMs: Math.round(nav.loadEventEnd || performance.now()),
      // Time until the server started answering; large values point at the server or a stalled connection.
      waitingMs: Math.round(nav.responseStart - nav.requestStart),
      stalledMs: Math.round(nav.requestStart - nav.startTime),
      domMs: Math.round(nav.domContentLoadedEventEnd - nav.responseEnd),
      eventSources: hub.opened,
    };
    if (timings.totalMs > 2000 || timings.stalledMs > 1000) pageLog.warn("Slow page load", timings);
    else pageLog.debug("Page loaded", timings);
  };
  if (document.readyState === "complete") setTimeout(measure);
  else window.addEventListener("load", () => setTimeout(measure), { once: true });
}

/** CSS variable that syncs LED previews with the device tempo. */
export const beatStyle = (settings: Settings | null) => ({ "--beat": `${60 / (settings?.tempo ?? DEVICE_TEMPO)}s` });
