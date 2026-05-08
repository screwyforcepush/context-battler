# Phase 02 — Personal Replay Overseer (v0)

> Goal: a local-only browser app the user runs against their Convex dev deployment to step turn-by-turn through any completed match, with the per-turn tool-call + scratchpad surface as the explainability centerpiece. The visual analogue of `harness/analyze-match.ts`.

Phase status: dispatched **2026-05-08**. Phase 1 closure record:
`docs/project/phases/01-engine-and-harness/PHASE-1-CLOSURE.md`. Phase 2's
why-layer is anchored in `mental-model.md` §11 (added 2026-05-08).

---

## 1. Why this phase

Phase 1 closed with persona-differentiated stats on a 50-run report
(extraction 96%, kill 96%, persona spread 28 pp). Stats prove the substrate
*works*. They do not show the user **what the substrate is producing** in a
way they can form intuition from.

The user — the project's Outcome Steward — needs to *look an actual run in
the eye*: watch the grid, read the scratchpads, hover on the prompt they
wrote, and decide whether prompt-authored minds are *meaningfully playing
the game*. This intuition is load-bearing for every downstream phase
(persona tuning, cursed-item flavour text, evac geometry, the eventual
consumer-facing third-person POV experience). Without this surface, the
user is steering blind on "is this fun? are these minds messy?".

This is **diagnostic-grade**, not consumer-facing. One user. No auth. No
deploy. The eventual third-person POV with division/textures/fog-of-war/
multi-spectate is a separate, later phase. v0 is the overseer the user
needs *before* committing to a consumer renderer.

## 2. What "done" means (closing condition)

The user runs a single local command, opens a browser, picks a match from
the closing-50 set (or any other completed match in their Convex dev
deployment), steps through it turn by turn, hovers and expands the agents,
and forms a confident vibe-judgement about whether the substrate is
producing watchable, attributable, prompt-driven behaviour.

The success criterion is **vibe, not metrics.** No quantitative bar. The
phase is done when that flow works end-to-end on the user's machine and
the user has used it on at least three matches.

Engineering hygiene gates (mirrored from phase 1): `npm run lint`,
`npm run typecheck`, `npm run build`, `npm test` — all green, no warnings.
Position-reconstruction unit tests must pass; everything else is plumbing.

## 3. Scope (what's in)

**Cucumber surface — the business need (north star):**

```gherkin
Feature: Personal replay overseer for completed matches

  Scenario: User picks a recent match to replay
    Given the user opens the replay app in their local browser
    When they navigate to the match list
    Then they see a paginated list of matches in reverse-chronological order
    And each row surfaces enough context to choose
    When they click a match row
    Then they navigate to the replay view for that match

  Scenario: User steps through a match turn by turn
    Given the user is viewing the replay for a completed match
    When the replay loads
    Then a bird's-eye grid view of the 100×100 map fits the viewport
    And turn 0 is shown by default with all 8 agents at their spawns
    And walls, cover, chests (open/closed), corpses, evac, agents render
    When they click "next turn" (or use the slider)
    Then the grid updates to turn N+1 entity positions, deaths, opened chests
    And the turn feed updates to turn N+1's per-agent decisions and scratchpads

  Scenario: User inspects an agent's mind on a given turn
    Given the user is viewing turn N of a replay
    When they expand an agent's row in the side-panel feed
    Then they see persona prompt, scratchpadBefore/After, parsed decision in
         human English, and the visibleStateDigest the agent received
    When they hover an agent token on the grid
    Then they see a compact card with persona, hp, equipped, decision summary
    When they hover a chest or corpse token
    Then they see open/closed state + contents (chest) or remaining loot (corpse)
```

**Concrete in-scope deliverables:**

- A new top-level app at **`apps/replay/`** (Vite + React + TypeScript +
  Convex client). Self-contained. Runs via `npm --prefix apps/replay run dev`.
  Pragmatic stack pick locked in `architecture-decisions.md` §1.
- A new Convex query module **`convex/replay.ts`** (renderer-only — does
  not pollute `convex/turns.ts` or any engine slice). Two queries:
  - `replay.listMatches({ paginationOpts })` — paginated reverse-chrono list.
  - `replay.getReplayBundle({ matchId })` — single batch fetch returning
    `{ match, turns[], worldState, characters[] }` for the given match.
- **Match-picker page** — paginated reverse-chronological table.
- **Replay route** — bird's-eye fit-to-viewport grid + side-panel turn feed
  + turn stepper (forward + slider).
- **Position-reconstruction walk** — pure TS module that, given the
  replay bundle, produces entity positions / corpses / chest-open-state /
  hidden-state at any turn N. Unit-tested (Vitest).
- **Decision-as-English renderer** — pure TS function that converts a
  `ParsedDecision` + that turn's `resolution.actions` into a one-line
  summary plus a click-to-expand fuller view.
- **Hover details** for agent / chest / corpse tokens.
- **Click-to-expand verbose surfaces:** full persona prompt
  (`agentRecord.input.personaPromptText` per ADR §7 — historical replays
  stay valid after persona edits), full `scratchpadBefore` / `scratchpadAfter`,
  full `visibleStateDigest`, raw `decision` JSON, `rawArguments` from the
  LLM trace.

## 4. Hard out of scope

These are explicit non-goals; do not build them, do not stub them:

- **No third-person POV / consumer renderer.** Vision masks, fog-of-war,
  textures, sprite art, on-grid speech bubbles, animation between turns,
  multi-watcher, mobile/responsive layout — all explicitly deferred.
  Per north-star: the consumer renderer is a *re-cook from scratch*, not
  an extension of this v0. Decisions for v0 must NOT factor in those
  requirements. (See `mental-model.md` §11.)
- **No live / in-progress replay.** Reactive subscriptions to a
  still-running match are deferred to whichever phase ships the consumer
  renderer. Batch-fetch over completed matches only.
- **No auth / accounts / public deploy.** Local-only. `localhost:5173`.
- **No pan / zoom of the grid.** Fit-to-viewport only. The map is small
  enough at 100×100 for a single-screen render.
- **No backward-step UI button.** Backward stepping is in-scope ONLY
  because it falls out free from the position-reconstruction walk (the
  walk is a re-walk from turn 0, so any-turn jump is the same operation).
  The slider gives arbitrary jump; that's the affordance.
- **No engine, schema, persona prompt, or harness CLI changes.** Phase 1
  deliverables are frozen substrate.
- **No write paths.** The renderer is read-only against Convex.
- **No procedural map generation.** Phase 1's `maps/reference.json` is the
  only map; it stays static.
- **No metrics dashboard.** That is what the closing report covers
  (`reports.byId`); this slice is for what metrics can't capture.
- **No prompt-injection cursed-item authoring tooling.** A separate phase.

## 5. Architecture at a glance

The renderer slice subscribes to State only — never calls the engine. Per
`architecture.md` §1 / pillar 7. The renderer reads `matches`, `turns`,
`worldState`, `characters` and reconstructs entity positions by walking
`resolution.moves[]` from turn 0. The engine doesn't push events to the
renderer.

| Slice | Tech | Locked by |
|---|---|---|
| LLM | (untouched — phase 1) | `architecture.md` §2 |
| State | Convex (untouched schema) | `architecture.md` §4 |
| Engine | (untouched — phase 1) | phase 1 closure |
| Renderer | **Vite + React + TypeScript + SVG, Convex client** | This phase (`architecture-decisions.md` §1) |
| App location | **`apps/replay/`** (new top-level) | `architecture-decisions.md` §2 |
| Convex query module | **`convex/replay.ts`** (new) — does NOT modify engine slice | `architecture-decisions.md` §3 |

Decisions this phase makes (in `architecture-decisions.md`): tech stack;
app directory layout; the two new query shapes (`listMatches`,
`getReplayBundle`); the position-reconstruction walk's contract; the
decision-as-English rendering contract; the agent-row expand-collapse model.

## 6. Dependency map (parallelisation)

```
                     WP-A  Renderer skeleton + match picker          (foundation)
                       │   - apps/replay/ Vite scaffold
                       │   - convex/replay.ts: listMatches
                       │   - match-picker page works end-to-end
                       ▼
                     WP-B  Replay batch fetch + grid + reconstruction
                       │   - convex/replay.ts: getReplayBundle
                       │   - position-reconstruction module (unit-tested)
                       │   - turn-0 grid renders for any matchId
                       ▼ Gate: turn-0 view of any closing-50 match
                  ┌────┴────┐
   Stage 2:       │         │   WP-C, WP-D parallel (disjoint write sets;
                  ▼         ▼   feed component vs hover/expand component)
              ┌─ WP-C  Stepper + side-panel feed (decisions in English) ─┐
              └─ WP-D  Hover details + click-to-expand verbose surfaces ─┘
                            │
                            ▼ Gate: end-to-end Cucumber surface satisfied
```

WP-A is hard-sequenced first — it owns the new top-level directory and
the Convex query module's first export. Nothing in WP-B/-C/-D starts until
WP-A's app shell + match-picker page lands. WP-C and WP-D can be picked up
by separate engineering agents in parallel after WP-B because they touch
disjoint components (the side-panel feed for C, the hover-card + expand
modals for D).

## 7. Files in this folder

- `README.md` — this file. Phase goal, scope, gates, dependency map.
- `architecture-decisions.md` — concrete decisions this phase makes
  (tech stack, app location, query module, reconstruction module).
- `work-packages.md` — per-WP scope, acceptance, test strategy, risks.
- `de-risking.md` — single load-bearing unknown
  (position-reconstruction correctness) and the unit tests that retire it.

## 8. Engineering hygiene non-negotiables

- **Tests-first** for the position-reconstruction walk and the
  decision-as-English renderer (per `.agents/AGENTS.md` AOP). Both are
  pure TypeScript and unit-test trivially. Everything else is plumbing
  and gets exercised by manual UAT in the browser.
- **No engine/schema/harness changes.** If a UAT moment surfaces a bug in
  phase-1 substrate, file it as a phase-1 follow-up; do not fix it inside
  this phase's work.
- **Renderer reads State only.** No imports from `convex/engine/*`,
  `convex/llm/*`, or `convex/runMatch.ts` into `apps/replay/`. Renderer
  may import shared *type-only* validators from `convex/schema.ts` (or a
  re-export) for the bundle shape; no runtime engine code crosses the
  slice boundary.
- **No `git stash`.** Working tree is shared. If isolation is needed, use
  `git worktree`.
- **Background processes** (Vite dev server, `npx convex dev` watcher)
  must be `nohup`'d if they need to survive past an agent's final response.
- **The CLI counterpart (`harness/analyze-match.ts`) keeps existing
  ergonomics.** This v0 supplements, does not replace, the JSONL-friendly
  CLI tool — per memory `feedback_observability_targets_agents` (CLI is
  for agent introspection; renderer is for human intuition).

## 9. Open questions and locked answers

### 9.1 Tech stack — LOCKED

**Vite + React + TypeScript + Convex client + inline SVG for the grid.**
Rationale and alternatives in `architecture-decisions.md` §1. The user
said "pragmatic, browser-local"; this is the boring, fast-to-stand-up
pick that maximises Convex's first-class binding (`convex/react`).

### 9.2 App directory location — LOCKED

**`apps/replay/`.** New top-level. See `architecture-decisions.md` §2 for
why a new top-level vs nesting under `harness/` or `web/`. The `apps/`
parent signals "more than one app may live here" (e.g. the eventual
consumer renderer) without committing to it now.

### 9.3 Convex query module — LOCKED

**New module `convex/replay.ts`** with two queries
(`listMatches`, `getReplayBundle`). Does NOT extend `convex/turns.ts`
or `convex/matches.ts`. See `architecture-decisions.md` §3. Keeps the
renderer's contract surface auditable in one file and the engine slice
clean.

### 9.4 Reactive subscribe vs batch fetch — LOCKED

**Batch fetch.** `getReplayBundle` is called once on route mount via the
Convex client `client.query()`. The match-picker page may use
`useQuery({ paginationOpts })` because pagination naturally benefits from
reactivity (newly-completed matches show up). The replay route does NOT
subscribe to `turns` — the match is *completed*, the data won't change.
North-star §3 + `mental-model.md` §11 ("Step, don't stream").

### 9.5 Initial entity positions for turn 0 — LOCKED

**Use `characters[].spawnIndex` + `maps/reference.json`'s `spawns[]`.**
The `characters` row's `pos` field is *terminal* state (where the
character ended the match), not initial. `spawnIndex` is persisted at
match-start (`matches.start` in `convex/matches.ts:184`). The renderer
imports `maps/reference.json` directly (Vite resolves JSON natively) and
combines `spawns[spawnIndex]` per character to anchor turn 0.

`worldState` chests/walls/cover/evac come from the bundle (already
expanded server-side at match start). No call into engine code is needed.

### 9.6 Decision-as-English coverage — LOCKED

The English renderer covers exactly the `ParsedDecision` discriminated
union from `convex/schema.ts:202` (consume / primary / move / action /
say / overwatch_priority / scratchpad_update). It cross-references the
turn's `resolution.actions[]` and `resolution.consumed[]` to surface
intent-vs-outcome ("said attack Player_5 → out_of_range", "drank heal →
restored 10 HP"). Concrete vocabulary lives in WP-C acceptance.

### 9.7 Backward stepping — LOCKED IN

Free outcome of the reconstruction model. The walk re-derives state from
turn 0 to N for any N, so jumping backward is the same operation as
jumping forward. Slider supports both. No "back" button required as a
separate affordance.

### 9.8 Persona-prompt source for expand panel — LOCKED

**`agentRecord.input.personaPromptText` (per-row capture, ADR §7).**
NOT `personas/*.md` (those are mutable; loading them at render time
would invalidate historical replays after persona edits — see
`PHASE-1-CLOSURE.md` §3, "post-WP15 persona edits do not invalidate
historical traces"). This is also why the LLM trace's full-text capture
exists — the renderer is its read consumer.

## 10. Recommended job sequence

1. **WP-A first, single job.** Bootstrap (`apps/replay/` Vite scaffold,
   Convex client wiring, `convex/replay.ts:listMatches`, match-picker
   page, dev-server `npm` script wired into root). Nothing else starts
   until WP-A's `localhost:5173` shows the match list against the user's
   dev deployment.

2. **WP-B second, single job.** `getReplayBundle` query, position-
   reconstruction module + Vitest tests, grid SVG renderer, turn-0 view
   on the replay route. Gate: user can click any match row in the picker
   and see turn 0 of that match render correctly.

3. **WP-C and WP-D in parallel** (2 engineering jobs). Disjoint write
   sets:
   - WP-C touches: turn stepper UI, side-panel feed component,
     decision-as-English module + Vitest tests.
   - WP-D touches: hover-card overlay components, click-to-expand modal
     components, formatters for `visibleStateDigest` /
     `personaPromptText` / `scratchpadBefore` / `scratchpadAfter` /
     `rawArguments`.

4. **Code review pass** at the end of WP-D — independent reviewer agent
   walks through three matches end-to-end and confirms the Cucumber
   scenarios in §3 hold.

5. **UAT pass** by the user. The Cucumber surface in §3 is the script;
   "vibe judgement" is the success criterion. The phase is closed when
   the user signals they have used the overseer on three+ matches and
   has formed an opinion (positive or negative) about substrate vibe.

Reviews go *before* the phase closes, not after — the renderer's whole
job is producing intuition the user can trust.
