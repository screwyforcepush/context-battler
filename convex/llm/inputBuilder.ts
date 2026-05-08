// WP-C.1 — per-turn agent input builder (phase-3 ADR §6 rebuild).
//
// Produces the **tactical visible-state digest** described by concept-spec §7
// (NOT an ASCII tile dump). Phase-3 reshapes the digest per North Star §1:
//
//   You: at (X,Y), HP/maxHP, weapon/armour/consumable, in evac zone
//   Last turn (you): <move outcome>, <action outcome>, <damage from whom>, said "..."
//   Visible:
//   - Player_4, dist 7 S [HP~high, holding axe, attacked Player_2]
//   - Chest_005, dist 6 SE [opened]
//   - Corpse_Player_5, dist 9 S [drained]
//   - Cover_32_32, dist 4 SE
//   - Wall_40_34, dist 1 S
//   - Evac, dist 12 SE
//
// Removed sections (vs phase-1 digest):
//   - `Affordances:` — the system prompt now teaches the action grammar.
//   - `Heard (last turn):` — last-turn speech folds into per-Visible
//     observation brackets.
//   - `Last-known:` — last-known map memory is the agent's job via
//     scratchpad; the system prompt teaches the contract.
//   - `Evac:` — evac is a singleton Visible bullet once revealed.
//
// Boundary (ADR §1): pure-function module; no Convex imports, no
// `convex/_generated/` access, no `fetch`. Consumed by:
//   - `convex/runMatch.ts` (`advanceTurn`) — calls `buildAgentInput` once
//     per living agent with the prior turn's `turns` row threaded in.
//
// Token-count proxy. We use **`chars / 4`** as a deterministic, install-free
// proxy for tiktoken token counts. The composed input (system + persona +
// scratchpad + digest) target is ≤ 1 200 tokens; asserted in
// `tests/llm/inputBuilder.test.ts`.
//
// Cross-references:
//   - architecture-decisions.md §5 (walls), §6 (per-turn input shape),
//     §7 (system prompt), §9 (wall-blocked move).
//   - work-packages.md WP-C.1 — locks the rewrite contract.
//   - concept-spec.md §7 (vision example), §8 (agent input list).

import { chebyshev } from "../engine/distance.js";
import { computeVisibleEntities } from "../engine/vision.js";
import type {
  CharacterState,
  CorpseState,
  EquippedSlots,
  ItemRef,
  MatchState,
  MoveDecision,
  Tile,
  VisibleEntity,
} from "../engine/types.js";
import { SYSTEM_PROMPT } from "./systemPrompt.js";

// ─── Caps (locked per WP-C.1 acceptance) ────────────────────────────────────

/** 8-cap on living characters + chests/corpses (categories 1+2) per ADR §6.
 *  Cover, walls, and Evac are unbounded except for the 12-wall safety
 *  ceiling below. */
const VISIBLE_ENTITY_CAP = 8;

/** 12-wall safety ceiling at the inputBuilder layer per ADR §5. Vision
 *  emits walls uncapped; this cap defends against pathological vision
 *  positions without trimming actionable entities. */
const WALL_CAP = 12;

/** Half-size of the 3×3 evac zone (centre ± 1) per concept-spec §15. */
const EVAC_HALF_SIZE = 1;

// ─── 8-octant compass bearing ───────────────────────────────────────────────

/**
 * 8-octant compass bearing from `from` to `to`. Coordinate system is
 * `(0,0)` top-left, x→east, y→south (per types.ts), so a target with
 * `dy < 0` is north and `dx > 0` is east.
 *
 * Bucketing rule: angle-based using `Math.atan2(dy, dx)` and 45° sectors.
 * Each sector is centred on its compass bearing (i.e. E spans -22.5°..+22.5°),
 * so equal-magnitude diagonals like (4,2) bucket as SE rather than E. This
 * matches the ADR §6 canonical example "Cover_32_32, dist 4 SE" for an
 * observer at (28,30) sighting cover at (32,32).
 */
function compassDirection(from: Tile, to: Tile): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return "";
  // atan2 returns radians in (-π, π]. Normalise to [0, 360°) and bucket
  // into eight 45° sectors, each centred on its compass label.
  const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
  const normalised = (angleDeg + 360) % 360;
  // y-down convention: dx>0 is E, dy>0 is S. Sector 0 is centred on E and
  // sectors increase clockwise through SE, S, SW, W, NW, N, NE.
  const compass = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"] as const;
  const sector = Math.floor((normalised + 22.5) / 45) % 8;
  return compass[sector] ?? "";
}

// ─── Equipped slot rendering ────────────────────────────────────────────────

/**
 * Render the agent's equipped slots as `weapon / armour / consumable`,
 * substituting `—` for empty slots. Used on the You: line.
 */
function renderEquipped(actor: CharacterState): string {
  const w = actor.equipped.weapon?.name ?? "—";
  const a = actor.equipped.armour?.name ?? "—";
  const c = actor.equipped.consumable?.name ?? "—";
  return `${w} / ${a} / ${c}`;
}

// ─── PrevTurnRow shape ──────────────────────────────────────────────────────

/**
 * The subset of the previous turn's `turns` row this builder reads. Mirrors
 * the engine's `ResolutionTrace` (modulo Convex Id ↔ string boundary,
 * which `runMatch.ts` adapts at the call site).
 *
 * Fields used:
 *   - `moves[]` for the Last turn (you) move outcome (consumes
 *     `blockedBy === "wall"` per ADR §9).
 *   - `actions[]` for both (a) the actor's own action outcome on the Last
 *     turn line, (b) damage-taken-from-whom on the Last turn line, and
 *     (c) per-Visible observation brackets ("attacked Player_X").
 *   - `speech[]` for (a) the actor's own said-"..." fragment, and (b)
 *     per-Visible observation brackets ("said \"...\"").
 */
export type PrevTurnRow = {
  resolution: {
    consumed: ReadonlyArray<{ characterId: string; item: string }>;
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
    }>;
    actions: ReadonlyArray<{
      characterId: string;
      kind: string;
      target: string;
      result: string;
      fromOverwatch?: boolean;
      stance?: "offensive" | "defensive";
    }>;
    deaths: ReadonlyArray<string>;
    visibilityUpdates: ReadonlyArray<{
      characterId: string;
      hidden: boolean;
      revealedBy?: string;
    }>;
  };
  /**
   * Phase-3 WP-F.4 — the actor's prior-turn `decision.move` keyed by
   * characterId, threaded from the persisted `agentRecords[].decision`
   * on the prior turn row.
   *
   * Used by `renderMoveFragment` to render the *intent* direction of a
   * wall-blocked move per North Star §1: `moved 3 SW → hit wall`. The
   * `relative` arm carries `{dx, dy}` directly; other arms (`toward_*` /
   * `none`) lack a persisted (dx, dy) intent vector and the renderer
   * falls back to the ADR §9 generic phrasing `tried to move → hit wall`.
   *
   * Optional. When absent (turn 0, missing record, legacy fixtures), the
   * renderer gracefully falls back to the existing wording rather than
   * throwing.
   */
  priorMoveByActor?: Readonly<Record<string, MoveDecision>>;
};

// ─── Identity helpers ───────────────────────────────────────────────────────

/**
 * Resolve a `characterId` to its `displayName` via `state.characters`. If
 * the id doesn't match any character (defensive — happens during teardown
 * or with synthetic test ids), return the id verbatim.
 */
function resolveDisplayName(state: MatchState, characterId: string): string {
  const c = state.characters.find((c) => c.characterId === characterId);
  return c?.displayName ?? characterId;
}

/**
 * Resolve a `characterId` to its typed-id rendering (`Player_N`).
 *
 * Used for fragments that name characters who may not be in `state.characters`
 * — e.g. damage attackers from the prior turn whose entries we never need to
 * fold into the current observer's vision (a wounding shot from outside vision
 * range, or an attacker whose record has been pruned). Production data shape
 * is locked in `convex/matches.ts:255` (`displayName: \`Player_${spawnIndex+1}\``)
 * and `characterId` is `"P${n}"` (per spawn ordering), so the regex fallback
 * `^P(\d+)$` → `Player_$1` matches the stable convention.
 *
 * Lookup-hit path: when the character IS in `state.characters`, prefer the
 * stored `displayName` so any future rename still flows through.
 *
 * Lookup-miss path: apply the `P${n}` → `Player_${n}` regex; for non-matching
 * synthetic ids (tests, teardown), fall back to the bare id verbatim so the
 * digest still surfaces *something* identifiable.
 */
function renderCharacterTypedId(
  state: MatchState,
  characterId: string,
): string {
  const c = state.characters.find((c) => c.characterId === characterId);
  if (c) return c.displayName;
  const m = /^P(\d+)$/.exec(characterId);
  if (m) return `Player_${m[1]}`;
  return characterId;
}

/**
 * Extract the numeric chest id (e.g. `"chest_005"` → `"005"`) and render
 * as `Chest_005`. Falls back to the raw object id if it doesn't match the
 * chest namespace.
 */
function renderChestId(objectId: string): string {
  const m = /^chest_(\d+)$/.exec(objectId);
  if (!m) return objectId;
  return `Chest_${m[1]}`;
}

/** True iff a corpse's contents has no remaining loot slot. */
function corpseDrained(contents: CorpseState["contents"]): boolean {
  return !contents.weapon && !contents.armour && !contents.consumable;
}

// ─── Last turn (you) line ───────────────────────────────────────────────────

/**
 * Render the move-outcome fragment for the actor's own row. Shape:
 *   - normal move: `moved <dist> <bearing>` (e.g. "moved 3 NE")
 *   - wall-blocked WITH prior `relative` decision intent (WP-F.4):
 *     `moved <dist> <bearing> → hit wall` (e.g. "moved 3 SW → hit wall"
 *     per North Star §1). The intent vector comes from
 *     `prev.priorMoveByActor[characterId]` (the actor's persisted
 *     `decision.move` from the prior turn); chebyshev distance and the
 *     existing 8-octant `compassDirection` helper render the bearing.
 *   - wall-blocked WITHOUT a usable intent vector (no `priorMoveByActor`,
 *     non-`relative` move kind, or zero-magnitude vector): falls back to
 *     the ADR §9 generic `tried to move → hit wall`. Non-`relative` kinds
 *     (`toward_entity` / `toward_object` / `toward_evac` / `none`) carry
 *     no persisted (dx, dy) — the engine resolved a step at runtime that
 *     we never recorded — so we cannot synthesise a bearing without
 *     duplicating engine-side path math.
 *   - no entry: returns null (caller drops the fragment).
 */
function renderMoveFragment(
  prev: PrevTurnRow,
  characterId: string,
): string | null {
  const entry = prev.resolution.moves.find(
    (m) => m.characterId === characterId,
  );
  if (!entry) return null;
  if (entry.blockedBy === "wall") {
    const intent = prev.priorMoveByActor?.[characterId];
    if (intent && intent.kind === "relative") {
      const dist = Math.max(Math.abs(intent.dx), Math.abs(intent.dy));
      if (dist > 0) {
        // Synthetic from→to: compassDirection only reads (dx, dy) so a
        // zero-origin pair faithfully encodes the intent vector without
        // depending on the actor's actual prior position.
        const dir = compassDirection(
          { x: 0, y: 0 },
          { x: intent.dx, y: intent.dy },
        );
        if (dir) return `moved ${dist} ${dir} → hit wall`;
      }
    }
    return "tried to move → hit wall";
  }
  const dist = chebyshev(entry.from, entry.to);
  if (dist === 0) return null;
  const dir = compassDirection(entry.from, entry.to);
  return dir ? `moved ${dist} ${dir}` : `moved ${dist}`;
}

/**
 * Render the action-outcome fragment for the actor's own row. Renders
 * non-overwatch action entries the actor produced.
 *
 * Shape:
 *   - attack: `attacked <target> (<result>)`  (e.g. "attacked Player_3 (dmg 7)")
 *   - loot:   `looted <target> (<result>)`    (e.g. "looted chest_005 (opened)")
 *   - other:  `<kind> <target> (<result>)`    (defensive)
 *
 * Returns null when no own-action entry exists.
 */
function renderActionFragment(
  prev: PrevTurnRow,
  characterId: string,
): string | null {
  // Skip overwatch counter-fire rows in this fragment — those are the
  // actor's REACTIVE damage to attackers. The actor's "primary action"
  // is what they explicitly chose. fromOverwatch===true is reactive.
  const entry = prev.resolution.actions.find(
    (a) => a.characterId === characterId && a.fromOverwatch !== true,
  );
  if (!entry) return null;
  const target = entry.target || "";
  const result = entry.result || "";
  if (entry.kind === "attack") {
    return result ? `attacked ${target} (${result})` : `attacked ${target}`;
  }
  if (entry.kind === "loot") {
    return result ? `looted ${target} (${result})` : `looted ${target}`;
  }
  if (entry.kind === "overwatch") {
    // Offensive overwatch fire — the actor committed to overwatch and an
    // enemy walked into range. Render distinctly so the agent learns the
    // arm worked.
    return result
      ? `overwatch hit ${target} (${result})`
      : `overwatch hit ${target}`;
  }
  return result
    ? `${entry.kind} ${target} (${result})`
    : `${entry.kind} ${target}`;
}

/**
 * Render the damage-taken-from fragment. Sums the `dmg N` results in
 * incoming attack/overwatch entries against this character's displayName,
 * and lists the attackers comma-joined.
 *
 * Returns null when no incoming damage exists.
 */
function renderDamageFragment(
  prev: PrevTurnRow,
  state: MatchState,
  characterId: string,
): string | null {
  const myDisplayName = resolveDisplayName(state, characterId);
  const attackers: string[] = [];
  let totalDmg = 0;
  for (const a of prev.resolution.actions) {
    if (a.target !== myDisplayName) continue;
    if (a.kind !== "attack" && a.kind !== "overwatch") continue;
    // result format is "dmg N" or "out_of_range" / etc. Extract N.
    const m = /^dmg (\d+)$/.exec(a.result);
    if (!m) continue;
    totalDmg += Number(m[1]);
    // Use the typed-id helper so attackers who aren't in state.characters
    // (e.g. an attacker outside the observer's current vision but whose
    // damage entry still threads through the prior turn's resolution)
    // still surface as `Player_N` rather than the bare characterId.
    const attackerName = renderCharacterTypedId(state, a.characterId);
    if (!attackers.includes(attackerName)) attackers.push(attackerName);
  }
  if (totalDmg === 0 || attackers.length === 0) return null;
  return `took ${totalDmg} dmg from ${attackers.join(", ")}`;
}

/**
 * Render the said-"..." fragment for the actor's own speech.
 */
function renderSaidFragment(
  prev: PrevTurnRow,
  characterId: string,
): string | null {
  const entry = prev.resolution.speech.find(
    (s) => s.characterId === characterId,
  );
  if (!entry) return null;
  return `said "${entry.text}"`;
}

/**
 * Compose the full `Last turn (you):` line. Returns null on turn 1 (no
 * prevTurnRow) — the caller suppresses the line entirely.
 *
 * Order: move outcome, action outcome, damage taken from whom, said.
 * Empty fragments are dropped; if every fragment is null, the line is
 * `Last turn (you): no-op` (the actor took no observable action).
 */
export function buildLastTurnLine(
  state: MatchState,
  characterId: string,
  prev: PrevTurnRow | null,
): string | null {
  if (!prev) return null;
  const fragments: string[] = [];
  const move = renderMoveFragment(prev, characterId);
  if (move) fragments.push(move);
  const action = renderActionFragment(prev, characterId);
  if (action) fragments.push(action);
  const damage = renderDamageFragment(prev, state, characterId);
  if (damage) fragments.push(damage);
  const said = renderSaidFragment(prev, characterId);
  if (said) fragments.push(said);
  if (fragments.length === 0) {
    return "Last turn (you): no-op";
  }
  return `Last turn (you): ${fragments.join(", ")}`;
}

// ─── Per-Visible observation brackets ──────────────────────────────────────

/**
 * Per-visible-character observations gathered from the prior turn's
 * resolution. Filtered to only what THIS observer could see at turn N+1
 * start (the visible-entity emission already does that).
 */
type VisibleObservation = {
  attackedTarget?: string;
  saidText?: string;
};

/**
 * Build a map of `characterId → VisibleObservation` for every character
 * that appears in the prior turn's actions or speech. Filtering by
 * visibility happens at render time (only Visible character bullets pull
 * from this map).
 */
function buildObservationMap(
  prev: PrevTurnRow | null,
): Map<string, VisibleObservation> {
  const out = new Map<string, VisibleObservation>();
  if (!prev) return out;
  for (const a of prev.resolution.actions) {
    if (a.kind !== "attack") continue;
    if (a.fromOverwatch === true) continue; // reactive — not a chosen attack
    if (!a.target) continue;
    const obs = out.get(a.characterId) ?? {};
    obs.attackedTarget = a.target;
    out.set(a.characterId, obs);
  }
  for (const s of prev.resolution.speech) {
    const obs = out.get(s.characterId) ?? {};
    obs.saidText = s.text;
    out.set(s.characterId, obs);
  }
  return out;
}

// ─── Visible entity → bullet line ──────────────────────────────────────────

/** Internal representation of a visible-bullet, before rendering. The sort
 *  comparator works on this shape. */
type BulletEntry = {
  /** Sort tier per ADR §6: 1=character, 2=chest/corpse, 3=cover, 4=wall, 5=evac. */
  tier: 1 | 2 | 3 | 4 | 5;
  /** Chebyshev distance to observer for sort. */
  dist: number;
  /** Whether the entry is a drained corpse — drained sorts after non-drained
   *  at equal distance. */
  drained: boolean;
  /** Stable secondary key (id / displayName) for tie-breaking ASC. */
  sortKey: string;
  rendered: string;
};

function renderHpBucket(bucket: "low" | "mid" | "high"): string {
  return `HP~${bucket}`;
}

function renderCharacterBullet(
  entity: VisibleEntity & { kind: "character" },
  observerPos: Tile,
  state: MatchState,
  observations: Map<string, VisibleObservation>,
): BulletEntry {
  const dist = chebyshev(observerPos, entity.pos);
  const dir = compassDirection(observerPos, entity.pos);
  const distFragment = dir ? `dist ${dist} ${dir}` : `dist ${dist}`;
  const name = resolveDisplayName(state, entity.characterId);
  const brackets: string[] = [renderHpBucket(entity.hpBucket)];
  if (entity.weapon) brackets.push(`holding ${entity.weapon}`);
  const obs = observations.get(entity.characterId);
  if (obs?.attackedTarget) {
    brackets.push(`attacked ${obs.attackedTarget}`);
  }
  if (obs?.saidText !== undefined) {
    brackets.push(`said "${obs.saidText}"`);
  }
  const rendered = `- ${name}, ${distFragment} [${brackets.join(", ")}]`;
  return {
    tier: 1,
    dist,
    drained: false,
    sortKey: entity.characterId,
    rendered,
  };
}

function renderChestBullet(
  entity: VisibleEntity & { kind: "chest" },
  observerPos: Tile,
): BulletEntry {
  const dist = chebyshev(observerPos, entity.pos);
  const dir = compassDirection(observerPos, entity.pos);
  const distFragment = dir ? `dist ${dist} ${dir}` : `dist ${dist}`;
  const id = renderChestId(entity.objectId);
  const suffix = entity.opened ? " [opened]" : "";
  return {
    tier: 2,
    dist,
    drained: false,
    sortKey: id,
    rendered: `- ${id}, ${distFragment}${suffix}`,
  };
}

function renderCorpseBullet(
  entity: VisibleEntity & { kind: "corpse" },
  observerPos: Tile,
  state: MatchState,
): BulletEntry {
  const dist = chebyshev(observerPos, entity.pos);
  const dir = compassDirection(observerPos, entity.pos);
  const distFragment = dir ? `dist ${dist} ${dir}` : `dist ${dist}`;
  const name = resolveDisplayName(state, entity.objectId);
  const id = `Corpse_${name}`;
  const drained = corpseDrained(entity.contents);
  if (drained) {
    return {
      tier: 2,
      dist,
      drained: true,
      sortKey: id,
      rendered: `- ${id}, ${distFragment} [drained]`,
    };
  }
  const gear: string[] = [];
  if (entity.contents.weapon) gear.push(entity.contents.weapon.name);
  if (entity.contents.armour) gear.push(entity.contents.armour.name);
  if (entity.contents.consumable) gear.push(entity.contents.consumable.name);
  const gearFragment = gear.length > 0 ? ` [${gear.join(" + ")}]` : "";
  return {
    tier: 2,
    dist,
    drained: false,
    sortKey: id,
    rendered: `- ${id}, ${distFragment}${gearFragment}`,
  };
}

function renderCoverBullet(
  entity: VisibleEntity & { kind: "cover" },
  observerPos: Tile,
): BulletEntry {
  const dist = chebyshev(observerPos, entity.pos);
  const dir = compassDirection(observerPos, entity.pos);
  const distFragment = dir ? `dist ${dist} ${dir}` : `dist ${dist}`;
  const id = `Cover_${entity.pos.x}_${entity.pos.y}`;
  return {
    tier: 3,
    dist,
    drained: false,
    sortKey: id,
    rendered: `- ${id}, ${distFragment}`,
  };
}

function renderWallBullet(
  entity: VisibleEntity & { kind: "wall" },
  observerPos: Tile,
): BulletEntry {
  const dist = chebyshev(observerPos, entity.pos);
  const dir = compassDirection(observerPos, entity.pos);
  const distFragment = dir ? `dist ${dist} ${dir}` : `dist ${dist}`;
  const id = `Wall_${entity.pos.x}_${entity.pos.y}`;
  return {
    tier: 4,
    dist,
    drained: false,
    sortKey: id,
    rendered: `- ${id}, ${distFragment}`,
  };
}

function renderEvacBullet(
  observerPos: Tile,
  centre: Tile,
): BulletEntry {
  const dist = chebyshev(observerPos, centre);
  const dir = compassDirection(observerPos, centre);
  const distFragment = dir ? `dist ${dist} ${dir}` : `dist ${dist}`;
  return {
    tier: 5,
    dist,
    drained: false,
    sortKey: "Evac",
    rendered: `- Evac, ${distFragment}`,
  };
}

// ─── Sort + cap ─────────────────────────────────────────────────────────────

/**
 * Comparator implementing ADR §6 sort: tier ASC, then within-tier dist ASC,
 * then drained corpses AFTER non-drained at equal dist (tier 2 only), then
 * sortKey ASC for stable ties.
 *
 * Walls in tier 4 share the tier with cover (tier 3) — we keep walls in
 * tier 4 so they always render after cover regardless of distance, per
 * ADR §5 ("walls last per the cover→walls visual contract").
 */
function bulletComparator(a: BulletEntry, b: BulletEntry): number {
  if (a.tier !== b.tier) return a.tier - b.tier;
  if (a.dist !== b.dist) return a.dist - b.dist;
  // Same dist within same tier: drained AFTER non-drained.
  if (a.drained !== b.drained) return a.drained ? 1 : -1;
  return a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0;
}

/**
 * Build the Visible: section bullets. Implements ADR §6 sort + caps:
 *   - tier 1 (chars) + tier 2 (chests/corpses) share the
 *     `VISIBLE_ENTITY_CAP=8`.
 *   - tier 3 (cover) is unbounded.
 *   - tier 4 (walls) is capped at `WALL_CAP=12` (ADR §5 safety ceiling).
 *   - tier 5 (Evac singleton) is unbounded — at most 1 entry.
 */
function buildVisibleLines(
  state: MatchState,
  observer: CharacterState,
  observations: Map<string, VisibleObservation>,
): string[] {
  const { visible } = computeVisibleEntities(state, observer.characterId);

  // Group by tier so caps can be applied per-tier independently.
  const charBullets: BulletEntry[] = [];
  const lootBullets: BulletEntry[] = [];
  const coverBullets: BulletEntry[] = [];
  const wallBullets: BulletEntry[] = [];

  for (const e of visible) {
    switch (e.kind) {
      case "character":
        charBullets.push(
          renderCharacterBullet(e, observer.pos, state, observations),
        );
        break;
      case "chest":
        lootBullets.push(renderChestBullet(e, observer.pos));
        break;
      case "corpse":
        lootBullets.push(renderCorpseBullet(e, observer.pos, state));
        break;
      case "cover":
        coverBullets.push(renderCoverBullet(e, observer.pos));
        break;
      case "wall":
        wallBullets.push(renderWallBullet(e, observer.pos));
        break;
    }
  }

  // Sort each tier independently then merge with the cross-tier
  // comparator (tier ranks come first, so concat-then-sort is fine).
  const tier1and2 = [...charBullets, ...lootBullets].sort(bulletComparator);
  const cap12 = tier1and2.slice(0, VISIBLE_ENTITY_CAP);
  const cover = coverBullets.sort(bulletComparator);
  const walls = wallBullets.sort(bulletComparator).slice(0, WALL_CAP);

  const merged: BulletEntry[] = [...cap12, ...cover, ...walls];

  // Evac singleton — append once revealed.
  if (state.world.evac.revealedAtTurn !== null) {
    merged.push(renderEvacBullet(observer.pos, state.world.evac.centre));
  }

  return merged.map((b) => b.rendered);
}

// ─── You: line composition ─────────────────────────────────────────────────

/**
 * True iff observer's position is inside the 3×3 evac zone (centre ± 1).
 * Returns false when evac is not yet revealed (the suffix is suppressed
 * before reveal regardless of position).
 */
function observerInEvacZone(
  state: MatchState,
  observer: CharacterState,
): boolean {
  const evac = state.world.evac;
  if (evac.revealedAtTurn === null) return false;
  return (
    Math.abs(observer.pos.x - evac.centre.x) <= EVAC_HALF_SIZE &&
    Math.abs(observer.pos.y - evac.centre.y) <= EVAC_HALF_SIZE
  );
}

function buildYouLine(state: MatchState, observer: CharacterState): string {
  const equipped = renderEquipped(observer);
  const base = `You: at (${observer.pos.x},${observer.pos.y}), ${observer.hp}/${observer.maxHp} HP, ${equipped}`;
  // Evac suffix appears ONLY after reveal; before reveal the suffix is
  // omitted entirely (no "not in evac zone" leakage either).
  if (state.world.evac.revealedAtTurn === null) return base;
  return observerInEvacZone(state, observer)
    ? `${base}, in evac zone`
    : `${base}, not in evac zone`;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Build the per-turn tactical visible-state digest for `characterId`.
 * Plain text (NOT an ASCII grid). Sections (in order):
 *
 *   1. `You: at (X,Y), HP/maxHP, weapon/armour/consumable[, in evac zone]`
 *   2. `Last turn (you): <fragments>` (omitted on turn 1)
 *   3. `Visible:`
 *      - characters (closest first; ties → id ASC)
 *      - chests/corpses (closest first; drained corpses after non-drained
 *        at equal distance) — categories 1+2 share the 8-cap
 *      - cover (closest first; unbounded)
 *      - walls (closest first; capped at 12 — ADR §5 safety ceiling)
 *      - Evac singleton (only after reveal)
 *
 * Defensive contract: if `characterId` is unknown, returns a minimal
 * digest with the You: line skipped (the engine never calls this for
 * unknown ids; the fallback exists for tests).
 */
export function buildVisibleStateDigest(
  state: MatchState,
  characterId: string,
  prev: PrevTurnRow | null,
): string {
  const observer = state.characters.find(
    (c) => c.characterId === characterId,
  );
  if (!observer) {
    return `Visible:`;
  }

  const observations = buildObservationMap(prev);
  const lines: string[] = [];

  // 1. You: line.
  lines.push(buildYouLine(state, observer));

  // 2. Last turn (you):.
  const lastTurnLine = buildLastTurnLine(state, characterId, prev);
  if (lastTurnLine !== null) lines.push(lastTurnLine);

  // 3. Visible:.
  const visibleLines = buildVisibleLines(state, observer, observations);
  lines.push("Visible:");
  for (const line of visibleLines) lines.push(line);

  return lines.join("\n");
}

/**
 * Compose the system prompt + visible-state digest for `callDecisionTool`.
 *
 * The wrapper at `convex/llm/azure.ts` is responsible for joining the
 * persona prompt and scratchpad into the user message via the
 * `## Persona / ## Scratchpad / ## Visible state` section labels — this
 * function returns the raw digest BODY (no section header) so the wrapper
 * doesn't end up double-wrapping.
 *
 * The `personaPromptText` parameter is unused in the current return shape
 * (the wrapper accepts persona separately) but is kept on the signature
 * because the call site already has it in scope.
 */
export function buildAgentInput(
  state: MatchState,
  characterId: string,
  _personaPromptText: string,
  prev: PrevTurnRow | null,
): { systemPrompt: string; visibleStateDigest: string } {
  const visibleStateDigest = buildVisibleStateDigest(state, characterId, prev);
  return {
    systemPrompt: SYSTEM_PROMPT,
    visibleStateDigest,
  };
}

// ─── Helper exports for downstream consumers (tests + report writer) ───────

/** Re-exported for downstream tests/utilities; identifies a corpse with no
 *  remaining loot. */
export function isCorpseDrained(contents: CorpseState["contents"]): boolean {
  return corpseDrained(contents);
}

/** Re-exported equipped-slot type for downstream typed callers. */
export type { EquippedSlots, ItemRef };
