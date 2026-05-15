// WP7 — 8-phase composed resolver (pure functions; no Convex imports).
//
// Spec sections:
//   - concept-spec.md §7  (vision / hiding / reveal causes)
//   - concept-spec.md §9  (turn economy)
//   - concept-spec.md §10 (movement; entity-tracking; no mid-move retarget)
//   - concept-spec.md §11 (overwatch; reveal-on-fire)
//   - concept-spec.md §12 (combat; simultaneous resolution)
//   - concept-spec.md §13 (gear; crate open + equip; corpse formation/loot)
//   - concept-spec.md §14 (consumables; heal/speed)
//   - concept-spec.md §15 (evac; turn-30 reveal; turn-50 extraction)
//   - concept-spec.md §16 (speech; broadcast; reveal speaker)
//   - concept-spec.md §23 (resolution order — THE blueprint)
//   - concept-spec.md §24 (collisions; order-independence)
//   - architecture-decisions.md §6 (locked stat tiers)
//
// Pure-function module per ADR §1 — no Convex imports. Imports only from
// sibling engine modules. The function `resolveTurn(state, decisions)` is
// the single entry point; it returns NEW state and never mutates inputs.
//
// Phase order (mirrors §23):
//   1. Collect decisions (input).
//   2. Apply consumables (heal/speed) — speed bumps movement budget to 12;
//      heal restores 0.20 * maxHp clamped to maxHp; consumable users in
//      cover are revealed.
//   3. Speech — broadcast to other LIVING characters within Chebyshev ≤ 20
//      of speaker's start-of-turn pos; hidden speakers revealed.
//   4. Movement — `simulateMovement(state, moveDecisions, {speedActiveIds})`.
//      Detect "leaving cover" reveal: was in cover-tile at start, not in
//      cover-tile at end.
//   5. Action — for each living agent based on `primary`:
//        - "move" → resolve `decision.action` against POST-move position
//          (concept-spec §9 line 447: "Move up to 8, then optionally take
//          one normal action if valid"). The action is gated by the same
//          in-range / liveness checks as `stationary_action`; if the target
//          is still out of range / invalid after the move, the action no-ops
//          (trace records "out_of_range" / "no_target" / "already_opened").
//        - "overwatch" → fire on first valid in-range visible enemy (nearest)
//        - "stationary_action" → resolve `decision.action` (attack / interact
//          / loot / none).
//      Attacks COLLECT damage first, then APPLY in one batch (simultaneity).
//      Reveal-on-fire / reveal-on-loot.
//   6. Death + loot — every char with hp ≤ 0 → alive=false, diedAtTurn=turn,
//      create corpse mirroring full equipped slots.
//   7. Visibility update — proximity reveal in cover; lastKnown update.
//   8. Next turn — increment turn; turn-30 evac reveal; turn-50 extraction.

import {
  weaponRange,
  damageFor,
  applyDamage,
  weaponNameForTrace,
} from "./combat.js";
import { findCrateById } from "./airdrops.js";
import { chebyshev } from "./distance.js";
import { isInCover } from "./hiding.js";
import { updateLastKnown } from "./lastKnown.js";
import { simulateMovement } from "./movement.js";
import {
  normaliseCharacterTargetId,
  normaliseCorpseTargetId,
} from "../llm/idNormalisation.js";
import type {
  ActionDecision,
  ActionTraceEntry,
  CharacterState,
  ConsumableName,
  CorpseState,
  ItemRef,
  MatchState,
  ParsedDecision,
  Tile,
  WeaponName,
} from "./types.js";
import { CONSUMABLES } from "./types.js";
import { computeVisibleEntities } from "./vision.js";

// ─── ResolutionTrace shape ──────────────────────────────────────────────
//
// Mirrors `resolutionValidator` in convex/schema.ts but uses plain string
// ids (the in-memory engine uses string characterIds; WP10 maps strings →
// Convex Id types when persisting). The `consumed[].item` field diverges
// from the schema (which uses an ItemRef): tests assert the simple
// {characterId, item: "<name>"} shape so we use the consumable NAME here.
// WP10 adapts at persistence time.

export type RevealCause =
  | "attack"
  | "loot"
  | "speech"
  | "consumable"
  | "leaving_cover"
  | "proximity";

export type ResolutionTrace = {
  // NOTE: `item` is the consumable NAME string (engine convention) — schema
  // shape uses ItemRef; runMatch.ts adapts when persisting.
  consumed: Array<{ characterId: string; item: ConsumableName }>;
  speech: Array<{ characterId: string; text: string; heardBy: string[] }>;
  // Phase-3 ADR §9 — `blockedBy: "wall"` marks a wall-blocked move
  // attempt (`from === to` entry). WP-B.7 emits these from
  // simulateMovement; the report writer reads the field directly.
  moves: Array<{
    characterId: string;
    from: Tile;
    to: Tile;
    blockedBy?: "wall";
    slide?: {
      wallRectId: string;
      axis: "N" | "E" | "S" | "W";
      intent: string;
    };
    bodyCollision?:
      | { kind: "character"; defenderId: string }
      | { kind: "wall"; wallRectId: string };
  }>;
  // Phase 6 traces use explicit action kinds: offensive overwatch writes
  // kind="overwatch" with triggeredByMovement=true, while counter-fire writes
  // kind="counter".
  actions: ActionTraceEntry[];
  deaths: string[];
  environmentalDeaths: string[];
  visibilityUpdates: Array<{
    characterId: string;
    hidden: boolean;
    revealedBy?: RevealCause;
  }>;
};

// ─── Tunables / constants ────────────────────────────────────────────────

const HEARING_RANGE = 20; // Chebyshev — concept-spec §16
const PROXIMITY_REVEAL_RANGE = 2; // Chebyshev — concept-spec §7
const INTERACT_RANGE = 2; // concept-spec §13
const EVAC_REVEAL_TURN = 30; // concept-spec §15
const EVAC_EXTRACT_TURN = 50; // concept-spec §15
const EVAC_HALF_SIZE = 1; // 3×3 zone = centre ± 1

// ─── Internal helpers ────────────────────────────────────────────────────

function isCrateId(id: string): boolean {
  return /^Crate_-?\d+_-?\d+$/.test(id);
}

/**
 * Replace the named character in the state with a new value (NEW characters
 * array; never mutates input). Returns the input unchanged if id missing.
 */
function replaceCharacter(
  state: MatchState,
  id: string,
  next: CharacterState,
): MatchState {
  const idx = state.characters.findIndex((c) => c.characterId === id);
  if (idx < 0) return state;
  const arr = state.characters.slice();
  arr[idx] = next;
  return { ...state, characters: arr };
}

/** Patch one character via a transform fn. Returns NEW state. */
function patchCharacter(
  state: MatchState,
  id: string,
  fn: (c: CharacterState) => CharacterState,
): MatchState {
  const ch = state.characters.find((c) => c.characterId === id);
  if (!ch) return state;
  return replaceCharacter(state, id, fn(ch));
}

// ─── resolveTurn ────────────────────────────────────────────────────────

export function resolveTurn(
  state: MatchState,
  decisions: ReadonlyMap<string, ParsedDecision>,
): { state: MatchState; trace: ResolutionTrace } {
  const trace: ResolutionTrace = {
    consumed: [],
    speech: [],
    moves: [],
    actions: [],
    deaths: [],
    environmentalDeaths: [],
    visibilityUpdates: [],
  };

  // visibilityRevealMap tracks per-character reveal causes accumulated across
  // phases. hideSet tracks cover-as-hide flips produced in phase 7. We emit
  // at most one visibilityUpdates entry per character at end of phase 7 (or
  // earlier when reveal causes need to be observable to downstream phases —
  // e.g., speech reveal must be visible to overwatch).
  const revealMap = new Map<string, RevealCause>();
  const hideSet = new Set<string>();
  const recordRevealCause = (id: string, cause: RevealCause) => {
    if (!revealMap.has(id)) revealMap.set(id, cause);
  };

  // Working state — never mutate the input. We re-bind `working` on each
  // immutable update.
  let working: MatchState = state;

  // Snapshot start-of-turn positions (for speech hearing range and
  // movement-triggered overwatch checks).
  const startPos = new Map<string, Tile>();
  for (const ch of state.characters) {
    startPos.set(ch.characterId, { x: ch.pos.x, y: ch.pos.y });
  }

  // Phase 1 — collect decisions (inputs). Filter: only LIVING agents act.
  // Sort by characterId for deterministic iteration across phases.
  const liveActorIds = [...decisions.keys()]
    .filter((id) => {
      const ch = state.characters.find((c) => c.characterId === id);
      return !!ch && ch.alive;
    })
    .sort();

  // ── Phase 2 — Apply consumables ───────────────────────────────────────
  // Heal applies HP immediately. Speed sets `speedActiveIds` for phase 4.
  // Hidden agents using a consumable are revealed (revealedBy: "consumable").
  const speedActiveIds = new Set<string>();

  for (const id of liveActorIds) {
    const decision = decisions.get(id)!;
    if (decision.use !== "consumable") continue;
    const ch = working.characters.find((c) => c.characterId === id);
    if (!ch) continue;
    const equipped = ch.equipped.consumable;
    // Defensive: only consume when actor actually has a consumable.
    if (!equipped || equipped.category !== "consumable") {
      continue;
    }
    const consumable = equipped.name; // "heal" | "speed"

    // Apply effect.
    let newHp = ch.hp;
    if (consumable === "heal") {
      const restore = Math.floor((CONSUMABLES.heal.value / 100) * ch.maxHp);
      newHp = Math.min(ch.maxHp, ch.hp + restore);
    } else if (consumable === "speed") {
      speedActiveIds.add(id);
    }

    // Remove consumable slot, update HP.
    const updatedEquipped = { ...ch.equipped };
    delete updatedEquipped.consumable;
    working = replaceCharacter(working, id, {
      ...ch,
      hp: newHp,
      equipped: updatedEquipped,
    });

    trace.consumed.push({ characterId: id, item: consumable });

    // Reveal cause: consumable.
    recordRevealCause(id, "consumable");
    if (ch.hidden) {
      working = patchCharacter(working, id, (c) => ({ ...c, hidden: false }));
    }
  }

  // ── Phase 3 — Speech ──────────────────────────────────────────────────
  // For each speaker (sorted), build heardBy = OTHER LIVING chars within
  // Chebyshev ≤ HEARING_RANGE of SPEAKER's start-of-turn position.
  // Hidden speakers revealed.
  for (const id of liveActorIds) {
    const decision = decisions.get(id)!;
    const text = decision.say;
    if (text === null || text === undefined || text === "") continue;
    const speakerStart = startPos.get(id);
    if (!speakerStart) continue;

    const heardBy: string[] = [];
    // Listeners sorted by characterId for determinism.
    const listenerIds = working.characters
      .map((c) => c.characterId)
      .slice()
      .sort();
    for (const otherId of listenerIds) {
      if (otherId === id) continue;
      const other = working.characters.find((c) => c.characterId === otherId);
      if (!other || !other.alive) continue;
      // Listener position = OTHER'S start-of-turn position (consistent with
      // speaker start-of-turn — speech is emitted before movement).
      const otherStart = startPos.get(otherId) ?? other.pos;
      if (chebyshev(speakerStart, otherStart) <= HEARING_RANGE) {
        heardBy.push(otherId);
      }
    }
    trace.speech.push({ characterId: id, text, heardBy });

    const speaker = working.characters.find((c) => c.characterId === id);
    recordRevealCause(id, "speech");
    if (speaker && speaker.hidden) {
      working = patchCharacter(working, id, (c) => ({ ...c, hidden: false }));
    }
  }

  // ── Phase 4 — Movement ────────────────────────────────────────────────
  const moveDecisions = new Map<string, ParsedDecision>();
  for (const id of liveActorIds) {
    const decision = decisions.get(id)!;
    if (decision.position.kind !== "move") continue;
    moveDecisions.set(id, decision);
  }
  const moveResult = simulateMovement(working, moveDecisions, {
    speedActiveIds,
  });
  working = moveResult.state;
  for (const m of moveResult.moves) {
    trace.moves.push(m);
  }

  // ── Phase 5 — Action ──────────────────────────────────────────────────
  // Collect attacks first (use post-phase-4 working state for HP snapshot
  // and visibility), then apply damage in batch. Reveal-on-fire AFTER
  // damage application (so the attacker still attacks-while-hidden but is
  // revealed for the visibility update phase).

  type AttackEvent = {
    attackerId: string;
    defenderId: string;
    dmg: number;
    source?: "bodyCollision";
    revealsAttacker?: boolean;
  };
  const attacks: AttackEvent[] = [];
  const collidedPairs = new Set<string>();
  for (const move of moveResult.moves) {
    const collision = move.bodyCollision;
    if (!collision) continue;
    if (collision.kind === "character") {
      const other = collision.defenderId;
      const key = [move.characterId, other].sort().join("|");
      if (collidedPairs.has(key)) continue;
      collidedPairs.add(key);
      attacks.push({
        attackerId: move.characterId,
        defenderId: other,
        dmg: 1,
        source: "bodyCollision",
        revealsAttacker: false,
      });
      attacks.push({
        attackerId: other,
        defenderId: move.characterId,
        dmg: 1,
        source: "bodyCollision",
        revealsAttacker: false,
      });
    } else {
      attacks.push({
        attackerId: move.characterId,
        defenderId: move.characterId,
        dmg: 1,
        source: "bodyCollision",
        revealsAttacker: false,
      });
    }
  }
  // Collect interact / loot mutations to apply post-attacks (these don't
  // affect simultaneity with attacks; sequencing them after attack
  // collection is fine because they don't target characters).
  type InteractEvent = { actorId: string; crateId: string };
  // `corpseId` is the engine-internal corpse characterId (matches
  // `corpse.characterId`); `traceTarget` is the original LLM-facing
  // corpse id (e.g. "Corpse_Camper") so the persisted trace echoes
  // what the model emitted, not the internal id.
  type LootEvent = { actorId: string; corpseId: string; traceTarget: string };
  const interacts: InteractEvent[] = [];
  const loots: LootEvent[] = [];

  const traceTargetName = (targetId: string): string => {
    return (
      working.characters.find((c) => c.characterId === targetId)?.displayName ??
      targetId
    );
  };

  // Overwatch is movement-triggered only: target must have actually moved
  // from outside weapon range to inside weapon range this turn.
  const movedIntoRangeIdsByOverwatcher = new Map<string, string>();
  const movedCharacterIds = new Set(
    moveResult.moves
      .filter((m) => m.from.x !== m.to.x || m.from.y !== m.to.y)
      .map((m) => m.characterId),
  );
  for (const id of liveActorIds) {
    const decision = decisions.get(id)!;
    if (decision.position.kind !== "overwatch") continue;
    const actor = working.characters.find((c) => c.characterId === id);
    if (!actor || !actor.alive) continue;
    const range = weaponRange(actor.equipped.weapon);
    const { visible } = computeVisibleEntities(working, id);
    const visibleMovedCandidates: Array<{ id: string; dist: number }> = [];
    for (const v of visible) {
      if (v.kind !== "character") continue;
      if (v.characterId === id) continue;
      if (!movedCharacterIds.has(v.characterId)) continue;
      const target = working.characters.find((c) => c.characterId === v.characterId);
      const targetStart = startPos.get(v.characterId);
      if (!target || !target.alive || !targetStart) continue;
      const preDist = chebyshev(startPos.get(id) ?? actor.pos, targetStart);
      const postDist = chebyshev(actor.pos, target.pos);
      if (preDist > range && postDist <= range) {
        visibleMovedCandidates.push({ id: v.characterId, dist: postDist });
      }
    }
    visibleMovedCandidates.sort(
      (a, b) => a.dist - b.dist || a.id.localeCompare(b.id),
    );
    const first = visibleMovedCandidates[0];
    if (first) movedIntoRangeIdsByOverwatcher.set(id, first.id);
  }

  for (const id of liveActorIds) {
    const decision = decisions.get(id)!;
    const actor = working.characters.find((c) => c.characterId === id);
    if (!actor || !actor.alive) continue;

    const overwatchTargetId = movedIntoRangeIdsByOverwatcher.get(id);
    if (overwatchTargetId) {
      const target = working.characters.find(
        (c) => c.characterId === overwatchTargetId,
      )!;
      const dmg = damageFor(actor.equipped.weapon, target.equipped.armour);
      const weapon = weaponNameForTrace(actor.equipped.weapon);
      attacks.push({
        attackerId: id,
        defenderId: overwatchTargetId,
        dmg,
      });
      trace.actions.push({
        characterId: id,
        kind: "overwatch",
        target: target.displayName,
        result: `dmg ${dmg}`,
        triggeredByMovement: true,
        ...(weapon !== undefined ? { weapon } : {}),
      });
    }

    const action: ActionDecision = decision.action;
    switch (action.kind) {
      case "none":
        break;
      case "attack": {
        // Normalise the LLM-facing persona display id to the engine
        // `characterId` before lookup. Successful traces write the
        // canonical persona displayName, never the internal id.
        const rawTargetId = action.targetId;
        const traceTarget = rawTargetId ?? "";
        const targetId = rawTargetId
          ? normaliseCharacterTargetId(rawTargetId, working.characters)
          : null;
        const target = targetId
          ? working.characters.find((c) => c.characterId === targetId)
          : undefined;
        if (!target || !target.alive) {
          trace.actions.push({
            characterId: id,
            kind: "attack",
            target: traceTarget,
            result: "no_target",
          });
          break;
        }
        const range = weaponRange(actor.equipped.weapon);
        if (chebyshev(actor.pos, target.pos) > range) {
          trace.actions.push({
            characterId: id,
            kind: "attack",
            target: target.displayName,
            result: "out_of_range",
          });
          break;
        }
        const dmg = damageFor(actor.equipped.weapon, target.equipped.armour);
        const weapon = weaponNameForTrace(actor.equipped.weapon);
        attacks.push({
          attackerId: id,
          defenderId: target.characterId,
          dmg,
        });
        trace.actions.push({
          characterId: id,
          kind: "attack",
          target: target.displayName,
          result: `dmg ${dmg}`,
          ...(weapon !== undefined ? { weapon } : {}),
        });
        break;
      }
      case "loot": {
        // Unified loot dispatch by id namespace.
        //   Crate_<x>_<y> → crate-open path
        //   Corpse_*         → corpse-loot path (rendered typed id from
        //                      digest, e.g. `Corpse_Camper`)
        //   otherwise        → result="no_target" (rejection)
        // PM lock D7: crate opens emit `kind="loot"` / `result="opened"`.
        const rawTargetId = action.targetId;
        if (typeof rawTargetId !== "string" || rawTargetId === "") {
          trace.actions.push({
            characterId: id,
            kind: "loot",
            target: rawTargetId ?? "",
            result: "no_target",
          });
          break;
        }
        // WP-G.1 D38 — Corpse_<displayName> typed-id branch. Resolve the
        // inner displayName to the engine `characterId` so the corpse
        // lookup matches in production where `corpse.characterId` is a
        // Convex Id. Trace `target` preserves the LLM verbatim emit so
        // replay/diagnostic tooling sees what the agent actually wrote
        // (mirrors the trace-target convention for diagnostics).
        if (rawTargetId.startsWith("Corpse_")) {
          let corpseCharId = normaliseCorpseTargetId(
            rawTargetId,
            working.characters,
          );
          let corpse = corpseCharId
            ? working.world.corpses.find(
                (c) => c.characterId === corpseCharId,
              )
            : undefined;
          if (!corpse) {
            // Test-fixture path: corpse.characterId is itself the typed
            // display id — match against `Corpse_<characterId>`.
            corpse = working.world.corpses.find(
              (c) => rawTargetId === `Corpse_${c.characterId}`,
            );
            if (corpse) {
              corpseCharId = corpse.characterId;
            }
          }
          if (!corpse) {
            trace.actions.push({
              characterId: id,
              kind: "loot",
              target: rawTargetId,
              result: "no_corpse",
            });
            break;
          }
          if (chebyshev(actor.pos, corpse.pos) > INTERACT_RANGE) {
            trace.actions.push({
              characterId: id,
              kind: "loot",
              target: rawTargetId,
              result: "out_of_range",
            });
            break;
          }
          loots.push({
            actorId: id,
            corpseId: corpseCharId ?? corpse.characterId,
            traceTarget: rawTargetId,
          });
          break;
        }
        if (isCrateId(rawTargetId)) {
          const crateId = rawTargetId;
          const crate = findCrateById(working.world, crateId, state.turn);
          if (!crate) {
            trace.actions.push({
              characterId: id,
              kind: "loot",
              target: crateId,
              result: "no_crate",
            });
            break;
          }
          if (crate.opened) {
            trace.actions.push({
              characterId: id,
              kind: "loot",
              target: crateId,
              result: "already_opened",
            });
            break;
          }
          if (chebyshev(actor.pos, crate.pos) > INTERACT_RANGE) {
            trace.actions.push({
              characterId: id,
              kind: "loot",
              target: crateId,
              result: "out_of_range",
            });
            break;
          }
          // Queue the equip side-effect for phase-5 application below.
          // Success trace (`kind: "loot"`, `result: "opened"`) is
          // emitted inside the phase-5 inner loop after the equip
          // side-effect succeeds.
          interacts.push({ actorId: id, crateId });
          break;
        }

        // Bogus id namespace — emit no_target.
        trace.actions.push({
          characterId: id,
          kind: "loot",
          target: rawTargetId,
          result: "no_target",
        });
        break;
      }
      default: {
        const _exhaustive: never = action;
        void _exhaustive;
      }
    }
  }

  // ── Counter-fire pass ────────────────────────────────────────────────
  //
  // For every attack landing on a defensive overwatcher this turn,
  // enqueue a counter-attack from the overwatcher to the attacker. The
  // counter-fires are appended to the SAME `attacks` array so they
  // resolve in the same `applyDamage` batch (simultaneity preserved per
  // concept-spec §12 + §23).
  //
  // Range bounding: the overwatcher's weapon range is checked at
  // counter-fire time against each attacker's POST-phase-4 position
  // (the position the attacker holds when the attack lands). Out-of-
  // range counter-fires emit `result: "out_of_range"` so the gap is
  // visible in the trace.
  //
  // Determinism: input `attacks` are already in attacker iteration order
  // (sorted-by-attackerId via `liveActorIds.sort()`); we sort by
  // `(defenderId, attackerId)` so multi-attacker counter-fires emit in
  // a stable defender-first, attacker-second order regardless of input
  // permutation.
  //
  // Reveal-on-fire: a hidden defensive overwatcher who counter-fires is
  // revealed via the existing post-attack reveal loop below (the
  // counter-fire becomes an entry in `attacks[]` whose `attackerId` is
  // the overwatcher).
  type CounterFireTrace = {
    overwatcherId: string;
    attackerId: string;
    inRange: boolean;
    dmg: number;
    weapon?: string;
  };
  const counterFireTraces: CounterFireTrace[] = [];
  const counterActors = new Set<string>();
  for (const id of liveActorIds) {
    const decision = decisions.get(id)!;
    if (decision.position.kind === "counter") {
      counterActors.add(id);
    }
  }
  if (counterActors.size > 0) {
    // Snapshot the original attack list — we'll iterate it without
    // disturbing in-flight extensions, then push counter-fires at the
    // end. This avoids "counter-fire's counter-fire" recursion: a
    // counter-fire is itself an attack but is NOT classified as
    // `incoming` against any other defensive overwatcher (the
    // overwatcher is firing AT them, not the other way around).
    const originalAttacks = attacks.slice();
    type PendingCounter = {
      overwatcherId: string;
      attackerId: string;
    };
    const pending: PendingCounter[] = [];
    const pendingCounterKeys = new Set<string>();
    for (const atk of originalAttacks) {
      if (!counterActors.has(atk.defenderId)) continue;
      const key = `${atk.defenderId}|${atk.attackerId}`;
      if (pendingCounterKeys.has(key)) continue;
      pendingCounterKeys.add(key);
      pending.push({
        overwatcherId: atk.defenderId,
        attackerId: atk.attackerId,
      });
    }
    // Stable sort: by overwatcherId asc, then attackerId asc.
    pending.sort(
      (a, b) =>
        a.overwatcherId.localeCompare(b.overwatcherId) ||
        a.attackerId.localeCompare(b.attackerId),
    );
    for (const p of pending) {
      const overwatcher = working.characters.find(
        (c) => c.characterId === p.overwatcherId,
      );
      const attackerCh = working.characters.find(
        (c) => c.characterId === p.attackerId,
      );
      if (!overwatcher || !attackerCh) continue;
      const range = weaponRange(overwatcher.equipped.weapon);
      const dist = chebyshev(overwatcher.pos, attackerCh.pos);
      if (dist > range) {
        counterFireTraces.push({
          overwatcherId: p.overwatcherId,
          attackerId: p.attackerId,
          inRange: false,
          dmg: 0,
        });
        continue;
      }
      const dmg = damageFor(
        overwatcher.equipped.weapon,
        attackerCh.equipped.armour,
      );
      const weapon = weaponNameForTrace(overwatcher.equipped.weapon);
      attacks.push({
        attackerId: p.overwatcherId,
        defenderId: p.attackerId,
        dmg,
      });
      counterFireTraces.push({
        overwatcherId: p.overwatcherId,
        attackerId: p.attackerId,
        inRange: true,
        dmg,
        ...(weapon !== undefined ? { weapon } : {}),
      });
    }
  }

  // Apply attacks in batch (simultaneous resolution per §12).
  // NB: this batch now includes defensive counter-fires appended above;
  // they apply in the SAME pass, preserving the simultaneous-resolution
  // invariant.
  for (const atk of attacks) {
    working = applyDamage(working, atk.attackerId, atk.defenderId, atk.dmg);
  }

  // Emit counter-fire trace entries AFTER applyDamage so the result
  // string reflects the actual damage. Trace order: overwatcherId asc,
  // attackerId asc (matches the pending-sort above).
  for (const cf of counterFireTraces) {
    trace.actions.push({
      characterId: cf.overwatcherId,
      kind: "counter",
      target: traceTargetName(cf.attackerId),
      result: cf.inRange ? `dmg ${cf.dmg}` : "out_of_range",
      ...(cf.inRange && cf.weapon !== undefined ? { weapon: cf.weapon } : {}),
    });
  }

  // Reveal attackers (overwatch + stationary attack) AFTER damage applied.
  for (const atk of attacks) {
    if (atk.revealsAttacker === false) continue;
    const attacker = working.characters.find(
      (c) => c.characterId === atk.attackerId,
    );
    if (attacker) recordRevealCause(atk.attackerId, "attack");
    if (attacker && attacker.hidden) {
      working = patchCharacter(working, atk.attackerId, (c) => ({
        ...c,
        hidden: false,
      }));
    }
  }

  // Apply crate interactions (open crate, equip contents into matching slot,
  // discard previous; flip opened=true, contents=null). Every valid crate
  // attempt produces a trace entry: success includes the looted item; dud
  // crates and same-turn collisions are explicit non-success outcomes.
  for (const ev of interacts) {
    const crate = findCrateById(working.world, ev.crateId, state.turn);
    if (!crate) {
      trace.actions.push({
        characterId: ev.actorId,
        kind: "loot",
        target: ev.crateId,
        result: "no_crate",
      });
      continue;
    }
    if (crate.opened) {
      trace.actions.push({
        characterId: ev.actorId,
        kind: "loot",
        target: ev.crateId,
        result: "already_opened",
      });
      continue;
    }
    if (crate.contents === null) {
      trace.actions.push({
        characterId: ev.actorId,
        kind: "loot",
        target: ev.crateId,
        result: "empty",
      });
      continue;
    }
    const item: ItemRef = crate.contents;
    working = equipIntoSlot(working, ev.actorId, item);
    // Mutate crates array immutably.
    if (crate.source === "static") {
      const newCrates = working.world.crates.map((c) =>
        c.id === ev.crateId ? { ...c, opened: true, contents: null } : c,
      );
      working = {
        ...working,
        world: { ...working.world, crates: newCrates },
      };
    } else {
      const newAirdrops = working.world.airdrops.map((drop) =>
        drop.id === ev.crateId ? { ...drop, looted: true } : drop,
      );
      working = {
        ...working,
        world: { ...working.world, airdrops: newAirdrops },
      };
    }
    trace.actions.push({
      characterId: ev.actorId,
      kind: "loot",
      target: ev.crateId,
      result: "opened",
      lootedItem: item.name,
    });
    const looter = working.characters.find((c) => c.characterId === ev.actorId);
    if (looter) {
      recordRevealCause(ev.actorId, "loot");
      if (looter.hidden) {
        working = patchCharacter(working, ev.actorId, (c) => ({
          ...c,
          hidden: false,
        }));
      }
    }
  }

  // Apply corpse loots (one item per loot in priority order: weapon →
  // armour → consumable; equip into matching slot; remove from corpse).
  //
  // Phase-3 ADR §4 — drained-corpse trace. The previous silent-`continue`
  // on a corpse with no remaining slots is replaced by an explicit
  // `result: "empty"` trace entry. Every loot attempt produces a trace
  // entry; the closing-10 "drained-corpse repeat rate" metric and the
  // replay UI's decisionEnglish renderer both depend on this. Same-turn
  // collisions (a previous actor in this loop drained the corpse) also
  // emit `result: "empty"` for subsequent actors — no silent skip.
  for (const ev of loots) {
    const corpse = working.world.corpses.find(
      (c) => c.characterId === ev.corpseId,
    );
    if (!corpse) {
      // Corpse vanished between phase-5 collection and apply (defensive;
      // shouldn't happen given pure-function state). Emit no_corpse so
      // the trace still ground-truths the attempt.
      trace.actions.push({
        characterId: ev.actorId,
        kind: "loot",
        target: ev.traceTarget,
        result: "no_corpse",
      });
      continue;
    }
    let pickedSlot: "weapon" | "armour" | "consumable" | null = null;
    if (corpse.contents.weapon) pickedSlot = "weapon";
    else if (corpse.contents.armour) pickedSlot = "armour";
    else if (corpse.contents.consumable) pickedSlot = "consumable";
    if (!pickedSlot) {
      // Phase-3 ADR §4 — drained-corpse trace.
      trace.actions.push({
        characterId: ev.actorId,
        kind: "loot",
        target: ev.traceTarget,
        result: "empty",
      });
      continue;
    }

    const picked = corpse.contents[pickedSlot]!;
    working = equipIntoSlot(working, ev.actorId, picked);

    // Remove looted slot from corpse.
    const newContents = { ...corpse.contents };
    delete newContents[pickedSlot];
    const newCorpses = working.world.corpses.map((c) =>
      c.characterId === ev.corpseId ? { ...c, contents: newContents } : c,
    );
    working = {
      ...working,
      world: { ...working.world, corpses: newCorpses },
    };

    trace.actions.push({
      characterId: ev.actorId,
      kind: "loot",
      target: ev.traceTarget,
      result: "looted",
      lootedItem: picked.name,
    });

    // Reveal looter.
    const looter = working.characters.find((c) => c.characterId === ev.actorId);
    if (looter) recordRevealCause(ev.actorId, "loot");
    if (looter && looter.hidden) {
      working = patchCharacter(working, ev.actorId, (c) => ({
        ...c,
        hidden: false,
      }));
    }
  }

  // ── World events — airdrop spawn / telefrag ──────────────────────────
  // Airdrops physically spawn after all phase-5 action/loot resolution but
  // before phase-6 corpse formation. Anyone still alive on the landing tile
  // vanishes as an environmental death, even if same-turn damage already put
  // their HP at or below zero.
  for (const airdrop of working.world.airdrops) {
    if (airdrop.landsAtTurn !== state.turn) continue;
    const victim = working.characters
      .filter(
        (c) =>
          c.alive &&
          c.pos.x === airdrop.pos.x &&
          c.pos.y === airdrop.pos.y,
      )
      .sort((a, b) => a.characterId.localeCompare(b.characterId))[0];
    if (!victim) continue;
    working = replaceCharacter(working, victim.characterId, {
      ...victim,
      alive: false,
      diedAtTurn: state.turn,
    });
    trace.environmentalDeaths.push(victim.characterId);
  }
  trace.environmentalDeaths.sort();

  // ── Phase 6 — Death + corpse formation ────────────────────────────────
  // Any character with hp ≤ 0 (and currently alive) → flip alive=false, set
  // diedAtTurn = state.turn, push corpse mirroring full equipped slots.
  const newDeaths: string[] = [];
  for (const ch of working.characters) {
    if (ch.alive && ch.hp <= 0) {
      newDeaths.push(ch.characterId);
    }
  }
  newDeaths.sort();
  for (const id of newDeaths) {
    const ch = working.characters.find((c) => c.characterId === id)!;
    working = replaceCharacter(working, id, {
      ...ch,
      alive: false,
      diedAtTurn: state.turn,
    });
    const corpse: CorpseState = {
      characterId: id,
      pos: { x: ch.pos.x, y: ch.pos.y },
      contents: {
        weapon: ch.equipped.weapon,
        armour: ch.equipped.armour,
        consumable: ch.equipped.consumable,
      },
    };
    working = {
      ...working,
      world: {
        ...working.world,
        corpses: [...working.world.corpses, corpse],
      },
    };
    trace.deaths.push(id);
  }

  // ── Phase 7 — Visibility update ───────────────────────────────────────
  // For each STILL-ALIVE character:
  //   - Proximity reveal: if in cover + ANY OTHER LIVING char at Chebyshev
  //     ≤ 2 → reveal event (revealedBy: "proximity"); hidden actors flip.
  //   - Visible + in cover + no reveal cause → become hidden.
  //     Any revealMap entry, including proximity without a state flip, wins.
  //   - Update lastKnown using current visible characters.
  for (const id of [...working.characters.map((c) => c.characterId)].sort()) {
    const ch = working.characters.find((c) => c.characterId === id);
    if (!ch || !ch.alive) continue;
    let current = ch;
    const currentInCover = isInCover(working.world, current.pos);

    // Proximity check for any living character in cover. Visible characters
    // keep state, but the reveal event still blocks cover-as-hide below.
    if (currentInCover) {
      let withinTwo = false;
      for (const other of working.characters) {
        if (other.characterId === id) continue;
        if (!other.alive) continue;
        if (chebyshev(current.pos, other.pos) <= PROXIMITY_REVEAL_RANGE) {
          withinTwo = true;
          break;
        }
      }
      if (withinTwo) {
        recordRevealCause(id, "proximity");
        if (current.hidden) {
          working = patchCharacter(working, id, (c) => ({
            ...c,
            hidden: false,
          }));
          current = { ...current, hidden: false };
        }
      }
    }

    if (!current.hidden && !revealMap.has(id) && currentInCover) {
      hideSet.add(id);
      working = patchCharacter(working, id, (c) => ({
        ...c,
        hidden: true,
      }));
      current = { ...current, hidden: true };
    }

    // lastKnown update — based on currentTurn = state.turn (BEFORE phase 8
    // increment).
    const { visible } = computeVisibleEntities(working, id);
    const updated = updateLastKnown(current.lastKnown, visible, state.turn);
    working = patchCharacter(working, id, (c) => ({
      ...c,
      lastKnown: updated,
    }));
  }

  // Emit visibilityUpdates entries in deterministic order. Reveals carry a
  // cause; cover-as-hide entries carry hidden=true with no revealedBy.
  const visibilityUpdateIds = new Set([...revealMap.keys(), ...hideSet]);
  for (const id of [...visibilityUpdateIds].sort()) {
    const revealedBy = revealMap.get(id);
    if (revealedBy !== undefined) {
      trace.visibilityUpdates.push({
        characterId: id,
        hidden: false,
        revealedBy,
      });
    } else {
      trace.visibilityUpdates.push({
        characterId: id,
        hidden: true,
      });
    }
  }

  // Apply scratchpad updates (each agent's optional scratchpad_update,
  // concept-spec §9 — independent of primary commitment). Sorted iteration
  // for determinism.
  for (const id of liveActorIds) {
    const decision = decisions.get(id)!;
    const update = decision.scratchpad;
    if (update === null || update === undefined) continue;
    working = patchCharacter(working, id, (c) => ({ ...c, scratchpad: update }));
  }

  // ── Phase 8 — Next turn state ─────────────────────────────────────────
  // Evac reveal at turn 30; extraction at turn 50. Both use state.turn
  // BEFORE increment (matches test expectations).
  let nextWorld = working.world;
  if (state.turn === EVAC_REVEAL_TURN) {
    nextWorld = {
      ...nextWorld,
      evac: { ...nextWorld.evac, revealedAtTurn: EVAC_REVEAL_TURN },
    };
  }
  let nextChars = working.characters;
  if (state.turn === EVAC_EXTRACT_TURN) {
    const c = nextWorld.evac.centre;
    nextChars = nextChars.map((ch) => {
      if (!ch.alive) return ch;
      const inZone =
        Math.abs(ch.pos.x - c.x) <= EVAC_HALF_SIZE &&
        Math.abs(ch.pos.y - c.y) <= EVAC_HALF_SIZE;
      if (inZone) {
        return { ...ch, extractedAtTurn: EVAC_EXTRACT_TURN };
      }
      return ch;
    });
  }

  const nextState: MatchState = {
    ...working,
    world: nextWorld,
    characters: nextChars,
    turn: state.turn + 1,
  };

  return { state: nextState, trace };
}

// ─── Equipment helpers ───────────────────────────────────────────────────

/**
 * Equip `item` into the matching slot for the named actor, replacing any
 * existing slot value (discarded per concept-spec §13). Returns NEW state.
 */
function equipIntoSlot(
  state: MatchState,
  actorId: string,
  item: ItemRef,
): MatchState {
  const idx = state.characters.findIndex((c) => c.characterId === actorId);
  if (idx < 0) return state;
  const actor = state.characters[idx]!;
  const equipped = { ...actor.equipped };
  if (item.category === "weapon") {
    equipped.weapon = { category: "weapon", name: item.name as WeaponName };
  } else if (item.category === "armour") {
    equipped.armour = { category: "armour", name: item.name };
  } else if (item.category === "consumable") {
    equipped.consumable = { category: "consumable", name: item.name };
  }
  const arr = state.characters.slice();
  arr[idx] = { ...actor, equipped };
  return { ...state, characters: arr };
}
