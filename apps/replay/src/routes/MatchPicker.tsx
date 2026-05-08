// Phase 02 / WP-A — Match picker page.
//
// Paginated, reverse-chronological, completed-only table of matches read
// from the user's own Convex dev deployment via `replay.listMatches`. Each
// row links (via hash route) to `#/match/<id>`, where WP-B's replay view
// will live.
//
// Columns (from work-packages.md WP-A scope, anchored to `convex/schema.ts`
// `matches` row shape — `outcome.lastSurvivor` is `v.id("characters")` per
// schema.ts:453, NOT a displayName, so we render the truncated id; display
// name resolution lands in WP-B once the bundle's `characters[]` is loaded):
//
//   matchId   — truncated to 8 chars
//   started   — ISO datetime + relative ("3h ago") in muted text
//   status    — terminal status literal (always "completed" given the filter)
//   turn      — `match.turn` (last advanced turn — equals 50 for clean runs)
//   extracted — `outcome.extracted.length`
//   survivor  — `outcome.lastSurvivor` truncated to 8 chars or "—"
//
// Only type-only imports cross the convex/ slice boundary
// (architecture-decisions.md §7).

import React from "react";
import { usePaginatedQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";

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
  const survivorId: Id<"characters"> | undefined = match.outcome.lastSurvivor;
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
      <td style={cellStyle}>
        {survivorId === undefined ? "—" : truncateId(survivorId)}
      </td>
    </tr>
  );
}

export function MatchPicker(): React.ReactElement {
  const { results, status, loadMore } = usePaginatedQuery(
    api.replay.listMatches,
    {},
    { initialNumItems: PAGE_SIZE },
  );

  return (
    <main style={mainStyle}>
      <header style={headerStyle}>
        <h1 style={h1Style}>Personal Replay Overseer</h1>
        <p style={subtitleStyle}>
          Phase 02 v0 — completed matches, newest first. Click a row to
          step through it.
        </p>
      </header>

      {status === "LoadingFirstPage" ? (
        <p>Loading matches…</p>
      ) : results.length === 0 ? (
        <p>
          No completed matches found in this deployment. Run a match via the
          harness (<code>npm run harness</code>) and refresh.
        </p>
      ) : (
        <>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>matchId</th>
                <th style={thStyle}>started</th>
                <th style={thStyle}>status</th>
                <th style={thStyle}>turn</th>
                <th style={thStyle}>extracted</th>
                <th style={thStyle}>last survivor</th>
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
      )}
    </main>
  );
}

// Inline styles — no CSS framework in v0; the diagnostic UI is utilitarian
// per north-star (consumer-renderer styling concerns are out-of-scope, see
// README §4).

const mainStyle: React.CSSProperties = {
  fontFamily: "system-ui, -apple-system, sans-serif",
  padding: "1.5rem 2rem",
  maxWidth: "1100px",
  margin: "0 auto",
  color: "#1a1a1a",
};

const headerStyle: React.CSSProperties = { marginBottom: "1.5rem" };

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
