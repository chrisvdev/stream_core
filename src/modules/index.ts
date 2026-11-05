import type { StreamModule } from "../core";
import debug from "./debug";
import hue from "./hue";
import obs from "./obs";
import system from "./system";

export const modules: StreamModule[] = [system, debug, obs, hue];
