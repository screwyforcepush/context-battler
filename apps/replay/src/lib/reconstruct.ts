// Phase 02 / WP-B — Position-reconstruction walk.
//
// Pure TypeScript module — NO I/O, NO closures, NO mutable shared state.
// Walks `bundle.turns` from synthetic turn 0 up to (and including) the row
// with `.turn === atTurn`, accumulating an EntitySnapshot.
//
// The contract this implements is `architecture-decisions.md` §4 in full.
// The 9 enumerated failure modes from `de-risking.md` §1.1-§1.9 are pinned
// by `__tests__/reconstruct.test.ts` (TDD red→green per AOP).
//
// Key invariants (encoded below):
//   - D-P2-13: turn 0 is SYNTHETIC. The first ledger row is `turn === 1`.
//     The walk constructs `turnRowByTurn = new Map<number, TurnRow>()` keyed
//     by `row.turn` — NEVER indexed by array position.
//   - D-P2-11: equipped + hp are NOT derivable from the ledger; snapshot
//     fields are ALWAYS `null`. Hover card (WP-D) shows "see expand panel".
//   - D-P2-12: opened-crate contents are not persisted (engine clears
//     `worldState.crates[i].contents` on open — `resolution.ts:537`). Walk
//     just flips `opened=true`; hover card shows "contents not persisted".
//   - D-P2-14 + phase-3 ADR §1 / PM lock D7: result-string vocabulary
//     canonical source is `convex/engine/resolution.ts`. Phase-3 unifies
//     `interact`+`loot` into a single `loot` kind dispatched by id
//     namespace. The walk consults `result` ONLY for
//     `kind === "loot" && result === "opened" && isCrateId(target)`.
//     Death detection comes from `resolution.deaths[]`, NEVER from a
//     result string.
//   - Phase-8 extraction (NOT a `kind:"extract"` action) is read from the
//     terminal `bundle.characters[c].extractedAtTurn` row.
//
// Source-reference cross-checks performed while writing this module:
//   - Resolution phase order: convex/engine/resolution.ts (head-comment §23).
//   - Action result vocabulary: convex/engine/resolution.ts:374-586.
//   - Phase-8 extraction: convex/engine/resolution.ts:711-723.
//   - Schema field shapes: convex/schema.ts.
//   - First-ledger-row invariant: convex/runMatch.ts:461.

import mapRef from "../../../../maps/reference.json";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export type Tile = { x: number; y: number };

export type ReplayPromptsLookup = {
  system: Record<string, string>;
  persona: Record<string, string>;
};

export type ReplayWorldState = Doc<"worldState"> & {
  walls?: Array<{ x: number; y: number; w: number; h: number }>;
  coverClusters?: Array<{ x: number; y: number; w: number; h: number }>;
  coverTiles?: Tile[];
};

export type ReplayBundle = {
  match: Doc<"matches">;
  turns: Array<Doc<"turns">>;
  worldState: ReplayWorldState | null;
  characters: Array<Doc<"characters">>;
  promptsLookup?: ReplayPromptsLookup;
};

export type SnapshotCharacter = {
  characterId: Id<"characters">;
  personaId: Doc<"characters">["personaId"];
  displayName: string;
  pos: Tile;
  alive: boolean;
  hidden: boolean;
  diedAtTurn: number | null;
  extractedAtTurn: number | null;
  // Per D-P2-11 these are NEVER derivable from the ledger; always null in v0.
  equipped: null;
  hp: null;
};

export type SnapshotCorpse = {
  characterId: Id<"characters">;
  pos: Tile;
};

export type SnapshotCrate = {
  id: string;
  pos: Tile;
  opened: boolean;
};

export type SnapshotAirdrop = {
  id: string;
  pos: Tile;
  landsAtTurn: number;
  state: "pre" | "telegraphed" | "landed" | "spent";
  looted: boolean;
  countdown?: number;
};

export type EntitySnapshot = {
  turn: number;
  characters: SnapshotCharacter[];
  corpses: SnapshotCorpse[];
  crates: SnapshotCrate[];
  airdrops: SnapshotAirdrop[];
  evacRevealed: boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// Map reference — spawns[] used for synthetic turn 0
// ─────────────────────────────────────────────────────────────────────────────

const SPAWNS: ReadonlyArray<Tile> = mapRef.spawns;

// ─────────────────────────────────────────────────────────────────────────────
// Walk
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reconstruct the entity snapshot for `atTurn`.
 *
 * Pure: same input → same output. No mutation of the input bundle. No
 * closure-captured state.
 */
export function reconstruct(
  bundle: ReplayBundle,
  atTurn: number,
): EntitySnapshot {
  // ── Build turn-number → row map ONCE per call (D-P2-13). The first
  // ledger row is `turn === 1`; turn 0 is synthetic.
  const turnRowByTurn = new Map<number, Doc<"turns">>();
  for (const row of bundle.turns) {
    turnRowByTurn.set(row.turn, row);
  }

  // ── Synthesise turn-0 state from spawns × characters. ─────────────────
  let snapshot = synthesiseTurnZero(bundle);

  // ── If atTurn === 0, return synthetic snapshot directly. ───────────────
  if (atTurn <= 0) {
    return {
      ...snapshot,
      airdrops: projectAirdrops(snapshot.airdrops, 0),
    };
  }

  // ── Walk t = 1..atTurn. Stop early if a turn has no ledger row. ───────
  for (let t = 1; t <= atTurn; t++) {
    const row = turnRowByTurn.get(t);
    if (!row) break;
    snapshot = applyTurn(snapshot, row, t);
  }

  // ── Apply phase-8 extraction (read from terminal characters[]). ──────
  snapshot = applyExtraction(snapshot, bundle.characters, atTurn);

  // ── Evac reveal: revealedAtTurn is canonical (see ADR §4 rule 3). ────
  const revealedAt = bundle.worldState?.evac.revealedAtTurn ?? null;
  const evacRevealed = revealedAt !== null && revealedAt <= atTurn;

  return {
    ...snapshot,
    turn: atTurn,
    airdrops: projectAirdrops(snapshot.airdrops, atTurn),
    evacRevealed,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: synthetic turn 0 (no ledger row consulted; D-P2-13 §1.9).
// ─────────────────────────────────────────────────────────────────────────────

function synthesiseTurnZero(bundle: ReplayBundle): EntitySnapshot {
  const characters: SnapshotCharacter[] = bundle.characters.map((c) => {
    const idx = c.spawnIndex;
    if (idx === undefined || idx === null) {
      throw new Error(
        `reconstruct: character "${c.displayName}" (id=${c._id}) is missing spawnIndex; cannot synthesise turn-0 position.`,
      );
    }
    if (idx < 0 || idx >= SPAWNS.length) {
      throw new Error(
        `reconstruct: character "${c.displayName}" (id=${c._id}) has spawnIndex=${idx} which is out of range for maps/reference.json spawns[] (length ${SPAWNS.length}).`,
      );
    }
    const spawn = SPAWNS[idx]!;
    return {
      characterId: c._id,
      personaId: c.personaId,
      displayName: c.displayName,
      pos: { x: spawn.x, y: spawn.y },
      alive: true,
      hidden: false,
      diedAtTurn: null,
      extractedAtTurn: null,
      equipped: null,
      hp: null,
    };
  });

  // Crates: from worldState (terminal) but `.opened` forced false at turn 0.
  // The walk re-derives the open flip via the action ledger so backward
  // jumps stay correct (de-risking §1.6).
  const crates: SnapshotCrate[] = (bundle.worldState?.crates ?? []).map((c) => ({
    id: c.id,
    pos: { x: c.pos.x, y: c.pos.y },
    opened: false,
  }));
  const airdrops: SnapshotAirdrop[] = (bundle.worldState?.airdrops ?? []).map(
    (drop) => ({
      id: drop.id,
      pos: { x: drop.pos.x, y: drop.pos.y },
      landsAtTurn: drop.landsAtTurn,
      state: "pre",
      looted: false,
    }),
  );

  return {
    turn: 0,
    characters,
    corpses: [],
    crates,
    airdrops,
    evacRevealed: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: apply one turn's resolution to the snapshot. Returns NEW state.
// Order mirrors concept-spec.md §23 (and engine resolution.ts):
//   1. moves         — set named characters' pos to move.to
//   2. actions       — loot/opened/Crate_<x>_<y> flips crates; corpse-loot and
//                      attack are no-ops (per D-P2-11/D-P2-12; HP &
//                      equipment not snapshot-tracked)
//   3. deaths        — flip alive=false, set diedAtTurn=t, push corpse at
//                      character's CURRENT pos (post-movement; §1.2)
//   4. visibilityUpdates — applied LAST (§1.4)
// ─────────────────────────────────────────────────────────────────────────────

function applyTurn(
  prev: EntitySnapshot,
  row: Doc<"turns">,
  t: number,
): EntitySnapshot {
  const resolution = row.resolution;

  // ── 1) Moves ──────────────────────────────────────────────────────────
  // Stationary characters have no entry in moves[] — they keep their prev
  // pos (§1.1). We build a Map for O(1) lookup.
  const movesByCharId = new Map<Id<"characters">, Tile>();
  for (const m of resolution.moves) {
    movesByCharId.set(m.characterId, { x: m.to.x, y: m.to.y });
  }
  let characters = prev.characters.map((c) => {
    const newPos = movesByCharId.get(c.characterId);
    return newPos ? { ...c, pos: newPos } : c;
  });

  // ── 2) Actions ────────────────────────────────────────────────────────
  // Per phase-3 ADR §1 / PM lock D7 walk rules: only `loot` with
  // `result === "opened"` AND `isCrateId(target)` mutates the
  // snapshot (crate's `opened` flips true). Corpse loots — same `kind:
  // "loot"` — must NOT trigger the crate-flip (the target id namespace
  // disambiguates). Other action results are no-ops at the snapshot
  // layer — equipment/HP are NOT tracked (D-P2-11).
  let crates = prev.crates;
  let airdrops = prev.airdrops;
  for (const a of resolution.actions) {
    if (
      a.kind === "loot" &&
      a.result === "opened" &&
      isCrateId(a.target)
    ) {
      const targetId = a.target;
      let mutated = false;
      const next = crates.map((c) => {
        if (c.id === targetId && !c.opened) {
          mutated = true;
          return { ...c, opened: true };
        }
        return c;
      });
      if (mutated) crates = next;
      airdrops = airdrops.map((drop) =>
        drop.id === targetId ? { ...drop, looted: true } : drop,
      );
    }
    // attack / corpse loot / crate-loot-other-results → snapshot is
    // unchanged. The side-panel feed (decisionEnglish) renders the
    // outcome string separately; the snapshot only tracks position +
    // crate-open-state + alive/hidden + extraction.
  }

  // ── 3) Deaths ─────────────────────────────────────────────────────────
  // Order: deaths AFTER moves (post-movement corpse position; §1.2).
  let corpses = prev.corpses;
  if (resolution.deaths.length > 0) {
    const deadIds = new Set<Id<"characters">>(resolution.deaths);
    const newCorpses: SnapshotCorpse[] = [];
    characters = characters.map((c) => {
      if (deadIds.has(c.characterId) && c.alive) {
        newCorpses.push({ characterId: c.characterId, pos: { ...c.pos } });
        return { ...c, alive: false, diedAtTurn: t };
      }
      return c;
    });
    if (newCorpses.length > 0) corpses = [...corpses, ...newCorpses];
  }

  // ── 4) visibilityUpdates ──────────────────────────────────────────────
  // Applied LAST (§1.4) — overrides any mid-turn hidden inference.
  if (resolution.visibilityUpdates.length > 0) {
    const updates = new Map<Id<"characters">, boolean>();
    for (const u of resolution.visibilityUpdates) {
      updates.set(u.characterId, u.hidden);
    }
    characters = characters.map((c) => {
      const next = updates.get(c.characterId);
      return next === undefined ? c : { ...c, hidden: next };
    });
  }

  return {
    turn: t,
    characters,
    corpses,
    crates,
    airdrops,
    evacRevealed: prev.evacRevealed,
  };
}

function isCrateId(id: string): boolean {
  return /^Crate_-?\d+_-?\d+$/.test(id);
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: phase-8 extraction (NOT an action; ADR §4 rule 4 / D-P2-13 §1.8).
// Read from terminal `bundle.characters[c].extractedAtTurn`. If
// `c.extractedAtTurn !== undefined && c.extractedAtTurn <= atTurn`, mark
// `snapshot.characters[c].extractedAtTurn = c.extractedAtTurn`.
// ─────────────────────────────────────────────────────────────────────────────

function applyExtraction(
  snap: EntitySnapshot,
  terminalCharacters: Array<Doc<"characters">>,
  atTurn: number,
): EntitySnapshot {
  // Build terminal extractedAtTurn lookup.
  const extractedAtById = new Map<Id<"characters">, number>();
  for (const c of terminalCharacters) {
    if (c.extractedAtTurn !== undefined && c.extractedAtTurn !== null) {
      extractedAtById.set(c._id, c.extractedAtTurn);
    }
  }
  if (extractedAtById.size === 0) return snap;

  const characters = snap.characters.map((c) => {
    const extractedAt = extractedAtById.get(c.characterId);
    if (extractedAt !== undefined && extractedAt <= atTurn) {
      return { ...c, extractedAtTurn: extractedAt };
    }
    return c;
  });
  return { ...snap, characters };
}

function projectAirdrops(
  airdrops: SnapshotAirdrop[],
  atTurn: number,
): SnapshotAirdrop[] {
  return airdrops.map((drop) => {
    if (drop.looted) {
      return withoutCountdown({ ...drop, state: "spent" });
    }
    if (atTurn < drop.landsAtTurn - 3) {
      return withoutCountdown({ ...drop, state: "pre" });
    }
    if (atTurn <= drop.landsAtTurn) {
      return {
        ...drop,
        state: "telegraphed",
        countdown: drop.landsAtTurn - atTurn,
      };
    }
    return withoutCountdown({ ...drop, state: "landed" });
  });
}

function withoutCountdown(drop: SnapshotAirdrop): SnapshotAirdrop {
  const next = { ...drop };
  delete next.countdown;
  return next;
}
