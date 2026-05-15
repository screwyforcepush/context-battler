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

export function titleCase(id: PersonaId): string {
  return id.slice(0, 1).toUpperCase() + id.slice(1);
}

export const PERSONA_DISPLAY_NAMES: Set<string> = new Set(
  PERSONA_IDS.map(titleCase),
);

// ─── Item names + stat tiers (locked, ADR §6 / concept-spec §14) ─────────────

export type WeaponName =
  | "rusty_blade"
  | "dagger"
  | "sword"
  | "axe"
  | "greatsword"
  | "warhammer";
export type ArmourName = "cloth" | "leather" | "chain" | "plate" | "riot_plate";
export type ConsumableName = "heal" | "speed";

/**
 * Weapon stat table — locked per ADR §6. WP7 combat tests assert these
 * values directly (`dps`, `range`). All weapons are range 2 in v0
 * per concept-spec §14.
 *
 * `dps` is the DPS value (attack speed pre-factored in). `tempo` is a
 * render-only cosmetic attribute ("slow" | "med" | "fast") consumed ONLY
 * by the replay renderer — never by the LLM input, combat math, or any
 * agent-facing surface. Equal DPS is mechanically identical regardless
 * of tempo; tempo is never an initiative or turn-order axis.
 */
export const WEAPONS: Record<
  WeaponName,
  { dps: number; range: number; tempo: "slow" | "med" | "fast" }
> = {
  rusty_blade: { dps: 10, range: 2, tempo: "med" },
  dagger:      { dps: 8,  range: 2, tempo: "fast" },
  sword:       { dps: 15, range: 2, tempo: "med" },
  axe:         { dps: 20, range: 2, tempo: "med" },
  greatsword:  { dps: 25, range: 2, tempo: "slow" },
  warhammer:   { dps: 30, range: 2, tempo: "slow" },
};

/**
 * Armour percentage-reduction table — locked per ADR §6.
 *
 * `reductionPct` is a damage-reduction multiplier in [0, 1). The hard
 * contract: NO tier reaches or exceeds 1.0 (no invincible agents).
 * Damage formula (concept-spec §12):
 *   damage = max(MIN_DAMAGE_FLOOR, round(base_dps * (1 - reductionPct)))
 *
 * Tier values (§10 tuning, hard-capped below 100%):
 *   cloth 5%, leather 10%, chain 20%, plate 30%, riot_plate 40%.
 */
export const ARMOUR: Record<ArmourName, { reductionPct: number }> = {
  cloth:      { reductionPct: 0.05 },
  leather:    { reductionPct: 0.10 },
  chain:      { reductionPct: 0.20 },
  plate:      { reductionPct: 0.30 },
  riot_plate: { reductionPct: 0.40 },
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
 * `damage = max(MIN_DAMAGE_FLOOR, round(base_dps * (1 - reductionPct)))`.
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

export type RectShape = "single" | "E-W line" | "N-S line" | "patch";

/** Per-crate state. `contents` is `null` after the crate is opened — WP7
 *  flips `opened` and consumes `contents` to `null` on equip per concept-
 *  spec §13. Initial contents are hand-authored in the map descriptor. */
export type CrateState = {
  id: string;
  pos: Tile;
  contents: ItemRef | null;
  opened: boolean;
};

/** Per-airdrop world-event state. The lifecycle is turn-derived:
 *  telegraphed before landing, landed after `landsAtTurn`, spent when looted. */
export type AirdropState = {
  id: string;
  pos: Tile;
  landsAtTurn: number;
  contents: ItemRef;
  looted: boolean;
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
  coverClusters: Wall[];
  coverTiles: Tile[];
  crates: CrateState[];
  airdrops: AirdropState[];
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
 * - `crates`        — point spawns with hand-authored deterministic contents.
 * - `spawns`        — exactly 8 perimeter points; persona-to-spawn
 *                     assignment is seeded by `rngSeed` (WP3).
 * - `evac`          — 3×3 zone centre.
 */
export type MapDescriptor = {
  size: { w: number; h: number };
  walls: Wall[];
  coverClusters: Wall[];
  crates: Array<{ x: number; y: number; contents: ItemRef }>;
  airdrops: Array<{
    x: number;
    y: number;
    landsAtTurn: number;
    contents: ItemRef;
  }>;
  spawns: Tile[];
  evac: Tile;
};

// ─── Decision discriminated union (phase 6) ──────────────────────────────────

export type UseVariant = "consumable_or_null" | "null_only";

export type CompassDirectionKind =
  | "N"
  | "NE"
  | "E"
  | "SE"
  | "S"
  | "SW"
  | "W"
  | "NW";

export type Direction =
  | { kind: "toward" | "away"; targetId: string }
  | { kind: CompassDirectionKind };

export type Position =
  | { kind: "overwatch" | "counter" }
  | { kind: "move"; direction: Direction; dist: number };

export type ActionDecision =
  | { kind: "none" }
  | { kind: "attack" | "loot"; targetId: string };

export type ParsedDecision = {
  use: "consumable" | null;
  position: Position;
  action: ActionDecision;
  say: string | null;
  scratchpad: string | null;
};

export const SAFE_DEFAULT_DECISION: ParsedDecision = {
  use: null,
  position: { kind: "move", direction: { kind: "N" }, dist: 0 },
  action: { kind: "none" },
  say: null,
  scratchpad: null,
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
  displayName: string; // Persona display name, e.g. "Duelist".
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

/**
 * Per-action trace entry emitted by resolution. `weapon` is the phase-4
 * strike-time equipped weapon name for attack/overwatch damage entries.
 *
 * `discardedWeaker` is `true` when a loot action opened the source (crate,
 * corpse, or airdrop) but the looted item was NOT equipped because the
 * actor already held a strictly-better item in that slot. The source is
 * still consumed/marked spent. `lootedItem` carries the discarded item
 * name so consumers can render the truth. When `discardedWeaker` is absent
 * or false, the item was equipped normally.
 */
export type ActionTraceEntry = {
  characterId: string;
  kind: "attack" | "loot" | "overwatch" | "counter";
  target: string;
  result: string;
  weapon?: string;
  lootedItem?: string;
  triggeredByMovement?: boolean;
  discardedWeaker?: boolean;
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
  | { kind: "crate"; objectId: string; pos: Tile; opened: boolean }
  | {
      kind: "airdrop";
      objectId: string;
      pos: Tile;
      countdown: number;
    }
  | { kind: "corpse"; objectId: string; pos: Tile; contents: EquippedSlots }
  | { kind: "cover_rect"; rect: Wall; shape: RectShape }
  | { kind: "wall_rect"; rect: Wall; shape: RectShape }
  | { kind: "evac_rect"; rect: Wall; shape: RectShape };

/** Heard speech entry — a single `say` message broadcast in the previous
 *  turn (concept-spec §16). WP8's digest renders these in the `Heard:`
 *  section, capped at 5 entries. */
export type HeardSpeech = { speakerId: string; text: string };
