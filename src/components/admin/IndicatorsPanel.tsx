import { useEffect, useState } from "preact/hooks";
import type { ActiveIndicator, Appearance, IndicatorAssignment, IndicatorDefinition, ModuleCatalogEntry } from "../../core";
import { ApiError, api } from "./api";
import AppearanceEditor, { AppearancePreview } from "./AppearanceEditor";

interface Props {
  catalog: ModuleCatalogEntry[];
  assignments: IndicatorAssignment[];
  active: ActiveIndicator[];
  /** Pass a callback to let the user pick a grid location, or null to cancel. */
  onPick(callback: ((x: number, y: number) => void) | null): void;
}

const sameIndicator = (a: IndicatorAssignment, module: string, indicator: string) =>
  a.module === module && a.indicator === indicator;

export default function IndicatorsPanel({ catalog, assignments, active, onPick }: Props) {
  const [draft, setDraft] = useState(assignments);
  const [dirty, setDirty] = useState(false);
  const [pickingFor, setPickingFor] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [onlyAssigned, setOnlyAssigned] = useState(false);

  useEffect(() => {
    if (!dirty) setDraft(assignments);
  }, [assignments]);

  useEffect(() => () => onPick(null), []);

  const change = (next: IndicatorAssignment[]) => {
    setDraft(next);
    setDirty(true);
    setStatus("");
  };

  const updateAt = (target: IndicatorAssignment, patch: Partial<IndicatorAssignment>) =>
    change(draft.map((a) => (a === target ? { ...a, ...patch } : a)));

  const startPick = (module: string, indicator: string) => {
    const label = `${module}.${indicator}`;
    if (pickingFor === label) {
      setPickingFor(null);
      onPick(null);
      return;
    }
    setPickingFor(label);
    onPick((x, y) => {
      setPickingFor(null);
      onPick(null);
      setDraft((current) => {
        if (current.some((a) => sameIndicator(a, module, indicator) && a.x === x && a.y === y)) return current;
        setDirty(true);
        return [...current, { module, indicator, x, y, priority: 0, states: {} }];
      });
    });
  };

  const run = async (task: () => Promise<unknown>, done?: string) => {
    setErrors([]);
    try {
      await task();
      if (done) setStatus(done);
    } catch (error) {
      setErrors(error instanceof ApiError ? error.errors : [String(error)]);
    }
  };

  const save = () =>
    run(async () => {
      await api.saveIndicators(draft);
      setDirty(false);
    }, "Guardado");

  const withIndicators = catalog.filter((m) => m.indicators.length);
  const query = search.trim().toLowerCase();
  const known = new Set(catalog.flatMap((m) => m.indicators.map((i) => `${m.id}\u0000${i.id}`)));
  const orphans = draft.filter((a) => !known.has(`${a.module}\u0000${a.indicator}`));

  return (
    <div class="editor indicators">
      <h2>Indicadores</h2>
      <p class="muted">
        Los indicadores se superponen al color del botón mientras están activos, sin modificar su configuración ni su
        acción. Si varios coinciden en una ubicación, gana la mayor prioridad y, en empate, el más reciente.
      </p>

      <div class="assignment-row">
        <input
          type="search"
          placeholder="Buscar indicador…"
          value={search}
          onInput={(e) => setSearch(e.currentTarget.value)}
        />
        <label class="inline">
          <input type="checkbox" checked={onlyAssigned} onChange={(e) => setOnlyAssigned(e.currentTarget.checked)} />
          Solo asignados
        </label>
      </div>

      {withIndicators.length === 0 && <p class="muted">Ningún módulo declara indicadores.</p>}

      {withIndicators.map((module) => {
        const visible = module.indicators.filter(
          (indicator) =>
            (!query || indicator.name.toLowerCase().includes(query)) &&
            (!onlyAssigned || draft.some((a) => sameIndicator(a, module.id, indicator.id)))
        );
        if (!visible.length) return null;
        return (
          <details key={module.id} class="indicator-group" open={!!query || onlyAssigned || module.indicators.length <= 8}>
            <summary>
              {module.name} <small class="muted">({visible.length})</small>
            </summary>
            {visible.map((indicator) => {
          const label = `${module.id}.${indicator.id}`;
          const activeState = active.find((a) => a.module === module.id && a.indicator === indicator.id)?.state;
          const locations = draft.filter((a) => sameIndicator(a, module.id, indicator.id));
          return (
            <fieldset key={label}>
              <legend>
                {module.name} · {indicator.name}{" "}
                <span class={`status ${activeState ? "on" : "off"}`}>
                  {activeState ? indicator.states.find((s) => s.id === activeState)?.name : "inactivo"}
                </span>
              </legend>
              {indicator.description && <p class="muted">{indicator.description}</p>}

              <div class="actions wrap">
                {indicator.states.map((state) => (
                  <button
                    type="button"
                    key={state.id}
                    class={activeState === state.id ? "" : "secondary"}
                    onClick={() => run(() => api.testIndicator(module.id, indicator.id, state.id))}
                  >
                    <AppearancePreview appearance={state.appearance} size="0.9rem" /> {state.name}
                  </button>
                ))}
                <button
                  type="button"
                  class="secondary"
                  disabled={!activeState}
                  onClick={() => run(() => api.testIndicator(module.id, indicator.id, null))}
                >
                  Limpiar
                </button>
              </div>

              {locations.length === 0 && <p class="muted">Sin ubicaciones asignadas.</p>}
              {locations.map((assignment) => (
                <AssignmentRow
                  key={`${assignment.x},${assignment.y}`}
                  assignment={assignment}
                  definition={indicator}
                  onChange={(patch) => updateAt(assignment, patch)}
                  onRemove={() => change(draft.filter((a) => a !== assignment))}
                />
              ))}

              <button type="button" class="secondary" onClick={() => startPick(module.id, indicator.id)}>
                {pickingFor === label ? "Cancelar (elige una celda en la grilla)" : "Agregar ubicación"}
              </button>
            </fieldset>
          );
            })}
          </details>
        );
      })}

      {orphans.length > 0 && (
        <fieldset>
          <legend>Asignaciones no disponibles</legend>
          <p class="muted">
            Su indicador no existe ahora mismo (por ejemplo, el módulo está desconectado o el elemento se eliminó). Se
            conservan hasta que las quites.
          </p>
          {orphans.map((a) => (
            <div key={`${a.module}.${a.indicator}@${a.x},${a.y}`} class="assignment-row">
              <code>
                {a.module}.{a.indicator}
              </code>
              <span>
                ({a.x}, {a.y})
              </span>
              <button type="button" class="danger" onClick={() => change(draft.filter((d) => d !== a))}>
                Quitar
              </button>
            </div>
          ))}
        </fieldset>
      )}

      {errors.length > 0 && (
        <ul class="error">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      {status && <p class="ok">{status}</p>}

      <div class="actions">
        <button type="button" disabled={!dirty} onClick={save}>
          Guardar
        </button>
        <button
          type="button"
          class="secondary"
          disabled={!dirty}
          onClick={() => {
            setDraft(assignments);
            setDirty(false);
          }}
        >
          Descartar cambios
        </button>
      </div>
    </div>
  );
}

interface RowProps {
  assignment: IndicatorAssignment;
  definition: IndicatorDefinition;
  onChange(patch: Partial<IndicatorAssignment>): void;
  onRemove(): void;
}

function AssignmentRow({ assignment, definition, onChange, onRemove }: RowProps) {
  const [open, setOpen] = useState(false);

  const setOverride = (stateId: string, appearance: Appearance | null) => {
    const { [stateId]: _, ...rest } = assignment.states;
    onChange({ states: appearance ? { ...rest, [stateId]: appearance } : rest });
  };

  return (
    <div class="assignment">
      <div class="assignment-row">
        <strong>
          ({assignment.x}, {assignment.y})
        </strong>
        <label class="inline">
          Prioridad
          <input
            type="number"
            class="narrow"
            min={-100}
            max={100}
            value={assignment.priority}
            onChange={(e) => onChange({ priority: Number.isNaN(e.currentTarget.valueAsNumber) ? 0 : e.currentTarget.valueAsNumber })}
          />
        </label>
        <button type="button" class="secondary" onClick={() => setOpen(!open)}>
          {open ? "Ocultar colores" : "Colores"}
        </button>
        <button type="button" class="danger" onClick={onRemove}>
          Quitar
        </button>
      </div>

      {open &&
        definition.states.map((state) => {
          const override = assignment.states[state.id];
          return (
            <div key={state.id} class="state-override">
              <label class="inline">
                <input
                  type="checkbox"
                  checked={!!override}
                  onChange={(e) => setOverride(state.id, e.currentTarget.checked ? state.appearance : null)}
                />
                {state.name}: color personalizado
                {!override && <AppearancePreview appearance={state.appearance} size="1rem" />}
              </label>
              {override && <AppearanceEditor value={override} onChange={(a) => setOverride(state.id, a)} />}
            </div>
          );
        })}
    </div>
  );
}
