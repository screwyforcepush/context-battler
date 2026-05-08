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
    port 5173).
  - `apps/replay/tsconfig.json` (extends root, JSX `react-jsx`, includes
    `src/**/*` plus type-only imports from `../../convex/_generated/`).
  - `apps/replay/index.html` (mount point `<div id="root"></div>`).
  - `apps/replay/src/main.tsx` — `ConvexProvider` wraps the app, hash
    router decides between `MatchPicker` and `Replay`.
  - `apps/replay/src/lib/convexClient.ts` — wraps
    `new ConvexReactClient(import.meta.env.VITE_CONVEX_URL)`.
  - `apps/replay/src/lib/useHashRoute.ts` — hook returning the parsed
    hash route.
  - `apps/replay/src/routes/MatchPicker.tsx` — paginated table.
- Wire the root `package.json` script `dev:replay` →
  `npm --prefix apps/replay run dev`. Document the
  `VITE_CONVEX_URL=<dev-deployment-url>` env var in `apps/replay/.env.example`.
- Wire root tooling:
  - `eslint.config.mjs` — extend to include `apps/replay/src/**/*.{ts,tsx}`
    (JSX-aware variant). Add a `no-restricted-imports` rule blocking
    runtime imports of `convex/engine/*`, `convex/llm/*`,
    `convex/runMatch.ts`, `convex/_internal_runMatch.ts` from
    `apps/replay/src/**` (per ADR §7).
  - `vitest.config.ts` — extend `include` to cover
    `apps/replay/src/**/*.test.ts(x)`.
  - `.gitignore` — add `apps/replay/node_modules/`,
    `apps/replay/dist/`, `apps/replay/.env`.
- Add a new Convex query module **`convex/replay.ts`** with **only**
  `listMatches({ paginationOpts })` for now (`getReplayBundle` lands in
  WP-B). Default Convex runtime; pure DB read.
- `apps/replay/src/routes/MatchPicker.tsx` uses
  `usePaginatedQuery(api.replay.listMatches, {}, { initialNumItems: 20 })`
  and renders a table with columns: matchId (truncated), startedAt
  (relative time), status, current turn, extracted count
  (`outcome.extracted.length`), last-survivor displayName if any
  (resolved client-side via secondary query — or omitted if it would
  add a round-trip; v0 acceptance is the simpler shape). Each row is a
  hyperlink to `#/match/<matchId>`.
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
  user's dev deployment URL) shows a paginated table of completed
  matches in reverse-chronological order.
- The table includes: matchId (truncated to 8 chars), `startedAt`,
  `status`, `turn`, count of `outcome.extracted`. Rendering does not
  block on loading more pages; "Load more" button uses the paginated
  query.
- Clicking a row navigates to `#/match/<id>` and renders the WP-B
  placeholder.
- `npm run lint`, `npm run typecheck`, `npm run build`, `npm test` all
  green at root.
- `convex/replay.ts` deploys via `npx convex dev` without errors;
  `npx convex run replay:listMatches '{"paginationOpts":{"numItems":1,"cursor":null}}'`
  returns the 1 most recent match.
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
  `by_status` only. Without a `_creationTime` index, `.order("desc")`
  works on the table's natural creation order. Acceptable for v0; if
  it ever performs poorly, add an explicit `by_startedAt` index in a
  future WP.

**Effort.** 0.5–1.0 day. Sequenced first. Nothing else starts until
WP-A's match picker shows the user's matches at `localhost:5173`.

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
  - 10 cover clusters rendered.
  - 12 chests rendered (all closed at turn 0).
  - 0 corpses (turn 0 has no deaths).
  - 8 agents at their spawn positions, persona-coloured.
  - 3×3 evac ring centred at (47..49, 47..49).
- Vitest tests pass for `reconstruct.ts`:
  - turn 0: every character at `spawns[c.spawnIndex]`.
  - turn 5 with synthetic moves: positions accumulate.
  - stationary character (no `kind: "none"` move entry — it's omitted
    from `resolution.moves[]`) keeps its previous position.
  - chest opens at turn N via `resolution.actions[*].kind === "interact"`
    with `result === "opened"`.
  - death at turn N produces a corpse at the actor's last position from
    turn N onward.
  - hidden flag toggles via `resolution.visibilityUpdates[]`.
  - `reconstruct(bundle, 30) === reconstruct(bundle, 30)` after a
    backward jump (idempotency / no hidden state).
  - `reconstruct(bundle, 50)` — terminal state — agents that extracted
    are marked `extractedAtTurn` and absent from the grid (or
    distinct-styled, depending on chosen WP-B affordance).
- `npm run lint && npm run typecheck && npm run build && npm test` all
  green.
- The user can manually verify (UAT) by picking three matches from
  the closing-50 set and confirming turn 0 looks identical to the
  expected start position (8 perimeter spawns, evac ring centred).

**Test strategy.**

- Vitest unit tests for `reconstruct.ts` are tests-first per AOP. Build
  synthetic `ReplayBundle` fixtures (small turn ledgers — 2 characters
  on a 10×10 mini map for fast eyeball-debuggable tests) and assert
  expected snapshots.
- Live-data sanity: a "smoke" test loads the user's most-recent
  closing-50 match's bundle (gated by `LIVE_CONVEX` env var, mirrors
  the `LIVE_AZURE` pattern from phase 1's
  `tests/llm/integration.test.ts`) and asserts the reconstruction
  produces 8 agents at known spawn positions on turn 0.
- The grid renderer is exercised via UAT only (visual; not a fit for
  Vitest).

**Risks.**

- **Equipment-state walk fragility.** ADR §4's caveat. Mitigation:
  hover card displays equipped state best-effort; corpse contents come
  from `worldState.corpses[]` (engine-authored truth).
- **Turn 0 special case.** Phase 1 writes a turns row for turn=1 first
  (per `convex/runMatch.ts` advanceTurn semantics — first invocation
  produces turn 1). Verify whether the bundle's `turns[0]` is "turn 1"
  or "turn 0", and whether a synthesised initial state is needed for
  pre-turn-0 display. Mitigation: WP-B's pre-step is to inspect a
  real bundle from `npx convex run` and document the index/turn
  invariant in `reconstruct.ts`'s comment.
- **`worldState` no `by_match` index.** Per ADR §3. Mitigation: use
  `.filter(q => q.eq(q.field("matchId"), matchId))` for v0; the table
  has ~50 rows per dev deployment. Add an index in a follow-up if
  needed.
- **Persona colour palette accessibility.** Pick 8 high-contrast
  colours (e.g. category10-style) and add textual persona-id labels
  for colour-blind safety.
- **SVG performance on a 100×100 grid.** The renderer draws
  ~28 walls + ~40 cover tiles + 12 chests + ≤8 corpses + 8 agents =
  ~96 SVG nodes. Trivial. No virtualisation needed.

**Effort.** 1.0–1.5 days. Sequenced after WP-A.

---

## WP-C — Turn stepper + side-panel feed (decisions in English)

**Scope.**

- Implement `apps/replay/src/components/TurnStepper.tsx`:
  - Slider input (range 0..bundle.turns.length-1). Up/down/left/right
    arrow keys step ±1 turn.
  - "Next turn" / "Previous turn" buttons (previous because backward
    stepping is free per ADR §4).
  - Display "Turn N / 50" prominently.
  - Updates URL `?turn=N` on change.
- Implement `apps/replay/src/components/TurnFeed.tsx`:
  - For the current turn, render a row per agent with `agentRecord`
    on that turn (i.e. iterate `bundle.turns[currentTurn].agentRecords`).
  - Each row shows: persona swatch, displayName, persona id,
    one-line decision summary (from `summariseDecision().oneLine`),
    say text (if any), scratchpad-delta indicator.
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

- Slider scrubs forward and backward smoothly. Each turn change
  updates the grid and the feed in <100 ms (the reconstruction is
  fast; the bottleneck is React re-render).
- Each agent row in the feed shows a one-line English decision summary
  for the current turn. Examples (verifiable on closing-50 matches):
  - `"Stayed put. Attacked Player_5 (hit, -12 HP). Said: \"Truce?\""`.
  - `"Moved 6 tiles northeast toward chest_004. Interacted with chest_004 (opened: leather)."`.
  - `"Overwatch (priority: nearest enemy)."`.
- Clicking a row expands it inline; clicking again collapses.
- Vitest tests pass for `decisionEnglish.ts`:
  - every `move.kind` produces the expected English string.
  - every `action.kind` × every `result` value (enumerated in
    `harness/analyze-match.ts:49–58`) produces the expected outcome
    string.
  - every `consume` value renders correctly.
  - `say: null` and `overwatch_priority: null` collapse cleanly.
  - intent-vs-outcome correctly pairs the actor's intent with the
    matching `resolution.actions[]` entry, including the "out of
    range" mismatch case.
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

- **Intent-outcome string drift.** The set of `result` strings produced
  by the engine (`hit`, `missed`, `out_of_range`, `killed`, `opened`,
  `equipped_<X>`, `looted_<X>`, etc.) is defined by
  `convex/engine/combat.ts`, `convex/engine/loot.ts`,
  `convex/engine/affordances.ts`. Mitigation: enumerate them by
  searching the engine modules at WP-C kickoff (one grep), encode the
  union as a TypeScript literal type in `decisionEnglish.ts`, and add
  an integration smoke test that runs `summariseDecision` against
  every action across the user's most-recent closing-50 match's
  turns — any unrecognised result string should produce an obviously-
  flagged "(unknown result: <raw>)" English phrase rather than a
  silent omission, so future engine extensions surface a TODO instead
  of corrupting the feed.
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
    the cursor with persona name, displayName, hp (best-effort —
    "unknown" if pure walk doesn't track it; phase-1 schema does not
    persist HP per turn), equipped (best-effort per ADR §4),
    one-line decision summary for the current turn (reuses
    `summariseDecision().oneLine`).
  - On chest hover: show the chest's id, position, opened-state, and
    contents (if opened, from the walk; if closed, "contents hidden").
  - On corpse hover: show the deceased character's displayName + persona,
    death turn, remaining loot from `worldState.corpses[]`.
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

- Hovering any agent on the grid shows a card with persona, hp,
  equipped, and current-turn decision summary.
- Hovering a chest shows opened state + contents (if opened).
- Hovering a corpse shows deceased character + remaining loot.
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
