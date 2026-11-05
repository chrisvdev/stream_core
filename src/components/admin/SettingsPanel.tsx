import { useEffect, useState } from "preact/hooks";
import type { Settings } from "../../core";
import { TEMPO_RANGE } from "../../core/limits";
import { ApiError, api } from "./api";
import AppearanceEditor from "./AppearanceEditor";
import LoggingSettings from "./LoggingSettings";

interface Props {
  settings: Settings;
  onSaved(settings: Settings, restartRequired: boolean): void;
}

const DEVICE_TEMPO = 120;

export default function SettingsPanel({ settings, onSaved }: Props) {
  const [draft, setDraft] = useState(settings);
  const [lastTempo, setLastTempo] = useState(settings.tempo ?? DEVICE_TEMPO);
  const [ports, setPorts] = useState<{ inputs: string[]; outputs: string[] }>({ inputs: [], outputs: [] });
  const [errors, setErrors] = useState<string[]>([]);
  const [status, setStatus] = useState("");

  useEffect(() => {
    api.midiPorts().then(setPorts, (error) => setErrors([`No se pudieron listar los puertos MIDI: ${error}`]));
  }, []);

  const update = (patch: Partial<Settings>) => setDraft((d) => ({ ...d, ...patch }));
  const updateMidi = (patch: Partial<Settings["midi"]>) => setDraft((d) => ({ ...d, midi: { ...d.midi, ...patch } }));
  const setTempo = (bpm: number) => {
    setLastTempo(bpm);
    update({ tempo: bpm });
  };

  const save = async () => {
    setErrors([]);
    setStatus("");
    try {
      const result = await api.saveSettings(draft);
      onSaved(result.settings, result.restartRequired);
      setStatus("Guardado");
    } catch (error) {
      setErrors(error instanceof ApiError ? error.errors : [String(error)]);
    }
  };

  return (
    <form
      class="editor settings"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <h2>Parámetros generales</h2>

      <fieldset>
        <legend>Tempo de pulsing / flashing</legend>
        <label class="inline">
          <input
            type="checkbox"
            checked={draft.tempo !== null}
            onChange={(e) => update({ tempo: e.currentTarget.checked ? lastTempo : null })}
          />
          Usar tempo propio (sin esto el Launchpad usa {DEVICE_TEMPO} BPM)
        </label>
        {draft.tempo !== null && (
          <label class="slider">
            BPM
            <input
              type="range"
              min={TEMPO_RANGE.min}
              max={TEMPO_RANGE.max}
              value={draft.tempo}
              onInput={(e) => setTempo(Number(e.currentTarget.value))}
            />
            <input
              type="number"
              class="narrow"
              min={TEMPO_RANGE.min}
              max={TEMPO_RANGE.max}
              value={draft.tempo}
              onChange={(e) => setTempo(e.currentTarget.valueAsNumber)}
            />
          </label>
        )}
      </fieldset>

      <fieldset>
        <legend>Brillo</legend>
        <label class="slider">
          <input
            type="range"
            min={0}
            max={127}
            value={draft.brightness}
            onInput={(e) => update({ brightness: Number(e.currentTarget.value) })}
          />
          <output>{draft.brightness}</output>
        </label>
      </fieldset>

      <fieldset>
        <legend>Color de botones sin asignar</legend>
        <AppearanceEditor value={draft.idleAppearance} onChange={(idleAppearance) => update({ idleAppearance })} />
      </fieldset>

      <fieldset>
        <legend>MIDI (requiere reinicio)</legend>
        <label>
          <span>Puerto de entrada (vacío = predeterminado)</span>
          <input
            type="text"
            list="midi-inputs"
            value={draft.midi.inputName ?? ""}
            onInput={(e) => updateMidi({ inputName: e.currentTarget.value || undefined })}
          />
          <datalist id="midi-inputs">
            {ports.inputs.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </label>
        <label>
          <span>Puerto de salida (vacío = predeterminado)</span>
          <input
            type="text"
            list="midi-outputs"
            value={draft.midi.outputName ?? ""}
            onInput={(e) => updateMidi({ outputName: e.currentTarget.value || undefined })}
          />
          <datalist id="midi-outputs">
            {ports.outputs.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </label>
        <label class="inline">
          <input type="checkbox" checked={draft.midi.log} onChange={(e) => updateMidi({ log: e.currentTarget.checked })} />
          Registrar mensajes MIDI en consola
        </label>
      </fieldset>

      <LoggingSettings value={draft.logging} onChange={(logging) => update({ logging })} />

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
        <button type="button" class="secondary" onClick={() => setDraft(settings)}>
          Descartar cambios
        </button>
      </div>
    </form>
  );
}
