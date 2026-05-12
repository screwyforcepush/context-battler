// WP7 — 8-phase composed resolver (pure functions; no Convex imports).
//
// Spec sections:
//   - concept-spec.md §7  (vision / hiding / reveal causes)
//   - concept-spec.md §9  (turn economy)
//   - concept-spec.md §10 (movement; entity-tracking; no mid-move retarget)
//   - concept-spec.md §11 (overwatch; reveal-on-fire)
//   - concept-spec.md §12 (combat; simultaneous resolution)
//   - concept-spec.md §13 (gear; chest open + equip; corpse formation/loot)
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
  }>;
  // Phase-3 ADR §3 — `fromOverwatch` + `stance` carry overwatch-stance
  // attribution for engine-emitted entries:
  //   - Defensive counter-fire: kind="overwatch", fromOverwatch=true,
  //     stance="defensive".
  //   - Offensive overwatch fire: kind="overwatch", stance="offensive"
  //     (fromOverwatch may be absent or false).
  //   - Non-overwatch attacks: both fields omitted (legacy phase-1 shape).
  // The flags travel through the persisted action-entry validator in
  // schema.ts (and the mirror) to the replay UI's decisionEnglish renderer.
  actions: ActionTraceEntry[];
  deaths: string[];
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
    visibilityUpdates: [],
  };

  // visibilityRevealMap tracks per-character reveal causes accumulated across
  // phases. We emit at most one visibilityUpdates entry per character at end
  // of phase 7 (or earlier when reveal causes need to be observable to
  // downstream phases — e.g., speech reveal must be visible to overwatch).
  const revealMap = new Map<string, RevealCause>();

  // Working state — never mutate the input. We re-bind `working` on each
  // immutable update.
  let working: MatchState = state;

  // Snapshot start-of-turn positions (for speech hearing range + leaving-
  // cover detection).
  const startPos = new Map<string, Tile>();
  const startInCover = new Map<string, boolean>();
  for (const ch of state.characters) {
    startPos.set(ch.characterId, { x: ch.pos.x, y: ch.pos.y });
    startInCover.set(ch.characterId, isInCover(state.world, ch.pos));
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
    if (decision.consume === "none") continue;
    const ch = working.characters.find((c) => c.characterId === id);
    if (!ch) continue;
    const equipped = ch.equipped.consumable;
    // Defensive: only consume when actor actually has the matching consumable.
    if (
      !equipped ||
      equipped.category !== "consumable" ||
      equipped.name !== decision.consume
    ) {
      continue;
    }
    const consumable = decision.consume; // "heal" | "speed"

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
    if (ch.hidden) {
      revealMap.set(id, "consumable");
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
    if (speaker && speaker.hidden) {
      revealMap.set(id, "speech");
      working = patchCharacter(working, id, (c) => ({ ...c, hidden: false }));
    }
  }

  // ── Phase 4 — Movement ────────────────────────────────────────────────
  // Filter to ONLY decisions where primary === "move"; pass speedActiveIds.
  // Detect "leaving cover" reveal per-mover after the substep loop.
  //
  // Phase-5 move-arm consolidation — movement target ids stay in the
  // model-visible id space (`Player_N`, `Chest_NNN`, `Cover_X_Y`, etc.).
  // `simulateMovement` consumes `resolveTypedEntity`, which owns the
  // Player_N → engine-character lookup and per-entity stopAtRange logic.
  // Attack/loot action ids are still normalised at their action sites below
  // so traces can echo the model-visible ids while engine lookups use
  // internal references.
  const moveDecisions = new Map<string, ParsedDecision>();
  for (const id of liveActorIds) {
    const decision = decisions.get(id)!;
    if (decision.primary !== "move") continue;
    moveDecisions.set(id, decision);
  }
  const moveResult = simulateMovement(working, moveDecisions, {
    speedActiveIds,
  });
  working = moveResult.state;
  for (const m of moveResult.moves) {
    trace.moves.push(m);
  }

  // Leaving-cover detection: any LIVING character whose start-of-turn pos was
  // a cover tile and whose end-of-phase-4 pos is NOT a cover tile.
  for (const id of liveActorIds) {
    const startedInCover = startInCover.get(id) ?? false;
    if (!startedInCover) continue;
    const ch = working.characters.find((c) => c.characterId === id);
    if (!ch || !ch.alive) continue;
    if (!isInCover(working.world, ch.pos)) {
      // Only reveal if currently hidden.
      if (ch.hidden) {
        revealMap.set(id, "leaving_cover");
        working = patchCharacter(working, id, (c) => ({
          ...c,
          hidden: false,
        }));
      }
    }
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
    fromOverwatch: boolean;
  };
  const attacks: AttackEvent[] = [];
  // Collect interact / loot mutations to apply post-attacks (these don't
  // affect simultaneity with attacks; sequencing them after attack
  // collection is fine because they don't target characters).
  type InteractEvent = { actorId: string; chestId: string };
  // `corpseId` is the engine-internal corpse characterId (matches
  // `corpse.characterId`); `traceTarget` is the original LLM-facing
  // targetId literal (e.g. "Player_5") so the persisted trace echoes
  // what the model emitted, not the internal id.
  type LootEvent = { actorId: string; corpseId: string; traceTarget: string };
  const interacts: InteractEvent[] = [];
  const loots: LootEvent[] = [];

  for (const id of liveActorIds) {
    const decision = decisions.get(id)!;
    const actor = working.characters.find((c) => c.characterId === id);
    if (!actor || !actor.alive) continue;

    // WP10.5 (concept-spec §9 line 447): primary === "move" still allows ONE
    // normal action this turn. Fall through to the action switch below; the
    // in-range / liveness gates evaluate against the POST-move `working`
    // state. primary === "overwatch" has its own resolution branch.

    if (decision.primary === "overwatch") {
      // Phase-3 ADR §3 — overwatch behaviour gates on `overwatch_stance`:
      //   - "offensive" → existing first-in-range fire (this branch).
      //   - "defensive" → no proactive fire; counter-fire pass below
      //     handles incoming hits.
      //   - null → schema-rejected upstream; defensive no-op here.
      if (decision.overwatch_stance === "offensive") {
        // Find first valid in-range VISIBLE enemy (priority: nearest).
        const { visible } = computeVisibleEntities(working, id);
        const candidates: { id: string; dist: number }[] = [];
        const range = weaponRange(actor.equipped.weapon);
        for (const v of visible) {
          if (v.kind !== "character") continue;
          const target = working.characters.find(
            (c) => c.characterId === v.characterId,
          );
          if (!target || !target.alive) continue;
          const d = chebyshev(actor.pos, target.pos);
          if (d <= range) {
            candidates.push({ id: v.characterId, dist: d });
          }
        }
        if (candidates.length === 0) continue;
        // Sort: nearest first, ties broken by characterId for determinism.
        candidates.sort(
          (a, b) => a.dist - b.dist || a.id.localeCompare(b.id),
        );
        const targetId = candidates[0]!.id;
        const target = working.characters.find(
          (c) => c.characterId === targetId,
        )!;
        const dmg = damageFor(actor.equipped.weapon, target.equipped.armour);
        const weapon = weaponNameForTrace(actor.equipped.weapon);
        attacks.push({
          attackerId: id,
          defenderId: targetId,
          dmg,
          fromOverwatch: true,
        });
        // Phase-3 ADR §3 — engine-emit stance attribution into trace.
        // Offensive overwatch fire: stance="offensive"; fromOverwatch
        // omitted (downstream consumers treat absence as false).
        trace.actions.push({
          characterId: id,
          kind: "overwatch",
          target: targetId,
          result: `dmg ${dmg}`,
          stance: "offensive",
          ...(weapon !== undefined ? { weapon } : {}),
        });
      }
      // Defensive: no fire here; counter-fire pass below collects per-
      // attacker counter-shots after main attacks are gathered.
      continue;
    }

    // primary === "stationary_action" OR primary === "move" (post-move
    // action — see WP10.5 head-note). Both paths resolve `decision.action`
    // against the same post-move `working` state.
    const action: ActionDecision = decision.action;
    switch (action.kind) {
      case "none":
        break;
      case "attack": {
        // Phase-3 WP-F.2 — normalise the LLM-facing typed display id
        // (`Player_N`) to the engine `characterId` before the lookup.
        // `traceTarget` preserves the model's verbatim emit so the
        // persisted trace mirrors what the agent wrote (consistent with
        // the corpse-loot path's `traceTarget` convention).
        const rawTargetId = action.targetCharacterId;
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
            target: traceTarget,
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
          fromOverwatch: false,
        });
        trace.actions.push({
          characterId: id,
          kind: "attack",
          target: traceTarget,
          result: `dmg ${dmg}`,
          ...(weapon !== undefined ? { weapon } : {}),
        });
        break;
      }
      case "loot": {
        // Phase-3 ADR §1 — unified loot dispatch by id namespace.
        //   chest_*       → chest-open path
        //   Corpse_*      → corpse-loot path (rendered typed-id from
        //                   digest, e.g. `Corpse_Player_5`); WP-G.1 D38
        //                   normalises via inner displayName lookup.
        //   Player_*      → corpse-loot path (legacy / direct displayName
        //                   form; resolved via displayName lookup so
        //                   production Convex Ids round-trip through the
        //                   LLM-facing literal).
        //   otherwise     → result="no_target" (rejection)
        // PM lock D7: chest opens emit `kind="loot"` / `result="opened"`.
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
        // (mirrors the Player_* branch's `traceTarget` convention).
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
            // `Player_N` literal — match against `Corpse_<characterId>`.
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
        // Phase-3 fix — accept both `Chest_NNN` (rendered typed-id) and
        // `chest_NNN` (internal id) on the chest namespace branch. The
        // trace `target` field preserves the model's verbatim emit so
        // replay/diagnostic tooling sees what the agent actually wrote.
        const targetId = rawTargetId.startsWith("Chest_")
          ? "chest_" + rawTargetId.slice("Chest_".length)
          : rawTargetId;
        if (targetId.startsWith("chest_")) {
          const chestId = targetId;
          const chest = working.world.chests.find((c) => c.id === chestId);
          if (!chest) {
            trace.actions.push({
              characterId: id,
              kind: "loot",
              target: chestId,
              result: "no_chest",
            });
            break;
          }
          if (chest.opened) {
            trace.actions.push({
              characterId: id,
              kind: "loot",
              target: chestId,
              result: "already_opened",
            });
            break;
          }
          if (chebyshev(actor.pos, chest.pos) > INTERACT_RANGE) {
            trace.actions.push({
              characterId: id,
              kind: "loot",
              target: chestId,
              result: "out_of_range",
            });
            break;
          }
          // Queue the equip side-effect for phase-5 application below.
          // Success trace (`kind: "loot"`, `result: "opened"`) is
          // emitted inside the phase-5 inner loop AFTER the
          // `chest.opened || chest.contents === null` short-circuit
          // (Gate-2 fix #1 invariant preserved).
          interacts.push({ actorId: id, chestId });
          break;
        }

        if (targetId.startsWith("Player_")) {
          // Player_* dispatch: resolve via direct match first (test
          // fixtures + edge case where corpse.characterId is itself a
          // Player_* literal), then via displayName lookup → characterId
          // → corpse (production: corpse.characterId is a Convex Id, the
          // LLM-facing literal is the dead character's displayName).
          let corpseCharId: string | null = null;
          let corpse = working.world.corpses.find(
            (c) => c.characterId === targetId,
          );
          if (corpse) {
            corpseCharId = corpse.characterId;
          } else {
            const ch = working.characters.find(
              (c) => c.displayName === targetId,
            );
            if (ch) {
              corpseCharId = ch.characterId;
              corpse = working.world.corpses.find(
                (c) => c.characterId === ch.characterId,
              );
            }
          }
          if (!corpse) {
            trace.actions.push({
              characterId: id,
              kind: "loot",
              target: targetId,
              result: "no_corpse",
            });
            break;
          }
          if (chebyshev(actor.pos, corpse.pos) > INTERACT_RANGE) {
            trace.actions.push({
              characterId: id,
              kind: "loot",
              target: targetId,
              result: "out_of_range",
            });
            break;
          }
          // Pass the resolved internal corpse characterId into the
          // post-phase-5 loot loop. The trace target string is the
          // *original* LLM-facing literal so consumers see what the
          // model emitted.
          loots.push({
            actorId: id,
            corpseId: corpseCharId ?? corpse.characterId,
            traceTarget: targetId,
          });
          break;
        }

        // Bogus id namespace — emit no_target.
        trace.actions.push({
          characterId: id,
          kind: "loot",
          target: targetId,
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

  // ── Phase-3 ADR §3 — Defensive overwatch counter-fire pass ───────────
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
  // Identify defensive overwatchers — they declared
  // primary="overwatch" + overwatch_stance="defensive" this turn.
  const defensiveOverwatchers = new Set<string>();
  for (const id of liveActorIds) {
    const decision = decisions.get(id)!;
    if (
      decision.primary === "overwatch" &&
      decision.overwatch_stance === "defensive"
    ) {
      defensiveOverwatchers.add(id);
    }
  }
  if (defensiveOverwatchers.size > 0) {
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
    for (const atk of originalAttacks) {
      if (!defensiveOverwatchers.has(atk.defenderId)) continue;
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
        fromOverwatch: true,
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
      kind: "overwatch",
      target: cf.attackerId,
      result: cf.inRange ? `dmg ${cf.dmg}` : "out_of_range",
      fromOverwatch: true,
      stance: "defensive",
      ...(cf.inRange && cf.weapon !== undefined ? { weapon: cf.weapon } : {}),
    });
  }

  // Reveal attackers (overwatch + stationary attack) AFTER damage applied.
  for (const atk of attacks) {
    const attacker = working.characters.find(
      (c) => c.characterId === atk.attackerId,
    );
    if (attacker && attacker.hidden) {
      revealMap.set(atk.attackerId, "attack");
      working = patchCharacter(working, atk.attackerId, (c) => ({
        ...c,
        hidden: false,
      }));
    }
  }

  // Apply chest interactions (open chest, equip contents into matching slot,
  // discard previous; flip opened=true, contents=null). Emit `result: "opened"`
  // ONLY for the actor whose equip side-effect actually runs (Gate-2 fix #1):
  // dud chests (`contents === null`) and same-turn collisions (a chest opened
  // by an earlier actor in this same loop) are silently skipped — the
  // aggregator at convex/engine/runStats.ts:200-212 keys equip counts off
  // `result === "opened"`, so this keeps `equips` ground-truth.
  for (const ev of interacts) {
    const chest = working.world.chests.find((c) => c.id === ev.chestId);
    if (!chest || chest.opened || chest.contents === null) continue;
    const item: ItemRef = chest.contents;
    working = equipIntoSlot(working, ev.actorId, item);
    // Mutate chests array immutably.
    const newChests = working.world.chests.map((c) =>
      c.id === ev.chestId ? { ...c, opened: true, contents: null } : c,
    );
    working = {
      ...working,
      world: { ...working.world, chests: newChests },
    };
    // Phase-3 PM lock D7: chest opens emit `kind = "loot"` (the
    // resolved-engine-path, unified under loot per ADR §1). Consumers
    // (replay, runStats, harness analyze) read
    // `kind === "loot" && result === "opened" && target.startsWith("chest_")`.
    trace.actions.push({
      characterId: ev.actorId,
      kind: "loot",
      target: ev.chestId,
      result: "opened",
    });
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
    });

    // Reveal looter.
    const looter = working.characters.find((c) => c.characterId === ev.actorId);
    if (looter && looter.hidden) {
      revealMap.set(ev.actorId, "loot");
      working = patchCharacter(working, ev.actorId, (c) => ({
        ...c,
        hidden: false,
      }));
    }
  }

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
  //   - Proximity reveal: if hidden + in cover + ANY OTHER LIVING char at
  //     Chebyshev ≤ 2 → reveal (revealedBy: "proximity").
  //   - Otherwise hidden + in cover + no reveal cause → stay hidden.
  //   - Update lastKnown using current visible characters.
  for (const id of [...working.characters.map((c) => c.characterId)].sort()) {
    const ch = working.characters.find((c) => c.characterId === id);
    if (!ch || !ch.alive) continue;

    // Proximity check (only if still hidden and in cover).
    if (ch.hidden && isInCover(working.world, ch.pos)) {
      let withinTwo = false;
      for (const other of working.characters) {
        if (other.characterId === id) continue;
        if (!other.alive) continue;
        if (chebyshev(ch.pos, other.pos) <= PROXIMITY_REVEAL_RANGE) {
          withinTwo = true;
          break;
        }
      }
      if (withinTwo) {
        revealMap.set(id, "proximity");
        working = patchCharacter(working, id, (c) => ({
          ...c,
          hidden: false,
        }));
      }
    }

    // lastKnown update — based on currentTurn = state.turn (BEFORE phase 8
    // increment).
    const { visible } = computeVisibleEntities(working, id);
    const updated = updateLastKnown(ch.lastKnown, visible, state.turn);
    working = patchCharacter(working, id, (c) => ({
      ...c,
      lastKnown: updated,
    }));
  }

  // Emit visibilityUpdates entries in deterministic order. We emit one
  // entry per character that was REVEALED this turn (revealMap has them);
  // we also emit an entry for every CURRENTLY-LIVING character so the trace
  // is a full snapshot? — the schema validator is lenient but the tests
  // only assert .some() on revealed entries, so emitting only revealed
  // characters is sufficient and avoids noise.
  for (const id of [...revealMap.keys()].sort()) {
    trace.visibilityUpdates.push({
      characterId: id,
      hidden: false,
      revealedBy: revealMap.get(id)!,
    });
  }

  // Apply scratchpad updates (each agent's optional scratchpad_update,
  // concept-spec §9 — independent of primary commitment). Sorted iteration
  // for determinism.
  for (const id of liveActorIds) {
    const decision = decisions.get(id)!;
    const update = decision.scratchpad_update;
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
