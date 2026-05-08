// Phase-3 WP-E.3 — phase-3 closing-10 report writer.
//
// Per PM lock D10: phase-3 metrics live in this NEW sibling module to
// `convex/engine/reportStats.ts`. The phase-1 reportStats module stays
// scoped to the closing-50 carry-over metrics (kills/extractions/etc.);
// this module computes the substrate-refinement metrics defined in
// `docs/project/phases/03-substrate-refinement/README.md` §5 directly
// from `turns` / `worldState` / `characters` rows. No per-run aggregate
// columns are added to the `runs` table — schema diff stays scoped to
// the substrate (POC-mode posture per the user's
// `project_poc_schema_wipe_acceptable` memory).
//
// Boundary contract (ADR §1, ADR §6 single source):
//   - The `computePhase3Metrics(...)` function is PURE — no Convex API
//     access, no fs / fetch. It walks plain-object inputs that mirror
//     the persisted shape and returns a `Phase3MetricsPayload` plain
//     object. Vitest unit tests exercise it directly with synthetic
//     fixtures (`tests/reports/phase3.test.ts`).
//   - The Convex action `computePhase3Report` is a thin wrapper that
//     reads the relevant rows out of `ctx.db` and forwards them to the
//     pure function. The action lives in this file to keep the module's
//     surface coherent (mirror of how `convex/reports.ts` wraps the pure
//     `runReportCreate` orchestrator).
//
// Metric definitions (verbatim from README §5 + work-packages.md WP-E.3):
//
//   1. **Schema validity rate** —
//      count(agentRecord.llm.fellBackToSafeDefault === true) /
//      count(all per-turn calls). Threshold ≤ 10%.
//
//   2. **Wall-blocked move rate** —
//      count(resolution.moves[].blockedBy === "wall") /
//      count(all resolution.moves[] entries). Threshold ≤ 2%.
//      Single source: engine-emitted `blockedBy` field per ADR §9.
//
//   3. **Drained-corpse repeat rate** — sequential pass over
//      (turn N, turn N+1) pairs of the SAME actor. Count
//      (actorId, corpseId) pairs where both turns emit
//      kind="loot" + target=corpseId + result="empty". Divide by
//      total kind="loot" entries (across all 10 runs). Threshold ≤ 1%.
//
//   4. **Corpse loot success rate** — % of RUNS where ≥ 1 entry with
//      kind="loot" + result="looted" + target ∈ {Corpse_Player_*,
//      Player_*} exists. Threshold ≥ 50%. WP-H.1: filter accepts BOTH
//      shapes — post-WP-G.1 the engine emits the LLM verbatim
//      `Corpse_Player_N` typed-id (resolution.ts:567 preserves
//      `traceTarget = rawTargetId`); bare `Player_*` is back-compat with
//      historical fixtures and the alternate Player_* direct-dispatch
//      branch (resolution.ts:617).
//
//   5. **Overwatch stance differentiation counts** — across all 10 runs:
//      defensive counter-fires = count(action.kind="overwatch" +
//      fromOverwatch=true + stance="defensive"); offensive fires =
//      count(action.kind="overwatch" + stance="offensive"). Both > 0.
//
//   6. **Outcome attribution heuristic** — for each (actor, turn N)
//      where actor took damage (action targeting their displayName with
//      `result` matching `dmg <N>`), check turn N+1: does the agent's
//      decision reference the attacker via
//        (a) action.targetCharacterId matching attacker's displayName, OR
//        (b) move.targetEntityId matching attacker's displayName, OR
//        (c) scratchpadAfter containing the attacker's displayName.
//      Count rate over matching N pairs. Threshold ≥ 50%.
//
//   7. **Reasoning text capture rate** — % of NON-FALLBACK agentRecords
//      where agentRecord.llm.reasoning !== null. Branch A only — the
//      schema does not have a `decision.rationale` fallback.
//      Threshold ≥ 80%.
//
//   PLUS the carry-over phase-1-scaled metrics (10-run-scaled):
//     - ≥ 30% of runs end with at least one extraction.
//     - ≥ 80% of runs contain at least one kill.
//     - ≥ 80% of runs contain at least one chest equip.
//     - ≥ 50% of runs contain at least one speech event.
//     - Persona spread ≥ 15 percentage points across the 8 personas.
//
// Cross-references:
//   - README.md §5 — the metric thresholds (single source of truth).
//   - work-packages.md WP-E.3 — formula definitions.
//   - architecture-decisions.md §1 (loot unify), §3 (fromOverwatch +
//     stance), §9 (blockedBy="wall").
//   - convex/schema.ts — turns / worldState / characters validators.

import { v } from "convex/values";
import { internalAction, mutation } from "../_generated/server.js";
import { api } from "../_generated/api.js";
import {
  PERSONA_IDS,
  type PersonaId,
} from "../engine/types.js";
import { hashMatchIds } from "../reports.js";

// ─── Threshold constants (README §5 + carry-over phase-1) ─────────────────

/** Phase-3 new — schema validity (fellBackToSafeDefault rate) ≤ 10%. */
const SAFE_DEFAULT_THRESHOLD = 0.10;
/** Phase-3 new — wall-blocked move rate ≤ 2% of move attempts. */
const WALL_BLOCKED_MOVE_THRESHOLD = 0.02;
/** Phase-3 new — drained-corpse repeat rate ≤ 1% of loot attempts. */
const DRAINED_REPEAT_THRESHOLD = 0.01;
/** Phase-3 new — corpse-loot success rate ≥ 50% of runs. */
const CORPSE_LOOT_SUCCESS_THRESHOLD = 0.50;
/** Phase-3 new — outcome attribution rate ≥ 50% (best-effort heuristic). */
const OUTCOME_ATTRIBUTION_THRESHOLD = 0.50;
/** Phase-3 new — reasoning capture rate ≥ 80% of non-fallback records. */
const REASONING_CAPTURE_THRESHOLD = 0.80;

/** Carry-over phase-1 — extraction rate ≥ 30% of runs. */
const EXTRACTION_THRESHOLD = 0.30;
/** Carry-over phase-1 — kill rate ≥ 80% of runs. */
const KILL_THRESHOLD = 0.80;
/** Carry-over phase-1 — equip rate ≥ 80% of runs. */
const EQUIP_THRESHOLD = 0.80;
/** Carry-over phase-1 — speech rate ≥ 50% of runs. */
const SPEECH_THRESHOLD = 0.50;
/** Carry-over phase-1 — persona extraction-rate spread ≥ 15 pp. */
const PERSONA_SPREAD_THRESHOLD_PP = 15;

// ─── Pure-function input shapes ───────────────────────────────────────────
//
// The pure aggregator takes plain-object inputs that mirror the persisted
// shape. The Convex action wrapper does the row-fetching and shape
// adaptation; the pure function exists so the comparator math is locked
// by Vitest unit tests with synthetic fixtures (no Convex runtime).

/** One persisted action trace entry — narrowed to fields phase-3 reads. */
export type Phase3ActionTraceEntry = {
  characterId: string;
  kind: string;
  target: string;
  result: string;
  /** Phase-3 ADR §3 — engine-emitted overwatch attribution. */
  fromOverwatch?: boolean;
  /** Phase-3 ADR §3 — defensive | offensive | undefined for non-overwatch. */
  stance?: "offensive" | "defensive";
};

/** One persisted move trace entry — narrowed to fields phase-3 reads. */
export type Phase3MoveTraceEntry = {
  characterId: string;
  /** Phase-3 ADR §9 — present iff a wall blocked the intended move. */
  blockedBy?: "wall";
};

/** One agent record — narrowed to fields phase-3 reads. */
export type Phase3AgentRecord = {
  characterId: string;
  personaId: PersonaId;
  scratchpadAfter: string;
  decision: {
    move:
      | { kind: "toward_entity"; targetCharacterId: string }
      | { kind: "away_from_entity"; targetCharacterId: string }
      | { kind: "toward_object"; targetObjectId: string }
      | { kind: "relative"; dx: number; dy: number }
      | { kind: "toward_evac" }
      | { kind: "none" };
    action:
      | { kind: "attack"; targetCharacterId: string }
      | { kind: "loot"; targetId: string }
      | { kind: "none" };
  };
  llm: {
    fellBackToSafeDefault: boolean;
    /** Phase-3 ADR §2 — required-nullable; null on every non-captured path. */
    reasoning: string | null;
  };
};

/** One turn row — narrowed to fields phase-3 reads. */
export type Phase3TurnRow = {
  matchId: string;
  turn: number;
  agentRecords: Phase3AgentRecord[];
  resolution: {
    moves: Phase3MoveTraceEntry[];
    actions: Phase3ActionTraceEntry[];
    speech: Array<{ characterId: string; text: string }>;
  };
};

/** Character row — narrowed to fields needed for displayName ↔ id mapping. */
export type Phase3CharacterRow = {
  characterId: string;
  matchId: string;
  displayName: string;
  personaId: PersonaId;
  /** Did this character extract this run (extractedAtTurn !== undefined)? */
  extracted: boolean;
};

/** All inputs the pure aggregator needs, grouped by run. */
export type Phase3RunInput = {
  matchId: string;
  /** All turn rows for this match, ascending by turn. */
  turns: Phase3TurnRow[];
  /** All character rows for this match. */
  characters: Phase3CharacterRow[];
};

// ─── Output payload ───────────────────────────────────────────────────────

/** Per-persona section of the phase-3 payload (carry-over phase-1 metric). */
export type Phase3PerPersonaStats = {
  personaId: PersonaId;
  /** Number of RUNS in which this persona had ≥ 1 extraction. */
  extractionsCount: number;
  /** extractionsCount / runCount in [0, 1]. */
  extractionRate: number;
};

/** The full phase-3 payload — all README §5 metrics, with thresholds. */
export type Phase3MetricsPayload = {
  // Identification
  reportType: "phase-3-closing-10";
  runCount: number;
  matchIds: string[];

  // ── Schema validity (≤ 10%) ────────────────────────────────────────
  totalAgentRecords: number;
  fallbackCount: number;
  fallbackRate: number;
  meetsSafeDefaultThreshold: boolean;

  // ── Wall-blocked move rate (≤ 2%) ──────────────────────────────────
  totalMoveAttempts: number;
  wallBlockedMoves: number;
  wallBlockedMoveRate: number;
  meetsWallBlockedThreshold: boolean;

  // ── Drained-corpse repeat rate (≤ 1%) ──────────────────────────────
  totalLootAttempts: number;
  drainedRepeats: number;
  drainedRepeatRate: number;
  meetsDrainedRepeatThreshold: boolean;

  // ── Corpse loot success rate (≥ 50% of runs) ───────────────────────
  runsWithCorpseLoot: number;
  corpseLootSuccessRate: number;
  meetsCorpseLootThreshold: boolean;

  // ── Overwatch stance differentiation (both > 0) ────────────────────
  defensiveCounterFires: number;
  offensiveOverwatchFires: number;
  meetsOverwatchDifferentiationThreshold: boolean;

  // ── Outcome attribution (≥ 50% best-effort) ────────────────────────
  outcomeAttributionPairs: number;
  outcomeAttributionMatches: number;
  outcomeAttributionRate: number;
  meetsOutcomeAttributionThreshold: boolean;

  // ── Reasoning capture (≥ 80% of non-fallback records) ──────────────
  nonFallbackRecords: number;
  reasoningCaptured: number;
  reasoningCaptureRate: number;
  meetsReasoningCaptureThreshold: boolean;

  // ── Carry-over phase-1 (10-run-scaled) ─────────────────────────────
  runsWithExtraction: number;
  runsWithKill: number;
  runsWithEquip: number;
  runsWithSpeech: number;
  extractionRate: number;
  killRate: number;
  equipRate: number;
  speechRate: number;
  perPersona: Phase3PerPersonaStats[];
  personaExtractionSpread: number;
  meetsExtractionThreshold: boolean;
  meetsKillThreshold: boolean;
  meetsEquipThreshold: boolean;
  meetsSpeechThreshold: boolean;
  meetsPersonaSpreadThreshold: boolean;

  // ── Composite gate ─────────────────────────────────────────────────
  meetsAllThresholds: boolean;
};

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Safe division: 0 when denom = 0 (NOT NaN). */
function safeRate(num: number, denom: number): number {
  if (denom === 0) return 0;
  return num / denom;
}

/**
 * Parse the `result` string for an `attack`/`overwatch` trace entry and
 * return whether it represents a damage-dealing event. Damage entries are
 * shaped `dmg <N>` (concept-spec §23 / phase-1 ADR §7). `out_of_range`,
 * `no_target`, `missed` etc. do not count.
 */
function isDamageResult(result: string): boolean {
  return /^dmg\s+\d+/.test(result);
}

/**
 * Build a (characterId → displayName) lookup map for ONE run's characters.
 * The trace's `target` field on attack entries is the DEFENDER'S
 * characterId; the input/digest renders attacks against displayNames
 * (`Player_5`). The outcome-attribution heuristic needs both directions.
 */
function buildIdMaps(
  characters: Phase3CharacterRow[],
): {
  charIdToDisplay: Map<string, string>;
  displayToCharId: Map<string, string>;
} {
  const charIdToDisplay = new Map<string, string>();
  const displayToCharId = new Map<string, string>();
  for (const c of characters) {
    charIdToDisplay.set(c.characterId, c.displayName);
    displayToCharId.set(c.displayName, c.characterId);
  }
  return { charIdToDisplay, displayToCharId };
}

/**
 * Find the move's "target entity id" if any — the move arms that point
 * at a specific character (toward_entity / away_from_entity). Returns
 * the targetCharacterId verbatim, or null for arms that don't target
 * a character.
 */
function moveTargetEntityId(
  move: Phase3AgentRecord["decision"]["move"],
): string | null {
  if (move.kind === "toward_entity") return move.targetCharacterId;
  if (move.kind === "away_from_entity") return move.targetCharacterId;
  return null;
}

/**
 * Find the action's "target character id" if any — only the attack arm
 * points at a character. Loot.targetId can be a Player_* corpse but the
 * corpse-loot semantic doesn't count as outcome-attribution (the
 * attacker may already be dead).
 */
function actionTargetCharacterId(
  action: Phase3AgentRecord["decision"]["action"],
): string | null {
  if (action.kind === "attack") return action.targetCharacterId;
  return null;
}

// ─── Pure aggregator ──────────────────────────────────────────────────────

/**
 * Walk N `Phase3RunInput` rows and produce the multi-run
 * `Phase3MetricsPayload`. Pure / no I/O — testable without Convex.
 *
 * Inputs:
 *   - `runs`: array of per-run inputs. Order does NOT matter for the
 *     aggregator's output (it's a sum over per-run statistics). May be
 *     empty (returns the zero-shaped payload with all `meets*` flags
 *     false).
 *
 * Returns: a `Phase3MetricsPayload`. Always exactly 8 entries in
 * `perPersona`, one per locked PersonaId (zero-filled for personas
 * absent in any run).
 */
export function computePhase3Metrics(
  runs: Phase3RunInput[],
): Phase3MetricsPayload {
  const runCount = runs.length;
  const matchIds = runs.map((r) => r.matchId);

  // Schema validity / reasoning capture accumulators.
  let totalAgentRecords = 0;
  let fallbackCount = 0;
  let nonFallbackRecords = 0;
  let reasoningCaptured = 0;

  // Wall-blocked move accumulators.
  let totalMoveAttempts = 0;
  let wallBlockedMoves = 0;

  // Drained-corpse repeat accumulators.
  let totalLootAttempts = 0;
  let drainedRepeats = 0;

  // Corpse-loot success — count of RUNS with ≥ 1 successful corpse-loot
  // (target shape ∈ {Corpse_Player_*, Player_*}). WP-H.1 widens the filter
  // to honor the post-WP-G.1 verbatim-emit contract.
  let runsWithCorpseLoot = 0;

  // Overwatch stance differentiation.
  let defensiveCounterFires = 0;
  let offensiveOverwatchFires = 0;

  // Outcome attribution.
  let outcomeAttributionPairs = 0;
  let outcomeAttributionMatches = 0;

  // Carry-over phase-1 — runs-with-≥-1.
  let runsWithExtraction = 0;
  let runsWithKill = 0;
  let runsWithEquip = 0;
  let runsWithSpeech = 0;

  // Per-persona extraction tally (extracted-in-this-run flag per persona).
  const perPersonaExtractions = new Map<PersonaId, number>();
  for (const id of PERSONA_IDS) perPersonaExtractions.set(id, 0);

  for (const run of runs) {
    const { charIdToDisplay, displayToCharId } = buildIdMaps(run.characters);

    let runHasCorpseLoot = false;
    let runHasKill = false; // any attack/overwatch dmg N > 0
    let runHasEquip = false;
    let runHasSpeech = false;

    // Sort turns ascending — fixtures may pass them out of order; the
    // (turn N, N+1) sequential analysis depends on order.
    const turns = [...run.turns].sort((a, b) => a.turn - b.turn);

    // ── Per-actor (turn N → turn N+1) action map for drained-corpse and
    //    outcome-attribution analysis. Indexed by `${characterId}@${turn}`.
    const actorActionsByTurn = new Map<string, Phase3ActionTraceEntry[]>();
    const actorDecisionByTurn = new Map<string, Phase3AgentRecord>();
    for (const t of turns) {
      for (const ar of t.agentRecords) {
        actorDecisionByTurn.set(`${ar.characterId}@${t.turn}`, ar);
      }
      for (const a of t.resolution.actions) {
        const k = `${a.characterId}@${t.turn}`;
        const arr = actorActionsByTurn.get(k);
        if (arr) arr.push(a);
        else actorActionsByTurn.set(k, [a]);
      }
    }

    // ── Per-turn primary tallies ──────────────────────────────────────
    for (const t of turns) {
      // Schema validity / reasoning per agentRecord.
      for (const ar of t.agentRecords) {
        totalAgentRecords += 1;
        if (ar.llm.fellBackToSafeDefault) {
          fallbackCount += 1;
        } else {
          nonFallbackRecords += 1;
          if (ar.llm.reasoning !== null) reasoningCaptured += 1;
        }
      }

      // Wall-blocked moves + total move attempts.
      for (const m of t.resolution.moves) {
        totalMoveAttempts += 1;
        if (m.blockedBy === "wall") wallBlockedMoves += 1;
      }

      // Action-trace tallies.
      for (const a of t.resolution.actions) {
        // Loot: total + corpse-loot success flag for this run.
        if (a.kind === "loot") {
          totalLootAttempts += 1;
          // WP-H.1 — accept BOTH `Corpse_Player_*` (post-WP-G.1 verbatim
          // engine emit; resolution.ts:567 preserves the LLM typed-id in
          // `traceTarget`) AND bare `Player_*` (back-compat with any
          // historical fixtures and the alternate `Player_*` direct-
          // dispatch branch at resolution.ts:617). PM-lock D50.
          if (
            a.result === "looted" &&
            (a.target.startsWith("Corpse_Player_") ||
              a.target.startsWith("Player_"))
          ) {
            runHasCorpseLoot = true;
          }
          if (
            a.result === "opened" &&
            a.target.startsWith("chest_")
          ) {
            runHasEquip = true;
          }
        }

        // Overwatch stance differentiation.
        if (a.kind === "overwatch") {
          if (a.fromOverwatch === true && a.stance === "defensive") {
            defensiveCounterFires += 1;
          }
          if (a.stance === "offensive") {
            offensiveOverwatchFires += 1;
          }
        }

        // Run-has-kill heuristic — any dmg-result attack/overwatch entry.
        if (
          (a.kind === "attack" || a.kind === "overwatch") &&
          isDamageResult(a.result)
        ) {
          runHasKill = true;
        }
      }

      // Speech tally — any speech event in this run.
      if (t.resolution.speech.length > 0) runHasSpeech = true;
    }

    // ── Drained-corpse repeat — sequential pass over (N, N+1) actor
    //    pairs. For each loot kind="loot" + result="empty" at turn N,
    //    check if the same actor emitted the same target at turn N+1
    //    with the same result. Both must be against the same corpse id.
    //    Counts ONCE per (actor, corpse) repeat — if the agent loops
    //    over 3 turns the count is +2 (N→N+1, N+1→N+2).
    for (let i = 0; i < turns.length - 1; i++) {
      const turnN = turns[i]!;
      const turnNext = turns[i + 1]!;
      // Group N's empty-loot entries by (actor, corpseTarget).
      for (const a of turnN.resolution.actions) {
        if (a.kind !== "loot" || a.result !== "empty") continue;
        // Look for a matching entry in turn N+1 by same actor + target.
        const match = turnNext.resolution.actions.find(
          (b) =>
            b.characterId === a.characterId &&
            b.kind === "loot" &&
            b.target === a.target &&
            b.result === "empty",
        );
        if (match) drainedRepeats += 1;
      }
    }

    // ── Outcome-attribution heuristic ─────────────────────────────────
    //
    // For each (actor, turn N) where actor took damage from an attacker:
    //   incoming damage entries are `kind ∈ {attack, overwatch}`,
    //   `target = actor's displayName`, `result = "dmg N"`.
    // Then check turn N+1's actor decision for any reference to the
    // attacker — by characterId on action/move targets, or by displayName
    // substring in scratchpadAfter.
    //
    // The heuristic accepts the displayName form because the digest
    // surfaces `Player_X` to the model; the model writes that into its
    // tool call literals or scratchpad. All three reference channels are
    // OR-combined per WP-E.3 spec.
    for (let i = 0; i < turns.length - 1; i++) {
      const turnN = turns[i]!;
      const turnNext = turns[i + 1]!;
      // Map: actorId → set of attacker displayNames who hit them this turn.
      const incomingAttackers = new Map<string, Set<string>>();
      for (const a of turnN.resolution.actions) {
        if (
          (a.kind !== "attack" && a.kind !== "overwatch") ||
          !isDamageResult(a.result)
        ) {
          continue;
        }
        // a.target is the defender's displayName (e.g. Player_3); the
        // attacker is a.characterId. Resolve attacker's displayName so
        // the heuristic's scratchpad / tool-call lookups find it.
        const defenderDisplay = a.target;
        const defenderCharId = displayToCharId.get(defenderDisplay);
        if (!defenderCharId) continue;
        const attackerDisplay = charIdToDisplay.get(a.characterId);
        if (!attackerDisplay) continue;
        const set = incomingAttackers.get(defenderCharId);
        if (set) set.add(attackerDisplay);
        else incomingAttackers.set(defenderCharId, new Set([attackerDisplay]));
      }

      for (const [defenderCharId, attackers] of incomingAttackers) {
        // Find defender's turn N+1 agent record.
        const nextRecord = actorDecisionByTurn.get(
          `${defenderCharId}@${turnNext.turn}`,
        );
        if (!nextRecord) continue;
        for (const attackerDisplay of attackers) {
          outcomeAttributionPairs += 1;
          // (a) action.targetCharacterId matches attacker's characterId
          //     OR displayName.
          const attackerCharId = displayToCharId.get(attackerDisplay);
          const actTarget = actionTargetCharacterId(nextRecord.decision.action);
          let matched = false;
          if (
            actTarget !== null &&
            (actTarget === attackerCharId || actTarget === attackerDisplay)
          ) {
            matched = true;
          }
          // (b) move's target entity id matches attacker.
          if (!matched) {
            const moveTarget = moveTargetEntityId(nextRecord.decision.move);
            if (
              moveTarget !== null &&
              (moveTarget === attackerCharId || moveTarget === attackerDisplay)
            ) {
              matched = true;
            }
          }
          // (c) scratchpadAfter contains the attacker's displayName.
          if (
            !matched &&
            attackerDisplay.length > 0 &&
            nextRecord.scratchpadAfter.includes(attackerDisplay)
          ) {
            matched = true;
          }
          if (matched) outcomeAttributionMatches += 1;
        }
      }
    }

    // ── Per-persona extraction (carry-over phase-1) ───────────────────
    // A persona "has an extraction in this run" iff at least one of its
    // characters has `extracted === true`.
    const personasExtractedThisRun = new Set<PersonaId>();
    for (const c of run.characters) {
      if (c.extracted) personasExtractedThisRun.add(c.personaId);
    }
    if (personasExtractedThisRun.size > 0) runsWithExtraction += 1;
    for (const id of personasExtractedThisRun) {
      perPersonaExtractions.set(
        id,
        (perPersonaExtractions.get(id) ?? 0) + 1,
      );
    }

    if (runHasKill) runsWithKill += 1;
    if (runHasEquip) runsWithEquip += 1;
    if (runHasSpeech) runsWithSpeech += 1;
    if (runHasCorpseLoot) runsWithCorpseLoot += 1;
  }

  // ── Materialise per-persona stats (always 8 entries) ────────────────
  const perPersona: Phase3PerPersonaStats[] = PERSONA_IDS.map((id) => {
    const count = perPersonaExtractions.get(id) ?? 0;
    return {
      personaId: id,
      extractionsCount: count,
      extractionRate: safeRate(count, runCount),
    };
  });

  // Persona extraction-rate spread, in PERCENTAGE POINTS.
  let personaExtractionSpread = 0;
  if (perPersona.length > 0) {
    let minRate = Infinity;
    let maxRate = -Infinity;
    for (const p of perPersona) {
      if (p.extractionRate < minRate) minRate = p.extractionRate;
      if (p.extractionRate > maxRate) maxRate = p.extractionRate;
    }
    if (Number.isFinite(minRate) && Number.isFinite(maxRate)) {
      personaExtractionSpread = (maxRate - minRate) * 100;
    }
  }

  // ── Rates ───────────────────────────────────────────────────────────
  const fallbackRate = safeRate(fallbackCount, totalAgentRecords);
  const wallBlockedMoveRate = safeRate(wallBlockedMoves, totalMoveAttempts);
  const drainedRepeatRate = safeRate(drainedRepeats, totalLootAttempts);
  const corpseLootSuccessRate = safeRate(runsWithCorpseLoot, runCount);
  const outcomeAttributionRate = safeRate(
    outcomeAttributionMatches,
    outcomeAttributionPairs,
  );
  const reasoningCaptureRate = safeRate(reasoningCaptured, nonFallbackRecords);
  const extractionRate = safeRate(runsWithExtraction, runCount);
  const killRate = safeRate(runsWithKill, runCount);
  const equipRate = safeRate(runsWithEquip, runCount);
  const speechRate = safeRate(runsWithSpeech, runCount);

  // ── Threshold flags ─────────────────────────────────────────────────
  // Empty-input short-circuit: every rate is 0, so every "≤ X" threshold
  // would trivially evaluate true. We explicitly require runCount > 0
  // for ALL phase-3 metric flags so empty-input doesn't fake a green.
  const empty = runCount === 0;
  const meetsSafeDefaultThreshold =
    !empty && totalAgentRecords > 0 && fallbackRate <= SAFE_DEFAULT_THRESHOLD;
  const meetsWallBlockedThreshold =
    !empty && totalMoveAttempts > 0 && wallBlockedMoveRate <= WALL_BLOCKED_MOVE_THRESHOLD;
  // Drained-repeat: with totalLootAttempts === 0 the rate is trivially 0;
  // we accept that as meeting the threshold (no loot attempts → no
  // repeats — the metric is meaningful only when loot is happening).
  const meetsDrainedRepeatThreshold =
    !empty && drainedRepeatRate <= DRAINED_REPEAT_THRESHOLD;
  const meetsCorpseLootThreshold =
    !empty && corpseLootSuccessRate >= CORPSE_LOOT_SUCCESS_THRESHOLD;
  const meetsOverwatchDifferentiationThreshold =
    !empty && defensiveCounterFires > 0 && offensiveOverwatchFires > 0;
  // Outcome-attribution: only meaningful when there are pairs. With zero
  // pairs we treat the metric as "vacuously not met" — no agent ever
  // took damage, which is itself a substrate failure mode.
  const meetsOutcomeAttributionThreshold =
    !empty &&
    outcomeAttributionPairs > 0 &&
    outcomeAttributionRate >= OUTCOME_ATTRIBUTION_THRESHOLD;
  const meetsReasoningCaptureThreshold =
    !empty &&
    nonFallbackRecords > 0 &&
    reasoningCaptureRate >= REASONING_CAPTURE_THRESHOLD;

  // Carry-over phase-1
  const meetsExtractionThreshold = !empty && extractionRate >= EXTRACTION_THRESHOLD;
  const meetsKillThreshold = !empty && killRate >= KILL_THRESHOLD;
  const meetsEquipThreshold = !empty && equipRate >= EQUIP_THRESHOLD;
  const meetsSpeechThreshold = !empty && speechRate >= SPEECH_THRESHOLD;
  const meetsPersonaSpreadThreshold =
    !empty && personaExtractionSpread >= PERSONA_SPREAD_THRESHOLD_PP;

  const meetsAllThresholds =
    meetsSafeDefaultThreshold &&
    meetsWallBlockedThreshold &&
    meetsDrainedRepeatThreshold &&
    meetsCorpseLootThreshold &&
    meetsOverwatchDifferentiationThreshold &&
    meetsOutcomeAttributionThreshold &&
    meetsReasoningCaptureThreshold &&
    meetsExtractionThreshold &&
    meetsKillThreshold &&
    meetsEquipThreshold &&
    meetsSpeechThreshold &&
    meetsPersonaSpreadThreshold;

  return {
    reportType: "phase-3-closing-10",
    runCount,
    matchIds,
    totalAgentRecords,
    fallbackCount,
    fallbackRate,
    meetsSafeDefaultThreshold,
    totalMoveAttempts,
    wallBlockedMoves,
    wallBlockedMoveRate,
    meetsWallBlockedThreshold,
    totalLootAttempts,
    drainedRepeats,
    drainedRepeatRate,
    meetsDrainedRepeatThreshold,
    runsWithCorpseLoot,
    corpseLootSuccessRate,
    meetsCorpseLootThreshold,
    defensiveCounterFires,
    offensiveOverwatchFires,
    meetsOverwatchDifferentiationThreshold,
    outcomeAttributionPairs,
    outcomeAttributionMatches,
    outcomeAttributionRate,
    meetsOutcomeAttributionThreshold,
    nonFallbackRecords,
    reasoningCaptured,
    reasoningCaptureRate,
    meetsReasoningCaptureThreshold,
    runsWithExtraction,
    runsWithKill,
    runsWithEquip,
    runsWithSpeech,
    extractionRate,
    killRate,
    equipRate,
    speechRate,
    perPersona,
    personaExtractionSpread,
    meetsExtractionThreshold,
    meetsKillThreshold,
    meetsEquipThreshold,
    meetsSpeechThreshold,
    meetsPersonaSpreadThreshold,
    meetsAllThresholds,
  };
}

// ─── Convex internal action wrapper ───────────────────────────────────────
//
// The pure aggregator above is the testable comparator math. The thin
// wrapper here reads the rows out of `ctx.db` and forwards them to it.
// `internalAction` so it doesn't appear on the public API surface — it's
// invoked from the WP-E.4 closure step via `npx convex run reports/
// phase3:computePhase3Report` or programmatically from a script.
//
// Read shape:
//   - turns rows for each matchId via `internal.turns.byMatch` (ascending
//     order is guaranteed by the index).
//   - characters rows via `internal.runs.charactersByMatch` (the
//     existing internal query used by runMatch).
//
// Returns the full `Phase3MetricsPayload` so callers can persist it to
// the `reports` table or echo into a closure record.

export const computePhase3Report = internalAction({
  args: { matchIds: v.array(v.id("matches")) },
  handler: async (ctx, { matchIds }): Promise<Phase3MetricsPayload> => {
    const runs: Phase3RunInput[] = [];
    for (const matchId of matchIds) {
      const turnRows = await ctx.runQuery(api.turns.byMatch, {
        matchId,
      });
      const charRows = await ctx.runQuery(
        api._internal_runMatch.charactersByMatch,
        { matchId },
      );
      // Adapt rows to the pure-function input shape. `turnRows` already
      // has the right shape for `Phase3TurnRow`; we narrow types and
      // strip Convex `_id` / `_creationTime` fields.
      const turns: Phase3TurnRow[] = turnRows.map((t) => ({
        matchId: t.matchId as unknown as string,
        turn: t.turn,
        agentRecords: t.agentRecords.map((ar) => ({
          characterId: ar.characterId as unknown as string,
          personaId: ar.personaId,
          scratchpadAfter: ar.scratchpadAfter,
          decision: ar.decision as Phase3AgentRecord["decision"],
          llm: {
            fellBackToSafeDefault: ar.llm.fellBackToSafeDefault,
            reasoning: ar.llm.reasoning,
          },
        })),
        resolution: {
          moves: t.resolution.moves.map((m) => ({
            characterId: m.characterId as unknown as string,
            ...(m.blockedBy !== undefined ? { blockedBy: m.blockedBy } : {}),
          })),
          actions: t.resolution.actions.map((a) => ({
            characterId: a.characterId as unknown as string,
            kind: a.kind,
            target: a.target,
            result: a.result,
            ...(a.fromOverwatch !== undefined
              ? { fromOverwatch: a.fromOverwatch }
              : {}),
            ...(a.stance !== undefined ? { stance: a.stance } : {}),
          })),
          speech: t.resolution.speech.map((s) => ({
            characterId: s.characterId as unknown as string,
            text: s.text,
          })),
        },
      }));
      const characters: Phase3CharacterRow[] = charRows.map((c) => ({
        characterId: c._id as unknown as string,
        matchId: c.matchId as unknown as string,
        displayName: c.displayName,
        personaId: c.personaId,
        extracted: typeof c.extractedAtTurn === "number",
      }));
      runs.push({
        matchId: matchId as unknown as string,
        turns,
        characters,
      });
    }
    return computePhase3Metrics(runs);
  },
});

// ─── Phase-3 closing-10 report persistence (WP-E.4) ──────────────────────
//
// Persists a `reports` row with `reportType: "phase-3-closing-10"` carrying
// BOTH the phase-1 carry-over `payload` (so `reports.byMatchIdsHash` lookups
// keep working with the existing index) AND the new `phase3Payload` field
// per WP-E.4 schema diff. The hash + reportType tuple is the idempotency
// key (sort-then-hash of matchIds), mirroring the WP14 `reports.create`
// pattern so re-fires over the same set are no-op inserts.
//
// Boundary contract: the action computes the metrics (above), then this
// mutation writes the row. We keep them as separate Convex functions
// because:
//   (a) actions can call queries via `runQuery`, mutations cannot.
//   (b) splitting out the persistence step keeps the mutation small and
//       transactional — only the row-insert happens here, no trace reads.

export const persistPhase3Report = mutation({
  args: {
    matchIds: v.array(v.id("matches")),
    payload: v.object({
      reportType: v.literal("phase-3-closing-10"),
      runCount: v.number(),
      matchIds: v.array(v.string()),
      totalAgentRecords: v.number(),
      fallbackCount: v.number(),
      fallbackRate: v.number(),
      meetsSafeDefaultThreshold: v.boolean(),
      totalMoveAttempts: v.number(),
      wallBlockedMoves: v.number(),
      wallBlockedMoveRate: v.number(),
      meetsWallBlockedThreshold: v.boolean(),
      totalLootAttempts: v.number(),
      drainedRepeats: v.number(),
      drainedRepeatRate: v.number(),
      meetsDrainedRepeatThreshold: v.boolean(),
      runsWithCorpseLoot: v.number(),
      corpseLootSuccessRate: v.number(),
      meetsCorpseLootThreshold: v.boolean(),
      defensiveCounterFires: v.number(),
      offensiveOverwatchFires: v.number(),
      meetsOverwatchDifferentiationThreshold: v.boolean(),
      outcomeAttributionPairs: v.number(),
      outcomeAttributionMatches: v.number(),
      outcomeAttributionRate: v.number(),
      meetsOutcomeAttributionThreshold: v.boolean(),
      nonFallbackRecords: v.number(),
      reasoningCaptured: v.number(),
      reasoningCaptureRate: v.number(),
      meetsReasoningCaptureThreshold: v.boolean(),
      runsWithExtraction: v.number(),
      runsWithKill: v.number(),
      runsWithEquip: v.number(),
      runsWithSpeech: v.number(),
      extractionRate: v.number(),
      killRate: v.number(),
      equipRate: v.number(),
      speechRate: v.number(),
      perPersona: v.array(
        v.object({
          personaId: v.union(
            v.literal("rat"),
            v.literal("duelist"),
            v.literal("trader"),
            v.literal("opportunist"),
            v.literal("paranoid"),
            v.literal("camper"),
            v.literal("sprinter"),
            v.literal("vulture"),
          ),
          extractionsCount: v.number(),
          extractionRate: v.number(),
        }),
      ),
      personaExtractionSpread: v.number(),
      meetsExtractionThreshold: v.boolean(),
      meetsKillThreshold: v.boolean(),
      meetsEquipThreshold: v.boolean(),
      meetsSpeechThreshold: v.boolean(),
      meetsPersonaSpreadThreshold: v.boolean(),
      meetsAllThresholds: v.boolean(),
    }),
  },
  handler: async (ctx, { matchIds, payload }) => {
    const matchIdsHash = await hashMatchIds(
      matchIds.map((m) => m as unknown as string),
    );
    const reportType = "phase-3-closing-10";

    // Idempotency: if a phase-3-closing-10 row already exists for this set,
    // return it unchanged.
    const existing = await ctx.db
      .query("reports")
      .withIndex("by_matchIdsHash_reportType", (q) =>
        q.eq("matchIdsHash", matchIdsHash).eq("reportType", reportType),
      )
      .unique();
    if (existing) {
      return {
        _id: existing._id as unknown as string,
        existed: true,
      };
    }

    // Carry-over v1/v2 fields — populated from the phase-3 payload's
    // carry-over slice so `reports.byMatchIdsHash` consumers that read
    // `payload.meetsAllThresholds` still get a sensible signal (the
    // carry-over view is necessary-but-not-sufficient — phase-3 layers
    // additional thresholds via `phase3Payload.meetsAllThresholds`).
    const insertedId = await ctx.db.insert("reports", {
      // v1 / WP2 legacy fields
      runIds: [],
      runCount: payload.runCount,
      generatedAt: Date.now(),
      metrics: {
        extractionRate: payload.extractionRate,
        runsWithKill: payload.runsWithKill,
        runsWithEquip: payload.runsWithEquip,
        runsWithSpeech: payload.runsWithSpeech,
        perPersonaExtractionRate: payload.perPersona.map((p) => ({
          personaId: p.personaId,
          rate: p.extractionRate,
        })),
        personaSpread: payload.personaExtractionSpread,
      },
      metBar: payload.meetsAllThresholds,
      // v2 / WP14 fields
      matchIds,
      matchIdsHash,
      reportType,
      // The v2 `payload` field is shaped like phase-1's `ReportPayload`.
      // We zero-fill the fields phase-3 doesn't track per-persona
      // (kills / equips / speechEvents / extracted) and mirror the
      // run-level totals so the v2 readers see consistent values.
      payload: {
        runCount: payload.runCount,
        kills: 0,
        extractions: payload.runsWithExtraction,
        equips: 0,
        speechEvents: 0,
        runsWithAtLeastOneKill: payload.runsWithKill,
        runsWithAtLeastOneExtraction: payload.runsWithExtraction,
        runsWithAtLeastOneEquip: payload.runsWithEquip,
        runsWithAtLeastOneSpeech: payload.runsWithSpeech,
        killRate: payload.killRate,
        extractionRate: payload.extractionRate,
        equipRate: payload.equipRate,
        speechRate: payload.speechRate,
        perPersona: payload.perPersona.map((p) => ({
          personaId: p.personaId,
          kills: 0,
          equips: 0,
          speechEvents: 0,
          extracted: p.extractionsCount,
          extractionsCount: p.extractionsCount,
          extractionRate: p.extractionRate,
        })),
        personaExtractionSpread: payload.personaExtractionSpread,
        meetsExtractionThreshold: payload.meetsExtractionThreshold,
        meetsKillThreshold: payload.meetsKillThreshold,
        meetsEquipThreshold: payload.meetsEquipThreshold,
        meetsSpeechThreshold: payload.meetsSpeechThreshold,
        meetsPersonaSpreadThreshold: payload.meetsPersonaSpreadThreshold,
        meetsAllThresholds: payload.meetsAllThresholds,
      },
      missingRunsForMatchIds: [],
      // v3 / Phase-3 — the substrate-refinement metrics payload.
      phase3Payload: payload,
    });

    return {
      _id: insertedId as unknown as string,
      existed: false,
    };
  },
});
