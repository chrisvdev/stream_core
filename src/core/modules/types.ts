import type { Coordinate, MIDIData } from "@chrisvdev/launchpad-controller";
import type { ZodType } from "astro/zod";
import type { Logger } from "../../lib/log/shared";
import type { Appearance } from "../appearance";
import type { AppContext } from "../context";

export type ButtonEvent = "press" | "release";

export type ParamValue = string | number | boolean;
export type Params = Record<string, ParamValue>;

interface BaseParam<T extends string, V extends ParamValue> {
  key: string;
  label: string;
  type: T;
  description?: string;
  required?: boolean;
  default?: V;
}

export type ParamSchema =
  | BaseParam<"string", string>
  | (BaseParam<"number", number> & { min?: number; max?: number })
  | BaseParam<"boolean", boolean>
  | (BaseParam<"select", string> & {
      options: { value: string; label: string }[];
      /** Options come from external state; stored values stay valid even if currently missing. */
      dynamic?: boolean;
    });

/** Lets an action change a button's LED temporarily; `restore()` returns it to its identity color. */
export interface ButtonControl {
  setStatic(code: number): void;
  setPulsing(code: number): void;
  setFlashing(code: number, code2: number): void;
  setRGB(r: number, g: number, b: number): void;
  set(appearance: Appearance): void;
  restore(): void;
}

export interface ActionContext {
  event: ButtonEvent;
  coordinate: Coordinate;
  binding: { name?: string; description?: string };
  params: Params;
  /** Undefined when the event was simulated from the panel. */
  message?: MIDIData;
  button: ButtonControl;
  /** Handle for one of this module's own indicators. */
  indicator(id: string): IndicatorHandle;
  /** Logger scoped to `module.<id>`. */
  log: Logger;
}

export interface ActionDefinition {
  id: string;
  name: string;
  description?: string;
  /** A function lets options depend on runtime state; it's re-evaluated after `notifyCatalogChanged()`. */
  params?: ParamSchema[] | (() => ParamSchema[]);
  /** Runs even while physical buttons are locked (e.g. the action that unlocks them). */
  allowWhenLocked?: boolean;
  handle(ctx: ActionContext): void | Promise<void>;
}

export interface IndicatorStateDefinition {
  id: string;
  name: string;
  /** Default color; the panel can override it per assigned location. */
  appearance: Appearance;
}

/** A visual status a module can show on any location assigned from the panel, above the button's own color. */
export interface IndicatorDefinition {
  id: string;
  name: string;
  description?: string;
  states: IndicatorStateDefinition[];
}

export interface IndicatorHandle {
  set(stateId: string): void;
  clear(): void;
  /** Shows a state for `ms` milliseconds, then clears it unless another set/clear happened. */
  flash(stateId: string, ms: number): void;
  current(): string | null;
}

export interface ModuleConfigContext<C> {
  get(): C;
  /** Returns an unsubscribe function. */
  onChange(listener: (config: C) => void): () => void;
}

export interface ModuleContext<C = unknown> {
  app: AppContext;
  indicator(id: string): IndicatorHandle;
  config: ModuleConfigContext<C>;
  /** Call after dynamic params or indicators changed so the panel and registry refresh. */
  notifyCatalogChanged(): void;
  /** Call after `status()` would return something new. */
  notifyStatusChanged(): void;
  /** Another module's public `api`, or undefined if it isn't registered or exposes none. */
  module<T = unknown>(id: string): T | undefined;
  /** Logger scoped to `module.<id>`. */
  log: Logger;
}

export interface ModuleConfigDefinition<C> {
  schema: ZodType<C>;
  /** Top-level keys omitted from exports and masked in the panel. */
  secrets?: (keyof C & string)[];
}

export type ModuleCommand = (input: unknown) => unknown | Promise<unknown>;

export interface ModuleHealth {
  state: "ok" | "warn" | "error";
  message?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface StreamModule<C = any> {
  id: string;
  name: string;
  description?: string;
  actions: ActionDefinition[];
  indicators?: IndicatorDefinition[] | (() => IndicatorDefinition[]);
  config?: ModuleConfigDefinition<C>;
  /** Adds a link to `/admin/modules/<id>`; the page itself lives in `src/pages/admin/modules/`. */
  admin?: { label: string };
  status?(): unknown;
  commands?: Record<string, ModuleCommand>;
  /** Public API for other modules, reachable through `ctx.module(id)`. */
  api?: unknown;
  /** Uniform health for the system module; call `notifyStatusChanged()` when it changes. */
  health?(): ModuleHealth;
  /** Stop anything in progress (effects, streams); used by the system "panic" action. */
  panic?(): void | Promise<void>;
  init?(ctx: ModuleContext<C>): void | Promise<void>;
  dispose?(): void | Promise<void>;
}

export interface ActionCatalogEntry {
  id: string;
  name: string;
  description?: string;
  params: ParamSchema[];
}

export interface ModuleCatalogEntry {
  id: string;
  name: string;
  description?: string;
  actions: ActionCatalogEntry[];
  indicators: IndicatorDefinition[];
  admin?: { label: string; href: string };
}
