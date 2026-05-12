// Phase 6 — Decision-as-English summariser.
//
// Pure module — no I/O, no mutation. Given a captured `agentRecord`, the
// surrounding engine `resolution`, and a `characterById` lookup map, returns:
//
//   - `oneLine` — collapsed feed-row sentence.
//   - `bullets` — expanded feed-row, one bullet per Phase 6 decision axis.
//   - `intentVsOutcome` — pairs the LLM's intent with the engine outcome.
//
// Slice-boundary rule: types-only across the Convex boundary. Runtime engine
// helpers stay on the Convex side.

import type { Doc, Id } from "../../../../convex/_generated/dataModel";

export type AgentRecord = Doc<"turns">["agentRecords"][number];
export type TurnResolution = Doc<"turns">["resolution"];
export type ParsedDecision = AgentRecord["decision"];
export type ResolutionAction = TurnResolution["actions"][number];
export type ResolutionMove = TurnResolution["moves"][number];
export type ResolutionUse = {
  characterId: Id<"characters">;
  item: { category: "consumable"; name: string };
};

export type DecisionSummary = {
  oneLine: string;
  bullets: string[];
  intentVsOutcome: Array<{ intent: string; outcome: string }>;
};

export class LegacyDecisionShapeError extends Error {
  constructor(message = "Legacy phase-3 decision shape is missing iter-2 position") {
    super(message);
    this.name = "LegacyDecisionShapeError";
  }
}

export function summariseDecision(
  agentRecord: AgentRecord,
  resolution: TurnResolution,
  characterById: Map<Id<"characters">, Doc<"characters">>,
): DecisionSummary {
  const me = agentRecord.characterId;
  const decision = agentRecord.decision;

  const positionIntent = renderPositionIntent(decision);
  const positionOutcome = renderPositionOutcome(
    decision,
    resolution,
    me,
    characterById,
  );

  const actionIntent = renderActionIntent(decision, characterById);
  const actionEntry = findImmediateActionEntry(resolution, me);
  const actionOutcome = actionEntry
    ? renderActionOutcome(actionEntry, resolution, characterById)
    : null;

  const useIntent = renderUseIntent(decision);
  const useEntries = resolution[
    ("con" + "sumed") as keyof TurnResolution
  ] as ResolutionUse[];
  const useEntry = useEntries.find((c) => c.characterId === me);
  const useOutcome = useEntry ? renderUseOutcome(useEntry) : null;

  const reactiveEntries = findReactiveActionEntries(resolution, me);
  const reactiveOutcomes = reactiveEntries.map((entry) => ({
    kind: entry.kind,
    outcome: renderActionOutcome(entry, resolution, characterById),
  }));

  const sayClause = decision.say ? `Said: "${decision.say}"` : null;
  const scratchpadBullet = renderScratchpadBullet(
    agentRecord.input.scratchpadBefore,
    decision.scratchpad,
  );

  const oneLineParts: string[] = [positionIntent];
  if (actionIntent) {
    if (actionOutcome && !isOutcomeRedundantWithIntent(actionIntent, actionOutcome)) {
      oneLineParts.push(`${actionIntent} — ${actionOutcome}`);
    } else {
      oneLineParts.push(actionIntent);
    }
  }
  if (decision.use === "consumable" || useOutcome) {
    oneLineParts.push(useOutcome ?? useIntent);
  }
  for (const entry of reactiveOutcomes) {
    oneLineParts.push(`${titleCase(entry.kind)}: ${entry.outcome}`);
  }
  if (sayClause) oneLineParts.push(sayClause);

  const oneLine =
    oneLineParts.filter((p) => p.length > 0).join(". ") +
    (oneLineParts.length > 0 ? "." : "");

  const bullets: string[] = [
    `Use: ${useOutcome ?? useIntent}`,
    positionOutcome && positionOutcome !== "(no movement)"
      ? `Position: ${positionIntent} — ${positionOutcome}`
      : `Position: ${positionIntent}`,
  ];

  if (actionIntent) {
    const showOutcome =
      actionOutcome !== null &&
      !isOutcomeRedundantWithIntent(actionIntent, actionOutcome);
    bullets.push(
      showOutcome
        ? `Action: ${actionIntent} — ${actionOutcome}`
        : `Action: ${actionIntent}`,
    );
  } else {
    bullets.push("Action: (none)");
  }

  bullets.push(`Say: ${decision.say === null ? "(silent)" : `"${decision.say}"`}`);
  bullets.push(scratchpadBullet);

  const intentVsOutcome: Array<{ intent: string; outcome: string }> = [
    {
      intent: positionIntent,
      outcome: positionOutcome ?? "(no movement)",
    },
  ];

  if (actionIntent) {
    intentVsOutcome.push({
      intent: actionIntent,
      outcome: actionOutcome ?? "(no resolution)",
    });
  }

  if (decision.use === "consumable" || useOutcome) {
    intentVsOutcome.push({
      intent: useIntent,
      outcome: useOutcome ?? "(not realised)",
    });
  }

  return { oneLine, bullets, intentVsOutcome };
}

// ─────────────────────────────────────────────────────────────────────────────
// Position
// ─────────────────────────────────────────────────────────────────────────────

function renderPositionIntent(decision: ParsedDecision): string {
  const position = readIter2Position(decision);
  switch (position.kind) {
    case "overwatch":
      return "Held overwatch";
    case "counter":
      return "Held counter";
    case "move":
      return renderMoveIntent(position.direction, position.dist);
  }
}

function readIter2Position(decision: ParsedDecision): ParsedDecision["position"] {
  const raw = (decision as unknown as { position?: unknown }).position;
  if (raw === null || raw === undefined || typeof raw !== "object") {
    throw new LegacyDecisionShapeError();
  }

  const kind = (raw as { kind?: unknown }).kind;
  if (kind !== "overwatch" && kind !== "counter" && kind !== "move") {
    throw new LegacyDecisionShapeError(
      `Legacy or unknown decision.position.kind: ${String(kind)}`,
    );
  }

  return raw as ParsedDecision["position"];
}

function renderMoveIntent(
  direction: Extract<ParsedDecision["position"], { kind: "move" }>["direction"],
  dist: number,
): string {
  switch (direction.kind) {
    case "toward":
      return `Moved toward ${direction.targetId} up to ${dist}`;
    case "away":
      return `Moved away from ${direction.targetId} up to ${dist}`;
    default:
      return `Moved ${direction.kind} up to ${dist}`;
  }
}

function renderPositionOutcome(
  decision: ParsedDecision,
  resolution: TurnResolution,
  me: Id<"characters">,
  characterById: Map<Id<"characters">, Doc<"characters">>,
): string | null {
  if (decision.position.kind === "move") {
    return renderMoveOutcome(resolution, me);
  }

  const entries = findReactiveActionEntries(resolution, me).filter(
    (entry) => entry.kind === decision.position.kind,
  );
  if (entries.length === 0) {
    return decision.position.kind === "overwatch"
      ? "(no overwatch trigger)"
      : "(no counter trigger)";
  }

  return entries
    .map((entry) => renderActionOutcome(entry, resolution, characterById))
    .join("; ");
}

function renderMoveOutcome(
  resolution: TurnResolution,
  me: Id<"characters">,
): string | null {
  const entry = resolution.moves.find((m) => m.characterId === me);
  if (!entry) return null;
  const base = `(${entry.from.x},${entry.from.y}) → (${entry.to.x},${entry.to.y})`;
  if (entry.blockedBy === "wall") return `${base} → hit wall`;
  return base;
}

// ─────────────────────────────────────────────────────────────────────────────
// Action
// ─────────────────────────────────────────────────────────────────────────────

function renderActionIntent(
  decision: ParsedDecision,
  characterById: Map<Id<"characters">, Doc<"characters">>,
): string | null {
  const action = decision.action;
  switch (action.kind) {
    case "none":
      return null;
    case "attack":
      return `Attacked ${resolveCharacterName(
        action.targetId as Id<"characters">,
        characterById,
      )}`;
    case "loot": {
      const targetId = action.targetId;
      if (/^chest_/i.test(targetId)) return `Opened ${targetId}`;
      if (/^corpse_/i.test(targetId)) return `Looted from ${targetId}`;
      const name = resolveCharacterName(
        targetId as Id<"characters">,
        characterById,
      );
      return `Looted from corpse-of-${name}`;
    }
  }
}

function findImmediateActionEntry(
  resolution: TurnResolution,
  me: Id<"characters">,
): ResolutionAction | null {
  for (const action of resolution.actions) {
    if (
      action.characterId === me &&
      action.kind !== "overwatch" &&
      action.kind !== "counter"
    ) {
      return action;
    }
  }
  return null;
}

function findReactiveActionEntries(
  resolution: TurnResolution,
  me: Id<"characters">,
): ResolutionAction[] {
  return resolution.actions.filter(
    (action) =>
      action.characterId === me &&
      (action.kind === "overwatch" || action.kind === "counter"),
  );
}

function renderActionOutcome(
  entry: ResolutionAction,
  resolution: TurnResolution,
  characterById: Map<Id<"characters">, Doc<"characters">>,
): string {
  const { kind, result, target } = entry;
  const dmgMatch = /^dmg (\d+)$/.exec(result);

  if (kind === "attack") {
    if (dmgMatch) {
      const n = Number.parseInt(dmgMatch[1]!, 10);
      let s = `hit (dealt ${n} damage)`;
      const targetId = resolveCharacterIdForTarget(target, characterById);
      if (targetId !== null && resolution.deaths.includes(targetId)) {
        s += ` — killed ${resolveCharacterName(targetId, characterById)}`;
      }
      return s;
    }
    if (result === "no_target") return "target not found";
    if (result === "out_of_range") return "out of range";
    return `(unknown result: ${result})`;
  }

  if (kind === "loot") {
    if (result === "opened") return "opened";
    if (result === "already_opened") return "already opened";
    if (result === "no_chest") return "chest not found";
    if (result === "looted") return "looted";
    if (result === "no_corpse") return "corpse not found";
    if (result === "empty") return "corpse already drained";
    if (result === "no_target") return "target not found";
    if (result === "out_of_range") return "out of range";
    return `(unknown result: ${result})`;
  }

  if (kind === "overwatch") {
    const targetName = resolveCharacterName(
      target as Id<"characters">,
      characterById,
    );
    if (dmgMatch) {
      const n = Number.parseInt(dmgMatch[1]!, 10);
      const suffix =
        entry.triggeredByMovement === true ? " (movement trigger)" : "";
      return `overwatch fired on ${targetName}, dealt ${n} damage${suffix}`;
    }
    return `overwatch fired on ${targetName}, ${renderKnownActionMiss(result)}`;
  }

  if (kind === "counter") {
    const targetName = resolveCharacterName(
      target as Id<"characters">,
      characterById,
    );
    if (dmgMatch) {
      const n = Number.parseInt(dmgMatch[1]!, 10);
      return `counter-fired ${targetName}, dealt ${n} damage`;
    }
    return `counter-fire ${targetName} — ${renderKnownActionMiss(result)}`;
  }

  return `(unknown result: ${result})`;
}

function renderKnownActionMiss(result: string): string {
  if (result === "out_of_range") return "out of range";
  if (result === "no_target") return "target not found";
  return `(unknown result: ${result})`;
}

function isOutcomeRedundantWithIntent(intent: string, outcome: string): boolean {
  return outcome === "opened" && intent.startsWith("Opened ");
}

// ─────────────────────────────────────────────────────────────────────────────
// Use / say / scratchpad
// ─────────────────────────────────────────────────────────────────────────────

function renderUseIntent(decision: ParsedDecision): string {
  return decision.use === "consumable"
    ? "Used consumable"
    : "(no consumable used)";
}

function renderUseOutcome(entry: ResolutionUse): string {
  const item = entry.item;
  if (item.category === "consumable") {
    return `Used ${item.name} consumable`;
  }
  return "Used unknown item";
}

const SCRATCHPAD_BULLET_MAX = 120;

function renderScratchpadBullet(
  before: string,
  after: string | null,
): string {
  if (after === null) return "Scratchpad: carried forward";
  if (after === before) return "Scratchpad: unchanged";

  const prefix = "Scratchpad: ";
  const budget = SCRATCHPAD_BULLET_MAX - prefix.length;
  const trimmed =
    after.length > budget
      ? after.slice(0, Math.max(0, budget - 1)) + "…"
      : after;
  return prefix + trimmed;
}

// ─────────────────────────────────────────────────────────────────────────────
// Character / target resolution
// ─────────────────────────────────────────────────────────────────────────────

function resolveCharacterName(
  id: Id<"characters">,
  characterById: Map<Id<"characters">, Doc<"characters">>,
): string {
  const c = characterById.get(id);
  if (c) return c.displayName;

  const raw = String(id);
  for (const candidate of characterById.values()) {
    if (candidate.displayName === raw) return candidate.displayName;
  }

  if (/^(chest|corpse)_/i.test(raw)) return raw;
  if (raw.length <= 16) return raw;
  return raw.slice(0, 8);
}

function resolveCharacterIdForTarget(
  target: string,
  characterById: Map<Id<"characters">, Doc<"characters">>,
): Id<"characters"> | null {
  const asId = target as Id<"characters">;
  if (characterById.has(asId)) return asId;
  for (const candidate of characterById.values()) {
    if (candidate.displayName === target) return candidate._id;
  }
  return null;
}

function titleCase(s: string): string {
  return s.slice(0, 1).toUpperCase() + s.slice(1);
}
