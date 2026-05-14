"use node";
// WP10 — per-turn match action.
//
// Public action `advanceTurn({ matchId })`. Wraps the entire body in a
// single try/catch (per work-packages.md WP10 + ADR §6). On any uncaught
// error: marks the match `status="failed"` with `failure={turn, reason}`
// and does NOT re-schedule the next turn. The harness (WP11) polls
// `matches.status` and sees the terminal state cleanly.
//
// Per-turn pipeline (mirrors concept-spec.md §23 + WP10 acceptance):
//   1. Read matches/characters/worldState rows.
//   2. Build engine `MatchState` from db rows (set `maxHp` from the shared
//      `CHARACTER_MAX_HP` phase-1 tuning constant — characters table
//      doesn't store maxHp).
//   3. Build heard-last-turn per agent by reading the persisted
//      `trace.speech[].heardBy` audience from the prior turn's resolver
//      output (concept-spec.md §16 + WP8 contract — `resolution.ts` is the
//      sole producer of the §16-correct audience; we just deliver it).
//   4. Promise.all 8 calls to `callDecisionTool` (WP6 wrapper — never
//      throws; per-agent fallbacks visible via `failureReason`).
//   5. Validate each decision (WP5); SAFE_DEFAULT_DECISION on invalid.
//   6. Resolve the turn (WP7) → produces `nextState` + `ResolutionTrace`.
//   7. Persist `turns` row (full agentRecords[] per ADR §7 — incl. system
//      + persona prompt text/hash, visibleStateDigest, scratchpadBefore,
//      decision, scratchpadAfter, llm metadata).
//   8. Patch characters + worldState rows from the resolved nextState.
//   9. Termination: if turn>=50 OR aliveCount<=1 → mark completed, populate
//      `outcome`. Else → `scheduler.runAfter(0, ...)` to chain.
//
// Trace adaptation notes (locked in WP7 head-of-type comment):
//   - `ResolutionTrace.consumed[i].item` is a string ConsumableName; the
//     schema validator expects `{category:"consumable", name:...}`. WP10
//     adapts at persistence time.
//   - `ResolutionTrace` characterIds are plain strings; the schema's
//     resolution + agentRecord validators use `v.id("characters")`. Convex
//     Id values ARE strings at runtime; the same string round-trips.
//
// Cross-references:
//   - ADR §6 — schema (locked).
//   - ADR §7 — trace shape (this file builds the row).
//   - work-packages.md WP10 — acceptance criteria.

import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel.js";
import { action } from "./_generated/server.js";
import { api } from "./_generated/api.js";

import { resolveTurn, type ResolutionTrace } from "./engine/resolution.js";
import {
  validateDecision,
  type ValidatorFieldErrors,
} from "./engine/validation.js";
import {
  CHARACTER_MAX_HP,
  SAFE_DEFAULT_DECISION,
  type ArmourName,
  type CharacterState,
  type ConsumableName,
  type EquippedSlots,
  type FailureReason,
  type HeardSpeech,
  type ItemRef,
  type MatchState,
  type ParsedDecision,
  type PersonaId,
  type Position,
  type Tile,
  type UseVariant,
  type WeaponName,
  type WorldState,
} from "./engine/types.js";
import { buildAgentInput, type PrevTurnRow } from "./llm/inputBuilder.js";
import { callDecisionTool, type AzureUsage } from "./llm/azure.js";
import { loadPersonas } from "./llm/personas.js";

// ─── Tunables (locked) ─────────────────────────────────────────────────────

/** Phase-1 max HP for every character. The schema doesn't store maxHp; the
 *  engine reads it from the shared `CHARACTER_MAX_HP` constant in
 *  `engine/types.ts` so `matches.start` (initial `hp`) and
 *  `runMatch.buildMatchState` (`maxHp`) cannot drift. This is a tuning
 *  value (Gate-2.5 review 2026-05-07), NOT a `concept-spec.md` invariant
 *  — §12 specifies the damage formula and minimum floor only.
 *  Exported (read-only re-export of `CHARACTER_MAX_HP`) so tests can
 *  pin the source-of-truth parity with `matches.ts`'s initial `hp` seed. */
export const MAX_HP = CHARACTER_MAX_HP;
/** Total turn count before forced termination — concept-spec §15. */
const FINAL_TURN = 50;
/** Default reasoning effort when the matches row has none persisted (legacy
 *  rows or callers omitting the arg) — concept-spec / de-risking.md
 *  "Reasoning policy" makes "low" the phase-1 default; "none" is forbidden. */
const DEFAULT_REASONING_EFFORT = "low" as const;
/** Per-call max output tokens — locked at 1200 (WP6/WP10 budget). */
const MAX_OUTPUT_TOKENS = 1200;
/** Per-call abort timeout — 60s per ADR §4. The wrapper enforces. */
const CALL_ABORT_TIMEOUT_MS = 60_000;
/** Turn-50 sole-survivor / extraction prize pool. Equally split among
 *  extracted set; sole survivor takes 100 if last alive. (Phase-1 simple. */
const PRIZE_POOL = 100;

// ─── Lightweight 32-bit hash (DJB2 → hex) ─────────────────────────────────
//
// Why not `node:crypto` SHA-256? Convex `"use node"` actions support node
// imports, but using a tiny inline hash keeps this module bundler-friendly
// and removes a dep on a heavier API for what is, per ADR §7, just a
// "cheap diff key" across runs. The hash isn't cryptographic — it's an
// audit identity for prompt text. WP15 prompt edits will produce a
// different hex value; that's all that's required.

/**
 * DJB2-style 32-bit hash → 8-char hex string. Stable across calls, same
 * input always produces the same output. Used to populate
 * `agentRecords[].input.{systemPromptHash,personaPromptHash}` (ADR §7).
 */
function hashHex(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    // h = h * 33 + char — xor variant for slightly better distribution.
    h = ((h << 5) + h) ^ text.charCodeAt(i);
    // Coerce to unsigned 32-bit each iteration.
    h = h >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// ─── Slot narrowing helpers ────────────────────────────────────────────────
//
// The engine's `EquippedSlots` types each slot as `ItemRef` (the broad
// union over weapon/armour/consumable), but the schema's validators
// expect each slot to be narrowed to its own category. The engine's
// `equipIntoSlot` only ever places matching-category items, so the broad
// type is just structural-typing convenience. We narrow at the schema
// boundary by re-tagging with the exact category literal.

type NarrowedEquipped = {
  weapon?: { category: "weapon"; name: WeaponName };
  armour?: { category: "armour"; name: ArmourName };
  consumable?: { category: "consumable"; name: ConsumableName };
};

function narrowSlot(
  ref: ItemRef | undefined,
  expected: "weapon",
): { category: "weapon"; name: WeaponName } | undefined;
function narrowSlot(
  ref: ItemRef | undefined,
  expected: "armour",
): { category: "armour"; name: ArmourName } | undefined;
function narrowSlot(
  ref: ItemRef | undefined,
  expected: "consumable",
): { category: "consumable"; name: ConsumableName } | undefined;
function narrowSlot(
  ref: ItemRef | undefined,
  expected: "weapon" | "armour" | "consumable",
):
  | { category: "weapon"; name: WeaponName }
  | { category: "armour"; name: ArmourName }
  | { category: "consumable"; name: ConsumableName }
  | undefined {
  if (!ref) return undefined;
  if (ref.category !== expected) return undefined;
  // Re-tag to the literal-narrow shape — tsc can't infer this through the
  // function-overload bridge, but the runtime value is unchanged.
  if (expected === "weapon") {
    return { category: "weapon", name: ref.name as WeaponName };
  }
  if (expected === "armour") {
    return { category: "armour", name: ref.name as ArmourName };
  }
  return { category: "consumable", name: ref.name as ConsumableName };
}

function narrowEquipped(slots: EquippedSlots): NarrowedEquipped {
  const out: NarrowedEquipped = {};
  const w = narrowSlot(slots.weapon, "weapon");
  if (w) out.weapon = w;
  const a = narrowSlot(slots.armour, "armour");
  if (a) out.armour = a;
  const c = narrowSlot(slots.consumable, "consumable");
  if (c) out.consumable = c;
  return out;
}

// ─── Engine state ↔ Convex row shaping ─────────────────────────────────────

/**
 * Build the in-memory engine `MatchState` from Convex rows. The engine uses
 * plain string `characterId`s and a runtime `maxHp` of `CHARACTER_MAX_HP`
 * (the shared phase-1 tuning constant); both round-trip with the schema
 * (Convex Id values ARE strings at runtime).
 *
 * Exported for unit testing the new-match HP invariant
 * (`hp === maxHp === CHARACTER_MAX_HP`) without standing up a Convex
 * runtime; the `Doc<...>` row shapes are structural and accept plain
 * test fixtures.
 */
export function buildMatchState(
  matchRow: Doc<"matches">,
  characters: Doc<"characters">[],
  worldRow: Doc<"worldState">,
  descriptorSize: { w: number; h: number },
): MatchState {
  const charStates: CharacterState[] = characters.map((c) => ({
    characterId: c._id as string,
    personaId: c.personaId,
    spawnIndex: c.spawnIndex,
    displayName: c.displayName,
    hp: c.hp,
    maxHp: MAX_HP,
    pos: { x: c.pos.x, y: c.pos.y },
    equipped: { ...c.equipped },
    scratchpad: c.scratchpad,
    hidden: c.hidden,
    alive: c.alive,
    diedAtTurn: c.diedAtTurn,
    extractedAtTurn: c.extractedAtTurn,
    lastKnown: c.lastKnown.map((entry) => ({
      characterId: entry.characterId as string,
      pos: { x: entry.pos.x, y: entry.pos.y },
      atTurn: entry.atTurn,
    })),
  }));

  const world: WorldState = {
    size: descriptorSize,
    walls: worldRow.walls.map((w) => ({ x: w.x, y: w.y, w: w.w, h: w.h })),
    coverClusters: worldRow.coverClusters.map((w) => ({
      x: w.x,
      y: w.y,
      w: w.w,
      h: w.h,
    })),
    coverTiles: worldRow.coverTiles.map((t) => ({ x: t.x, y: t.y })),
    // ChestState in the engine carries `lootTable`; the row shape doesn't
    // (it's bookkeeping only, used by WP3 expansion). Re-inject a stub
    // value — the engine never re-rolls loot post-spawn so the lootTable
    // value is unused after match-start.
    chests: worldRow.chests.map((c) => ({
      id: c.id,
      pos: { x: c.pos.x, y: c.pos.y },
      contents: c.contents,
      opened: c.opened,
      lootTable: "",
    })),
    corpses: worldRow.corpses.map((c) => ({
      characterId: c.characterId as string,
      pos: { x: c.pos.x, y: c.pos.y },
      contents: { ...c.contents },
    })),
    evac: {
      centre: { x: worldRow.evac.centre.x, y: worldRow.evac.centre.y },
      revealedAtTurn: worldRow.evac.revealedAtTurn,
    },
  };

  return {
    matchId: matchRow._id as string,
    turn: matchRow.turn,
    world,
    characters: charStates,
    rngSeed: matchRow.rngSeed,
  };
}

// ─── Speech-window filter (concept-spec §16 + WP8) ─────────────────────────

/**
 * Build the heard-last-turn filtered list for `observer` from the prior
 * turn's persisted resolution speech array.
 *
 * §16-correct semantics live in `convex/engine/resolution.ts:236-263`: the
 * resolver computes `heardBy` against every listener's start-of-turn-N
 * position (the position at the moment of speech) and persists it on
 * `trace.speech[].heardBy`. WP10's job is therefore a direct read of the
 * persisted audience — NOT a re-filter against current (turn N+1)
 * positions, which would drift if the speaker or observer moved during
 * resolution. (gate-1-review.md flagged the previous re-filter as a
 * §16-correctness regression risk; bundle WP10.5 A4 fixes it.)
 *
 * Exported for unit testing the direct-read invariant; the engine is the
 * sole producer of `heardBy`, so the consumer's only job is honest
 * delivery.
 */
export function buildHeardForObserver(
  observer: CharacterState,
  speech: ResolutionTrace["speech"],
  // characters is unused now (the trace is self-sufficient) but kept on the
  // signature to avoid churning callers; WP10's call site already has the
  // list in scope and we don't want a second public parameter shape on the
  // helper. Marked `_` to satisfy strict-unused-variable lint.
  _characters: CharacterState[],
): HeardSpeech[] {
  if (!speech || speech.length === 0) return [];
  const out: HeardSpeech[] = [];
  for (const entry of speech) {
    if (!entry.heardBy.includes(observer.characterId)) continue;
    out.push({ speakerId: entry.characterId, text: entry.text });
  }
  return out;
}

// ─── Agent-llm record builder (pure; testable) ─────────────────────────────

/**
 * Build the `llm` block of one `agentRecords[]` row from the per-agent
 * resolved-call result. Pure / no I/O — extracted so the
 * `validatorFieldErrors` mapping invariant can be unit-tested
 * without spinning up the Convex action.
 *
 * Mapping rules (locked):
 *   - `failureReason` is INCLUDED only when truthy (matches the prior
 *     `...(r.failureReason ? { failureReason: r.failureReason } : {})`
 *     spread). Convex's optional validator accepts absent OR present, but
 *     never `undefined` as a value. The conditional spread is the canonical
 *     way to honour that.
 *   - `validatorFieldErrors` follows the same conditional-spread pattern. When
 *     the engine validator (`convex/engine/validation.ts`) accepted every
 *     field, no error object exists; when it rejected one or more fields,
 *     per-field reasons are persisted.
 *
 * Both fields are `v.optional(...)` in the schema (`convex/schema.ts`
 * agentLlmValidator + `convex/_internal_runMatch.ts` mirror), so absence
 * is the persisted shape for the common case.
 */
export function buildAgentLlmRecord(r: {
  responseId: string | null;
  callId: string | null;
  rawArguments: string | null;
  usage: AzureUsage | null;
  latencyMs: number;
  httpStatus: number | null;
  wrapperFellBack: boolean;
  failureReason: FailureReason | undefined;
  validatorFieldErrors: ValidatorFieldErrors | undefined;
  /** WP10.5 Pass F — captured non-OK HTTP body excerpt (already sanitised
   *  + truncated by the wrapper). Set only on `failureReason: "http_non_200"`. */
  httpBodyExcerpt?: string | undefined;
  /** Phase 7 WP-A1 — wrapper retry marker. Optional for historical rows. */
  retried?: boolean | undefined;
  /** Phase-3 ADR §2 / PM lock D13 — captured reasoning text. REQUIRED-
   *  NULLABLE: persisted as `null` on every non-captured path. */
  reasoning: string | null;
}): {
  responseId: string | null;
  callId: string | null;
  rawArguments: string | null;
  usage: AzureUsage | null;
  latencyMs: number;
  httpStatus: number | null;
  fellBackToSafeDefault: boolean;
  failureReason?: FailureReason;
  validatorFieldErrors?: ValidatorFieldErrors;
  httpBodyExcerpt?: string;
  retried?: boolean;
  reasoning: string | null;
} {
  return {
    responseId: r.responseId,
    callId: r.callId,
    rawArguments: r.rawArguments,
    usage: r.usage,
    latencyMs: r.latencyMs,
    httpStatus: r.httpStatus,
    fellBackToSafeDefault: r.wrapperFellBack,
    ...(r.failureReason ? { failureReason: r.failureReason } : {}),
    ...(r.validatorFieldErrors &&
    Object.keys(r.validatorFieldErrors).length > 0
      ? { validatorFieldErrors: r.validatorFieldErrors }
      : {}),
    // WP10.5 Pass F — conditional spread (same pattern as failureReason /
    // validatorFieldErrors). The Convex `v.optional(...)` validator accepts
    // absent OR present, but never `undefined` as a value.
    ...(r.httpBodyExcerpt !== undefined
      ? { httpBodyExcerpt: r.httpBodyExcerpt }
      : {}),
    ...(r.retried !== undefined ? { retried: r.retried } : {}),
    // Phase-3 — required-nullable, NEVER conditionally spread. The
    // schema validator is `v.union(v.string(), v.null())` (PM lock D13);
    // every persisted row carries this field with `null` as the
    // unambiguous "not captured" sentinel.
    reasoning: r.reasoning,
  };
}

export function useVariantForActor(
  actor: Pick<CharacterState, "equipped">,
): UseVariant {
  return actor.equipped.consumable ? "consumable_or_null" : "null_only";
}

export function buildAgentInputRecord(r: {
  systemPrompt: string;
  personaPromptText: string;
  visibleStateDigest: string;
  scratchpadBefore: string;
  composedUserMessage: string;
  useVariant: UseVariant;
}) {
  return {
    systemPromptHash: hashHex(r.systemPrompt),
    systemPromptText: r.systemPrompt,
    personaPromptHash: hashHex(r.personaPromptText),
    personaPromptText: r.personaPromptText,
    visibleStateDigest: r.visibleStateDigest,
    scratchpadBefore: r.scratchpadBefore,
    composedUserMessage: r.composedUserMessage,
    useVariant: r.useVariant,
  };
}

// ─── Schema-conformant adapters for resolution trace ───────────────────────

/**
 * Adapt `ResolutionTrace` (engine vocabulary) to the schema's
 * `resolutionValidator` shape. Adaptations:
 *   - `consumed[].item: ConsumableName` (engine string) → `{category:"consumable", name:...}` (schema ItemRef).
 *   - `characterId: string` (engine) → `Id<"characters">` (schema). Convex
 *     Id values ARE strings at runtime; we cast at the boundary.
 *   - Phase-3 ADR §9 / Phase-6 overwatch audit — propagate optional
 *     engine-emitted trace fields verbatim so metrics survive persistence:
 *       - `moves[].blockedBy: "wall"` — wall-blocked move marker
 *         (movement.ts:449-455).
 *       - `actions[].triggeredByMovement: boolean` — movement-triggered
 *         overwatch attribution.
 *       - `actions[].weapon: string` — phase-4 strike-time weapon name
 *         for attack/overwatch damage entries.
 *     These are optional in BOTH the engine emit type and the
 *     schema validators (`v.optional(...)`); we use the conditional-
 *     spread pattern so absent values stay absent (Convex `v.optional`
 *     accepts absent OR present, but never `undefined` as a value).
 *
 * Exported (rather than file-local) so the WP-F.1 persist-adapter parity
 * test can drive the mapper directly without spinning up the Convex
 * action runtime — the parity invariant is the load-bearing one for
 * persisted trace metric correctness.
 */
export function adaptResolutionForSchema(
  trace: ResolutionTrace,
): {
  consumed: Array<{
    characterId: Id<"characters">;
    item: { category: "consumable"; name: ConsumableName };
  }>;
  speech: Array<{
    characterId: Id<"characters">;
    text: string;
    heardBy: Id<"characters">[];
  }>;
  moves: Array<{
    characterId: Id<"characters">;
    from: Tile;
    to: Tile;
    blockedBy?: "wall";
    slide?: {
      wallRectId: string;
      axis: "N" | "E" | "S" | "W";
      intent: string;
    };
    bodyCollision?:
      | { kind: "character"; defenderId: Id<"characters"> }
      | { kind: "wall"; wallRectId: string };
  }>;
  actions: Array<{
    characterId: Id<"characters">;
    kind: "attack" | "loot" | "overwatch" | "counter";
    target: string;
    result: string;
    triggeredByMovement?: boolean;
    weapon?: string;
    lootedItem?: string;
  }>;
  deaths: Id<"characters">[];
  visibilityUpdates: Array<{
    characterId: Id<"characters">;
    hidden: boolean;
    revealedBy?:
      | "attack"
      | "loot"
      | "speech"
      | "consumable"
      | "leaving_cover"
      | "proximity";
  }>;
} {
  return {
    consumed: trace.consumed.map((c) => ({
      characterId: c.characterId as Id<"characters">,
      item: { category: "consumable" as const, name: c.item },
    })),
    speech: trace.speech.map((s) => ({
      characterId: s.characterId as Id<"characters">,
      text: s.text,
      heardBy: s.heardBy.map((h) => h as Id<"characters">),
    })),
    moves: trace.moves.map((m) => ({
      characterId: m.characterId as Id<"characters">,
      from: { x: m.from.x, y: m.from.y },
      to: { x: m.to.x, y: m.to.y },
      // Phase-3 ADR §9 — wall-blocked-move marker. Conditional spread:
      // engine omits the field on every non-blocked move entry, and the
      // schema validator is `v.optional(v.literal("wall"))`.
      ...(m.blockedBy !== undefined ? { blockedBy: m.blockedBy } : {}),
      ...(m.slide !== undefined ? { slide: m.slide } : {}),
      ...(m.bodyCollision !== undefined
        ? {
            bodyCollision:
              m.bodyCollision.kind === "character"
                ? {
                    kind: "character" as const,
                    defenderId:
                      m.bodyCollision.defenderId as Id<"characters">,
                  }
                : m.bodyCollision,
          }
        : {}),
    })),
    actions: trace.actions.map((a) => ({
      characterId: a.characterId as Id<"characters">,
      kind: a.kind,
      target: a.target,
      result: a.result,
      ...(a.triggeredByMovement !== undefined
        ? { triggeredByMovement: a.triggeredByMovement }
        : {}),
      ...(a.weapon !== undefined ? { weapon: a.weapon } : {}),
      ...(a.lootedItem !== undefined ? { lootedItem: a.lootedItem } : {}),
    })),
    deaths: trace.deaths.map((d) => d as Id<"characters">),
    visibilityUpdates: trace.visibilityUpdates.map((u) => ({
      characterId: u.characterId as Id<"characters">,
      hidden: u.hidden,
      revealedBy: u.revealedBy,
    })),
  };
}

type PersistedSlideTrace = {
  wallRectId: string;
  axis: "N" | "E" | "S" | "W";
  intent: string;
};

type PersistedBodyCollisionTrace =
  | { kind: "character"; defenderId: string }
  | { kind: "wall"; wallRectId: string };

type PersistedPriorTurnRow = {
  resolution: {
    consumed: ReadonlyArray<{
      characterId: string;
      item: { name: ConsumableName };
    }>;
    speech: ReadonlyArray<{
      characterId: string;
      text: string;
      heardBy: ReadonlyArray<string>;
    }>;
    moves: ReadonlyArray<{
      characterId: string;
      from: Tile;
      to: Tile;
      blockedBy?: "wall";
      slide?: PersistedSlideTrace;
      bodyCollision?: PersistedBodyCollisionTrace;
    }>;
    actions: ReadonlyArray<{
      characterId: string;
      kind: string;
      target: string;
      result: string;
      triggeredByMovement?: boolean;
      weapon?: string;
      lootedItem?: string;
    }>;
    deaths: ReadonlyArray<string>;
    visibilityUpdates: ReadonlyArray<{
      characterId: string;
      hidden: boolean;
      revealedBy?: string;
    }>;
  };
  agentRecords: ReadonlyArray<{
    characterId: string;
    decision: { position: Position };
  }>;
};

export function adaptPriorTurnRowForBuilder(
  priorTurnRow: PersistedPriorTurnRow | null,
): PrevTurnRow | null {
  if (!priorTurnRow) return null;
  return {
    resolution: {
      consumed: priorTurnRow.resolution.consumed.map((c) => ({
        characterId: c.characterId as string,
        item: c.item.name,
      })),
      speech: priorTurnRow.resolution.speech.map((s) => ({
        characterId: s.characterId as string,
        text: s.text,
        heardBy: s.heardBy.map((h) => h as string),
      })),
      moves: priorTurnRow.resolution.moves.map((m) => ({
        characterId: m.characterId as string,
        from: { x: m.from.x, y: m.from.y },
        to: { x: m.to.x, y: m.to.y },
        ...(m.blockedBy ? { blockedBy: m.blockedBy } : {}),
        ...(m.slide !== undefined ? { slide: m.slide } : {}),
        ...(m.bodyCollision !== undefined
          ? { bodyCollision: m.bodyCollision }
          : {}),
      })),
      actions: priorTurnRow.resolution.actions.map((a) => ({
        characterId: a.characterId as string,
        kind: a.kind,
        target: a.target,
        result: a.result,
        ...(a.triggeredByMovement !== undefined
          ? { triggeredByMovement: a.triggeredByMovement }
          : {}),
        ...(a.weapon !== undefined ? { weapon: a.weapon } : {}),
        ...(a.lootedItem !== undefined ? { lootedItem: a.lootedItem } : {}),
      })),
      deaths: priorTurnRow.resolution.deaths.map((d) => d as string),
      visibilityUpdates: priorTurnRow.resolution.visibilityUpdates.map((u) => ({
        characterId: u.characterId as string,
        hidden: u.hidden,
        ...(u.revealedBy !== undefined ? { revealedBy: u.revealedBy } : {}),
      })),
    },
    priorPositionByActor: Object.fromEntries(
      priorTurnRow.agentRecords.map((r) => [
        r.characterId as string,
        r.decision.position,
      ]),
    ),
  };
}

// ─── Public action: advanceTurn ───────────────────────────────────────────

/**
 * `runMatch.advanceTurn` — drives one turn of a match end-to-end. Wraps
 * the body in a single try/catch (WP10 contract); never re-throws.
 *
 * Returns `null` (Convex action shape; the harness reads outcomes via
 * `matches.status` polling — return value is unused by the chain).
 */
export const advanceTurn = action({
  args: { matchId: v.id("matches") },
  returns: v.null(),
  handler: async (ctx, { matchId }) => {
    // Track currentTurn for failure reporting; updated once we read the row.
    let currentTurn = 0;
    try {
      // ── 1. Read match + character + world rows. ─────────────────────────
      const matchRow = await ctx.runQuery(api.matches.get, { id: matchId });
      if (!matchRow) {
        // Defensive: a deleted match should silently halt the chain.
        return null;
      }
      // No-op if the match is already terminal (or the row was missing).
      if (matchRow.status === "completed" || matchRow.status === "failed") {
        return null;
      }
      currentTurn = matchRow.turn + 1; // We are RESOLVING currentTurn now.

      // Flip pending → running on first invocation.
      if (matchRow.status === "pending") {
        await ctx.runMutation(api._internal_runMatch.markRunning, {
          matchId,
        });
      }

      const characters = await ctx.runQuery(
        api._internal_runMatch.charactersByMatch,
        { matchId },
      );
      const worldRow = await ctx.runQuery(
        api._internal_runMatch.worldByMatch,
        { matchId },
      );
      if (!worldRow) {
        throw new Error(
          `runMatch.advanceTurn: worldState row missing for match ${matchId}`,
        );
      }

      // Use the descriptor's size constant (100×100 reference map per ADR §5).
      const state: MatchState = buildMatchState(
        { ...matchRow, turn: currentTurn },
        characters,
        worldRow,
        { w: 100, h: 100 },
      );

      // ── 2. Read prior turn row (for Last turn (you) line + per-Visible
      //      observation brackets per phase-3 ADR §6). ─────────────────────
      const priorTurnRow =
        currentTurn > 1
          ? await ctx.runQuery(api._internal_runMatch.turnByMatchTurn, {
              matchId,
              turn: currentTurn - 1,
            })
          : null;
      // Adapt the persisted row's resolution to the engine string-id shape
      // the inputBuilder consumes. The Convex Id values ARE strings at
      // runtime; we cast via `as string` at the boundary.
      const prevTurnRowForBuilder = adaptPriorTurnRowForBuilder(priorTurnRow);

      // Phase-1 helper kept alive for any internal speech-audience consumer
      // that still wants a HeardSpeech[] view; the digest no longer renders
      // a Heard: section, but `buildHeardForObserver` remains exported and
      // unit-tested (`tests/runMatch.test.ts`).
      const priorSpeech: ResolutionTrace["speech"] =
        prevTurnRowForBuilder?.resolution.speech.map((s) => ({
          characterId: s.characterId,
          text: s.text,
          heardBy: [...s.heardBy],
        })) ?? [];

      // ── 3. Load personas (per-call, allows hot-edits per WP9). ──────────
      const personas = loadPersonas();

      // ── 4. Build agent inputs + Promise.all callDecisionTool for living
      //      agents. Dead agents are not asked for decisions (and not
      //      written into agentRecords; WP10 acceptance: "Every row in
      //      `turns` has agent records for every agent that was alive at
      //      the start of that turn"). ────────────────────────────────────
      const livingActors = state.characters.filter((c) => c.alive);
      const aliveCount = characters.filter((c) => c.alive).length;

      type PerAgent = {
        actor: CharacterState;
        heard: HeardSpeech[];
        systemPrompt: string;
        personaPromptText: string;
        visibleStateDigest: string;
        composedUserMessage: string;
        scratchpadBefore: string;
        useVariant: UseVariant;
      };

      const perAgent: PerAgent[] = livingActors.map((actor) => {
        const personaText = personas[actor.personaId as PersonaId] ?? "";
        const heard = buildHeardForObserver(actor, priorSpeech, state.characters);
        const built = buildAgentInput(
          state,
          actor.characterId,
          personaText,
          prevTurnRowForBuilder,
          aliveCount,
        );
        const useVariant = useVariantForActor(actor);
        return {
          actor,
          heard,
          systemPrompt: built.systemPrompt,
          personaPromptText: personaText,
          visibleStateDigest: built.visibleStateDigest,
          composedUserMessage: built.composedUserMessage,
          scratchpadBefore: actor.scratchpad,
          useVariant,
        };
      });

      // WP10.5 A5 — read reasoning effort from the matches row, defaulting
      // to "low" when the field is absent (legacy rows or callers omitting
      // the arg). Plumbed CLI → matches.start → matches row → here →
      // callDecisionTool.
      const reasoningEffort =
        matchRow.reasoningEffort ?? DEFAULT_REASONING_EFFORT;

      const callPromises = perAgent.map((entry) =>
        callDecisionTool({
          systemPrompt: entry.systemPrompt,
          personaPrompt: entry.personaPromptText,
          scratchpad: entry.scratchpadBefore,
          visibleStateDigest: entry.visibleStateDigest,
          composedUserMessage: entry.composedUserMessage,
          playerName: entry.actor.displayName,
          useVariant: entry.useVariant,
          reasoningEffort,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          abortTimeoutMs: CALL_ABORT_TIMEOUT_MS,
        }),
      );
      const callResults = await Promise.all(callPromises);

      // ── 5. Validate decisions; substitute SAFE_DEFAULT_DECISION on
      //      semantic failure (WP5). ──────────────────────────────────────
      type AgentResolved = {
        actor: CharacterState;
        personaPromptText: string;
        systemPrompt: string;
        visibleStateDigest: string;
        composedUserMessage: string;
        scratchpadBefore: string;
        useVariant: UseVariant;
        decision: ParsedDecision;
        wrapperFellBack: boolean;
        // Narrowed to the schema's union; `undefined` when no failure.
        failureReason: FailureReason | undefined;
        validatorFieldErrors: ValidatorFieldErrors | undefined;
        callId: string | null;
        rawArguments: string | null;
        responseId: string | null;
        usage: AzureUsage | null;
        latencyMs: number;
        httpStatus: number | null;
        /** WP10.5 Pass F — non-OK HTTP body excerpt (sanitised+truncated
         *  by the wrapper). Set only on `failureReason: "http_non_200"`. */
        httpBodyExcerpt: string | undefined;
        /** Phase 7 WP-A1 — wrapper retry marker. */
        retried: boolean | undefined;
        /** Phase-3 ADR §2 — captured reasoning text. REQUIRED-NULLABLE:
         *  `null` on every non-captured path. */
        reasoning: string | null;
      };

      const resolved: AgentResolved[] = perAgent.map((entry, i) => {
        const result = callResults[i]!;
        // Run validator on the wrapper's decision (which is safe-default if
        // wrapper already fell back). Validator may further reject on
        // semantic grounds.
        const validation = validateDecision(
          state,
          entry.actor.characterId,
          result.decision,
        );
        const finalDecision: ParsedDecision = validation.decision;
        const validatorFieldErrors =
          Object.keys(validation.fieldErrors).length > 0
            ? validation.fieldErrors
            : undefined;

        // If the validator rejected (and the wrapper hadn't already fallen
        // back), this counts as the engine's safe-default substitution per
        // ADR §4 / concept-spec §2A.3. We surface `fellBackToSafeDefault`
        // = true in that case so trace consumers see the substitution.
        const fellBack =
          result.fellBackToSafeDefault || validatorFieldErrors !== undefined;

        return {
          actor: entry.actor,
          personaPromptText: entry.personaPromptText,
          systemPrompt: entry.systemPrompt,
          visibleStateDigest: entry.visibleStateDigest,
          composedUserMessage: entry.composedUserMessage,
          scratchpadBefore: entry.scratchpadBefore,
          useVariant: entry.useVariant,
          decision: finalDecision,
          wrapperFellBack: fellBack,
          failureReason: result.failureReason,
          validatorFieldErrors,
          callId: result.callId,
          rawArguments: result.rawArguments,
          responseId: result.raw.responseId,
          usage: result.raw.usage,
          latencyMs: result.raw.latencyMs,
          httpStatus: result.raw.httpStatus,
          retried: result.raw.retried,
          // WP10.5 Pass F — pass-through of the captured non-OK body
          // excerpt. Wrapper sets it only on http_non_200; absent/undefined
          // on every other path.
          httpBodyExcerpt: result.raw.httpBodyExcerpt,
          // Phase-3 ADR §2 — pass-through of the captured reasoning
          // text. Wrapper sets `null` on every non-captured path
          // (failure rows, no-reasoning-item happy paths) so the
          // persisted shape is unambiguous.
          reasoning: result.raw.reasoning,
        };
      });

      // ── 6. Resolve the turn. ────────────────────────────────────────────
      const decisions = new Map<string, ParsedDecision>();
      for (const r of resolved) {
        decisions.set(r.actor.characterId, r.decision);
      }
      // Provide a safe-default for ANY living-but-uncalled actors (defensive
      // — perAgent is built from livingActors so this loop is exhaustive,
      // but the resolver expects a decision for any id it sees in `decisions`).
      for (const actor of livingActors) {
        if (!decisions.has(actor.characterId)) {
          decisions.set(actor.characterId, SAFE_DEFAULT_DECISION);
        }
      }

      const { state: nextState, trace } = resolveTurn(state, decisions);

      // ── 7. Persist via internal mutation. ────────────────────────────────
      // Build agentRecords with the locked ADR §7 schema. The validator
      // accepts undefined `failureReason` (it's `v.optional(...)`); a
      // validator-only rejection has no LLM-level failureReason but DOES
      // surface as `fellBackToSafeDefault=true`.
      const agentRecords = resolved.map((r) => ({
        characterId: r.actor.characterId as Id<"characters">,
        personaId: r.actor.personaId,
        input: buildAgentInputRecord(r),
        decision: r.decision,
        scratchpadAfter: nextState.characters.find(
          (c) => c.characterId === r.actor.characterId,
        )?.scratchpad ?? r.scratchpadBefore,
        // Validator field errors are threaded via the pure helper so
        // field-scoped rejections are visible from the persisted trace.
        // Pass F — `httpBodyExcerpt` threaded similarly so HTTP-error
        // bodies (Azure 400 moderation, etc.) land in the trace.
        llm: buildAgentLlmRecord({
          responseId: r.responseId,
          callId: r.callId,
          rawArguments: r.rawArguments,
          usage: r.usage,
          latencyMs: r.latencyMs,
          httpStatus: r.httpStatus,
          wrapperFellBack: r.wrapperFellBack,
          failureReason: r.failureReason,
          validatorFieldErrors: r.validatorFieldErrors,
          httpBodyExcerpt: r.httpBodyExcerpt,
          retried: r.retried,
          // Phase-3 ADR §2 — required-nullable reasoning text.
          reasoning: r.reasoning,
        }),
      }));

      const adaptedResolution = adaptResolutionForSchema(trace);

      // ── 8. Termination decision. ─────────────────────────────────────────
      // `nextState.turn` is already incremented past `currentTurn` by the
      // resolver. We use `currentTurn` as the "we just resolved" marker.
      const aliveAfter = nextState.characters.filter((c) => c.alive);
      const aliveAfterCount = aliveAfter.length;
      const extractedSet = nextState.characters
        .filter((c) => c.extractedAtTurn === currentTurn)
        .map((c) => c.characterId as Id<"characters">);
      const isTerminal =
        currentTurn >= FINAL_TURN || aliveAfterCount <= 1;

      // Build outcome on terminal.
      let outcome:
        | {
            extracted: Id<"characters">[];
            lastSurvivor?: Id<"characters">;
            pointsByCharacter: Array<{
              id: Id<"characters">;
              points: number;
            }>;
          }
        | undefined;
      if (isTerminal) {
        const pointsByCharacter: Array<{
          id: Id<"characters">;
          points: number;
        }> = [];
        if (aliveAfterCount === 1 && extractedSet.length === 0) {
          // Sole survivor (last-agent-standing branch): solo wins prize pool.
          const sole = aliveAfter[0]!;
          pointsByCharacter.push({
            id: sole.characterId as Id<"characters">,
            points: PRIZE_POOL,
          });
        } else if (extractedSet.length > 0) {
          // Even split among extracted (turn-50 branch).
          const share = Math.floor(PRIZE_POOL / extractedSet.length);
          for (const id of extractedSet) {
            pointsByCharacter.push({ id, points: share });
          }
        }
        outcome = {
          extracted: extractedSet,
          ...(aliveAfterCount === 1
            ? {
                lastSurvivor: aliveAfter[0]!
                  .characterId as Id<"characters">,
              }
            : {}),
          pointsByCharacter,
        };
      }

      await ctx.runMutation(api._internal_runMatch.persistTurn, {
        matchId,
        turn: currentTurn,
        agentRecords,
        resolution: adaptedResolution,
        characterPatches: nextState.characters.map((c) => ({
          id: c.characterId as Id<"characters">,
          hp: c.hp,
          pos: { x: c.pos.x, y: c.pos.y },
          equipped: narrowEquipped(c.equipped),
          scratchpad: c.scratchpad,
          hidden: c.hidden,
          alive: c.alive,
          diedAtTurn: c.diedAtTurn,
          extractedAtTurn: c.extractedAtTurn,
          lastKnown: c.lastKnown.map((entry) => ({
            characterId: entry.characterId as Id<"characters">,
            pos: { x: entry.pos.x, y: entry.pos.y },
            atTurn: entry.atTurn,
          })),
        })),
        worldPatch: {
          chests: nextState.world.chests.map((c) => ({
            id: c.id,
            pos: { x: c.pos.x, y: c.pos.y },
            contents: c.contents,
            opened: c.opened,
          })),
          corpses: nextState.world.corpses.map((c) => ({
            characterId: c.characterId as Id<"characters">,
            pos: { x: c.pos.x, y: c.pos.y },
            contents: narrowEquipped(c.contents),
          })),
          evac: {
            centre: {
              x: nextState.world.evac.centre.x,
              y: nextState.world.evac.centre.y,
            },
            revealedAtTurn: nextState.world.evac.revealedAtTurn,
          },
        },
        nextTurn: currentTurn,
        terminal: isTerminal,
        outcome,
      });

      // ── 9. Schedule next turn (or stop) + aggregate on terminal. ─────────
      if (!isTerminal) {
        await ctx.scheduler.runAfter(0, api.runMatch.advanceTurn, { matchId });
      } else {
        // WP12 boundary contract (ADR §6 / WP10 acceptance): on terminal
        // completion, schedule `runs.aggregate(matchId)` to write the per-
        // match `runs` row. WP10 does NOT compute the aggregate inline —
        // that ownership belongs to WP12. The aggregator is idempotent
        // (re-firing on the same matchId is a no-op) so even if this
        // schedule is re-attempted by chain replay the result is stable.
        // Failed matches are NOT aggregated (the catch branch below halts
        // the chain without entering this branch, and `runs.aggregate`
        // also defensively bails on non-completed status).
        await ctx.scheduler.runAfter(0, api.runs.aggregate, { matchId });
      }
      return null;
    } catch (e) {
      const reason =
        e instanceof Error ? e.message : `unknown error: ${String(e)}`;
      // Defensive failure write — never re-throws.
      try {
        await ctx.runMutation(api._internal_runMatch.markFailed, {
          matchId,
          turn: currentTurn,
          reason,
        });
      } catch {
        // If even the failure write fails, swallow — the chain has already
        // halted and the harness will see the last-known state.
      }
      return null;
    }
  },
});

// ─── Internal mutations + queries (default Convex runtime) ─────────────────
//
// These live in a SEPARATE module (`convex/_internal_runMatch.ts`) because
// the action above runs in `"use node"` and cannot define mutations/queries
// in the same file. They're internal-only — the harness never calls them.
