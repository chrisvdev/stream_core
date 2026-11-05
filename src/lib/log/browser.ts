import {
  buildRecord,
  isLogLevel,
  levelEnabled,
  resolveLevel,
  type LogLevel,
  type LogRecord,
  type Logger,
  type RecordLevel,
  type SerializedError,
} from "./shared";

const STORAGE_KEY = "streamcore.log";
const BUFFER_SIZE = 300;

const COLORS: Record<RecordLevel, string> = {
  trace: "#8b8f99",
  debug: "#38bdf8",
  info: "#3dd68c",
  warn: "#f5a524",
  error: "#e5484d",
};

const METHOD: Record<RecordLevel, "debug" | "info" | "warn" | "error"> = {
  trace: "debug",
  debug: "debug",
  info: "info",
  warn: "warn",
  error: "error",
};

interface LevelSpec {
  base: LogLevel;
  scopes: Record<string, LogLevel>;
}

/** Accepts `"debug"` or `"obs=debug,*=info"`; `*` sets the base level. */
function parseSpec(spec: string | null): LevelSpec {
  const result: LevelSpec = { base: "info", scopes: {} };
  for (const part of (spec ?? "").split(",").map((p) => p.trim()).filter(Boolean)) {
    const [scope, level] = part.includes("=") ? part.split("=").map((s) => s.trim()) : ["*", part];
    if (!isLogLevel(level)) continue;
    if (scope === "*") result.base = level;
    else result.scopes[scope] = level;
  }
  return result;
}

const readSpec = () => {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

let spec = parseSpec(readSpec());
const buffer: LogRecord[] = [];

const levelFor = (scope: string) => resolveLevel(scope, spec.base, spec.scopes);

function print(record: LogRecord, origin: "browser" | "server") {
  const color = COLORS[record.level];
  const parts = [
    `%c${origin === "server" ? "[server] " : ""}%c${record.level.toUpperCase()}%c [${record.scope}]%c ${record.message}`,
    "color:#a78bfa;font-weight:bold",
    `color:${color};font-weight:bold`,
    "color:#8b8f99",
    "color:inherit",
  ];
  const extra: unknown[] = [];
  if (record.requestId) extra.push({ requestId: record.requestId });
  if (record.data !== undefined) extra.push(record.data);
  if (record.error) extra.push(toError(record.error));
  console[METHOD[record.level]](...parts, ...extra);
}

/** Rebuilds an Error so devtools renders the original (server) stack as clickable frames. */
function toError(serialized: SerializedError): Error {
  const error = new Error(serialized.message);
  error.name = serialized.name;
  if (serialized.stack) error.stack = serialized.stack;
  if (serialized.code !== undefined) Object.assign(error, { code: serialized.code });
  if (serialized.cause) Object.assign(error, { cause: toError(serialized.cause) });
  return error;
}

function remember(record: LogRecord) {
  buffer.push(record);
  if (buffer.length > BUFFER_SIZE) buffer.splice(0, buffer.length - BUFFER_SIZE);
}

export function createLogger(scope: string): Logger {
  const log =
    (level: RecordLevel) =>
    (message: string, ...args: unknown[]) => {
      if (!levelEnabled(level, levelFor(scope))) return;
      const record = buildRecord(level, scope, message, args);
      remember(record);
      print(record, "browser");
    };
  return {
    scope,
    trace: log("trace"),
    debug: log("debug"),
    info: log("info"),
    warn: log("warn"),
    error: log("error"),
    isEnabled: (level) => levelEnabled(level, levelFor(scope)),
    child: (sub) => createLogger(`${scope}.${sub}`),
  };
}

/** Server records were already filtered by `browserLevel` on the server. */
export function printServerRecord(record: LogRecord) {
  remember({ ...record, scope: `server:${record.scope}` });
  print(record, "server");
}

let installed = false;

/** Global error capture plus a `window.streamCoreLog` helper for the devtools console. */
export function installBrowserErrorCapture() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const log = createLogger("window");

  window.addEventListener("error", (event) => {
    log.error(`Uncaught: ${event.message}`, event.error ?? { source: event.filename, line: event.lineno });
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    // Requests cancelled while navigating away are expected, not bugs.
    if ((reason as { aborted?: unknown } | null)?.aborted === true) return;
    log.error("Unhandled promise rejection", reason instanceof Error ? reason : { reason });
  });

  Object.assign(window, {
    streamCoreLog: {
      /** e.g. `streamCoreLog.setLevel("debug")` or `streamCoreLog.setLevel("obs=trace,*=info")`. */
      setLevel(value: string) {
        spec = parseSpec(value);
        try {
          localStorage.setItem(STORAGE_KEY, value);
        } catch {
          // Private mode: the level still applies until reload.
        }
        return spec;
      },
      getLevel: () => spec,
      recent: (count = 50) => buffer.slice(-count),
    },
  });
}
