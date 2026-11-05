import { useEffect, useRef, useState } from "preact/hooks";
import { LOG_LEVELS, levelEnabled, type LogLevel, type LogRecord, type SerializedError } from "../../lib/log/shared";
import { ApiError, api } from "./api";
import { useCoreEvent, useSettings } from "./useCore";

const MAX_ROWS = 2000;

function ErrorDetails({ error }: { error: SerializedError }) {
  return (
    <div>
      <pre class="log-stack">
        {error.stack ?? `${error.name}: ${error.message}`}
        {error.code !== undefined && `\ncode: ${error.code}`}
      </pre>
      {error.cause && (
        <div class="log-cause">
          <strong>Causa:</strong>
          <ErrorDetails error={error.cause} />
        </div>
      )}
    </div>
  );
}

function Row({ record }: { record: LogRecord }) {
  const [open, setOpen] = useState(false);
  const expandable = record.data !== undefined || !!record.error;
  return (
    <li class={`log-row level-${record.level}`}>
      <button type="button" class="log-summary" onClick={() => expandable && setOpen(!open)} disabled={!expandable}>
        <time>{new Date(record.time).toLocaleTimeString(undefined, { hour12: false })}.{record.time.slice(20, 23)}</time>
        <span class="log-level">{record.level}</span>
        <span class="log-scope">{record.scope}</span>
        <span class="log-message">{record.message}</span>
        {record.requestId && <code class="muted">req {record.requestId}</code>}
        {expandable && <span class="muted">{open ? "▾" : "▸"}</span>}
      </button>
      {open && (
        <div class="log-details">
          {record.data !== undefined && <pre>{JSON.stringify(record.data, null, 2)}</pre>}
          {record.error && <ErrorDetails error={record.error} />}
        </div>
      )}
    </li>
  );
}

export default function LogsPage() {
  const [settings] = useSettings();
  const [records, setRecords] = useState<LogRecord[]>([]);
  const [level, setLevel] = useState<LogLevel>("debug");
  const [scope, setScope] = useState("");
  const [text, setText] = useState("");
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState("");
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const reload = () => {
    setError("");
    api.logs({ level, scope, limit: 1000 }).then(setRecords, (e) =>
      setError(e instanceof ApiError ? e.errors.join("\n") : String(e))
    );
  };

  useEffect(reload, []);

  useCoreEvent("log", (record) => {
    if (pausedRef.current) return;
    setRecords((prev) => {
      const next = [...prev, record];
      return next.length > MAX_ROWS ? next.slice(-MAX_ROWS) : next;
    });
  });

  const query = text.trim().toLowerCase();
  const visible = records.filter(
    (r) =>
      r.level !== undefined &&
      levelEnabled(r.level, level) &&
      (!scope || r.scope === scope || r.scope.startsWith(`${scope}.`)) &&
      (!query ||
        r.message.toLowerCase().includes(query) ||
        r.requestId?.includes(query) ||
        JSON.stringify(r.data ?? "").toLowerCase().includes(query) ||
        r.error?.message.toLowerCase().includes(query))
  );

  return (
    <section class="editor logs">
      <div class="assignment-row">
        <label class="inline">
          Nivel mínimo
          <select value={level} onChange={(e) => setLevel(e.currentTarget.value as LogLevel)}>
            {LOG_LEVELS.filter((l) => l !== "silent").map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <input type="text" placeholder="Área (ej. obs)" value={scope} onInput={(e) => setScope(e.currentTarget.value.trim())} />
        <input type="search" placeholder="Buscar texto o requestId…" value={text} onInput={(e) => setText(e.currentTarget.value)} />
        <label class="inline">
          <input type="checkbox" checked={paused} onChange={(e) => setPaused(e.currentTarget.checked)} />
          Pausar
        </label>
        <button type="button" class="secondary" onClick={reload}>
          Recargar del servidor
        </button>
        <button type="button" class="secondary" onClick={() => setRecords([])}>
          Limpiar vista
        </button>
      </div>
      <p class="muted">
        «Recargar» trae los últimos registros guardados en memoria del servidor (según el nivel configurado por área). En
        vivo solo llegan los de nivel {settings?.logging.browserLevel ?? "…"} o superior; ajústalo en{" "}
        <a href="/admin/general">General → Registro</a>.
      </p>
      {error && <p class="error">{error}</p>}
      <p class="muted">
        {visible.length} de {records.length} registros
      </p>
      <ul class="log-list">
        {visible
          .slice()
          .reverse()
          .map((record, i) => (
            <Row key={`${record.time}-${i}`} record={record} />
          ))}
      </ul>
    </section>
  );
}
