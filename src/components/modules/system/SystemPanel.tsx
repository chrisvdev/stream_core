import { useEffect, useState } from "preact/hooks";
import type { SystemConfig } from "../../../modules/system/config";
import type { SystemStatus } from "../../../modules/system/index";
import { ApiError, api } from "../../admin/api";
import AppearanceEditor from "../../admin/AppearanceEditor";
import { useCoreEvent, useDevice } from "../../admin/useCore";

const MODULE = "system";
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

const HEALTH_LABEL = { ok: "OK", warn: "Aviso", error: "Error" } as const;

const formatUptime = (sec: number) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m}m ${sec % 60}s`;
};

export default function SystemPanel() {
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [device] = useDevice();
  const [mark, setMark] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const loadConfig = async () => setConfig((await api.moduleConfig(MODULE)).values as SystemConfig);
  const loadStatus = () => api.moduleStatus<SystemStatus>(MODULE).then(setStatus);

  useEffect(() => {
    loadConfig();
    loadStatus();
    // Uptime and memory change constantly; poll instead of pushing them through events.
    const timer = setInterval(loadStatus, 5_000);
    return () => clearInterval(timer);
  }, []);

  useCoreEvent("module-status", ({ module, status }) => {
    if (module === MODULE) setStatus(status as SystemStatus);
  });
  useCoreEvent("module-config", ({ module }) => {
    if (module === MODULE) loadConfig();
  });

  const run = async (task: () => Promise<unknown>, done?: string) => {
    setErrors([]);
    setMessage("");
    setBusy(true);
    try {
      await task();
      if (done) setMessage(done);
      await loadStatus();
    } catch (error) {
      setErrors(error instanceof ApiError ? error.errors : [String(error)]);
    } finally {
      setBusy(false);
    }
  };

  const command = (name: string, input: unknown = {}) => api.moduleCommand(MODULE, name, input);
  const save = (next: SystemConfig, done = "Guardado") =>
    run(async () => setConfig((await api.saveModuleConfig(MODULE, next)).values as SystemConfig), done);

  if (!config) return <p class="muted">Cargando…</p>;

  const updateServer = (patch: Partial<SystemConfig["server"]>) => setConfig({ ...config, server: { ...config.server, ...patch } });
  const exposed = !LOOPBACK.has(config.server.host);

  return (
    <main class="module-page">
      <section class="editor">
        <h2>LEDs y bloqueo</h2>
        <div class="actions wrap">
          <button type="button" disabled={busy || !device} onClick={() => run(() => command("setSleep", { sleeping: !device?.sleeping }))}>
            {device?.sleeping ? "Encender LEDs" : "Apagar LEDs"}
          </button>
          <button
            type="button"
            class="secondary"
            disabled={busy || !device}
            onClick={() => run(() => command("setLock", { locked: device?.lockReason !== "manual" }))}
          >
            {device?.lockReason === "manual" ? "Desbloquear botones" : "Bloquear botones"}
          </button>
          <span class={`status ${device?.locked ? "off" : "on"}`}>
            {!device ? "…" : device.locked ? `Bloqueado (${device.lockReason === "manual" ? "manual" : "LEDs apagados"})` : "Desbloqueado"}
          </span>
        </div>
        <label class="inline">
          <input
            type="checkbox"
            checked={config.lock.whenAsleep}
            onChange={(e) => save({ ...config, lock: { whenAsleep: e.currentTarget.checked } })}
          />
          Bloquear los botones cuando los LEDs están apagados
        </label>
        <p class="muted">
          Bloqueados, los botones físicos solo ejecutan «Encender/apagar LEDs», «Bloquear botones» y «Pánico». El botón
          «Probar» del panel siempre funciona.
        </p>
        {status && status.wakeButtons.length === 0 && (
          <p class="notice">
            Ningún botón tiene asignada «Encender/apagar LEDs»: si los apagás, solo vas a poder encenderlos desde este
            panel. <a href="/admin/launchpad">Asignar uno</a>.
          </p>
        )}

        <fieldset>
          <legend>Apagado</legend>
          <label>
            <span>Modo</span>
            <select
              value={config.sleep.mode}
              onChange={(e) =>
                save({ ...config, sleep: { ...config.sleep, mode: e.currentTarget.value as SystemConfig["sleep"]["mode"] } })
              }
            >
              <option value="blackout">Por software (recomendado): LEDs en negro, los botones siguen respondiendo</option>
              <option value="hardware">Sleep del Launchpad</option>
            </select>
          </label>
          {config.sleep.mode === "hardware" && (
            <p class="error">
              Con el sleep del aparato el Launchpad puede dejar de enviar pulsaciones: no podrías encenderlo desde un
              botón, solo desde el panel.
            </p>
          )}
          <label class="inline">
            <input
              type="checkbox"
              checked={config.sleep.showWakeButton}
              disabled={config.sleep.mode === "hardware"}
              onChange={(e) => save({ ...config, sleep: { ...config.sleep, showWakeButton: e.currentTarget.checked } })}
            />
            Mantener tenues los botones de encender y desbloquear
          </label>
          {config.sleep.showWakeButton && config.sleep.mode === "blackout" && (
            <AppearanceEditor
              value={config.sleep.wakeAppearance}
              onChange={(wakeAppearance) => save({ ...config, sleep: { ...config.sleep, wakeAppearance } })}
            />
          )}
        </fieldset>

        <fieldset>
          <legend>Tempo y utilidades</legend>
          <div class="actions wrap">
            <button type="button" class="secondary" disabled={busy} onClick={() => run(() => command("tap"))}>
              Tap tempo
            </button>
            <span>{device?.tempo ? `${device.tempo} BPM` : "Tempo del dispositivo (120 BPM)"}</span>
          </div>
          <div class="assignment-row">
            <input type="text" placeholder="Texto de la marca (opcional)" value={mark} onInput={(e) => setMark(e.currentTarget.value)} />
            <button type="button" class="secondary" disabled={busy} onClick={() => run(() => command("mark", { label: mark }), "Marca escrita en el log")}>
              Marca en el log
            </button>
          </div>
          <button type="button" class="danger" disabled={busy} onClick={() => run(() => command("panic"), "Todo detenido")}>
            Pánico: detener todo
          </button>
        </fieldset>
      </section>

      <form
        class="editor"
        onSubmit={(e) => {
          e.preventDefault();
          save(config, "Guardado; reinicia el servidor para aplicarlo");
        }}
      >
        <h2>Servidor</h2>
        <label>
          <span>Puerto</span>
          <input
            type="number"
            min={1}
            max={65535}
            value={config.server.port}
            onChange={(e) => updateServer({ port: e.currentTarget.valueAsNumber || config.server.port })}
          />
        </label>
        <label>
          <span>Host</span>
          <input type="text" value={config.server.host} onInput={(e) => updateServer({ host: e.currentTarget.value.trim() })} />
        </label>
        {exposed && (
          <p class="error">
            Con un host distinto de 127.0.0.1 el panel queda accesible desde la red y no tiene autenticación.
          </p>
        )}
        {status && (
          <dl class="facts">
            <dt>En uso</dt>
            <dd>
              http://{status.server.effective.host}:{status.server.effective.port}
            </dd>
            {(status.server.source.port === "env" || status.server.source.host === "env") && (
              <>
                <dt>Prioridad</dt>
                <dd>
                  {[status.server.source.port === "env" && "PORT", status.server.source.host === "env" && "HOST"]
                    .filter(Boolean)
                    .join(" y ")}{" "}
                  del entorno sobrescriben lo guardado
                </dd>
              </>
            )}
          </dl>
        )}
        {status?.server.restartRequired && <p class="notice">Reinicia el servidor para usar el puerto/host guardados.</p>}
        <div class="actions">
          <button type="submit" disabled={busy}>
            Guardar
          </button>
        </div>

        {errors.length > 0 && (
          <ul class="error">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        {message && <p class="ok">{message}</p>}
      </form>

      {status && (
        <section class="editor">
          <h2>Información</h2>
          <dl class="facts">
            <dt>stream_core</dt>
            <dd>{status.version ?? "—"}</dd>
            <dt>Node</dt>
            <dd>
              {status.node} · {status.platform}
            </dd>
            <dt>Modo</dt>
            <dd>{status.mode}</dd>
            <dt>Encendido</dt>
            <dd>
              {formatUptime(status.uptimeSec)} (PID {status.pid})
            </dd>
            <dt>Memoria</dt>
            <dd>
              {status.memoryMb.rss} MB ({status.memoryMb.heapUsed} MB heap)
            </dd>
            <dt>Paneles abiertos</dt>
            <dd>{status.panelClients}</dd>
            <dt>Configuración</dt>
            <dd>
              <code>{status.paths.config}</code>
            </dd>
            <dt>Logs</dt>
            <dd>
              <code>{status.paths.logs}</code>
            </dd>
            <dt>Variables de entorno</dt>
            <dd>
              {Object.keys(status.env).length
                ? Object.entries(status.env).map(([k, v]) => (
                    <div key={k}>
                      <code>
                        {k}={v}
                      </code>
                    </div>
                  ))
                : "ninguna"}
            </dd>
          </dl>

          <h2>Salud de módulos</h2>
          <ul>
            {status.modules.map((m) => (
              <li key={m.id}>
                <span class={`status ${m.state === "ok" ? "on" : "off"}`}>{HEALTH_LABEL[m.state]}</span> {m.name}
                {m.message && <span class="muted"> — {m.message}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
