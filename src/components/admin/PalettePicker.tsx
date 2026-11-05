import { paletteCss } from "../../lib/palette";

interface Props {
  value: number;
  onChange(code: number): void;
}

const BANKS = [
  { label: "Banco bajo (0–63)", start: 0 },
  { label: "Banco alto (64–127)", start: 64 },
];

export default function PalettePicker({ value, onChange }: Props) {
  return (
    <div class="palette">
      {BANKS.map((bank) => (
        <div key={bank.start}>
          <small>{bank.label}</small>
          <div class="palette-grid">
            {Array.from({ length: 64 }, (_, i) => bank.start + i).map((code) => (
              <button
                type="button"
                key={code}
                class={`swatch${code === value ? " selected" : ""}`}
                style={{ background: paletteCss(code) }}
                title={String(code)}
                onClick={() => onChange(code)}
              />
            ))}
          </div>
        </div>
      ))}
      <small>Código seleccionado: {value}</small>
    </div>
  );
}
