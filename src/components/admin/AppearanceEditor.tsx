import type { Appearance } from "../../core";
import { appearanceColors } from "../../lib/palette";
import PalettePicker from "./PalettePicker";

interface Props {
  value: Appearance;
  onChange(value: Appearance): void;
}

const MODES: { mode: Appearance["mode"]; label: string }[] = [
  { mode: "static", label: "Fijo" },
  { mode: "pulsing", label: "Pulsante" },
  { mode: "flashing", label: "Intermitente" },
  { mode: "rgb", label: "RGB" },
];

function switchMode(current: Appearance, mode: Appearance["mode"]): Appearance {
  const code = "code" in current ? current.code : 51;
  switch (mode) {
    case "static":
    case "pulsing":
      return { mode, code };
    case "flashing":
      return { mode, code, code2: current.mode === "flashing" ? current.code2 : 0 };
    case "rgb":
      return current.mode === "rgb" ? current : { mode, r: 127, g: 0, b: 127 };
  }
}

export function AppearancePreview({ appearance, size = "2rem" }: { appearance: Appearance; size?: string }) {
  const [c1, c2] = appearanceColors(appearance);
  return (
    <span
      class={`led led-${appearance.mode}`}
      style={{ "--c1": c1, "--c2": c2 ?? "#000", width: size, height: size }}
    />
  );
}

export default function AppearanceEditor({ value, onChange }: Props) {
  return (
    <div class="appearance-editor">
      <div class="tabs">
        {MODES.map(({ mode, label }) => (
          <button
            type="button"
            key={mode}
            class={value.mode === mode ? "active" : ""}
            onClick={() => onChange(switchMode(value, mode))}
          >
            {label}
          </button>
        ))}
        <AppearancePreview appearance={value} />
      </div>

      {(value.mode === "static" || value.mode === "pulsing") && (
        <PalettePicker value={value.code} onChange={(code) => onChange({ ...value, code })} />
      )}

      {value.mode === "flashing" && (
        <>
          <strong>Color A</strong>
          <PalettePicker value={value.code} onChange={(code) => onChange({ ...value, code })} />
          <strong>Color B</strong>
          <PalettePicker value={value.code2} onChange={(code2) => onChange({ ...value, code2 })} />
        </>
      )}

      {value.mode === "rgb" &&
        (["r", "g", "b"] as const).map((channel) => (
          <label key={channel} class="slider">
            {channel.toUpperCase()}
            <input
              type="range"
              min={0}
              max={127}
              value={value[channel]}
              onInput={(e) => onChange({ ...value, [channel]: Number(e.currentTarget.value) })}
            />
            <output>{value[channel]}</output>
          </label>
        ))}
    </div>
  );
}
