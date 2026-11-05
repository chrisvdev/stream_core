import { useState } from "preact/hooks";
import SettingsPanel from "./SettingsPanel";
import { beatStyle, useSettings } from "./useCore";

export default function GeneralPage() {
  const [settings, setSettings] = useSettings();
  const [restartRequired, setRestartRequired] = useState(false);

  if (!settings) return <p class="muted">Cargando…</p>;

  return (
    <div style={beatStyle(settings)}>
      {restartRequired && (
        <p class="notice">Cambiaste la configuración MIDI: reinicia el servidor para aplicarla.</p>
      )}
      <SettingsPanel
        settings={settings}
        onSaved={(saved, restart) => {
          setSettings(saved);
          if (restart) setRestartRequired(true);
        }}
      />
    </div>
  );
}
