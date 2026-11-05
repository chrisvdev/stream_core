import { useState } from "preact/hooks";
import type { IndicatorAssignment } from "../../core";
import ButtonEditor from "./ButtonEditor";
import LaunchpadGrid from "./LaunchpadGrid";
import {
  beatStyle,
  keyOf,
  useActionErrors,
  useBindings,
  useBlocked,
  useCatalog,
  useIndicators,
  useLeds,
  usePressed,
  useSettings,
} from "./useCore";

export default function LaunchpadPage() {
  const catalog = useCatalog();
  const bindings = useBindings();
  const leds = useLeds();
  const pressed = usePressed();
  const blocked = useBlocked();
  const { assignments } = useIndicators();
  const [settings] = useSettings();
  const [actionErrors, clearErrors] = useActionErrors();
  const [selected, setSelected] = useState<{ x: number; y: number } | null>(null);

  const indicatorLabel = (a: IndicatorAssignment) => {
    const module = catalog.find((m) => m.id === a.module);
    const indicator = module?.indicators.find((i) => i.id === a.indicator);
    return `${module?.name ?? a.module} · ${indicator?.name ?? a.indicator} (prioridad ${a.priority})`;
  };

  return (
    <div style={beatStyle(settings)}>
      <main>
        <LaunchpadGrid
          leds={leds}
          bindings={bindings}
          pressed={pressed}
          selected={selected}
          indicatorCoords={new Set(assignments.map((a) => keyOf(a.x, a.y)))}
          picking={false}
          blocked={blocked}
          onSelect={(x, y) => setSelected({ x, y })}
        />
        {selected ? (
          <ButtonEditor
            key={keyOf(selected.x, selected.y)}
            x={selected.x}
            y={selected.y}
            binding={bindings.get(keyOf(selected.x, selected.y))}
            catalog={catalog}
            indicators={assignments.filter((a) => a.x === selected.x && a.y === selected.y).map(indicatorLabel)}
          />
        ) : (
          <p class="muted editor">Selecciona un botón para configurarlo.</p>
        )}
      </main>

      {actionErrors.length > 0 && (
        <section class="errors">
          <h2>
            Errores de acciones{" "}
            <button type="button" class="secondary" onClick={clearErrors}>
              Limpiar
            </button>
          </h2>
          <ul>
            {actionErrors.map((e) => (
              <li key={e.at + e.x + e.y}>
                <time>{new Date(e.at).toLocaleTimeString()}</time> ({e.x},{e.y}) {e.module}.{e.action}: {e.message}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
