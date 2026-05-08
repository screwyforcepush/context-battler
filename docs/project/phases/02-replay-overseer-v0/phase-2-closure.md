# Phase 2 v0 — Closure Record (Personal Replay Overseer)

> Single-file handoff for downstream phase planning. Records what was
> built, what proves it, what is intentionally absent, and what is still
> pending the user's final vibe-judgement.
>
> Closure record drafted: 2026-05-08 (commit `c39be0b`). Closure-readiness
> fixes + known-issues populated 2026-05-08 (commits `2833537` +
> `aee6397`). HEAD at sealing: `aee6397`. Phase-2 dispatch baseline:
> `7c22284`.
>
> This is a closure RECORD, not a retrospective and not a phase-3 plan.

---

## Status banner

**Implementation: COMPLETE.** All four work packages (WP-A → WP-D) have
landed across four feature commits between dispatch (`7c22284`,
2026-05-08) and the post-implementation tip (`4db9757`, 2026-05-08); two
follow-up commits (`2833537`, `aee6397`) close the closure-readiness
must-fix bundle and reconcile docs. Engineering hygiene gates green at
root and at the `apps/replay/` sub-package: `npm run lint`,
`npm run typecheck`, `npm run build`, `npm test`
(454 passed, 4 LIVE_AZURE-gated skips — 332 phase-1 + 122 phase-2
sub-package; phase-2 net adds 7 since the draft for the new
`TurnFeed.test.tsx` truncation suite). `apps/replay` Vite build:
130 modules, 79.51 KB gzipped. Substrate freeze (D-P2-9) verified —
empty diff over `convex/engine`, `convex/llm`, `convex/runMatch.ts`,
`convex/schema.ts`, `personas/*`, `harness/*` from dispatch through
`aee6397`.

**User vibe-judgement: PENDING.** The phase's success criterion is
qualitative — the user steps through three+ matches, confirms the
substrate produces watchable, attributable, prompt-driven behaviour
(north-star §COMPLETION CONDITION). Section 9 below is the placeholder
the user fills once that pass is done. Until that section is filled,
the phase is **not** marked closed.

This closure record covers the agent-verifiable surfaces only.
Browser-flow UAT against the user's Convex dev deployment (the agent
walk-through) is a precondition for the user signoff and is not
captured inline here — see §3 caveats.

---

## 1. Inventory of artefacts

Paths and one-line purposes — no invented descriptions; pulled from
file headers, test counts measured directly, and ADR-locked
boundaries. Full rationale lives in `architecture-decisions.md`.

### 1.1 Renderer sub-package — `apps/replay/`

Tracked files (per `git ls-tree -r HEAD apps/replay/`):

```
apps/replay/
├── .env.example              VITE_CONVEX_URL template (no secret)
├── .gitignore                node_modules/, dist/, .env
├── README.md                 quick-start (install / env / dev:replay)
├── index.html                #root mount point
├── package.json              standalone sub-package; not a workspace member (ADR §2)
├── package-lock.json
├── tsconfig.json             jsx:react-jsx, lib:DOM, moduleResolution:Bundler
├── vite.config.ts            server.fs.allow ['..','../..'] for maps/reference.json
└── src/
    ├── main.tsx              ConvexProvider + hash-route dispatch
    ├── routes/
    │   ├── MatchPicker.tsx   usePaginatedQuery → table; rows → #/match/<id>
    │   └── Replay.tsx        one-shot client.query(getReplayBundle); grid+stepper+feed
    ├── components/
    │   ├── Grid.tsx          inline-SVG bird's-eye, fit-to-viewport, no zoom/pan
    │   ├── TurnStepper.tsx   slider 0..match.turn + Next button + arrow keys; ?turn=N
    │   ├── TurnFeed.tsx      side-panel agent rows; uses summariseDecision();
    │   │                     exports truncateOneLine helper (closure-readiness)
    │   ├── HoverCard.tsx     agent/chest/corpse/wall/cover/evac hover details
    │   ├── ExpandModal.tsx   5-tab modal: persona / system / digest / scratchpad / LLM trace
    │   │                     LLM tab includes copyable parsed `decision` JSON (AC#9)
    │   └── __tests__/
    │       └── TurnFeed.test.tsx   7 tests for truncateOneLine boundaries (closure-readiness)
    └── lib/
        ├── convexClient.ts   singleton ConvexReactClient(VITE_CONVEX_URL)
        ├── useHashRoute.ts   pure parser for #/, #/match/<id>?turn=N
        ├── reconstruct.ts    pure walk: bundle × atTurn → EntitySnapshot (ADR §4)
        ├── decisionEnglish.ts pure: ParsedDecision × resolution → English (ADR §5)
        ├── formatters.ts     pure: usage / latency / scratchpad-diff helpers
        ├── hoverTypes.ts     HoverTarget discriminated union (WP-C ↔ WP-D contract)
        └── __tests__/
            ├── reconstruct.test.ts   25 tests (de-risking §1.1–§1.6 + §1.8–§1.9 retired; §1.7 retired by D-P2-22)
            ├── decisionEnglish.test.ts 51 tests (ADR §5 vocabulary table)
            ├── formatters.test.ts    23 tests
            └── useHashRoute.test.ts  16 tests
```

Total: 122 Vitest tests inside the sub-package, all passing
(115 at draft + 7 added by closure-readiness for the
`truncateOneLine` helper).

`MatchPicker.tsx` additionally wraps its paginated query in a
local `PickerErrorBoundary` class component that renders a friendly
hint pointing at `npx convex dev` + `VITE_CONVEX_URL` when
`replay:listMatches` 404s against a deployment that has not yet pushed
`convex/replay.ts` (closure-readiness — UAT ISSUE-003b). The opaque
"last survivor" picker column was removed in the same pass per D-P2-21
(see §5 below).

### 1.2 Convex query module — `convex/replay.ts`

Renderer-only read surface (does not extend `convex/turns.ts` or
`convex/matches.ts` — keeps the slice boundary auditable in one
file per ADR §3):

- `replay.listMatches({ paginationOpts })` — paginated, completed-only,
  reverse-chronological. Uses `withIndex("by_status", q =>
  q.eq("status","completed")).order("desc")` against the existing
  `matches.by_status` index (`convex/schema.ts:461`). No schema diff.
- `replay.getReplayBundle({ matchId })` — single-batch fetch. Returns
  `{ match, turns[], characters[], worldState } | null`. Uses
  `turns.by_match_turn` (`convex/schema.ts:495`),
  `characters.by_match` (`convex/schema.ts:487`), and a `.filter() +
  .unique()` scan for the single `worldState` row (no `by_match`
  index — ~50 rows in dev, trivial).

The Convex codegen surfaces both via `api.replay.{listMatches,
getReplayBundle}` to the renderer's TypeScript build (the only diff in
`convex/_generated/api.d.ts`).

### 1.3 Test suites

| Suite | Count | Anchors |
|---|---:|---|
| `apps/replay/.../lib/__tests__/reconstruct.test.ts` | 25 | de-risking §1.1–§1.6 + §1.8–§1.9; §1.7 retired by D-P2-22; ADR §4 walk rules |
| `apps/replay/.../lib/__tests__/decisionEnglish.test.ts` | 51 | ADR §5 vocabulary table; canonical source `convex/engine/resolution.ts:374-586` (D-P2-14) |
| `apps/replay/.../lib/__tests__/formatters.test.ts` | 23 | usage/latency/scratchpad-diff helpers (pure) |
| `apps/replay/.../lib/__tests__/useHashRoute.test.ts` | 16 | hash-route parser (pure) |
| `apps/replay/.../components/__tests__/TurnFeed.test.tsx` | 7 | `truncateOneLine` boundary behaviour (closure-readiness — AC#7) |
| **Phase-2 sub-total** | **122** | tests-first per AOP for the pure modules + the truncation helper |
| Phase-1 carry-over (`tests/**`) | 332 + 4 skipped | `LIVE_AZURE`-gated skips unchanged from phase 1 |
| **Suite total** | **454 + 4 skipped** | matches phase-1 baseline (332) + phase-2 net adds (122) |

### 1.4 ESLint slice-boundary rule

`eslint.config.mjs:50-82` — `apps/replay/src/**/*.{ts,tsx}` files block
runtime imports of `**/convex/engine/**`, `**/convex/llm/**`,
`**/convex/runMatch`, `**/convex/_internal_runMatch` via
`no-restricted-imports`, with `allowTypeImports: true` so type-only
imports across the slice continue to work (ADR §7). This is the
machine-enforced expression of architecture.md §1 / pillar 7
("renderer subscribes to State only").

### 1.5 Root tooling extensions

- `package.json` scripts:
  - `typecheck` extended to chain `npm --prefix apps/replay run typecheck`.
  - `build` extended likewise (renderer's `tsc --noEmit` is the build gate).
  - `dev:replay` → `npm --prefix apps/replay run dev` (Vite at `:5173`).
  - `build:replay` → sub-package `vite build` (130 modules, ~79 KB
    gzipped per implement-job report).
- `vitest.config.ts` — `include` extended with
  `apps/replay/src/**/*.test.ts(x)` so root `npm test` covers both
  packages (no separate command).
- `.gitignore` — `apps/replay/node_modules/`, `apps/replay/dist/`,
  `apps/replay/.env`.

---

## 2. ADR adherence summary

Each phase-2 decision (`D-P2-1`..`D-P2-23`, sourced from
`architecture-decisions.md` and the conversation Decision Record)
ticked off with one line of agent-verifiable evidence. Decisions
`D-P2-18`..`D-P2-23` are closure-readiness orchestration entries
recorded after the implement job; they do not have ADR-section
counterparts in `architecture-decisions.md`.

| ID | Decision | Evidence |
|---|---|---|
| D-P2-1 | Tech stack: Vite + React + TS + inline SVG + `convex/react` | `apps/replay/package.json` (deps: react/react-dom/convex; devDeps: vite/@vitejs/plugin-react/typescript). `Grid.tsx` uses inline SVG. |
| D-P2-2 | App at top-level `apps/replay/`, not nested under harness or as a workspace member | `apps/replay/` exists as sibling of `convex/`, `harness/`, `personas/`. Root invokes via `npm --prefix apps/replay`. |
| D-P2-3 | New `convex/replay.ts` (does not extend `turns.ts`/`matches.ts`) | `convex/replay.ts` exports `listMatches` + `getReplayBundle`; `git diff 7c22284..HEAD -- convex/turns.ts convex/matches.ts` empty. |
| D-P2-4 | Renderer reads State only — runtime engine imports blocked at lint | `eslint.config.mjs:63-79` `no-restricted-imports` rule with `allowTypeImports: true`. |
| D-P2-5 | Pure `reconstruct.ts` walk — single source of non-trivial logic | `apps/replay/src/lib/reconstruct.ts` is import-free of React/DOM/Convex; 25 Vitest tests anchored to de-risking §1. |
| D-P2-6 | Persona prompt source = `agentRecord.input.personaPromptText` (per-row capture) | `ExpandModal.tsx:221` reads `personaPromptText`; no import of `personas/*.md` from the renderer. |
| D-P2-7 | Backward stepping is free — slider only, no separate Back button | `TurnStepper.tsx` exposes slider + Next; arrow keys ±1; no Back button. |
| D-P2-8 | Equipment-state per turn = best-effort; corpse contents from `worldState.corpses[]` | `reconstruct.ts` snapshot fields `equipped: null`, `hp: null` always; corpse contents read from `worldState.corpses[]`. |
| D-P2-9 | No engine, schema, persona, or harness changes | `git diff 7c22284..HEAD -- convex/engine convex/llm convex/runMatch.ts convex/schema.ts personas harness` produces zero output (see §4). |
| D-P2-10 | Success criterion = qualitative vibe-judgement on 3+ matches | Phase README §2 + this doc §9 placeholder; no quantitative bar enforced. |
| D-P2-11 | Live-agent equipment + HP not derivable per turn | `HoverCard.tsx:230-231` renders literal "see expand panel"; `reconstruct.ts` snapshot `equipped`/`hp` always `null`. |
| D-P2-12 | Opened-chest contents not persisted post-open | `HoverCard.tsx:296` renders literal "contents not persisted" for opened chests. |
| D-P2-13 | Turn 0 is synthetic; UI keys turns by **turn-number**, not array index | `reconstruct.ts:106-119` builds `turnRowByTurn = new Map<number, Doc<"turns">>()` keyed by `row.turn`; turn-0 path synthesises from `spawns[c.spawnIndex]` without consulting any ledger row. |
| D-P2-14 | Result-string vocabulary canonical source = `convex/engine/resolution.ts:374-586` | `decisionEnglish.ts:17` and inline ADR §5 vocabulary table reference resolution.ts line range; `harness/analyze-match.ts` is explicitly **not** a reference. |
| D-P2-15 | Plan refinement post-review approved without re-review | Reviewer-conditions met by direct engine-source verification per phase memory `feedback_verified_guides_are_contracts`; commit `93584a5`. |
| D-P2-16 | Phase 2 v0 dispatched as a single implement job covering all 4 WPs | One implement job; sequenced internally per `work-packages.md` dependency arrows; four commits 2f697cd → 4db9757. |
| D-P2-17 | Phase 2 v0 implement job COMPLETE | All four WP commits landed; gates green; this closure record filed. |
| D-P2-18 | First review-group findings: 4 AC-violating must-fix items (Grid fit-to-viewport / URL→state sync / scratchpad preview / parsed decision JSON) | All four resolved by closure-readiness commit `2833537`; details in §5.0 below. |
| D-P2-19 | Closure-completion path: single implement job lands must-fix + bundled-lower-priority + closure-doc, THEN COMPLETION REVIEW group dispatched | Honoured: `2833537` (code+README) + `aee6397` (docs) precede the COMPLETION REVIEW group; this current document pass is part of that group. |
| D-P2-20 | de-risking §1.8 wording aligned to `t >= extractedAtTurn` impl semantics (engine extracts in resolution phase 8) | `de-risking.md` §1.8 updated in `aee6397` with citation to `convex/engine/resolution.ts:711-723`; matches `Grid.tsx:207-212`. |
| D-P2-21 | Last-survivor column on MatchPicker dropped — enrichment would require N+1 worldState reads or a schema diff | `MatchPicker.tsx:1-31` doc-comment records the drop; remaining columns (matchId/startedAt/status/turn/extracted) satisfy AC#2 "enough context to choose". |
| D-P2-22 | de-risking §1.7 retired (not patched) — reconstruct.ts performs zero corpse-contents derivation; HoverCard reads `worldState.corpses[]` directly | `de-risking.md` §1.7 marked retired in `aee6397`; parallels D-P2-12 (no derivation in v0). |
| D-P2-23 | COMPLETION REVIEW group dispatched in parallel (review + uat + document); gates AOP.VALIDATE'd independently before dispatch | This document pass is the `document` strand of that group; §9 remains empty per north-star §COMPLETION CONDITION. |

---

## 3. Cucumber surface verification

The Cucumber Given/When/Then in `README.md` §3 (the north-star
business need) is the success contract. The table below maps each
clause to its evidence. The first agent-UAT pass against `4db9757`
exercised every row and surfaced the four AC violations now resolved
in §5.0. Rows whose verification still requires a visual count check
against live data are explicitly marked **Pending agent UAT walk-
through** below — those rows are mechanically correct in code
(component + integration tests pass; props wire to the named fields)
but were not visually counted in the first UAT pass.

### 3.1 Scenario 1 — User picks a recent match

| Clause | Evidence |
|---|---|
| Given user opens replay app in local browser | `apps/replay/README.md` quick-start (refreshed in `2833537` with Prerequisites + route descriptions); root `dev:replay` script; Vite serves `:5173`. |
| When they navigate to match list (`#/`) | `main.tsx:16-22` routes hash `#/` (or unrecognised) to `MatchPicker`. |
| Then paginated, reverse-chronological list of matches | `convex/replay.ts:43-52` `listMatches` uses `withIndex("by_status", "completed").order("desc").paginate(opts)`; `MatchPicker.tsx` renders via `usePaginatedQuery`. A local `PickerErrorBoundary` surfaces a friendly hint on `replay:listMatches` 404 (UAT ISSUE-003b). |
| And each row surfaces enough context | Columns: matchId (truncated 8ch), `startedAt` (ISO + relative), status, `match.turn`, `outcome.extracted.length`. The opaque `outcome.lastSurvivor` column was dropped per D-P2-21 / UAT ISSUE-004 (enrichment would require N+1 reads or a forbidden schema diff). |
| When click a row | `MatchPicker.tsx` row href is `#/match/<id>` (hash anchor, no JS handler needed). |
| Then navigate to replay view | `main.tsx:18-19` matches `kind === "replay"` route from `useHashRoute`. |

### 3.2 Scenario 2 — User steps through a match

| Clause | Evidence |
|---|---|
| Given replay loaded for completed match | `Replay.tsx` calls `client.query(api.replay.getReplayBundle, { matchId })` once on mount (no subscription). |
| Then bird's-eye 100×100 grid fits viewport | `Grid.tsx` SVG `viewBox="0 0 100 100"`; wrapped in `gridSquareStyle` (`Replay.tsx:419-428` — `aspect-ratio: 1/1` + `max-width: 100%` + `height: 100%`) inside a viewport-bounded main column so the grid is always square AND always fits — closure-readiness AC#4 / UAT ISSUE-001 (commit `2833537`). |
| And turn 0 is shown by default | `Replay.tsx` initial `currentTurn = 0`; `reconstruct(bundle, 0)` synthesises spawn-position snapshot per ADR §4. URL ↔ state sync via `useEffect([props.turn])` mirror at `Replay.tsx:51-54` honours browser back/forward + direct URL edits — closure-readiness AC#5 / UAT ISSUE-002. |
| And walls/cover/chests/corpses/evac/agents render | `Grid.tsx` z-ordered layers per ADR §4 walk (walls → cover → chests → corpses → evac → agents). Pending agent UAT for visual count check (≈28 walls, ≈60 cover tiles, 12 closed chests, 8 spawn agents, 3×3 evac ring at (47..49, 47..49)). |
| When click "next turn" or use slider | `TurnStepper.tsx` Next button + slider; both write `?turn=N` via `useHashRoute`. |
| Then grid updates | `Replay.tsx` derives snapshot via `useMemo(() => reconstruct(bundle, currentTurn))`. |
| And turn feed updates | `TurnFeed.tsx` reads `turnRowByTurn.get(currentTurn)` (D-P2-13 keying) and renders agent rows with `summariseDecision()`; collapsed rows show a one-line dimmed `scratchpadAfter` preview via `truncateOneLine(text, 100)` — closure-readiness AC#7 (`TurnFeed.tsx:316`). |

### 3.3 Scenario 3 — User inspects an agent's mind

| Clause | Evidence |
|---|---|
| When expand an agent's row in feed | `TurnFeed.tsx` "..." button mounts `ExpandModal` with `(agentRecord, characterById)`. |
| Then see persona prompt, scratchpadBefore/After, decision in English, visibleStateDigest | `ExpandModal.tsx` 5 tabs read `personaPromptText` (`:221`), `systemPromptText` (`:242`), `visibleStateDigest` (`:263`), `scratchpadBefore`/`scratchpadAfter` (`:283-284`), LLM trace (`:334+`). The LLM tab additionally surfaces a copyable parsed `agentRecord.decision` JSON section alongside `rawArguments` (`:353-356, :403-404`) — closure-readiness AC#9 / review-B Med-2. |
| When hover an agent token | `Grid.tsx` agent `<g>` mouseenter populates `HoverCard` with `HoverTarget` discriminated-union payload. |
| Then compact card with persona, hp, equipped, decision summary | `HoverCard.tsx` agent branch shows persona + displayName + position + alive/hidden + summary; hp/equipped render literal "see expand panel" per D-P2-11 (`HoverCard.tsx:230-231`). |
| When hover a chest | `Grid.tsx` chest `<g>` populates HoverCard chest branch. |
| Then see open/closed + contents | `HoverCard.tsx` closed chest shows id+pos+"closed"; opened chest shows id+pos+"opened (turn N)" + literal "contents not persisted" per D-P2-12 (`HoverCard.tsx:296`). |
| When hover a corpse | `HoverCard.tsx` corpse branch shows deceased character + persona + death turn + remaining loot from `worldState.corpses[]`. |

### 3.4 Caveat — agent UAT browser walk-through

A first agent-UAT pass against the implementation tip `4db9757` produced
two Med-blocking findings (Grid fit-to-viewport and URL↔state sync) plus
one onboarding-friction issue (Convex deployment prerequisites unclear)
— all four direct AC violations (`AC#4, AC#5, AC#7, AC#9`) were
resolved in the closure-readiness commit `2833537` per §5.0 below.

The COMPLETION REVIEW group (review + uat + document, dispatched per
D-P2-23) is running in parallel with this document pass. Findings from
that group's `uat` strand against `aee6397` are **not** integrated into
this record at sealing time — to avoid blocking on parallel jobs per
the assignment scope. If the COMPLETION REVIEW UAT raises new
high-severity findings they will be appended as a *Blocking findings*
section before the user starts §9; otherwise the user reads §9 fresh.

---

## 4. Substrate freeze verification

Per D-P2-9 the phase-1 substrate is frozen — phase 2 introduces no
diff to the engine kernels, the LLM wrapper, the per-match orchestrator,
the schema, the persona content, or the harness CLI.

```
$ git diff 7c22284..aee6397 -- convex/engine convex/llm convex/runMatch.ts convex/schema.ts personas harness
(no output)
```

Verified at sealing time (HEAD = `aee6397`). The only files touched in
`convex/` between dispatch and HEAD are `convex/replay.ts` (new module,
+92 lines) and the regenerated `convex/_generated/api.d.ts` (+2 lines —
the new module's typed surface). The closure-readiness commits
(`2833537` code+README and `aee6397` docs) touched **only** the renderer
sub-package and `docs/project/phases/02-replay-overseer-v0/*.md` —
neither commit modifies any substrate path.

---

## 5. Known caveats / known-issues

Each entry is tagged **resolved** (closure-readiness — fixed in
`2833537` or `aee6397`), **v0 acceptable** (intentional gap, surfaced
as literal copy in the UI) or **deferred** (downstream phase will
close it). No high-severity findings are open against this phase at
sealing time.

### 5.0 Closure-readiness fixes applied (resolved)

**Tag:** resolved (closure-readiness — landed in `2833537` + `aee6397`).

The first review-group pass (review × 3 reviewers + agent UAT against
`4db9757`) produced 4 AC-violating must-fix items + 5
lower-priority items. All 9 are addressed:

**AC-violating must-fix (4) — all resolved in `2833537`:**

- **AC#4 — Grid fit-to-viewport:** `Replay.tsx:419-428` adds
  `gridSquareStyle` (`aspect-ratio: 1/1` + `max-width: 100%` +
  `height: 100%`) inside a viewport-bounded main column. The grid is
  now always square and always fits. (UAT ISSUE-001.)
- **AC#5 — URL ↔ currentTurn sync:** `Replay.tsx:51-54` adds a
  `useEffect([props.turn])` mirror that pulls `useHashRoute` updates
  into local state on browser back/forward and direct URL edits.
  TurnStepper continues to write `?turn=N` via `replaceState`. (UAT
  ISSUE-002.)
- **AC#7 — Scratchpad preview on collapsed feed rows:** `TurnFeed.tsx`
  exports a new `truncateOneLine(text, budget)` helper (`:316`) and
  uses it at `:246` to render a one-line dimmed `scratchpadAfter`
  preview at ≤100 chars on collapsed rows. **+7 Vitest cases** in
  `apps/replay/src/components/__tests__/TurnFeed.test.tsx` cover
  boundary, exact-budget, ellipsis, newline-collapse, CRLF/tab
  collapse, run-of-whitespace collapse, and empty-string. (Review-B
  Med-1.)
- **AC#9 — Parsed `decision` JSON in ExpandModal:** `ExpandModal.tsx`
  LLM tab adds a copyable parsed-`agentRecord.decision` JSON section
  at `:353-356, :403-404` alongside the existing `rawArguments`. The
  centerpiece of concept-spec §2.4 (scratchpad-as-explainability) is
  now directly inspectable. (Review-B Med-2.)

**Lower-priority bundle (5) — resolved in `2833537`:**

- README route description refresh + new Prerequisites section
  documenting `npx convex dev` + `VITE_CONVEX_URL` (review-B Low; UAT
  ISSUE-003a). `apps/replay/README.md`.
- `MatchPicker.tsx` `PickerErrorBoundary` class component — friendly
  hint when `replay:listMatches` 404s on a deployment that has not yet
  pushed `convex/replay.ts` (UAT ISSUE-003b).
- Last-survivor column DROPPED from picker — D-P2-21 (UAT ISSUE-004).
  Enrichment would require N+1 `worldState` reads OR a schema diff
  forbidden by D-P2-9; the remaining columns satisfy AC#2.
- HoverCard speculative `useEffect` import + `void useEffect` hush
  comment removed (review-A nit).
- `de-risking.md` §1.8 wording aligned to `t >= extractedAtTurn` impl
  semantics with engine-source citation (D-P2-20; review-A Med-1).
- `de-risking.md` §1.7 RETIRED (not patched) — `reconstruct.ts`
  performs zero corpse-contents derivation and `HoverCard.tsx` reads
  `bundle.worldState.corpses[]` directly, so the feared
  derivation-vs-truth divergence has no surface. Parallels D-P2-12 for
  chests (D-P2-22; review-B Med-3).

Phase-2 sub-package test count went 115 → 122 in this slice. Root
`npm test` went 447 → 454 passing (4 LIVE_AZURE skips unchanged).

### 5.1 Live-agent equipment + HP not derivable per turn — D-P2-11

**Tag:** v0 acceptable.

**Surface.** Hover card on a live agent renders literal `"see expand
panel"` for the `hp` and `equipped` rows
(`apps/replay/src/components/HoverCard.tsx:230-231`).

**Why the gap exists.** The phase-1 substrate (frozen by D-P2-9) does
not persist per-turn HP on `agentRecords[]`
(`convex/schema.ts:262-271` carries no HP field) and the engine ledger
emits only the generic literals `"opened"` / `"looted"` for
`interact`/`loot` results (`convex/engine/resolution.ts:547,586`); no
`equipped_<item>` or `looted_<item>` strings carry item identity.

**User-facing fallback.** The expand modal's *Visible state digest* tab
surfaces `agentRecord.input.visibleStateDigest` — the agent's own view
of its equipped + HP at the start of the turn, captured per
`agentRecordValidator` (ADR §7). That digest is authoritative for the
agent's perspective and is sufficient for the vibe-judgement success
criterion.

**Resolution path.** Deferred to a downstream phase that revisits the
schema. Adding per-turn equipped + HP fields is a low-risk additive
schema diff but pre-pays a debugging surface the user has not asked for
in v0.

### 5.2 Opened-chest contents not persisted — D-P2-12

**Tag:** v0 acceptable.

**Surface.** Hover card on an opened chest renders literal
`"contents not persisted"` (`HoverCard.tsx:296`).

**Why the gap exists.** Engine clears `worldState.chests[i].contents`
to `null` when opening succeeds (`convex/engine/resolution.ts:537`).
The terminal `worldState.chests[]` therefore preserves only the
opened-flag; original contents are lost.

**User-facing fallback.** When an agent equips a chest item, the
side-panel feed surfaces it implicitly through the agent's `say` /
scratchpad delta on the same turn (the LLM tends to narrate equips).
Corpse contents — the other place loot identity matters — are
authoritative via `worldState.corpses[]`.

**Resolution path.** Deferred to a downstream phase. Two options
considered and rejected for v0: (a) re-running the loot RNG against
`match.rngSeed` in the renderer would import engine runtime across the
slice boundary (forbidden by architecture.md §1); (b) persisting
opened-chest contents would mean a schema diff (forbidden by D-P2-9).

### 5.3 Stale CLI counterpart vocabulary — `harness/analyze-match.ts`

**Tag:** deferred (phase-1 follow-up; not in phase-2 scope).

**Surface.** `harness/analyze-match.ts:49-58` references result-string
literals (`"hit"`, `"missed"`, `"killed"`, `"equipped_<item>"`,
`"looted_<item>"`) that the engine never emits. Per D-P2-14 the
canonical source is `convex/engine/resolution.ts:374-586` and the v0
renderer's vocabulary derives from there directly.

**Why this is documented here.** During the plan-refinement review
this drift was spotted and the renderer's vocabulary was anchored to
the correct source. The CLI tool itself is left alone (substrate
freeze applies; `harness/analyze-match.ts` was not required to change
for the v0 renderer to be correct). A future phase that updates the
CLI should refresh that vocabulary at the same time.

### 5.4 Deferred nits surfaced in closure-readiness reviews

**Tag:** deferred (closure-readiness reviews + UAT; not phase-2-blocking).

One-liner each, with file:line refs and review/UAT source citation.
Conscious deferrals — none gate phase-2 closure; tracked here so the
next phase that revisits these surfaces can address them.

- **Persona-colour palette duplicated across `Grid.tsx` and `TurnFeed.tsx`**
  (`apps/replay/src/components/Grid.tsx`,
  `apps/replay/src/components/TurnFeed.tsx`; review-A Med-2). Conscious
  choice — extract to a shared module on the third caller, not earlier.
- **Wall hover precision: NW-corner coordinate displayed for multi-tile
  walls** (`apps/replay/src/routes/Replay.tsx:105-109` TODO; review-A/C
  nit). Per-tile hover would require splitting wall geometry; deferred
  until user signals it impedes vibe-judgement.
- **HoverCard first-paint edge-clamp uses fallback dimensions before
  measuring** (`apps/replay/src/components/HoverCard.tsx:74-78`;
  review-A nit). Fallback `220 × 320` is used until the ref is
  measured; brief one-frame mis-clamp at first hover only.
- **UAT ISSUE-005 hover state-machine fragility** (UAT report).
  Test artefact — could not reproduce with normal mouse usage; logged
  for completeness pending real-world observation.
- **Kill-attribution v0 contract — multi-attacker same-turn deaths
  produce duplicate kill claims**
  (`apps/replay/src/lib/decisionEnglish.ts:351-358`,
  `apps/replay/src/lib/__tests__/decisionEnglish.test.ts:457-512`,
  `convex/engine/resolution.ts:374-586`; review-B Med-2 / review-A
  nit #5; D-P2-25). The renderer appends `" — killed <displayName>"`
  to *any* attacker whose attack outcome lands on a target appearing
  in `resolution.deaths[]` on the same turn. When two or more agents
  hit the same dying target simultaneously, each agent's feed row
  claims the kill — the test at lines 503-510 explicitly locks this
  contract ("the kill suffix appears for any attacker whose attack
  outcome lands on the dying target on the same turn. Both attackers
  get it"). Disambiguating would require either re-deriving last-blow
  attribution from a substrate diff (forbidden by D-P2-9 — engine
  emits `dmg N` traces + a flat `deaths[]` list, never a last-blow
  field) or falling back to conservative wording like "target died
  this turn" that would degrade the common single-attacker case where
  the current copy reads cleanly. Defer to consumer-renderer
  wishlist; the user can read `resolution.deaths[]` via the LLM trace
  / parsed-decision JSON for the full picture in v0.
- **de-risking §1.8 test-prose alignment — Grid filter not directly
  asserted by reconstruct tests**
  (`docs/project/phases/02-replay-overseer-v0/de-risking.md:188-196`,
  `apps/replay/src/components/Grid.tsx:207-212`,
  `apps/replay/src/lib/__tests__/reconstruct.test.ts:712-750`;
  review-A nit #3; D-P2-26). §1.8's "Test (Vitest)" prose claims the
  test asserts the Grid grid-filter expression
  (`extractedAtTurn === null || extractedAtTurn > snapshot.turn`);
  the actual Vitest cases at `reconstruct.test.ts:712-750` only
  assert reconstruct's snapshot semantics
  (`aSnap.extractedAtTurn === 50` at turn 50, `null` at turn 49) —
  they do not mount `<Grid>` or exercise the filter at
  `Grid.tsx:207-212`. Functional behaviour is correct (filter +
  reconstruct semantics agree on `t >= extractedAtTurn → hidden` per
  D-P2-20); the gap is purely documentary. Closing requires either
  (a) trimming the §1.8 "Test" paragraph to match what the test
  actually asserts, or (b) adding a thin RTL test that mounts
  `<Grid>` with an extracted-character snapshot and asserts the
  agent token is absent. Defer as optional polish — the next phase
  that touches the Grid component is the natural moment.
- **First-paint URL canonicalisation — bare `#/match/<id>` rewrites
  to `?turn=0` on mount**
  (`apps/replay/src/components/TurnStepper.tsx:42-70`; review-A
  nit #4). The `useEffect(() => syncUrlTurn(currentTurn),
  [currentTurn])` at `TurnStepper.tsx:68-70` fires on mount as well
  as on subsequent `currentTurn` changes, so visiting
  `#/match/<id>` (no `?turn=`) immediately rewrites the URL bar to
  `#/match/<id>?turn=0`. `syncUrlTurn`'s hash-equality guard at
  `TurnStepper.tsx:55` prevents re-entrant history churn (it returns
  early when `window.location.hash === nextHash`), so the rewrite is
  a single `replaceState` call and there is no observable runtime
  loop. Functional no-op; mild polish — may surprise anyone
  hand-typing or share-testing the canonical un-parameterised
  URL. Defer as optional polish; the natural fix is to skip the
  effect on the mount tick when the URL already has no `?turn=`
  param (or to gate the write on `props.turn !== currentTurn`).

---

## 6. How to run

```bash
# 1. One-off install (sub-package has its own node_modules)
npm install --prefix apps/replay

# 2. Configure the dev Convex deployment URL
cp apps/replay/.env.example apps/replay/.env
# Edit `apps/replay/.env` and set:
#   VITE_CONVEX_URL=https://<your-deployment-slug>.convex.cloud
# This is the same URL `npx convex dev` prints in the repo root.

# 3. Start the renderer (Vite dev server on :5173)
npm run dev:replay
# → http://localhost:5173/

# Optional: produce a static bundle (no deploy target — sanity only)
npm run build:replay
```

**Hash routes:**

- `#/` — match-picker page (paginated, completed-only,
  reverse-chronological).
- `#/match/<matchId>` — replay route at synthetic turn 0 (spawn
  positions).
- `#/match/<matchId>?turn=N` — replay route deep-linked to turn N.
  The slider hydrates from this; updates push history shallowly so the
  browser back button steps the slider.

**Convex deployment.** The renderer is read-only against the user's
own Convex dev deployment — no auth, no public deploy, no write paths.
Any matchId visible to `npx convex run replay:listMatches '{...}'` is
visible in the picker.

---

## 7. What this v0 unblocks

Mirror of `mental-model.md` §11 ("What this slice unblocks"):

- **Persona-behaviour intuition the closing report cannot show.** The
  user can now look at *why* `vulture` extracts at 42% (do they push
  hard, or do they out-survive?), *what* `trader`'s 1 583 speech
  events actually look like (lyrical or spammy?), *whether*
  `paranoid`'s 5-equip / 1 449-speech / 13-extract pattern is the
  evac-corner camp behaviour the post-Gate-2.5 tunings intended.
  Decisions about persona prompt-edits in the next phase can be made
  on observed-behaviour evidence, not just aggregate stats.
- **Cursed-item flavour-text moderation sense.** The user needs an
  intuition for how speech and item names *feel* in-context before
  authoring aggressive prompt-injection content. The replay overseer
  surfaces the speech feed alongside the agent's scratchpad delta,
  which is the substrate the cursed-item authoring loop will write
  into.
- **Eventual consumer-renderer specification.** v0 reveals which
  inspection surfaces are *load-bearing for understanding* a match
  (the side-panel feed, the visibleStateDigest, the scratchpad diff)
  versus which are *diagnostic-only* (full system prompt, raw LLM
  trace, copy-to-clipboard). The consumer renderer can replicate the
  former and drop the latter — but only after the user has used v0
  enough to know which is which.

---

## 8. Cross-references

Phase 2 documents that together form the full record:

- `README.md` — phase goal / scope / Cucumber surface / hard
  out-of-scope / dependency map.
- `architecture-decisions.md` — ADR §1..§12 capturing decisions
  D-P2-1..D-P2-14. D-P2-15..D-P2-23 are conversation Decision Record
  entries — orchestration / dispatch / closure-readiness level, not
  architecture; the §2 ADR adherence table above is the authoritative
  evidence index for those.
- `work-packages.md` — WP-A through WP-D scope, acceptance, test
  strategy, risks; "Closing the phase" §1-§3.
- `de-risking.md` — single load-bearing unknown
  (position-reconstruction correctness) decomposed into 9 enumerated
  failure modes, retired by Vitest tests in `reconstruct.test.ts`.
- `docs/project/spec/mental-model.md` §11 — phase 2 why-layer
  (read-only).
- `docs/project/spec/architecture.md` §1 / pillar 7 — slice
  boundary the renderer respects.
- `docs/project/phases/01-engine-and-harness/PHASE-1-CLOSURE.md` —
  phase-1 closure that this document mirrors.

---

## 9. User vibe-judgement (signoff — to be filled by user)

> This section is the user's signoff. It is intentionally empty at
> draft time. The phase is **not closed** until the user fills the
> fields below. Filling them — or filing a follow-up phase to address
> what the overseer revealed — closes phase 2 v0 per
> `work-packages.md` "Closing the phase" §3.

- **Date:** _yyyy-mm-dd_
- **Matches walked (matchId × persona-of-interest):**
  - _matchId_1_ — _persona / observation_
  - _matchId_2_ — _persona / observation_
  - _matchId_3_ — _persona / observation_
- **Vibe verdict (positive / mixed / negative):** _…_
- **Observations that influence the next phase:** _…_
- **Follow-up phase tickets surfaced:** _…_

---

*This is a closure RECORD. It captures what was true when the user
walked the v0. Update this document only to fill §9 or to record
follow-up phase tickets surfaced by the user's vibe-judgement.
Do not retroactively edit §1-§8 — file a phase-3 plan instead.*
