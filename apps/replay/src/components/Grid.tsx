// Phase 02 / WP-B — SVG bird's-eye grid renderer.
//
// 100×100 viewBox; one `<g>` group per layer (z-order bottom→top):
//   walls → cover tiles → evac zone → chests → corpses → agents.
//
// Per ADR §1: SVG over canvas for v0. ~28 walls + ~60 cover tiles + 12 chests
// + ≤8 corpses + 8 agents = ~120 nodes — well within DOM-event hover-test
// performance. Persona colours are 8 distinct high-contrast hex values
// (d3 category10 inlined; no library).
//
// `data-token-kind` and `data-character-id` / `data-chest-id` attributes
// are wired so WP-D's HoverCard can attach a delegated mouseenter listener
// on the SVG root and identify the hovered token without per-node refs.
//
// Per D-P2-11/D-P2-12: equipped/HP and chest contents render as null in the
// snapshot. The hover card (WP-D) handles the "see expand panel" / "contents
// not persisted" copy.

import React from "react";
import type { EntitySnapshot } from "../lib/reconstruct";
import type { Doc } from "../../../../convex/_generated/dataModel";

const VIEW_W = 100;
const VIEW_H = 100;

// d3.schemeCategory10 — first 8 entries — are visually distinct enough for
// 8-agent disambiguation and broadly colour-blind tolerable.
const PERSONA_COLOURS: Record<string, string> = {
  rat: "#1f77b4",
  duelist: "#ff7f0e",
  trader: "#2ca02c",
  opportunist: "#d62728",
  paranoid: "#9467bd",
  camper: "#8c564b",
  sprinter: "#e377c2",
  vulture: "#7f7f7f",
};

const FALLBACK_PERSONA_COLOUR = "#444";

// Single-character persona glyph (rendered above the agent token). Uses
// the first letter of the persona id, capitalised.
function personaGlyph(personaId: string): string {
  return personaId.length > 0
    ? personaId.charAt(0).toUpperCase()
    : "?";
}

export type GridProps = {
  snapshot: EntitySnapshot;
  worldState: Doc<"worldState"> | null;
};

export function Grid({ snapshot, worldState }: GridProps): React.ReactElement {
  const evacCentre = worldState?.evac.centre ?? { x: 50, y: 50 };
  const evacReveal = snapshot.evacRevealed;

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      style={svgStyle}
      role="img"
      aria-label={`Replay grid at turn ${snapshot.turn}`}
    >
      {/* Background tile grid (very subtle for orientation). */}
      <rect
        x={0}
        y={0}
        width={VIEW_W}
        height={VIEW_H}
        fill="#fafafa"
        data-token-kind="background"
      />

      {/* ── Layer 1: walls (grey) ─────────────────────────────────────── */}
      <g data-layer="walls">
        {(worldState?.walls ?? []).map((w, i) => (
          <rect
            key={`wall-${i}`}
            x={w.x}
            y={w.y}
            width={w.w}
            height={w.h}
            fill="#666"
            data-token-kind="wall"
          />
        ))}
      </g>

      {/* ── Layer 2: cover tiles (lighter grey, per-tile from the engine
              flattening of cover clusters; ADR §6 — worldState.coverTiles
              is already per-tile, NOT clusters). ─────────────────────── */}
      <g data-layer="cover">
        {(worldState?.coverTiles ?? []).map((t, i) => (
          <rect
            key={`cover-${i}`}
            x={t.x}
            y={t.y}
            width={1}
            height={1}
            fill="#bbb"
            data-token-kind="cover"
          />
        ))}
      </g>

      {/* ── Layer 3: evac zone (3×3 ring centred on evac.centre). ────── */}
      <g data-layer="evac">
        <rect
          x={evacCentre.x - 1}
          y={evacCentre.y - 1}
          width={3}
          height={3}
          fill={evacReveal ? "rgba(60,180,75,0.30)" : "rgba(60,180,75,0.15)"}
          stroke={evacReveal ? "#1f7a1f" : "#5fa55f"}
          strokeWidth={0.15}
          data-token-kind="evac"
        />
      </g>

      {/* ── Layer 4: chests (closed=brown filled, open=lighter w/ X). ── */}
      <g data-layer="chests">
        {snapshot.chests.map((c) => (
          <g key={`chest-${c.id}`} data-token-kind="chest" data-chest-id={c.id}>
            <rect
              x={c.pos.x + 0.1}
              y={c.pos.y + 0.1}
              width={0.8}
              height={0.8}
              fill={c.opened ? "#d2a074" : "#8b5a2b"}
              stroke="#3e2812"
              strokeWidth={0.05}
            />
            {c.opened ? (
              <>
                {/* Faint X marks an opened chest. */}
                <line
                  x1={c.pos.x + 0.2}
                  y1={c.pos.y + 0.2}
                  x2={c.pos.x + 0.8}
                  y2={c.pos.y + 0.8}
                  stroke="#3e2812"
                  strokeWidth={0.08}
                />
                <line
                  x1={c.pos.x + 0.8}
                  y1={c.pos.y + 0.2}
                  x2={c.pos.x + 0.2}
                  y2={c.pos.y + 0.8}
                  stroke="#3e2812"
                  strokeWidth={0.08}
                />
              </>
            ) : null}
            <title>
              {c.opened ? "Chest (opened)" : "Chest (closed)"} — {c.id}
            </title>
          </g>
        ))}
      </g>

      {/* ── Layer 5: corpses (dark grey circle with cross). ──────────── */}
      <g data-layer="corpses">
        {snapshot.corpses.map((corpse) => (
          <g
            key={`corpse-${corpse.characterId}`}
            data-token-kind="corpse"
            data-character-id={corpse.characterId}
          >
            <circle
              cx={corpse.pos.x + 0.5}
              cy={corpse.pos.y + 0.5}
              r={0.35}
              fill="#3a3a3a"
              stroke="#1a1a1a"
              strokeWidth={0.08}
            />
            {/* Cross glyph centred on the corpse. */}
            <line
              x1={corpse.pos.x + 0.25}
              y1={corpse.pos.y + 0.5}
              x2={corpse.pos.x + 0.75}
              y2={corpse.pos.y + 0.5}
              stroke="#fff"
              strokeWidth={0.08}
            />
            <line
              x1={corpse.pos.x + 0.5}
              y1={corpse.pos.y + 0.25}
              x2={corpse.pos.x + 0.5}
              y2={corpse.pos.y + 0.75}
              stroke="#fff"
              strokeWidth={0.08}
            />
            <title>Corpse</title>
          </g>
        ))}
      </g>

      {/* ── Layer 6: agents (persona-coloured circle + glyph). ───────── */}
      <g data-layer="agents">
        {snapshot.characters.map((c) => {
          // Hide dead and extracted agents from the live grid (corpse layer
          // renders the corpse for dead; extracted are off-map per
          // de-risking §1.8).
          if (!c.alive) return null;
          if (
            c.extractedAtTurn !== null &&
            c.extractedAtTurn <= snapshot.turn
          ) {
            return null;
          }
          const colour =
            PERSONA_COLOURS[c.personaId] ?? FALLBACK_PERSONA_COLOUR;
          return (
            <g
              key={`agent-${c.characterId}`}
              data-token-kind="agent"
              data-character-id={c.characterId}
            >
              <circle
                cx={c.pos.x + 0.5}
                cy={c.pos.y + 0.5}
                r={0.4}
                fill={colour}
                stroke="#1a1a1a"
                strokeWidth={0.08}
                opacity={c.hidden ? 0.55 : 1}
              />
              {/* Persona glyph above the circle. */}
              <text
                x={c.pos.x + 0.5}
                y={c.pos.y + 0.42}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={0.55}
                fontFamily="ui-monospace, SFMono-Regular, Consolas, monospace"
                fontWeight={700}
                fill="#fff"
                style={{ pointerEvents: "none" }}
              >
                {personaGlyph(c.personaId)}
              </text>
              <title>
                {c.displayName} — {c.personaId}
                {c.hidden ? " (hidden)" : ""}
              </title>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

// Fit-to-viewport: SVG fills its parent container's box. The square
// constraint is owned by the wrapping div in `Replay.tsx` (`gridColStyle` +
// inner square wrapper) so the grid stays square within whatever the side
// panel + header leave available — bounded by BOTH axes, never overflowing.
const svgStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  background: "#fafafa",
  border: "1px solid #ddd",
  display: "block",
};
