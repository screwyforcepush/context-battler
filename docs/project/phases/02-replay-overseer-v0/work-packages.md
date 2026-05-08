# Phase 02 — Work Packages

> Four work packages sequenced into Foundation → Reconstruction → Inspection,
> with explicit dependency arrows from `README.md` §6. Every WP has scope,
> acceptance, test strategy, and risks. Tests-first per `.agents/AGENTS.md`
> AOP for the two pure modules (position-reconstruction, decision-as-English);
> everything else is plumbing exercised via manual UAT in the browser.

WP IDs use letters (WP-A, WP-B, WP-C, WP-D) rather than numbers — this is
phase 2 v0; using letters avoids any visual collision with phase-1 WP
numbering during code review.

---

# Foundation — sequencing

WP-A lands first. WP-B follows. WP-C and WP-D run in parallel after WP-B
because their write sets are disjoint (feed component vs. hover/expand
overlays).

---

## WP-A — Renderer skeleton + match picker (FOUNDATION-FIRST)

**Scope.**

- Create `apps/replay/` with Vite + React + TypeScript + `convex/react`.
  Files (per `architecture-decisions.md` §2):
  - `apps/replay/package.json` (devDeps: `vite`, `@vitejs/plugin-react`,
    `typescript`, `@types/react`, `@types/react-dom`; deps: `react`,
    `react-dom`, `convex`).
  - `apps/replay/vite.config.ts` (`@vitejs/plugin-react`, dev server on
    port 5173). **Must set `server.fs.allow: ['..', '../..']`** so that
    `import '../../maps/reference.json'` from `reconstruct.ts`
    resolves — Vite's default policy confines reads to the project
    root (`apps/replay/`) and would otherwise deny the cross-package
    import (per M2 review).
  - `apps/replay/tsconfig.json` (`compilerOptions.jsx: "react-jsx"`,
    `compilerOptions.lib: ["ES2022", "DOM", "DOM.Iterable"]`,
    `compilerOptions.module: "ESNext"`,
    `compilerOptions.moduleResolution: "Bundler"`, includes
    `src/**/*` plus type-only imports from `../../convex/_generated/`
    and `../../convex/schema.ts`).
  - `apps/replay/index.html` (mount point `<div id="root"></div>`).
  - `apps/replay/src/main.tsx` — `ConvexProvider` wraps the app, hash
    router decides between `MatchPicker` and `Replay`.
  - `apps/replay/src/lib/convexClient.ts` — wraps
    `new ConvexReactClient(import.meta.env.VITE_CONVEX_URL)`.
  - `apps/replay/src/lib/useHashRoute.ts` — hook returning the parsed
    hash route.
  - `apps/replay/src/routes/MatchPicker.tsx` — paginated table.
- Wire the root `package.json` scripts:
  - `dev:replay` → `npm --prefix apps/replay run dev`.
  - **`typecheck`** must be updated to also run
    `npm --prefix apps/replay run typecheck` (or, equivalently, switch
    to TypeScript project references — root-level decision is fine
    either way as long as `npm run typecheck` from repo root covers
    both packages). The current root script is plain
    `tsc --noEmit` which would miss `apps/replay/`.
  - Document `VITE_CONVEX_URL=<dev-deployment-url>` in
    `apps/replay/.env.example`.
- Wire root tooling:
  - `eslint.config.mjs` — add a dedicated `files` block for
    `apps/replay/src/**/*.{ts,tsx}` with React/JSX-aware rules. Add a
    `no-restricted-imports` rule blocking runtime imports of
    `convex/engine/*`, `convex/llm/*`, `convex/runMatch.ts`,
    `convex/_internal_runMatch.ts` from `apps/replay/src/**` (per ADR
    §7). Type-only imports across the slice boundary remain allowed.
  - `vitest.config.ts` — extend `include` to cover
    `apps/replay/src/**/*.test.ts(x)`.
  - `.gitignore` — add `apps/replay/node_modules/`,
    `apps/replay/dist/`, `apps/replay/.env`.
- Add a new Convex query module **`convex/replay.ts`** with **only**
  `listMatches({ paginationOpts })` for now (`getReplayBundle` lands in
  WP-B). Default Convex runtime; pure DB read.

  Implementation contract (M1 — restored from north-star §3 row
  metadata):

  ```ts
  // Filter to completed matches; reverse-chronological by _creationTime.
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
  ```

  Each match row already includes `outcome.extracted[]` and
  `outcome.lastSurvivor` (per `convex/schema.ts` matches.outcome).
  Renderer surfaces both directly — no secondary query needed.
- `apps/replay/src/routes/MatchPicker.tsx` uses
  `usePaginatedQuery(api.replay.listMatches, {}, { initialNumItems: 20 })`
  and renders a table with columns: matchId (truncated to 8 chars),
  `startedAt` (relative time), `status`, `turn`,
  `outcome.extracted.length`, **`outcome.lastSurvivor`** (rendered as
  the truncated character id — the field is `v.id("characters")`,
  not a displayName, per `convex/schema.ts:453`; if `undefined`,
  render "—"). DisplayName resolution happens inside the replay view
  once the bundle's `characters[]` is loaded; for the picker, the id
  is enough to disambiguate matches. Each row is a hyperlink to
  `#/match/<matchId>`.
- `apps/replay/src/routes/Replay.tsx` — stub component. Renders a "TODO
  WP-B" placeholder reading the matchId from the route.
- `apps/replay/README.md` — one-liner with `npm install` +
  `npm run dev` + `VITE_CONVEX_URL` instructions.

**Acceptance.**

- `npm install` from repo root and `npm install --prefix apps/replay`
  both succeed (or, if root install picks up the sub-package install
  via a postinstall hook, that's fine — document the actual command).
- `npm --prefix apps/replay run dev` starts a Vite server at
  `http://localhost:5173`.
- Visiting `http://localhost:5173/` (with `VITE_CONVEX_URL` set to the
  user's dev deployment URL) shows a paginated table of **completed**
  matches in reverse-chronological order (filtered server-side via
  `withIndex("by_status", q => q.eq("status", "completed")).order("desc")`).
- The table includes: matchId (truncated to 8 chars), `startedAt`,
  `status`, `turn`, count of `outcome.extracted`,
  `outcome.lastSurvivor` (truncated id or "—"). Rendering does not
  block on loading more pages; "Load more" button uses the paginated
  query.
- Clicking a row navigates to `#/match/<id>` and renders the WP-B
  placeholder.
- `npm run lint`, `npm run typecheck`, `npm run build`, `npm test` all
  green at root **and cover `apps/replay/`** (root `typecheck` invokes
  the sub-package's typecheck; root `lint` block matches `.tsx`).
- The ESLint `no-restricted-imports` rule fires on a deliberate
  attempt to import `convex/engine/...` from
  `apps/replay/src/`, proving the slice boundary is enforced (one-off
  manual check, not a permanent test).
- `convex/replay.ts` deploys via `npx convex dev` without errors;
  `npx convex run replay:listMatches '{"paginationOpts":{"numItems":1,"cursor":null}}'`
  returns the 1 most recent **completed** match.
- `apps/replay/.env.example` exists and documents `VITE_CONVEX_URL`.

**Test strategy.**

- One Vitest unit test for `useHashRoute()`: parsing `#/`, `#/match/x`,
  `#/match/x?turn=23`. Pure parser; trivial.
- Match picker is exercised by manual UAT — Vitest doesn't carry its
  weight here for a Convex-bound paginated table.
- A renderer-side type-check via the Convex codegen catches any drift
  in `api.replay.listMatches`'s shape.

**Risks.**

- **`convex/_generated/` JSX-incompatible imports.** Mitigation: type-only
  imports in `bundleTypes.ts` and `convexClient.ts`; runtime values
  imported only from `convex/_generated/api.js` (which is plain JS).
- **Vite + Convex dev URL mismatch.** Mitigation: check
  `VITE_CONVEX_URL` is set at startup with a friendly error.
- **Pagination: matches table has only ~50 rows in dev currently.**
  Mitigation: `numItems: 20` default; user can scroll. Trivial.
- **`replay.listMatches` index choice.** The `matches` table has
  `by_status` only (`convex/schema.ts:461`). The query narrows to
  `status === "completed"` via that index and uses `.order("desc")`
  to reverse the natural `_creationTime` order — newest first. No
  `by_startedAt` or `by_creationTime` index is needed at the user's
  ~50-row dev scale; if it ever performs poorly, add a dedicated
  index in a future WP.

**Effort.** 1.0–1.25 days. Sequenced first. Re-estimated upward from
the original 0.5–1.0 day to absorb the actual root-tooling extension
work surfaced by reviewer A: a sub-tsconfig with DOM lib, an ESLint
files block for `.tsx`, a separate typecheck invocation in the root
script, and the Vite `server.fs.allow` config for the cross-package
`maps/reference.json` import (per M2). Nothing else starts until WP-A's
match picker shows the user's matches at `localhost:5173`.

---

## WP-B — Replay batch fetch + grid + position-reconstruction

**Scope.**

- Add `getReplayBundle({ matchId })` to `convex/replay.ts` per
  `architecture-decisions.md` §3. Returns
  `{ match, turns[], worldState, characters[] } | null`.
- Implement `apps/replay/src/lib/reconstruct.ts` per ADR §4. Pure
  function: `reconstruct(bundle, atTurn) → EntitySnapshot`.
- Implement `apps/replay/src/components/Grid.tsx` — SVG bird's-eye:
  - viewBox = `0 0 100 100` (1 unit per tile). Container fits viewport.
  - Layers (z-order, bottom→top): walls, cover tiles, evac zone (3×3
    centred on `worldState.evac.centre`, distinct fill, ring outline),
    chests (open/closed glyph), corpses, agents.
  - Each agent token: `<g>` with persona-colored fill + glyph (one of
    8 distinguishable colours; persona id as accessible label).
    Display name (Player_1..8) + persona id as `<title>` for native
    hover tooltip.
  - Read positions from `EntitySnapshot.characters[]`, etc.
- Wire `Replay.tsx`:
  - On mount, `client.query(api.replay.getReplayBundle, { matchId })`
    via the bare `ConvexClient` (NOT `useQuery` — one-shot batch per
    `architecture-decisions.md` §3).
  - On bundle resolved, set `currentTurn = 0` and render
    `<Grid snapshot={reconstruct(bundle, 0)} worldState={bundle.worldState} />`.
  - Show a "match metadata" header: matchId, status, total turns,
    extracted-count.
- Import `maps/reference.json` directly in `reconstruct.ts` for the
  initial `spawns[]` lookup (see README §9.5). Vite resolves JSON
  imports natively.

**Acceptance.**

- `npx convex run replay:getReplayBundle '{"matchId":"<id>"}'` returns
  the full bundle for any completed match.
- Visiting `#/match/<id>` for any closing-50 match shows turn 0 with:
  - 28 walls rendered.
  - All cover tiles rendered (~60 individual tiles, expanded from 10
    source clusters in `maps/reference.json` — engine flattens
    clusters to per-tile entries in `worldState.coverTiles`, so the
    renderer draws 60 squares, not 10).
  - 12 chests rendered (all closed at turn 0).
  - 0 corpses (turn 0 has no deaths).
  - 8 agents at their spawn positions, persona-coloured.
  - 3×3 evac ring centred at (47..49, 47..49).
- Vitest tests pass for `reconstruct.ts` (anchored to de-risking §1
  failure modes):
  - turn 0 (synthetic — no ledger row consulted): every character at
    `spawns[c.spawnIndex]` (de-risking §1.5 happy path).
  - turn 5 with synthetic moves: positions accumulate (§1.1).
  - stationary character (no `kind: "none"` move entry — it's omitted
    from `resolution.moves[]`) keeps its previous position (§1.1).
  - chest opens at turn N via `resolution.actions[*].kind === "interact"`
    with `result === "opened"` (§1.3).
  - death at turn N produces a corpse at the actor's last position from
    turn N onward (§1.2).
  - hidden flag toggles via `resolution.visibilityUpdates[]` (§1.4).
  - **throws on missing `spawnIndex`** with a clear error message
    naming the offending character (de-risking §1.5 defensive case).
  - `reconstruct(bundle, 30)` called twice in succession is structurally
    equal; backward jump from 30 to 10 equals a fresh
    `reconstruct(bundle, 10)` (§1.6 idempotency).
  - extraction read from `bundle.characters[c].extractedAtTurn`:
    extracted agents disappear from the grid for `t > extractedAtTurn`
    (§1.8).
  - synthetic turn 0 reconstructed from a bundle whose first ledger
    row is `turn === 1` (D-P2-13 / §1.9 invariant).
- `npm run lint && npm run typecheck && npm run build && npm test` all
  green.
- The user can manually verify (UAT) by picking three matches from
  the closing-50 set and confirming turn 0 looks identical to the
  expected start position (8 ring spawns surrounding the central
  evac arena per `maps/reference.json` — coordinates (28,28)..(48,48)
  on the 100×100 grid, NOT the 100×100 perimeter; evac ring centred at
  (47..49, 47..49)).

**Test strategy.**

- Vitest unit tests for `reconstruct.ts` are tests-first per AOP. Build
  synthetic `ReplayBundle` fixtures (small turn ledgers — 2 characters
  on a 10×10 mini map for fast eyeball-debuggable tests) and assert
  expected snapshots.
- Live-data sanity: a "smoke" test loads the user's most-recent
  closing-50 match's bundle (gated by `LIVE_CONVEX` env var, mirrors
  the `LIVE_AZURE` pattern from phase 1's
  `tests/llm/integration.test.ts`) and asserts:
  - reconstruction produces 8 agents at known spawn positions on
    turn 0 (synthetic, no ledger row consulted — §1.9 invariant).
  - `bundle.turns[0].turn === 1` (D-P2-13 first-ledger-row invariant).
  - **corpse-contents consistency (de-risking §1.7):** for every dead
    character at the terminal turn, the walk's snapshot's corpse entry
    matches the corresponding `worldState.corpses[]` entry by
    `characterId`. Mismatches are logged, not failed (the walk treats
    `worldState.corpses[]` as the authoritative source per ADR §4
    fallback strategy, so the test is a sanity probe rather than a
    hard contract).
- The grid renderer is exercised via UAT only (visual; not a fit for
  Vitest).

**Risks.**

- **Equipment + HP not derivable per turn (D-P2-11).** ADR §4 caveat.
  Mitigation: snapshot fields are always `null` in v0; hover card
  displays "see expand panel"; expand modal surfaces
  `agentRecord.input.visibleStateDigest` for the agent's own view.
  Corpse contents come from `worldState.corpses[]` (authoritative).
- **Opened-chest contents not persisted (D-P2-12).** Engine clears
  `worldState.chests[i].contents` to `null` on open
  (`resolution.ts:537`). Mitigation: hover card on opened chest shows
  "contents not persisted". No RNG-based loot derivation in v0.
- **Turn-number model (D-P2-13).** Phase 1 writes the first turns row
  at `turn === 1`; turn 0 is synthetic. The walk + UI key turns by
  turn-number (`turnRowByTurn = new Map<number, TurnRow>()`), NOT
  array index. Slider range is `0..bundle.match.turn` inclusive of
  synthetic turn 0. Already encoded in ADR §4 walk rules and de-risking
  §1.9.
- **`worldState` no `by_match` index.** Per ADR §3. Mitigation: use
  `.filter(q => q.eq(q.field("matchId"), matchId)).unique()` for v0;
  the table has ~50 rows per dev deployment. Add an index in a
  follow-up if needed (additive schema change, no migration).
- **Persona colour palette accessibility.** Pick 8 high-contrast
  colours (e.g. category10-style) and add textual persona-id labels
  for colour-blind safety.
- **SVG performance on a 100×100 grid.** The renderer draws
  ~28 walls + ~60 cover tiles + 12 chests + ≤8 corpses + 8 agents =
  ~116 SVG nodes. Trivial. No virtualisation needed.

**Effort.** 1.0–1.5 days. Sequenced after WP-A.

---

## WP-C — Turn stepper + side-panel feed (decisions in English)

**Scope.**

- Implement `apps/replay/src/components/TurnStepper.tsx`:
  - Slider input — range `0..bundle.match.turn` inclusive (turn 0 is
    the synthetic pre-game snapshot per D-P2-13; `match.turn` is the
    last turn the resolver advanced to). Up/down/left/right arrow keys
    step ±1 turn within that range.
  - "Next turn" button only. **No Previous button** (D-P2-7: the
    slider gives arbitrary backward jump for free; a separate button
    would be redundant UI).
  - Display "Turn N / `match.turn`" prominently. Render turn 0 as
    "Pre-turn / spawn positions".
  - Updates URL `?turn=N` on change.
- Implement `apps/replay/src/components/TurnFeed.tsx`:
  - Build `turnRowByTurn = new Map<number, TurnRow>()` once on bundle
    resolve, keyed by `row.turn` (D-P2-13). The first ledger row is
    `turn === 1`; turn 0 is synthetic and has no row.
  - For `currentTurn === 0`, render a "Pre-game / no decisions yet"
    placeholder (no agentRecords exist).
  - For `currentTurn >= 1`, look up `row = turnRowByTurn.get(currentTurn)`
    and render a row per agent in `row.agentRecords[]`. Each row shows:
    persona swatch, displayName, persona id, one-line decision summary
    (from `summariseDecision().oneLine`), say text (if any),
    scratchpad-delta indicator.
  - Click row → expand inline (no modal; the full content slots into
    the row) showing: full decision bullets, intent-vs-outcome list,
    full scratchpadAfter (truncated to 500 chars at most — schema
    bound), full say text. The expand modal proper is WP-D scope.
  - Dead/extracted agents: rendered greyed-out with a small marker
    ("died turn 23" / "extracted turn 50"). They have no agentRecord
    on later turns; the renderer reads from prior turns or
    `characters[]` for the marker.
- Implement `apps/replay/src/lib/decisionEnglish.ts` per
  `architecture-decisions.md` §5. Pure function:
  `summariseDecision(agentRecord, resolution, characterById) → { oneLine, bullets, intentVsOutcome }`.
- Layout: grid + stepper takes ~60% viewport width on the left,
  side-panel feed takes ~40% on the right. CSS-only flex; no responsive
  breakpoints (v0 is desktop-only — mobile is a consumer-renderer
  concern per README §4).

**Acceptance.**

- Slider scrubs forward and backward smoothly across `0..match.turn`.
  Each turn change updates the grid and the feed in <100 ms (the
  reconstruction is fast; the bottleneck is React re-render).
- Turn 0 renders as "Pre-turn / spawn positions" — no agentRecords,
  grid shows 8 agents at spawn positions per `maps/reference.json`.
- Each agent row in the feed (turns ≥ 1) shows a one-line English
  decision summary for the current turn. Examples (verifiable on
  closing-50 matches; vocabulary anchored to ADR §5 result-string
  table — not `harness/analyze-match.ts`):
  - `"Stayed put. Attacked Player_5 — hit (dealt 12 damage) — killed Player_5. Said: \"Truce?\""`.
  - `"Moved 6 tiles northeast toward chest_004. Interacted with chest_004 — opened."`.
  - `"Stayed put. Attacked Player_3 — out of range."`.
  - `"Overwatch (priority: nearest enemy)."`.
- Clicking a row expands it inline; clicking again collapses.
- Vitest tests pass for `decisionEnglish.ts`:
  - every `move.kind` produces the expected English string.
  - every `action.kind` × every `result` literal in the ADR §5
    vocabulary table (`dmg N` / `no_target` / `out_of_range` /
    `opened` / `already_opened` / `no_chest` / `looted` /
    `no_corpse`) produces the expected outcome string. Source of
    truth is `convex/engine/resolution.ts:374-586` per D-P2-14;
    `harness/analyze-match.ts:49-58` is stale and not referenced.
  - `dmg N` parses N as a positive integer; an attack outcome whose
    actor + target also appear in `resolution.deaths[]` for the same
    turn appends `" — killed <displayName>"` (death detection rule).
  - every `consume` value renders correctly.
  - `say: null` and `overwatch_priority: null` collapse cleanly.
  - intent-vs-outcome correctly pairs the actor's intent with the
    matching `resolution.actions[]` entry, including the
    `out_of_range` and `no_target` mismatch cases.
  - unrecognised result strings render as
    `"(unknown result: <raw>)"` rather than silently disappearing.
  - scratchpad delta detection correctly identifies "no change" vs
    "changed" and produces a truncated diff line.
- The user can step through three matches and read each turn's feed
  without falling back to JSON inspection. (Vibe verification.)
- `npm run lint && npm run typecheck && npm run build && npm test` all
  green.

**Test strategy.**

- `decisionEnglish.ts` is tests-first per AOP. The vocabulary table is
  exhaustively covered (every literal × every result string).
- Stepper UI exercised via UAT.
- Feed component exercised via UAT.

**Risks.**

- **Intent-outcome string drift.** The full set of `result` strings
  the engine emits is enumerated in ADR §5 from
  `convex/engine/resolution.ts:374-586`
  (`dmg N` / `no_target` / `out_of_range` / `opened` /
  `already_opened` / `no_chest` / `looted` / `no_corpse`). Mitigation:
  encode the union as a TypeScript literal type in
  `decisionEnglish.ts`, and add an integration smoke test that runs
  `summariseDecision` against every action across the user's
  most-recent closing-50 match's turns — any unrecognised result
  string surfaces as `"(unknown result: <raw>)"` so future engine
  extensions show up as a visible TODO instead of corrupting the
  feed.
- **Display name resolution.** The decision references
  `targetCharacterId` (a Convex id); the user wants `Player_5`.
  Mitigation: `summariseDecision` takes a `Map<Id, CharacterRow>`
  prebuilt from `bundle.characters[]`.
- **Feed scrolling on long matches.** 50 turns × 8 agents = 400 rows
  total, but the feed shows 8 rows per turn (only the current turn).
  Trivial scroll concerns.

**Effort.** 1.5 days. Parallel with WP-D after WP-B lands.

---

## WP-D — Hover details + click-to-expand verbose surfaces

**Scope.**

- Implement `apps/replay/src/components/HoverCard.tsx`:
  - On agent hover (mouseenter on grid token): show a card pinned near
    the cursor with persona name, displayName, position,
    alive/hidden flags, and the one-line decision summary for the
    current turn (reuses `summariseDecision().oneLine`). Equipment +
    HP rows display **"see expand panel"** per D-P2-11 — the substrate
    does not persist these per turn, so the authoritative source is
    `agentRecord.input.visibleStateDigest` shown in the expand modal.
  - On chest hover (closed): show the chest's id, position, "closed".
  - On chest hover (opened): show id, position, "opened (turn N)",
    and the line **"contents not persisted"** per D-P2-12 — the
    engine clears `worldState.chests[i].contents` on open
    (`resolution.ts:537`), so v0 cannot recover what came out.
  - On corpse hover: show the deceased character's displayName +
    persona, death turn, remaining loot from `worldState.corpses[]`
    (engine-authored truth — the only ledger-free fallback we have).
  - On wall / cover / evac hover: trivial single-word labels.
- Implement `apps/replay/src/components/ExpandModal.tsx`:
  - Triggered from a "..." button on each feed row.
  - Renders five tabs/sections:
    1. **Persona prompt** — full
       `agentRecord.input.personaPromptText` (per ADR §7 — the per-row
       capture, not `personas/*.md`).
    2. **System prompt** — full
       `agentRecord.input.systemPromptText` (collapsed by default; toggle
       to expand). `systemPromptHash` shown alongside.
    3. **Visible state digest** — full
       `agentRecord.input.visibleStateDigest` (this is the agent's own
       view of the world on this turn).
    4. **Scratchpad** — `scratchpadBefore` and `scratchpadAfter`
       side-by-side with a diff highlight.
    5. **LLM trace** — `agentRecord.llm.responseId`, `callId`,
       `latencyMs`, `httpStatus`, `usage`, `fellBackToSafeDefault`,
       `failureReason`, `validatorReason`, `httpBodyExcerpt` (each
       only shown if present), and full `rawArguments` for failure-mode
       debugging.
- All expand surfaces are read-only `<pre>` blocks with copy-to-clipboard
  buttons.

**Acceptance.**

- Hovering any agent on the grid shows a card with persona,
  displayName, position, alive/hidden flags, and the current-turn
  decision summary. Equipment + HP rows display "see expand panel"
  (per D-P2-11).
- Hovering a closed chest shows id + position + "closed".
- Hovering an opened chest shows id + position + "opened (turn N)" +
  "contents not persisted" (per D-P2-12).
- Hovering a corpse shows deceased character + persona + death turn +
  remaining loot from `worldState.corpses[]`.
- Clicking the "..." on a feed row opens the modal showing all five
  tabs populated for that (turn, agent).
- Manual UAT against three closing-50 matches: the user can read any
  agent's full prompt + scratchpad + visibleStateDigest + LLM trace
  for any turn without needing to run `npx convex run`.
- `npm run lint && npm run typecheck && npm run build && npm test` all
  green.

**Test strategy.**

- Pure formatters (e.g. usage formatter, time formatter) get tiny
  Vitest tests.
- HoverCard and ExpandModal exercised via UAT.

**Risks.**

- **Hover-card flicker / positioning at viewport edges.** Mitigation:
  basic clamp logic so the card stays inside the viewport. Plain CSS;
  no library.
- **`visibleStateDigest` length.** Phase-1 prompt-economy bounded the
  digest, but it's still multi-paragraph. Mitigation: max-height with
  scroll; `<pre>` preserves whitespace.
- **`personaPromptText` mismatch with current `personas/*.md`.**
  Expected and intentional per ADR §7 — the captured text is the
  ground truth for that historical run. Document this in the modal's
  persona-prompt tab header so the user is not confused if a recent
  persona edit doesn't show up in old replays.

**Effort.** 1.0–1.5 days. Parallel with WP-C after WP-B lands.

---

# Closing the phase

After WP-C and WP-D land:

1. **Code review pass** — independent reviewer agent walks through three
   matches end-to-end and confirms every Cucumber scenario in
   `README.md` §3 holds. The reviewer specifically validates: position
   correctness vs `worldState.corpses[]` ground truth; intent-vs-outcome
   accuracy on a sample of attack/loot/interact actions; that the
   renderer never imports from `convex/engine|llm|runMatch` (grep check).
2. **UAT pass** — the user runs the app, picks three closing-50
   matches, steps through them, hovers and expands, and reports the
   substrate-vibe judgement as text into a `phase-2-closure.md` file
   (mirroring phase-1's `PHASE-1-CLOSURE.md`).
3. **Phase 2 v0 closes** when the user signals "yes, the substrate
   feels right" or files a follow-up phase to address whatever the
   overseer revealed.

The reviewer-before-close pattern from phase 1 carries over: reviews go
*before* the phase closes, not after.
