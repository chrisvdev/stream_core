import { useEffect, useState } from "preact/hooks";
import type { ObsStatus } from "../../../modules/obs/client";
import type { ObsConfig } from "../../../modules/obs/config";
import { ApiError, api } from "../../admin/api";
import { useCoreEvent } from "../../admin/useCore";

const MODULE = "obs";

type Form = Omit<ObsConfig, "password"> & { password: string };

const STATE_LABEL: Record<ObsStatus["state"], string> = {
  connected: "Conectado",
  connecting: "Conectando…",
  disconnected: "Desconectado",
  error: "Error",
};

export default function ObsPanel() {
  const [form, setForm] = useState<Form | null>(null);
  const [passwordSet, setPasswordSet] = useState(false);
  const [status, setStatus] = useState<ObsStatus | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const loadConfig = async () => {
    const { values, secrets } = await api.moduleConfig(MODULE);
    setForm({ ...(values as Omit<ObsConfig, "password">), password: "" });
    setPasswordSet(secrets.password ?? false);
  };

  useEffect(() => {
    loadConfig();
    api.moduleStatus<ObsStatus>(MODULE).then(setStatus);
  }, []);

  useCoreEvent("module-status", ({ module, status }) => {
    if (module === MODULE) setStatus(status as ObsStatus);
  });
  useCoreEvent("module-config", ({ module }) => {
    if (module === MODULE) loadConfig();
  });

  const run = async (task: () => Promise<unknown>, done?: (result: unknown) => string) => {
    setErrors([]);
    setMessage("");
    setBusy(true);
    try {
      const result = await task();
      if (done) setMessage(done(result));
    } catch (error) {
      setErrors(error instanceof ApiError ? error.errors : [String(error)]);
    } finally {
      setBusy(false);
    }
  };

  if (!form) return <p class="muted">Cargando…</p>;

  const update = (patch: Partial<Form>) => setForm({ ...form, ...patch });

  const save = () =>
    run(async () => {
      const { password, ...rest } = form;
      // An empty password keeps the saved one (see ConfigRepository.setModuleConfig).
      await api.saveModuleConfig(MODULE, { ...rest, password: password || undefined });
      setForm({ ...form, password: "" });
    }, () => "Guardado");

  const test = () =>
    run(
      () => api.moduleCommand<{ obsVersion: string; obsWebSocketVersion: string; supported: boolean }>(MODULE, "test", {
        url: form.url,
        password: form.password || undefined,
      }),
      (r) => {
        const result = r as { obsVersion: string; obsWebSocketVersion: string; supported: boolean };
        return result.supported
          ? `Conexión OK: OBS ${result.obsVersion}, websocket ${result.obsWebSocketVersion}`
          : `OBS ${result.obsVersion} responde, pero websocket ${result.obsWebSocketVersion} es anterior a 5.5 (se requiere OBS 30+)`;
      }
    );

  const connected = status?.state === "connected";

  return (
    <main class="module-page">
      <form
        class="editor"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <h2>Conexión</h2>
        <label>
          <span>URL de obs-websocket</span>
          <input type="text" value={form.url} onInput={(e) => update({ url: e.currentTarget.value })} />
        </label>
        <label>
          <span>Contraseña {passwordSet && <small class="muted">(guardada; vacío = no cambiar)</small>}</span>
          <input
            type="password"
            autocomplete="off"
            placeholder={passwordSet ? "••••••••" : ""}
            value={form.password}
            onInput={(e) => update({ password: e.currentTarget.value })}
          />
        </label>
        {passwordSet && (
          <button
            type="button"
            class="secondary"
            disabled={busy}
            onClick={() => run(() => api.saveModuleConfig(MODULE, { ...form, password: null }), () => "Contraseña eliminada")}
          >
            Quitar contraseña guardada
          </button>
        )}
        <label class="inline">
          <input type="checkbox" checked={form.autoConnect} onChange={(e) => update({ autoConnect: e.currentTarget.checked })} />
          Conectar automáticamente al iniciar y reconectar si se corta
        </label>
        <label>
          <span>Reintento de conexión (ms)</span>
          <input
            type="number"
            min={1000}
            max={60000}
            step={500}
            value={form.reconnectMs}
            onChange={(e) => update({ reconnectMs: e.currentTarget.valueAsNumber })}
          />
        </label>
        <p class="muted">La contraseña no se incluye al exportar la configuración.</p>

        {errors.length > 0 && (
          <ul class="error">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        {message && <p class="ok">{message}</p>}

        <div class="actions wrap">
          <button type="submit" disabled={busy}>
            Guardar
          </button>
          <button type="button" class="secondary" disabled={busy} onClick={test}>
            Probar conexión
          </button>
        </div>
      </form>

      <section class="editor">
        <h2>
          Estado{" "}
          <span class={`status ${connected ? "on" : "off"}`}>{status ? STATE_LABEL[status.state] : "Sin datos"}</span>
        </h2>
        {status?.error && <p class="error">{status.error}</p>}
        {status && (
          <dl class="facts">
            <dt>OBS</dt>
            <dd>{status.obsVersion ?? "—"}</dd>
            <dt>obs-websocket</dt>
            <dd>{status.obsWebSocketVersion ?? "—"}</dd>
            <dt>Escena en programa</dt>
            <dd>{status.programScene ?? "—"}</dd>
            <dt>Stream</dt>
            <dd>{status.stream}</dd>
            <dt>Grabación</dt>
            <dd>{status.record}</dd>
            <dt>Detectado</dt>
            <dd>
              {status.counts.scenes} escenas · {status.counts.inputs} entradas ({status.counts.audioInputs} de audio,{" "}
              {status.counts.mediaInputs} de media) · {status.counts.items} fuentes en escenas · {status.counts.filters} filtros
            </dd>
          </dl>
        )}
        <div class="actions wrap">
          {connected ? (
            <button type="button" class="secondary" disabled={busy} onClick={() => run(() => api.moduleCommand(MODULE, "disconnect"))}>
              Desconectar
            </button>
          ) : (
            <button type="button" disabled={busy} onClick={() => run(() => api.moduleCommand(MODULE, "connect"))}>
              Conectar
            </button>
          )}
          <button
            type="button"
            class="secondary"
            disabled={busy || !connected}
            onClick={() => run(() => api.moduleCommand(MODULE, "refresh"), () => "Datos actualizados")}
          >
            Refrescar datos
          </button>
        </div>
        <p class="muted">
          Las escenas, fuentes, filtros y audio de OBS aparecen como opciones en las acciones del{" "}
          <a href="/admin/launchpad">Launchpad</a> y como <a href="/admin/indicators">indicadores</a>.
        </p>
      </section>
    </main>
  );
}
