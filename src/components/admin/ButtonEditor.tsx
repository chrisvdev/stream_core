import { useState } from "preact/hooks";
import type { Appearance, Binding, BindingData, ButtonEvent, ModuleCatalogEntry, Params } from "../../core";
import { ApiError, api } from "./api";
import AppearanceEditor from "./AppearanceEditor";
import ParamsForm, { defaultParams } from "./ParamsForm";

interface Props {
  x: number;
  y: number;
  binding?: Binding;
  catalog: ModuleCatalogEntry[];
  /** Read-only labels of indicators assigned to this location. */
  indicators: string[];
}

const DEFAULT_IDENTITY: Appearance = { mode: "static", code: 51 };

export default function ButtonEditor({ x, y, binding, catalog, indicators }: Props) {
  const [name, setName] = useState(binding?.name ?? "");
  const [description, setDescription] = useState(binding?.description ?? "");
  const [hasAppearance, setHasAppearance] = useState(!!binding?.appearance);
  const [appearance, setAppearance] = useState<Appearance>(binding?.appearance ?? DEFAULT_IDENTITY);
  const [actionKey, setActionKey] = useState(binding?.action ? `${binding.action.module}/${binding.action.action}` : "");
  const [params, setParams] = useState<Params>(binding?.action?.params ?? {});
  const [errors, setErrors] = useState<string[]>([]);
  const [status, setStatus] = useState("");

  const [moduleId, actionId] = actionKey.split("/");
  const action = catalog.find((m) => m.id === moduleId)?.actions.find((a) => a.id === actionId);

  const run = async (task: () => Promise<unknown>, done: string) => {
    setErrors([]);
    setStatus("");
    try {
      await task();
      setStatus(done);
    } catch (error) {
      setErrors(error instanceof ApiError ? error.errors : [String(error)]);
    }
  };

  const save = () => {
    const data: BindingData = {
      name: name.trim() || undefined,
      description: description.trim() || undefined,
      appearance: hasAppearance ? appearance : undefined,
      action: action ? { module: moduleId, action: actionId, params } : undefined,
    };
    return run(() => api.save(x, y, data), "Guardado");
  };

  const test = (event: ButtonEvent) => run(() => api.test(x, y, event), `Evento ${event} enviado`);

  return (
    <form
      class="editor"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <h2>
        Botón ({x}, {y})
      </h2>

      <label>
        <span>Nombre</span>
        <input type="text" maxLength={100} value={name} onInput={(e) => setName(e.currentTarget.value)} />
      </label>
      <label>
        <span>Descripción / notas</span>
        <textarea maxLength={1000} rows={3} value={description} onInput={(e) => setDescription(e.currentTarget.value)} />
      </label>

      <fieldset>
        <legend>
          <label class="inline">
            <input type="checkbox" checked={hasAppearance} onChange={(e) => setHasAppearance(e.currentTarget.checked)} />
            Color de identificación
          </label>
        </legend>
        {hasAppearance && <AppearanceEditor value={appearance} onChange={setAppearance} />}
      </fieldset>

      {indicators.length > 0 && (
        <fieldset>
          <legend>Indicadores en esta ubicación</legend>
          <ul class="muted">
            {indicators.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
          <a class="button secondary" href="/admin/indicators">
            Editar indicadores
          </a>
        </fieldset>
      )}

      <fieldset>
        <legend>Acción</legend>
        <select
          value={actionKey}
          onChange={(e) => {
            const key = e.currentTarget.value;
            const [m, a] = key.split("/");
            const next = catalog.find((c) => c.id === m)?.actions.find((c) => c.id === a);
            setActionKey(key);
            setParams(next ? defaultParams(next.params) : {});
          }}
        >
          <option value="">Ninguna</option>
          {catalog.map((module) => (
            <optgroup key={module.id} label={module.name}>
              {module.actions.map((a) => (
                <option key={a.id} value={`${module.id}/${a.id}`}>
                  {a.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {actionKey && !action && <p class="error">La acción guardada ya no existe.</p>}
        {action?.description && <p class="muted">{action.description}</p>}
        {action && <ParamsForm schemas={action.params} values={params} onChange={setParams} />}
      </fieldset>

      {errors.length > 0 && (
        <ul class="error">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      {status && <p class="ok">{status}</p>}

      <div class="actions">
        <button type="submit">Guardar</button>
        <button
          type="button"
          class="secondary"
          onPointerDown={() => test("press")}
          onPointerUp={() => test("release")}
          title="Mantener presionado para simular press/release"
        >
          Probar
        </button>
        {binding && (
          <button type="button" class="danger" onClick={() => run(() => api.remove(x, y), "Eliminado")}>
            Eliminar
          </button>
        )}
      </div>
    </form>
  );
}
