// Phase 02 / WP-C — Decision-as-English summariser.
//
// Pure module — NO I/O, NO mutation. Given a captured `agentRecord` (one
// row from `turns.agentRecords[]`), the surrounding `resolution` (the same
// turn's engine trace), and a `characterById` lookup map, returns a
// triplet:
//
//   - `oneLine`  — collapsed feed-row sentence (terse).
//   - `bullets`  — expanded feed-row, one bullet per "action axis"
//                  (move, action, consume, say, overwatch, scratchpad).
//   - `intentVsOutcome` — `{ intent, outcome }[]`, one pair per intent.
//                  This is the explainability centerpiece per
//                  north-star §11: the LLM's stated intent next to the
//                  engine's actual outcome.
//
// Vocabulary is locked by ADR §5 (architecture-decisions.md). Result-string
// canonical source is `convex/engine/resolution.ts:374-586` (D-P2-14 — NOT
// `harness/analyze-match.ts:49-58` which is stale).
//
// Slice-boundary rule (architecture §1 / pillar 7): types-only across the
// boundary. We read `Doc<"turns">["resolution"]` and
// `Doc<"turns">["agentRecords"][number]` via `convex/_generated/dataModel`
// and never import runtime values from `convex/engine/*`.

import type { Doc, Id } from "../../../../convex/_generated/dataModel";

// ─────────────────────────────────────────────────────────────────────────────
// Re-exported type shapes (keeps consumers from re-deriving them).
// ─────────────────────────────────────────────────────────────────────────────

export type AgentRecord = Doc<"turns">["agentRecords"][number];
export type TurnResolution = Doc<"turns">["resolution"];
export type ParsedDecision = AgentRecord["decision"];
export type ResolutionAction = TurnResolution["actions"][number];
export type ResolutionMove = TurnResolution["moves"][number];
export type ResolutionConsume = TurnResolution["consumed"][number];

export type DecisionSummary = {
  oneLine: string;
  bullets: string[];
  intentVsOutcome: Array<{ intent: string; outcome: string }>;
};

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Render an `agentRecord.decision` plus the matching engine `resolution` in
 * plain English. Pure: same input → same output.
 *
 * The `characterById` map resolves `Id<"characters">` references in
 * `decision.move`/`decision.action`/`resolution.actions[]` to displayName
 * strings ("Player_5"). Unknown ids fall back to a truncated id rather
 * than throwing — historical bundles are immutable, so an unknown id is a
 * *signal* (e.g. the target was filtered out of `bundle.characters`), not a
 * crash.
 */
export function summariseDecision(
  agentRecord: AgentRecord,
  resolution: TurnResolution,
  characterById: Map<Id<"characters">, Doc<"characters">>,
): DecisionSummary {
  const me = agentRecord.characterId;
  const decision = agentRecord.decision;

  // ── 1) Render move (intent + outcome) ──────────────────────────────────
  const moveIntent = renderMoveIntent(decision, characterById);
  const moveOutcome = renderMoveOutcome(resolution, me);

  // ── 2) Render action (intent + outcome). Outcome handles death suffix. ─
  const actionIntent = renderActionIntent(decision, characterById);
  const actionEntry = findActionEntry(resolution, me);
  const actionOutcome = actionEntry
    ? renderActionOutcome(actionEntry, resolution, characterById)
    : null;

  // Overwatch fire (resolution.actions[] entry with kind="overwatch") is
  // emitted separately from the decision.action (the agent's primary mode
  // is "overwatch", and the engine fires opportunistically). Surface it in
  // its own intentVsOutcome pair.
  const overwatchFireEntry = findOverwatchFireEntry(resolution, me);
  const overwatchFireOutcome = overwatchFireEntry
    ? renderActionOutcome(overwatchFireEntry, resolution, characterById)
    : null;

  // ── 3) Consume ────────────────────────────────────────────────────────
  const consumeIntent = renderConsumeIntent(decision);
  const consumeEntry = resolution.consumed.find((c) => c.characterId === me);
  const consumeOutcome = consumeEntry
    ? renderConsumeOutcome(consumeEntry)
    : null;

  // ── 4) Say + overwatch_priority ───────────────────────────────────────
  const sayClause = decision.say ? `Said: "${decision.say}"` : null;
  const overwatchClause = decision.overwatch_priority
    ? `Watching for: ${decision.overwatch_priority}`
    : null;
  const overwatchMode = decision.primary === "overwatch";

  // ── 5) Scratchpad delta ───────────────────────────────────────────────
  const scratchpadDelta = renderScratchpadDelta(
    agentRecord.input.scratchpadBefore,
    decision.scratchpad_update,
  );

  // ── Compose oneLine ────────────────────────────────────────────────────
  // Prefix overwatch glyph token if primary === "overwatch" so the feed
  // can render an icon regardless of priority null-state.
  const oneLineParts: string[] = [];
  if (overwatchMode) oneLineParts.push("[Overwatch]");
  oneLineParts.push(moveIntent);
  if (actionIntent) {
    if (actionOutcome) {
      oneLineParts.push(`${actionIntent} — ${actionOutcome}`);
    } else {
      oneLineParts.push(actionIntent);
    }
  }
  if (consumeOutcome) {
    // We render the outcome (which mirrors the intent for consumes — both
    // are "Drank heal potion") so the user sees the realised effect.
    oneLineParts.push(consumeOutcome);
  }
  if (overwatchClause) oneLineParts.push(overwatchClause);
  if (sayClause) oneLineParts.push(sayClause);

  const oneLine = oneLineParts.filter((p) => p.length > 0).join(". ") +
    (oneLineParts.length > 0 ? "." : "");

  // ── Compose bullets ────────────────────────────────────────────────────
  const bullets: string[] = [];
  if (overwatchMode) bullets.push("[Overwatch]");
  bullets.push(`Move: ${moveIntent}`);
  if (actionIntent) {
    bullets.push(
      actionOutcome ? `Action: ${actionIntent} — ${actionOutcome}` : `Action: ${actionIntent}`,
    );
  }
  if (overwatchFireOutcome) {
    bullets.push(`Overwatch fire: ${overwatchFireOutcome}`);
  }
  bullets.push(`Consume: ${consumeOutcome ?? consumeIntent}`);
  if (overwatchClause) bullets.push(overwatchClause);
  if (sayClause) bullets.push(sayClause);
  if (scratchpadDelta) bullets.push(scratchpadDelta);

  // ── Compose intentVsOutcome ────────────────────────────────────────────
  const intentVsOutcome: Array<{ intent: string; outcome: string }> = [];
  intentVsOutcome.push({
    intent: moveIntent,
    outcome: moveOutcome ?? "(no movement)",
  });
  if (actionIntent) {
    intentVsOutcome.push({
      intent: actionIntent,
      outcome: actionOutcome ?? "(no resolution)",
    });
  }
  if (overwatchFireOutcome) {
    intentVsOutcome.push({
      intent: "[Overwatch fire]",
      outcome: overwatchFireOutcome,
    });
  }
  if (decision.consume !== "none" || consumeOutcome) {
    intentVsOutcome.push({
      intent: consumeIntent,
      outcome: consumeOutcome ?? "(not realised)",
    });
  }

  return { oneLine, bullets, intentVsOutcome };
}

// ─────────────────────────────────────────────────────────────────────────────
// Internals — move
// ─────────────────────────────────────────────────────────────────────────────

const COMPASS_TABLE: Record<string, string> = {
  // key: `${signX}_${signY}` where sign ∈ {-1,0,1}.
  // Convention: positive y = south (screen-down).
  "0_-1": "north",
  "1_-1": "northeast",
  "1_0": "east",
  "1_1": "southeast",
  "0_1": "south",
  "-1_1": "southwest",
  "-1_0": "west",
  "-1_-1": "northwest",
};

function sign(n: number): -1 | 0 | 1 {
  if (n > 0) return 1;
  if (n < 0) return -1;
  return 0;
}

function renderMoveIntent(
  decision: ParsedDecision,
  characterById: Map<Id<"characters">, Doc<"characters">>,
): string {
  const m = decision.move;
  switch (m.kind) {
    case "none":
      return "Stayed put";
    case "relative": {
      const sx = sign(m.dx);
      const sy = sign(m.dy);
      if (sx === 0 && sy === 0) return "Stayed put";
      const dir = COMPASS_TABLE[`${sx}_${sy}`] ?? "?";
      const n = Math.max(Math.abs(m.dx), Math.abs(m.dy));
      // Pluralization (closure-readiness UAT ISSUE-001 round 2): "Moved 1
      // tiles" reads as a typo and erodes the explainability vibe; agree
      // the noun with the chebyshev count.
      const tileWord = n === 1 ? "tile" : "tiles";
      return `Moved ${n} ${tileWord} ${dir}`;
    }
    case "toward_entity": {
      const name = resolveCharacterName(
        m.targetCharacterId as Id<"characters">,
        characterById,
      );
      return `Moved toward ${name}`;
    }
    case "away_from_entity": {
      const name = resolveCharacterName(
        m.targetCharacterId as Id<"characters">,
        characterById,
      );
      return `Moved away from ${name}`;
    }
    case "toward_object":
      return `Moved toward ${m.targetObjectId}`;
    case "toward_evac":
      return "Moved toward evac";
    default: {
      // Exhaustiveness guard. Should be unreachable.
      const _exhaustive: never = m;
      void _exhaustive;
      return "(unknown move)";
    }
  }
}

function renderMoveOutcome(
  resolution: TurnResolution,
  me: Id<"characters">,
): string | null {
  const entry = resolution.moves.find((m) => m.characterId === me);
  if (!entry) return null;
  return `(${entry.from.x},${entry.from.y}) → (${entry.to.x},${entry.to.y})`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internals — action
// ─────────────────────────────────────────────────────────────────────────────

function renderActionIntent(
  decision: ParsedDecision,
  characterById: Map<Id<"characters">, Doc<"characters">>,
): string | null {
  const a = decision.action;
  switch (a.kind) {
    case "none":
      return null;
    case "attack": {
      const name = resolveCharacterName(
        a.targetCharacterId as Id<"characters">,
        characterById,
      );
      return `Attacked ${name}`;
    }
    case "interact":
      return `Interacted with ${a.targetObjectId}`;
    case "loot": {
      const name = resolveCharacterName(
        a.targetCorpseId as Id<"characters">,
        characterById,
      );
      return `Looted from corpse-of-${name}`;
    }
    default: {
      const _exhaustive: never = a;
      void _exhaustive;
      return null;
    }
  }
}

/**
 * Find the actor's entry in `resolution.actions[]`. We pick the FIRST
 * non-overwatch entry for the actor — overwatch fire (kind="overwatch")
 * is rendered as a separate intentVsOutcome pair via
 * `findOverwatchFireEntry`.
 */
function findActionEntry(
  resolution: TurnResolution,
  me: Id<"characters">,
): ResolutionAction | null {
  for (const a of resolution.actions) {
    if (a.characterId === me && a.kind !== "overwatch") return a;
  }
  return null;
}

function findOverwatchFireEntry(
  resolution: TurnResolution,
  me: Id<"characters">,
): ResolutionAction | null {
  for (const a of resolution.actions) {
    if (a.characterId === me && a.kind === "overwatch") return a;
  }
  return null;
}

/**
 * Convert a `resolution.actions[]` entry into the user-facing outcome
 * fragment, applying the death-detection suffix where applicable.
 *
 * Vocabulary table (D-P2-14, ADR §5 — canonical source
 * `convex/engine/resolution.ts:374-586`):
 *
 *   attack    | "dmg N"           → "hit (dealt N damage)" + maybe killed-suffix
 *   attack    | "no_target"       → "target not found"
 *   attack    | "out_of_range"    → "out of range"
 *   interact  | "opened"          → "opened"
 *   interact  | "already_opened"  → "already opened"
 *   interact  | "no_chest"        → "chest not found"
 *   interact  | "out_of_range"    → "out of range"
 *   loot      | "looted"          → "looted"
 *   loot      | "no_corpse"       → "corpse not found"
 *   loot      | "out_of_range"    → "out of range"
 *   overwatch | "dmg N"           → "overwatch fire (dealt N damage)"
 *
 * Anything else → "(unknown result: <raw>)" so future engine extensions
 * surface as visible TODOs, not silent omissions.
 */
function renderActionOutcome(
  entry: ResolutionAction,
  resolution: TurnResolution,
  characterById: Map<Id<"characters">, Doc<"characters">>,
): string {
  const { kind, result, target } = entry;
  // Numeric damage template — handle attack and overwatch.
  const dmgMatch = /^dmg (\d+)$/.exec(result);

  if (kind === "attack") {
    if (dmgMatch) {
      const n = Number.parseInt(dmgMatch[1]!, 10);
      let s = `hit (dealt ${n} damage)`;
      // Death detection: if the target id appears in resolution.deaths[]
      // for the same turn, append " — killed <displayName>". Per WP-C
      // contract, this fires for any attacker whose attack outcome lands
      // on a dying target on the same turn (the engine doesn't surface
      // last-blow attribution; users can read deaths[] for the full
      // picture). v0 simplification.
      const targetId = target as Id<"characters">;
      if (resolution.deaths.includes(targetId)) {
        const name = resolveCharacterName(targetId, characterById);
        s += ` — killed ${name}`;
      }
      return s;
    }
    if (result === "no_target") return "target not found";
    if (result === "out_of_range") return "out of range";
    return `(unknown result: ${result})`;
  }

  if (kind === "interact") {
    if (result === "opened") return "opened";
    if (result === "already_opened") return "already opened";
    if (result === "no_chest") return "chest not found";
    if (result === "out_of_range") return "out of range";
    return `(unknown result: ${result})`;
  }

  if (kind === "loot") {
    if (result === "looted") return "looted";
    if (result === "no_corpse") return "corpse not found";
    if (result === "out_of_range") return "out of range";
    return `(unknown result: ${result})`;
  }

  if (kind === "overwatch") {
    if (dmgMatch) {
      const n = Number.parseInt(dmgMatch[1]!, 10);
      return `overwatch fire (dealt ${n} damage)`;
    }
    return `(unknown result: ${result})`;
  }

  // Unrecognised kind. Future engine extensions surface as visible TODOs.
  return `(unknown result: ${result})`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internals — consume
// ─────────────────────────────────────────────────────────────────────────────

function renderConsumeIntent(decision: ParsedDecision): string {
  switch (decision.consume) {
    case "none":
      return "(no consumable)";
    case "heal":
      return "Drank heal potion";
    case "speed":
      return "Drank speed potion";
    default: {
      const _exhaustive: never = decision.consume;
      void _exhaustive;
      return "(no consumable)";
    }
  }
}

function renderConsumeOutcome(entry: ResolutionConsume): string {
  // The resolution.consumed[] entry always carries an item with
  // `category:"consumable"` and `name` ∈ {"heal","speed"} per
  // schema.ts:126-129. Render it identically to the intent — the user
  // just needs to see the realised effect.
  const item = entry.item;
  if (item.category === "consumable") {
    if (item.name === "heal") return "Drank heal potion";
    if (item.name === "speed") return "Drank speed potion";
  }
  return "(consumed unknown)";
}

// ─────────────────────────────────────────────────────────────────────────────
// Internals — scratchpad
// ─────────────────────────────────────────────────────────────────────────────

const SCRATCHPAD_BULLET_MAX = 120;

function renderScratchpadDelta(
  before: string,
  update: string | null,
): string | null {
  // null update → treated as "no change" (the agent didn't propose an
  // update). Per ADR §5 — "if `scratchpad_update` differs from
  // `scratchpadBefore`, include a truncated diff line. If identical, omit."
  if (update === null) return null;
  if (update === before) return null;

  // Truncate the after-text to ~120 chars total budget for the bullet so
  // the side-panel feed row stays compact. Full text lives in the expand
  // modal.
  const prefix = "Scratchpad: ";
  const budget = SCRATCHPAD_BULLET_MAX - prefix.length;
  const trimmed =
    update.length > budget ? update.slice(0, Math.max(0, budget - 1)) + "…" : update;
  return prefix + trimmed;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internals — character name resolution
// ─────────────────────────────────────────────────────────────────────────────

function resolveCharacterName(
  id: Id<"characters">,
  characterById: Map<Id<"characters">, Doc<"characters">>,
): string {
  const c = characterById.get(id);
  if (c) return c.displayName;
  // Unknown id → truncate to 8 chars to stay readable. This is a *signal*,
  // not a crash — historical bundles are immutable; an unknown id usually
  // means the target was filtered from `bundle.characters` (e.g. a corpse
  // id in an old replay where the corpse character row was archived).
  const raw = String(id);
  return raw.length > 8 ? raw.slice(0, 8) : raw;
}
