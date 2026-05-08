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
- **TypeScript end-to-end.** The Convex `_generated/api.d.ts` types flow
  through `convex/react`; bundle shapes are typed by re-importing the
  validators from `convex/schema.ts` (or a focused re-export) at the
  type level only.
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
│               └── bundleTypes.ts # type-level re-exports from convex/schema
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
// Pagination of matches, reverse-chronological by startedAt.
export const listMatches = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    return await ctx.db
      .query("matches")
      .withIndex("by_status")              // any index — order overrides
      .order("desc")                        // by _creationTime
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
    const worldState = await ctx.db
      .query("worldState")
      .withSearchIndex(/* none — see below */)
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
    // Best-effort current equipped state derived from action results;
    // see WP-B/§4 "equipment-state walk" caveat below.
    equipped: Equipped;
    hp: number | null;          // null = unknown (we don't track HP per turn — see consequences)
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
resolution-order semantics):

1. **Initial state (before turn 0):** for each `c` in `characters`, pos =
   `spawns[c.spawnIndex]`, alive = true, hidden = false, equipped = {},
   diedAtTurn = null. Chests = `worldState.chests` *with `.opened`
   forced false* (worldState is terminal — chests there reflect
   end-of-match opened state). Corpses = empty. Evac revealed = false.
2. **For each `turn` row 0..atTurn:**
   - Apply `resolution.consumed[]` (informational; consumable equipped
     slot transitions are inferred via subsequent action `result` since
     equip-deltas don't have a dedicated phase).
   - Apply `resolution.moves[]`: for each move, set the named character's
     `pos = move.to`. Characters without a moves entry on this turn
     keep their previous pos (move.kind === "none" produces no entry).
   - Apply `resolution.actions[]`:
     - `kind === "interact"` with `result === "opened"` → flip the
       chest's `opened` to true and clear its contents (or keep contents
       for hover display; WP-D scope).
     - `kind === "interact"` with `result === "equipped_*"` → record
       the equip transition for the actor (best-effort parse of result
       string; see equipment-state caveat below).
     - `kind === "loot"` similar — corpse contents transfer.
     - `kind === "extract"` — the actor leaves the grid; mark
       `extractedAtTurn = turn`. Their token can be hidden in the
       grid view from turn+1 onward, with a fact bubble in the feed.
   - Apply `resolution.deaths[]`: for each dead character, set
     `alive = false`, `diedAtTurn = turn`. Create a corpse at the
     character's *current* pos (their last move-to, or their initial
     pos if they never moved). The corpse's contents come from the
     character's equipped slots at time of death — best-effort from the
     accumulated equipped walk.
   - Apply `resolution.visibilityUpdates[]`: set each named character's
     `hidden = update.hidden`. (For ground-truth view this is purely
     informational — the renderer never hides anyone visually; hover
     surfaces the flag.)
3. **Evac reveal:** turn 30 onward (per `concept-spec.md` §15).
   `worldState.evac.revealedAtTurn` is the canonical signal; when ≤ atTurn,
   set `evacRevealed = true`. (Also a 3×3 zone visible always — the v0
   renderer just labels the centre tile and draws a ring; the reveal
   flag changes the visual cue on the side-panel only.)

**Determinism / unit-testability.** The function takes a typed bundle
and returns a typed snapshot. No I/O. Vitest tests cover (de-risking.md
§1 enumerates):

- Spawn positions for turn 0 of a synthetic 8-character bundle.
- Move accumulation across 3 turns.
- Stationary character (no moves entry) keeps position.
- Death produces corpse at last-known position from turn N onward.
- Chest opens at the right turn and stays open.
- `hidden` flag toggles via `visibilityUpdates`.
- `reconstruct(bundle, T)` and `reconstruct(bundle, T)` after replay are
  byte-equal (idempotency).
- Backward jump: `reconstruct(bundle, 30)` followed by
  `reconstruct(bundle, 10)` equals a fresh `reconstruct(bundle, 10)`
  (no hidden state in the function).

**Equipment-state walk caveat.** The phase-1 schema does NOT persist
`equipped` per-turn. The pure aggregator can reconstruct it from
`resolution.actions[].result` (e.g. `result: "equipped_sword"`,
`"equipped_leather_armour"`, `"looted_consumable_heal"`) — but the
result strings are produced by `convex/engine/loot.ts` /
`convex/engine/affordances.ts` and may not be a perfectly stable parse
target. Two mitigations:

- **Best-effort parse with a fallback.** The hover card shows
  *"equipped at last action: <text>"* if the parse succeeds, or
  *"equipped state at this turn: unknown — see expand panel"* otherwise.
  The expand panel shows `agentRecord.input.visibleStateDigest` which
  contains the agent's own view of equipped (the LLM saw it; the
  digest reflects it).
- **Authoritative fallback:** for the corpse-contents display
  specifically, use the *actual* `worldState.corpses[]` from the
  bundle, which is the engine-authored truth. (Corpses are accumulated
  in `worldState`; once dead, the contents are stable.) This sidesteps
  parse-fragility for the most user-facing surface.

The de-risking strategy treats *equipment-state for live characters* as
the *only* tolerable best-effort surface; everything else (positions,
deaths, chest open-state, hidden flag) is exact-derivable from the
ledger.

**Alternatives considered.**

- **Persist per-turn equipped state on the schema.** Rejected: violates
  README §4 ("no schema changes"). Phase 1 substrate is frozen.
- **Compute equipped server-side in `getReplayBundle`.** Rejected: that
  duplicates engine logic into the query slice, which is exactly the
  coupling architecture §1 forbids.
- **Skip equipment display in v0.** Tempted. Acceptable fallback; if
  the parse turns out to be too fragile, WP-D's hover card drops the
  equipped line silently rather than showing wrong data.

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

**Intent vs outcome.** For each "intent" (move, action, consume), look
up the corresponding entry in `resolution.{moves,actions,consumed}[]`
filtered to the actor's `characterId`. Produce a `{intent, outcome}`
pair. Examples:

- intent: `"Attacked Player_5"`; outcome:
  `"hit (dealt 12 damage)"` from `resolution.actions[*].result`.
- intent: `"Attacked Player_5"`; outcome: `"out of range"`.
- intent: `"Moved toward chest_004"`; outcome:
  `"moved 6 tiles, blocked at (45, 50)"`.

This is the **explainability centerpiece** per north-star §11 / mental
model §11. The user sees what the LLM said and what actually happened
side-by-side. No raw JSON in the default view; the expand modal shows
both `agentRecord.decision` and `rawArguments` for full attribution.

**Rationale.** Pure function = trivial Vitest coverage. Result strings
in `resolution.actions[*].result` come from one of a small number of
fixed strings (`"hit"`, `"missed"`, `"out_of_range"`, `"killed"`,
`"opened"`, `"equipped_<item>"`, etc. — `harness/analyze-match.ts`
enumerates them at lines 49–58); the lookup table is small and
unit-test-able.

**Alternatives considered.**

- **Render raw JSON instead.** Rejected per north-star: "tool calls in
  human English, not raw JSON" is the centerpiece.
- **Use an LLM to generate the English.** Rejected: cost, latency,
  determinism, and a circular dependency on the very thing we're
  trying to inspect.

**Consequences.** WP-C owns this module. Tests cover every
`move.kind`, every `action.kind`, every result-string in
`harness/analyze-match.ts`'s enumeration, every consume-action.

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

**Decision.** The renderer imports types from:
- `convex/_generated/api.d.ts` — for `useQuery`/`client.query` typing.
- `convex/_generated/dataModel.d.ts` — for `Id<"matches">` etc.
- A new tiny re-export at `apps/replay/src/lib/bundleTypes.ts` that
  type-aliases the bundle shape from the validators in
  `convex/schema.ts` *at the type level only* (`type X =
  Infer<typeof xValidator>`).

The renderer NEVER imports runtime values from `convex/engine/*`,
`convex/llm/*`, `convex/runMatch.ts`. Type-only imports are tracked by
ESLint's `no-restricted-imports` (or equivalent boundary rule) for
clarity.

**Rationale.** Types are a contract surface; runtime engine code is the
implementation behind the contract. Crossing the slice with types is
fine; crossing with runtime values is the exact thing pillar 7
prohibits.

**Alternatives.** Duplicate the types in the renderer. Rejected — the
duplication rots the moment a phase-2.5 schema field changes.

**Consequences.** The renderer's TS build can import any
`convex/_generated/` type. ESLint rules block runtime imports from
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
