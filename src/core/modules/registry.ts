import type {
  ActionDefinition,
  IndicatorDefinition,
  ModuleCatalogEntry,
  ModuleContext,
  ModuleHealth,
  ParamSchema,
  ParamValue,
  Params,
  StreamModule,
} from "./types";
import type { AppContext } from "../context";
import type { EventBus } from "../events";
import { createLogger } from "../logger";

const log = createLogger("core.modules");

export type ParamsResult =
  | { ok: true; params: Params }
  | { ok: false; errors: string[] };

export type ConfigResult =
  | { ok: true; value: unknown }
  | { ok: false; errors: string[] };

export type CommandResult =
  | { ok: true; result: unknown }
  | { ok: false; error: string };

export const paramsOf = (action: ActionDefinition): ParamSchema[] =>
  typeof action.params === "function" ? action.params() : (action.params ?? []);

export class ModuleRegistry {
  #modules = new Map<string, StreamModule>();
  #indicatorCache = new Map<string, IndicatorDefinition[]>();
  #events: EventBus;

  constructor(events: EventBus) {
    this.#events = events;
  }

  register(module: StreamModule) {
    if (this.#modules.has(module.id)) {
      throw new Error(`Module "${module.id}" is already registered`);
    }
    const ids = new Set<string>();
    for (const action of module.actions) {
      if (ids.has(action.id)) {
        throw new Error(`Duplicate action "${action.id}" in module "${module.id}"`);
      }
      ids.add(action.id);
    }
    if (Array.isArray(module.indicators)) {
      const problems = indicatorProblems(module.id, module.indicators);
      if (problems.length) throw new Error(problems.join("\n"));
    }
    this.#modules.set(module.id, module);
  }

  get(moduleId: string): StreamModule | undefined {
    return this.#modules.get(moduleId);
  }

  list(): StreamModule[] {
    return [...this.#modules.values()];
  }

  resolve(moduleId: string, actionId: string): ActionDefinition | undefined {
    return this.#modules.get(moduleId)?.actions.find((a) => a.id === actionId);
  }

  indicatorsOf(moduleId: string): IndicatorDefinition[] {
    const cached = this.#indicatorCache.get(moduleId);
    if (cached) return cached;
    const module = this.#modules.get(moduleId);
    if (!module) return [];

    let list = typeof module.indicators === "function" ? module.indicators() : (module.indicators ?? []);
    const problems = indicatorProblems(module.id, list);
    if (problems.length) {
      // Dynamic lists come from external state, so drop bad entries instead of failing.
      log.warn(`Invalid dynamic indicators from "${module.id}"`, { problems });
      const seen = new Set<string>();
      list = list.filter((i) => i.states.length > 0 && !seen.has(i.id) && !!seen.add(i.id));
    }
    this.#indicatorCache.set(moduleId, list);
    return list;
  }

  resolveIndicator(moduleId: string, indicatorId: string): IndicatorDefinition | undefined {
    return this.indicatorsOf(moduleId).find((i) => i.id === indicatorId);
  }

  catalog(): ModuleCatalogEntry[] {
    return [...this.#modules.values()].map((module) => ({
      id: module.id,
      name: module.name,
      description: module.description,
      actions: module.actions.map((action) => ({
        id: action.id,
        name: action.name,
        description: action.description,
        params: paramsOf(action),
      })),
      indicators: this.indicatorsOf(module.id),
      admin: module.admin && { label: module.admin.label, href: `/admin/modules/${module.id}` },
    }));
  }

  validateParams(action: ActionDefinition, raw: Record<string, unknown> = {}): ParamsResult {
    const params: Params = {};
    const errors: string[] = [];

    for (const schema of paramsOf(action)) {
      const value = raw[schema.key];
      if (value === undefined || value === "") {
        if (schema.default !== undefined) params[schema.key] = schema.default;
        else if (schema.required) errors.push(`"${schema.label}" is required`);
        continue;
      }

      let parsed: ParamValue | undefined;
      switch (schema.type) {
        case "string":
          if (typeof value === "string") parsed = value;
          break;
        case "boolean":
          if (typeof value === "boolean") parsed = value;
          break;
        case "number":
          if (typeof value === "number" && Number.isFinite(value)) {
            if (schema.min !== undefined && value < schema.min) {
              errors.push(`"${schema.label}" must be >= ${schema.min}`);
              continue;
            }
            if (schema.max !== undefined && value > schema.max) {
              errors.push(`"${schema.label}" must be <= ${schema.max}`);
              continue;
            }
            parsed = value;
          }
          break;
        case "select":
          if (typeof value === "string" && (schema.dynamic || schema.options.some((o) => o.value === value))) {
            parsed = value;
          }
          break;
      }

      if (parsed === undefined) errors.push(`"${schema.label}" has an invalid value`);
      else params[schema.key] = parsed;
    }

    return errors.length ? { ok: false, errors } : { ok: true, params };
  }

  configSecrets(moduleId: string): string[] {
    return this.#modules.get(moduleId)?.config?.secrets ?? [];
  }

  hasConfig(moduleId: string): boolean {
    return !!this.#modules.get(moduleId)?.config;
  }

  parseConfig(moduleId: string, raw: unknown): ConfigResult {
    const schema = this.#modules.get(moduleId)?.config?.schema;
    if (!schema) return { ok: false, errors: [`Module "${moduleId}" has no configuration`] };
    const result = schema.safeParse(raw ?? {});
    if (result.success) return { ok: true, value: result.data };
    return { ok: false, errors: result.error.issues.map((i) => `${moduleId}.${i.path.join(".")}: ${i.message}`) };
  }

  status(moduleId: string): unknown {
    return this.#modules.get(moduleId)?.status?.();
  }

  api<T = unknown>(moduleId: string): T | undefined {
    return this.#modules.get(moduleId)?.api as T | undefined;
  }

  healthAll(): (ModuleHealth & { id: string; name: string })[] {
    const result: (ModuleHealth & { id: string; name: string })[] = [];
    for (const module of this.#modules.values()) {
      if (!module.health) continue;
      try {
        result.push({ id: module.id, name: module.name, ...module.health() });
      } catch (error) {
        result.push({ id: module.id, name: module.name, state: "error", message: String(error) });
      }
    }
    return result;
  }

  /** Calls every module's `panic`; one failing module doesn't stop the rest. */
  async panicAll() {
    for (const module of this.#modules.values()) {
      if (!module.panic) continue;
      try {
        await module.panic();
      } catch (error) {
        log.error(`Module "${module.id}" failed to panic`, error);
      }
    }
  }

  async runCommand(moduleId: string, name: string, input: unknown): Promise<CommandResult> {
    const commands = this.#modules.get(moduleId)?.commands;
    if (!commands || !Object.hasOwn(commands, name)) {
      log.warn(`Unknown command ${moduleId}.${name}`);
      return { ok: false, error: `Unknown command ${moduleId}.${name}` };
    }
    const started = performance.now();
    try {
      const result = await commands[name](input);
      log.debug(`Command ${moduleId}.${name} done in ${Math.round(performance.now() - started)} ms`);
      return { ok: true, result };
    } catch (error) {
      log.error(`Command ${moduleId}.${name} failed`, error, { input });
      throw error;
    }
  }

  async initAll(app: AppContext) {
    for (const module of this.#modules.values()) {
      try {
        await module.init?.(this.#context(module, app));
        log.info(`Module "${module.id}" ready`);
      } catch (error) {
        log.error(`Module "${module.id}" failed to initialize`, error);
        throw error;
      }
    }
  }

  async disposeAll() {
    for (const module of [...this.#modules.values()].reverse()) {
      try {
        await module.dispose?.();
        log.debug(`Module "${module.id}" disposed`);
      } catch (error) {
        log.error(`Module "${module.id}" failed to dispose`, error);
      }
    }
  }

  #context(module: StreamModule, app: AppContext): ModuleContext {
    return {
      app,
      log: createLogger(`module.${module.id}`),
      indicator: (id) => app.indicators.handle(module.id, id),
      config: {
        get: () => app.config.getModuleConfig(module.id),
        onChange: (listener) =>
          this.#events.on("module-config", ({ module: id }) => {
            if (id === module.id) listener(app.config.getModuleConfig(module.id));
          }),
      },
      notifyCatalogChanged: () => {
        this.#indicatorCache.delete(module.id);
        log.debug(`Catalog changed for "${module.id}"`);
        this.#events.emit("catalog", { module: module.id });
      },
      notifyStatusChanged: () => {
        this.#events.emit("module-status", { module: module.id, status: module.status?.() });
      },
      module: <T>(id: string) => this.api<T>(id),
    };
  }
}

function indicatorProblems(moduleId: string, indicators: IndicatorDefinition[]): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const indicator of indicators) {
    if (ids.has(indicator.id)) problems.push(`Duplicate indicator "${indicator.id}" in module "${moduleId}"`);
    ids.add(indicator.id);
    const stateIds = new Set(indicator.states.map((s) => s.id));
    if (!indicator.states.length || stateIds.size !== indicator.states.length) {
      problems.push(`Indicator "${moduleId}.${indicator.id}" needs at least one state and unique state ids`);
    }
  }
  return problems;
}
