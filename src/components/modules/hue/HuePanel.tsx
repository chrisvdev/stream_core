import { useEffect, useState } from "preact/hooks";
import type { HueConfig } from "../../../modules/hue/config";
import type { HueModuleStatus } from "../../../modules/hue/index";
import type { DiscoveredBridge } from "../../../modules/hue/discovery";
import { ApiError, api } from "../../admin/api";
import { useCoreEvent } from "../../admin/useCore";

const MODULE = "hue";
const EFFECTS = [
  { id: "solid", label: "Color fijo" },
  { id: "strobe", label: "Strobe" },
  { id: "pulse", label: "Pulso" },
  { id: "rainbow", label: "Arcoíris" },
  { id: "chase", label: "Persecución" },
] as const;

const STATE_LABEL: Record<HueModuleStatus["state"], string> = {
  unpaired: "Sin emparejar",
  disconnected: "Desconectado",
  connecting: "Conectando…",
  connected: "Conectado",
  error: "Error",
};

const COORDINATES = Array.from({ length: 81 }, (_, i) => `${i % 9},${Math.floor(i / 9)}`);

type Values = Omit<HueConfig, "appKey" | "clientKey">;

export default function HuePanel() {
  const [values, setValues] = useState<Values | null>(null);
  const [paired, setPaired] = useState(false);
  const [status, setStatus] = useState<HueModuleStatus | null>(null);
  const [bridges, setBridges] = useState<DiscoveredBridge[] | null>(null);
  const [ip, setIp] = useState("");
  const [areaId, setAreaId] = useState("");
  const [testColor, setTestColor] = useState("#ff0000");
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const loadConfig = async () => {
    const { values: v, secrets } = await api.moduleConfig(MODULE);
    const config = v as Values;
    setValues(config);
    setPaired(Boolean(secrets.appKey));
    setIp((current) => current || config.bridgeIp || "");
  };

  useEffect(() => {
    loadConfig();
    api.moduleStatus<HueModuleStatus>(MODULE).then(setStatus);
  }, []);

  useCoreEvent("module-status", ({ module, status }) => {
    if (module === MODULE) setStatus(status as HueModuleStatus);
  });
  useCoreEvent("module-config", ({ module }) => {
    if (module === MODULE) loadConfig();
  });

  useEffect(() => {
    if (!areaId && status?.areas.length) setAreaId(status.areas[0].id);
  }, [status?.areas.length]);

  const run = async (task: () => Promise<unknown>, done?: string) => {
    setErrors([]);
    setMessage("");
    setBusy(true);
    try {
      await task();
      if (done) setMessage(done);
    } catch (error) {
      setErrors(error instanceof ApiError ? error.errors : [String(error)]);
    } finally {
      setBusy(false);
    }
  };

  const command = (name: string, input: unknown = {}) => api.moduleCommand(MODULE, name, input);
  const save = (next: Values) => run(async () => setValues(await api.saveModuleConfig(MODULE, next).then((r) => r.values as Values)), "Guardado");

  if (!values) return <p class="muted">Cargando…</p>;

  const pairingState = status?.pairing;
  const connected = status?.state === "connected";
  const area = status?.areas.find((a) => a.id === areaId);
  const mirror = values.entertainment.mirror[areaId] ?? { enabled: false, channels: {} };
  const streaming = status?.streaming.includes(areaId) ?? false;

  const setMirrorChannel = (channelId: number, coordinate: string) => {
    const channels = { ...mirror.channels };
    if (coordinate) channels[String(channelId)] = coordinate;
    else delete channels[String(channelId)];
    setValues({
      ...values,
      entertainment: { ...values.entertainment, mirror: { ...values.entertainment.mirror, [areaId]: { ...mirror, channels } } },
    });
  };

  const toggleMirror = (enabled: boolean) =>
    run(async () => {
      const next = {
        ...values,
        entertainment: { ...values.entertainment, mirror: { ...values.entertainment.mirror, [areaId]: { ...mirror, enabled } } },
      };
      await api.saveModuleConfig(MODULE, next);
      setValues(next);
      await command("setMirror", { areaId, enabled });
    }, enabled ? "Espejo activado" : "Espejo desactivado");

  return (
    <main class="module-page">
      <section class="editor">
        <h2>
          Bridge{" "}
          <span class={`status ${connected ? "on" : "off"}`}>{status ? STATE_LABEL[status.state] : "Sin datos"}</span>
        </h2>
        {status?.error && <p class="error">{status.error}</p>}
        {status && paired && (
          <dl class="facts">
            <dt>Bridge</dt>
            <dd>
              {status.bridgeName ?? "—"} ({status.bridgeIp ?? "—"})
            </dd>
            <dt>ID</dt>
            <dd>{status.bridgeId ?? "—"}</dd>
            <dt>Software</dt>
            <dd>{status.softwareVersion ?? "—"}</dd>
            <dt>Detectado</dt>
            <dd>
              {status.counts.lights} luces · {status.counts.rooms} rooms · {status.counts.zones} zones · {status.counts.scenes}{" "}
              escenas · {status.counts.smartScenes} smart scenes · {status.counts.areas} áreas · {status.counts.devices}{" "}
              dispositivos
            </dd>
          </dl>
        )}

        <fieldset>
          <legend>{paired ? "Cambiar de bridge" : "Emparejar"}</legend>
          <div class="actions wrap">
            <button type="button" class="secondary" disabled={busy} onClick={() => run(async () => setBridges((await command("discover")) as DiscoveredBridge[]))}>
              Buscar bridges
            </button>
          </div>
          {bridges && bridges.length === 0 && <p class="muted">No se encontró ninguno; escribe la IP a mano.</p>}
          {bridges?.map((b) => (
            <div key={b.id} class="assignment-row">
              <code>{b.ip}</code>
              <span class="muted">
                {b.name ?? b.id} ({b.source === "mdns" ? "red local" : "nube"})
              </span>
              <button type="button" class="secondary" onClick={() => setIp(b.ip)}>
                Usar
              </button>
            </div>
          ))}
          <label>
            <span>IP del bridge</span>
            <input type="text" value={ip} placeholder="192.168.x.x" onInput={(e) => setIp(e.currentTarget.value.trim())} />
          </label>
          {pairingState?.state === "waiting" ? (
            <div class="notice">
              Presiona el botón redondo del bridge… ({Math.ceil(pairingState.remainingMs / 1000)} s){" "}
              <button type="button" class="secondary" onClick={() => run(() => command("cancelPair"))}>
                Cancelar
              </button>
            </div>
          ) : (
            <button type="button" disabled={busy || !ip} onClick={() => run(() => command("pair", { ip }))}>
              Emparejar
            </button>
          )}
          {pairingState && pairingState.state !== "waiting" && pairingState.message && <p class="error">{pairingState.message}</p>}
        </fieldset>

        <label class="inline">
          <input
            type="checkbox"
            checked={values.autoConnect}
            onChange={(e) => save({ ...values, autoConnect: e.currentTarget.checked })}
          />
          Conectar automáticamente y reconectar si se corta
        </label>

        <div class="actions wrap">
          {connected ? (
            <button type="button" class="secondary" disabled={busy} onClick={() => run(() => command("disconnect"))}>
              Desconectar
            </button>
          ) : (
            <button type="button" disabled={busy || !paired} onClick={() => run(() => command("connect"))}>
              Conectar
            </button>
          )}
          <button type="button" class="secondary" disabled={busy || !connected} onClick={() => run(() => command("refresh"), "Datos actualizados")}>
            Refrescar
          </button>
          {paired && (
            <button
              type="button"
              class="danger"
              disabled={busy}
              onClick={() => confirm("¿Olvidar este bridge? Habrá que volver a emparejar.") && run(() => command("forget"), "Bridge olvidado")}
            >
              Olvidar bridge
            </button>
          )}
        </div>
        <p class="muted">La clave del bridge no se incluye al exportar la configuración.</p>
      </section>

      <section class="editor">
        <h2>Entertainment</h2>
        {!status?.areas.length ? (
          <p class="muted">No hay áreas de entertainment. Créalas en la app Hue.</p>
        ) : (
          <>
            <label>
              <span>Área</span>
              <select value={areaId} onChange={(e) => setAreaId(e.currentTarget.value)}>
                {status.areas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} {status.streaming.includes(a.id) ? "· streaming" : a.active ? "· activa por otra app" : ""}
                  </option>
                ))}
              </select>
            </label>

            <fieldset>
              <legend>Probar efectos</legend>
              <div class="actions wrap">
                <input type="color" value={testColor} onInput={(e) => setTestColor(e.currentTarget.value)} />
                {EFFECTS.map((effect) => (
                  <button
                    type="button"
                    key={effect.id}
                    class="secondary"
                    disabled={busy || !connected}
                    onClick={() => run(() => command("testEffect", { areaId, effect: effect.id, color: testColor, ms: 3_000 }))}
                  >
                    {effect.label}
                  </button>
                ))}
                <button type="button" class="danger" disabled={busy || !streaming} onClick={() => run(() => command("stopStreaming"))}>
                  Detener streaming
                </button>
              </div>
            </fieldset>

            <fieldset>
              <legend>Espejo del Launchpad</legend>
              <p class="muted">Cada canal del área copia el color del botón asignado (incluye pulso e intermitencia).</p>
              {area?.channels.map((channel) => (
                <div key={channel.id} class="assignment-row">
                  <span>
                    Canal {channel.id}{" "}
                    <small class="muted">
                      (x {channel.position.x.toFixed(2)}, y {channel.position.y.toFixed(2)})
                    </small>
                  </span>
                  <select value={mirror.channels[String(channel.id)] ?? ""} onChange={(e) => setMirrorChannel(channel.id, e.currentTarget.value)}>
                    <option value="">—</option>
                    {COORDINATES.map((c) => (
                      <option key={c} value={c}>
                        ({c})
                      </option>
                    ))}
                  </select>
                </div>
              ))}
              <div class="actions wrap">
                <button type="button" class="secondary" disabled={busy} onClick={() => save(values)}>
                  Guardar asignación
                </button>
                <button type="button" disabled={busy || !connected} onClick={() => toggleMirror(!mirror.enabled)}>
                  {mirror.enabled ? "Desactivar espejo" : "Activar espejo"}
                </button>
              </div>
            </fieldset>

            <label>
              <span>Frames por segundo</span>
              <input
                type="number"
                min={10}
                max={60}
                value={values.entertainment.fps}
                onChange={(e) =>
                  save({ ...values, entertainment: { ...values.entertainment, fps: e.currentTarget.valueAsNumber || 50 } })
                }
              />
            </label>
          </>
        )}

        {errors.length > 0 && (
          <ul class="error">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        {message && <p class="ok">{message}</p>}
      </section>

      {status && connected && (
        <section class="editor">
          <h2>Recursos</h2>
          <details>
            <summary>Luces ({status.lights.length})</summary>
            <ul>
              {status.lights.map((l) => (
                <li key={l.id}>
                  {l.name} — {!l.reachable ? "inalcanzable" : l.on ? "encendida" : "apagada"}
                </li>
              ))}
            </ul>
          </details>
          <details>
            <summary>Rooms y zones ({status.groups.length})</summary>
            <ul>
              {status.groups.map((g) => (
                <li key={g.id}>
                  {g.name} ({g.kind}) — {g.on ? "encendido" : "apagado"}
                </li>
              ))}
            </ul>
          </details>
          <details>
            <summary>Escenas ({status.scenes.length})</summary>
            <ul>
              {status.scenes.map((s) => (
                <li key={s.id}>
                  {s.groupName} / {s.name} {s.active !== "inactive" && <strong>· activa</strong>}
                </li>
              ))}
            </ul>
          </details>
          <details>
            <summary>Smart scenes ({status.smartScenes.length})</summary>
            <ul>
              {status.smartScenes.map((s) => (
                <li key={s.id}>
                  {s.groupName} / {s.name} {s.active && <strong>· activa</strong>}
                </li>
              ))}
            </ul>
          </details>
          <p class="muted">
            Todo esto aparece como acciones en el <a href="/admin/launchpad">Launchpad</a> y como{" "}
            <a href="/admin/indicators">indicadores</a>.
          </p>
        </section>
      )}
    </main>
  );
}
