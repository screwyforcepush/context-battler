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

**Sequencing fix from review round 1 (high severity):**
`convex/engine/affordances.ts` deletion is in **WP-C, not WP-B** —
the deletion was originally in WP-B but is moved out so the WP-B gate
typechecks while `convex/llm/inputBuilder.ts` still imports
`localAffordances`. WP-C drops the import + call sites first, then
deletes the module. See WP-B.6 (deferred) and WP-C.4 (actual
deletion).

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
- **Schema break (WP-A.2).** Apply the ADR §1 + ADR §2 + ADR §3 +
  ADR §9 diffs to:
  - `convex/llm/decisionTool.ts` — JSON Schema + Zod schema: drop
    `interact` arm; rename `loot.targetCorpseId` to `loot.targetId`;
    drop `overwatch_priority`; add `overwatch_stance: "offensive" |
    "defensive" | null` (required when `primary === "overwatch"`,
    null otherwise — enforced via Zod refinement); conditionally add
    `rationale: string | null` (max 280 chars) iff the probe's
    Branch B applies.
  - `convex/schema.ts` — apply the same `decisionValidator` diff; add
    `reasoning: v.union(v.string(), v.null())` to `agentLlmValidator`
    (per ADR §2 / PM lock D13 — required nullable, *not*
    `v.optional(v.string())`); extend the `actions[]` validator with
    optional `fromOverwatch?: boolean` + `stance?: "offensive" |
    "defensive"` per ADR §3; extend `MoveTraceEntry`/`moves[]`
    validator with optional `blockedBy?: "wall"` per ADR §9; remove
    historical `interact`-shape compatibility shims (POC mode).
  - **`convex/_internal_runMatch.ts`** — schema mirror, currently
    carrying hand-copied validators at lines 95–123 (`actionValidator`
    has `interact` arm + `targetCorpseId`), 121
    (`overwatch_priority`), 134–149 (`agentLlmValidator` has no
    `reasoning`), and 175–188 (`moves`/`actions` shapes). Apply the
    SAME diff as `convex/schema.ts` in the **same WP-A.2 commit** —
    the mirror MUST stay in lockstep or `recordTurn` rejects every
    new-shape row. Optional follow-up (non-blocking): hoist the
    validators to a shared module (e.g. `convex/lib/validators.ts`)
    to eliminate the mirror entirely; documented in ADR §1
    consequences. State-slice scope per architecture §1 — non-engine.
  - `convex/engine/types.ts` — TS aliases: `ActionDecision` becomes
    3-arm union; `ParsedDecision` adds `overwatch_stance` and
    (conditionally) `rationale`; `SAFE_DEFAULT_DECISION` updated;
    `ActionTraceEntry` gains optional `fromOverwatch?: boolean` +
    `stance?: "offensive" | "defensive"`; `MoveTraceEntry` gains
    optional `blockedBy?: "wall"`.
  - `convex/llm/azure.ts` — `CallResult.raw.reasoning?: string | null`
    extraction path (Branch A: read from output[] reasoning items
    and sanitise+truncate to ≤ 4 KB; Branch B: always `null`, never
    `undefined`, per ADR §2 nullability). Sanitise via the existing
    `sanitiseHttpBody` helper if it generalises, otherwise add a
    dedicated sanitiser.
- **Convex schema push + DB wipe (WP-A.3).** After local typecheck
  passes, push the new schema with `npx convex dev` against the dev
  deployment. Existing rows in `matches`/`turns`/`characters`/
  `worldState`/`runs`/`reports` will fail validation. Wipe the dev
  data (`npx convex run --no-push <wipe-script>` or per-table
  `convex run` mutations) and document the wipe command in this WP's
  acceptance.

  **WP-A.3 wipe-command record (2026-05-08):** the wipe shipped via a
  one-shot mutation pair in `convex/spike.ts`:
  - `spike:wipeOneTable` — paginated per-table delete (page size 64)
    that respects Convex's 16 MB single-execution byte budget; the
    `turns` table is large enough to require pagination after a
    closing-50 phase-1 run.
  - `spike:smokeCreateMatch` — minimal `matches`-row insert under the
    new schema, used to prove the read/write path post-wipe.

  The push → wipe → push procedure required temporarily setting
  `schemaValidation: false` on the schema export so the wipe mutation
  could run against legacy rows; the flag was removed (default `true`
  restored) before the final push. Sequence:

  ```bash
  # 1. Push with schemaValidation: false (transient).
  npx convex dev --once

  # 2. Wipe each table to empty (loop until moreToGo === false).
  for t in turns characters worldState runs reports matches; do
    while true; do
      out=$(npx convex run spike:wipeOneTable "{\"table\":\"$t\"}")
      echo "$t: $out"
      echo "$out" | grep -q '"moreToGo": false' && break
    done
  done

  # 3. Restore schemaValidation default and re-push.
  npx convex dev --once

  # 4. Smoke roundtrip — create + read.
  match_id=$(npx convex run spike:smokeCreateMatch | tr -d '"')
  npx convex run matches:get "{\"id\":\"$match_id\"}"
  npx convex run spike:wipeOneTable '{"table":"matches"}'  # cleanup
  ```

  Smoke result (2026-05-08): match row `j974sv8tys7rd99ypj2a3y4p9s86ajsp`
  created with the new shape (`reasoningEffort: "low"` set; `outcome`
  empty; no decision rows yet — empty trace) and read back cleanly via
  `matches:get`. The wipe + smoke mutations remain in `convex/spike.ts`
  for re-use during WP-B/C/D smoke runs (idempotent: empty-input wipe is
  a no-op).
- **Concept-spec edits (WP-A.4).** Diff-targeted edits to
  `docs/project/spec/concept-spec.md` §7, §8, §11, §13, §21, §22, §23
  per ADR §8 (surface expanded by PM lock D12 after review round 2 to
  keep the spec internally consistent with the new contract).
- **Tests (WP-A.5).** Update:
  - `tests/llm/decisionTool.test.ts` — every literal in the new schema;
    structural-equivalence asserts continue to hold; Zod refinement
    asserts overwatch_stance/primary consistency.
  - `tests/llm/azure.test.ts` — Branch-A: extract reasoning text on
    a mocked happy-path response; Branch-B: ensure `reasoning` is
    always `null` (not `undefined`, per ADR §2 nullability);
    sanitisation cases.
  - **Mirror parity test** — a small assertion that
    `convex/_internal_runMatch.ts`'s `actionValidator`,
    `decisionValidator`, and `agentLlmValidator` accept the same set
    of literals/fields as the corresponding validators in
    `convex/schema.ts`. Cheapest form: a typecheck-time pass that
    constructs a sample `ParsedDecision` and asserts both validators
    accept it; structural-equivalence at the validator level is fine.
    Closes Round 2 punch list item 13.
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
- `concept-spec.md` v0.2 shipped, with §7/§8/§11/§13/§21/§22/§23 edits
  matching the ADR §8 diff (surface expanded per PM lock D12).
- A reviewer agent (independent of the implementer) has eyeballed the
  schema diff and confirmed: (a) the loot dispatch covers chest +
  corpse id namespaces explicitly; (b) overwatch_stance is required
  iff primary is "overwatch"; (c) reasoning persistence path matches
  the probe outcome and uses `v.union(v.string(), v.null())`, not
  `v.optional(v.string())`; (d) `convex/_internal_runMatch.ts` mirror
  is in lockstep with `convex/schema.ts` (`actionValidator`,
  `decisionValidator`, `agentLlmValidator`, `actions[]` action-entry
  shape with optional `fromOverwatch`+`stance`, and `moves[]` entry
  shape with optional `blockedBy`); (e) the trace `kind` for chest
  opens is documented as `"loot"`/`"opened"` per PM lock D7.

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
  `_internal_runMatch.ts`, `types.ts`.** Mitigation: structural-
  equivalence asserts at the bottom of `decisionTool.ts` (already in
  place) catch TS-side drift; the new mirror parity test (WP-A.5)
  catches `convex/schema.ts` ↔ `convex/_internal_runMatch.ts`
  drift on `actionValidator`/`decisionValidator`/`agentLlmValidator`
  /actions-entry/moves-entry. The schema validator
  (`convex/schema.ts`) is verified by the typecheck of `runMatch.ts`
  calls (the convex codegen produces types from the validator). If
  ongoing parity proves brittle, the optional follow-up in ADR §1
  hoists validators to a shared module.

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
- **`affordances.ts` deletion — DEFERRED to WP-C (WP-B.6).**
  Per Round 1 high-severity finding: `convex/llm/inputBuilder.ts:46`
  imports `localAffordances` from `convex/engine/affordances.js`
  (called at lines 267 + 352). Deleting `affordances.ts` in WP-B
  while the inputBuilder still imports it produces a hard typecheck
  error and the WP-B gate cannot pass. Sequence: WP-C drops the
  import + the call sites first, then deletes the module. WP-B keeps
  the file in place (unused at runtime once `interact` dispatch is
  gone, but still compiled).
- **Wall-blocked move emission (WP-B.7).** `convex/engine/movement.ts`
  push-gate at lines 368–375 relaxed per ADR §9 — when an intended
  move is blocked by an adjacent wall, push a `from === to` entry
  tagged `blockedBy: "wall"`. No-move decisions and character-blocks
  emit nothing (existing absence is correct). Cross-references:
  `tileInWall`/`tileInAnyWall` already imported. Validator change
  already covered in WP-A.2.
- **Engine-side consumer renames (WP-B.8).**
  - `convex/engine/runStats.ts:216` — chest-equip filter updated from
    `kind === "interact" && result === "opened"` to
    `kind === "loot" && result === "opened" && target.startsWith("chest_")`
    per PM lock D7. Without this, the chest-equip metric in the
    closing-10 report silently zeros out.
  - `convex/engine/validation.ts` — rename `overwatch_priority` →
    `overwatch_stance`; add the stance/primary consistency check;
    `loot.targetId` namespace validity check (chest_*, Player_*,
    rejection on others).
- **Harness CLI consumer (WP-B.9).** `harness/analyze-match.ts:52`
  filter updated from `kind === "interact"` to
  `kind === "loot" && result === "opened" && target.startsWith("chest_")`.
  Same fix shape as `runStats.ts`. Closes Round 2 punch list item 11.
  *(Could equally have lived in WP-E pre-flight; placed here so all
  trace-vocabulary consumers land in the same engine-fix WP for
  reviewer ergonomics.)*
- **Tests (WP-B.10).**
  - `tests/engine/vision.test.ts` — wall emission cases including a
    **12-wall safety-ceiling test**: observer in the wall-densest
    reference-map corner, asserting `computeVisibleEntities` emits all
    walls within Chebyshev 20 (no engine-side cap) and `inputBuilder`
    caps at 12 in WP-C.5. Closes Round 2 punch list item 14.
  - `tests/engine/resolution.test.ts` — drained-corpse trace
    (3 cases: drained on first attempt, drained on repeat,
    no-corpse); loot dispatch on chest id; loot dispatch on
    corpse id; loot dispatch on bogus id; defensive overwatch
    counter-fires (single attacker, multi-attacker, out-of-range
    attacker, hidden→revealed) with `fromOverwatch=true` +
    `stance="defensive"` asserted on every counter-fire entry;
    offensive overwatch entries carry `stance="offensive"`.
  - `tests/engine/movement.test.ts` — wall-blocked-by emit (intended
    NESW + diagonals into walls all emit `blockedBy: "wall"`);
    no-move decision emits nothing; character-blocked emits nothing.
  - `tests/engine/affordances.test.ts` — kept in WP-B (deletion is
    in WP-C alongside the import drop).
  - `tests/engine/validation.test.ts` — stance/primary consistency
    + `loot.targetId` namespace validity.

**Acceptance.**

- `npm run lint && npm run typecheck && npm run build && npm test` all
  green at root.
- The 4 Cucumber scenarios in README §3 (walls visible, drained
  corpses, defensive counter-fire, offensive first-in-range) all pass
  at least one test in `tests/engine/*`.
- One smoke `npx convex run runMatch:advanceTurn` (or the equivalent
  `harness/run.ts --runs 1`) executes a single match end-to-end against
  the dev deployment, with no crashes and no schema-validation
  failures. `convex run turns:getAgentTurn` returns a turn record
  with the new shape (overwatch_stance, no overwatch_priority).
- `convex/engine/runStats.ts` chest-equip filter rewritten and
  asserted by `tests/engine/runStats.test.ts` (existing fixture
  updated for the new trace shape — chest-equip detection ties to
  `loot/opened/chest_*`).
- `harness/analyze-match.ts:52` filter updated; smoke run
  (`npx tsx harness/analyze-match.ts <matchId>`) prints non-zero
  chest-open counts (sanity check that the rename to
  `loot/opened/chest_*` landed).
- Reviewer (independent agent) confirms: counter-fire bounded by range
  is correctly tested; loot dispatch covers all 3 id paths; trace's
  `result: "empty"` is emitted exactly once per drained-corpse
  attempt; trace entries carry `fromOverwatch` + `stance` per ADR §3;
  `MoveTraceEntry.blockedBy: "wall"` is emitted on wall-blocked
  moves (no other blocking causes emit it); 12-wall safety ceiling
  test passes.

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
  - **Drop the `import { localAffordances } from
    "../engine/affordances.js"` line at `inputBuilder.ts:46`** and
    its call sites at lines 267 + 352. Once these references are
    gone, the deletion in WP-C.4 below typechecks.
  - Add `buildLastTurnLine(prevTurnRow, characterId)` — pure helper
    that takes the previous turn's resolution + the agent's id and
    composes the one-line summary. Returns `null` for turn 1.
    Consumes `moves[].blockedBy === "wall"` per ADR §9 to render
    "moved 3 SW → hit wall".
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
    unbounded (with the **12-wall safety ceiling per ADR §5**).
  - The composed `buildAgentInput` continues to return
    `{ systemPrompt, visibleStateDigest }`; the system prompt is now
    longer and the digest's section ordering is new. The
    `runMatch.advanceTurn` caller passes the previous turn's row to
    `buildAgentInput` (one extra arg).
- **System prompt rewrite (WP-C.2).** `convex/llm/systemPrompt.ts`
  full rewrite per ADR §7. Targeted ≤ 500 tokens (chars/4 proxy).
  **Branch B conditional:** if WP-A.1 lands Branch B, the prompt
  includes the Section 5b rationale ask per ADR §7. Cross-link:
  `de-risking.md` D-P3-1 Branch B carries the exact ask copy. The
  conditional logic is implemented either as an `if (BRANCH_B)`
  switch in `systemPrompt.ts` (probe outcome captured as a build-
  time constant) or by static-rewriting the file once the probe
  resolves; the choice is implementer's. Closes Round 2 punch list
  item 5.
- **Last-turn observation collection (WP-C.3).** `convex/runMatch.ts`
  reads the prior `turns` row (by `(matchId, turn-1)`) at the top of
  `advanceTurn` and threads it into `buildAgentInput`. Turn 1 sees a
  null prior row; the digest omits the `Last turn (you):` line.
- **Affordances module deletion (WP-C.4).** After WP-C.1's import
  drop lands and typecheck passes, DELETE
  `convex/engine/affordances.ts` and `tests/engine/affordances.test.ts`.
  Sequencing this in WP-C (not WP-B) is required so that the WP-B
  gate doesn't fail on the inputBuilder still importing
  `localAffordances`. Closes Round 1 high-severity sequencing
  finding.
- **Persona retune (WP-C.5 — soft).** Re-read `personas/*.md`. Edit
  only if the new system prompt's vocabulary creates a conflict with
  any persona body. Likely no edits needed.
- **Tests (WP-C.6).**
  - `tests/llm/inputBuilder.test.ts` — full rewrite. Cases:
    - `Last turn (you):` line: 4 outcome fragments (move + action +
      damage + said), each fragment tested in isolation; turn-1
      omission; multi-attacker damage formatting; **wall-block
      rendering** ("moved 3 SW → hit wall") sourced from
      `moves[].blockedBy === "wall"` per ADR §9.
    - Per-Visible observation brackets: HP bucket, holding-weapon,
      attacked-X, said-"...", `[opened]`, `[drained]`, multiple
      brackets joined.
    - Sort order: living chars before chests before walls before
      Evac; 8-cap applies to chars+chests+corpses; walls and cover
      and Evac unbounded; drained corpses sorted after non-drained
      at equal distance.
    - Walls render as `Wall_<x>_<y>, dist N <bearing>`.
    - **12-wall safety ceiling** — observer at the reference-map's
      wall-densest corner asserts `inputBuilder` caps emitted walls
      at 12 even when vision-side emission exceeds (per ADR §5).
      Closes Round 2 punch list item 14.
    - **Explicit no-deleted-headers assertion** — the rendered
      digest never contains the strings `Affordances:`,
      `Heard (last turn):`, `Last-known:`, or `Evac:` as section
      headers. One assertion per missing header; cheap and locks
      the spec. Closes Round 1 / Round 2 punch list item 15.
    - Evac singleton renders as `Evac, dist N <bearing>` once
      revealed; absent before reveal.
    - "in evac zone" suffix on You: line: present iff evac revealed
      and observer in zone.
    - Token budget: composed (system + persona + scratchpad +
      digest) ≤ 1 200 tokens (chars/4 proxy) for at least one
      synthetic state from each persona. **Optional calibration
      (non-blocking, Round 2 punch list item 18):** cross-check
      `chars/4` against real `tiktoken` on one composed input per
      persona; record any > 5% gap in the WP-C smoke-run notes.
  - `tests/llm/systemPrompt.test.ts` (NEW — closes Round 1 / Round 2
    punch list item 16). Cases:
    - The rendered system prompt contains the typed-id glossary
      (`Player_N`, `Chest_NNN`, `Corpse_PlayerN`, `Cover_X_Y`,
      `Wall_X_Y`, `Evac`).
    - The action-grammar block teaches `move` arms (`relative`,
      `toward_entity`, `away_from_entity`, `toward_object`,
      `toward_evac`, `none`), `action` arms (`loot`, `attack`,
      `none`), and `overwatch` with `overwatch_stance`.
    - The prompt teaches the "outside evac at turn 50, you're
      incinerated" framing.
    - **Branch B conditional**: when the build-time Branch B flag
      is on, the rendered prompt contains the rationale ask
      ("≤ 280 chars"); on Branch A the ask is absent.
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
- **Replay state-reconstruction filter (WP-D.4).** Closes Round 1
  / Round 2 high-severity finding — without these, the replay grid
  renders all chests permanently closed after the schema unify and
  the demo visibly fails.
  - `apps/replay/src/lib/reconstruct.ts:215–232` — chest-flip filter
    updated from `kind === "interact" && result === "opened"` to
    `kind === "loot" && result === "opened" && target.startsWith("chest_")`
    per PM lock D7. Two existing comment lines (~line 22, 188)
    referencing `interact` vocabulary should also be updated to
    `loot/opened/chest_*` for consistency.
  - `apps/replay/src/components/HoverCard.tsx:318` — same chest-open
    filter shape applied to the hover-card open-turn lookup.
- **Tests (WP-D.5).**
  - `apps/replay/src/lib/__tests__/decisionEnglish.test.ts` rewrite:
    new vocab (loot for chest/corpse), `result: "empty"`, stance
    rendering, counter-fire entries (consume `fromOverwatch=true`
    + `stance="defensive"` to render "counter-fired Player_X — dmg N";
    consume `stance="offensive"` to render "overwatch (offensive)
    fired on Player_X"). Wall-blocked move ("→ hit wall") sourced
    from `moves[].blockedBy === "wall"` per ADR §9.
  - `apps/replay/src/lib/__tests__/reconstruct.test.ts` — chest-flip
    on the new trace shape (`loot/opened/chest_*`); chest-flip is
    NOT triggered by `loot/opened/Player_*` (corpse loots).
  - `apps/replay/src/components/__tests__/ExpandModal.test.tsx` —
    new structure: 3 sections in vertical order, no tab buttons,
    copy-to-clipboard buttons present; raw-pane reasoning section
    falls back to `agentRecord.decision.rationale` when
    `agentRecord.llm.reasoning` is `null` (Branch B path).
  - `apps/replay/src/components/__tests__/TurnFeed.test.tsx` —
    stance display + reasoning indicator (lights up from either
    `agentRecord.llm.reasoning` OR `agentRecord.decision.rationale`).
  - `apps/replay/src/components/__tests__/HoverCard.test.tsx` (if
    it exists; else fold into the hover-card test that does exist)
    — chest hover-card filter renders correctly on `loot/opened/
    chest_*`.

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
  overwatch entries with `fromOverwatch` + `stance` attribution).
- The reasoning indicator on TurnFeed renders correctly for runs from
  the WP-B smoke (where reasoning may or may not be present
  depending on Branch A vs Branch B).
- A grep across `apps/replay/src/` confirms zero remaining references
  to `kind === "interact"`, `targetCorpseId`, or `overwatch_priority`.
  Replay grid and hover card render chest opens correctly post-WP-B
  schema unify.

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
- **Aggregator (WP-E.3).** Per PM lock D10: phase-3 metrics live in a
  **new sibling module `convex/reports/phase3.ts`** that reads
  `turns` / `worldState` / `characters` directly. **No per-run
  aggregate columns are added to the `runs` table.** This keeps the
  schema diff scoped (POC posture: schema break is for substrate,
  not metrics), and the report writer is free to evolve without
  another schema push. The existing `convex/engine/reportStats.ts`
  remains scoped to the phase-1 closing-50 metrics; phase 3 sits
  beside it. Metrics from README §5:
  - **Schema validity rate** — `agentRecord.llm.fellBackToSafeDefault`
    count, summed across all turns of all 10 runs, divided by total
    per-turn calls.
  - **Wall-blocked move rate** — count of `resolution.moves[]`
    entries with `blockedBy === "wall"` (engine-emitted per ADR §9),
    divided by count of move-attempt entries (i.e. all `moves[]`
    entries, since a no-move decision emits nothing). Single source,
    no aggregator-side derivation.
  - **Drained-corpse repeat rate** — sequential pass over
    `(turn N, turn N+1)` pairs: count `(actorId, corpseId)` pairs
    where both turns emit `kind="loot"` + `target=corpseId` +
    `result="empty"` for the same actor, divided by total
    `kind="loot"` entries.
  - **Corpse loot success rate** — % of runs where at least one
    `kind="loot"` + `result="looted"` + `target.startsWith("Player_")`
    entry exists.
  - **Overwatch stance differentiation counts** — defensive
    counter-fires = count of `kind="overwatch"` +
    `fromOverwatch=true` + `stance="defensive"` (engine-emitted per
    ADR §3); offensive fires = count of `kind="overwatch"` +
    `stance="offensive"`. Both must be > 0 across the 10 runs.
  - **Outcome attribution heuristic** — turn N+1 references damage
    taken in turn N. Implementation: for each (actor, turn N) where
    actor took damage, scan turn N+1's `agentRecord.decision`
    (action.targetCharacterId, move.targetEntityId) and
    `scratchpadAfter` for the attacker's id; count rate over matching
    N pairs. Final heuristic definition is calibrated by D-P3-4 spike.
  - **Reasoning text capture rate** — % of non-fallback agentRecords
    with `agentRecord.llm.reasoning !== null` OR
    `decision.rationale !== null`. Per ADR §2 nullability, both
    fields are required-nullable so the comparison is well-defined
    on every row.
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
  metrics. Aggregator code lives at `convex/reports/phase3.ts`
  (per PM lock D10); no schema diff to the `runs` table.
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
- **Wall-blocked move rate calculation — RESOLVED by ADR §9 + WP-B.7.**
  Originally Round 2 flagged this as uncomputable from
  `resolution.moves[]` because `simulateMovement` only pushed a
  trace entry when `start !== end`. Phase-3 ADR §9 + WP-B.7 fix the
  engine to emit a `from === to` entry tagged `blockedBy: "wall"` on
  wall-blocked attempts. The phase-3 report writer reads
  `moves[].blockedBy === "wall"` directly. No schema-derivation
  fragility; single source of truth.
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
   `overwatch_priority` / `interact` / `targetCorpseId` references
   anywhere — `convex/`, `apps/replay/src/`, `harness/`, `tests/`);
   `convex/_internal_runMatch.ts` mirror is in lockstep with
   `convex/schema.ts`; engine fixes are correct (drained-corpse
   trace; defensive counter-fire emits `fromOverwatch=true` +
   `stance="defensive"`; offensive overwatch emits
   `stance="offensive"`; `MoveTraceEntry.blockedBy="wall"` emitted
   on wall-blocked moves; loot dispatch by id namespace); digest
   matches North Star §1 (no `Affordances:`/`Heard:`/`Last-known:`/
   `Evac:` headers); replay UI's raw-pane has 3 sections; replay
   chest-flip filter renders chests as opened on the new
   `loot/opened/chest_*` shape; reasoning capture path matches the
   probe outcome and `reasoning` is `v.union(string, null)` (not
   `v.optional`).
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

---

## WP-F — corrective slice 1 (substrate-correctness fix-bundle)

This corrective slice landed between the original WP-E close and the first
phase-close attempt, in response to completion-review-1 reviewer-B's Fail
verdict (Decision Record D24: persistence adapter dropped engine-emitted
trace fields by overwriting them with unconditional `undefined`s, masking
substrate behaviour the engine had actually produced). The slice is six
substrate-correctness fixes (no behaviour tuning, no goalpost moves) plus
a closing-10 rerun and a paperwork pair to align the closure record and
mental-model §11 against the substrate-correct ledger. Canonical narrative
anchor: `PHASE-3-CLOSURE.md` §3.0.

**WP-F.1 — Persistence adapter conditional-spread.** Made
`adaptResolutionForSchema` in `convex/runMatch.ts` lines 447–470
preserve engine-emitted `moves[].blockedBy`, `actions[].fromOverwatch`,
and `actions[].stance` through the Convex round-trip via the
conditional-spread pattern (`...(field !== undefined ? { field } : {})`),
rather than the prior unconditional spread that overwrote present values
with `undefined`. Closes Decision Record D24 — the substrate-contract
bug that masked overwatch counter-fire and wall-block trace data on the
first closing-10. Commit: 76484da (bundled with WP-F.5).

**WP-F.2 — Display-id normalisation at validator boundary.**
`Player_N` display-form ids emitted by the LLM are normalised to the
engine's `_id` form before validator dispatch, via the new helper
`convex/llm/idNormalisation.ts`. Bridges the validator-vs-engine id-shape
gap that was producing target-not-found rejections on otherwise valid
decisions. Commit: 5420073.

**WP-F.3 — Chest-loot full-id render with no corpse-of- prefix.**
`apps/replay/src/lib/decisionEnglish.ts` chest dispatch made
case-insensitive (`/^chest_/i`) so `Chest_NNN` no longer falls through to
the corpse-of fallback (where `resolveCharacterName` was truncating the
bogus id to 8 chars). Closes UAT-001 round-1 — the first cosmetic surface
issue surfaced by user replay-UI walkthrough. Commit: 53ce3cb.

**WP-F.4 — Wall-blocked outcome carries directional vector.**
`convex/llm/inputBuilder.ts` extended its `priorMoveByActor` map so the
`Last turn (you):` line emits the (`dist`, `bearing`) pair on
`blockedBy === "wall"` entries (e.g. "moved 3 SW → hit wall"), not just
the textual hit-wall marker. Restores ADR §9 outcome-attribution shape on
the digest side. Commit: 04177f5.

**WP-F.5 — Concept-spec phase-3 digest alignment.**
`docs/project/spec/concept-spec.md` lines 130 and 406 re-aligned to the
live phase-3 digest shape, replacing stale phase-1/2 vocabulary that had
drifted from the inputBuilder rewrite. Doc-only synchronisation; no
runtime change. Commit: 76484da (bundled with WP-F.1 — same commit covers
the persistence-adapter fix and the spec re-alignment).

**WP-F.6 — schemaMirror live-validator parity test.**
`tests/llm/schemaMirror.test.ts` rewritten to import live exports from
`convex/schema.ts` and `convex/_internal_runMatch.ts` and compare them
field-by-field, rather than asserting against hand-copied literal sets
that drift silently. Closes the WP-A.5 risk-of-mirror-drift open issue
with a live-source guard. Commit: 6eafbab.

**WP-F.7 — Closing-10 rerun #2.** Harness re-execution of
`harness/run.ts --runs 10 --concurrency 5` against the dev deployment on
the substrate-correct ledger. 10/10 matches completed (~8.5 min,
durationMs=513056); new phase-3-closing-10 reportId
`jd7ecmx2fgqa0yd7g8h18cv3n986bmwe` (11/14 thresholds met). No source
commit (harness output only); the report row is the artifact.

**WP-F.8 — PHASE-3-CLOSURE.md rewrite against rerun #2.** Closure record
re-anchored to the new reportId, §3.0 narrative added (the WP-F
fix-bundle as the corrective slice between the two closing-10s), §3.1–3.3
rewritten as substrate-correctness readings rather than substrate-bug
explanations. Commit: c1a7665.

**WP-F.9 — Mental-model §11 cite new closing-10 reportId.**
`docs/project/spec/mental-model.md` §11 phase-3 closure paragraph updated
to hyperlink the new reportId and reflect the 11/14 threshold count.
Doc-only synchronisation with the rewritten closure record. Commit:
e19a7b9.

---

## WP-G — corrective slice 2 (LLM↔engine contract fix)

This corrective slice landed in response to completion-review-2
reviewer-B's Fail verdict (Decision Records D36/D38/D39: the LLM↔engine
id-contract leaked `Corpse_Player_N` display-form into engine dispatch
without normalisation, and the Azure-side JSON Schema `required[]` was
out of sync with the Zod-side `.strict()` requirement set, producing 207
of 234 schema-fallback failures). The slice extends the WP-F id-bridge
pattern to the corpse namespace, aligns the JSON Schema field-list with
the PM-locked 7-field contract, polishes one residual chest-loot phrasing
issue from UAT-001 round-2, and closes with a closing-10 rerun + sister
paperwork commits. Canonical narrative anchor: `PHASE-3-CLOSURE.md` §3.0
(extended in WP-G.6).

**WP-G.1 — Corpse-id contract fix at validator/engine boundary.**
Extends `convex/llm/idNormalisation.ts` with `normaliseCorpseTargetId`
(maps `Corpse_Player_N` → `Player_N` → engine `characterId`) and wires it
into `convex/engine/validation.ts` (loot dispatch + `toward_object`),
`convex/engine/resolution.ts` (loot dispatch), and
`convex/engine/movement.ts` (`toward_object`). Cover_X_Y option (b) RETAIN
exclusion from `toward_object` grammar — Cover is a tile flag not an
entity, and agents already have `relative dx,dy` for tile-targeted moves
(per Decision Record D38). Tests added: 5+3+2+1 across
validation/resolution/movement/systemPrompt suites. Commit: 634524b.

**WP-G.2 — Schema field alignment.** `convex/llm/decisionTool.ts:166`
JSON Schema `required[]` extended from 4 to 7 fields (added `say`,
`overwatch_stance`, `scratchpad_update`) to match the Zod-side
`.strict()` requirement set per Decision Record D39 PM-lock.
Azure-side-only fix; Zod schema unchanged. Test
`tests/llm/decisionTool.test.ts:62-68` updated to assert the sorted
7-field list. Commit: f296f5b.

**WP-G.3 — Chest-loot phrasing polish.**
`apps/replay/src/lib/decisionEnglish.ts` collapses redundant
`Opened Chest_005 — opened.` to `Opened Chest_005.` via new
`isOutcomeRedundantWithIntent()` helper (Option A: drop the `— opened`
suffix when the intent verb already encodes the outcome state). Wired
into `oneLine` + `bullets` composition; corpse-loot path untouched
(WP-F.3 split preserved); `intentVsOutcome` modal keeps both columns for
engine traceability. Closes UAT-001 round-2. Commit: b86fe01.

**WP-G.4 — Validate gate.** `npm run lint && npm run typecheck && npm
test && npm run build` against HEAD with all three corrective commits
integrated (634524b + f296f5b + b86fe01). All green: 619 tests pass, 4
skipped, no warnings. No source commit (validate-gate is a precondition
for the rerun, not a code change).

**WP-G.5 — Closing-10 rerun #3.** Harness re-execution against the dev
Convex deployment `calculating-meerkat-923`. 10/10 matches completed
(~8.76 min, durationMs=525542); new phase-3-closing-10 reportId
`jd769hc5vap1v11bd6jsy307ts86ab05` (12/14 thresholds met; headline:
schema-validity flipped from 18.73% → 8.256%, well under the ≤10%
threshold). Carry-over phase-1 reportId
`jd78d1rxtdgen91b4xebgjbnzs86b8yz`. No source commit (harness output
only); the report row is the artifact.

**WP-G.6 — PHASE-3-CLOSURE.md rewrite + mental-model §11 refresh.**
Closure record re-anchored to the rerun-#3 reportId; §2 tables updated
(12/14 PASS, 2 MISS); §3.0 extended to cite the WP-G commits and
reviewer-B HIGH-1/HIGH-2 findings; §3.1 reframed as why-it-PASSED; §3.2
reframed as combat-economy-tuning (substrate is now correct); §3.3 number
refreshed (65.0% → 68.82%); §4 proof points + §7 follow-ups refreshed.
Mental-model §11 hyperlink updated. Commits: `96df32f` (closure
rewrite) + `dd52f2c` (mental-model §11 refresh).

**WP-G.7 — work-packages.md addendum.** This commit. Appends the WP-F
and WP-G sections to the phase-3 work-packages document so the planning
artifact gains coverage of both corrective slices (10 commits, 18+
sub-items) that previously lived only in commit history + closure §3.0 +
Decision Records D24–D31, D36–D41. Single discrete doc commit.

**WP-G.8 — README phase-status update.** Sister paperwork commit
updating the project README's phase-status section to reflect the
phase-3 close on the rerun-#3 reportId. Doc-only; lands in parallel with
this commit.

**WP-G.9 — Final validate gate + closure.** Final
`npm run lint && npm run typecheck && npm test && npm run build` against
HEAD with all WP-G paperwork commits integrated. Phase-3 close
re-asserted on the substrate-correct ledger; finalised the WP-G.6
commit hashes left as a forward-pointer in this document.

---

## WP-H — corrective slice 3 (corpse-loot aggregator filter + integration-test refresh)

This corrective slice landed in response to completion-review-3's file-cited
HIGH at `convex/reports/phase3.ts:452` (independently flagged by reviewers
A and B with concurring trace queries against the persisted dev report):
the corpse-loot aggregator filter still keyed off the pre-WP-G.1
`Corpse_Player_*` target shape, while the engine had since been emitting
the normalised post-WP-G.1 `Player_*` shape. The substrate code was
correct; the downstream report-aggregator and one stale integration-test
fixture had drifted from it. This is the **third occurrence of the
substrate-code-correct + downstream-artifact-stale pattern**, after WP-F
(persistence adapter dropping engine fields) and WP-G (validator-boundary
id-shape mismatch). The slice widens the corpse-loot success filter to
accept both display-form and normalised target ids, refreshes
`tests/llm/integration.test.ts` against the phase-3 7-field contract,
extends `persistPhase3Report` with an `overwrite` flag so the closing-10
report can be re-aggregated without a fresh harness run, and re-persists
the phase-3-closing-10 report against the existing 10 matchIds. Canonical
narrative anchor: `PHASE-3-CLOSURE.md` §3.0 (extended in WP-H.7).

**Outcome.** Corpse-loot row flips MISS → PASS at 80% (8/10 runs);
threshold count 12/14 → **13/14 PASS**. Sole residual MISS:
reasoning-capture 68.82% (Azure-side floor — unchanged from WP-G.5
baseline). The matchIds set is **unchanged** from WP-G.5's persisted
report (no fresh harness run; the trace data is the same — only the
aggregator output flipped). New phase-3-closing-10 reportId on dev
(`calculating-meerkat-923`): **`jd7b98r81fxarkb3yyctsap2p186bbj7`**.
Previous canonical reportId `jd769hc5vap1v11bd6jsy307ts86ab05` was
**deleted** from the dev `reports` table as part of the WP-H.5 overwrite
path (delete-then-insert).

**WP-H.1 — Corpse-loot success filter widened.** `convex/reports/phase3.ts`
line 452 corpse-loot success filter widened to accept both
`target.startsWith("Corpse_Player_")` (legacy display form) and
`target.startsWith("Player_")` (post-WP-G.1 normalised engine form).
Audit of the surrounding loot filters confirmed only line 452 needed the
post-WP-G.1 shape widening — line 449 totalLootAttempts is kind-only
(shape-agnostic), line 458 chest-equip checks normalised lowercase
`chest_*`, line 504 drained-repeat is shape-agnostic equality, and line
539 outcome-attribution reads attack/overwatch trace via a separate
`Player_*` code path. Single-line filter widening; no other aggregator
sites required changes. Commit: `9d80c27` (bundled with WP-H.2).

**WP-H.2 — Aggregator regression test.** `tests/reports/phase3.test.ts`
fixture refresh + new regression test asserting that a corpse-loot trace
entry with `target === "Player_3"` (post-WP-G.1 shape) now satisfies the
corpse-loot success filter, and that the legacy `Corpse_Player_3` form
also continues to satisfy it. Locks the dual-shape acceptance against
future drift. Commit: `9d80c27` (bundled with WP-H.1).

**WP-H.3 — Integration-test fixture refresh.** `tests/llm/integration.test.ts`
refreshed to the phase-3 contract: imports the production
`SYSTEM_PROMPT` verbatim from `convex/llm/systemPrompt.ts` (eliminating
the prior duplicated synthetic schema cheat-sheet that was the drift
source); rebuilds the digest fixture to phase-3 shape (`You:` /
`Last turn (you):` / `Visible:` with per-Visible observation brackets;
no `Heard:` / `Last-known:` / `Evac:` / `Affordances:` headers);
typed-ids (`Player_3`, `Chest_003`, `Cover_32_28`, `Wall_31_28`) mirror
inputBuilder output; round-trip assertions extended to all 7 required
fields (`consume`/`primary`/`move`/`action`/`say`/`overwatch_stance`/
`scratchpad_update`). VITEST_LLM=1 NOT exercised (live Azure
round-trip; cost-gated). Commit: `4301164`.

**WP-H.4 — `persistPhase3Report` overwrite flag.**
`convex/reports/phase3.ts` `persistPhase3Report` extended with an
`overwrite?: boolean` arg. When `overwrite === true` and an existing
row matches the same `(matchIdsHash, reportType)` pair, the mutation
deletes-then-inserts to surface a fresh reportId; default `false`
preserves prior idempotency-on-duplicate semantics. Commit: `efccdc1`
(bundled with WP-H.5 + WP-H.6).

**WP-H.5 — Persist-strategy choice.** Selected **option (a) — `overwrite`
flag with delete-then-insert** over option (b) (in-place mutation of the
existing row's payload) because:
(i) surfacing a fresh reportId makes the corrective re-aggregation
visible in the audit trail (reviewer-friendly);
(ii) delete-then-insert keeps the `reports` row immutable-once-written
contract intact for non-overwrite callers;
(iii) the single-mutation-arg shape is the smallest surface diff and
defaults to off so existing call-sites are unaffected. Old canonical
reportId `jd769hc5vap1v11bd6jsy307ts86ab05` was deleted from the dev
`reports` table as part of this path. Commit: `efccdc1` (bundled with
WP-H.4 + WP-H.6).

**WP-H.6 — Re-aggregation against existing 10 matchIds.**
`persistPhase3Report` invoked with `overwrite: true` against the
existing 10 matchIds (unchanged from WP-G.5's persisted report; no
fresh harness run). New phase-3-closing-10 reportId:
**`jd7b98r81fxarkb3yyctsap2p186bbj7`**. Headline metrics: corpse-loot
`runsWithCorpseLoot` 0 → 8, `corpseLootSuccessRate` 0 → 0.8,
`meetsCorpseLootThreshold` false → true; **threshold count 12/14 →
13/14 PASS**. All other metric values unchanged: schema-validity 8.256%
PASS, wall-blocked 0.964% PASS, drained-repeat 0/110 PASS, defensive
overwatch=18 + offensive=4 PASS, outcome-attribution 88.57% PASS, kill
90% PASS, equip 100% PASS, speech 100% PASS, extraction 90% PASS,
persona-spread 50pp PASS. Sole residual MISS: reasoning-capture 68.82%
(Azure-side floor — unchanged). `meetsAllThresholds=false` because of
that single residual. Validate gate at commit time: lint clean,
typecheck clean, 621/621 tests pass, build clean. Commit: `efccdc1`
(bundled with WP-H.4 + WP-H.5).

**WP-H.7 — `PHASE-3-CLOSURE.md` rewrite against rerun reportId.**
Closure record re-anchored to `jd7b98r81fxarkb3yyctsap2p186bbj7`; §2
tables updated (13/14 PASS, 1 MISS); §3.0 extended to cite the WP-H
slice as the third corrective occurrence of the substrate-code-correct
+ downstream-artifact-stale pattern; corpse-loot row narrative reframed
from MISS-with-substrate-bug-explanation to PASS-on-substrate-correct;
§3.3 reasoning-capture remains the sole residual-miss narrative.
Source-commit at close = `efccdc1` (last source commit in the WP-H
slice). Commit: pending — see git log post-merge (forward-pointer to
be finalised in a follow-up commit, mirroring the WP-G.9 finalisation
pattern for WP-G.6).

**WP-H.8 — Mental-model §11 refresh.**
`docs/project/spec/mental-model.md` §11 hyperlink updated from
`jd769hc5vap1v11bd6jsy307ts86ab05` to
`jd7b98r81fxarkb3yyctsap2p186bbj7`; threshold-count line flipped 12/14
→ 13/14; residual-miss summary tightened to single-residual
(reasoning-capture Azure-floor only); corrective-slice narrative
extended from two-slice (WP-F + WP-G) to three-slice
(WP-F + WP-G + WP-H). Doc-only synchronisation with the rewritten
closure record. Commit: `8233d55`.

**WP-H.9 — work-packages.md addendum.** This commit. Appends the WP-H
section to the phase-3 work-packages document so the planning artifact
gains coverage of the third corrective slice (3 source commits +
2 paperwork commits + this addendum = 6 commits across 9 sub-items)
that previously lived only in commit history + closure §3.0 +
inbox-broadcast trail. Single discrete doc commit; mirrors the WP-G.7
addendum pattern. Forward-pointers for WP-H.7 / WP-H.8 commit hashes
to be finalised in a follow-up paperwork commit (mirrors the WP-G.9
finalisation of WP-G.6 hashes).
