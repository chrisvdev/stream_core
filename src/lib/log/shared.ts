export const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "silent"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
/** Levels a record can have (`silent` only makes sense as a threshold). */
export type RecordLevel = Exclude<LogLevel, "silent">;

const RANK: Record<LogLevel, number> = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, silent: 100 };

export const isLogLevel = (value: unknown): value is LogLevel =>
  typeof value === "string" && (LOG_LEVELS as readonly string[]).includes(value);

export const levelEnabled = (level: RecordLevel, threshold: LogLevel) => RANK[level] >= RANK[threshold];

export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
  code?: string | number;
  cause?: SerializedError;
  errors?: SerializedError[];
}

export interface LogRecord {
  time: string;
  level: RecordLevel;
  scope: string;
  message: string;
  data?: unknown;
  error?: SerializedError;
  requestId?: string;
}

export interface Logger {
  readonly scope: string;
  trace(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  isEnabled(level: RecordLevel): boolean;
  child(scope: string): Logger;
}

/** Longest matching scope prefix wins (`obs` matches `obs.client`); otherwise the base level applies. */
export function resolveLevel(scope: string, base: LogLevel, overrides: Record<string, LogLevel>): LogLevel {
  let best: string | undefined;
  for (const prefix of Object.keys(overrides)) {
    const matches = scope === prefix || scope.startsWith(`${prefix}.`);
    if (matches && (!best || prefix.length > best.length)) best = prefix;
  }
  return best ? overrides[best] : base;
}

export function serializeError(error: unknown, depth = 0): SerializedError {
  if (!(error instanceof Error)) {
    return { name: typeof error, message: typeof error === "string" ? error : safeStringify(error) };
  }
  const result: SerializedError = { name: error.name, message: error.message, stack: error.stack };
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" || typeof code === "number") result.code = code;
  if (depth < 5 && error.cause !== undefined) result.cause = serializeError(error.cause, depth + 1);
  if (depth < 5 && error instanceof AggregateError) {
    result.errors = error.errors.slice(0, 10).map((e) => serializeError(e, depth + 1));
  }
  return result;
}

const SECRET_KEY = /password|secret|token|authorization|cookie/i;

/** Deep copy with secret-looking keys replaced; also breaks cycles. */
export function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Error) return serializeError(value);
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, seen));
  if (value instanceof Map) return redact(Object.fromEntries(value), seen);
  if (value instanceof Set) return redact([...value], seen);
  const result: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    result[key] = SECRET_KEY.test(key) ? "[redacted]" : redact(v, seen);
  }
  return result;
}

/** Splits variadic logger args: the first Error becomes `error`, the rest becomes `data`. */
export function buildRecord(level: RecordLevel, scope: string, message: string, args: unknown[]): LogRecord {
  const record: LogRecord = { time: new Date().toISOString(), level, scope, message };
  const rest: unknown[] = [];
  for (const arg of args) {
    if (!record.error && arg instanceof Error) record.error = serializeError(arg);
    else rest.push(arg);
  }
  if (rest.length === 1) record.data = redact(rest[0]);
  else if (rest.length > 1) record.data = redact(rest);
  const requestId = (record.data as { requestId?: unknown } | undefined)?.requestId;
  if (typeof requestId === "string") record.requestId = requestId;
  return record;
}

export function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
