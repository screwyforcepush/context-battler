// WP3 — Foundational engine types module.
//
// This is the single source of truth for the simulation engine's vocabulary.
// Every later WP imports from here:
//   - WP5 (distance / vision / hiding / lastKnown / validation / affordances)
//     extends `WorldState`, `CharacterState`, `Tile`, `VisibleEntity`.
//   - WP7 (resolution / combat / movement) consumes `ParsedDecision`,
//     `MatchState`, `ItemRef`, `EquippedSlots`, the locked stat tiers.
//   - WP6 (Azure wrapper + Zod parser) mirrors `ParsedDecision`,
//     `FailureReason`, `SAFE_DEFAULT_DECISION`.
//   - WP8 (input builder / digest) consumes `VisibleEntity`, `HeardSpeech`,
//     `LastKnownEntry`, `MatchState`.
//   - WP9 (personas) re-exports `PERSONA_IDS` / `PersonaId`.
//   - WP10 (matches.start / runMatch.advanceTurn) initialises rows
//     using these types and the Convex validators in `convex/schema.ts`.
//
// Cross-references:
//   - ADR §1 — engine layer is pure-function; this file MUST NOT import
//     from `convex/_generated/**` or any Convex API.
//   - ADR §4 — locks the `ParsedDecision` discriminated union, the
//     `FailureReason` enum, and the `SAFE_DEFAULT_DECISION` constant.
//   - ADR §6 — locks `PersonaId`, the v0 item stat tiers, and the
//     `worldState` row shape this module mirrors.
//   - ADR §7 — trace shape: `agentRecords[].input` is self-contained
//     so post-WP15 prompt edits never invalidate historical traces.

// ─── Persona ids (locked, ADR §6) ────────────────────────────────────────────

/**
 * The 8 locked persona ids. Kebab-case, matches `personas/<id>.md` filenames
 * (without extension) and `loadPersonas()` keys (WP9). The Convex validator
 * `personaIdValidator` in `convex/schema.ts` is the runtime equivalent.
 *
 * WP15 may edit persona *bodies* but never these ids — they propagate to
 * the schema, the loader, the aggregator, and the closing report.
 */
export const PERSONA_IDS = [
  "rat",
  "duelist",
  "trader",
  "opportunist",
  "paranoid",
  "camper",
  "sprinter",
  "vulture",
] as const;

export type PersonaId = (typeof PERSONA_IDS)[number];

// ─── Item names + stat tiers (locked, ADR §6 / concept-spec §14) ─────────────

export type WeaponName = "rusty_blade" | "sword" | "axe" | "greatsword";
export type ArmourName = "cloth" | "leather" | "chain" | "plate";
export type ConsumableName = "heal" | "speed";

/**
 * Weapon stat table — locked per ADR §6. WP7 combat tests assert these
 * values directly (`damage`, `range`). All weapons are range 2 in v0
 * per concept-spec §14.
 */
export const WEAPONS: Record<WeaponName, { damage: number; range: number }> = {
  rusty_blade: { damage: 10, range: 2 },
  sword: { damage: 15, range: 2 },
  axe: { damage: 20, range: 2 },
  greatsword: { damage: 25, range: 2 },
};

/** Armour reduction table — locked per ADR §6. */
export const ARMOUR: Record<ArmourName, { reduction: number }> = {
  cloth: { reduction: 0 },
  leather: { reduction: 3 },
  chain: { reduction: 6 },
  plate: { reduction: 10 },
};

/** Consumable effect table — locked per ADR §6.
 *  - `heal_pct` value is the percentage of `maxHp` restored.
 *  - `speed_override` value is the movement budget for the consuming turn. */
export const CONSUMABLES: Record<
  ConsumableName,
  { effect: "heal_pct" | "speed_override"; value: number }
> = {
  heal: { effect: "heal_pct", value: 20 },
  speed: { effect: "speed_override", value: 12 },
};

/**
 * Combat damage floor — locked per ADR §6. WP7 must assert
 * `damage = max(MIN_DAMAGE_FLOOR, weapon.damage - armour.reduction)`.
 */
export const MIN_DAMAGE_FLOOR = 5;

/**
 * Per-character starting HP and max HP — phase-1 tuning value (NOT a
 * concept-spec invariant). `concept-spec.md` §12 defines deterministic
 * damage and the minimum-floor formula but does not pin a global max HP.
 * `mental-model.md` §10 explicitly allows bounded value tuning to clear
 * the report signal, and the Gate-2.5 review (2026-05-07) ratified
 * lowering this from 100 to 50 to compress time-to-kill in armed combat.
 *
 * Single source of truth: imported by `convex/matches.ts` (initial
 * `characters.hp` seed) and `convex/runMatch.ts` (`maxHp` on the in-memory
 * `MatchState` — the schema does not store maxHp). New-match invariant:
 * `hp === maxHp === CHARACTER_MAX_HP` at turn 0.
 */
export const CHARACTER_MAX_HP = 50;

// ─── ItemRef discriminated union (mirrors `convex/schema.ts`) ────────────────

/** Discriminated union over the three item categories.
 *  Mirrors `itemRefValidator` in `convex/schema.ts`. */
export type ItemRef =
  | { category: "weapon"; name: WeaponName }
  | { category: "armour"; name: ArmourName }
  | { category: "consumable"; name: ConsumableName };

// ─── Map / World state (ADR §6 worldState) ───────────────────────────────────

/** A 2D tile in arena coordinates. The arena is `size.w` × `size.h` (100×100
 *  in phase 1). Coordinate system is `(0,0)` top-left, x→east, y→south. */
export type Tile = { x: number; y: number };

/** Axis-aligned rectangle in arena coordinates. Used for both wall blockers
 *  and `coverClusters` (which the expander unrolls into individual `Tile`
 *  entries on `coverTiles[]`). */
export type Wall = { x: number; y: number; w: number; h: number };

/** Per-chest state. `contents` is `null` until the chest is opened — WP7
 *  flips `opened` and consumes `contents` to `null` on equip per concept-
 *  spec §13. `lootTable` references a key in `LOOT_TABLES` (WP3 loot.ts). */
export type ChestState = {
  id: string;
  pos: Tile;
  contents: ItemRef | null;
  opened: boolean;
  lootTable: string;
};

/** Per-corpse state. `contents` mirrors the dead agent's full equipped slots
 *  per concept-spec §13. WP7 owns corpse formation in resolution phase 6. */
export type CorpseState = {
  characterId: string;
  pos: Tile;
  contents: { weapon?: ItemRef; armour?: ItemRef; consumable?: ItemRef };
};

/** Evac zone — 3×3 zone centred at `centre`. Hidden until turn 30 (per
 *  concept-spec §15); flipped by WP7 phase 8 / WP10 advanceTurn. */
export type EvacZone = { centre: Tile; revealedAtTurn: number | null };

/** Per-match world state. Mirrors `worldState` table in `convex/schema.ts`. */
export type WorldState = {
  size: { w: number; h: number };
  walls: Wall[];
  coverTiles: Tile[];
  chests: ChestState[];
  corpses: CorpseState[];
  evac: EvacZone;
};

// ─── Map descriptor (the JSON shape, ADR §5) ─────────────────────────────────

/**
 * Hand-authored descriptor at `maps/reference.json`. The expander
 * (`expandMap` in `convex/engine/map.ts`) turns this into a `WorldState`
 * deterministically given an `rngSeed`.
 *
 * - `walls`         — terrain rectangles (block movement + LOS).
 * - `coverClusters` — rectangles expanded into `coverTiles[]`.
 * - `chests`        — point spawns; `lootTable` resolved at match start.
 * - `spawns`        — exactly 8 perimeter points; persona-to-spawn
 *                     assignment is seeded by `rngSeed` (WP3).
 * - `evac`          — 3×3 zone centre.
 */
export type MapDescriptor = {
  size: { w: number; h: number };
  walls: Wall[];
  coverClusters: Wall[];
  chests: Array<{ x: number; y: number; lootTable: string }>;
  spawns: Tile[];
  evac: Tile;
};

// ─── Decision discriminated union (locked, ADR §4) ───────────────────────────

export type ConsumeChoice = "none" | "heal" | "speed";
export type PrimaryCommitment = "move" | "stationary_action" | "overwatch";

/**
 * Move sub-decision — locked discriminated union per ADR §4. WP6's Zod
 * schema must mirror this exactly (structural-equivalence test in WP6).
 *  - `relative` — bounded `dx,dy` ∈ [-12, 12] (concept-spec §10 + speed
 *    consumable cap).
 *  - `toward_entity` / `away_from_entity` — track target by id; movement
 *    substep tracks current position (concept-spec §10).
 *  - `toward_object` — chest or corpse id.
 *  - `toward_evac` — only valid after evac reveal at turn 30.
 *  - `none` — explicit "stay" (also the default).
 */
export type MoveDecision =
  | { kind: "relative"; dx: number; dy: number }
  | { kind: "toward_entity"; targetCharacterId: string }
  | { kind: "away_from_entity"; targetCharacterId: string }
  | { kind: "toward_object"; targetObjectId: string }
  | { kind: "toward_evac" }
  | { kind: "none" };

/**
 * Action sub-decision — locked discriminated union per ADR §4. Concrete
 * targets only (no predicates / fallbacks per `mental-model.md` §9).
 */
export type ActionDecision =
  | { kind: "attack"; targetCharacterId: string }
  | { kind: "interact"; targetObjectId: string }
  | { kind: "loot"; targetCorpseId: string }
  | { kind: "none" };

/**
 * The full per-turn decision returned by `callDecisionTool` (WP6) or by
 * the safe-default fallback. Mirrors the JSON Schema in ADR §4 exactly.
 */
export type ParsedDecision = {
  consume: ConsumeChoice;
  primary: PrimaryCommitment;
  move: MoveDecision;
  action: ActionDecision;
  say: string | null;
  overwatch_priority: string | null;
  scratchpad_update: string | null;
};

/**
 * Safe default per ADR §4 / §2A.3. The wrapper returns this on every
 * failure mode; the engine resolves it as "consume nothing, do nothing,
 * say nothing." Imported by WP6 (wrapper) and WP10 (per-turn fallback).
 */
export const SAFE_DEFAULT_DECISION: ParsedDecision = {
  consume: "none",
  primary: "stationary_action",
  move: { kind: "none" },
  action: { kind: "none" },
  say: null,
  overwatch_priority: null,
  scratchpad_update: null,
};

// ─── FailureReason (ADR §4) ──────────────────────────────────────────────────

/**
 * Wrapper-failure modes per ADR §4. The wrapper never throws; every
 * failure path resolves to `SAFE_DEFAULT_DECISION` with one of these
 * populated as `failureReason`. Mirrors `failureReasonValidator` in
 * `convex/schema.ts`.
 */
export type FailureReason =
  | "http_non_200"
  | "status_not_completed"
  | "incomplete_details"
  | "content_filter_blocked"
  | "no_function_call"
  | "multiple_function_calls"
  | "json_parse_failed"
  | "schema_validation_failed"
  | "abort_timeout";

// ─── Character + MatchState shells (ADR §6) ──────────────────────────────────

/** Equipped slots for a living character. Each slot independently optional. */
export type EquippedSlots = {
  weapon?: ItemRef;
  armour?: ItemRef;
  consumable?: ItemRef;
};

/**
 * Last-known map entry. WP5 owns updates; capped at 3 most-recent entries
 * per observer (oldest-first eviction) per ADR §6.
 */
export type LastKnownEntry = {
  characterId: string;
  pos: Tile;
  atTurn: number;
};

/**
 * Per-(match, agent) state. Mirrors `characters` table in `convex/schema.ts`.
 * WP10 owns initialisation at match start (incl. seeded `spawnIndex` from
 * WP3's `assignPersonasToSpawns`); WP7 owns per-turn mutation.
 */
export type CharacterState = {
  characterId: string;
  personaId: PersonaId;
  spawnIndex: number;
  displayName: string; // "Player_1".."Player_8"
  hp: number;
  maxHp: number;
  pos: Tile;
  equipped: EquippedSlots;
  scratchpad: string;
  hidden: boolean;
  alive: boolean;
  diedAtTurn?: number;
  extractedAtTurn?: number;
  lastKnown: LastKnownEntry[];
};

/** Per-match aggregate state (in-memory shape). The Convex tables decompose
 *  this across `matches`, `characters`, `worldState`. */
export type MatchState = {
  matchId: string;
  turn: number;
  world: WorldState;
  characters: CharacterState[];
  rngSeed: string;
};

// ─── Visible entities + heard speech (ADR §6 / concept-spec §7,§16) ──────────

/**
 * Entities that can appear in an agent's per-turn visible-state digest
 * (WP8). HP is bucketed (low/mid/high) rather than exact to keep the
 * digest terse and to discourage models from doing arithmetic on a number
 * the engine doesn't promise to keep stable.
 */
export type VisibleEntity =
  | {
      kind: "character";
      characterId: string;
      pos: Tile;
      hpBucket: "low" | "mid" | "high";
      weapon?: WeaponName;
    }
  | { kind: "chest"; objectId: string; pos: Tile; opened: boolean }
  | { kind: "corpse"; objectId: string; pos: Tile; contents: EquippedSlots }
  | { kind: "cover"; pos: Tile }
  | { kind: "wall"; pos: Tile };

/** Heard speech entry — a single `say` message broadcast in the previous
 *  turn (concept-spec §16). WP8's digest renders these in the `Heard:`
 *  section, capped at 5 entries. */
export type HeardSpeech = { speakerId: string; text: string };
