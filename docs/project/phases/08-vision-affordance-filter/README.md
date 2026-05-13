# Phase 8 — Vision Affordance Filter (Drop Spent Entities)

> **Status:** closed 2026-05-13. Substrate follow-up
> to phase 7's closure addendum. Small, contained slice — one filter, one
> smoke validate. No phase closing report.
>
> Canonical intent anchors:
> - [`docs/project/spec/mental-model.md`](../../spec/mental-model.md) §6 pillar 8
>   — "Vision is the affordance channel"
> - [`docs/project/spec/mental-model.md`](../../spec/mental-model.md) §16
>   substrate addendum — empirical trigger
> - [`docs/project/spec/context-payload-iter-3-intent.md`](../../spec/context-payload-iter-3-intent.md)
>   — predecessor slice (what was stripped, what was bet on Pillar 4)

---

## 1. Purpose

Phase 7 closed substrate-complete with one identified residual: agents
were observed repeatedly re-looting empty chests across many sampled
matches, despite the prior turn's outcome line stating
`looted nothing from empty Chest_53_54`. Only one scratchpad note in the
sampled population recorded an empty chest.

Iter-3 had stripped `opened` / `drained` / `contents` from Vision and
bet that Pillar 4 (scratchpad-as-explainability) would compensate. The
bet was directionally right but halfway: leaving the *husk* entity in
Vision created the memory tax without the affordance. BR-genre "looted
chest as visual scenery" is a render convention — it does not earn its
keep in a text-only LLM context where every Vision entry must change
what the agent might do.

This slice closes the gap by implementing pillar 8: spent affordances
fall out of Vision the turn they become inert. The signal is *entity
absence*, not a `looted:true` flag. Pillar 4 stays load-bearing for
*intel* (what was inside, who has what); affordance-spent is a
substrate signal.

> **User-perspective filter test (from north star):** "Does this make
> prompt-authored behaviour more interesting, legible, or exploitable?"
> Yes — re-looting an empty chest looks like forgetfulness; collapsing
> the inert affordance restores the legibility of every loot decision
> the agent does make.

**North-star achieved:** smoke pass (5 matches, 250 turns, 1 737 records) shows `chest.empty=0`, `chest.sameTurnCollision=0`, `corpse.drainedRepeat=0`; headline mechanics (attacks 67, deaths 14, speech 241) within phase-7 envelope with no regression or crashes.

## 2. Overview — what is being built

A single filter inside `convex/llm/inputBuilder.ts`'s Vision projection.
Spent chests (`opened === true`) and drained corpses (no remaining
`weapon`/`armour`/`consumable`) are skipped when assembling the keyed
`Vision:` object. Everything else is unchanged:

- Engine `computeVisibleEntities()` keeps emitting spent entities (still
  authoritative for the validator's "visible chest or corpse" check).
- Engine `worldState.chests[]` / `worldState.corpses[]` keep spent
  entries (still rendered as scenery by the replay UI).
- Outcome lines `You looted speed from Chest_53_54` / `You looted nothing
  from empty Chest_53_54` keep firing from resolution traces; the
  spent-after-this-turn signal still reaches the looting agent next
  turn.
- Decision tool schema unchanged — `targetId` is already free-form
  string; no enum narrowing today, so no schema diff.
- Diagnostics CLI counters automatically reflect the improvement via
  the existing `visibleSummary` / `loot.chest.{empty,sameTurnCollision}`
  / `loot.corpse.drainedRepeat` paths.

## 3. Architecture Design

### 3.1 Filter location — LLM projection, not engine vision

The filter sits at the **LLM projection** layer (`buildVisibleObject` in
`convex/llm/inputBuilder.ts`), **not** at the engine layer
(`computeVisibleEntities` in `convex/engine/vision.ts`).

This is load-bearing. The engine's vision sphere is consumed in three
places:

| Consumer | Wants to see spent entities? | Why |
|---|---|---|
| `convex/llm/inputBuilder.ts` — Vision keyed object for LLM | **No** — pillar 8 | The agent should not be told about inert affordances. |
| `convex/engine/validation.ts:95` — field-scoped validator (`loot` target must be a "visible chest or corpse") | **Yes** | Per assignment cucumber: a stale-memory loot attempt for a spent chest must still resolve through `resolveTypedEntity` so the trace fires `result: "already_opened"` / `"empty"`, which becomes next-turn's `looted nothing from empty …` outcome line. If the engine vision filtered, the validator would zero the action with a field-scoped `validatorReason` and **no outcome line would fire** — breaking acceptance criterion 3 and the explicit cucumber clause "Given an agent loots an empty chest on turn N … Then the outcome line `looted nothing from empty Chest_<coord>` still fires." |
| `apps/replay/src/lib/reconstruct.ts` and the canonical state reader | **Yes** — pillar 7 (state is the contract) | The replay UI renders looted chests as scenery; canonical state is the authority. |

So the engine layer keeps ground-truth visibility; the LLM projection
applies the affordance filter. This matches the existing layering
already adopted by phase 7 (e.g., the Evac entry is suppressed from
LLM Vision when the observer is inside the zone, but the engine still
knows the zone exists).

### 3.2 Spent predicates

| Entity | Spent when | Source-of-truth in current schema |
|---|---|---|
| Chest | `chest.opened === true` | `convex/engine/resolution.ts:737-740` — successful chest loot flips `opened: true` AND clears `contents: null` in the same immutable update. Both invariants always co-hold; we key the predicate on `opened` (the canonical "this affordance is exhausted" flag). |
| Corpse | `!contents.weapon && !contents.armour && !contents.consumable` | `convex/engine/resolution.ts:808-813` — corpse-loot deletes the picked slot key. The existing `corpseDrained` helper in `convex/llm/inputBuilder.ts:90` (re-exported as `isCorpseDrained`) already encodes this predicate. Reused as-is. |

A second predicate `chestSpent(chest: ChestState)` is added inline in
`inputBuilder.ts` for symmetry; keying on `chest.opened` is sufficient.

### 3.3 Touch points

| File | Change | Why |
|---|---|---|
| `convex/llm/inputBuilder.ts` (~line 379, inside `buildVisibleObject`'s `for (const entity of visible)` loop) | Skip `entity.kind === "chest"` if `state.world.chests.find(c => c.id === entity.objectId)?.opened === true`. Skip `entity.kind === "corpse"` if `corpseDrained(state.world.corpses.find(c => c.characterId === entity.objectId)?.contents)`. | Single insertion point. The `visible` array is already the engine's vision-sphere output; we filter it down before tiering and capping. |
| `convex/llm/inputBuilder.ts` — small helper | Inline `chestSpentById(state, objectId): boolean` and reuse the existing `corpseDrained` helper for `corpseDrainedById(state, objectId): boolean`. Pure; no Convex imports. | Keep `buildVisibleObject` readable; predicates are testable in isolation if needed. |
| `tests/llm/inputBuilder.test.ts` — `describe("Phase 6 input builder — visible object")` block | **Add two new specs:** (a) "drops spent chests from Vision once opened" — fixture has one opened chest and one fresh chest at distinct coords; assert `Chest_<opened>` absent, `Chest_<fresh>` present. (b) "drops drained corpses from Vision once contents exhausted" — fixture has one drained corpse (`contents: {}`) and one looted-once corpse with a remaining slot; assert drained absent, partial present. | Lock the contract at the digest level. Vision sub-tests are already grouped here. |
| `tests/llm/inputBuilder.test.ts` — existing "filters hidden living characters and dead characters without corpses" spec (~`:831`) | No edit. Still asserts absence-of-corpse for a dead character with no corpse row — orthogonal to spent-filter. | — |
| `tests/llm/inputBuilder.test.ts` — existing cap test (~`:870`) using 6 fresh `Chest_50_55..60` chests | No edit. All chests have `opened: false`; still appear. | — |
| `tests/engine/vision.test.ts` | **No edit.** Engine vision keeps emitting spent entries; this layer's contract is unchanged. Worth a 1-line module docstring note in `inputBuilder.ts` so a future reader doesn't try to "fix" the engine layer to match. | — |
| `convex/engine/vision.ts` | **No edit.** Authoritative vision-sphere for validator and tests. | — |
| `convex/llm/decisionTool.ts` | **No edit.** `targetId` is `type: "string"` with no enum; no schema variants narrow by visible target ids today. | Acceptance #6 — "If schema variants are not narrowed by target-id today, no schema change is required." Verified. |
| `convex/engine/validation.ts` | **No edit.** Validator continues to use engine vision for the "visible chest or corpse" check. Stale-memory loot attempts (rare residual) flow to resolution and produce the existing `result: "empty"` / `"already_opened"` outcome line. | Cucumber clause "outcome line still fires." |
| `convex/schema.ts` | **No edit.** No new fields; no removed fields. | POC posture — but no schema diff needed at all. |
| `apps/replay/**` | **No edit.** Replay renderer reads canonical `worldState`, not the LLM-facing Vision digest. Spent chests/corpses remain visible as scenery. | Acceptance #5. |
| `harness/diagnostics.ts` and `harness/diagnostics/**` | **No edit.** Counters reflect the change automatically: `visibleSummary.chests/.corpses` are computed from the rendered digest; `loot.chest.{empty,sameTurnCollision}` and `loot.corpse.drainedRepeat` are emitted from resolution traces. The improvement target is that these counters trend toward 0, not that the diagnostic surface changes shape. | Acceptance #7 — measurement surface already exists. |

### 3.4 Data flow (post-change)

```
worldState.chests[]            ← canonical state (engine, unchanged)
   │
   ├─→ computeVisibleEntities  ← engine-side visibility, unchanged
   │      │
   │      ├─→ validation.ts    ← validator sees spent entries (resolves outcome lines)
   │      └─→ inputBuilder.ts → buildVisibleObject  ← NEW: filter spent before tiering
   │              │
   │              └─→ "Vision:" keyed JSON ← spent entities absent
   │
   └─→ apps/replay/lib/reconstruct.ts  ← scenery renderer (unchanged)
```

The only edge that changes is the arrow from `buildVisibleObject` into
the rendered Vision JSON. Everything else is invariant.

### 3.5 What is intentionally NOT changed (acceptance map)

| Acceptance | Mechanism preserving it |
|---|---|
| #3 Outcome lines unchanged | Resolution trace path unchanged; validator unchanged; stale-memory loot still emits `result: "empty"` / `"already_opened"`; renderer in `inputBuilder.renderActionFragment` unchanged. |
| #4 Canonical state untouched | No `worldState` mutation. `chest.opened`/`contents` and `corpse.contents` continue to be set by resolution, never re-mutated by the projection. |
| #5 Replay render unchanged | Replay reads canonical state via `reconstruct.ts`, independent of the LLM Vision projection. |
| #6 Tool-schema variants consistent | `decisionTool.ts` `targetId` schema is open-string; no enum narrowing today. Acceptance #6's conditional "if narrowed, must propagate" does not trigger. |
| #8 No regression on phase-7 closing thresholds | Smoke pass verifies headline counters (extraction, kill, equip, speech, persona spread, no crashes) hold. The filter only *narrows* what the agent sees; it does not change what it can do or how the engine resolves. |

## 4. Dependency Map

```
WP-A (implement + tests)
  │
  └─→ WP-B (smoke validate)
```

Strictly serial — WP-B reads counters off a live run of WP-A's code.
There is no parallelisable independent work in this slice.

## 5. Work Package Breakdown

### WP-A — Implement filter + tests

**Goal:** Spent chests/corpses are filtered from the LLM-facing Vision
keyed object, behind passing unit tests.

**Scope:**

1. Add inline spent-predicate helpers in `convex/llm/inputBuilder.ts`:
   - `chestSpentById(state, objectId)` — looks up the chest, returns
     `chest.opened === true`.
   - `corpseDrainedById(state, objectId)` — looks up the corpse,
     applies the existing `corpseDrained(contents)` helper.
2. Inside `buildVisibleObject`'s `for (const entity of visible)` loop
   (around `inputBuilder.ts:383`), short-circuit:
   - If `entity.kind === "chest"` and `chestSpentById(state, entity.objectId)` → `continue`.
   - If `entity.kind === "corpse"` and `corpseDrainedById(state, entity.objectId)` → `continue`.
3. Add two new specs in `tests/llm/inputBuilder.test.ts` under the
   existing `describe("Phase 6 input builder — visible object")`:
   - **"drops spent chests from Vision once opened"** — observer at
     `(50,50)`; world has `makeChest("Chest_52_50", {x:52,y:50}, true)`
     and `makeChest("Chest_53_50", {x:53,y:50}, false)`. Assert
     `visible.Chest_52_50` undefined, `visible.Chest_53_50` defined.
   - **"drops drained corpses from Vision once contents exhausted"** —
     world has `makeCorpse("c_rat", {x:52,y:50}, {})` (drained) and
     `makeCorpse("c_camper", {x:53,y:50}, { weapon: { category: "weapon", name: "sword" } })`.
     Assert `visible.Corpse_Rat` undefined, `visible.Corpse_Camper` defined.
4. **Validate.** Run lint / typecheck / test / build. No warnings or
   errors. Touch logs via `nohup … > /tmp/<cmd>.log 2>&1 &` per
   `.agents/repo.md`.

**Test design (testing-trophy):**

| Layer | Coverage |
|---|---|
| Unit (engine) | N/A — engine vision unchanged. Existing `tests/engine/vision.test.ts` still asserts spent chests/corpses appear in the engine's visible set; that is the intended layering. |
| Unit (LLM projection) | New two specs above. They lock the projection contract at the rendered Vision JSON level — the agent-facing surface. |
| Integration | The two new specs run against the real `buildAgentInput` (digest is parsed back from the rendered string), exercising the full projection. No additional integration test required. |
| E2E (smoke) | Deferred to WP-B (live match, diagnostics CLI). |

**Success criteria:**

- Both new specs pass.
- All existing tests in `tests/llm/inputBuilder.test.ts` and
  `tests/engine/vision.test.ts` continue to pass without edit.
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` all
  green.
- Diff confined to `convex/llm/inputBuilder.ts` (~10–15 LOC) and
  `tests/llm/inputBuilder.test.ts` (~2 added specs, ~40 LOC).

### WP-B — Smoke validate against live dev DB

**Goal:** Confirm the filter behaves as predicted in a live engine
loop, with no headline mechanic regression.

**Scope:**

1. With WP-A landed, ensure Convex dev deployment is reachable
   (`npx convex dev` in another terminal or pre-pushed).
2. Run a small smoke pass: 5–10 matches, concurrency 1 acceptable
   (per assignment validation protocol). The default harness CLI
   (`npm run harness`) drives this. No new closing report; do not
   persist a `phase-X-closing-N` row.
3. Verify with the diagnostics CLI and Convex queries:
   - `node --import tsx harness/diagnostics.ts --last <N>` over the
     fresh matches. Expected:
     - `mechanics.loot.chest.empty + mechanics.loot.chest.sameTurnCollision`
       → approximately 0 (rare residual from stale-memory hallucinations
       acceptable; should be far below the pre-change baseline).
     - `mechanics.loot.corpse.drainedRepeat` → approximately 0.
     - `mechanics.attackOutcomes.landed`, `loot.chest.opened`,
       `loot.corpse.looted`, deaths, speech events — within the
       phase-7 envelope (no headline regression).
   - `npx convex run turns:getAgentTurn '{"matchId":"…","characterId":"…","turn":N+1}'`
     on a turn following a successful chest loot — confirm the spent
     `Chest_<coord>` id is **absent** from the `visibleStateDigest`
     of every agent for whom that chest is within their engine
     vision sphere.
   - Same query — confirm the **outcome line**
     `You looted speed from Chest_<coord>` (or equivalent) is still
     present in `composedUserMessage` for the looter's next-turn input.
4. Spot-check one stale-memory residual (optional): find one trace
   where an agent emits a `loot` action targeting an
   `opened`-chest id (rare). Confirm it either (a) gets resolved with
   `result: "already_opened"` → next-turn outcome line fires, OR (b) it
   never happens (counter remains 0). Both are acceptable outcomes; the
   point is the agent isn't being *re-tempted* into the failure mode.

**Success criteria:**

- Re-loot counters (`chest.empty + chest.sameTurnCollision`,
  `corpse.drainedRepeat`) collapse toward 0 versus the phase-7
  baseline.
- Headline mechanics counters within phase-7 envelope (no extraction
  / kill / equip / speech regression visible in the diagnostics CLI's
  `mechanics` and `behaviour` sections).
- Verified via `convex run turns:getAgentTurn`:
  - Spent `Chest_*`/`Corpse_*` ids absent from next-turn `visibleStateDigest`.
  - Outcome lines for the original looter still present in next-turn
    `composedUserMessage`.
- No new crashes; engine completes the 5–10 match smoke pass.
- No closing-report row persisted (deliberately below the closing-report
  bar; the diagnostics CLI report is the artefact).

**Validation protocol explicit (from assignment):**

> Implement the filter.
> Run a small smoke pass (5–10 matches, concurrency-1 acceptable for speed).
> Confirm via:
> - `harness/diagnostics.ts --last N` chest/corpse funnels — empty re-loot attempts at ~0.
> - Spot-check a couple of `convex run turns:getAgentTurn` outputs for a turn after a chest was looted — confirm the chest id is absent from the next-turn Vision.
> - Outcome lines still present in `composedUserMessage` the turn after a loot attempt.
> No persisted closing report required.

## 6. Assignment-Level Success Criteria

Mirrors the assignment north-star "Done when":

- [x] 5–10 run smoke pass on fresh dev DB shows **zero or near-zero
      empty-chest re-loot attempts** in agent decisions
      (`mechanics.loot.chest.empty + .sameTurnCollision` ≈ 0).
- [x] Same for drained-corpse repeats
      (`mechanics.loot.corpse.drainedRepeat` ≈ 0).
- [x] Outcome lines still firing as expected — at least one observed
      `You looted <item> from <id>` in the smoke pass's
      `composedUserMessage` corpus.
- [x] `Chest_*` / `Corpse_*` ids absent from next-turn Vision for any
      spent entity (confirmed by spot-check on `turns:getAgentTurn`).
- [x] Canonical state and replay render untouched (no diff in
      `worldState.chests[]` / `worldState.corpses[]` post-loot beyond
      what already happens at resolution).
- [x] No regression in the diagnostics CLI's headline mechanics
      counters (attack outcomes, kill rate, equip rate, speech rate,
      no-crash) versus phase-7 baseline.

## 7. Ambiguities / Questions

None outstanding for the implementation. The two design questions that
shaped this plan are recorded for future readers:

**Q1 — Filter at engine vision or LLM projection layer?**
**Resolved:** LLM projection (`inputBuilder.ts`). The validator must
still see spent entries so stale-memory loot attempts produce the
"outcome-line fires" cucumber path. Filtering at engine vision would
make `looted nothing from empty <id>` *unreachable* for stale-memory
hits — breaking acceptance #3 and the explicit cucumber.

**Q2 — Use `chest.opened` or `chest.contents === null` as the spent
predicate?**
**Resolved:** `chest.opened === true`. The engine flips both
simultaneously at `resolution.ts:738-740`; both are valid. `opened` is
the canonical "this affordance is exhausted" flag and matches how the
existing `result: "already_opened"` trace is gated. `contents === null`
would *also* work (and at chest spawn for dud chests too — same answer).
Either is fine; `opened` is chosen for naming intent.

## 8. Recommended Job Sequence

1. **WP-A first (implement + tests, foreground).** Engineer agent
   writes the two new specs RED, lands the filter GREEN, then runs
   lint/typecheck/test/build. Foreground because WP-B reads its output.
2. **WP-B second (smoke validate, foreground).** Operator-style agent
   pushes to dev Convex, fires a 5–10 match harness pass at
   concurrency-1, runs `harness/diagnostics.ts --last <N>` and the
   two `convex run turns:getAgentTurn` spot-checks, attests the
   success-criteria checklist in a brief note under this README (no
   persisted closing report).
3. **No UAT in replay UI.** User has confirmed data-side smoke is
   sufficient (assignment "Out of scope" §). Skipping the
   browser pass is intentional.
4. **No completion review, no closure record.** This is below the
   phase-closing bar — a substrate follow-up slice tracked as a phase
   folder only for documentation continuity. If WP-B uncovers a
   regression the spec returns to WP-A; otherwise the slice closes
   when the WP-B checklist is green.

## 9. References

- `docs/project/spec/mental-model.md` §6 pillar 8 (the principle).
- `docs/project/spec/mental-model.md` §16 phase-7 substrate addendum
  (the empirical trigger and "implementation is a follow-up substrate
  slice" framing).
- `docs/project/spec/context-payload-iter-3-intent.md` (predecessor —
  what was stripped, what was bet on Pillar 4, why it was halfway).
- `docs/project/phases/07-context-payload-iter-3/` (phase-7 work
  packages — useful for cross-referencing the projection touchpoints).
- `convex/llm/inputBuilder.ts:374-411` — the `buildVisibleObject`
  insertion point.
- `convex/engine/resolution.ts:737-740` (chest), `:808-816` (corpse) —
  the spent-flip sites.
- `convex/engine/validation.ts:95-99` — the validator's vision use
  (load-bearing for the cucumber path).

## 10. WP-B Smoke Attestation — 2026-05-13

Command: `npm run harness -- --runs 5 --concurrency 1 --reasoning low --seed-prefix phase8-smoke-20260513T160513Z`

Fresh match IDs: `j978reb3sms1xzscvy5b8gk5as86m930`, `j97ab4zhrjj1pdqg0ysh6z069x86m2qg`, `j97acrd8kjjp1ky411ks9209zs86m3yc`, `j979drqrqd4sm7w9af62yatm8986mqvd`, `j97cgzpjwpxndjc0eqz8jg4zms86mwp9`. Smoke result: 5 completed, 0 failed. The normal harness `closing-5` row was `jd7bw6rh0zgy3nvrsz9bc7y7ks86my1c`; no phase-closing driver was run.

Diagnostics command: `node --import tsx harness/diagnostics.ts --last 5 --format json --out /tmp/phase8-diagnostics.json`. Relevant counters over 5 matches / 250 turns / 1737 agent records: `mechanics.loot.chest.empty=0`, `mechanics.loot.chest.sameTurnCollision=0`, `mechanics.loot.corpse.drainedRepeat=0`; headline mechanics showed attacks landed `67`, deaths `14`, chest loot actions `49`, diagnostic chest opened/equipped `4/4`, corpse loot actions `10`, diagnostic corpse looted `2`, speech events `241`, wall-blocked moves `32`, and no match crashes.

Spot-checks used `npx convex run turns:getAgentTurn`. Chest: match `j978reb3sms1xzscvy5b8gk5as86m930`, character `j57bmkwgp758yw3hpfphkhebr186m9kc` (Trader), turn `6` after looting `Chest_53_54` on turn `5`: `Chest_53_54` was absent from `input.visibleStateDigest`, while `input.composedUserMessage` contained `You moved 1 NW, looted axe from Chest_53_54`. Corpse: same match/character, turn `45` after looting `Corpse_Opportunist` on turn `44`: `Corpse_Opportunist` was absent from `input.visibleStateDigest`, while `input.composedUserMessage` contained `You looted leather from Corpse_Opportunist`; final canonical `worldState.corpses[]` confirms that corpse contents were `{}`.

Caveats: Convex CLI in this workspace takes positional JSON args rather than `--json`. The diagnostics CLI's `loot.chest.opened/equipped` and `loot.corpse.looted` counters are feed-based and lower than the raw resolution-action scan, but the assignment's regression counters and headline smoke criteria were green.
