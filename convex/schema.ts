// WP2 — full Convex schema per `architecture-decisions.md` §6 (the canonical
// shape). Six tables: matches, characters, turns, worldState, runs, reports.
//
// Every literal-union below is the locked vocabulary; downstream WPs share
// these validators by re-importing from this module rather than redeclaring.
//
// Sketch of the six-table layout (mirrors ADR §6, top-to-bottom):
//
//   matches      — one row per match. status / outcome / failure?
//   characters   — 8 rows per match (one per agent). persona, hp, equipped, lastKnown
//   turns        — one row per (matchId, turn). agentRecords[] is the trace ledger
//   worldState   — one row per match. walls, cover, chests, corpses, evac
//   runs         — one row per completed match (written by WP12). per-persona stats
//   reports      — one row per harness invocation (written by WP14). multi-run aggregate
//
// Indexes (ADR §6, WP2 scope):
//   matches.by_status, turns.by_match_turn, characters.by_match,
//   runs.by_match, reports.by_generatedAt
//
// Boundary contract (ADR §6 consequence): WP10 writes turns/characters/
// worldState; WP12 writes runs; WP14 writes reports. WP2 only adds the trivial
// `matches.create` + `matches.get` to prove the read/write path.

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// ─────────────────────────────────────────────────────────────────────────────
// Shared validators (single source of truth — re-imported by later WPs).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PersonaId — locked kebab-case literal union of the 8 persona ids per
 * ADR §6. This is the same set as the filenames in `personas/*.md` (without
 * extension) and the keys WP9's `loadPersonas()` returns. The validator
 * REJECTS any string outside this set.
 */
export const personaIdValidator = v.union(
  v.literal("rat"),
  v.literal("duelist"),
  v.literal("trader"),
  v.literal("opportunist"),
  v.literal("paranoid"),
  v.literal("camper"),
  v.literal("sprinter"),
  v.literal("vulture"),
);

/**
 * Match lifecycle status — `pending → running → completed | failed`.
 */
export const matchStatusValidator = v.union(
  v.literal("pending"),
  v.literal("running"),
  v.literal("completed"),
  v.literal("failed"),
);

/**
 * `FailureReason` per ADR §4 — the 9 enumerated wrapper-failure modes that
 * can be persisted in `turns.agentRecords[].llm.failureReason`.
 */
export const failureReasonValidator = v.union(
  v.literal("http_non_200"),
  v.literal("status_not_completed"),
  v.literal("incomplete_details"),
  v.literal("content_filter_blocked"),
  v.literal("no_function_call"),
  v.literal("multiple_function_calls"),
  v.literal("json_parse_failed"),
  v.literal("schema_validation_failed"),
  v.literal("abort_timeout"),
);

/**
 * Visibility update cause per ADR §6 (`turns.resolution.visibilityUpdates[]`).
 * Cross-ref `concept-spec.md` §7 (hide reveal causes) + §23 (resolution order).
 */
export const revealedByValidator = v.union(
  v.literal("attack"),
  v.literal("loot"),
  v.literal("speech"),
  v.literal("consumable"),
  v.literal("leaving_cover"),
  v.literal("proximity"),
);

/**
 * `reasoningEffort` per Azure Responses API `reasoning.effort` knob (locked
 * literal-union per `azure-llm.md` §7 + `de-risking.md` "Reasoning policy":
 * `"none"` is explicitly disallowed for the entire phase; `"low"` is the
 * default). WP10.5 A5 plumbs this from the harness CLI through the
 * `matches` row and into `callDecisionTool`'s request body.
 */
export const reasoningEffortValidator = v.union(
  v.literal("low"),
  v.literal("medium"),
  v.literal("high"),
);

// 2D tile (used for positions and map structures).
const tileValidator = v.object({ x: v.number(), y: v.number() });

// ItemRef — refers to one of the locked v0 stat-tier instances by name.
// The names are the literals locked in ADR §6 (also `concept-spec.md` §14):
//   weapons:     rusty_blade | sword | axe | greatsword
//   armour:      cloth | leather | chain | plate
//   consumables: heal | speed
const weaponRefValidator = v.object({
  category: v.literal("weapon"),
  name: v.union(
    v.literal("rusty_blade"),
    v.literal("sword"),
    v.literal("axe"),
    v.literal("greatsword"),
  ),
});
const armourRefValidator = v.object({
  category: v.literal("armour"),
  name: v.union(
    v.literal("cloth"),
    v.literal("leather"),
    v.literal("chain"),
    v.literal("plate"),
  ),
});
const consumableRefValidator = v.object({
  category: v.literal("consumable"),
  name: v.union(v.literal("heal"), v.literal("speed")),
});
const itemRefValidator = v.union(
  weaponRefValidator,
  armourRefValidator,
  consumableRefValidator,
);

// Equipped slots for a character (each slot independently optional).
const equippedValidator = v.object({
  weapon: v.optional(weaponRefValidator),
  armour: v.optional(armourRefValidator),
  consumable: v.optional(consumableRefValidator),
});

// Corpse contents — same shape as `equipped` per ADR §6 / §13 (corpse holds
// the dead agent's full equipped slots).
const corpseContentsValidator = v.object({
  weapon: v.optional(weaponRefValidator),
  armour: v.optional(armourRefValidator),
  consumable: v.optional(consumableRefValidator),
});

// Azure usage object (best-effort shape per Azure responses API). Persisted
// as-is (or null on failure) per ADR §6/§7. Convex `v.any()` is the right
// choice here: the wrapper records whatever Azure returned, and WP6 produces
// the Zod schema that gates ingest. We deliberately do NOT lock the shape
// in the schema — the wrapper serialises through.
const azureUsageValidator = v.any();

// ─────────────────────────────────────────────────────────────────────────────
// ParsedDecision — mirrors ADR §4 exactly. Discriminated unions for
// `move` and `action`. WP2 declares the validators; WP6 owns the Zod
// equivalent + structural-equivalence test.
// ─────────────────────────────────────────────────────────────────────────────

const moveValidator = v.union(
  v.object({
    kind: v.literal("relative"),
    dx: v.number(),
    dy: v.number(),
  }),
  v.object({
    kind: v.literal("toward_entity"),
    targetCharacterId: v.string(),
  }),
  v.object({
    kind: v.literal("away_from_entity"),
    targetCharacterId: v.string(),
  }),
  v.object({
    kind: v.literal("toward_object"),
    targetObjectId: v.string(),
  }),
  v.object({ kind: v.literal("toward_evac") }),
  v.object({ kind: v.literal("none") }),
);

const actionValidator = v.union(
  v.object({
    kind: v.literal("attack"),
    targetCharacterId: v.string(),
  }),
  v.object({
    kind: v.literal("interact"),
    targetObjectId: v.string(),
  }),
  v.object({
    kind: v.literal("loot"),
    targetCorpseId: v.string(),
  }),
  v.object({ kind: v.literal("none") }),
);

const decisionValidator = v.object({
  consume: v.union(v.literal("none"), v.literal("heal"), v.literal("speed")),
  primary: v.union(
    v.literal("move"),
    v.literal("stationary_action"),
    v.literal("overwatch"),
  ),
  move: moveValidator,
  action: actionValidator,
  // Nullable strings (per ADR §4 — JSON Schema `["string", "null"]`).
  say: v.union(v.string(), v.null()),
  overwatch_priority: v.union(v.string(), v.null()),
  scratchpad_update: v.union(v.string(), v.null()),
});

// ─────────────────────────────────────────────────────────────────────────────
// Agent record — the per-(turn,character) trace row. ADR §6 + §7. The
// `input` block is fully self-contained so post-WP15 prompt edits never
// invalidate historical traces.
// ─────────────────────────────────────────────────────────────────────────────

const agentInputValidator = v.object({
  systemPromptHash: v.string(),
  systemPromptText: v.string(),
  personaPromptHash: v.string(),
  personaPromptText: v.string(),
  visibleStateDigest: v.string(),
  scratchpadBefore: v.string(),
});

const agentLlmValidator = v.object({
  responseId: v.union(v.string(), v.null()),
  callId: v.union(v.string(), v.null()),
  rawArguments: v.union(v.string(), v.null()),
  usage: v.union(azureUsageValidator, v.null()),
  latencyMs: v.number(),
  httpStatus: v.union(v.number(), v.null()),
  fellBackToSafeDefault: v.boolean(),
  failureReason: v.optional(failureReasonValidator),
  // WP10.5 Pass B.3 — engine validator rejection reason. Populated when the
  // engine's `validateDecision` (WP5) rejects a wrapper-emitted decision on
  // semantic grounds (target-not-visible, chest-already-opened, range, etc).
  // Distinct from `failureReason` (which is wrapper-level: HTTP/parse/schema
  // failures). The diagnostic key that makes substrate noise debuggable —
  // see `docs/project/phases/01-engine-and-harness/wp10-5-phase-a-findings.md`
  // for why this was the missing signal in gate-1.
  // Optional + additive: existing rows without this field validate cleanly;
  // no migration needed.
  validatorReason: v.optional(v.string()),
});

const agentRecordValidator = v.object({
  characterId: v.id("characters"),
  // PersonaId duplicated from `characters` for trace self-containment
  // (ADR §6 — every agentRecord row is independently introspectable).
  personaId: personaIdValidator,
  input: agentInputValidator,
  decision: decisionValidator,
  scratchpadAfter: v.string(),
  llm: agentLlmValidator,
});

// ─────────────────────────────────────────────────────────────────────────────
// Resolution trace — per-phase outputs of the 8-phase resolver
// (`concept-spec.md` §23). Persisted on each `turns` row alongside agentRecords.
// ─────────────────────────────────────────────────────────────────────────────

const resolutionValidator = v.object({
  consumed: v.array(
    v.object({
      characterId: v.id("characters"),
      item: consumableRefValidator,
    }),
  ),
  speech: v.array(
    v.object({
      characterId: v.id("characters"),
      text: v.string(),
      heardBy: v.array(v.id("characters")),
    }),
  ),
  moves: v.array(
    v.object({
      characterId: v.id("characters"),
      from: tileValidator,
      to: tileValidator,
    }),
  ),
  actions: v.array(
    v.object({
      characterId: v.id("characters"),
      kind: v.string(),
      target: v.string(),
      result: v.string(),
    }),
  ),
  deaths: v.array(v.id("characters")),
  visibilityUpdates: v.array(
    v.object({
      characterId: v.id("characters"),
      hidden: v.boolean(),
      revealedBy: v.optional(revealedByValidator),
    }),
  ),
});

// ─────────────────────────────────────────────────────────────────────────────
// World state — per match. Walls + cover + chests + corpses + evac.
// ─────────────────────────────────────────────────────────────────────────────

const wallValidator = v.object({
  x: v.number(),
  y: v.number(),
  w: v.number(),
  h: v.number(),
});

const chestValidator = v.object({
  id: v.string(),
  pos: tileValidator,
  contents: v.union(itemRefValidator, v.null()),
  opened: v.boolean(),
});

const corpseValidator = v.object({
  characterId: v.id("characters"),
  pos: tileValidator,
  contents: corpseContentsValidator,
});

// ─────────────────────────────────────────────────────────────────────────────
// Per-persona stats for the `runs` table.
//
// Choice (ADR §6 invites either): we use a FLAT ARRAY of `{ personaId, ... }`
// rather than a record-keyed-by-PersonaId. Two reasons:
//   1. Convex `v.record` requires the value validator to be the same shape
//      across all keys; that works here, but the consumer ergonomics with
//      a literal-union key set are awkward (needs all 8 keys present).
//      An array of length 8 keyed by `personaId` is straightforward to build,
//      easy to query, and aligns with how WP12 will iterate `for of personas`.
//   2. `reports.metrics.perPersonaExtractionRate` (below) does the same.
// ─────────────────────────────────────────────────────────────────────────────

const perPersonaStatsValidator = v.object({
  personaId: personaIdValidator,
  survivedTurns: v.number(),
  kills: v.number(),
  extracted: v.number(),
  equips: v.number(),
  speechEvents: v.number(),
});

const perPersonaExtractionRateValidator = v.object({
  personaId: personaIdValidator,
  rate: v.number(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Schema definition.
// ─────────────────────────────────────────────────────────────────────────────

export default defineSchema({
  // ── matches: one row per match ────────────────────────────────────────────
  matches: defineTable({
    status: matchStatusValidator,
    turn: v.number(), // current turn number, 0..50
    startedAt: v.number(), // Date.now() at match creation
    completedAt: v.union(v.number(), v.null()),
    mapId: v.string(), // "reference" for phase 1
    rngSeed: v.string(), // seeds chest loot rolls AND persona-to-spawn assignment
    // Azure Responses API `reasoning.effort` knob for every per-turn LLM
    // call in this match. Optional on the table so historical rows persist
    // without migration; absent → treated as "low" by `runMatch.advanceTurn`
    // (the WP10.5 default + the de-risking.md "Reasoning policy" baseline).
    reasoningEffort: v.optional(reasoningEffortValidator),
    outcome: v.object({
      extracted: v.array(v.id("characters")),
      lastSurvivor: v.optional(v.id("characters")),
      pointsByCharacter: v.array(
        v.object({ id: v.id("characters"), points: v.number() }),
      ),
    }),
    failure: v.optional(
      v.object({ turn: v.number(), reason: v.string() }),
    ),
  }).index("by_status", ["status"]),

  // ── characters: one row per agent per match ───────────────────────────────
  characters: defineTable({
    matchId: v.id("matches"),
    personaId: personaIdValidator,
    // Numeric only at the validator layer; range correctness (0..7) enforced
    // by WP3's seeded permutation per ADR §6.
    spawnIndex: v.number(),
    displayName: v.string(), // Player_1..Player_8
    hp: v.number(),
    pos: tileValidator,
    equipped: equippedValidator,
    scratchpad: v.string(),
    hidden: v.boolean(),
    alive: v.boolean(),
    diedAtTurn: v.optional(v.number()),
    extractedAtTurn: v.optional(v.number()),
    // Per-character last-known map (cap 3, oldest-evicted) — owned by WP5.
    lastKnown: v.array(
      v.object({
        characterId: v.id("characters"),
        pos: tileValidator,
        atTurn: v.number(),
      }),
    ),
  }).index("by_match", ["matchId"]),

  // ── turns: one row per (matchId, turn) — the canonical ledger ─────────────
  turns: defineTable({
    matchId: v.id("matches"),
    turn: v.number(),
    agentRecords: v.array(agentRecordValidator),
    resolution: resolutionValidator,
  }).index("by_match_turn", ["matchId", "turn"]),

  // ── worldState: one row per match ─────────────────────────────────────────
  worldState: defineTable({
    matchId: v.id("matches"),
    walls: v.array(wallValidator),
    coverTiles: v.array(tileValidator),
    chests: v.array(chestValidator),
    corpses: v.array(corpseValidator),
    evac: v.object({
      centre: tileValidator,
      revealedAtTurn: v.union(v.number(), v.null()),
    }),
  }),

  // ── runs: one row per completed match (written by WP12) ───────────────────
  runs: defineTable({
    matchId: v.id("matches"),
    kills: v.number(),
    extractions: v.number(),
    equips: v.number(),
    speechEvents: v.number(),
    perPersona: v.array(perPersonaStatsValidator),
  }).index("by_match", ["matchId"]),

  // ── reports: one row per harness invocation (written by WP14) ─────────────
  reports: defineTable({
    runIds: v.array(v.id("runs")),
    runCount: v.number(),
    generatedAt: v.number(),
    metrics: v.object({
      extractionRate: v.number(),
      runsWithKill: v.number(),
      runsWithEquip: v.number(),
      runsWithSpeech: v.number(),
      perPersonaExtractionRate: v.array(perPersonaExtractionRateValidator),
      personaSpread: v.number(),
    }),
    metBar: v.boolean(),
  }).index("by_generatedAt", ["generatedAt"]),
});
