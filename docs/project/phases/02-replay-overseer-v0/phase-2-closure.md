# Phase 2 v0 — Closure Record (Personal Replay Overseer)

> Single-file handoff for downstream phase planning. Records what was
> built, what proves it, what is intentionally absent, and what is still
> pending the user's final vibe-judgement.
>
> Closure record drafted: 2026-05-08 (commit `c39be0b`). Closure-readiness
> round-1 fixes + known-issues populated 2026-05-08 (commits `2833537` +
> `aee6397`). Closure-readiness round-2 fixes + deferred-known-issues
> populated 2026-05-08 (commits `61c9c2b` + `d3c0370`). Closure-readiness
> round-3 (Med-1 feed-scroll fix + 2 Lows + 2 closure-doc citation
> tightenings) populated 2026-05-08 (commit `5ebe737`). Closure-readiness
> round-4 (intended-final: ADR §6 staleness + lastSurvivor doc drift +
> ReplayErrorBoundary `<details>` parity + 3 §5.4 deferred entries)
> populated 2026-05-08 (commit `dc4101b`). Closure-readiness round-5
> (doc-only cleanup: WP-A acceptance bullet `D-P2-21 supersedes` +
> kill-attribution test header annotation + ReplayErrorBoundary comment
> retarget + 4 §5.4 deferred entries + 3 ADR rows D-P2-41..43) populated
> 2026-05-08 (single commit per `D-P2-41a` rationale; closure record
> continues to cite `dc4101b` as the implement-substantive sealing SHA
> per round-3/4 precedent). Phase-2 dispatch baseline: `7c22284`.
>
> Round-3 was projected as target-final, but the third COMPLETION REVIEW
> group surfaced 1 Med-2 doc finding (ADR §6 staleness vs. the
> `history.replaceState` semantics) plus 2 Lows (lastSurvivor doc drift
> in `architecture-decisions.md` / `work-packages.md`, and a
> `ReplayErrorBoundary` `<details>` parity gap against `Replay.tsx`).
> Round-4 absorbed all three. The fourth COMPLETION REVIEW group then
> returned 3 Pass + 1 Concern-no-Highs + UAT Pass-1-Low against HEAD
> `96b3679`; reviewer consensus was "no round-5 implementation cycle
> warranted", with reviewer B conditioning closure on `patch-OR-§5.4`
> treatment of 4 Lows. Round-5 discharges that condition as a doc-only
> cleanup (this round). With round-5 sealed, the engineering scope of
> phase 2 v0 is COMPLETE; the remaining substrate is the user's §9
> vibe-judgement per north-star §COMPLETION CONDITION (qualitative
> confidence on 3+ matches). No further COMPLETION REVIEW group is
> dispatched after round-5 (per D-P2-41 reviewer consensus).
>
> This is a closure RECORD, not a retrospective and not a phase-3 plan.

---

## Status banner

**Implementation: COMPLETE.** All four work packages (WP-A → WP-D) have
landed across four feature commits between dispatch (`7c22284`,
2026-05-08) and the post-implementation tip (`4db9757`, 2026-05-08);
seven follow-up commits (`2833537`, `aee6397`, `61c9c2b`, `d3c0370`,
`5ebe737`, `dc4101b`, round-5) close five rounds of closure-readiness
fixes and reconcile docs. Engineering hygiene gates green at root and
at the `apps/replay/` sub-package: `npm run lint`, `npm run typecheck`,
`npm run build`, `npm test` (457 passed, 4 LIVE_AZURE-gated skips —
332 phase-1 + 125 phase-2 sub-package; phase-2 net adds 10 since the
draft for the `TurnFeed.test.tsx` truncation suite (round-1, +7) and
`decisionEnglish.test.ts` pluralisation cases (round-2, +3); round-3
is pure CSS + UI rearrangement, no test count delta; round-4 is
doc + tiny renderer parity, no test count delta; round-5 is doc-only
+ a single comment annotation in `decisionEnglish.test.ts:493`, no
test count delta). `apps/replay` Vite build: 131 modules, 80.01 KB
gzipped (round-5 changes are comment-only inside `.tsx` files —
build size unchanged). Substrate freeze (D-P2-9) verified — empty diff
over `convex/engine`, `convex/llm`, `convex/runMatch.ts`,
`convex/schema.ts`, `personas/*`, `harness/*` from dispatch through
the round-5 sealing tip.

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

Total: 125 Vitest tests inside the sub-package, all passing
(115 at draft + 7 added by round-1 closure-readiness for the
`truncateOneLine` helper + 3 added by round-2 closure-readiness for
the `decisionEnglish` move-template `tile`/`tiles` pluralisation).

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
| `apps/replay/.../lib/__tests__/decisionEnglish.test.ts` | 54 | ADR §5 vocabulary table; canonical source `convex/engine/resolution.ts:374-586` (D-P2-14); +3 round-2 cases pinning singular/plural move-template (`tile`/`tiles`, ISSUE-001) |
| `apps/replay/.../lib/__tests__/formatters.test.ts` | 23 | usage/latency/scratchpad-diff helpers (pure) |
| `apps/replay/.../lib/__tests__/useHashRoute.test.ts` | 16 | hash-route parser (pure) |
| `apps/replay/.../components/__tests__/TurnFeed.test.tsx` | 7 | `truncateOneLine` boundary behaviour (round-1 closure-readiness — AC#7) |
| **Phase-2 sub-total** | **125** | tests-first per AOP for the pure modules + the truncation helper + the pluralisation cases |
| Phase-1 carry-over (`tests/**`) | 332 + 4 skipped | `LIVE_AZURE`-gated skips unchanged from phase 1 |
| **Suite total** | **457 + 4 skipped** | matches phase-1 baseline (332) + phase-2 net adds (125) |

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
  - `build:replay` → sub-package `vite build` (131 modules, ~80 KB
    gzipped per implement-job report — 80.01 KB at HEAD `5ebe737`,
    79.93 KB at `61c9c2b`).
- `vitest.config.ts` — `include` extended with
  `apps/replay/src/**/*.test.ts(x)` so root `npm test` covers both
  packages (no separate command).
- `.gitignore` — `apps/replay/node_modules/`, `apps/replay/dist/`,
  `apps/replay/.env`.

---

## 2. ADR adherence summary

Each phase-2 decision (`D-P2-1`..`D-P2-43`, sourced from
`architecture-decisions.md` and the conversation Decision Record)
ticked off with one line of agent-verifiable evidence. Decisions
`D-P2-18`..`D-P2-43` are closure-readiness orchestration entries
(`D-P2-18`..`D-P2-23` round-1; `D-P2-24`..`D-P2-29` round-2;
`D-P2-30`..`D-P2-33` round-3 implement; `D-P2-34`..`D-P2-35` round-3
review-group + §9 template restoration; `D-P2-36`..`D-P2-38` round-4
implement + cosmetic-deferral bundle; `D-P2-39`..`D-P2-40` round-4
bundle-complete + fourth COMPLETION REVIEW group dispatch;
`D-P2-41`..`D-P2-43` round-5 doc-only cleanup + assignment-complete
handoff) recorded after the implement job; they do not have
ADR-section counterparts in `architecture-decisions.md`.

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
| D-P2-23 | COMPLETION REVIEW group dispatched in parallel (review + uat + document); gates AOP.VALIDATE'd independently before dispatch | First COMPLETION REVIEW group ran against `aee6397` and produced the round-2 must-fix bundle. |
| D-P2-24 | Round-2 closure-readiness scope = Med-1 (CSS body reset, AC#4) + UAT Lows ISSUE-001 (pluralisation) + ISSUE-003 (Replay error boundary) | All three landed in `61c9c2b`; pure-renderer fixes; substrate freeze D-P2-9 holds (see §4). |
| D-P2-25 | Med-2 (kill-attribution false-claim) DEFERRED — engine doesn't surface last-blow attribution; conservative wording would degrade common single-attacker case | Documented as deferred known-issue in §5.4 with file:line citations to `decisionEnglish.ts:351-358`, `decisionEnglish.test.ts:457-512`, `convex/engine/resolution.ts:374-586`. |
| D-P2-26 | Review-A Lows #3 (test-prose §1.8 alignment) and #4 (first-paint URL canonicalisation) bundled into §5.4 deferred — optional polish, no AC impact | Both entries present in §5.4 with file:line refs (`de-risking.md:188-196`, `Grid.tsx:207-212`, `reconstruct.test.ts:712-750`, `TurnStepper.tsx:42-70`). |
| D-P2-27 | After round-2 implement, dispatch second COMPLETION REVIEW group (review + uat + document) gating user §9 vibe-judgement | Second iteration of the closure-completion path; this document pass is the `document` strand of that second group running against HEAD `61c9c2b`. §9 preserved empty per north-star §COMPLETION CONDITION. |
| D-P2-28 | `ReplayErrorBoundary` is intentionally dual-layer (sync class boundary in `main.tsx` + async `.catch()` friendly-hint frame in `Replay.tsx`) — React error boundaries don't catch promise rejections, so defence-in-depth is required | `apps/replay/src/main.tsx` `ReplayErrorBoundary` class wraps `<Replay key={route.matchId}/>` (render-time throws e.g. malformed bundle crashing `reconstruct`); `apps/replay/src/routes/Replay.tsx:83-87` `.catch()` path renders friendly hint frame for Convex `ArgumentValidationError` (the actual UAT ISSUE-003 trigger on bogus matchId). |
| D-P2-29 | Round-2 closure-readiness bundle COMPLETE; substrate freeze D-P2-9 holds; ready for second COMPLETION REVIEW group dispatch | Commits `61c9c2b` + `d3c0370` landed; all gates green at HEAD; substrate-freeze diff `7c22284..61c9c2b` empty (see §4). |
| D-P2-30 | Round-3 scope = Med-1 feed-row clipping at 1280×720 / 1366×768 (AC#7) + 2 Lows (Replay.tsx comment-label correction; raw Convex error gated behind `<details>`) + 2 closure-doc citation tightenings (§5.4 kill-attribution test-line range; §6 "push history shallowly" → `replaceState`) | Single commit `5ebe737` lands the renderer-side fixes + closure-doc reconciliation; pure renderer + docs; substrate freeze (D-P2-9) holds. |
| D-P2-31 | Med-1 feed-row clipping fix = move `overflow-y: auto` from inner feed-list `<div>` to the `<aside>` itself + `position: sticky; top: 0` on the feed header to keep the "Turn N · M decisions" caption visible while rows scroll | `apps/replay/src/components/TurnFeed.tsx` `feedStyle` now `overflowY: 'auto'` + `overscrollBehavior: 'contain'` + `minHeight: 0`; `feedHeaderStyle` now `position: 'sticky', top: 0, zIndex: 1`; `feedListStyle` simplified to a non-shrinking row stack. Browser-probed at 1280×720, 1366×768, 1920×1080 against closing-50 match `j977k5vpq9275kg5pr31cybavs869w0h` turn 2 (8 alive); all 8 rows reachable; AC#4 `documentElement.scrollHeight === clientHeight` intact at all 3 viewports. |
| D-P2-32 | Replay.tsx error-path raw Convex `ArgumentValidationError` is opt-in detail, not body copy — gated behind `<details><summary>raw error</summary>` | `apps/replay/src/routes/Replay.tsx:219-238` renders `<details>` (collapsed by default) inside the friendly hint frame; the body paragraph stays the primary copy. Browser-probed on `#/match/bogus_id_123`: friendly hint visible, raw `ArgumentValidationError` only appears when the user expands the toggle. Mirrors `PickerErrorBoundary` visual language (review-A nit / round-3 Low). |
| D-P2-33 | Round-3 closure-readiness bundle COMPLETE; substrate freeze D-P2-9 holds; third COMPLETION REVIEW group's user §9 vibe-judgement gate now unblocked | Commit `5ebe737` landed; all gates green (lint/typecheck/test/build); substrate-freeze diff `7c22284..5ebe737` empty (see §4); §9 preserved empty per north-star §COMPLETION CONDITION. |
| D-P2-34 | Third (target-final) COMPLETION REVIEW group dispatched against HEAD `5ebe737` and produced no Highs — releases the user-vibe-judgement gate without further blocking-fix iteration | Conversation Decision Record entry; this document seals the closure record at `5ebe737`. If review/UAT had surfaced Highs they would appear in a *Round-3 blocking findings* subsection between §5.0 and §5.1 — that subsection is intentionally absent here. |
| D-P2-35 | §9 vibe-judgement template restored — the round-3 implement strand stripped the structured placeholder (Date / Matches walked / Vibe verdict / Observations / Follow-up tickets) that round-1 introduced and round-2 preserved; this document pass restores it for the user's free-form signoff | §9 below carries the same placeholder bullets as round-2 (`cba3630`); the user's vibe-judgement copy fills those fields. The north-star §COMPLETION CONDITION sets the gate (qualitative confidence on 3+ matches), NOT the doc structure — restoring the template is closure-record hygiene, not a north-star gate. |
| D-P2-36 | Round-4 closure-readiness scope = ADR §6 staleness (Med-2, Review A — `architecture-decisions.md` §6 wording vs. `history.replaceState` semantics) + lastSurvivor doc drift (Low, Review B — `architecture-decisions.md` §3 / `work-packages.md` WP-A picker bullet vs. D-P2-21 column drop) + ReplayErrorBoundary `<details>` parity (Low, Reviews A+B — `apps/replay/src/main.tsx` sync error boundary vs. `Replay.tsx:234-237` `<details><summary>raw error</summary><code>…</code></details>`). All three trivial; substrate freeze (D-P2-9) holds. | Single round-4 commit `dc4101b`; touches `architecture-decisions.md` §3 + §6, `work-packages.md` WP-A picker bullet, `apps/replay/src/main.tsx` sync error-boundary frame, and this document (§5.0 round-4 subsection + §5.4 +3 deferred bullets + §2 +3 rows + status banner). `git diff 7c22284..dc4101b -- convex/engine convex/llm convex/runMatch.ts convex/schema.ts personas harness` empty (see §4). |
| D-P2-37 | After the round-4 implement lands, dispatch the FOURTH (and intended-final-final) COMPLETION REVIEW group (review + uat + document) — fourth iteration of the D-P2-19 / D-P2-27 / D-P2-33 closure-completion path. Once that group passes with no Highs, the user proceeds to §9 vibe-judgement per north-star §COMPLETION CONDITION. | Conversation Decision Record entry; this document's §3.4 will be extended once the fourth group runs (future-work narrative, parallel to the third-group narrative already inline). If the fourth group surfaces Highs they would appear in a *Round-4 blocking findings* subsection between §5.0 and §5.1 — that subsection is intentionally absent here (mirroring D-P2-34 for round-3). |
| D-P2-38 | Cosmetic items deferred to §5.4 known issues (NOT blocking the user's §9 vibe-judgement): (a) `apps/replay/src/routes/Replay.tsx:47, :217, :418` retain `UAT ISSUE-002` / `UAT ISSUE-003` references — exempt because those numbers uniquely identify the originating UAT report (round-1 ISSUE-001 was the collision case that motivated the round-3 AC-anchor relabelling at `:370-372` / `:491-498`; ISSUE-002 and ISSUE-003 do not collide and the cite preserves traceability into the UAT report); (b) the §5.4 kill-attribution citation `:524-548` was tightened in-place to `:539-547` in round-4 — the contract-decision comment block actually starts at `:539` and the assertions are at `:544-547` (Review A Low-4 / cosmetic); (c) `convex/replay.ts` `getReplayBundle` accepts any valid match id, but the picker filters `status === "completed"` (`convex/replay.ts` `listMatches`), so a user pasting a VALID-but-not-completed match id directly into the URL would get a partial bundle — defense-in-depth (return `null` when `match.status !== "completed"`) is a future-phase polish, not a UX gap (the documented entry point is the picker, completed-only). | The three new §5.4 bullets added in round-4 — see §5.4 entries appended at the end of that section (Comment-label scheme inconsistency / Citation polish marker / `getReplayBundle` non-completed-match defense-in-depth). |
| D-P2-39 | Round-4 closure-readiness bundle COMPLETE; substrate freeze D-P2-9 holds; fourth COMPLETION REVIEW group's user §9 vibe-judgement gate now positioned for release | Two-commit shape: implement `dc4101b` + SHA-substitute follow-up `96b3679`, mirroring the round-3 `5ebe737` → `d27bd79` pattern (no-amend directive forbids the in-place alternative; shipping with `<HEAD>` placeholders was the closure-doc hygiene debt review-A surfaced in round-3). All gates green at HEAD `96b3679`: lint clean / typecheck clean (root + `apps/replay/`) / 457 pass + 4 LIVE_AZURE skip / `apps/replay` Vite build 131 modules / 80.01 KB gzipped. Substrate-freeze diff `7c22284..dc4101b` empty (see §4); `dc4101b..96b3679` touches only this document (SHA substitution). §9 preserved empty per north-star §COMPLETION CONDITION. |
| D-P2-40 | Fourth (intended-final-final) COMPLETION REVIEW group dispatched in parallel against HEAD `dc4101b` (the substantive UX-surface tip) — review + uat + document strands. Gates AOP.VALIDATE'd independently before dispatch. UAT focus narrows to the only renderer-touching change in round-4 (`ReplayErrorBoundary` `<details>` parity in `apps/replay/src/main.tsx`); the ADR §6 / lastSurvivor / closure-doc fixes have no UX surface. Document strand AOP.VALIDATE's the implement strand's "§9 template left untouched" claim against `git show d27bd79:.../phase-2-closure.md`. | Conversation Decision Record entry; this document seals the closure record at `dc4101b` (implement) / `96b3679` (SHA-substitute follow-up). If review/UAT surfaced Highs they would appear in a *Round-4 blocking findings* subsection between §5.0 and §5.1 — that subsection is intentionally absent here (mirroring D-P2-34 for round-3). With the gate released, the north-star §COMPLETION CONDITION narrows to the user filling §9 below. |
| D-P2-41 | Fourth COMPLETION REVIEW group OUTCOME against HEAD `96b3679` = 3 Pass + 1 Concern-no-Highs + UAT Pass-1-Low. Zero Highs surfaced. Reviewer consensus: NO round-5 implementation cycle warranted. Reviewer B's Concern was conditioned on "patch-OR-§5.4" treatment of 4 Lows — round-5 discharges that condition with a doc-only cleanup bundle (3 patches + 1 §5.4 deferred for the unrenderable UAT corpse-hover gap) and 4 explicit `D-P2-41a..d` deferral entries for the polish nits the reviewers raised. | Conversation Decision Record entry; this document's §3.4 fourth-group narrative is replaced (see below) with the actual verdict; the speculative "If review/UAT surfaced Highs they would appear in a *Round-4 blocking findings* subsection" sentence on D-P2-40 holds — that subsection is empty because no Highs were surfaced. Round-5 §5.0 subsection (added below) enumerates the 9 review-surfaced items and how each was discharged. |
| D-P2-42 | Round-5 scope = doc-only cleanup discharging Reviewer B's Concern condition. Three substantive patches (`work-packages.md` WP-A acceptance bullet — `D-P2-21 supersedes` block-quote mirroring the round-4 pattern at `architecture-decisions.md:233`; `apps/replay/src/lib/__tests__/decisionEnglish.test.ts:493` — single-line v0-contract annotation per D-P2-25; `apps/replay/src/main.tsx:8-17, :29-44` — ReplayErrorBoundary comment retarget to clarify sync vs async layers per D-P2-28) + four §5.4 deferred entries (`D-P2-41a..d`) + three ADR-table rows (`D-P2-41..D-P2-43`). Substrate freeze (D-P2-9) holds. Single commit, NOT a two-commit shape — round-5 explicitly defers the SHA-citation chase per `D-P2-41a` rationale (closure record citing `dc4101b` is the implement-substantive SHA per round-3/4 precedent; bumping introduces a recursive doc-update loop). | Single round-5 commit; touches `phase-2-closure.md` (this document), `work-packages.md` WP-A acceptance bullet, `apps/replay/src/lib/__tests__/decisionEnglish.test.ts` (1 comment annotation, no test count delta), `apps/replay/src/main.tsx` (comment retarget, no runtime delta). `git diff 7c22284..HEAD -- convex/engine convex/llm convex/runMatch.ts convex/schema.ts personas harness` empty (see §4); `apps/replay` Vite build unchanged at 131 modules / 80.01 KB gzipped (no runtime diff — comment-only changes inside .tsx files). NO further COMPLETION REVIEW group dispatched after round-5 — reviewer consensus on the round-4 group already cleared the "no Highs" gate. |
| D-P2-43 | After round-5 lands, the engineering scope of phase 2 v0 is COMPLETE. The remaining substrate is the user's §9 vibe-judgement entry per north-star §COMPLETION CONDITION — qualitative confidence on 3+ matches walked through the renderer. Assignment-complete handoff to user: this document is the final substrate-handoff artefact; no further fix/review iteration is dispatched by the engineering team unless §9 surfaces a finding the user explicitly escalates back. | Conversation Decision Record entry. §9 below preserved in `d27bd79`-restored form (Date / Matches walked / Vibe verdict / Observations / Follow-up tickets) — verified byte-identical against `git show d27bd79:docs/project/phases/02-replay-overseer-v0/phase-2-closure.md` at round-5 sealing. The next PM cycle marks assignment complete on the basis of this row + the round-5 §5.0 subsection's "all 9 review-surfaced items discharged" enumeration. |

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
| Then bird's-eye 100×100 grid fits viewport | `Grid.tsx` SVG `viewBox="0 0 100 100"`; wrapped in `gridSquareStyle` (`Replay.tsx:496-501` — `aspect-ratio: 1/1` + `max-width: 100%` + `height: 100%`) inside a viewport-bounded main column. Round-2 also added a global CSS reset at `apps/replay/src/index.css` (`html, body, #root { margin: 0; min-height: 100% }`) imported from `main.tsx`, removing the 16 px body margin that was clipping the feed last-row at 1280×720 (round-2 closure-readiness Med-1 / AC#4; commit `61c9c2b`). Round-3 then moved the side-panel scroll affordance from the inner feed-list `<div>` onto the `<aside>` itself + made the feed header `position: sticky` so all 8 agent rows are reachable on early/mid turns at 1280×720 / 1366×768 (round-3 closure-readiness Med-1 / AC#7; commit `5ebe737`). |
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
resolved in the round-1 closure-readiness commit `2833537` per §5.0
below.

The first COMPLETION REVIEW group (review × 3 + uat + document,
dispatched per D-P2-23) ran against `aee6397` and produced 0 Highs, 2
Meds, and 3 Lows. Med-1 (16 px body-margin overflow at 1280×720, AC#4
strict letter) and the two ISSUE Lows (ISSUE-001 plural, ISSUE-003
friendly error frame) were resolved in the round-2 commit `61c9c2b`
per §5.0 below. Med-2 (kill-attribution false-claim) and the two
optional-polish Lows (review-A nits #3 and #4) are documented as
deferred known-issues in §5.4 (D-P2-25, D-P2-26).

The second COMPLETION REVIEW group (review × 2 + uat + document,
dispatched per D-P2-27) ran against HEAD `61c9c2b` and produced one
Med blocker (UAT ISSUE-UAT-001 — feed-row clipping at 1280×720 and
1366×768; Player_7/8 unreachable due to inner-list scroll affordance
not registering wheel events on Linux Chromium) plus 4 Lows (2
Replay.tsx comment-label / details-toggle code nits + 2 closure-doc
citation precision findings). The Med + 2 Lows touching renderer code
+ 2 closure-doc reconciliations all landed in round-3 commit
`5ebe737` per §5.0 below. No round-3 deferrals — all 5 items were
in-scope and resolved.

The third COMPLETION REVIEW group (running against HEAD `5ebe737`,
dispatched per D-P2-33) surfaced no Highs but did flag 1 Med-2 doc
finding (Review A — ADR §6 staleness vs. the `history.replaceState`
semantics already documented in this document's §6) plus 2 Lows
(Review B — lastSurvivor doc drift in `architecture-decisions.md` §3
and `work-packages.md` WP-A picker bullet vs. D-P2-21's column drop;
Reviews A + B — `ReplayErrorBoundary` in `apps/replay/src/main.tsx`
not mirroring the `<details><summary>raw error</summary><code>…</code></details>`
visual language that `Replay.tsx:234-237` adopted in round-3). All
three were absorbed into round-4 commit `dc4101b` per D-P2-30..D-P2-36;
no round-3 deferrals reopened.

The fourth COMPLETION REVIEW group (running against HEAD `96b3679`,
dispatched per D-P2-37 / D-P2-40) returned 3 Pass + 1 Concern-no-Highs
+ UAT Pass-1-Low. Reviewer consensus: NO round-5 implementation cycle
warranted (zero Highs; the four Lows raised are documentary or
cosmetic). Reviewer B's Concern was conditioned on `patch-OR-§5.4`
treatment of those Lows; round-5 (doc-only cleanup) discharges that
condition with three small patches (WP-A acceptance bullet
`D-P2-21 supersedes` block-quote in `work-packages.md`; v0-contract
single-line annotation above the kill-attribution `it(...)` block in
`decisionEnglish.test.ts:493`; sync-vs-async retarget of the
`ReplayErrorBoundary` comments in `main.tsx:8-17, :29-44`) plus four
explicit `D-P2-41a..d` `§5.4` deferrals (closure-record SHA literalism,
6-vs-8 commit-count framing, round-3 wording understatement, UAT
ISSUE-001 corpse-hover not exercised). With round-5 sealed, the user
reads §9 fresh without a *Round-4 blocking findings* subsection
(mirroring D-P2-34 for round-3) — the engineering scope is complete and
the gate releases to the user's §9 vibe-judgement per north-star
§COMPLETION CONDITION.

---

## 4. Substrate freeze verification

Per D-P2-9 the phase-1 substrate is frozen — phase 2 introduces no
diff to the engine kernels, the LLM wrapper, the per-match orchestrator,
the schema, the persona content, or the harness CLI.

```
$ git diff 7c22284..dc4101b -- convex/engine convex/llm convex/runMatch.ts convex/schema.ts personas harness
(no output)
```

Verified at sealing time (HEAD = `dc4101b`). The only files touched in
`convex/` between dispatch and HEAD are `convex/replay.ts` (new module,
+92 lines) and the regenerated `convex/_generated/api.d.ts` (+2 lines —
the new module's typed surface). The six closure-readiness commits
(`2833537` round-1 code+README, `aee6397` round-1 docs, `61c9c2b`
round-2 code+test, `d3c0370` round-2 docs, `5ebe737` round-3 code +
docs combined, `dc4101b` round-4 code + docs combined) touched
**only** the renderer sub-package and
`docs/project/phases/02-replay-overseer-v0/*.md` — none modifies any
substrate path.

---

## 5. Known caveats / known-issues

Each entry is tagged **resolved** (closure-readiness — fixed in
round-1 `2833537`/`aee6397`, round-2 `61c9c2b`/`d3c0370`, round-3
`5ebe737`, round-4 `dc4101b`/`96b3679`, or round-5 doc-only cleanup),
**v0 acceptable** (intentional gap, surfaced as literal copy in the
UI) or **deferred** (downstream phase will close it). No
high-severity findings are open against this phase at sealing time.

### 5.0 Closure-readiness fixes applied (resolved)

**Tag:** resolved (closure-readiness — round-1 landed in `2833537` +
`aee6397`; round-2 landed in `61c9c2b` + `d3c0370`; round-3 landed in
`5ebe737`).

The first review-group pass (review × 3 reviewers + agent UAT against
`4db9757`) produced 4 AC-violating must-fix items + 5 lower-priority
items. All 9 are addressed in round-1.

The second (completion-review) group pass (review × 3 + uat + document
against `aee6397`) produced 0 Highs, 2 Meds, and 3 Lows. Of those, 1
Med + 2 Lows are resolved in round-2; 1 Med + 2 Lows are documented as
deferred known-issues in §5.4 (D-P2-25, D-P2-26).

The third (completion-review) group pass (review × 2 + uat + document
against `61c9c2b`) produced 0 Highs, 1 Med, and 4 Lows. All 5 items
are resolved in round-3 (`5ebe737`); no round-3 deferrals.

**AC-violating must-fix (4) — all resolved in round-1 commit `2833537`:**

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

**Lower-priority bundle (5) — resolved in round-1 commit `2833537`:**

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

Round-1 phase-2 sub-package test count went 115 → 122 in this slice.
Root `npm test` went 447 → 454 passing (4 LIVE_AZURE skips unchanged).

**Round-2 must-fix (3) — resolved in `61c9c2b`:**

- **AC#4 — Grid fit-to-viewport at 1280×720 (round-2 Med-1):**
  `apps/replay/src/index.css` adds a global reset (`html, body, #root
  { margin: 0; min-height: 100% }`) imported from
  `apps/replay/src/main.tsx`. Removes the 16 px body margin that was
  clipping the feed last-row at 1280×720 (and 1366×768) — the
  strict-letter Med-1 finding from completion-review B + UAT
  ISSUE-002. Browser-probed at both viewport sizes; `scrollHeight ===
  clientHeight` confirmed.
- **ISSUE-001 — Move-template pluralisation:**
  `apps/replay/src/lib/decisionEnglish.ts` move template now
  pluralises `count === 1 ? "tile" : "tiles"` instead of always
  `"tiles"`. **+3 Vitest cases** in
  `apps/replay/src/lib/__tests__/decisionEnglish.test.ts` pin
  singular/plural in two compass directions. (UAT Low ISSUE-001.)
- **ISSUE-003 — Friendly error frame on bogus matchId:**
  `apps/replay/src/main.tsx` adds a `ReplayErrorBoundary` class
  component (modeled on `PickerErrorBoundary`) wrapping `<Replay
  key={route.matchId}/>`. **Intentionally dual-layer (D-P2-28):** the
  React error boundary catches synchronous render-time throws (e.g.
  malformed bundle crashing `reconstruct`); the existing
  `Replay.tsx:83-87` `.catch()` path was extended with a friendly
  hint frame for asynchronous Convex `ArgumentValidationError`
  rejections (the actual ISSUE-003 trigger — React error boundaries
  do not catch promise rejections). Browser-probed on
  `#/match/bogus_id_123`: friendly hint, not raw Convex dump.

**Deferred from round-2 (3) — documented in §5.4 (D-P2-25, D-P2-26):**

- Med-2 kill-attribution false-claim (substrate-freeze blocked).
- Review-A Low #3 — de-risking §1.8 test-prose alignment (optional
  polish).
- Review-A Low #4 — first-paint URL canonicalisation (functional
  no-op; mild polish).

Round-2 phase-2 sub-package test count went 122 → 125. Root
`npm test` went 454 → 457 passing (4 LIVE_AZURE skips unchanged).
`apps/replay` Vite build went 130 modules / 79.51 KB gzipped → 131
modules / 79.93 KB gzipped.

**Round-3 must-fix + Lows (5) — all resolved in `5ebe737`:**

- **Med-1 / AC#7 — Feed-row clipping at 1280×720 / 1366×768
  (ISSUE-UAT-001):** with 8 alive agents on early/mid turns, Player_7
  and Player_8 rows were positioned below the visible aside box and
  the inner feed-list `<div>`'s `overflow-y: auto` did not surface a
  reachable scroll affordance (Linux Chromium overlay-style
  scrollbar; mouse-wheel inside the panel did not register). Fix in
  `apps/replay/src/components/TurnFeed.tsx`: moved `overflow-y: auto`
  from the inner row-list `<div>` onto the `<aside>` itself,
  added `position: sticky; top: 0; z-index: 1` to `feedHeaderStyle`
  so the "Turn N · M decisions" caption stays visible while rows
  scroll, and added `overscroll-behavior: contain` to keep wheel
  scroll local to the panel. The inner row-list `<div>` is now a
  non-shrinking stack (`flex-shrink: 0`). Browser-probed at three
  viewports (1280×720, 1366×768, 1920×1080) against closing-50 match
  `j977k5vpq9275kg5pr31cybavs869w0h` turn 2 (8 alive); all 8 rows
  reachable; AC#4 `documentElement.scrollHeight === clientHeight`
  intact at all 3 viewports; grid still square + fits its column.
- **Low — Replay.tsx comment-label correction**
  (`apps/replay/src/routes/Replay.tsx:370-372, :467-472`). The two
  comments on `mainStyle.height: '100vh'` and `gridSquareStyle`
  previously referenced "closure-readiness UAT ISSUE-001", which in
  this codebase is the round-2 pluralisation finding (round-1's
  fit-to-viewport finding shared the ISSUE-001 number under a
  different scheme). Both comments now reference AC#4 directly +
  "closure-readiness round-1 Med-1" so the AC anchor is unambiguous.
- **Low — Raw Convex error gated behind `<details>`**
  (`apps/replay/src/routes/Replay.tsx:219-238`). The friendly hint
  frame previously rendered the verbose Convex
  `ArgumentValidationError` message inline as a sibling paragraph
  ("`error:` <code>full Convex dump</code>"), drowning the actionable
  hint. Now the raw error sits inside a `<details><summary>raw
  error</summary>...</details>` (collapsed by default); the friendly
  hint is the primary copy. Browser-probed on `#/match/bogus_id_123`
  to confirm the toggle ships closed and expands cleanly.
- **Low — §5.4 kill-attribution citation precision**
  (closure-doc fix). Two reviewers independently flagged that the
  prior citation range `decisionEnglish.test.ts:457-512` and the
  prose "test at lines 503-510 explicitly locks this contract" were
  imprecise — `:503-510` is inside the resolution-actions FIXTURE
  array, not the assertion; the contract-locking comments +
  assertions are at `:524-548`. The §5.4 entry now cites
  `decisionEnglish.test.ts:493-548` (the full multi-attacker `it`
  block), with a callout that the contract is locked at `:524-548`
  and the assertions at `:544-547` pin only the target's display
  name (intentionally not "killed" presence/absence).
- **Low — §6 "push history shallowly" wording aligned to
  replaceState** (closure-doc fix). The §6 hash-route description
  said "updates push history shallowly" but
  `apps/replay/src/components/TurnStepper.tsx:42` uses
  `history.replaceState`, not a shallow push. The §6 prose now reads
  "updates rewrite the URL via `history.replaceState`" with a
  citation to `TurnStepper.tsx:42-57` and a one-sentence note that
  the back-button steps to the previous match (not the previous
  turn) per ADR §6 / D-P2-7.

Round-3 phase-2 sub-package test count unchanged at 125 (pure CSS +
UI rearrangement; no new logic to test). Root `npm test` unchanged at
457 passing (4 LIVE_AZURE skips unchanged). `apps/replay` Vite build
went 79.93 KB gzipped → 80.01 KB gzipped (+0.08 KB; sticky-header +
`<details>` toggle styles).

**Round-4 must-fix + Lows (3) + cosmetic deferrals (3) — resolved in `dc4101b`:**

- **Med-2 / ADR §6 staleness (Review A) — `architecture-decisions.md`
  §6 wording aligned to `history.replaceState` semantics.** §6's
  hash-route description previously framed slider URL writes loosely
  ("push/shallow"); this document's §6 was tightened in round-3 (commit
  `5ebe737`) to read "updates rewrite the URL via
  `history.replaceState`" with a citation to `TurnStepper.tsx:42-57`,
  but `architecture-decisions.md` §6 was not refreshed in the same
  pass. Round-4 brings ADR §6 inline with closure-doc §6 + the
  `TurnStepper.tsx:42-57` citation (back-button steps to the previous
  match, not the previous turn — per ADR §6 / D-P2-7). Pure prose
  reconciliation; no functional change.
- **Low / lastSurvivor doc drift (Review B) — `architecture-decisions.md`
  §3 + `work-packages.md` WP-A picker bullet reconciled post-D-P2-21.**
  D-P2-21 dropped the opaque `outcome.lastSurvivor` column from
  `MatchPicker.tsx` in round-1, but `architecture-decisions.md:227-230`
  and `work-packages.md:97-107` still described the picker as
  surfacing it. Round-4 inserts a `D-P2-21 supersedes` block-quote
  AFTER the original prose in both files (original prose preserved
  verbatim — Review B's request was reconciliation, not deletion). The
  closure record's existing §1.1 / §3.1 narrative already reflects
  the column drop; ADR + WP now match.
- **Low / `ReplayErrorBoundary` `<details>` parity (Reviews A + B) —
  `apps/replay/src/main.tsx` sync error boundary now mirrors
  `Replay.tsx:234-237`.** Round-3 introduced the
  `<details><summary>raw error</summary><code>{message}</code></details>`
  pattern in the async friendly-hint frame at `Replay.tsx:219-238`,
  but the sync `ReplayErrorBoundary` class component in
  `apps/replay/src/main.tsx` was still rendering the raw error inline
  as `<p style={mutedStyle}>error: <code>{message}</code></p>`. Round-4
  swaps the sync boundary's body to the same `<details>` pattern,
  adds `errorSummaryStyle` + `errorCodeStyle` consts mirroring
  `Replay.tsx:450-468` verbatim, and removes the now-unused
  `mutedStyle` constant. The two failure modes (sync render-time
  throws + async Convex `ArgumentValidationError` rejections, the
  D-P2-28 dual-layer pair) now share visual language. Cosmetic;
  D-P2-28's dual-layer architecture is preserved.
- **Cosmetic deferrals (3) — appended to §5.4 (D-P2-38).** Three new
  §5.4 bullets capture round-4's intentionally-deferred cosmetics: (a)
  `Replay.tsx:47, :217, :418` retain `UAT ISSUE-002` / `UAT ISSUE-003`
  references (exempt because those numbers uniquely identify the
  originating UAT report — the ISSUE-001 collision case is what
  motivated the round-3 AC-anchor relabelling at `:370-372` /
  `:491-498`); (b) the §5.4 kill-attribution citation `:524-548` was
  tightened in-place to `:539-547` per Review A Low-4 (the
  contract-decision comment block actually starts at `:539` and the
  assertions are at `:544-547`); (c) `convex/replay.ts`
  `getReplayBundle` accepts any valid match id — picker filters
  completed-only so a user pasting a VALID-but-not-completed match id
  directly into the URL would get a partial bundle (defense-in-depth
  is a future-phase polish, not a UX gap, since the documented entry
  point is the picker).

Round-4 phase-2 sub-package test count unchanged at 125 (pure doc +
tiny renderer parity; no new logic to test). Root `npm test`
unchanged at 457 passing (4 LIVE_AZURE skips unchanged) per the
parallel renderer engineer's gate report. `apps/replay` Vite build
unchanged at 80.01 KB gzipped per the same report (the
`<details>`/`<summary>` swap + two style consts + dead-`mutedStyle`
removal nets to ~0 KB after gzip).

**Round-5 doc-only cleanup (3 patches + 4 §5.4 deferred + 3 ADR rows) — sealed in single round-5 commit:**

The fourth COMPLETION REVIEW group (running against HEAD `96b3679`,
dispatched per D-P2-37 / D-P2-40) returned 3 Pass + 1 Concern-no-Highs
+ UAT Pass-1-Low. Reviewer consensus: NO round-5 implementation cycle
warranted (zero Highs surfaced). Reviewer B's Concern was conditioned
on `patch-OR-§5.4` treatment of 4 Lows; round-5 discharges that
condition as a doc-only cleanup. Round-5 is intentionally a SINGLE
commit (not the round-3/4 two-commit shape) — closure record continues
to cite `dc4101b` as the implement-substantive sealing SHA per
round-3/4 precedent, see `D-P2-41a` `§5.4` deferral rationale below.

Items surfaced by the fourth COMPLETION REVIEW group + the doc-strand
discharge enumeration:

- **Review A Low #1 — closure-record HEAD-at-sealing literalism** →
  §5.4 deferred entry `D-P2-41a`. The closure record at HEAD-of-this-
  commit cites `dc4101b` as the sealing SHA. Bumping the cite to the
  round-5 commit's own SHA every doc-finalisation round introduces a
  recursive doc-update loop. Round-3/4 precedent (`5ebe737` and
  `dc4101b` are the cited SHAs in their respective sealing windows,
  not their two-commit follow-up substitutes) holds.
- **Review A Low #2 — 6-vs-8 follow-up commit count framing
  inconsistency** → §5.4 deferred entry `D-P2-41b`. The status banner
  refers to "six follow-up commits" (now updated to seven) but other
  prose snippets in §3.4 / §5.0 still use round-numbered framing
  ("round-3 …", "round-4 …") rather than absolute commit counts.
  Standardising the framing is post-§9 cleanup, not round-5 scope.
- **Review A Low #3 — round-3 wording understates architectural
  shift** → §5.4 deferred entry `D-P2-41c`. The round-3 narrative in
  §5.0 describes the feed-row clipping fix in CSS-mechanism terms;
  the architectural decision (move `overflow-y` from inner row stack
  to `<aside>`) is faithfully captured in the existing D-P2-31 ADR
  row, so the §5.0 prose is supplementary rather than load-bearing.
  Refactoring the §5.0 round-3 paragraph is post-§9 cleanup.
- **Review B Low #1 — closure refs `dc4101b` vs `96b3679`** → paired
  with Review A Low #1, §5.4 deferred entry `D-P2-41a`. Same
  literalism-loop rationale.
- **Review B Low #2 — WP-A acceptance bullet still lists
  `outcome.lastSurvivor`** → PATCHED in round-5
  (`work-packages.md:132` region). Added the same
  `D-P2-21 supersedes` block-quote pattern that round-4 applied to
  `work-packages.md:109` (WP-A scope section) and
  `architecture-decisions.md:233` (§3 picker-row enumeration);
  original prose preserved verbatim above the new block-quote per
  round-4 reconciliation precedent.
- **Review B Low #3 — kill-attribution test name reads as a
  contradiction** → ANNOTATED in round-5 via a single-line comment
  block above the `it(...)` at
  `apps/replay/src/lib/__tests__/decisionEnglish.test.ts:493`. The
  comment notes the v0 contract per D-P2-25 (engine emits `dmg N` per
  attacker, no last-blow attribution surfaced; duplicate kill claims
  by simultaneous attackers are accepted). Test name + assertions
  preserved for git-blame continuity per the v0 contract locked in
  `phase-2-closure.md` §5.4 D-P2-25 entry.
- **Review B Low #4 — ReplayErrorBoundary comments target wrong
  layer** → PATCHED in round-5 (`apps/replay/src/main.tsx:8-17,
  :29-44`). The pre-existing comments described the boundary as
  catching the "synchronous throw on schema-validator failure" from
  Convex's argument validator — that is actually the ASYNC path,
  caught by the `.catch()` frame at `routes/Replay.tsx:211`. The sync
  class boundary catches RENDER-time throws (e.g. malformed bundle
  crashing `reconstruct`). Round-5 retargets the comments to clarify
  the sync vs async layers and cross-reference D-P2-28's dual-layer
  architecture. Boundary behaviour, styles, and class shape unchanged.
- **UAT Pass-1-Low ISSUE-001 — corpse-hover not exercised in this UAT
  pass** → §5.4 deferred entry `D-P2-41d`. Test-coverage gap, NOT a
  defect. UAT walked early/mid-turn match snapshots where no
  characters had died yet. Synthesising a kill-rich fixture (or
  pinning a closing-50 match with 6+ corpses on the grid for the next
  UAT pass) is the recommended remediation. Out of round-5 scope
  (engineering-doc cleanup only); next phase or a future-UAT run can
  pick this up.
- **Document-strand uncommitted work** → COMMITTED in this round-5
  commit. The round-5 entrypoint had +9/-6 uncommitted lines staged
  in the working tree (`D-P2-39` + `D-P2-40` ADR rows + the §2 intro
  range bump from `D-P2-1..D-P2-38` → `D-P2-1..D-P2-40` and the §8
  cross-ref range bump from `D-P2-15..D-P2-38` → `D-P2-15..D-P2-40`).
  Round-5 EXTENDS that doc-strand (round-4 closure follow-up) with
  the round-5 cleanup (D-P2-41..D-P2-43 rows + range bumps to
  `..D-P2-43`) and lands the combined edit in a single commit per
  D-P2-42 single-commit shape.

Round-5 phase-2 sub-package test count unchanged at 125 (the
`decisionEnglish.test.ts:493` change is a comment annotation, not a
new test). Root `npm test` unchanged at 457 passing (4 LIVE_AZURE
skips unchanged). `apps/replay` Vite build unchanged at 80.01 KB
gzipped — both `.tsx` round-5 edits (`main.tsx` ReplayErrorBoundary
comment retarget + `decisionEnglish.test.ts` test-header annotation)
are inside comment blocks; comments do not survive Vite's production
build minification, so the bundle is byte-identical to round-4.

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
  `apps/replay/src/lib/__tests__/decisionEnglish.test.ts:493-548`,
  `convex/engine/resolution.ts:374-586`; review-B Med-2 / review-A
  nit #5; D-P2-25). The renderer appends `" — killed <displayName>"`
  to *any* attacker whose attack outcome lands on a target appearing
  in `resolution.deaths[]` on the same turn. When two or more agents
  hit the same dying target simultaneously, each agent's feed row
  claims the kill — the contract is locked by the comment block +
  assertions at `decisionEnglish.test.ts:539-547` ("Contract decision
  (locked here): the kill suffix appears for any attacker whose
  attack outcome lands on the dying target on the same turn. Both
  attackers get it"). The two ally + target attack-record fixtures at
  `:505-518` are the input to that contract; the assertions at
  `:544-547` only pin the target's display name and pointedly do not
  pin "killed" presence/absence. Disambiguating would require either
  re-deriving last-blow attribution from a substrate diff (forbidden
  by D-P2-9 — engine emits `dmg N` traces + a flat `deaths[]` list,
  never a last-blow field) or falling back to conservative wording
  like "target died this turn" that would degrade the common
  single-attacker case where the current copy reads cleanly. Defer to
  consumer-renderer wishlist; the user can read `resolution.deaths[]`
  via the LLM trace / parsed-decision JSON for the full picture in
  v0.
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
- **Comment-label scheme inconsistency — `Replay.tsx` retains
  `UAT ISSUE-002` / `UAT ISSUE-003` references without AC anchors**
  (`apps/replay/src/routes/Replay.tsx:47, :217, :418`; Review A /
  Review B round-4; D-P2-38(a)). Round-3 relabelled the two
  `mainStyle.height: '100vh'` / `gridSquareStyle` comments at
  `Replay.tsx:370-372` and `:491-498` to AC-anchor form ("AC#4 +
  closure-readiness round-1 Med-1") because the original
  `UAT ISSUE-001` reference was the round-1 fit-to-viewport finding
  AND the round-2 pluralisation finding under different schemes — the
  number alone was ambiguous. The remaining `UAT ISSUE-002` (URL ↔
  `currentTurn` sync at `:47`) and `UAT ISSUE-003` (friendly error
  frame at `:217` and `:418`) references are EXEMPT from the same
  relabelling: those numbers uniquely identify their originating UAT
  report rows and are not collision cases. Retaining the cite
  preserves traceability into the UAT report without re-introducing
  the round-3 ambiguity. Deferred as a cosmetic comment-style
  inconsistency, not a correctness gap.
- **Citation polish — see kill-attribution entry above; range
  tightened from `:524-548` to `:539-547` in round-4** (Review A
  Low-4; D-P2-38(b)). The contract-decision comment block at
  `decisionEnglish.test.ts` actually starts at `:539` (the multi-line
  "Contract decision (locked here): …" block) and the assertions are
  at `:544-547` (`expect(out.oneLine).toContain("Player_5")` +
  `expect(out).toBeDefined()`); the prior `:524-548` range
  over-covered into the upstream "v0 rule: append the kill iff THIS
  actor was the LAST attacker on the defender …" exploratory comment
  block at `:524-538`, which is preamble, not the locked contract.
  Tightened in-place inside the kill-attribution entry above; this
  marker preserves the deferral's audit trail.
- **`getReplayBundle` non-completed-match defense-in-depth gap**
  (`convex/replay.ts` `getReplayBundle` at `:72-92`; Review B Low
  round-4; D-P2-38(c)). `replay.listMatches` filters
  `status === "completed"` server-side via
  `withIndex("by_status", q => q.eq("status", "completed"))`
  (`convex/replay.ts:43-52`), so the picker UI never surfaces an
  in-progress or failed match to click. `replay.getReplayBundle`,
  however, accepts any valid `Id<"matches">` and returns the bundle
  unconditionally for whatever status the row carries — a user typing
  a bogus matchId for an in-progress match into the URL gets the
  D-P2-28 dual-layer friendly-error frame (`v.id("matches")` validator
  rejects unrecognised id strings), but a user pasting a VALID
  matchId for an in-progress / failed match would get a partial
  bundle (turns / characters / worldState all present but `match.turn`
  mid-run, `match.outcome` absent). v0-acceptable because the
  picker is the only documented entry point and is completed-only;
  defense-in-depth (return `null` when `match.status !== "completed"`)
  is a future-phase polish — attack-surface nit, not a UX gap.
  Deferred to a downstream phase that revisits the read contract.
- **Closure-record SHA-at-sealing literalism** (`phase-2-closure.md`
  front-matter / status banner; Review A Low #1 + Review B Low #1
  round-4; D-P2-41a). The closure record cites `dc4101b` as the
  HEAD-at-sealing SHA — that is the round-4 implement-substantive
  commit, mirroring the round-3 sealing-SHA convention where the
  cited HEAD was `5ebe737` (the implement-substantive commit) rather
  than `d27bd79` (the SHA-substitute follow-up). Reviewers raised
  that subsequent round-N commits (`96b3679` for round-4, the round-5
  commit for round-5) are not back-substituted into the record. The
  decision is to NOT chase the SHA on every doc-finalisation commit:
  bumping the cite triggers a recursive doc-update loop where the
  bump itself is a new commit that supersedes its own reference.
  Round-3/4 precedent (sealing-SHA = implement-substantive SHA, not
  the SHA-substitute follow-up) is preserved by round-5 leaving
  `dc4101b` in place. Defer; no remediation required — convention
  documented here for downstream auditability. Consumer-renderer
  phase pointer: this is a documentation hygiene convention, not a
  consumer-renderer concern.
- **6-vs-8 follow-up commit count framing inconsistency**
  (`phase-2-closure.md` status banner + §3.4 + §5.0; Review A Low #2
  round-4; D-P2-41b). The status banner counts follow-up commits
  ("six" → "seven" through round-5) while §3.4 / §5.0 prose uses
  round-numbered framing ("round-3 commit `5ebe737`", "round-4
  commit `dc4101b`", etc.). Both framings are accurate and
  cross-checkable, but they are not standardised — a reader counting
  by absolute commit-count will reach a different number than a
  reader counting by round-named commits because the round-3 + round-4
  two-commit shape pairs (e.g. `5ebe737` + `d27bd79`) is implicitly
  collapsed in the round-named framing. Standardising on absolute
  commit-count framing throughout §3.4 / §5.0 is post-§9 cleanup, not
  round-5 scope (changing prose references during a closure-readiness
  doc-only round risks introducing fresh drift). Defer to a
  post-§9-vibe-judgement consolidation pass. Consumer-renderer phase
  pointer: not applicable — this is closure-record hygiene only.
- **Round-3 §5.0 wording understates architectural shift**
  (`phase-2-closure.md` §5.0 "Round-3 must-fix + Lows" Med-1 / AC#7
  bullet; Review A Low #3 round-4; D-P2-41c). The round-3 narrative
  describes the feed-row clipping fix in CSS-mechanism terms (move
  `overflow-y: auto` from inner row stack to `<aside>`, sticky
  header, `overscroll-behavior: contain`). The architectural
  decision — that the feed panel owns its scrollport rather than
  delegating it to an inner DIV — is captured in the existing ADR
  adherence row D-P2-31 with engineering-language phrasing
  ("affordance moved from inner feed-list `<div>` onto the `<aside>`
  itself"). Both are accurate; the §5.0 prose is supplementary, not
  load-bearing — D-P2-31 is the authoritative architectural record.
  Refactoring the §5.0 round-3 paragraph for clearer architectural
  framing is post-§9 cleanup. Defer. Consumer-renderer phase
  pointer: not applicable — closure-record hygiene only.
- **UAT ISSUE-001 corpse-hover not exercised in fourth-group UAT
  pass** (UAT report against HEAD `96b3679`; Review B / UAT Pass-1-Low
  round-4; D-P2-41d). The fourth-group UAT walked early/mid-turn
  snapshots where no characters had died yet, so the corpse-hover
  affordance (`HoverCard.tsx` corpse branch — character + persona +
  death turn + remaining loot from `worldState.corpses[]`) was not
  visually verified. This is a TEST-COVERAGE GAP, not a defect — the
  corpse-hover code path is exercised by the existing reconstruct +
  HoverCard unit tests, and the implementation is byte-identical to
  the round-1..4 sealed state. The natural remediation is a synthetic
  kill-rich fixture (or pinning a closing-50 match with 6+ corpses on
  the grid) for the next UAT pass — out of round-5 doc-only scope.
  Defer; next-phase / future-UAT-run can pick this up. Consumer-
  renderer phase pointer: a synthetic kill-rich fixture would be the
  natural way for a downstream renderer to integration-test corpse-
  rendering at viewport scale.

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
  The slider hydrates from this; updates rewrite the URL via
  `history.replaceState` (`TurnStepper.tsx:42-57`) so deep links can
  be copied without polluting the back-button stack — the browser
  back button steps to the previous match (or the picker), not to the
  previous turn within the match (per ADR §6 / D-P2-7).

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
  D-P2-1..D-P2-14. D-P2-15..D-P2-43 are conversation Decision Record
  entries — orchestration / dispatch / closure-readiness level
  (round-1 + round-2 + round-3 + round-4 + round-5 doc-only cleanup +
  assignment-complete handoff), not architecture; the §2 ADR adherence
  table above is the authoritative evidence index for those.
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
