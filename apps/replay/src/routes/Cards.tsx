// In-thread addition — Character Cards overseer tab.
//
// Basic, utilitarian data + authoring surface for the `cards` table (the
// phase-13 player-facing unit). NOT a leaderboard UI — it shows the raw
// per-Card accrual the schema stores and lets the user create new Cards and
// replace an existing Card's prompt. Mirrors the MatchPicker conventions:
// inline styles, hash-route tab, a component-local error boundary for the
// missing-deployment onboarding cliff.
//
// Backend (already shipped): `convex/cards.ts`
//   - api.cards.list          → Doc<"cards">[]
//   - api.cards.create        → { agentName, promptText, lineagePersonaId }
//   - api.cards.updatePrompt  → { cardId, promptText }
//   - api.cards.seedPresets   → seeds the 8 preset Cards
//
// Prompt text is stored hashed (`prompts` table, dedup by hash), so the
// Card row only carries `promptHash`. Editing therefore REPLACES the prompt
// wholesale rather than diffing the old text — kept deliberately basic.
//
// Only type-only imports cross the convex/ slice boundary
// (architecture-decisions.md §7).

import React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Doc } from "../../../../convex/_generated/dataModel";

// The locked persona lineage set — same 8 literals as
// `convex/schema.ts` `personaIdValidator`. A Card descends from one preset
// lineage (telemetry continuity + prompt-load); the substrate harness owns
// the closed union, this is just the authoring dropdown.
const LINEAGE_OPTIONS = [
  "rat",
  "duelist",
  "trader",
  "opportunist",
  "paranoid",
  "camper",
  "sprinter",
  "vulture",
] as const;

function ratio(numerator: number, denominator: number): string {
  if (denominator <= 0) return "—";
  return (numerator / denominator).toFixed(2);
}

function shortHash(hash: string): string {
  return hash.length > 10 ? `${hash.slice(0, 10)}…` : hash;
}

// ─────────────────────────────────────────────────────────────────────────────
// Create form — agentName + lineage + prompt text.
// ─────────────────────────────────────────────────────────────────────────────

function CreateCardForm(): React.ReactElement {
  const create = useMutation(api.cards.create);
  const seedPresets = useMutation(api.cards.seedPresets);
  const [agentName, setAgentName] = React.useState("");
  const [lineage, setLineage] =
    React.useState<(typeof LINEAGE_OPTIONS)[number]>("rat");
  const [promptText, setPromptText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);

  const canSubmit =
    agentName.trim().length > 0 && promptText.trim().length > 0 && !busy;

  async function onCreate(): Promise<void> {
    setBusy(true);
    setMsg(null);
    try {
      await create({
        agentName: agentName.trim(),
        promptText: promptText.trim(),
        lineagePersonaId: lineage,
      });
      setMsg(`Created card "${agentName.trim()}".`);
      setAgentName("");
      setPromptText("");
    } catch (err) {
      setMsg(`Create failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function onSeed(): Promise<void> {
    setBusy(true);
    setMsg(null);
    try {
      await seedPresets({});
      setMsg("Seeded preset cards.");
    } catch (err) {
      setMsg(`Seed failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={formSectionStyle}>
      <div style={formRowStyle}>
        <label style={labelStyle}>
          Agent name
          <input
            type="text"
            value={agentName}
            onChange={(e) => setAgentName(e.target.value)}
            placeholder="e.g. Knife Goblin"
            style={inputStyle}
          />
        </label>
        <label style={labelStyle}>
          Lineage
          <select
            value={lineage}
            onChange={(e) =>
              setLineage(e.target.value as (typeof LINEAGE_OPTIONS)[number])
            }
            style={inputStyle}
          >
            {LINEAGE_OPTIONS.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label style={labelStyle}>
        Prompt
        <textarea
          value={promptText}
          onChange={(e) => setPromptText(e.target.value)}
          placeholder="The behavioural prompt that decides how this agent fights, talks, hides, betrays, or runs."
          rows={5}
          style={textareaStyle}
        />
      </label>
      <div style={formActionsStyle}>
        <button
          type="button"
          onClick={onCreate}
          disabled={!canSubmit}
          style={primaryBtnStyle}
        >
          {busy ? "Working…" : "Create card"}
        </button>
        <button
          type="button"
          onClick={onSeed}
          disabled={busy}
          style={secondaryBtnStyle}
          title="Insert the 8 preset cards if the pool is empty"
        >
          Seed presets
        </button>
        {msg && <span style={msgStyle}>{msg}</span>}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-row prompt editor — replaces the Card's prompt wholesale.
// ─────────────────────────────────────────────────────────────────────────────

function EditPrompt({ cardId }: { cardId: string }): React.ReactElement {
  const updatePrompt = useMutation(api.cards.updatePrompt);
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);

  async function onSave(): Promise<void> {
    setBusy(true);
    setMsg(null);
    try {
      await updatePrompt({
        cardId: cardId as Doc<"cards">["_id"],
        promptText: draft.trim(),
      });
      setMsg("Saved.");
      setOpen(false);
    } catch (err) {
      setMsg(`Save failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={linkBtnStyle}
      >
        Edit prompt
      </button>
    );
  }
  return (
    <div style={editBoxStyle}>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="New prompt text (replaces the current prompt entirely)."
        rows={4}
        style={textareaStyle}
      />
      <div style={formActionsStyle}>
        <button
          type="button"
          onClick={onSave}
          disabled={busy || draft.trim().length === 0}
          style={primaryBtnStyle}
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setMsg(null);
          }}
          disabled={busy}
          style={secondaryBtnStyle}
        >
          Cancel
        </button>
        {msg && <span style={msgStyle}>{msg}</span>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Card table.
// ─────────────────────────────────────────────────────────────────────────────

function CardsBody(): React.ReactElement {
  const cards = useQuery(api.cards.list, {}) as
    | Doc<"cards">[]
    | undefined;

  if (cards === undefined) return <p>Loading cards…</p>;
  if (cards.length === 0) {
    return (
      <p>
        No cards yet. Create one above, or click <strong>Seed presets</strong>{" "}
        to insert the 8 preset cards.
      </p>
    );
  }

  return (
    <table style={tableStyle}>
      <thead>
        <tr>
          <th style={thStyle}>agent</th>
          <th style={thStyle}>lineage</th>
          <th style={thStyle}>lvl/xp</th>
          <th style={thStyle}>matches</th>
          <th style={thStyle}>prize</th>
          <th style={thStyle}>prize/match</th>
          <th style={thStyle}>K</th>
          <th style={thStyle}>D</th>
          <th style={thStyle}>K/D</th>
          <th style={thStyle}>slams</th>
          <th style={thStyle}>preset</th>
          <th style={thStyle}>promptHash</th>
          <th style={thStyle} />
        </tr>
      </thead>
      <tbody>
        {cards.map((c) => (
          <tr key={c._id} style={rowStyle}>
            <td style={cellStyle}>{c.agentName}</td>
            <td style={cellStyle}>{c.lineagePersonaId}</td>
            <td style={cellStyle}>
              {c.progression.level}/{c.progression.xp}
            </td>
            <td style={cellStyle}>{c.matchesPlayed}</td>
            <td style={cellStyle}>{c.prizeUnitsWon}</td>
            <td style={cellStyle}>
              {ratio(c.prizeUnitsWon, c.matchesPlayed)}
            </td>
            <td style={cellStyle}>{c.kills}</td>
            <td style={cellStyle}>{c.deaths}</td>
            <td style={cellStyle}>{ratio(c.kills, c.deaths)}</td>
            <td style={cellStyle}>{c.wallFaceSlams}</td>
            <td style={cellStyle}>{c.isPreset ? "yes" : "no"}</td>
            <td style={cellStyle} title={c.promptHash}>
              {shortHash(c.promptHash)}
            </td>
            <td style={cellStyle}>
              <EditPrompt cardId={c._id} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Error boundary — same friendly missing-deployment hint as MatchPicker.
// ─────────────────────────────────────────────────────────────────────────────

type CardsErrorBoundaryState = { error: Error | null };

class CardsErrorBoundary extends React.Component<
  { children: React.ReactNode },
  CardsErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error): CardsErrorBoundaryState {
    return { error };
  }
  override componentDidCatch(error: Error): void {
    console.error("Cards route failed:", error);
  }
  override render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div role="alert" style={errorBoxStyle}>
          <p style={errorTitleStyle}>Couldn’t load cards.</p>
          <p style={errorBodyStyle}>
            Convex deployment doesn’t expose <code>cards:list</code>. Run{" "}
            <code>npx convex dev</code> from the repo root and ensure{" "}
            <code>VITE_CONVEX_URL</code> in <code>apps/replay/.env</code>{" "}
            points at it.
          </p>
          <p style={errorDetailStyle}>
            <span style={mutedStyle}>error:</span>{" "}
            <code>{this.state.error.message}</code>
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

export function Cards(): React.ReactElement {
  return (
    <main style={mainStyle}>
      <header style={headerStyle}>
        <h1 style={h1Style}>Character Cards</h1>
        <p style={subtitleStyle}>
          The persistent prompt-authored agent unit. Raw accrual from the{" "}
          <code>cards</code> table — create new cards and replace existing
          prompts here.
        </p>
      </header>
      <CardsErrorBoundary>
        <CreateCardForm />
        <CardsBody />
      </CardsErrorBoundary>
    </main>
  );
}

// Inline styles — match MatchPicker's utilitarian v0 visual language.

const mainStyle: React.CSSProperties = {
  fontFamily: "system-ui, -apple-system, sans-serif",
  padding: "1.5rem 2rem",
  maxWidth: "1100px",
  margin: "0 auto",
  color: "#1a1a1a",
};

const headerStyle: React.CSSProperties = { marginBottom: "1.25rem" };

const h1Style: React.CSSProperties = {
  fontSize: "1.5rem",
  fontWeight: 600,
  margin: "0 0 0.25rem 0",
};

const subtitleStyle: React.CSSProperties = {
  margin: 0,
  color: "#666",
  fontSize: "0.875rem",
};

const formSectionStyle: React.CSSProperties = {
  border: "1px solid #d0d7de",
  borderRadius: 6,
  background: "#f6f8fa",
  padding: "1rem 1.25rem",
  marginBottom: "1.5rem",
  display: "flex",
  flexDirection: "column",
  gap: "0.75rem",
};

const formRowStyle: React.CSSProperties = {
  display: "flex",
  gap: "1rem",
  flexWrap: "wrap",
};

const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.25rem",
  fontSize: "0.8125rem",
  fontWeight: 600,
  color: "#444",
  flex: 1,
  minWidth: "12rem",
};

const inputStyle: React.CSSProperties = {
  padding: "0.4rem 0.5rem",
  fontSize: "0.875rem",
  border: "1px solid #ccc",
  borderRadius: 4,
  fontFamily: "inherit",
};

const textareaStyle: React.CSSProperties = {
  padding: "0.5rem",
  fontSize: "0.8125rem",
  border: "1px solid #ccc",
  borderRadius: 4,
  fontFamily:
    'ui-monospace, SFMono-Regular, "SF Mono", Consolas, monospace',
  resize: "vertical",
  width: "100%",
  boxSizing: "border-box",
};

const formActionsStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.75rem",
  flexWrap: "wrap",
};

const primaryBtnStyle: React.CSSProperties = {
  padding: "0.45rem 1rem",
  fontSize: "0.875rem",
  cursor: "pointer",
  border: "1px solid #0366d6",
  borderRadius: 4,
  background: "#0366d6",
  color: "#fff",
  fontWeight: 600,
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: "0.45rem 1rem",
  fontSize: "0.875rem",
  cursor: "pointer",
  border: "1px solid #ccc",
  borderRadius: 4,
  background: "#fff",
};

const linkBtnStyle: React.CSSProperties = {
  padding: 0,
  border: "none",
  background: "none",
  color: "#0366d6",
  cursor: "pointer",
  fontSize: "0.8125rem",
};

const editBoxStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.5rem",
  minWidth: "18rem",
};

const msgStyle: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "#444",
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "0.875rem",
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "0.5rem 0.625rem",
  borderBottom: "2px solid #ccc",
  fontWeight: 600,
  whiteSpace: "nowrap",
};

const cellStyle: React.CSSProperties = {
  padding: "0.5rem 0.625rem",
  borderBottom: "1px solid #eee",
  verticalAlign: "top",
};

const rowStyle: React.CSSProperties = {};

const mutedStyle: React.CSSProperties = {
  color: "#888",
  fontSize: "0.8125rem",
};

const errorBoxStyle: React.CSSProperties = {
  padding: "1rem 1.25rem",
  border: "1px solid #d73a49",
  borderLeft: "4px solid #d73a49",
  borderRadius: 4,
  background: "#fff5f6",
  color: "#1a1a1a",
};

const errorTitleStyle: React.CSSProperties = {
  margin: "0 0 0.5rem 0",
  fontWeight: 600,
  fontSize: "0.9375rem",
};

const errorBodyStyle: React.CSSProperties = {
  margin: "0 0 0.5rem 0",
  fontSize: "0.875rem",
  lineHeight: 1.45,
};

const errorDetailStyle: React.CSSProperties = {
  margin: 0,
  fontSize: "0.8125rem",
};
