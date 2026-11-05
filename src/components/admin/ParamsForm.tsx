import type { ParamSchema, ParamValue, Params } from "../../core";

interface Props {
  schemas: ParamSchema[];
  values: Params;
  onChange(values: Params): void;
}

export function defaultParams(schemas: ParamSchema[]): Params {
  const params: Params = {};
  for (const schema of schemas) {
    if (schema.default !== undefined) params[schema.key] = schema.default;
  }
  return params;
}

export default function ParamsForm({ schemas, values, onChange }: Props) {
  if (!schemas.length) return <p class="muted">Esta acción no tiene parámetros.</p>;

  const set = (key: string, value: ParamValue) => onChange({ ...values, [key]: value });
  const unset = (key: string) => {
    const { [key]: _, ...rest } = values;
    onChange(rest);
  };

  return (
    <div class="params">
      {schemas.map((schema) => {
        const value = values[schema.key];
        let input;
        switch (schema.type) {
          case "string":
            input = (
              <input
                type="text"
                value={typeof value === "string" ? value : ""}
                onInput={(e) => set(schema.key, e.currentTarget.value)}
              />
            );
            break;
          case "number":
            input = (
              <input
                type="number"
                min={schema.min}
                max={schema.max}
                value={typeof value === "number" ? value : ""}
                onInput={(e) => {
                  const n = e.currentTarget.valueAsNumber;
                  if (Number.isNaN(n)) unset(schema.key);
                  else set(schema.key, n);
                }}
              />
            );
            break;
          case "boolean":
            input = (
              <input
                type="checkbox"
                checked={value === true}
                onChange={(e) => set(schema.key, e.currentTarget.checked)}
              />
            );
            break;
          case "select": {
            const current = typeof value === "string" ? value : "";
            const missing = current !== "" && !schema.options.some((o) => o.value === current);
            input = (
              <select value={current} onChange={(e) => set(schema.key, e.currentTarget.value)}>
                {current === "" && <option value="">Elegir…</option>}
                {missing && <option value={current}>(no disponible) {current}</option>}
                {schema.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            );
            break;
          }
        }
        return (
          <label key={schema.key} title={schema.description}>
            <span>
              {schema.label}
              {schema.required ? " *" : ""}
            </span>
            {input}
          </label>
        );
      })}
    </div>
  );
}
