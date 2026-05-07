# Phase 01 — Engine + Evaluation Harness

> Goal: prove the substrate. End state is a 50-run simulation report persisted to Convex that meets the quantitative done-bar in `docs/project/spec/mental-model.md` §10, plus per-(run, agent, turn) traces queryable for agent introspection.

---

## 1. Why this phase

context-battler's core value is autonomous prompt-creatures behaving in legible, attributable ways inside a turn-based arena. Every downstream feature (rendering, player input, prompt-injection items, leaderboards, progression) sits on top of one assumption: **brief behavioural prompts, fed to a stateless per-turn LLM call, produce differentiated, attributable behaviour on a real engine end-to-end.**

Phase 1 is the existence proof of that assumption. Without it, everything else is premature. With it, the rest of the project becomes a layered build.

The user has explicitly delegated phase-1 introspection to the building/reviewing agents (see memory `feedback_observability_targets_agents`). They are not the observer here. Outputs are designed for machine ergonomics — Convex queries, structured JSON traces — not human dashboards.

## 2. What "done" means (closing condition)

The 50-run closing report runs end-to-end, persists to Convex, and meets every metric in `mental-model.md` §10:

| Metric | Threshold |
|---|---|
| Runs ending with ≥1 extraction | ≥ 30 % (≥ 15 of 50) |
| Runs containing ≥1 kill | ≥ 80 % |
| Runs containing ≥1 chest equip | ≥ 80 % |
| Runs containing ≥1 speech event | ≥ 50 % |
| Persona extraction-rate spread (max − min) | ≥ 15 pp |
| Crashes / invalid states across 50 runs | 0 |

Plus engineering hygiene gates: lint, typecheck, build, test all green.

Plus the introspection contract: an agent can query Convex and pull, for any (run, agent, turn) tuple, exactly what that agent saw, what it decided, the scratchpad before, and the scratchpad after.

## 3. Scope (what's in)

- Convex schema for `matches`, `characters`, `turns` (the ledger), `worldState`, `runs` (per-match summary), `reports` (multi-run aggregate).
- Engine: turn loop with simultaneous resolution per `concept-spec.md` §23; vision and hiding §7; turn economy §9; movement and dynamic entity-targeted movement §10; overwatch §11; deterministic combat §12; gear/loot §13–14; evac §15; speech §16; agent-input §8; decision contract §21; affordances §22; collisions §24.
- LLM integration: Azure Responses API tool-use loop (`tool_choice: "required"`, `parallel_tool_calls: false`, `reasoning.effort: "low"` to start). Stateless per-turn; `previous_response_id` only within a turn for tool-result roundtrip.
- 8 personas, brief behavioural prompts, sufficiently differentiated to register on the report. Roster is illustrative — the §19 starter cards are a starting point, not a contract.
- One hand-crafted reference 100×100 map, same every run.
- Harness CLI with `--runs N` and `--concurrency C`. Three-stage cadence: 1 sequential → 10 parallel → 50 parallel.
- Multi-run aggregated report persisted to Convex.

## 4. Hard out of scope

These are explicit non-goals; do not build them, do not stub them:

- Any rendering layer or replay UI.
- Any player input, prompt editor, or guest-mode flow.
- Public or player-facing leaderboard. **No replay sharing or result cards.**
- Prompt-injection item naming (cursed names — phase 2).
- Progression / RPG / saved cards.
- Procedural map generation.
- Cross-run learning, mid-run prompt editing, post-run AI coaching.
- Daily-seed mode.
- HTML viewers, charts, dashboards. (Memory `feedback_observability_targets_agents`.)
- Determinism / replay-equivalence guarantees beyond what the natural design gives.
- Prompt caching beyond what the Responses API does for free.
- **No formal trade.** No engine-enforced item swap protocol.
- **No engine-enforced diplomacy / trust / reputation / alliance mechanics.** Speech is the substrate; trust and betrayal are emergent properties of player prompts (per `concept-spec.md` §16). Do not add trust scores, alliance contracts, deception detection, or reputation tracking.
- **No noise / directional hearing system.** Hearing is range-only (per `concept-spec.md` §16). Footstep/shot noise is a §26 "after v0" idea.
- **No ranged weapons.** All weapons are range 2 in v0 (per `concept-spec.md` §14).
- **No down-but-not-out / revives.** Death is final (per `concept-spec.md` §25).
- **No auth / account / guest-mode flows.** Phase 1 is server-side simulation only — no user surface.

## 5. Architecture at a glance

| Slice | Tech | Locked by |
|---|---|---|
| LLM | Azure Responses API, `gpt-5.4-mini`, tool-use, `reasoning.effort: "low"` | `architecture.md` §2; `azure-llm.md` |
| State | Convex | `architecture.md` §2, §4 |
| Engine | Convex actions, TypeScript, `scheduler.runAfter` per turn | `architecture.md` §3 |
| Harness | Local TS CLI, Convex client, fan-out via N scheduled `startMatch` actions | This phase (see `architecture-decisions.md` §3) |
| Renderer | **Not in phase 1** | `architecture.md` §2 |

Decisions that this phase makes (and which therefore belong in `architecture-decisions.md`, not `architecture.md`): test runner / lint / typescript config; Convex schema concrete shape; harness CLI shape and parallel-run isolation; the per-turn Azure tool-use loop wrapper; the run-trace persistence shape.

## 6. Three-stage cadence — sequencing gates

The cadence is a sequence of gates, not a schedule. Each gate is a precondition for the next.

```
Foundation  →  Stage 1 gate  →  Stage 2 gate  →  Stage 3 gate (done-bar)
  WP1–3         WP5–10           WP11–13         WP14–16
```

(WP4 was removed in v1.2; the gap is intentional so WP5–WP16 keep their v1.1 IDs. De-risking is now 1 measurement (Measurement C — rate-limit characterisation, gates Stage 3) plus 1 bootstrap checklist (B — Convex deploy-key write path, absorbed into WP1).)

### Gate 1 — Engine smoke (1 run, sequential)

Single match completes 50 turns end-to-end without crashes or invalid states. Resolution order matches §23. Per-(run, agent, turn) trace queryable from Convex with input / decision / scratchpad-before / scratchpad-after.

**Required by:** all of WP5–WP10 done. Nothing in stage 2 or 3 starts until Gate 1 is green.

### Gate 2 — Iteration loop (10 runs, parallel)

Harness fans out 10 matches concurrently via Convex scheduler. All 10 complete with no crashes or invalid states. Per-run state is fully independent (no cross-run mutation). Aggregated stats summary covers kills, extractions, equips, speech, survival, per-persona breakdowns. Azure rate-limit behaviour is observed at concurrency 10 and `--concurrency` is tunable.

**Required by:** WP11–WP13 done. Nothing in stage 3 starts until Gate 2 is green.

### Gate 3 — Closing report (50 runs, parallel) — the done-bar

The 50-run report is generated, persists to Convex, and meets every metric in §2 above. Tuning loop (WP15) is bounded by reaching this bar — no further tuning belongs in phase 1.

## 7. Dependency map (parallelisation)

```
                     WP1  Tooling + Convex bootstrap            (must land first)
                       │  - owns convex/schema.ts stub + _generated/
                       │  - absorbs Bootstrap Checklist B (env-var + deploy-key)
                       ▼
                   ┌─ WP2  Convex schema               ─┐
   Foundation:     │                                    ├─ WP2,3 in parallel
                   └─ WP3  Reference map ───────────────┘  (disjoint write sets;
                            │                              WP3 must NOT import
                            ▼                              from convex/_generated
                   (Foundation complete)                   until WP2 deploys)
                            │
                            ▼
                   ┌─ WP5  Engine pure-functions ──┐
   Stage 1:        ├─ WP6  Decision contract tool ─┤
                   ├─ WP7  Resolution phases ──────┤  WP5,6,9 in parallel.
                   ├─ WP8  Agent input builder    ─┤  WP7 needs WP5.
                   ├─ WP9  Personas (8 prompts)   ─┤  WP8 needs WP5,WP6.
                   └─ WP10 Match action + trace ──┘  WP10 needs WP5–9.
                            │
                            ▼ Gate 1
                   ┌─ WP11 Harness CLI                  ─┐
   Stage 2:        ├─ WP12 Stats aggregation            ─┤  WP11,12 in parallel.
                   └─ WP13 Measurement C: rate limits   ─┘  WP13 needs WP10,WP11,WP12.
                            │
                            ▼ Gate 2
                   ┌─ WP14 Report mutation ────────┐
   Stage 3:        ├─ WP15 Tuning loop ────────────┤  All sequential.
                   └─ WP16 50-run closing report  ─┘
                            │
                            ▼ Gate 3 (done-bar)
```

WPs marked "in parallel" can be picked up by separate engineering agents simultaneously without cross-blocking. The dependency arrows are hard. WP1 is hard-sequenced first because it owns the bootstrap stub `convex/schema.ts` (later replaced by WP2) and `convex/_generated/` (consumed by every Convex-touching WP). v1.1's WP4 (Spike A — Azure tool-use round-trip) was retired in v1.2 because `azure-llm.md` §7 documents the contract; sanity assertions absorbed into WP6 integration tests.

## 8. Files in this folder

- `README.md` — this file. Phase goal, scope, gates, dependency map.
- `architecture-decisions.md` — concrete decisions this phase makes that the spec layer doesn't already lock.
- `work-packages.md` — per-WP scope, acceptance, test strategy, risks.
- `de-risking.md` — three load-bearing unknowns and the spikes that retire them.

## 9. Engineering hygiene non-negotiables

- **Tests-first** for engine rules, resolution order, combat, evac, vision, collisions. Per `.agents/AGENTS.md` AOP.
- **No `git stash`.** Working tree is shared. If isolation is needed, use `git worktree`.
- **Background processes** (`npx convex dev` watcher, harness runs) must be `nohup`'d if they need to survive past an agent's final response.
- **Tuning is bounded.** Stop at the done-bar in §2. Further tuning is a downstream loop, not phase 1.
- **Brevity is a design constraint.** System prompt + persona + scratchpad + visible-state digest must stay tight (`mental-model.md` §10). Every prompt edit asks "does this earn its tokens?"
- **Reasoning is on at `low`.** Never off. Tunable up only if the report shows shallow persona signal.
- **`previous_response_id` lives within a turn, never between turns.** (`azure-llm.md` §7.) The scratchpad is the only inter-turn memory.
- **`.env` is not committed.** Convex action runtime env vars go via `npx convex env set`.

## 10. Open questions and locked answers

Originally five open questions for review. v1.1 locks the four that cross-file work depends on; question 1 stays open as a possible WP15 lever.

### 10.1 Map size of the hand-crafted reference (still open as a tuning lever)
Spec is 100×100. Worth confirming hand-crafting all 10 000 tiles is tractable, or whether we hand-craft regions (walls, cover clusters, chest spawns, evac centre, agent spawns) and let floor be the default. **Locked default:** hand-author a structured map descriptor (regions + landmarks) and expand to a tile grid at load time. Captured as an ADR in `architecture-decisions.md` §5. WP15 may iterate on the descriptor during tuning.

### 10.2 Speech audibility window (LOCKED — one-turn window)
**Rule.** Speech declared on turn N is emitted and logged in turn N's resolution (phase 3). Eligible recipients (Chebyshev distance ≤ 20 to the speaker at the moment of speech) see it in the **`Heard` section of turn N+1's input only**. Turn N+2's input does NOT include turn N's speech. The deciding agent in turn N never sees same-turn speech — exposing it would violate the simultaneous-resolution invariant from `concept-spec.md` §23.

The one-turn window keeps the prompt budget tight and gives a single, deterministic answer. Persistence beyond N+1 is a deferred §26-style idea, not phase-1 scope. Anchored across: WP7 (resolution timing), WP8 (digest builder + tests), `concept-spec.md` §16, §23.

### 10.3 Scratchpad max length (LOCKED)
`concept-spec.md` §2A.2 says "short — exact length TBD." **Locked phase-1 default: 500 chars** (also enforced by the tool schema in ADR §4 — `scratchpad_update.maxLength: 500`). Tunable upward only as part of WP15 if persona signal is shallow.

### 10.4 `reasoning.effort` budget vs. wall-clock (LOCKED)
At `low`, latency per turn under stage-2 concurrency may surface as an issue before rate limits do. Measurement C (WP13) will measure. **Locked policy** (cross-ref `de-risking.md` "Reasoning policy" — top-level section in v1.2; previously inside Spike A in v1.1): `reasoning.effort: "none"` is **never** used in phase-1 gate runs, WP15 tuning, or the closing report. If `low` is too slow, the responses are: (a) lower `--concurrency`, (b) shrink the prompt (WP8 caps), (c) escalate. Reasoning-off would collapse persona attribution.

### 10.5 Per-persona seeding for 50-run report (LOCKED)
Each run includes all 8 personas (`mental-model.md` §10). The 8 personas are **fixed across all 50 runs**; persona ids are the locked literal kebab-case union from ADR §6 (no persona swapping, no roster changes mid-bar).

**Persona-to-spawn assignment:** randomised per run but **seeded by `rngSeed`** and persisted on `characters.spawnIndex` (per ADR §6, WP3 acceptance). This separates per-persona stats from per-spawn-position bias in the closing report — same `rngSeed` always produces the same persona-to-spawn permutation, different seeds produce a different permutation. Without this, a persona that always spawns near a strong chest cluster would inflate its "extraction rate" for reasons unrelated to its prompt.

## 11. Recommended job sequence

1. **WP1 first, single job.** Bootstrap (`tsconfig`, Vitest, ESLint, package scripts, Convex stub `schema.ts`, `_generated/`, env vars, Bootstrap Checklist B). Nothing else can start until this lands.
2. **WP2, WP3 in parallel** (2 engineering jobs) once WP1 is on the shared branch. Disjoint write sets; WP3 must NOT import from `convex/_generated/` until WP2 deploys (use `tsc --noEmit` against pure-function modules). v1.2 dropped WP4 from this fan — Azure tool-use sanity assertions live in WP6 integration tests, not a separate spike WP.
3. **WP5, WP6, WP9 in parallel** as soon as foundation lands. Engine pure-functions, decision contract + Azure wrapper, and persona prompts are independent.
4. **WP7, WP8 in parallel** once WP5 / WP6 land.
5. **WP10** single job, integrates WP5–WP9 into a Convex action; produces the Gate-1 artefact (engine smoke).
6. **Code review pass** at Gate 1 — independent reviewer agent checks resolution-order conformance against §23, vision against §7, combat against §12 with locked v0 stat tiers from ADR §6, evac against §15, speech timing against §10.2 (turn N → N+1 only), trace shape against ADR §7. **Recommended: review BEFORE Gate 1 is declared green**, because every bug not caught here multiplies across 50 runs.
7. **WP11, WP12 in parallel.** WP13 (rate-limit spike) immediately after WP10 / WP11 / WP12 land.
8. **Code review pass** at Gate 2 — reviewer checks parallel-run state isolation, `completed | failed` polling + fail-loud thresholds, rate-limit handling, harness CLI shape (`--reasoning` flag).
9. **WP14, WP15, WP16 sequential.** Tuning is iterative against partial reports; the closing 50-run is the last action. WP15's hard cap is 12 iterations with the escalation matrix (WP15 acceptance).
10. **UAT pass** at Gate 3 — final reviewer queries Convex for sample (run, agent, turn) traces, confirms introspection contract holds (full self-contained record per ADR §7), confirms done-bar metrics.

Reviews go *before* gates close, not after — phase 1's whole point is producing a substrate the team trusts.

---

## Changelog — v1.2

Diff vs v1.1 (bird's-eye nudge — verified guides are contracts, not unknowns):

- **§6 Three-stage cadence.** Header diagram updated: foundation is now `WP1–3`, not `WP1–4`. Added a one-line clarifier that WP4 was removed in v1.2 and de-risking is now 1 measurement (Measurement C) plus 1 bootstrap checklist (B).
- **§7 Dependency map.** WP4 removed from the foundation fan; foundation is now WP2 ∥ WP3 only after WP1 lands. WP13 relabelled "Measurement C: rate limits" (was "Spike: rate limits"). Trailing paragraph notes Spike A retirement and where the sanity assertions moved (WP6 integration tests).
- **§10.4 Reasoning policy cross-ref.** Pointer updated from `de-risking.md` Spike A "Reasoning policy" → `de-risking.md` "Reasoning policy" (top-level section in v1.2; same substance). The "calibration-only" carve-out is gone too — there is no calibration call in v1.2 because Spike A is gone.
- **§11 Job sequence.** Step 1 still WP1 alone; step 2 is now WP2 ∥ WP3 (was WP2 ∥ WP3 ∥ WP4). Trailing line in step 2 explains Azure tool-use sanity now lives in WP6 integration tests, not a separate spike WP.

## Changelog — v1.1

Diff vs v1.0, by section:

- **§4 Hard out of scope.** Added explicit non-goals: no formal trade; no engine-enforced diplomacy / trust / reputation / alliance mechanics; no noise / directional hearing system; no ranged weapons; no down-but-not-out / revives; no auth / account / guest-mode flows; no replay sharing or result cards. Each one was previously excluded by absence; now excluded by statement.
- **§7 Dependency map.** Re-sequenced foundation: WP1 lands first (owns bootstrap stub `schema.ts` and `_generated/`), then WP2 / WP3 / WP4 run in parallel with disjoint write sets and a no-codegen-import rule. WP13 dependency tightened to WP10 + WP11 + WP12 (was: WP11 only).
- **§10 Open questions.** Renamed to "Open questions and locked answers". Locked four of the five questions (speech window → one-turn N→N+1; scratchpad → 500 chars; reasoning policy → never `none`; persona-to-spawn assignment → seeded by `rngSeed`, persisted on `characters.spawnIndex`). Question 1 (map size) stays open as a WP15 lever.
- **§11 Recommended job sequence.** Step 1 is now WP1 alone; step 2 is WP2 / WP3 / WP4 in parallel after WP1. Reviewer checks in step 6 / step 8 expanded to include locked v0 stat tiers, speech timing, trace shape, `completed | failed` polling, `--reasoning` flag.
