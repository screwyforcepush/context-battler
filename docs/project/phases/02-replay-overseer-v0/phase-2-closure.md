# Phase 2 v0 — Closure Record (Personal Replay Overseer)

> Single-file handoff for downstream phase planning. Records what was
> built, what proves it, what is intentionally absent, and what is still
> pending the user's final vibe-judgement.
>
> Closure record drafted: 2026-05-08. Source commit at draft:
> `4db9757` (HEAD; phase-2 dispatch baseline `7c22284`).
>
> This is a closure RECORD, not a retrospective and not a phase-3 plan.

---

## Status banner

**Implementation: COMPLETE.** All four work packages (WP-A → WP-D) have
landed across four commits between dispatch (`7c22284`, 2026-05-08) and
HEAD (`4db9757`, 2026-05-08). Engineering hygiene gates green at root
and at the `apps/replay/` sub-package: `npm run lint`,
`npm run typecheck`, `npm run build`, `npm test` (447 passed, 4
LIVE_AZURE-gated skips — phase-1 carry-over). Substrate freeze (D-P2-9)
verified — empty diff over `convex/engine`, `convex/llm`,
`convex/runMatch.ts`, `convex/schema.ts`, `personas/*`, `harness/*`.

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
    │   ├── TurnFeed.tsx      side-panel agent rows; uses summariseDecision()
    │   ├── HoverCard.tsx     agent/chest/corpse/wall/cover/evac hover details
    │   └── ExpandModal.tsx   5-tab modal: persona / system / digest / scratchpad / LLM trace
    └── lib/
        ├── convexClient.ts   singleton ConvexReactClient(VITE_CONVEX_URL)
        ├── useHashRoute.ts   pure parser for #/, #/match/<id>?turn=N
        ├── reconstruct.ts    pure walk: bundle × atTurn → EntitySnapshot (ADR §4)
        ├── decisionEnglish.ts pure: ParsedDecision × resolution → English (ADR §5)
        ├── formatters.ts     pure: usage / latency / scratchpad-diff helpers
        ├── hoverTypes.ts     HoverTarget discriminated union (WP-C ↔ WP-D contract)
        └── __tests__/
            ├── reconstruct.test.ts   25 tests (de-risking §1.1–§1.9 retired)
            ├── decisionEnglish.test.ts 51 tests (ADR §5 vocabulary table)
            ├── formatters.test.ts    23 tests
            └── useHashRoute.test.ts  16 tests
```

Total: 115 Vitest tests inside the sub-package, all passing.

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
| `apps/replay/.../reconstruct.test.ts` | 25 | de-risking §1.1–§1.9 (every enumerated failure mode); ADR §4 walk rules |
| `apps/replay/.../decisionEnglish.test.ts` | 51 | ADR §5 vocabulary table; canonical source `convex/engine/resolution.ts:374-586` (D-P2-14) |
| `apps/replay/.../formatters.test.ts` | 23 | usage/latency/scratchpad-diff helpers (pure) |
| `apps/replay/.../useHashRoute.test.ts` | 16 | hash-route parser (pure) |
| **Phase-2 sub-total** | **115** | tests-first per AOP for the two pure modules |
| Phase-1 carry-over (`tests/**`) | 332 + 4 skipped | `LIVE_AZURE`-gated skips unchanged from phase 1 |
| **Suite total** | **447 + 4 skipped** | matches phase-1 baseline (332) + phase-2 net adds (115) |

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

Each phase-2 decision (`D-P2-1`..`D-P2-17`, sourced from
`architecture-decisions.md` and the conversation Decision Record)
ticked off with one line of agent-verifiable evidence.

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

---

## 3. Cucumber surface verification

The Cucumber Given/When/Then in `README.md` §3 (the north-star
business need) is the success contract. The table below maps each
clause to its evidence; rows whose verification requires running the
app in a browser against the user's Convex deployment are marked
**Pending agent UAT walk-through** — those rows are mechanically
correct in code (component + integration tests pass; props wire to the
named fields) but are not yet validated by an end-to-end browser
exercise against live data.

### 3.1 Scenario 1 — User picks a recent match

| Clause | Evidence |
|---|---|
| Given user opens replay app in local browser | `apps/replay/README.md` quick-start; root `dev:replay` script; Vite serves `:5173`. |
| When they navigate to match list (`#/`) | `main.tsx:16-22` routes hash `#/` (or unrecognised) to `MatchPicker`. |
| Then paginated, reverse-chronological list of matches | `convex/replay.ts:43-52` `listMatches` uses `withIndex("by_status", "completed").order("desc").paginate(opts)`; `MatchPicker.tsx` renders via `usePaginatedQuery`. |
| And each row surfaces enough context | Columns include matchId (truncated), startedAt, status, turn, `outcome.extracted.length`, `outcome.lastSurvivor` (truncated id or "—"). Pending agent UAT for visual confirmation. |
| When click a row | `MatchPicker.tsx` row href is `#/match/<id>` (hash anchor, no JS handler needed). |
| Then navigate to replay view | `main.tsx:18-19` matches `kind === "replay"` route from `useHashRoute`. |

### 3.2 Scenario 2 — User steps through a match

| Clause | Evidence |
|---|---|
| Given replay loaded for completed match | `Replay.tsx` calls `client.query(api.replay.getReplayBundle, { matchId })` once on mount (no subscription). |
| Then bird's-eye 100×100 grid fits viewport | `Grid.tsx` SVG `viewBox="0 0 100 100"`, container `width: 100%; height: auto` (fit-to-viewport, no zoom/pan). Pending agent UAT for visual confirmation across viewport sizes. |
| And turn 0 is shown by default | `Replay.tsx` initial `currentTurn = 0`; `reconstruct(bundle, 0)` synthesises spawn-position snapshot per ADR §4. |
| And walls/cover/chests/corpses/evac/agents render | `Grid.tsx` z-ordered layers per ADR §4 walk (walls → cover → chests → corpses → evac → agents). Pending agent UAT for visual count check (≈28 walls, ≈60 cover tiles, 12 closed chests, 8 spawn agents, 3×3 evac ring at (47..49, 47..49)). |
| When click "next turn" or use slider | `TurnStepper.tsx` Next button + slider; both write `?turn=N` via `useHashRoute`. |
| Then grid updates | `Replay.tsx` derives snapshot via `useMemo(() => reconstruct(bundle, currentTurn))`. |
| And turn feed updates | `TurnFeed.tsx` reads `turnRowByTurn.get(currentTurn)` (D-P2-13 keying) and renders agent rows with `summariseDecision()`. |

### 3.3 Scenario 3 — User inspects an agent's mind

| Clause | Evidence |
|---|---|
| When expand an agent's row in feed | `TurnFeed.tsx` "..." button mounts `ExpandModal` with `(agentRecord, characterById)`. |
| Then see persona prompt, scratchpadBefore/After, decision in English, visibleStateDigest | `ExpandModal.tsx` 5 tabs read `personaPromptText` (`:221`), `systemPromptText` (`:242`), `visibleStateDigest` (`:263`), `scratchpadBefore`/`scratchpadAfter` (`:283-284`), LLM trace (`:336-401`). |
| When hover an agent token | `Grid.tsx` agent `<g>` mouseenter populates `HoverCard` with `HoverTarget` discriminated-union payload. |
| Then compact card with persona, hp, equipped, decision summary | `HoverCard.tsx` agent branch shows persona + displayName + position + alive/hidden + summary; hp/equipped render literal "see expand panel" per D-P2-11 (`HoverCard.tsx:230-231`). |
| When hover a chest | `Grid.tsx` chest `<g>` populates HoverCard chest branch. |
| Then see open/closed + contents | `HoverCard.tsx` closed chest shows id+pos+"closed"; opened chest shows id+pos+"opened (turn N)" + literal "contents not persisted" per D-P2-12 (`HoverCard.tsx:296`). |
| When hover a corpse | `HoverCard.tsx` corpse branch shows deceased character + persona + death turn + remaining loot from `worldState.corpses[]`. |

### 3.4 Caveat — agent UAT browser walk-through pending

Per the phase plan (`work-packages.md` "Closing the phase" §1-§2), an
independent reviewer agent walks three matches end-to-end and produces
screenshot + DOM-assertion evidence for each Cucumber row before the
user signoff (§9). This document is the **draft** closure record; the
parallel agent UAT job's findings are not surfaced into this record at
draft time. The draft is committed so the user can read the structure
while the UAT pass completes; UAT findings will be appended (or
escalated to a *Blocking findings* section) before the user starts §9.

---

## 4. Substrate freeze verification

Per D-P2-9 the phase-1 substrate is frozen — phase 2 introduces no
diff to the engine kernels, the LLM wrapper, the per-match orchestrator,
the schema, the persona content, or the harness CLI.

```
$ git diff 7c22284..HEAD -- convex/engine convex/llm convex/runMatch.ts convex/schema.ts personas harness
(no output)
```

Verified at draft time (HEAD = `4db9757`). The only files touched in
`convex/` between dispatch and HEAD are `convex/replay.ts` (new module,
+92 lines) and the regenerated `convex/_generated/api.d.ts` (+2 lines —
the new module's typed surface).

---

## 5. Known caveats / known-issues

Each entry is tagged **v0 acceptable** (intentional gap, surfaced as
literal copy in the UI) or **deferred** (downstream phase will close
it). No high-severity findings are open against this phase at draft
time.

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
  walls** (`apps/replay/src/routes/Replay.tsx:94` TODO; review-A/C nit).
  Per-tile hover would require splitting wall geometry; deferred until
  user signals it impedes vibe-judgement.
- **HoverCard first-paint edge-clamp uses fallback dimensions before
  measuring** (`apps/replay/src/components/HoverCard.tsx:74-78`;
  review-A nit). Fallback `220 × 320` is used until the ref is
  measured; brief one-frame mis-clamp at first hover only.
- **UAT ISSUE-005 hover state-machine fragility** (UAT report).
  Test artefact — could not reproduce with normal mouse usage; logged
  for completeness pending real-world observation.

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
  D-P2-1..D-P2-14 (D-P2-15..17 are conversation Decision Record
  entries — orchestration / dispatch level, not architecture).
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
