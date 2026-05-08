# Phase 02 — Architecture Decisions

> Decisions this phase needs to make that are not already locked in
> `docs/project/spec/architecture.md` or this phase's `README.md`. Each is
> an ADR-shaped block: decision, rationale, alternatives considered,
> consequences. Stable for the duration of the phase; revisit only if
> implementation surfaces a fact that breaks the assumption.

The why-layer constraint everything below honours: the renderer slice
subscribes to State only — never calls the engine
(`architecture.md` §1 / pillar 7). Any decision that would couple the
renderer to engine code is wrong.

---

## 1. Tech stack — Vite + React + TypeScript + SVG + Convex client

**Decision.** Renderer is a Vite-bundled React SPA in TypeScript using
`convex/react` for live queries (match picker) and the bare `ConvexClient`
for one-shot batch queries (replay bundle). The grid is rendered as
**inline SVG** with one `<g>` group per layer (walls / cover / chests /
corpses / evac / agents).

**Rationale.**

- **Convex's first-class binding is `convex/react`.** Match picker uses
  `usePaginatedQuery` against `replay.listMatches` for free reactivity
  (newly-completed matches appear without a refresh). The replay route
  uses `client.query(replay.getReplayBundle, ...)` once on mount — a
  hard-batch read, no subscription, per north-star §3.
- **SVG over canvas for v0.** 100×100 grid, ~28 walls + ~10 cover
  clusters + 12 chests + ≤8 corpses + 8 agents = a few hundred DOM nodes
  worst case. SVG gives free hit-testing for hover (DOM events on each
  `<rect>`/`<circle>`) and zero asset pipeline. Canvas wins at scale we
  don't have. The eventual consumer renderer can re-cook with WebGL when
  fog-of-war and animation force the choice; v0 must not pre-pay that
  cost.
- **TypeScript end-to-end.** The Convex `_generated/api.d.ts` types
  flow through `convex/react`; bundle shapes are typed via the
  generated `Doc<T>` aliases from
  `convex/_generated/dataModel.d.ts` (per ADR §7 — schema validators
  in `convex/schema.ts` are local `const`s and not exported, so the
  `Doc<T>` route is the only viable type-sharing path that keeps the
  schema file unchanged).
- **Vite is the boring choice.** Fast HMR, native TS+JSX, native JSON
  imports (the renderer reads `maps/reference.json` directly per README
  §9.5), zero ceremony. No SSR, no router beyond hash routes, no global
  state library — `useState` + URL params are enough.

**Alternatives considered.**

- **Svelte / SvelteKit.** Fewer ceremony lines, but Convex's React
  binding is more mature and any deferred Convex ergonomic gain costs
  more to discover than React's ergonomics save.
- **Plain HTML + canvas + vanilla TS.** Most pragmatic, zero framework
  weight. Rejected because the side-panel feed (collapsibles, dynamic
  list of 8 agents × N turns, scroll, expand/collapse state per row)
  is exactly the territory where component frameworks pay off and
  hand-rolled DOM diffing rots.
- **Next.js / React Router with SSR.** Overkill for a local-only
  diagnostic tool. SSR has nothing to render against (Convex deployment
  is the user's own).
- **Tauri / Electron desktop wrapper.** No deploy target → no need.
- **WebGL / pixi.js.** Premature optimisation; SVG handles the count
  comfortably and gives free DOM-level hover affordances.

**Consequences.**

- A new top-level `apps/replay/` directory with its own `package.json`,
  `vite.config.ts`, `tsconfig.json`. Root `package.json` adds a
  passthrough script `dev:replay` that forwards to the sub-package.
- The renderer depends on `convex` (already a root dep) + `react`,
  `react-dom`, `@types/react`. No `react-router` — hash routing
  (`#/match/<id>`) is enough for two routes.
- Linting / typechecking are wired through the renderer's own
  `tsconfig.json` + a renderer-scoped ESLint extension of root
  `eslint.config.mjs`. Root `npm run lint` + `npm run typecheck` cover
  both packages.
- The user (or the user's machine) runs the renderer locally — no CI
  build, no deploy artifact.

---

## 2. App directory layout — `apps/replay/`

**Decision.** New top-level directory `apps/replay/`. Self-contained
sub-package with its own `package.json`, `tsconfig.json`, `vite.config.ts`.
Sibling to `convex/`, `harness/`, `personas/`, `maps/`, `tests/`.

```
context-battler/
├── apps/
│   └── replay/                    # NEW (this phase)
│       ├── index.html
│       ├── package.json
│       ├── vite.config.ts
│       ├── tsconfig.json
│       ├── public/
│       └── src/
│           ├── main.tsx           # ConvexProvider + router root
│           ├── routes/
│           │   ├── MatchPicker.tsx
│           │   └── Replay.tsx
│           ├── components/
│           │   ├── Grid.tsx       # SVG bird's-eye renderer
│           │   ├── TurnStepper.tsx
│           │   ├── TurnFeed.tsx   # side-panel agent rows
│           │   ├── HoverCard.tsx
│           │   └── ExpandModal.tsx
│           └── lib/
│               ├── convexClient.ts
│               ├── reconstruct.ts # pure: bundle + turn → entity state
│               ├── decisionEnglish.ts # pure: decision + actions → English
│               └── bundleTypes.ts # Doc<T> projections from convex/_generated
├── convex/
│   ├── replay.ts                  # NEW (this phase)
│   └── (everything else untouched)
├── harness/
├── maps/
├── personas/
├── tests/
└── package.json
```

**Rationale.**

- **`apps/` parent signals plurality.** The eventual consumer renderer
  will live as a sibling (e.g. `apps/spectator/`) and has different
  constraints; isolating each app's package keeps the dependency surfaces
  clean (the v0 overseer should never accidentally pick up consumer-
  renderer deps and vice-versa).
- **Sibling-of-`convex/`, not nested.** `apps/replay/` imports types
  *from* `convex/_generated/` and `convex/schema.ts` (Convex codegen
  emits a typed API surface); a nesting like `convex/apps/replay/` would
  imply Convex *deploys* the renderer, which it doesn't.
- **Sibling-of-`harness/`, not nested.** The harness is a Node CLI that
  shells out to the Convex client; the renderer is a browser app. Both
  are read consumers of Convex state, but their runtime shapes differ.
- **Tests live in `apps/replay/src/lib/__tests__/`** (Vitest workspace
  conventions for sub-packages). The root `vitest.config.ts` is extended
  to include the sub-package's tests via Vitest workspace config so
  `npm test` at root runs both. Alternative: keep separate test runs
  per package — rejected because it forces the user to remember two
  commands.

**Alternatives considered.**

- **`web/` instead of `apps/replay/`.** `web/` would suit a single-app
  monolith. We already know a second app is coming (the consumer
  renderer is north-star-promised); committing now to `apps/<name>/`
  costs nothing and avoids a rename later.
- **Nested under `harness/replay/`.** Rejected: harness is a Node CLI
  surface; nesting a browser SPA inside it muddles the runtime story.
- **Side-package via `pnpm workspaces` in monorepo style.** Rejected:
  ADR phase 1 §1 explicitly chose "single package, no monorepo". We're
  splitting one workspace into a renderer sub-package; we are not
  introducing a workspace tool. The `apps/replay/package.json` is a
  *standalone* package the root invokes via `--prefix`, not a workspace
  member. Easier to migrate to workspaces later if a second renderer
  forces it.

**Consequences.**

- Root `package.json` gets a new script `dev:replay` →
  `npm --prefix apps/replay run dev`. Optionally `build:replay` →
  `npm --prefix apps/replay run build` for the user to produce a static
  bundle (no deploy target, but useful for sanity).
- Vitest config at root extends to include `apps/replay/src/**/*.test.ts`.
- `.gitignore` adds `apps/replay/node_modules/` and `apps/replay/dist/`.
- ESLint config at root is extended to lint `apps/replay/src/**/*.{ts,tsx}`
  with a scoped JSX-aware variant of the root rules.

---

## 3. New Convex query module — `convex/replay.ts`

**Decision.** A new module `convex/replay.ts` (default Convex runtime —
no `"use node"`, no fs, no fetch) exposes two read queries:

```ts
// Pagination of completed matches, reverse-chronological by _creationTime.
// The `by_status` index narrows to status==="completed" server-side; the
// `order("desc")` reverses creation order so newest matches surface first.
export const listMatches = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    return await ctx.db
      .query("matches")
      .withIndex("by_status", (q) => q.eq("status", "completed"))
      .order("desc")
      .paginate(paginationOpts);
  },
});

// Single batch fetch: everything the replay route needs in ONE round trip.
export const getReplayBundle = query({
  args: { matchId: v.id("matches") },
  handler: async (ctx, { matchId }) => {
    const match = await ctx.db.get(matchId);
    if (!match) return null;
    const turns = await ctx.db
      .query("turns")
      .withIndex("by_match_turn", (q) => q.eq("matchId", matchId))
      .order("asc")
      .collect();
    const characters = await ctx.db
      .query("characters")
      .withIndex("by_match", (q) => q.eq("matchId", matchId))
      .collect();
    // worldState has no `by_match` index in the phase-1 schema
    // (`convex/schema.ts:498-508`); use `.filter()` for the 1:1
    // matchId lookup. The table has ~50 rows in dev — the scan is
    // free at this size. `.unique()` enforces "one row per match";
    // a missing or duplicate row throws.
    const worldState = await ctx.db
      .query("worldState")
      .filter((q) => q.eq(q.field("matchId"), matchId))
      .unique();
    return { match, turns, characters, worldState };
  },
});
```

(Exact handler spelling is WP-A's responsibility; the shape above is the
contract.)

The match-picker page surfaces, per row, fields the user can choose by:
`matchId`, `startedAt`, `status`, `turn` (current turn count, equals 50
for completed matches), `outcome.extracted.length`,
`outcome.lastSurvivor` if any. These all exist on the `matches` row
already; no schema change.

**Rationale.**

- **One module owns the renderer's read contract.** A reviewer auditing
  "what does the renderer ask of Convex?" reads one file. Engine queries
  (`convex/turns.ts`, `convex/matches.ts`, `convex/runs.ts`,
  `convex/reports.ts`) keep their phase-1 ergonomics — no diff.
- **One bundle endpoint per north-star §3.** "No mid-replay round-trips"
  is enforced at the contract layer: the renderer can only ask for the
  whole bundle, by design.
- **No engine logic in this module.** Per ADR phase 1 §1 / architecture
  §1, queries are thin DB reads; aggregation lives in pure helpers (none
  needed here — the renderer does its own walk).
- **`worldState` access pattern.** The phase-1 schema has `worldState`
  keyed by `matchId` but no index by `matchId` (it's a 1:1 relationship
  with `matches` and the existing query in `convex/matches.ts:get` and
  `convex/runMatch.ts` use a `.filter()`). WP-A's acceptance bullet
  includes adding a `by_match` index on `worldState` if the filter
  performs poorly at the user's data size; the schema change is
  trivially additive (new index, no field change). **If avoidable:**
  use `.filter()` for v0 — there's exactly one row per match, the
  filter scan reads everything once and returns it fast for the user's
  ~50-row dev deployment.

**Alternatives considered.**

- **Extend `convex/turns.ts` with a `getReplayBundle`.** Rejected:
  `turns.ts` is the trace-introspection module (per its file header,
  ADR §7 contract). Adding a multi-table fetch there blurs the slice
  boundary.
- **Inline the bundle assembly client-side via four parallel
  `useQuery`s.** Rejected: violates north-star §3 ("no mid-replay
  round-trips"). Also produces a worse first-paint UX as the four
  queries resolve at different times.
- **A reactive `useQuery(replay.getReplayBundle, ...)` instead of
  one-shot.** Allowed by the API but unnecessary; the match is
  *completed* (status terminal), the data does not change after that
  point. One-shot via `client.query()` saves the subscription overhead
  and matches the phase 2 north-star posture.

**Consequences.**

- WP-A adds `convex/replay.ts` with `listMatches` only.
- WP-B adds `getReplayBundle` to the same module.
- No schema change required for v0. If `worldState` reads benefit from
  a `by_match` index, that addition is in WP-B's scope and is purely
  additive (no migration).
- The Convex codegen `convex/_generated/api.d.ts` exposes the new
  module's types; the renderer imports `api.replay.listMatches` and
  `api.replay.getReplayBundle` directly.

---

## 4. Position-reconstruction walk — pure module in renderer

**Decision.** A pure TypeScript module at
`apps/replay/src/lib/reconstruct.ts` exposes:

```ts
export type ReplayBundle = {
  match: MatchRow;
  turns: TurnRow[];          // ascending by .turn, length ≤ 51 (turn 0..50)
  worldState: WorldStateRow;
  characters: CharacterRow[];
};

export type EntitySnapshot = {
  turn: number;
  characters: Array<{
    characterId: Id<"characters">;
    personaId: PersonaId;
    pos: Tile;
    alive: boolean;
    hidden: boolean;
    diedAtTurn: number | null;
    extractedAtTurn: number | null;   // null = still in arena; see walk rule 2.x below
    // Equipment + HP for live agents are NOT derivable from the ledger in
    // v0 (per D-P2-11). The hover card displays "see expand panel"; the
    // expand modal surfaces the agent's own view via
    // `agentRecord.input.visibleStateDigest`. These two fields are kept
    // in the snapshot type for completeness but are always `null` in v0.
    equipped: null;
    hp: null;
  }>;
  corpses: Array<{
    characterId: Id<"characters">;
    pos: Tile;
    contents: Equipped;
  }>;
  chests: Array<{
    id: string;
    pos: Tile;
    opened: boolean;
    contents: ItemRef | null;
  }>;
  evacRevealed: boolean;
};

export function reconstruct(bundle: ReplayBundle, atTurn: number): EntitySnapshot;
```

The function walks `bundle.turns` from index 0 up to (and including) the
row with `.turn === atTurn`, accumulating state. Initial positions for
turn 0 come from `characters[].spawnIndex` × `maps/reference.json`'s
`spawns[]` (imported directly into the renderer; see README §9.5).

**Walk rules** (one source of truth, anchored to `concept-spec.md` §23
resolution-order semantics; turn numbering anchored to D-P2-13).

The walk operates in **turn-number space**, NOT array-index space. The
first ledger row is `turn === 1` (per `convex/runMatch.ts:461` —
`currentTurn = matchRow.turn + 1`, and `matches.start` writes `turn: 0`
on the row but produces no `turns` row for turn 0). `turn === 0` is a
**synthetic pre-game snapshot**: spawn positions, no actions, no
agentRecords. Build `turnRowByTurn = new Map<number, TurnRow>()` and
look up `turnRowByTurn.get(t)` rather than indexing into `bundle.turns`.

1. **Synthetic turn-0 state.** For each `c` in `characters`, pos =
   `spawns[c.spawnIndex]` (sourced from `maps/reference.json`),
   alive = true, hidden = false, diedAtTurn = null,
   extractedAtTurn = null, equipped = null, hp = null. Chests =
   `worldState.chests` *with `.opened` forced false* (worldState is
   terminal — chests there reflect end-of-match opened state). Corpses =
   empty. Evac revealed = false. No agentRecords.
2. **For `t = 1..atTurn`,** look up `row = turnRowByTurn.get(t)`. If
   missing (a turn the match never reached, e.g. atTurn > match.turn),
   stop. Otherwise apply `row.resolution` in this order (mirrors
   `concept-spec.md` §23 phases 2/3/4/6/7 — the renderer skips speech
   and consumables for snapshot purposes; both surface in the side-panel
   feed only):
   - `resolution.moves[]`: for each move, set the named character's
     `pos = move.to`. Characters without a moves entry on this turn
     keep their previous pos (`move.kind === "none"` produces no entry).
   - `resolution.actions[]`:
     - `kind === "interact"` with `result === "opened"` → flip the
       chest's `opened` to true. Per D-P2-12, opened-chest contents are
       not persisted post-open (`worldState.chests[i].contents` is
       cleared to `null` by the engine — `resolution.ts:537`). Hover
       card on an opened chest shows "contents not persisted".
     - `kind === "interact"` with any other `result`
       (`already_opened` / `no_chest` / `out_of_range`) → no state
       change.
     - `kind === "loot"` with `result === "looted"` → no snapshot-state
       change (live equipment state is not tracked per D-P2-11).
     - `kind === "loot"` with any other `result`
       (`no_corpse` / `out_of_range`) → no state change.
     - `kind === "attack"` results never alter snapshot state directly
       (damage is observable via `resolution.deaths[]`; HP is not
       tracked per D-P2-11).
     - **No `kind: "extract"` action exists** (per D-P2-13 — extraction
       is a phase-8 mutation, not an action). See rule 4 below for
       extraction detection.
   - `resolution.deaths[]`: for each dead character, set
     `alive = false`, `diedAtTurn = t`. Create a corpse at the
     character's *current* pos (their last move-to, or their initial
     pos if they never moved). Corpse `contents` come from
     `worldState.corpses[]` at the *terminal* state and are matched by
     `characterId`; this is the engine-authored truth and is the
     authoritative source for corpse-contents display (per D-P2-11
     fallback strategy).
   - `resolution.visibilityUpdates[]`: set each named character's
     `hidden = update.hidden`. (For ground-truth view this is purely
     informational — the renderer never hides anyone visually; hover
     surfaces the flag.)
3. **Evac reveal:** turn 30 onward (per `concept-spec.md` §15).
   `worldState.evac.revealedAtTurn` is the canonical signal; when ≤ atTurn,
   set `evacRevealed = true`. (Also a 3×3 zone visible always — the v0
   renderer just labels the centre tile and draws a ring; the reveal
   flag changes the visual cue on the side-panel only.)
4. **Extraction (phase-8 mutation, not an action).** Per
   `convex/engine/resolution.ts:719`, extraction is recorded by
   mutating `characters[c].extractedAtTurn` during phase 8 — there is
   **no `kind: "extract"` entry** in `resolution.actions[]`. Read
   extraction from the bundle's terminal `characters[]` row: for each
   `c` in `bundle.characters`, if `c.extractedAtTurn !== null` and
   `c.extractedAtTurn <= atTurn`, mark
   `snapshot.characters[c].extractedAtTurn = c.extractedAtTurn`. The
   token is hidden from the grid for `t > extractedAtTurn`, with a
   "extracted turn N" marker in the feed.

**Determinism / unit-testability.** The function takes a typed bundle
and returns a typed snapshot. No I/O. Vitest tests cover (de-risking.md
§1 enumerates):

- Spawn positions for synthetic turn 0 of an 8-character bundle (no
  ledger row consulted; sourced from spawnIndex × `maps/reference.json`).
- Move accumulation across 3 turns.
- Stationary character (no moves entry) keeps position.
- Death produces corpse at last-known position from turn N onward;
  corpse contents come from terminal `worldState.corpses[]`.
- Chest opens at the right turn and stays open; contents render as
  "not persisted" on hover.
- `hidden` flag toggles via `visibilityUpdates`.
- Extraction read from `bundle.characters[c].extractedAtTurn` — token
  hidden from grid for `t > extractedAtTurn`.
- `reconstruct(bundle, T)` called twice in succession is structurally
  equal (idempotency / no closure state).
- Backward jump: `reconstruct(bundle, 30)` followed by
  `reconstruct(bundle, 10)` equals a fresh `reconstruct(bundle, 10)`.
- Throws on missing `spawnIndex` (defensive failure surfaces phase-1
  invariant violation explicitly).
- Synthetic turn 0 reconstructed without any ledger row (covers the
  D-P2-13 first-row-is-turn-1 invariant).

**Equipment + HP walk caveat (D-P2-11).** Live-agent equipment and HP
are **not derivable from the ledger** in the v0 substrate, and the
substrate stays frozen this phase (D-P2-9):

- The engine emits the generic literals `"opened"` and `"looted"` only
  (`convex/engine/resolution.ts:547,586`). There is no
  `"equipped_<item>"` / `"looted_<item>"` string carrying item
  identity, so there is nothing to parse.
- The `agentRecords[]` schema persists no per-turn HP field
  (`convex/schema.ts:262-271`); HP is not present on the
  `characters` table per turn either (terminal-only).

Therefore the walk **does not attempt** to track per-turn equipment or
HP. The snapshot's `characters[i].equipped` and `characters[i].hp` are
always `null` in v0. The user-facing fallbacks are:

- **Hover card (live agents):** shows persona, displayName, position,
  alive/hidden flags, and the one-line decision summary. Equipment +
  HP rows render as **"see expand panel"**.
- **Expand modal:** the *Visible state digest* tab surfaces
  `agentRecord.input.visibleStateDigest` for the (turn, agent) — that
  digest is the agent's own view of equipped + HP at the start of the
  turn the LLM was prompted on, captured per `agentRecordValidator`
  (ADR §7) and authoritative for the agent's perspective.
- **Hover card (corpses):** corpse contents come from
  `worldState.corpses[]` (engine-authored truth, accumulated as
  characters die — `convex/engine/resolution.ts` death/loot handling).
  Matched by `characterId`. This is the only authoritative,
  ledger-free fallback we have.
- **Hover card (opened chest, D-P2-12):** displays "contents not
  persisted". Engine clears `worldState.chests[i].contents` to `null`
  on open (`resolution.ts:537`); we cannot recover what came out
  without re-running the RNG, which is out of scope for v0.

The de-risking strategy treats equipment / HP / opened-chest contents
as **explicitly out of scope** for the snapshot type; everything else
(positions, deaths, chest open-state, hidden flag, extraction-state)
is exact-derivable from the ledger.

**Alternatives considered.**

- **Persist per-turn equipped/HP state on the schema.** Rejected:
  violates README §4 ("no schema changes"). Phase 1 substrate is
  frozen (D-P2-9).
- **Re-derive opened-chest contents by re-running the engine RNG with
  `match.rngSeed` against `convex/engine/loot.ts`.** Rejected for v0:
  imports engine runtime into the renderer slice (architecture §1
  forbids it) and pre-pays a debugging surface that the user has not
  asked for. Re-evaluate if a future phase surfaces a need.
- **Compute equipped server-side in `getReplayBundle`.** Rejected: that
  duplicates engine logic into the query slice, which is exactly the
  coupling architecture §1 forbids.

**Consequences.** A focused pure module that's the only piece of
non-trivial logic in the renderer. Unit-tested in isolation; the rest of
the renderer is plumbing.

---

## 5. Decision-as-English renderer — pure module

**Decision.** A pure function at
`apps/replay/src/lib/decisionEnglish.ts`:

```ts
export function summariseDecision(
  agentRecord: AgentRecord,
  resolution: TurnResolution,
  characterById: Map<Id<"characters">, CharacterRow>,
): {
  oneLine: string;       // shown in the collapsed feed row
  bullets: string[];     // shown in the expanded feed row, one per "action axis"
  intentVsOutcome: Array<{ intent: string; outcome: string }>; // attribution
};
```

**Vocabulary** (locked for WP-C — change ⇒ update tests):

- **Consume:** `"none" → "(no consumable)"`, `"heal" → "Drank heal
  potion"`, `"speed" → "Drank speed potion"`. Append actual effect from
  the corresponding `resolution.consumed[]` entry where present.
- **Move kind → English:**
  - `"none"` → `"Stayed put"`
  - `"relative" {dx,dy}` → `"Moved {n} tiles {direction}"` where
    direction is one of the 8 compass words derived from sign(dx)/sign(dy).
  - `"toward_entity" {targetCharacterId}` → `"Moved toward
    <displayName>"`.
  - `"away_from_entity" {targetCharacterId}` → `"Moved away from
    <displayName>"`.
  - `"toward_object" {targetObjectId}` → `"Moved toward chest_NNN"` (or
    corpse).
  - `"toward_evac"` → `"Moved toward evac"`.
- **Action kind → English:**
  - `"none"` → omit the action line.
  - `"attack" {targetCharacterId}` → `"Attacked <displayName>"`.
  - `"interact" {targetObjectId}` → `"Interacted with <chestId>"`.
  - `"loot" {targetCorpseId}` → `"Looted from <corpse-of-displayName>"`.
- **Say:** `"Said: \"…\""` — null collapses to nothing.
- **Overwatch priority:** `"Watching for: …"` — null collapses to
  nothing. When `primary === "overwatch"`, mark the row with an
  overwatch glyph regardless of priority.
- **Scratchpad delta:** if `scratchpad_update` differs from
  `scratchpadBefore`, render a diff-style mini view (truncated to
  ~120 chars, full text in expand modal); if identical, omit the line.

**Result-string vocabulary** — canonical source is
`convex/engine/resolution.ts:374-586`. The full enumeration the
`decisionEnglish.ts` mapping must handle is:

| `kind`     | `result` literal      | English outcome                          |
|------------|-----------------------|------------------------------------------|
| `attack`   | `"dmg N"` (template)  | `"hit (dealt N damage)"` — parse the integer |
| `attack`   | `"no_target"`         | `"target not found"`                     |
| `attack`   | `"out_of_range"`      | `"out of range"`                         |
| `interact` | `"opened"`            | `"opened"`                               |
| `interact` | `"already_opened"`    | `"already opened"`                       |
| `interact` | `"no_chest"`          | `"chest not found"`                      |
| `interact` | `"out_of_range"`      | `"out of range"`                         |
| `loot`     | `"looted"`            | `"looted"`                               |
| `loot`     | `"no_corpse"`         | `"corpse not found"`                     |
| `loot`     | `"out_of_range"`      | `"out of range"`                         |
| `overwatch`| `"dmg N"` (template)  | `"overwatch fire (dealt N damage)"`      |

**Death detection** comes from `resolution.deaths[]` (a separate phase-6
array), NOT from any `result` string. When rendering an attack outcome
in plain English, cross-reference `resolution.deaths[]` for the same
actor/turn to append `" — killed <displayName>"` if the defender died.

**Item identity** is NOT carried on `result`. The engine emits the
generic literals `"opened"` and `"looted"` only — no `equipped_<item>`,
no `looted_<item>`, no `hit`, no `missed`, no `killed`. Earlier drafts
of this plan (and `harness/analyze-match.ts:49-58`) referenced strings
that do not exist in the engine; per D-P2-14 the canonical source is
`convex/engine/resolution.ts`, not `analyze-match.ts`.

**Intent vs outcome.** For each "intent" (move, action, consume), look
up the corresponding entry in `resolution.{moves,actions,consumed}[]`
filtered to the actor's `characterId`. Produce a `{intent, outcome}`
pair. Examples:

- intent: `"Attacked Player_5"`; outcome (from `result: "dmg 12"` plus a
  matching `resolution.deaths[]` entry for Player_5):
  `"hit (dealt 12 damage) — killed Player_5"`.
- intent: `"Attacked Player_5"`; outcome (from `result: "out_of_range"`):
  `"out of range"`.
- intent: `"Interacted with chest_004"`; outcome (from `result: "opened"`):
  `"opened"`. Item identity is not surfaced (see D-P2-12).

This is the **explainability centerpiece** per north-star §11 / mental
model §11. The user sees what the LLM said and what actually happened
side-by-side. No raw JSON in the default view; the expand modal shows
both `agentRecord.decision` and `rawArguments` for full attribution.

**Rationale.** Pure function = trivial Vitest coverage. The vocabulary
above is enumerated directly from
`convex/engine/resolution.ts:374-586`; the lookup table is small and
unit-test-able. Any unrecognised result string surfaces as
`"(unknown result: <raw>)"` so future engine extensions show up as a
visible TODO, not a silent omission.

**Alternatives considered.**

- **Render raw JSON instead.** Rejected per north-star: "tool calls in
  human English, not raw JSON" is the centerpiece.
- **Use an LLM to generate the English.** Rejected: cost, latency,
  determinism, and a circular dependency on the very thing we're
  trying to inspect.

**Consequences.** WP-C owns this module. Tests cover every
`move.kind`, every `action.kind` × every `result` literal in the
vocabulary table above, every consume-action, and the
`resolution.deaths[]` cross-reference (kill suffix on attack outcomes).

---

## 6. Routing + state model

**Decision.** Hash routing (`window.location.hash`):
- `#/` — match-picker page.
- `#/match/<matchId>` — replay page.
- `#/match/<matchId>?turn=N` — replay page with deep-linked turn (the
  slider hydrates from the URL on mount; updates push history shallowly
  so back-button steps the slider).

State lives in:
- **URL** — selected match, current turn.
- **`useState`** — expand-modal open/closed, hover target.
- **No global store.** Bundle is fetched on mount of `Replay.tsx` into
  a `useState`/`useMemo`; `reconstruct(bundle, currentTurn)` is the
  derived snapshot.

**Rationale.** Two routes, no auth, no shared cross-route state. A
router library is overhead. URL-as-state means the user can paste a
link to a specific (match, turn) tuple — useful for the user when they
spot something interesting and want to come back to it.

**Alternatives.**

- `react-router-dom`. Fine but unnecessary for two routes.
- Path routing with Vite SPA fallback. Requires server config; hash
  routing needs none.

**Consequences.** Tiny custom hook `useHashRoute()` in
`apps/replay/src/lib/`; the rest of the routing surface is a `switch`.

---

## 7. Type sharing across the slice boundary

**Decision.** The renderer imports types **exclusively via Convex's
generated `Doc<T>` aliases**:
- `convex/_generated/api.d.ts` — for `useQuery` / `client.query`
  function-reference typing.
- `convex/_generated/dataModel.d.ts` — for `Id<"matches">`,
  `Doc<"matches">`, `Doc<"turns">`, `Doc<"characters">`,
  `Doc<"worldState">`, `Doc<"runs">`, `Doc<"reports">`.
- The bundle types in `apps/replay/src/lib/bundleTypes.ts` are
  expressed as projections of those generated `Doc<T>` types, e.g.

  ```ts
  import type { Doc } from "../../../../convex/_generated/dataModel";
  export type ReplayBundle = {
    match: Doc<"matches">;
    turns: Array<Doc<"turns">>;
    characters: Array<Doc<"characters">>;
    worldState: Doc<"worldState"> | null;
  };
  export type AgentRecord = Doc<"turns">["agentRecords"][number];
  export type TurnResolution = Doc<"turns">["resolution"];
  export type ParsedDecision = AgentRecord["decision"];
  ```

This route is preferred over `Infer<typeof xValidator>` because the
relevant validators (`decisionValidator`, `agentRecordValidator`,
`resolutionValidator`) are local `const`s in `convex/schema.ts` and
**not exported** (per reviewer M3 — verified at `convex/schema.ts:202`,
`262`, `278`). Adding exports just to feed the renderer would be a
schema-file diff with no other reason to exist; using `Doc<T>` aliases
keeps the schema file unchanged and gives the renderer everything it
needs.

The renderer NEVER imports runtime values from `convex/engine/*`,
`convex/llm/*`, `convex/runMatch.ts`. Type-only imports across the
slice boundary are explicitly allowed; runtime imports are blocked by
ESLint's `no-restricted-imports` rule (per WP-A scope).

**Rationale.** Types are a contract surface; runtime engine code is the
implementation behind the contract. Crossing the slice with types is
fine; crossing with runtime values is the exact thing pillar 7
prohibits. `Doc<T>` is the type surface Convex officially exposes —
it stays in sync with the schema automatically every time
`npx convex dev` regenerates `_generated/`.

**Alternatives.**

- **Export the validators from `convex/schema.ts` and use
  `Infer<typeof xValidator>`.** Rejected — that's a schema-file diff
  with no engine-side consumer (the validators are used only inside
  `defineTable`). Per D-P2-9 the substrate stays frozen this phase;
  diffing schema.ts to feed the renderer is exactly the kind of churn
  the freeze rule exists to prevent.
- **Duplicate the types in the renderer.** Rejected — the duplication
  rots the moment a phase-2.5 schema field changes.

**Consequences.** The renderer's TS build imports `Doc<T>` aliases
from `convex/_generated/`. ESLint rules block runtime imports from
`convex/engine|llm|runMatch`. Renderer is never a Convex actions
runtime — so the `"use node"` distinction never applies here.

---

## 8. Out-of-scope decisions deferred to the consumer-renderer phase

Calling these out so they don't get argued prematurely (per north-star
§11 — "decisions for v0 must NOT factor in those requirements"):

- **Final framework choice for the consumer renderer.** WebGL? React
  Native? Tauri? Unanswered. v0's choice does not commit the consumer
  renderer to anything.
- **Asset pipeline / textures / sprite atlases.** Not in v0.
- **Animation timing / easing / interpolation between turns.** Not in v0.
- **Speech bubbles / floating text.** Not in v0.
- **Multi-spectator / room metaphor / live presence.** Not in v0.
- **Mobile / responsive layout.** Not in v0.
- **Auth, accounts, deploy targets.** Not in v0.
- **Vision masks / fog-of-war rendering.** Not in v0.

---

## 9. D-P2-11 — Live-agent equipment + HP not derivable per turn

**Decision.** The walk does NOT track per-turn equipment or HP for live
agents in v0. The snapshot's `characters[i].equipped` and
`characters[i].hp` are always `null`. Hover card displays "see expand
panel"; expand modal surfaces `agentRecord.input.visibleStateDigest`
for the agent's own view.

**Why.** The engine ledger does not carry the data:

- `convex/engine/resolution.ts:547,586` emit only the generic literals
  `"opened"` and `"looted"` on `interact`/`loot` actions — no item
  identity. Earlier drafts of this plan referenced
  `equipped_<item>` / `looted_<item>` strings; the engine never emits
  those (verified by grep across `convex/engine/`).
- `agentRecordValidator` (`convex/schema.ts:262-271`) carries no HP
  field. `characters` table has terminal-only HP, not per-turn.

**Why we accept the gap.** Per D-P2-9 the substrate stays frozen this
phase. Adding per-turn equipment/HP fields would be a schema change
that pre-pays a debugging surface the user has not asked for; the
captured `visibleStateDigest` already gives the user the agent's
authoritative view. Extracting that on click is sufficient for the
vibe-judgement success criterion (D-P2-10).

**Alternatives.** Re-derive equipment by re-running the loot RNG
deterministically from `match.rngSeed` — rejected, imports engine
runtime into the renderer slice (architecture §1).

**Consequences.** Consumed by ADR §4 walk rules (snapshot fields hard
`null`), WP-B reconstruct test list (no equipment-walk test), WP-D
hover card scope ("see expand panel" copy).

---

## 10. D-P2-12 — Opened-chest contents not persisted in v0

**Decision.** The hover card on an opened chest displays "contents not
persisted". The walk does NOT attempt to recover what came out of an
opened chest. No RNG-based loot derivation in v0.

**Why.** Engine clears `worldState.chests[i].contents` to `null` at
`convex/engine/resolution.ts:537` when opening succeeds:

```ts
const newChests = working.world.chests.map((c) =>
  c.id === ev.chestId ? { ...c, opened: true, contents: null } : c,
);
```

The terminal `worldState.chests[]` therefore preserves only the
opened-flag; the original contents are lost. There is no
`resolution.actions[*]` field that carries item identity for `opened`
(only `result: "opened"`).

**Why we accept the gap.** Re-deriving loot would require either
re-running the engine RNG against `match.rngSeed` + `convex/engine/loot.ts`
(forbidden per architecture §1) or persisting opened-chest contents
on the schema (forbidden per D-P2-9). The user has not flagged loot
identity as vibe-critical for v0; the side-panel feed will surface
the *agent's* equip transition implicitly when the agent's
scratchpad / `say` reflects it.

**Consequences.** WP-D hover card displays an explicit "contents not
persisted" line for opened chests. UAT checklist updated to expect
this copy.

---

## 11. D-P2-13 — Turn 0 is synthetic; UI keys turns by turn-number

**Decision.** The walk + UI key turns by **turn-number**, not array
index. Turn 0 is a synthetic pre-game snapshot derived from
`characters[].spawnIndex` × `maps/reference.json`'s `spawns[]`. The
first ledger row is `turn === 1`. UI slider range is
`0..bundle.match.turn`.

**Why.** `convex/runMatch.ts:461` sets
`currentTurn = matchRow.turn + 1` and `matches.start` writes the
match row at `turn: 0` without producing a `turns` ledger row, so the
first `turns` row written is at `turn === 1`. Indexing
`bundle.turns[currentTurn]` would be off-by-one against the turn the
user is looking at.

**How it lands.**

- The walk constructs `turnRowByTurn = new Map<number, TurnRow>()`
  once per bundle, keyed by `row.turn`.
- `reconstruct(bundle, 0)` synthesises the snapshot from spawn
  positions; **no ledger row is consulted**.
- `reconstruct(bundle, t)` for `t >= 1` looks up
  `turnRowByTurn.get(t)` and applies its `resolution`.
- The slider's range is `0..bundle.match.turn` inclusive of the
  synthetic turn 0.

**Consequences.** Encoded in ADR §4 walk rules, WP-C stepper +
TurnFeed scope, de-risking §1.9.

---

## 12. D-P2-14 — Result-string vocabulary canonical source

**Decision.** The canonical source for the `result:` literals
emitted in `resolution.actions[*]` is
`convex/engine/resolution.ts:374-586`. The vocabulary table in ADR §5
is derived directly from those line ranges and is the contract for
`decisionEnglish.ts` tests.

**Why.** Earlier drafts of this plan referenced
`harness/analyze-match.ts:49-58` and listed result strings
(`"hit"`, `"missed"`, `"killed"`, `"equipped_<item>"`,
`"looted_<item>"`) that the engine **does not emit**. The
analyze-match tool was written against a stale mental model of the
engine and has not been updated; using it as a vocabulary reference
would produce a `decisionEnglish.ts` whose tests pass only on the
stale string set and fail on every real engine emission.

**Locked enumeration** (engine emissions only):

| `kind`     | `result` literal      |
|------------|-----------------------|
| `attack`   | `"dmg N"` (template)  |
| `attack`   | `"no_target"`         |
| `attack`   | `"out_of_range"`      |
| `interact` | `"opened"`            |
| `interact` | `"already_opened"`    |
| `interact` | `"no_chest"`          |
| `interact` | `"out_of_range"`      |
| `loot`     | `"looted"`            |
| `loot`     | `"no_corpse"`         |
| `loot`     | `"out_of_range"`      |
| `overwatch`| `"dmg N"` (template)  |

Death detection comes from `resolution.deaths[]`, not from any
`result` string. Item identity is NOT carried on `result`.

**Consequences.** Consumed by ADR §5 vocabulary table, WP-C
test list (every literal × every kind), de-risking §3 (drops
analyze-match.ts as a reference). Future engine extensions to the
result-string set surface as `"(unknown result: <raw>)"` in the feed
rather than silent omissions.
