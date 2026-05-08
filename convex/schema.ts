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

// Phase-3 ADR §1 — 3-arm action union (interact arm REMOVED;
// loot.targetCorpseId renamed to loot.targetId; chests + corpses both
// flow through loot, dispatched by id namespace in the engine).
const actionValidator = v.union(
  v.object({
    kind: v.literal("attack"),
    targetCharacterId: v.string(),
  }),
  v.object({
    kind: v.literal("loot"),
    targetId: v.string(),
  }),
  v.object({ kind: v.literal("none") }),
);

// Phase-3 ADR §1 — `overwatch_priority` REMOVED; replaced by structured
// `overwatch_stance` (`"offensive" | "defensive" | null`). Stance/primary
// consistency is enforced by the Zod refinement in
// `convex/llm/decisionTool.ts` BEFORE persistence reaches this validator.
const decisionValidator = v.object({
  consume: v.union(v.literal("none"), v.literal("heal"), v.literal("speed")),
  primary: v.union(
    v.literal("move"),
    v.literal("stationary_action"),
    v.literal("overwatch"),
  ),
  move: moveValidator,
  action: actionValidator,
  // Nullable strings (JSON Schema `["string", "null"]`).
  say: v.union(v.string(), v.null()),
  overwatch_stance: v.union(
    v.literal("offensive"),
    v.literal("defensive"),
    v.null(),
  ),
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
  // WP10.5 Pass F — captured non-OK HTTP response body (sanitised +
  // truncated to ≤ 2 KB by `convex/llm/azure.ts`). Set ONLY when
  // `failureReason === "http_non_200"`; the wrapper drains the body on
  // every other path. Diagnostic purpose: Azure 400s typically embed the
  // moderation policy / category that tripped (e.g. `ResponsibleAIPolicyViolation`).
  // Without this field, fallback debugging is "moderated by elimination"
  // guesswork — the Phase E.1 cautionary tale.
  // Optional + additive: existing rows validate cleanly; no migration.
  httpBodyExcerpt: v.optional(v.string()),
  // Phase-3 ADR §2 / PM lock D13 — captured reasoning text.
  // REQUIRED-NULLABLE (`v.union(v.string(), v.null())`), NOT
  // `v.optional(v.string())` — the closing-10 metric `reasoning !== null`
  // must be well-defined on every persisted row. Persisted as `null` on
  // every non-captured path: fallback rows, Branch A responses without
  // reasoning items, transient extraction failures.
  // Branch A (per de-risking.md D-P3-1 probe outcome): the wrapper
  // extracts reasoning text from `output[]` items of type "reasoning",
  // sanitises via the existing http-body sanitiser, and truncates to
  // ≤ 4 KB before persistence.
  reasoning: v.union(v.string(), v.null()),
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
      // Phase-3 ADR §9 — wall-blocked move marker. Present iff the
      // entry has `from === to` AND the agent attempted a move whose
      // next-step tile was blocked by a wall. The closing-10 wall-
      // blocked-move-rate metric reads this directly (single source of
      // truth — no aggregator-side derivation).
      blockedBy: v.optional(v.literal("wall")),
    }),
  ),
  actions: v.array(
    v.object({
      characterId: v.id("characters"),
      kind: v.string(),
      target: v.string(),
      result: v.string(),
      // Phase-3 ADR §3 — overwatch-stance attribution emitted by the
      // engine. `fromOverwatch=true` + `stance="defensive"` for
      // counter-fire entries; `stance="offensive"` (fromOverwatch
      // omitted/false) for offensive overwatch fire entries; both
      // omitted for non-overwatch attacks.
      fromOverwatch: v.optional(v.boolean()),
      stance: v.optional(
        v.union(v.literal("offensive"), v.literal("defensive")),
      ),
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
// WP14 — `reports.payload` validator. Mirrors `ReportPayload` from
// `convex/engine/reportStats.ts` field-for-field. Extending the report
// payload requires updating BOTH this validator AND the engine type.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-persona aggregation block within `reports.payload.perPersona[]`.
 * Mirrors `ReportPerPersonaStats` from the engine layer.
 *
 *   `extractionsCount` — count of RUNS in which this persona had `extracted > 0`.
 *   `extractionRate`   — extractionsCount / runCount in [0, 1] (0 when runCount=0).
 *   `extracted`        — sum of per-run `extracted` (per-run character-count).
 */
const reportPerPersonaStatsValidator = v.object({
  personaId: personaIdValidator,
  kills: v.number(),
  equips: v.number(),
  speechEvents: v.number(),
  extracted: v.number(),
  extractionsCount: v.number(),
  extractionRate: v.number(),
});

/**
 * `reports.payload` validator — the §10 done-bar payload Stage-3 emits.
 * Mirrors `ReportPayload` from `convex/engine/reportStats.ts` exactly.
 */
const reportPayloadValidator = v.object({
  // Run counts
  runCount: v.number(),

  // Top-level sums across runs
  kills: v.number(),
  extractions: v.number(),
  equips: v.number(),
  speechEvents: v.number(),

  // ≥1-per-run counts
  runsWithAtLeastOneKill: v.number(),
  runsWithAtLeastOneExtraction: v.number(),
  runsWithAtLeastOneEquip: v.number(),
  runsWithAtLeastOneSpeech: v.number(),

  // ≥1-per-run rates
  killRate: v.number(),
  extractionRate: v.number(),
  equipRate: v.number(),
  speechRate: v.number(),

  // Per-persona breakdown (always 8 entries)
  perPersona: v.array(reportPerPersonaStatsValidator),

  // Persona extraction-rate spread (max-min) in PERCENTAGE POINTS (0..100)
  personaExtractionSpread: v.number(),

  // §10 threshold flags
  meetsExtractionThreshold: v.boolean(),
  meetsKillThreshold: v.boolean(),
  meetsEquipThreshold: v.boolean(),
  meetsSpeechThreshold: v.boolean(),
  meetsPersonaSpreadThreshold: v.boolean(),
  meetsAllThresholds: v.boolean(),
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
  //
  // WP14 added matchIds-based addressing on top of the original runIds-based
  // shape. Both reference sets are persisted (additive, non-breaking):
  //   - `runIds` + `runCount` + `metrics` + `metBar`: original v1 shape from
  //     WP2 (kept untouched so WP10/WP11/historical rows continue to validate).
  //   - `matchIds` + `matchIdsHash` + `reportType` + `payload` +
  //     `missingRunsForMatchIds`: WP14 additions. The Convex mutation
  //     `reports.create({ matchIds, reportType })` reads the `runs` rows for
  //     each matchId, calls the pure aggregator, and writes the row. The
  //     idempotency tuple is `(matchIdsHash, reportType)` — sort-then-hash
  //     of the matchIds set so re-fires with the same set in any order
  //     hit the same row.
  //
  // The `payload` validator mirrors `ReportPayload` from
  // `convex/engine/reportStats.ts` field-for-field; that's the §10 done-bar
  // shape Stage-3 emits. Extending `payload` is additive (Convex object
  // validators are exact-match by default; new fields require a schema
  // change here AND the engine type).
  reports: defineTable({
    // ── v1 / WP2 fields (preserved verbatim — historical rows + harness
    //    legacy paths) ──────────────────────────────────────────────────
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

    // ── v2 / WP14 additions ───────────────────────────────────────────
    /** Match ids the report aggregated over (sorted into the hash, not
     *  the array — original input order is preserved here for trace). */
    matchIds: v.optional(v.array(v.id("matches"))),
    /** Deterministic hex SHA-256 of the SORTED, comma-joined matchIds.
     *  Empty string for the empty set. The `(matchIdsHash, reportType)`
     *  tuple is the idempotency key — re-fires with the same set return
     *  the same row instead of inserting. */
    matchIdsHash: v.optional(v.string()),
    /** Caller-supplied report-type discriminator (e.g. "stage-3-50run",
     *  "stage-2-10run-tuning"). Part of the idempotency tuple. */
    reportType: v.optional(v.string()),
    /** Per-§10-done-bar payload produced by `aggregateReportStats`.
     *  Mirrors `ReportPayload` from `convex/engine/reportStats.ts` 1:1. */
    payload: v.optional(reportPayloadValidator),
    /** Match ids the caller passed but for which no `runs` row was found
     *  at read time. Stage-3 needs this signal to know which matches were
     *  quietly excluded from the aggregate (e.g. failed matches that
     *  didn't get a `runs` row by WP12 contract). */
    missingRunsForMatchIds: v.optional(v.array(v.id("matches"))),
  })
    .index("by_generatedAt", ["generatedAt"])
    // WP14 idempotency index: `reports.create` reads by this tuple before
    // inserting; re-fires with the same matchIds set + reportType return
    // the existing row.
    .index("by_matchIdsHash_reportType", ["matchIdsHash", "reportType"]),
});
