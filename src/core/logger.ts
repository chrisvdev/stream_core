import { createWriteStream, mkdirSync, readdirSync, rmSync, type WriteStream } from "node:fs";
import { join, resolve } from "node:path";
import { inspect } from "node:util";
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
} from "../lib/log/shared";

export type { LogLevel, LogRecord, Logger } from "../lib/log/shared";

export interface LoggingOptions {
  /** `null` falls back to the LOG_LEVEL env var. */
  level: LogLevel | null;
  scopes: Record<string, LogLevel>;
  browserLevel: LogLevel;
  file: { enabled: boolean; retentionDays: number };
}

const BUFFER_SIZE = 1000;
const FILE_PREFIX = "stream_core-";
const FILE_PATTERN = /^stream_core-(\d{4}-\d{2}-\d{2})\.log$/;

const COLORS: Record<RecordLevel, string> = {
  trace: "\x1b[90m",
  debug: "\x1b[36m",
  info: "\x1b[32m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
};
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

const envLevel = (): LogLevel => {
  const value = process.env.LOG_LEVEL?.toLowerCase();
  if (isLogLevel(value)) return value;
  return process.env.NODE_ENV === "development" ? "debug" : "info";
};

const localDate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

class LogManager {
  readonly dir = resolve(process.env.LOG_DIR ?? "data/logs");
  #options: LoggingOptions = {
    level: null,
    scopes: {},
    browserLevel: "warn",
    file: { enabled: true, retentionDays: 7 },
  };
  #levels = new Map<string, LogLevel>();
  #buffer: LogRecord[] = [];
  #listeners = new Set<(record: LogRecord) => void>();
  #scopes = new Set<string>();
  #stream: WriteStream | null = null;
  #streamDate = "";
  #fileBroken = false;

  configure(options: LoggingOptions) {
    this.#options = options;
    this.#levels.clear();
    this.#fileBroken = false;
    if (!options.file.enabled) this.#closeStream();
    else this.#pruneOldFiles();
  }

  get options(): Readonly<LoggingOptions> {
    return this.#options;
  }

  get baseLevel(): LogLevel {
    return this.#options.level ?? envLevel();
  }

  levelFor(scope: string): LogLevel {
    let level = this.#levels.get(scope);
    if (!level) {
      level = resolveLevel(scope, this.baseLevel, this.#options.scopes);
      this.#levels.set(scope, level);
    }
    return level;
  }

  enabled(scope: string, level: RecordLevel) {
    return levelEnabled(level, this.levelFor(scope));
  }

  createLogger(scope: string): Logger {
    this.#scopes.add(scope);
    const log =
      (level: RecordLevel) =>
      (message: string, ...args: unknown[]) => {
        if (this.enabled(scope, level)) this.emit(buildRecord(level, scope, message, args));
      };
    return {
      scope,
      trace: log("trace"),
      debug: log("debug"),
      info: log("info"),
      warn: log("warn"),
      error: log("error"),
      isEnabled: (level) => this.enabled(scope, level),
      child: (sub) => this.createLogger(`${scope}.${sub}`),
    };
  }

  emit(record: LogRecord) {
    this.#buffer.push(record);
    if (this.#buffer.length > BUFFER_SIZE) this.#buffer.splice(0, this.#buffer.length - BUFFER_SIZE);
    this.#writeConsole(record);
    this.#writeFile(record);
    for (const listener of this.#listeners) {
      try {
        listener(record);
      } catch {
        // A failing listener (e.g. a closed SSE stream) must never break logging.
      }
    }
  }

  onRecord(listener: (record: LogRecord) => void) {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  recent(filter: { level?: LogLevel; scope?: string; limit?: number } = {}): LogRecord[] {
    const { level = "trace", scope, limit = 200 } = filter;
    return this.#buffer
      .filter(
        (r) => levelEnabled(r.level, level) && (!scope || r.scope === scope || r.scope.startsWith(`${scope}.`))
      )
      .slice(-limit);
  }

  knownScopes(): string[] {
    return [...this.#scopes].sort();
  }

  close() {
    this.#closeStream();
  }

  #writeConsole(record: LogRecord) {
    const date = new Date(record.time);
    const time = `${date.toTimeString().slice(0, 8)}.${String(date.getMilliseconds()).padStart(3, "0")}`;
    const color = COLORS[record.level];
    let line = `${DIM}${time}${RESET} ${color}${record.level.toUpperCase().padEnd(5)}${RESET} ${BOLD}[${record.scope}]${RESET} ${record.message}`;
    if (record.requestId) line += ` ${DIM}(req ${record.requestId})${RESET}`;
    if (record.data !== undefined) line += ` ${inspect(record.data, { depth: 4, colors: true, breakLength: 120 })}`;
    if (record.error) line += `\n${formatError(record.error)}`;
    if (record.level === "error") console.error(line);
    else if (record.level === "warn") console.warn(line);
    else console.log(line);
  }

  #writeFile(record: LogRecord) {
    if (!this.#options.file.enabled || this.#fileBroken) return;
    const date = localDate(new Date(record.time));
    if (date !== this.#streamDate || !this.#stream) {
      this.#closeStream();
      try {
        mkdirSync(this.dir, { recursive: true });
        this.#stream = createWriteStream(join(this.dir, `${FILE_PREFIX}${date}.log`), { flags: "a" });
        this.#stream.on("error", (error) => {
          this.#fileBroken = true;
          console.error(`[logger] cannot write log file in ${this.dir}:`, error);
        });
        this.#streamDate = date;
        this.#pruneOldFiles();
      } catch (error) {
        this.#fileBroken = true;
        console.error(`[logger] cannot open log file in ${this.dir}:`, error);
        return;
      }
    }
    this.#stream?.write(`${JSON.stringify(record)}\n`);
  }

  #closeStream() {
    this.#stream?.end();
    this.#stream = null;
    this.#streamDate = "";
  }

  #pruneOldFiles() {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - this.#options.file.retentionDays);
    const oldest = localDate(cutoff);
    let files: string[];
    try {
      files = readdirSync(this.dir);
    } catch {
      return;
    }
    for (const file of files) {
      const date = FILE_PATTERN.exec(file)?.[1];
      if (date && date < oldest) rmSync(join(this.dir, file), { force: true });
    }
  }
}

function formatError(error: SerializedError, indent = "  "): string {
  const head = error.stack ?? `${error.name}: ${error.message}`;
  let text = head
    .split("\n")
    .map((l) => `${indent}${l}`)
    .join("\n");
  if (error.code !== undefined) text += `\n${indent}code: ${error.code}`;
  if (error.cause) text += `\n${indent}Caused by:\n${formatError(error.cause, `${indent}  `)}`;
  for (const inner of error.errors ?? []) text += `\n${formatError(inner, `${indent}  `)}`;
  return `${COLORS.error}${text}${RESET}`;
}

// Shared across Astro's config and SSR module graphs, like the core context.
const KEY = Symbol.for("stream_core.logger");
const HANDLERS = Symbol.for("stream_core.logger.processHandlers");
const store = globalThis as typeof globalThis & { [KEY]?: LogManager; [HANDLERS]?: boolean };

export const logManager: LogManager = (store[KEY] ??= new LogManager());

export const createLogger = (scope: string): Logger => logManager.createLogger(scope);

/** Logs process-level failures once per process; uncaught exceptions still crash as Node intends. */
export function installProcessHandlers() {
  if (store[HANDLERS]) return;
  store[HANDLERS] = true;
  const log = createLogger("process");
  process.on("unhandledRejection", (reason) => {
    log.error("Unhandled promise rejection", reason instanceof Error ? reason : { reason });
  });
  process.on("uncaughtExceptionMonitor", (error, origin) => {
    log.error(`Uncaught exception (${origin})`, error);
  });
  process.on("warning", (warning) => log.warn(warning.message, warning));
}
