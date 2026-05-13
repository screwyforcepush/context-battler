// Phase 02 / WP-A — Match picker page.
//
// Paginated, reverse-chronological, completed-only table of matches read
// from the user's own Convex dev deployment via `replay.listMatches`. Each
// row links (via hash route) to `#/match/<id>`, where the replay view
// lives.
//
// Columns (anchored to `convex/schema.ts` `matches` row shape):
//
//   matchId   — truncated to 8 chars
//   started   — ISO datetime + relative ("3h ago") in muted text
//   status    — terminal status literal (always "completed" given the filter)
//   turn      — `match.turn` (last advanced turn — equals 50 for clean runs)
//   extracted — `outcome.extracted.length`
//
// The opaque "last survivor" column was dropped per UAT ISSUE-004 — the
// truncated `outcome.lastSurvivor` id was not user-meaningful and resolving
// it to a `displayName` would require a server-side N+1 lookup against
// `characters` for every page row. The remaining columns disambiguate
// matches well enough on their own.
//
// Error UI (UAT ISSUE-003): the picker fails opaquely with a 404-like
// `replay:listMatches` error if the user hasn't pushed `convex/replay.ts`
// to their dev deployment. `usePaginatedQuery` throws those errors (its
// positional form does not expose error state per
// `convex/dist/esm-types/react/use_paginated_query.d.ts`), so a
// component-local error boundary catches the throw and renders a friendly
// hint pointing at `npx convex dev` + `VITE_CONVEX_URL`.
//
// Only type-only imports cross the convex/ slice boundary
// (architecture-decisions.md §7).

import React from "react";
import { usePaginatedQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Doc } from "../../../../convex/_generated/dataModel";

const PAGE_SIZE = 20;

function truncateId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function formatStarted(epochMs: number): { iso: string; relative: string } {
  const iso = new Date(epochMs).toISOString();
  const deltaMs = Date.now() - epochMs;
  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 60) return { iso, relative: `${seconds}s ago` };
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return { iso, relative: `${minutes}m ago` };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { iso, relative: `${hours}h ago` };
  const days = Math.floor(hours / 24);
  if (days < 30) return { iso, relative: `${days}d ago` };
  const months = Math.floor(days / 30);
  if (months < 12) return { iso, relative: `${months}mo ago` };
  const years = Math.floor(days / 365);
  return { iso, relative: `${years}y ago` };
}

function MatchRow({
  match,
}: {
  match: Doc<"matches">;
}): React.ReactElement {
  const started = formatStarted(match.startedAt);
  const extractedCount = match.outcome.extracted.length;
  return (
    <tr style={rowStyle}>
      <td style={cellStyle}>
        <a href={`#/match/${match._id}`} style={linkStyle}>
          {truncateId(match._id)}
        </a>
      </td>
      <td style={cellStyle}>
        <span title={started.iso}>{started.relative}</span>
        <span style={mutedStyle}>{` (${started.iso})`}</span>
      </td>
      <td style={cellStyle}>{match.status}</td>
      <td style={cellStyle}>{match.turn}</td>
      <td style={cellStyle}>{extractedCount}</td>
    </tr>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Picker body — unchanged data-fetch path. Wrapped by `MatchPicker` below
// in an error boundary so a missing `replay:listMatches` deployment renders
// a friendly hint instead of a blank page + console stack trace.
// ─────────────────────────────────────────────────────────────────────────────

function MatchPickerBody(): React.ReactElement {
  const { results, status, loadMore } = usePaginatedQuery(
    api.replay.listMatches,
    {},
    { initialNumItems: PAGE_SIZE },
  );

  if (status === "LoadingFirstPage") {
    return <p>Loading matches…</p>;
  }
  if (results.length === 0) {
    return (
      <p>
        No completed matches found in this deployment. Run a match via the
        harness (<code>npm run harness</code>) and refresh.
      </p>
    );
  }
  return (
    <>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>matchId</th>
            <th style={thStyle}>started</th>
            <th style={thStyle}>status</th>
            <th style={thStyle}>turn</th>
            <th style={thStyle}>extracted</th>
          </tr>
        </thead>
        <tbody>
          {results.map((match) => (
            <MatchRow key={match._id} match={match} />
          ))}
        </tbody>
      </table>
      <div style={loadMoreRowStyle}>
        <button
          type="button"
          onClick={() => loadMore(PAGE_SIZE)}
          disabled={status !== "CanLoadMore"}
          style={loadMoreBtnStyle}
        >
          {status === "CanLoadMore"
            ? "Load more"
            : status === "LoadingMore"
              ? "Loading…"
              : "No more matches"}
        </button>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PickerErrorBoundary — narrow component-level boundary that catches the
// throw from `usePaginatedQuery` when the dev deployment doesn't expose
// `replay:listMatches` (the UAT ISSUE-003 onboarding cliff). Renders a
// readable hint instead of a blank screen. Other errors get the same
// friendly frame because the failure mode the user actually hits in
// practice is the function-not-found path.
// ─────────────────────────────────────────────────────────────────────────────

type PickerErrorBoundaryState = { error: Error | null };

class PickerErrorBoundary extends React.Component<
  { children: React.ReactNode },
  PickerErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error): PickerErrorBoundaryState {
    return { error };
  }
  override componentDidCatch(error: Error): void {
    console.error("MatchPicker query failed:", error);
  }
  override render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div role="alert" style={errorBoxStyle}>
          <p style={errorTitleStyle}>Couldn’t load matches.</p>
          <p style={errorBodyStyle}>
            Convex deployment doesn’t expose <code>replay:listMatches</code>.
            Run <code>npx convex dev</code> from the repo root and ensure
            <code> VITE_CONVEX_URL</code> in <code>apps/replay/.env</code>
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

export function MatchPicker(): React.ReactElement {
  return (
    <main style={mainStyle}>
      <header style={headerStyle}>
        <div style={headerTopStyle}>
          <div>
            <h1 style={h1Style}>Personal Replay Overseer</h1>
            <p style={subtitleStyle}>
              Completed matches, newest first. Click a row to step through it.
            </p>
          </div>
          <a href="#/diagnostics?last=20" style={diagnosticsLinkStyle}>
            Diagnostics
          </a>
        </div>
      </header>
      <PickerErrorBoundary>
        <MatchPickerBody />
      </PickerErrorBoundary>
    </main>
  );
}

// Inline styles — no CSS framework in v0; the diagnostic UI is utilitarian
// per north-star (public-renderer styling concerns are out-of-scope, see
// README §4).

const mainStyle: React.CSSProperties = {
  fontFamily: "system-ui, -apple-system, sans-serif",
  padding: "1.5rem 2rem",
  maxWidth: "1100px",
  margin: "0 auto",
  color: "#1a1a1a",
};

const headerStyle: React.CSSProperties = { marginBottom: "1.5rem" };

const headerTopStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: "1rem",
};

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

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "0.875rem",
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "0.5rem 0.75rem",
  borderBottom: "2px solid #ccc",
  fontWeight: 600,
};

const cellStyle: React.CSSProperties = {
  padding: "0.5rem 0.75rem",
  borderBottom: "1px solid #eee",
  fontFamily:
    'ui-monospace, SFMono-Regular, "SF Mono", Consolas, monospace',
};

const rowStyle: React.CSSProperties = {};

const linkStyle: React.CSSProperties = {
  color: "#0366d6",
  textDecoration: "none",
};

const diagnosticsLinkStyle: React.CSSProperties = {
  color: "#0366d6",
  textDecoration: "none",
  border: "1px solid #d0d7de",
  borderRadius: 4,
  padding: "0.375rem 0.75rem",
  fontSize: "0.875rem",
  background: "#f6f8fa",
};

const mutedStyle: React.CSSProperties = {
  color: "#888",
  fontSize: "0.8125rem",
};

const loadMoreRowStyle: React.CSSProperties = {
  marginTop: "1rem",
  display: "flex",
  justifyContent: "center",
};

const loadMoreBtnStyle: React.CSSProperties = {
  padding: "0.5rem 1rem",
  fontSize: "0.875rem",
  cursor: "pointer",
  border: "1px solid #ccc",
  borderRadius: "4px",
  background: "#f6f8fa",
};

const errorBoxStyle: React.CSSProperties = {
  padding: "1rem 1.25rem",
  border: "1px solid #d73a49",
  borderLeft: "4px solid #d73a49",
  borderRadius: "4px",
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
