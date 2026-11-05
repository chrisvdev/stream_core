import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { EventBus, SettingsKey } from "../events";
import { createLogger } from "../logger";
import type { ModuleRegistry } from "../modules/registry";
import {
  configFileSchema,
  legacyBindingsFileSchema,
  settingsSchema,
  type Binding,
  type BindingData,
  type ConfigFile,
  type ImportFile,
  type IndicatorAssignment,
  type Settings,
} from "./schema";

const key = (x: number, y: number) => `${x},${y}`;
const LEGACY_PATH = "data/bindings.json";
const log = createLogger("core.config");

type Section = Record<string, unknown>;

export interface MaskedModuleConfig {
  values: Section;
  /** Whether each secret currently has a value; the values themselves are never sent. */
  secrets: Record<string, boolean>;
}

export type ModuleConfigUpdate = { ok: true } | { ok: false; errors: string[] };

export class ConfigRepository {
  readonly path: string;
  #settings: Settings = settingsSchema.parse({});
  #bindings = new Map<string, Binding>();
  #indicators: IndicatorAssignment[] = [];
  #modules: Record<string, unknown> = {};
  #registry: ModuleRegistry;
  #events: EventBus;
  #writes: Promise<void> = Promise.resolve();

  constructor(events: EventBus, registry: ModuleRegistry, path = process.env.CONFIG_FILE ?? "data/config.json") {
    this.path = resolve(path);
    this.#events = events;
    this.#registry = registry;
  }

  async load() {
    const raw = await readJson(this.path);
    if (raw !== undefined) {
      const result = configFileSchema.safeParse(raw);
      if (!result.success) throw new Error(`Invalid config file ${this.path}:\n${result.error.message}`);
      this.#settings = result.data.settings;
      this.#setButtons(result.data.buttons);
      this.#indicators = result.data.indicators;
      this.#modules = this.#validateModules(result.data.modules, (errors) => {
        throw new Error(`Invalid module config in ${this.path}:\n${errors.join("\n")}`);
      });
      return;
    }

    const legacy = await readJson(resolve(LEGACY_PATH));
    if (legacy !== undefined) {
      const result = legacyBindingsFileSchema.safeParse(legacy);
      if (!result.success) throw new Error(`Invalid legacy bindings file ${LEGACY_PATH}:\n${result.error.message}`);
      this.#setButtons(result.data.buttons);
      log.info(`Migrated ${LEGACY_PATH} to ${this.path}`);
    }
    this.#modules = this.#validateModules({}, (errors) => {
      throw new Error(`Invalid module defaults:\n${errors.join("\n")}`);
    });
    await this.#persist();
  }

  getModuleConfig<C = unknown>(moduleId: string): C {
    return this.#modules[moduleId] as C;
  }

  getMaskedModuleConfig(moduleId: string): MaskedModuleConfig {
    const values = { ...((this.#modules[moduleId] as Section | undefined) ?? {}) };
    const secrets: Record<string, boolean> = {};
    for (const secret of this.#registry.configSecrets(moduleId)) {
      secrets[secret] = values[secret] !== undefined && values[secret] !== "";
      delete values[secret];
    }
    return { values, secrets };
  }

  /** Secrets left `undefined` or `""` keep their current value; `null` clears them. */
  async setModuleConfig(moduleId: string, raw: Section): Promise<ModuleConfigUpdate> {
    const merged = this.#mergeSecrets(moduleId, raw, (this.#modules[moduleId] as Section | undefined) ?? {});
    const result = this.#registry.parseConfig(moduleId, merged);
    if (!result.ok) return result;
    this.#modules = { ...this.#modules, [moduleId]: result.value };
    await this.#persist();
    this.#events.emit("module-config", { module: moduleId });
    return { ok: true };
  }

  getSettings(): Settings {
    return this.#settings;
  }

  async updateSettings(settings: Settings) {
    const changed = (Object.keys(settings) as SettingsKey[]).filter(
      (k) => !isDeepStrictEqual(settings[k], this.#settings[k])
    );
    this.#settings = settings;
    await this.#persist();
    if (changed.length) this.#events.emit("settings", { settings, changed });
    return changed;
  }

  list(): Binding[] {
    return [...this.#bindings.values()];
  }

  get(x: number, y: number): Binding | undefined {
    return this.#bindings.get(key(x, y));
  }

  /** `redactSecrets` is for exports: module secrets never leave the machine. */
  toFile({ redactSecrets = false } = {}): ConfigFile {
    const buttons = this.list().sort((a, b) => a.y - b.y || a.x - b.x);
    const modules = redactSecrets ? this.#redactSecrets(this.#modules) : this.#modules;
    return { version: 2, settings: this.#settings, buttons, indicators: this.#indicators, modules };
  }

  listIndicators(): IndicatorAssignment[] {
    return this.#indicators;
  }

  async replaceIndicators(indicators: IndicatorAssignment[]) {
    this.#indicators = indicators;
    await this.#persist();
    this.#events.emit("indicators-config", null);
  }

  async upsert(x: number, y: number, data: BindingData) {
    const binding: Binding = { ...data, x, y };
    this.#bindings.set(key(x, y), binding);
    await this.#persist();
    this.#events.emit("bindings", { x, y });
    return binding;
  }

  async remove(x: number, y: number) {
    if (!this.#bindings.delete(key(x, y))) return false;
    await this.#persist();
    this.#events.emit("bindings", { x, y });
    return true;
  }

  /**
   * Version 1 files only replace buttons; version 2 also replaces settings, indicators and module sections.
   * Returns validation errors without applying anything if a module section is invalid.
   */
  async replaceAll(file: ImportFile): Promise<string[]> {
    let modules = this.#modules;
    if (file.version === 2) {
      const imported: Record<string, unknown> = {};
      for (const [id, section] of Object.entries(file.modules)) {
        const current = (this.#modules[id] as Section | undefined) ?? {};
        imported[id] = isSection(section) ? this.#mergeSecrets(id, section, current) : section;
      }
      const errors: string[] = [];
      modules = this.#validateModules(imported, (e) => errors.push(...e));
      if (errors.length) return errors;
    }

    this.#setButtons(file.buttons);
    if (file.version === 2) {
      this.#indicators = file.indicators;
      const changedModules = Object.keys({ ...this.#modules, ...modules }).filter(
        (id) => !isDeepStrictEqual(this.#modules[id], modules[id])
      );
      this.#modules = modules;
      await this.updateSettings(file.settings);
      this.#events.emit("indicators-config", null);
      for (const id of changedModules) this.#events.emit("module-config", { module: id });
    } else {
      await this.#persist();
    }
    this.#events.emit("bindings", null);
    return [];
  }

  #setButtons(buttons: Binding[]) {
    this.#bindings = new Map(buttons.map((b) => [key(b.x, b.y), b]));
  }

  /** Parses every registered module's section (filling defaults); unknown sections are kept untouched. */
  #validateModules(sections: Record<string, unknown>, onErrors: (errors: string[]) => void) {
    const result: Record<string, unknown> = { ...sections };
    for (const module of this.#registry.list()) {
      if (!module.config) continue;
      const parsed = this.#registry.parseConfig(module.id, sections[module.id]);
      if (parsed.ok) result[module.id] = parsed.value;
      else onErrors(parsed.errors);
    }
    return result;
  }

  #mergeSecrets(moduleId: string, incoming: Section, current: Section): Section {
    const merged = { ...incoming };
    for (const secret of this.#registry.configSecrets(moduleId)) {
      if (merged[secret] === undefined || merged[secret] === "") merged[secret] = current[secret];
      else if (merged[secret] === null) delete merged[secret];
    }
    return merged;
  }

  #redactSecrets(modules: Record<string, unknown>) {
    const result: Record<string, unknown> = {};
    for (const [id, section] of Object.entries(modules)) {
      const secrets = this.#registry.configSecrets(id);
      if (!secrets.length || !isSection(section)) {
        result[id] = section;
        continue;
      }
      const copy = { ...section };
      for (const secret of secrets) delete copy[secret];
      result[id] = copy;
    }
    return result;
  }

  // Serialized so concurrent requests never interleave writes.
  #persist() {
    const content = JSON.stringify(this.toFile(), null, 2) + "\n";
    const write = this.#writes.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp`;
      await writeFile(tmp, content, "utf8");
      await rename(tmp, this.path);
      log.debug("Saved", { path: this.path, bytes: content.length });
    });
    // Keep the queue alive after a failure; the caller still receives the rejection.
    this.#writes = write.catch((error) => log.error("Could not save config", error, { path: this.path }));
    return write;
  }
}

function isSection(value: unknown): value is Section {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(path: string): Promise<unknown> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  return JSON.parse(raw);
}
