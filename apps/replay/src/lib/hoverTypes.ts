// Phase 02 / WP-C — Hover-target type contract (shared with WP-D's HoverCard).
//
// WP-C owns this file. WP-D's `HoverCard` uses the `HoverTarget` union
// to route per-token rendering. The set of variants matches what
// `Grid.tsx` exposes via `data-token-kind` (background / wall / cover /
// evac / airdrop / crate / corpse / agent — the renderer-level tokens).
//
// Per ADR §1: token hit-testing is delegated through React event listeners
// on the SVG root; the listener reads `data-*` attributes and constructs
// the union variant for that token. See `Replay.tsx` `onGridMouseOver`.

import type { Id } from "../../../../convex/_generated/dataModel";

export type HoverTarget =
  | { kind: "agent"; characterId: Id<"characters">; pos: { x: number; y: number } }
  | { kind: "airdrop"; airdropId: string; pos: { x: number; y: number } }
  | { kind: "crate"; crateId: string; pos: { x: number; y: number } }
  | { kind: "corpse"; characterId: Id<"characters">; pos: { x: number; y: number } }
  | { kind: "wall"; pos: { x: number; y: number } }
  | { kind: "cover"; pos: { x: number; y: number } }
  | { kind: "evac"; pos: { x: number; y: number } };
