import { useEffect, useState } from "preact/hooks";
import type { Settings } from "../../core";
import { LOG_LEVELS, type LogLevel } from "../../lib/log/shared";
import { api } from "./api";

type Logging = Settings["logging"];

interface Props {
  value: Logging;
  onChange(value: Logging): void;
}

const LEVEL_LABELS: Record<LogLevel, string> = {
  trace: "trace (todo)",
  debug: "debug",
  info: "info",
  warn: "warn",
  error: "error",
  silent: "silent (nada)",
};

function LevelSelect({ value, onChange }: { value: LogLevel; onChange(level: LogLevel): void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.currentTarget.value as LogLevel)}>
      {LOG_LEVELS.map((level) => (
        <option key={level} value={level}>
          {LEVEL_LABELS[level]}
        </option>
      ))}
    </select>
  );
}

export default function LoggingSettings({ value, onChange }: Props) {
  const [info, setInfo] = useState<{ scopes: string[]; dir: string; envLevel: string | null } | null>(null);
  const [newScope, setNewScope] = useState("");

  useEffect(() => {
    api.logScopes().then(setInfo, () => setInfo(null));
  }, []);

  const update = (patch: Partial<Logging>) => onChange({ ...value, ...patch });
  const setScope = (scope: string, level: LogLevel | null) => {
    const { [scope]: _, ...rest } = value.scopes;
    update({ scopes: level ? { ...rest, [scope]: level } : rest });
  };

  return (
    <fieldset>
      <legend>Registro (logs)</legend>

      <label>
        <span>Nivel base</span>
        <select
          value={value.level ?? ""}
          onChange={(e) => update({ level: (e.currentTarget.value || null) as LogLevel | null })}
        >
          <option value="">Usar LOG_LEVEL ({info?.envLevel ?? "no definido: debug en dev, info en prod"})</option>
          {LOG_LEVELS.map((level) => (
            <option key={level} value={level}>
              {LEVEL_LABELS[level]}
            </option>
          ))}
        </select>
      </label>

      <div>
        <span>Niveles por área</span>
        <p class="muted">Gana el prefijo más largo: «obs» afecta a «obs.client».</p>
        {Object.entries(value.scopes).map(([scope, level]) => (
          <div key={scope} class="assignment-row">
            <code>{scope}</code>
            <LevelSelect value={level} onChange={(l) => setScope(scope, l)} />
            <button type="button" class="danger" onClick={() => setScope(scope, null)}>
              Quitar
            </button>
          </div>
        ))}
        <div class="assignment-row">
          <input
            type="text"
            list="log-scopes"
            placeholder="área (ej. obs, core.dispatcher)"
            value={newScope}
            onInput={(e) => setNewScope(e.currentTarget.value.trim())}
          />
          <datalist id="log-scopes">
            {info?.scopes.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <button
            type="button"
            class="secondary"
            disabled={!newScope || newScope in value.scopes}
            onClick={() => {
              setScope(newScope, "debug");
              setNewScope("");
            }}
          >
            Agregar
          </button>
        </div>
      </div>

      <label>
        <span>Mostrar en la consola del navegador desde</span>
        <LevelSelect value={value.browserLevel} onChange={(browserLevel) => update({ browserLevel })} />
      </label>

      <label class="inline">
        <input
          type="checkbox"
          checked={value.file.enabled}
          onChange={(e) => update({ file: { ...value.file, enabled: e.currentTarget.checked } })}
        />
        Guardar en archivo {info && <code class="muted">{info.dir}</code>}
      </label>
      {value.file.enabled && (
        <label>
          <span>Días a conservar</span>
          <input
            type="number"
            min={1}
            max={365}
            value={value.file.retentionDays}
            onChange={(e) =>
              update({ file: { ...value.file, retentionDays: e.currentTarget.valueAsNumber || value.file.retentionDays } })
            }
          />
        </label>
      )}
      <p class="muted">
        En el navegador también puedes usar <code>streamCoreLog.setLevel("debug")</code> en la consola para los logs del
        panel.
      </p>
    </fieldset>
  );
}
