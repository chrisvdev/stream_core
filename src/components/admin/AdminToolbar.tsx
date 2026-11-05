import { useState } from "preact/hooks";
import { ApiError, api } from "./api";
import { useConnected, useDevice } from "./useCore";

export default function AdminToolbar() {
  const connected = useConnected();
  const [device, setDevice] = useDevice();
  const [notice, setNotice] = useState("");

  const report = (error: unknown) =>
    setNotice(error instanceof ApiError ? error.errors.join("\n") : String(error));

  const toggleSleep = async () => {
    if (!device) return;
    try {
      setDevice(await api.setSleep(!device.sleeping));
    } catch (error) {
      report(error);
    }
  };

  const importFile = async (file: File) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setNotice("El archivo no es JSON válido");
      return;
    }
    try {
      await api.import(parsed);
      setNotice("Configuración importada");
    } catch (error) {
      report(error);
    }
  };

  return (
    <div class="toolbar">
      <span class={`status ${connected ? "on" : "off"}`}>{connected ? "En vivo" : "Desconectado"}</span>
      {device?.locked && (
        <a class="status off" href="/admin/modules/system" title="Los botones físicos están bloqueados">
          Bloqueado
        </a>
      )}
      <button type="button" class="secondary" disabled={!device} onClick={toggleSleep}>
        {device?.sleeping ? "Encender LEDs" : "Apagar LEDs"}
      </button>
      <a class="button secondary" href="/api/config/export" download="config.json" title="No incluye secretos (contraseñas)">
        Exportar
      </a>
      <label class="button secondary">
        Importar
        <input
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = "";
            if (file) importFile(file);
          }}
        />
      </label>
      {notice && (
        <pre class="notice toolbar-notice" onClick={() => setNotice("")} title="Clic para cerrar">
          {notice}
        </pre>
      )}
    </div>
  );
}
