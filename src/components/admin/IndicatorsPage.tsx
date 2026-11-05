import { useState } from "preact/hooks";
import IndicatorsPanel from "./IndicatorsPanel";
import LaunchpadGrid from "./LaunchpadGrid";
import { beatStyle, keyOf, useBindings, useCatalog, useIndicators, useLeds, usePressed, useSettings } from "./useCore";

type PickHandler = (x: number, y: number) => void;

export default function IndicatorsPage() {
  const catalog = useCatalog();
  const bindings = useBindings();
  const leds = useLeds();
  const pressed = usePressed();
  const { assignments, active } = useIndicators();
  const [settings] = useSettings();
  const [pick, setPick] = useState<{ fn: PickHandler } | null>(null);

  return (
    <div style={beatStyle(settings)}>
      <main>
        <LaunchpadGrid
          leds={leds}
          bindings={bindings}
          pressed={pressed}
          selected={null}
          indicatorCoords={new Set(assignments.map((a) => keyOf(a.x, a.y)))}
          picking={!!pick}
          onSelect={(x, y) => pick?.fn(x, y)}
        />
        <IndicatorsPanel
          catalog={catalog}
          assignments={assignments}
          active={active}
          onPick={(fn) => setPick(fn ? { fn } : null)}
        />
      </main>
    </div>
  );
}
