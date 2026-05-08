/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as _data_personas from "../_data/personas.js";
import type * as _internal_runMatch from "../_internal_runMatch.js";
import type * as engine_combat from "../engine/combat.js";
import type * as engine_distance from "../engine/distance.js";
import type * as engine_hiding from "../engine/hiding.js";
import type * as engine_lastKnown from "../engine/lastKnown.js";
import type * as engine_loot from "../engine/loot.js";
import type * as engine_map from "../engine/map.js";
import type * as engine_movement from "../engine/movement.js";
import type * as engine_reportStats from "../engine/reportStats.js";
import type * as engine_resolution from "../engine/resolution.js";
import type * as engine_runStats from "../engine/runStats.js";
import type * as engine_types from "../engine/types.js";
import type * as engine_validation from "../engine/validation.js";
import type * as engine_vision from "../engine/vision.js";
import type * as llm_azure from "../llm/azure.js";
import type * as llm_decisionTool from "../llm/decisionTool.js";
import type * as llm_idNormalisation from "../llm/idNormalisation.js";
import type * as llm_inputBuilder from "../llm/inputBuilder.js";
import type * as llm_personas from "../llm/personas.js";
import type * as llm_systemPrompt from "../llm/systemPrompt.js";
import type * as matches from "../matches.js";
import type * as replay from "../replay.js";
import type * as reports from "../reports.js";
import type * as reports_phase3 from "../reports/phase3.js";
import type * as runMatch from "../runMatch.js";
import type * as runs from "../runs.js";
import type * as spike from "../spike.js";
import type * as turns from "../turns.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "_data/personas": typeof _data_personas;
  _internal_runMatch: typeof _internal_runMatch;
  "engine/combat": typeof engine_combat;
  "engine/distance": typeof engine_distance;
  "engine/hiding": typeof engine_hiding;
  "engine/lastKnown": typeof engine_lastKnown;
  "engine/loot": typeof engine_loot;
  "engine/map": typeof engine_map;
  "engine/movement": typeof engine_movement;
  "engine/reportStats": typeof engine_reportStats;
  "engine/resolution": typeof engine_resolution;
  "engine/runStats": typeof engine_runStats;
  "engine/types": typeof engine_types;
  "engine/validation": typeof engine_validation;
  "engine/vision": typeof engine_vision;
  "llm/azure": typeof llm_azure;
  "llm/decisionTool": typeof llm_decisionTool;
  "llm/idNormalisation": typeof llm_idNormalisation;
  "llm/inputBuilder": typeof llm_inputBuilder;
  "llm/personas": typeof llm_personas;
  "llm/systemPrompt": typeof llm_systemPrompt;
  matches: typeof matches;
  replay: typeof replay;
  reports: typeof reports;
  "reports/phase3": typeof reports_phase3;
  runMatch: typeof runMatch;
  runs: typeof runs;
  spike: typeof spike;
  turns: typeof turns;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
