import React from "react";
import type { Doc } from "../../../../convex/_generated/dataModel";
import type { ReplayBundle } from "./reconstruct";

export const VINTAGE_REPLAY_NOTICE =
  "This match predates iter-2; persisted before the Phase 6 DB wipe. Re-run a match to view iter-2 traces.";

const LEGACY_DECISION_FIELDS = [
  "primary",
  "move",
  "overwatch_stance",
  "consume",
] as const;

export function hasPreIter2AgentRecords(bundle: ReplayBundle): boolean {
  return bundle.turns.some((turn) =>
    turn.agentRecords.some((record) => isPreIter2AgentRecord(record)),
  );
}

export function isPreIter2AgentRecord(
  agentRecord: Doc<"turns">["agentRecords"][number],
): boolean {
  const decision = readObject(agentRecord.decision);
  if (decision === null) return true;

  for (const field of LEGACY_DECISION_FIELDS) {
    if (field in decision) return true;
  }

  return readObject(decision["position"]) === null;
}

export function VintageReplayNotice(): React.ReactElement {
  return (
    <div role="alert" style={noticeBoxStyle}>
      <p style={noticeBodyStyle}>{VINTAGE_REPLAY_NOTICE}</p>
    </div>
  );
}

function readObject(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}

const noticeBoxStyle: React.CSSProperties = {
  padding: "1rem 1.25rem",
  border: "1px solid #b6c2cf",
  borderLeft: "4px solid #57606a",
  borderRadius: 4,
  background: "#f6f8fa",
  color: "#1a1a1a",
};

const noticeBodyStyle: React.CSSProperties = {
  margin: 0,
  fontSize: "0.875rem",
  lineHeight: 1.45,
};
