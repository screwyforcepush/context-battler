// WP8 — per-turn agent input builder.
//
// Produces the **tactical visible-state digest** described by concept-spec
// §7 (NOT an ASCII tile dump — `mental-model.md` §10 calls this out as the
// load-bearing prompt-economy rule). Composed with the static system prompt
// from `./systemPrompt.js` to form the LLM's per-turn input alongside the
// persona body and scratchpad (which the wrapper at `convex/llm/azure.ts`
// joins under `## Persona / ## Scratchpad / ## Visible state` headers).
//
// Locked digest-section caps (work-packages.md WP8 + acceptance):
//   - **Visible entities:** max 8, sorted by Chebyshev distance ascending.
//     Cover tiles share the 8-cap with characters/chests/corpses.
//   - **Heard messages:** max 5 — input is the previous turn's filtered
//     speech list (WP10 owns the hearing-range filter; this builder just
//     renders whatever it's handed). Oldest-first eviction.
//   - **Last-known positions:** max 3 (WP5 already caps at 3; this is the
//     defensive rendering cap for forward-compat).
//   - **Affordances:** uncapped — `localAffordances()` already pre-bounds
//     them via the cover-affordance cap (WP5).
//
// Token-count proxy. We use **`chars / 4`** as a deterministic, install-free
// proxy for tiktoken token counts. Rationale (mirrors WP9 `personas.test.ts`
// header-note + `de-risking.md` "WP8 fallback proxy"):
//   - `tiktoken` ships native bindings; introducing it in WP8 risks install
//     pain on Convex/Vitest + adds maintenance surface for a single test.
//   - `chars / 4` is the canonical Anthropic/OpenAI public-doc heuristic for
//     English text.
//   - The ≤ 1 200-token total budget is a tuning constraint; a slightly
//     conservative proxy is preferable to an exact-but-fragile dependency.
//
// Boundary (ADR §1): pure-function module; no Convex imports, no
// `convex/_generated/` access, no `fetch`. Consumed by:
//   - WP10 (`runMatch.advanceTurn`) — calls `buildAgentInput(state, charId,
//     personaText, heardLastTurn)` once per living agent, persists
//     `visibleStateDigest` + `systemPromptText` per-turn for ADR §7 trace
//     introspection.
//
// Cross-references:
//   - concept-spec.md §7 (vision example), §8 (per-turn input list),
//     §16 (speech), §22 (affordances).
//   - work-packages.md WP8 (lines 217-262).
//   - architecture-decisions.md §7 (`agentRecords[].input.visibleStateDigest`).

import { chebyshev } from "../engine/distance.js";
import { computeVisibleEntities } from "../engine/vision.js";
import { localAffordances } from "../engine/affordances.js";
import type {
  CharacterState,
  HeardSpeech,
  LastKnownEntry,
  MatchState,
  Tile,
  VisibleEntity,
} from "../engine/types.js";
import { SYSTEM_PROMPT } from "./systemPrompt.js";

// ─── Caps (locked per WP8 acceptance) ───────────────────────────────────────

const VISIBLE_ENTITY_CAP = 8;
const HEARD_CAP = 5;
const LAST_KNOWN_CAP = 3;
/** Default movement budget (concept-spec §4) — used to estimate evac turns
 *  on the rendered Evac: line. Speed consumable doubles this on the consuming
 *  turn but it isn't representative of "direct" turns to evac. */
const DEFAULT_MOVEMENT = 8;

// ─── Direction (8-octant compass) ───────────────────────────────────────────

/**
 * 8-octant compass bearing from `from` to `to`. Coordinate system is
 * `(0,0)` top-left, x→east, y→south (per types.ts), so a target with
 * `dy < 0` is north and `dx > 0` is east. Returns one of N / NE / E / SE
 * / S / SW / W / NW. Same-tile returns `""` (caller renders nothing).
 *
 * Bucketing rule: if either |dx| or |dy| dominates by ≥ 2× the other,
 * pick the cardinal; otherwise pick the diagonal. This keeps NE meaningful
 * (12 east + 5 north reads as ENE → "NE" in the 8-octant scheme).
 */
function compassDirection(from: Tile, to: Tile): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return "";
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  // Dominant-axis: cardinal if one axis ≥ 2× the other.
  if (absX >= 2 * absY) return dx > 0 ? "E" : "W";
  if (absY >= 2 * absX) return dy > 0 ? "S" : "N";
  // Otherwise diagonal.
  if (dx > 0 && dy > 0) return "SE";
  if (dx > 0 && dy < 0) return "NE";
  if (dx < 0 && dy > 0) return "SW";
  return "NW";
}

// ─── Equipped slot rendering ────────────────────────────────────────────────

/**
 * Render the agent's equipped slots as `weapon / armour / consumable`,
 * substituting `—` (em-dash) for empty slots. Consumed by the Equipped:
 * line of the digest.
 */
function renderEquipped(actor: CharacterState): string {
  const w = actor.equipped.weapon?.name ?? "—";
  const a = actor.equipped.armour?.name ?? "—";
  const c = actor.equipped.consumable?.name ?? "—";
  return `${w} / ${a} / ${c}`;
}

// ─── Visible entity → bullet line ───────────────────────────────────────────

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
 * Render one `VisibleEntity` as a digest bullet. Mirrors the §7 example:
 *   - `Player_3, dist 12 NE, HP~mid, holding sword`
 *   - `Chest chest_002, dist 6 W`
 *   - `Corpse Player_5, dist 9 S, axe + leather`
 *   - `Cover at (28,32), dist 4 NW`
 */
function renderVisibleBullet(
  entity: VisibleEntity,
  observerPos: Tile,
  state: MatchState,
): string {
  const dist = chebyshev(observerPos, entityPos(entity));
  const dir = compassDirection(observerPos, entityPos(entity));
  const distFragment = dir ? `dist ${dist} ${dir}` : `dist ${dist}`;
  switch (entity.kind) {
    case "character": {
      const name = resolveDisplayName(state, entity.characterId);
      const parts: string[] = [name, distFragment, `HP~${entity.hpBucket}`];
      if (entity.weapon) parts.push(`holding ${entity.weapon}`);
      return `- ${parts.join(", ")}`;
    }
    case "chest": {
      // WP10.5 Pass B.2 — append `[opened]` marker for chests that have
      // already been opened. The chest stays in the digest so the model
      // retains last-known-position memory (concept-spec §13 — chests are
      // one-shot but their *presence* is durable map information), but the
      // marker flags it as no-longer-actionable so personas don't keep
      // emitting `interact: <chestId>` against it. Phase A finding —
      // `wp10-5-phase-a-findings.md` Bucket 2 (62.2% of fallbacks).
      const openedSuffix = entity.opened ? " [opened]" : "";
      return `- Chest ${entity.objectId}, ${distFragment}${openedSuffix}`;
    }
    case "corpse": {
      const name = resolveDisplayName(state, entity.objectId);
      const gear: string[] = [];
      if (entity.contents.weapon) gear.push(entity.contents.weapon.name);
      if (entity.contents.armour) gear.push(entity.contents.armour.name);
      if (entity.contents.consumable)
        gear.push(entity.contents.consumable.name);
      const gearFragment = gear.length > 0 ? `, ${gear.join(" + ")}` : "";
      return `- Corpse ${name}, ${distFragment}${gearFragment}`;
    }
    case "cover": {
      return `- Cover at (${entity.pos.x},${entity.pos.y}), ${distFragment}`;
    }
    case "wall": {
      // Walls aren't currently emitted by `computeVisibleEntities` (per
      // vision.ts head-note) but we handle the discriminant exhaustively.
      return `- Wall at (${entity.pos.x},${entity.pos.y}), ${distFragment}`;
    }
  }
}

function entityPos(entity: VisibleEntity): Tile {
  return entity.pos;
}

// ─── Section builders ───────────────────────────────────────────────────────

/**
 * Build the Visible: section bullets. Caps at `VISIBLE_ENTITY_CAP` after
 * sorting by Chebyshev distance ascending. Cover tiles share the 8-cap
 * with characters/chests/corpses — the closest 8 by distance always win.
 */
function buildVisibleLines(
  state: MatchState,
  observer: CharacterState,
): string[] {
  const { visible } = computeVisibleEntities(state, observer.characterId);
  const sorted = [...visible].sort(
    (a, b) =>
      chebyshev(observer.pos, entityPos(a)) -
      chebyshev(observer.pos, entityPos(b)),
  );
  const capped = sorted.slice(0, VISIBLE_ENTITY_CAP);
  return capped.map((e) => renderVisibleBullet(e, observer.pos, state));
}

/**
 * Build the Heard (last turn): section bullets. Caps at `HEARD_CAP` with
 * oldest-first eviction (the input list is already in chronological order
 * — per WP10's intended emit shape — so we keep the LAST `HEARD_CAP`
 * entries). Speaker IDs resolve to displayNames where possible.
 */
function buildHeardLines(
  state: MatchState,
  heard: readonly HeardSpeech[],
): string[] {
  const capped = heard.slice(-HEARD_CAP);
  return capped.map((entry) => {
    const name = resolveDisplayName(state, entry.speakerId);
    return `- ${name}: "${entry.text}"`;
  });
}

/**
 * Build the Last-known: section bullets. Caps at `LAST_KNOWN_CAP` with
 * oldest-first eviction (sort by `atTurn` ascending → keep the last 3).
 * Renders position + observed turn + age (turns ago) per §7's example
 * (`Player_2 at (15,18), turn 4 (3 turns ago)`).
 */
function buildLastKnownLines(
  state: MatchState,
  observer: CharacterState,
  currentTurn: number,
): string[] {
  if (observer.lastKnown.length === 0) return [];
  // Sort ascending by `atTurn` (oldest first), then keep the last 3.
  const sorted = [...observer.lastKnown].sort(
    (a: LastKnownEntry, b: LastKnownEntry) => a.atTurn - b.atTurn,
  );
  const capped = sorted.slice(-LAST_KNOWN_CAP);
  return capped.map((entry: LastKnownEntry) => {
    const name = resolveDisplayName(state, entry.characterId);
    const age = currentTurn - entry.atTurn;
    return `- ${name} at (${entry.pos.x},${entry.pos.y}), turn ${entry.atTurn} (${age} turns ago)`;
  });
}

/**
 * Build the Evac: section bullets. Returns an empty list when evac is
 * still hidden (`revealedAtTurn === null`). Once revealed, renders the
 * reveal turn, centre, distance, and an estimated turns-to-evac under
 * the default 8-tile movement budget.
 */
function buildEvacLines(state: MatchState, observer: CharacterState): string[] {
  const evac = state.world.evac;
  if (evac.revealedAtTurn === null) return [];
  const dist = chebyshev(observer.pos, evac.centre);
  const dir = compassDirection(observer.pos, evac.centre);
  const est = Math.ceil(dist / DEFAULT_MOVEMENT);
  const distFragment = dir ? `dist ${dist} ${dir}` : `dist ${dist}`;
  return [
    `- Revealed at turn ${evac.revealedAtTurn}, centre at (${evac.centre.x},${evac.centre.y}), ${distFragment}, est ${est} turns`,
  ];
}

/**
 * Build the Affordances: section bullets. Renders two lines —
 * `- movement: ...` and `- actions: ...` — joining each list with commas.
 * Empty lists produce a bullet whose body is empty (e.g. `- movement: `);
 * callers should normally have at least `to relative tile` / `overwatch`
 * by virtue of `localAffordances()` adding them unconditionally for living
 * agents.
 */
function buildAffordanceLines(
  state: MatchState,
  characterId: string,
): string[] {
  const aff = localAffordances(state, characterId);
  return [
    `- movement: ${aff.movement.join(", ")}`,
    `- actions: ${aff.actions.join(", ")}`,
  ];
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Build the per-turn tactical visible-state digest for `characterId`.
 * Plain text (NOT an ASCII grid — see concept-spec.md §7 example), terse,
 * mirroring §7 closely. Sections (in order):
 *
 *   1. `Turn: N/50`
 *   2. `You are at X/100 HP.`
 *   3. `Equipped: weapon / armour / consumable`
 *   4. `Visible:` ≤ 8 bullets (Chebyshev-ascending)
 *   5. `Heard (last turn):` ≤ 5 bullets (omit section when empty)
 *   6. `Last-known:` ≤ 3 bullets (omit section when empty)
 *   7. `Evac:` 1 bullet (omit section before evac.revealedAtTurn)
 *   8. `Affordances:` 2 bullets (`movement:` + `actions:`)
 *
 * Defensive contract: if `characterId` is unknown, returns a minimal
 * digest with `Turn: N/50` only (the engine should never reach this
 * branch — WP10 only calls for living characters — but the function
 * does not throw).
 */
export function buildVisibleStateDigest(
  state: MatchState,
  characterId: string,
  heardLastTurn: HeardSpeech[],
): string {
  const observer = state.characters.find(
    (c) => c.characterId === characterId,
  );
  if (!observer) {
    return `Turn: ${state.turn}/50`;
  }

  const lines: string[] = [];

  // 1. Turn line.
  lines.push(`Turn: ${state.turn}/50`);
  // 2. Self HP — exact, not bucketed (the agent IS itself; bucketing buys
  //    nothing here and obscures the heal/no-heal decision).
  lines.push(`You are at ${observer.hp}/${observer.maxHp} HP.`);
  // 3. Equipped slots.
  lines.push(`Equipped: ${renderEquipped(observer)}`);

  // 4. Visible.
  const visibleLines = buildVisibleLines(state, observer);
  lines.push("Visible:");
  for (const line of visibleLines) lines.push(line);

  // 5. Heard — only emit the section header when there's at least one
  //    rendered line. An empty Heard section is noise.
  const heardLines = buildHeardLines(state, heardLastTurn);
  if (heardLines.length > 0) {
    lines.push("Heard (last turn):");
    for (const line of heardLines) lines.push(line);
  }

  // 6. Last-known — same suppress-when-empty rule.
  const lastKnownLines = buildLastKnownLines(state, observer, state.turn);
  if (lastKnownLines.length > 0) {
    lines.push("Last-known:");
    for (const line of lastKnownLines) lines.push(line);
  }

  // 7. Evac — suppressed before reveal.
  const evacLines = buildEvacLines(state, observer);
  if (evacLines.length > 0) {
    lines.push("Evac:");
    for (const line of evacLines) lines.push(line);
  }

  // 8. Affordances — always emitted (movement + actions lines).
  lines.push("Affordances:");
  for (const line of buildAffordanceLines(state, characterId)) {
    lines.push(line);
  }

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
 * because WP10's call site already has it in scope and a future revision
 * may inline persona-specific framing.
 */
export function buildAgentInput(
  state: MatchState,
  characterId: string,
  _personaPromptText: string,
  heardLastTurn: HeardSpeech[],
): { systemPrompt: string; visibleStateDigest: string } {
  const visibleStateDigest = buildVisibleStateDigest(
    state,
    characterId,
    heardLastTurn,
  );
  return {
    systemPrompt: SYSTEM_PROMPT,
    visibleStateDigest,
  };
}
