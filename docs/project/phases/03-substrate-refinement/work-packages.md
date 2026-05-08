# Phase 03 — Work Packages

> Five work packages sequenced as Schema → Engine → (Prompt || Replay) →
> Closing-10. Each WP has scope, acceptance, test strategy, and risks.
> Tests-first per `.agents/AGENTS.md` AOP for every pure-function module
> under refactor. Engine + schema land before the prompt rewrite because
> the prompt rewrite needs the new vocabulary to teach against.

WP IDs continue the phase-2 letter convention (WP-A, WP-B, …) for visual
consistency in code review.

---

# Foundation — sequencing

WP-A lands first (schema is the contract; everything keys off it).
WP-B follows (engine fixes consume the new schema). WP-C and WP-D run
in parallel after WP-B (disjoint write sets: digest+system prompt vs.
replay UI). WP-E is the closing gate.

The "review before close" rhythm from phases 1 and 2 carries over —
reviewers run before WP-E, not after.

---

## WP-A — Schema break + reasoning capture probe (FOUNDATION-FIRST)

**Scope.**

- **Probe (WP-A.1) — first deliverable.** A small one-call test under
  `harness/probe-reasoning.ts` (or equivalent inline script) that
  sends one tool-use request to the dev Azure deployment with
  `reasoning.effort: "low"` and dumps the full `response.output[]`
  + `response.usage` shape to a file. The probe records:
  - whether reasoning items appear in `output[]` and their shape
    (e.g. `{type: "reasoning", summary: [{type: "summary_text",
    text: "..."}]}` vs nothing);
  - the count of reasoning tokens in
    `usage.output_tokens_details.reasoning_tokens`.
  Outcome is recorded in `de-risking.md` D-P3-1. The branch decision
  (Branch A vs Branch B per ADR §2) gates the rest of WP-A.
- **Schema break (WP-A.2).** Apply the ADR §1 diff to:
  - `convex/llm/decisionTool.ts` — JSON Schema + Zod schema: drop
    `interact` arm; rename `loot.targetCorpseId` to `loot.targetId`;
    drop `overwatch_priority`; add `overwatch_stance: "offensive" |
    "defensive" | null` (required when `primary === "overwatch"`,
    null otherwise — enforced via Zod refinement); conditionally add
    `rationale: string | null` (max 280 chars) iff the probe's
    Branch B applies.
  - `convex/schema.ts` — `decisionValidator`: same diff; add
    `reasoning: v.optional(v.string())` to `agentLlmValidator`; remove
    historical `interact`-shape compatibility shims (POC mode).
  - `convex/engine/types.ts` — TS aliases: `ActionDecision` becomes
    3-arm union; `ParsedDecision` adds `overwatch_stance` and
    (conditionally) `rationale`; `SAFE_DEFAULT_DECISION` updated.
  - `convex/llm/azure.ts` — `CallResult.raw.reasoning?: string`
    extraction path (Branch A: read from output[] reasoning items
    and sanitise+truncate to ≤ 4 KB; Branch B: always undefined).
    Sanitise via the existing `sanitiseHttpBody` helper if it
    generalises, otherwise add a dedicated sanitiser.
- **Convex schema push + DB wipe (WP-A.3).** After local typecheck
  passes, push the new schema with `npx convex dev` against the dev
  deployment. Existing rows in `matches`/`turns`/`characters`/
  `worldState`/`runs`/`reports` will fail validation. Wipe the dev
  data (`npx convex run --no-push <wipe-script>` or per-table
  `convex run` mutations) and document the wipe command in this WP's
  acceptance.
- **Concept-spec edits (WP-A.4).** Diff-targeted edits to
  `docs/project/spec/concept-spec.md` §11, §13, §21 per ADR §8.
- **Tests (WP-A.5).** Update:
  - `tests/llm/decisionTool.test.ts` — every literal in the new schema;
    structural-equivalence asserts continue to hold; Zod refinement
    asserts overwatch_stance/primary consistency.
  - `tests/llm/azure.test.ts` — Branch-A: extract reasoning text on
    a mocked happy-path response; Branch-B: ensure `reasoning` is
    always undefined; sanitisation cases.
  - Tests for `personas/*.md` (currently asserts ≤ 80 tokens) remain
    unchanged.

**Acceptance.**

- Probe outcome recorded in `de-risking.md` D-P3-1. Branch decision
  noted in this file's header before sub-deliverables A.2-A.5 land.
- `npm run lint && npm run typecheck && npm run build && npm test` all
  green. The structural-equivalence asserts in `decisionTool.ts` lock
  the Zod / JSON Schema / TS-alias agreement.
- `npx convex dev` deploys the new schema cleanly (after wipe). The
  `convex` schema validation does not flag any historical rows.
- One smoke `convex run` mutation creates a `matches` row with the new
  shape and reads it back successfully.
- `concept-spec.md` v0.2 shipped, with §11/§13/§21 edits matching the
  ADR §8 diff.
- A reviewer agent (independent of the implementer) has eyeballed the
  schema diff and confirmed: (a) the loot dispatch covers chest +
  corpse id namespaces explicitly; (b) overwatch_stance is required
  iff primary is "overwatch"; (c) reasoning persistence path matches
  the probe outcome.

**Test strategy.**

- Tests-first per AOP for `decisionTool.ts` and the Zod schema. The
  structural-equivalence asserts at the bottom of `decisionTool.ts`
  are the contract lock — they MUST be in the same commit as the
  schema diff.
- `azure.ts` test extends the existing mocked-fetch suite with two
  reasoning-shape fixtures: one with a `reasoning` item, one without.
  Both must succeed end-to-end (the wrapper never throws).

**Risks.**

- **Probe outcome forces Branch B late.** Mitigation: probe is the
  first deliverable; nothing downstream commits to Branch A until
  the probe answer lands. Branch B (add `rationale` to the tool
  schema) is a small, well-bounded diff if it applies.
- **Convex schema push fails on existing rows.** Expected per POC
  schema-wipe posture. Mitigation: document the wipe command in
  acceptance; reviewer confirms wipe was executed before WP-B
  smoke.
- **Sanitisation eats reasoning content.** The existing
  `sanitiseHttpBody` is tuned for HTTP error envelopes (api keys,
  bearer tokens, emails, phone numbers). Mitigation: use it on the
  reasoning text too, but sanity-check the output isn't redacting
  legitimate reasoning content (a reasoning sentence about a player
  named "555 Smith" is not a phone number; the conservative regex
  in `sanitiseHttpBody` already handles this with the separator
  requirement).
- **Schema-mirror drift between `decisionTool.ts`, `schema.ts`,
  `types.ts`.** Mitigation: structural-equivalence asserts at the
  bottom of `decisionTool.ts` (already in place) catch TS-side
  drift. The schema validator (`convex/schema.ts`) is verified by
  the typecheck of `runMatch.ts` calls (the convex codegen produces
  types from the validator).

**Effort.** 1.0–1.5 days. Sequenced first.

---

## WP-B — Engine fixes (vision walls, drained-corpse, overwatch stance, loot dispatch)

**Scope.**

- **Vision walls (WP-B.1).** `convex/engine/vision.ts:
  computeVisibleEntities` emits `{ kind: "wall", pos: {x, y} }`
  entries for every wall tile within Chebyshev 20 of the observer.
  The `tileInWall`/`tileInAnyWall` helpers already exist; iterate
  the `world.walls` rectangles and emit each contained tile within
  range. No LOS check on walls themselves (per ADR §5).
- **Drained-corpse trace (WP-B.2).** `convex/engine/resolution.ts`
  loot-resolution path replaces the `if (!pickedSlot) continue;`
  silent-skip at line ~566 with:
  ```ts
  if (!pickedSlot) {
    trace.actions.push({
      characterId: ev.actorId,
      kind: "loot",
      target: ev.corpseId,
      result: "empty",
    });
    continue;
  }
  ```
  And the `if (!corpse) continue;` short-circuit upstream replaces
  with a `result: "no_corpse"` emit (the code already has `no_corpse`
  on the action-build path, but the post-reflow path here is what
  ground-truths the aggregator).
- **Loot dispatch by id namespace (WP-B.3).** `convex/engine/
  resolution.ts` action switch: the `interact` arm is removed
  (schema break per WP-A). The `loot` arm dispatches by
  `targetId`:
  - prefix `chest_` → run the chest-open path (the existing
    `interacts.push({ actorId, chestId })` queue).
  - prefix `Player_` (or any character displayName form) → run the
    corpse-loot path (existing `loots.push({ actorId, corpseId })`).
  - otherwise → emit `result: "no_target"`.
- **Defensive overwatch counter-fire (WP-B.4).** `convex/engine/
  resolution.ts` phase-5 attack collection: when an attack lands on
  a defensive overwatcher, also enqueue a counter-attack from the
  overwatcher to the attacker, range-checked against the
  overwatcher's weapon range. Counter-attacks land in the same
  `applyDamage` batch (simultaneity preserved). Trace entries:
  `kind: "overwatch"`, `fromOverwatch: true`, `result: "dmg N"` /
  `"out_of_range"` per outcome.
- **Offensive overwatch first-in-range (WP-B.5).** Existing
  nearest-then-id logic kept; the WP-B change is renaming the
  field reference from `overwatch_priority` to `overwatch_stance`
  and gating the path on `decision.overwatch_stance === "offensive"`.
- **Delete `convex/engine/affordances.ts` + tests
  (WP-B.6).** The module has no remaining caller after the
  inputBuilder rewrite in WP-C, but we delete it in WP-B so the
  test suite stays green at the WP-B gate. WP-C's inputBuilder
  diff already drops the import.
- **Validation update (WP-B.7).** `convex/engine/validation.ts`:
  rename overwatch_priority → overwatch_stance; add the
  stance/primary consistency check; loot.targetId namespace
  validity check.
- **Tests (WP-B.8).**
  - `tests/engine/vision.test.ts` — wall emission cases.
  - `tests/engine/resolution.test.ts` — drained-corpse trace
    (3 cases: drained on first attempt, drained on repeat,
    no-corpse); loot dispatch on chest id; loot dispatch on
    corpse id; loot dispatch on bogus id; defensive overwatch
    counter-fires (single attacker, multi-attacker, out-of-range
    attacker, hidden→revealed); offensive overwatch unchanged.
  - `tests/engine/affordances.test.ts` — DELETED.
  - `tests/engine/validation.test.ts` — stance/primary consistency
    + loot.targetId.

**Acceptance.**

- `npm run lint && npm run typecheck && npm run build && npm test` all
  green at root.
- The 3 Cucumber scenarios in README §3 (walls visible, drained
  corpses, defensive counter-fire) all pass at least one test in
  `tests/engine/*`.
- One smoke `npx convex run runMatch:advanceTurn` (or the equivalent
  `harness/run.ts --runs 1`) executes a single match end-to-end against
  the dev deployment, with no crashes and no schema-validation
  failures. `convex run turns:getAgentTurn` returns a turn record
  with the new shape (overwatch_stance, no overwatch_priority).
- Reviewer (independent agent) confirms: counter-fire bounded by range
  is correctly tested; loot dispatch covers all 3 id paths; trace's
  `result: "empty"` is emitted exactly once per drained-corpse
  attempt.

**Test strategy.**

- Tests-first for `vision.ts:computeVisibleEntities` wall emission
  (synthetic walls at known positions, observer Chebyshev distances
  bracketing the 20-tile range).
- Tests-first for `resolution.ts` drained-corpse trace (build
  synthetic corpse with no remaining slot, queue a loot, assert
  `trace.actions[]` entry).
- Tests-first for defensive counter-fire — multi-attacker scenario
  with a 3-attacker fixture; assert that all 3 attackers receive
  damage entries from the overwatcher in the same `actions[]`.
- The "in-range cap" for counter-fire is verified by setting the
  overwatcher's weapon range below the attacker distance and
  asserting `result: "out_of_range"`.

**Risks.**

- **Wall emission swamps the digest's 8-cap.** Mitigation: per ADR §5,
  walls are emitted by vision but the digest's sort places them
  *after* the 8-cap (the cap applies to characters/chests/corpses
  only). vision.ts emits walls; inputBuilder.ts (WP-C) decides where
  in the bullet list they land.
- **Counter-fire ordering creates non-determinism.** Mitigation: the
  attacks-batch enumeration sorts by attackerId for determinism;
  counter-fires sort by attacker→defender pair stable order.
- **Drained corpse repeat-rate metric needs a per-agent dimension.**
  The "same-agent loot attempts on empty corpses across consecutive
  turns ≤ 1%" metric (README §5) requires the aggregator to detect
  same-agent + same-target across N+1. Mitigation: the trace already
  has `characterId`, `target`, and the turn number is implicit in
  the `turns` row. WP-E's aggregator handles this; WP-B just emits
  the right trace entries.
- **`runMatch.ts` last-turn-observation read** (WP-C scope) hits a
  `turns` row from turn N to populate turn N+1's digest. WP-B's
  smoke run does NOT include this — it just verifies engine
  correctness with the existing `inputBuilder.ts` (which still works
  in its phase-1 shape against the new schema, modulo the schema
  diff to overwatch fields). Mitigation: WP-B's smoke run uses the
  *current* inputBuilder; WP-C is the rebuild. The smoke confirms
  the engine doesn't crash on the new schema, not that the digest
  is final-shape.

**Effort.** 1.5–2.0 days. Sequenced after WP-A.

---

## WP-C — Digest rebuild + system prompt rewrite

**Scope.**

- **Digest rebuild (WP-C.1).** `convex/llm/inputBuilder.ts` rewrite per
  ADR §6:
  - Delete `buildAffordanceLines`, `buildHeardLines`,
    `buildLastKnownLines`, `buildEvacLines`.
  - Add `buildLastTurnLine(prevTurnRow, characterId)` — pure helper
    that takes the previous turn's resolution + the agent's id and
    composes the one-line summary. Returns `null` for turn 1.
  - Add `buildVisibleObservation(state, characterId, prevTurnRow)`
    — collects per-Visible-character last-turn observations
    (attacked-X, said-"...", held-axe-equipped) filtered by what THIS
    agent could see at turn N+1 start. The "last turn" qualifier is
    dropped per North Star §1 (current-state framing from the agent's
    POV).
  - Modify `renderVisibleBullet` to accept and emit the observation
    bracket, the `[opened]`/`[drained]` markers, and to handle the
    wall case.
  - Modify `buildVisibleLines` to apply the new sort order
    (characters → chests/corpses → cover/walls → Evac singleton),
    cap the first two tiers at 8, and append walls/cover/Evac
    unbounded (with the 12-wall safety ceiling).
  - The composed `buildAgentInput` continues to return
    `{ systemPrompt, visibleStateDigest }`; the system prompt is now
    longer and the digest's section ordering is new. The
    `runMatch.advanceTurn` caller passes the previous turn's row to
    `buildAgentInput` (one extra arg).
- **System prompt rewrite (WP-C.2).** `convex/llm/systemPrompt.ts`
  full rewrite per ADR §7. Targeted ≤ 500 tokens (chars/4 proxy).
- **Last-turn observation collection (WP-C.3).** `convex/runMatch.ts`
  reads the prior `turns` row (by `(matchId, turn-1)`) at the top of
  `advanceTurn` and threads it into `buildAgentInput`. Turn 1 sees a
  null prior row; the digest omits the `Last turn (you):` line.
- **Persona retune (WP-C.4 — soft).** Re-read `personas/*.md`. Edit
  only if the new system prompt's vocabulary creates a conflict with
  any persona body. Likely no edits needed.
- **Tests (WP-C.5).**
  - `tests/llm/inputBuilder.test.ts` — full rewrite. Cases:
    - `Last turn (you):` line: 4 outcome fragments (move + action +
      damage + said), each fragment tested in isolation; turn-1
      omission; multi-attacker damage formatting.
    - Per-Visible observation brackets: HP bucket, holding-weapon,
      attacked-X, said-"...", `[opened]`, `[drained]`, multiple
      brackets joined.
    - Sort order: living chars before chests before walls before
      Evac; 8-cap applies to chars+chests+corpses; walls and cover
      and Evac unbounded; drained corpses sorted after non-drained
      at equal distance.
    - Walls render as `Wall_<x>_<y>, dist N <bearing>`.
    - Evac singleton renders as `Evac, dist N <bearing>` once
      revealed; absent before reveal.
    - "in evac zone" suffix on You: line: present iff evac revealed
      and observer in zone.
    - Token budget: composed (system + persona + scratchpad +
      digest) ≤ 1 200 tokens (chars/4 proxy) for at least one
      synthetic state from each persona.
  - `tests/llm/personas.test.ts` — re-run unchanged; persona bodies
    must still be ≤ 80 tokens.

**Acceptance.**

- `npm run lint && npm run typecheck && npm run build && npm test` all
  green at root.
- 1-run smoke against dev Convex completes a full match. The
  `agentRecords[].input.visibleStateDigest` for any agent on any turn
  N ≥ 2 contains a `Last turn (you):` line and per-Visible
  observation brackets.
- Token-budget assert: chars/4 of `(systemPromptText + personaPromptText
  + scratchpadBefore + visibleStateDigest)` for every agentRecord on
  the smoke run is ≤ 1 200 tokens. Headroom (avg, p95) reported.
- Reviewer (independent agent) confirms: digest matches the locked
  shape in North Star §1; system prompt teaches the action grammar
  and the digest's vocabulary; no `Affordances:`/`Heard:`/`Last-known:`
  / `Evac:` section headers anywhere in the smoke-run digests.

**Test strategy.**

- Tests-first per AOP for `inputBuilder.ts`. Build small synthetic
  fixtures (2-character mini map, scripted prior turn) and assert the
  digest text byte-for-byte.
- The token-budget assert runs on the smoke run, not in unit tests
  (unit tests cover individual cases; the budget is a smoke-run
  invariant).
- Persona edits (if any) are exercised by re-running existing
  `personas.test.ts`.

**Risks.**

- **Token budget overshoots 1 200.** Mitigation: WP-C.5 token-budget
  assert is the gate. If it fails, lower `VISIBLE_ENTITY_CAP` from 8
  to 6 (digest-side change; doesn't touch vision.ts) and/or trim the
  system prompt. The cap-trim option is the cheapest first move.
- **Last-turn observation collection cost.** WP-C.3 reads one extra
  `turns` row per `advanceTurn`. Mitigation: the read is a single
  index lookup (`by_match_turn`), well within Convex query budget.
- **Per-Visible observation logic complexity.** Filtering "what this
  agent could see at turn N+1 start" of "what happened in turn N" has
  some edge cases (the observer wasn't visible to the actor; the
  observer was hidden last turn; the observer extracted last turn).
  Mitigation: explicit unit tests for each edge case; the
  observation collection is a pure function over (prevTurnRow,
  observerStateAtN+1).
- **System prompt rewrite invalidates `systemPromptHash` for every
  trace.** Expected and intentional. The hash differs from phase 1.

**Effort.** 1.5–2.0 days. Parallel with WP-D after WP-B lands.

---

## WP-D — Replay UI raw-pane

**Scope.**

- **ExpandModal collapse (WP-D.1).** `apps/replay/src/components/
  ExpandModal.tsx` — replace the 5-tab structure with a single
  raw-dump pane comprising three sections in vertical order:
  1. **Full LLM input** — concatenated `system role + user role`
     reconstructed from
     `agentRecord.input.systemPromptText` + the user-message
     wrapper (`## Persona / ## Scratchpad / ## Visible state`
     headers + bodies). Read-only `<pre>` block.
  2. **Reasoning text** — `agentRecord.llm.reasoning ??
     agentRecord.decision.rationale ?? "(no reasoning captured)"`.
     Read-only `<pre>`.
  3. **Tool call JSON** — pretty-printed JSON of
     `agentRecord.decision`. Read-only `<pre>`.
  Each section has a copy-to-clipboard button. Modal layout:
  full-viewport overlay, max-width ~1200px, internal scroll.
- **Decision-as-English vocab (WP-D.2).**
  `apps/replay/src/lib/decisionEnglish.ts`:
  - Drop `interact` rendering; loot now renders for both chest and
    corpse targets; the English copy disambiguates by looking at
    the targetId prefix (`"opened chest_005"` / `"looted Player_5"`).
  - Add result-string `empty` ("loot attempt — corpse already
    drained").
  - Replace `overwatch_priority` rendering with stance display
    ("overwatch (defensive)" / "overwatch (offensive)").
  - Add "counter-fired Player_X — dmg N" rendering for defensive
    overwatch trace entries.
- **TurnFeed stance display + reasoning indicator (WP-D.3).**
  `apps/replay/src/components/TurnFeed.tsx`:
  - Inline expansion shows `overwatch_stance` when primary is
    overwatch.
  - Show a small indicator (e.g. "🧠" or character count) on the
    feed row when `agentRecord.llm.reasoning` is non-null OR
    `agentRecord.decision.rationale` is non-null, so the user knows
    the raw-pane has reasoning content to show.
- **Tests (WP-D.4).**
  - `apps/replay/src/lib/__tests__/decisionEnglish.test.ts` rewrite:
    new vocab (loot for chest/corpse), `result: "empty"`, stance
    rendering, counter-fire entries.
  - `apps/replay/src/components/__tests__/ExpandModal.test.tsx` —
    new structure: 3 sections in vertical order, no tab buttons,
    copy-to-clipboard buttons present.
  - `apps/replay/src/components/__tests__/TurnFeed.test.tsx` —
    stance display + reasoning indicator.

**Acceptance.**

- `npm run lint && npm run typecheck && npm run build && npm test` all
  green (root and `apps/replay/`).
- Manual UAT on the dev deployment: the user opens any agent's
  expand modal, sees three vertical sections (LLM input, reasoning,
  tool call), can copy each to clipboard, and the previous 5-tab UI
  is gone.
- Reviewer confirms: decisionEnglish vocabulary covers every result
  string the engine emits per WP-B (`looted`, `empty`, `out_of_range`,
  `no_corpse`, `no_target`, `opened`, `already_opened`, `no_chest`
  for chests; `dmg N` / `no_target` / `out_of_range` for attacks;
  overwatch entries with stance attribution).
- The reasoning indicator on TurnFeed renders correctly for runs from
  the WP-B smoke (where reasoning may or may not be present
  depending on Branch A vs Branch B).

**Test strategy.**

- Tests-first per AOP for `decisionEnglish.ts` — the vocabulary table
  is exhaustively covered (every result string × every action.kind ×
  stance variants).
- ExpandModal + TurnFeed tested with React Testing Library; assertions
  on rendered text + copy-button presence.

**Risks.**

- **Loot vocabulary disambiguation.** The English summary needs to
  decide chest-vs-corpse from the targetId prefix; if the engine ever
  emits a `loot` with a target that doesn't match either prefix, the
  English renderer falls back to "looted <id>" with no semantic
  qualifier. Mitigation: WP-B's `validateDecision` rejects bogus
  targetIds before resolution, so the trace shouldn't contain the
  fallback case in practice.
- **Reasoning rendering on Branch B (`rationale` field).** The expand
  modal reads `agentRecord.llm.reasoning ?? agentRecord.decision
  .rationale`. If both are null, the section shows "(no reasoning
  captured)". Mitigation: the indicator on TurnFeed only lights up
  when at least one is present.
- **Schema diff in `apps/replay/`'s codegen.** Convex regenerates the
  `_generated/dataModel.d.ts` after the schema push; the renderer's
  `Doc<"turns">` type updates automatically. Type errors surface in
  the renderer where the old fields were referenced (e.g.
  `decision.overwatch_priority`). Mitigation: the WP-D edits track
  every reference; reviewer grep-confirms zero remaining references
  to the dropped fields in `apps/replay/src/`.

**Effort.** 1.0–1.5 days. Parallel with WP-C after WP-B lands.

---

## WP-E — Closing-10 harness pass + persisted report + closure record

**Scope.**

- **Pre-flight smoke (WP-E.1).** Run `harness/run.ts --runs 1
  --concurrency 1` against the dev deployment. Verify the run
  completes, the `turns` rows have the new shape (overwatch_stance,
  no overwatch_priority), and the replay UI's match picker shows
  the run.
- **Closing-10 run (WP-E.2).** `harness/run.ts --runs 10 --concurrency
  5`. All 10 runs must complete with `status: "completed"` and no
  crashes.
- **Aggregator (WP-E.3).** Extend
  `convex/engine/reportStats.ts` (or add a sibling module — decision
  recorded in WP-E acceptance) with the new metrics from README §5:
  - Schema validity rate (fellback-to-safe-default rate per turn).
  - Wall-blocked move rate (stationary-with-wall-in-direction).
  - Drained-corpse repeat rate (consecutive same-agent same-corpse
    with `result: "empty"`).
  - Corpse loot success rate (≥1 `result: "looted"` per run).
  - Overwatch stance differentiation counts (defensive counter-fires
    > 0, offensive fires > 0 across the 10 runs).
  - Outcome attribution heuristic (turn N+1 references damage taken
    in turn N — implementation: search `agentRecord.decision` and
    `scratchpadAfter` for the attacker's id; count rate over
    matching N pairs).
  - Reasoning text capture rate (% of non-fallback agentRecords
    with `agentRecord.llm.reasoning !== null` OR `decision.rationale
    !== null`).
- **Persisted report row (WP-E.4).** Call
  `reports.create({ matchIds, reportType: "phase-3-closing-10" })`.
  The report row's payload mirrors `ReportPayload` (extended with
  the new metrics).
- **Closure record (WP-E.5).** Write
  `docs/project/phases/03-substrate-refinement/PHASE-3-CLOSURE.md`
  mirroring phase 1's closure shape: report id, metric values,
  threshold-vs-actual table, sign-off note.
- **Mental-model update (WP-E.6).** Add a new §11 paragraph (or
  extend the existing one) to mark phase 3 closed, with the
  reportId hyperlink.

**Acceptance.**

- 10 Convex-persisted runs visible in the replay UI's match picker,
  each fully steppable.
- Persisted report row in `reports` table with `reportType:
  "phase-3-closing-10"`, payload populated with all README §5
  metrics.
- All metrics in README §5 meet their thresholds OR a
  documented-why-not appears in `PHASE-3-CLOSURE.md` with reviewer
  acceptance (the threshold list is the bar; misses require user
  sign-off, not silent acceptance).
- `mental-model.md` §11 marks phase 3 closed.
- Reviewer (independent agent) confirms: all Cucumber scenarios in
  README §3 hold; all metrics tie back to trace fields; the
  closure record is reproducible from the persisted data.

**Test strategy.**

- Aggregator extensions get unit tests with synthetic
  `turns`/`runs` fixtures.
- The closing-10 run itself is the integration smoke. There is no
  unit test for "10 matches complete without crashes" — that's an
  end-to-end property the harness exercises.
- Reviewer's three-match walk-through is the acceptance test for
  the Cucumber scenarios.

**Risks.**

- **Threshold misses.** Some new metrics (outcome-attribution loop
  ≥ 50%, reasoning capture ≥ 80%) are best-effort heuristics —
  Branch B (no reasoning text from Azure) makes the 80% reasoning
  threshold directly contingent on `decision.rationale` being
  populated by the model, which depends on the system-prompt rewrite
  asking for it explicitly. Mitigation: WP-C's system prompt
  includes a one-line ask for rationale iff Branch B; if the rate
  falls short, document the why-not + the system-prompt iteration
  attempts in `PHASE-3-CLOSURE.md`.
- **Wall-blocked move rate calculation.** The metric is "no-op
  due to wall" — a `resolution.moves[]` entry where `from === to`
  AND there's an adjacent wall in the direction the agent intended
  to go. The "intended direction" comes from `decision.move`, which
  needs to be cross-referenced. Mitigation: the aggregator handles
  this; there's no schema diff needed.
- **Outcome-attribution heuristic false negatives.** "References
  damage taken" via `away_from_entity attacker` or scratchpad
  containing "Player_X" is a coarse signal. Mitigation: it's a
  best-effort metric explicitly framed as such in the North Star;
  the closure record reports the rate transparently.
- **Concurrency on the closing-10 run.** Phase-1's closing-50 ran at
  concurrency 10 cleanly. Phase-3 at concurrency 5 should be
  trouble-free. Mitigation: phase-1's rate-limit findings carry over;
  no new concurrency tuning required.

**Effort.** 1.0–1.5 days. Sequenced last.

---

# Closing the phase

After WP-D and WP-E land:

1. **Code review pass** (after WP-D, before WP-E.2) — independent
   reviewer agent walks through one match end-to-end and confirms
   every Cucumber scenario in README §3 holds. Reviewer specifically
   validates: schema diff is complete (no remaining
   `overwatch_priority` / `interact` references); engine fixes are
   correct (drained-corpse trace, defensive counter-fire,
   loot dispatch); digest matches North Star §1; replay UI's
   raw-pane has 3 sections; reasoning capture path matches the
   probe outcome.
2. **WP-E closing-10 pass** runs the 10-run harness, persists the
   report, writes the closure record.
3. **User UAT** — the user opens the closing-10 in the replay UI,
   steps through three matches, drills into agent expand modals,
   and signals "yes, the substrate now produces watchable,
   attributable, prompt-driven behaviour with the outcome channel
   wired up" — or files a follow-up phase to address whatever
   remained insufficient.

The reviewer-before-close pattern from phases 1 and 2 carries over.
Reviews go *before* the phase closes, not after.
