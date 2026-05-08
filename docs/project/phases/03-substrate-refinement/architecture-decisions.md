# Phase 03 — Architecture Decisions

> Decisions this phase makes that supersede phase-1 ADRs §4 and §7, plus
> new contracts the substrate-refinement work needs. Each is an
> ADR-shaped block: decision, rationale, alternatives, consequences.
> Stable for the duration of the phase.

This phase explicitly invalidates two phase-1 ADRs:

- **Phase-1 ADR §4** — the locked decision schema (interact/loot split,
  `overwatch_priority` string field). Phase-3 ADR §1 below replaces it.
- **Phase-1 ADR §7** — the trace shape (no `reasoning` field on
  `agentRecord.llm`). Phase-3 ADR §2 below extends it.

Phase-1 ADRs remain as the historical record of what was true at phase-1
closure. The phase-3 ADRs are authoritative going forward.

---

## 1. Decision schema — unified loot, structured overwatch stance

**Decision.** Replace the phase-1 decision schema with the following
shape (the diff is described inline; see `convex/llm/decisionTool.ts`,
`convex/schema.ts`, and `convex/engine/types.ts` for the canonical
implementations once WP-A lands):

```ts
type ParsedDecision = {
  consume: "none" | "heal" | "speed";
  primary: "move" | "stationary_action" | "overwatch";
  move: MoveDecision;          // unchanged: 6-arm union
  action: ActionDecision;      // CHANGED: 3-arm union (was 4-arm)
  say: string | null;          // unchanged
  overwatch_stance:            // NEW (replaces overwatch_priority)
      "offensive" | "defensive" | null;
  scratchpad_update: string | null;  // unchanged
  rationale?: string | null;   // CONDITIONAL — added iff WP-A.1 probe
                               //  shows Azure does not expose
                               //  reasoning text in output[]
};

type ActionDecision =
  | { kind: "loot"; targetId: string }   // CHANGED: unifies interact+loot
  | { kind: "attack"; targetCharacterId: string }
  | { kind: "none" };
```

**Diff vs phase-1 ADR §4:**

| Field | Phase-1 | Phase-3 |
|---|---|---|
| `action.kind` set | `attack \| interact \| loot \| none` | `attack \| loot \| none` |
| `loot.targetCorpseId` | `string` (corpse character id) | renamed `loot.targetId` (string, accepts chest_NNN OR Player_N) |
| `interact.targetObjectId` | `string` (chest id) | DELETED |
| `overwatch_priority` | `string \| null`, max 80 chars | DELETED |
| `overwatch_stance` | not present | NEW: `"offensive" \| "defensive" \| null`; required when `primary === "overwatch"`, null otherwise |
| `rationale` | not present | CONDITIONAL: `string \| null`, max 280 chars, present only if WP-A.1 probe shows Azure doesn't expose reasoning text |

**Engine dispatch on `loot.targetId`** — `convex/engine/resolution.ts`
inspects the id namespace:

- starts with `chest_` → dispatches to the chest-open path (formerly
  `kind: "interact"`).
- starts with `Player_` → dispatches to the corpse-loot path (formerly
  `kind: "loot"`).
- anything else → `result: "no_target"` trace entry.

**Rationale.**

- The user's read after stepping through replays: agents emit
  `overwatch_priority` decoration the engine ignores. Removing the field
  and replacing it with `overwatch_stance` makes the choice
  *load-bearing* in the engine — defensive vs offensive resolves to
  different counter-fire / first-in-range behaviour (see ADR §3).
- The `interact` / `loot` split was a conceptual distinction the engine
  enforced via two separate resolution paths but the model had to learn
  *which target id goes with which kind* — a friction point that
  produced safe-default fallbacks. Unifying to a single `loot` action
  with id-namespace dispatch lets the model copy the visible id
  verbatim (`chest_005` from the digest → `loot.targetId: "chest_005"`)
  without picking the right `kind` literal.
- The `rationale` field is the **fallback contract** if Azure doesn't
  expose reasoning text. The user's substrate goal is "see the chain of
  thought"; if the model can be asked to produce a one-line rationale in
  the same tool call, the diagnostic loop works regardless of what the
  reasoning items API does. WP-A.1's probe decides which path applies.

**Alternatives considered.**

- *Keep `interact` and `loot` separate.* Rejected — phase 1's
  84.5% safe-default rate root-caused to schema friction; the user's
  read in mental-model.md §11 explicitly endorses unification.
- *Make `overwatch_stance` a free-form string with model-authored
  intent.* Rejected — that's a return to `overwatch_priority`. The
  point of this break is that the engine reads the field.
- *Add a third stance ("ambush", "hold-fire").* Rejected — out of scope
  for the substrate refinement, and the two-state choice maps cleanly
  to the user's mental model ("camp aggressively" vs "wait for them
  to commit").
- *Always add `rationale`, regardless of probe outcome.* Rejected —
  if Azure does expose reasoning text, the model emitting a redundant
  rationale costs tokens for no gain. Probe-then-decide is cheaper.

**Consequences.**

- `convex/llm/decisionTool.ts` Zod + JSON Schema rewrite. Structural-
  equivalence asserts updated.
- `convex/schema.ts` `decisionValidator` rewrite; POC schema wipe.
- `convex/engine/resolution.ts` action switch updated for the new
  3-arm union; loot dispatch by id namespace; defensive overwatch
  uses `overwatch_stance`.
- `convex/engine/validation.ts` (semantic validator) updated for the
  new ids and stance.
- `personas/*.md` re-read for vocabulary alignment — likely no edits
  needed (personas don't reference `interact`/`overwatch_priority`).
- All `tests/engine/*` and `tests/llm/*` tests touching the schema get
  rewritten in WP-A and WP-B.
- The replay UI's `decisionEnglish.ts` updates to render the new
  vocabulary (WP-D).

---

## 2. Reasoning capture — extend `agentRecord.llm` with a `reasoning` field

**Decision.** Add a new field `reasoning: string | null` to
`agentRecord.llm` per the trace shape locked in phase-1 ADR §7. The
field stores reasoning text extracted from the Azure Responses API
output[] when available; populated as `null` on fallbacks
(safe-default) and on responses that don't include reasoning items.

**Source of `reasoning` text** — branch on WP-A.1 probe:

- **Branch A (Azure exposes reasoning items in output[]).** Extract
  reasoning text from `output[].type === "reasoning"` items (or whatever
  the actual Azure-deployment shape turns out to be). Sanitise + truncate
  to ≤ 4 KB before persistence.
- **Branch B (Azure does not expose reasoning text).** `agentRecord.llm
  .reasoning` is always null. The substrate-supplied alternative is the
  `decision.rationale` field (ADR §1) the model fills in alongside the
  tool call. Replay UI's raw-pane shows `agentRecord.llm.reasoning ??
  agentRecord.decision.rationale ?? "(no reasoning captured)"`.

The probe (WP-A.1) is a small 1-call test that posts a per-turn-shape
request to the dev deployment with `reasoning.effort: "low"` and dumps
`response.output[]` to a JSON file. The branch decision is recorded in
`de-risking.md` D-P3-1 once the probe completes.

**Rationale.**

- Phase 1's gate-1 review surfaced that token counts alone don't satisfy
  the user's pillar-4 explainability goal. The user wants to *read* the
  chain of thought, not just count its tokens.
- Perplexity research (2026-05-08): Azure docs and community reports
  suggest reasoning text is hidden by default on Azure's Responses API
  deployments — only `usage.output_tokens_details.reasoning_tokens`
  is exposed. This is contradicted by some OpenAI-direct API examples
  (`{type: 'reasoning', summary: [{...}]}`). The probe resolves the
  uncertainty empirically against THIS deployment.
- Persisting either reasoning text or a model-authored rationale gives
  the replay UI's raw-pane a useful third section. Without one of them,
  the raw-pane is just (LLM input, tool call) — interesting but not
  load-bearing for inferring *why* the model made a choice.

**Alternatives considered.**

- *Always store both fields.* Discussed under ADR §1; rejected on token
  cost grounds when reasoning text is freely available.
- *Reconstruct reasoning post-hoc by re-running the call with verbose
  reasoning enabled.* Rejected — non-deterministic, expensive, and
  defeats the trace's "ground-truth what-the-model-saw" guarantee.
- *Skip the reasoning channel entirely.* Rejected — the user's stated
  intent (north star + mental-model.md §11) is to make pillar 4
  attainable.

**Consequences.**

- `convex/schema.ts` `agentLlmValidator` adds `reasoning: v.optional(
  v.string())` (or `v.union(v.string(), v.null())`).
- `convex/llm/azure.ts` `CallResult.raw` adds a `reasoning` field
  (string | undefined). The wrapper extracts it on success when
  Branch A applies; sets it to undefined on every failure path and on
  Branch B.
- `convex/runMatch.ts` persists `reasoning` into the agent record.
- `apps/replay/src/components/ExpandModal.tsx` raw-pane reads from
  `agentRecord.llm.reasoning ?? agentRecord.decision.rationale ?? null`.
- `apps/replay/src/components/TurnFeed.tsx` shows a small indicator
  ("🧠" or character count) when reasoning is present, to make the
  raw-pane affordance discoverable.

---

## 3. Overwatch stance semantics — defensive counter-fire pass and offensive first-in-range

**Decision.** The engine resolves `primary === "overwatch"` based on
`overwatch_stance`:

- **`overwatch_stance: "defensive"`** — counter-fires once per attacker
  who hits the overwatcher this turn, bounded by the overwatcher's
  weapon range at counter-fire time. Counter-fires are batched into the
  *same* simultaneous-attacks pass as the original attacks (no separate
  phase). Mutual-damage entries appear in `resolution.actions[]` with
  `kind: "overwatch"`, `fromOverwatch: true`, and `result: "dmg N"`
  (or `"out_of_range"` if the attacker is outside the counter-fire
  range).
- **`overwatch_stance: "offensive"`** — fires on the FIRST VALID
  IN-RANGE VISIBLE ENEMY after move resolution. Current
  nearest-then-id ordering is acceptable; "first in range" is the
  stable contract. Behaviour is unchanged from phase 1 *except* that
  the field name is now structured.
- **`overwatch_stance: null`** when `primary !== "overwatch"`. The
  schema rejects any decision where stance disagrees with primary.

**Counter-fire range bounding** — defensive overwatch counter-fires only
against attackers within the overwatcher's weapon range
(`weaponRange(overwatcher.equipped.weapon)`) at the moment of
resolution. Out-of-range attackers do not draw counter-fire (the
overwatcher cannot reach them); the trace records the attempt with
`result: "out_of_range"` so the diagnostic loop sees the gap.

**Reveal contract** — defensive overwatch counter-fire reveals the
overwatcher per the existing reveal-on-fire rule, exactly as offensive
overwatch does. Hidden-while-defensive is a real strategic option only
when no attacker triggers the counter-fire.

**Rationale.**

- Phase 1's overwatch was offensive-only and silent on multi-attacker
  scenarios. The user's stepping-through-replays read: agents who
  commit to overwatch get bullied by gang-attacks because they only
  fire back at one enemy. Defensive counter-fire-per-attacker addresses
  this.
- Same-pass batching preserves the simultaneous-resolution invariant.
  A separate counter-fire phase would create a "second action volley"
  the rest of concept-spec §23 doesn't sanction.
- Range bounding is non-negotiable — every other attack is range-checked,
  and counter-fire must be too. The trace entry on out-of-range
  counter-fire attempts is what makes the bounding *visible* in the
  diagnostic loop.

**Alternatives considered.**

- *Counter-fire all attackers, no range bound.* Rejected — breaks the
  range invariant.
- *Counter-fire one attacker (highest damage / nearest).* Rejected —
  the user's stated intent in mental-model.md §11 is "ONCE PER ATTACKER",
  not "once per turn".
- *Defensive-vs-offensive as a flag on the action arm rather than a
  separate field.* Rejected — adds a 4th overwatch-shaped arm to the
  union; less clean than a sibling enum.

**Consequences.**

- `convex/engine/resolution.ts` adds a counter-fire pass inside phase 5
  (action). The pass collects attacks AGAINST defensive overwatchers,
  enqueues range-checked counter-fires, and includes them in the same
  `applyDamage` batch. Test cases enumerate the multi-attacker
  scenarios.
- `convex/engine/validation.ts` adds a stance/primary consistency check.
- `concept-spec.md` §11 is updated to reflect the structured stance and
  defensive counter-fire rule (the existing prose is loose enough to
  fit, but the explicit rule needs to land in spec).

---

## 4. Drained-corpse semantics — engine emits a trace entry and digest marks `[drained]`

**Decision.** When an agent's `loot` action targets a corpse with no
remaining slots, the engine emits a trace entry:

```ts
trace.actions.push({
  characterId: actorId,
  kind: "loot",
  target: corpseId,
  result: "empty",   // NEW result string
});
```

Phase 1's `resolution.ts` silently `continue`s on drained corpses — that
is the bug. The new behaviour is: every loot attempt produces a trace
entry, with `result` ∈ `{ "looted", "empty", "no_corpse",
"out_of_range" }`.

The visible-state digest renders empty corpses with a `[drained]`
bracket and sorts them *after* non-drained corpses within the same
distance band, so the closest-N selection prefers loot-able corpses.
Empty corpses still appear (for last-known map-awareness) but the
visual bracket telegraphs no-loot.

**Rationale.**

- The North Star calls this out as a load-bearing fix: "agents loot
  drained corpses repeatedly because the engine silently skips the
  action (no trace entry → digest carries no signal)".
- The trace entry feeds two downstream consumers: (a) `decisionEnglish
  .ts` renders "tried to loot Player_5 — empty"; (b) the closing-10
  metric "drained-corpse repeat rate" reads from this signal directly.
- Sorting drained corpses last (within their distance band) prevents the
  cap-size-8 visible list from pushing live characters or live corpses
  out in favour of drained ones. The digest stays useful.

**Alternatives considered.**

- *Suppress drained corpses entirely from the digest.* Rejected — they're
  still navigation landmarks (the agent might want to remember "I
  looted Player_5 already; their corpse is at (12, 34)"). Brackets
  preserve the position info while signalling no-loot.
- *Add a `drained: true` field to the corpse object in worldState.*
  Considered — the schema impact is small. Decided against because the
  engine already knows a corpse is drained iff `corpse.contents` has no
  weapon/armour/consumable. No schema diff is needed; the digest reads
  the existing data.

**Consequences.**

- `convex/engine/resolution.ts` loot-resolution path adds the
  `result: "empty"` emit.
- `convex/llm/inputBuilder.ts` adds the `[drained]` bracket and the
  sort-after-non-drained rule.
- `apps/replay/src/lib/decisionEnglish.ts` adds `result: "empty"` to
  the result-string vocabulary table (per phase-2 ADR §5 carryover).
- The closing-10 report aggregator counts drained-corpse repeats from
  the trace.

---

## 5. Walls in the digest — emitted within vision range, sorted last, no cap

**Decision.** `convex/engine/vision.ts:computeVisibleEntities` emits
`{ kind: "wall", pos: {x, y} }` entries for every wall tile within
Chebyshev 20 of the observer, with line-of-sight unchecked (walls
themselves are the LOS blockers; if the observer can see *through* them
they would not be a wall — but for emission purposes, walls within
vision range are visible regardless of LOS).

The visible-entity digest emits walls in a separate sort band: the
8-cap (`VISIBLE_ENTITY_CAP`) applies to characters/chests/corpses/cover
*first*; walls are appended *after* the cap, unbounded but with a per-
turn safety ceiling of 12 walls (well above the count emitted by the
reference map within any 20-tile vision sphere).

The `Wall_X_Y` id used in the bullet is positional (no schema
contribution) — agents reference walls by position only, never as
movement / action targets, so no id namespace is needed.

**Rationale.**

- Phase 1's vision.ts head-note acknowledged that walls aren't emitted —
  the user's stepping-through-replays read identified this as a root
  cause for agents repeatedly trying to move through walls. The fix is
  trivial in the engine; the work is in the digest's ordering and the
  system prompt's vocabulary (Wall bullets need to teach the model
  "this is terrain you can't move through").
- Sorting walls last keeps the pre-existing visual contract: characters
  → chests/corpses → cover (terrain) → walls. The 8-cap continues to
  prefer actionable entities.
- The 12-wall safety ceiling exists because pathological vision
  positions (e.g. an agent in a corner of the wall maze on the
  reference map) could in principle expose more walls than is useful.
  The reference map's wall density never approaches this ceiling; the
  cap is a defensive guardrail.

**Alternatives considered.**

- *Cap walls at 8 share the visible cap.* Rejected — characters and
  loot would be evicted by walls in dense terrain, exactly the
  situation where seeing both is most useful.
- *Emit walls only when the agent's last-turn move was wall-blocked.*
  Rejected — the model can't anticipate wall blocks the first time it
  encounters one. Always-on emission is simpler and the cost is bounded
  by the 12-wall ceiling.

**Consequences.**

- `convex/engine/vision.ts` emits walls (currently filtered out per the
  exhaustive switch in `inputBuilder.ts:renderVisibleBullet` line 167-172
  — that branch is already wired in, just not reachable).
- `convex/llm/inputBuilder.ts` adds the wall-tier sort to the digest's
  visible-bullet builder.
- `tests/engine/vision.test.ts` adds wall-emission cases.
- `tests/llm/inputBuilder.test.ts` adds wall-rendering cases and the
  sort-after-cap behaviour.

---

## 6. Per-turn input shape — Last turn (you) line, observation brackets, no Affordances

**Decision.** The per-turn input is rebuilt to the shape locked in
North Star §1:

```
You: at (X,Y), HP/maxHP, weapon/armour/consumable, in evac zone
Last turn (you): <move outcome>, <action outcome>, <damage taken from
                 whom>, said "..."
Visible:
- Player_4, dist 7 S [HP~high, holding axe, attacked Player_2]
- Chest_005, dist 6 SE [opened]
- Corpse_Player_5, dist 9 S [axe + leather]
- Cover_32_32, dist 4 SE
- Wall_40_34, dist 1 S
- Evac, dist 12 SE
```

**Removed sections** (vs phase-1 digest):

- `Affordances:` — DELETED. The system prompt teaches the action
  grammar; per-turn affordance lists were a band-aid for that teaching
  gap.
- `Heard (last turn):` — DELETED. Last-turn speech is folded into the
  Visible per-character observation brackets (`said "..."`).
- `Last-known:` — DELETED. Last-known map memory is the agent's job
  via scratchpad; the system prompt teaches the contract.
- `Evac:` — DELETED as a separate section. Evac appears as a singleton
  Visible bullet (`Evac, dist 12 SE`) once revealed.

**Added content:**

- `You:` line gains `in evac zone` (or `not in evac zone`) suffix
  *only after evac is revealed*. Before turn 30, the suffix is absent.
- `Last turn (you):` line — populated at runMatch time from the previous
  turn's resolution (move outcome derived from `resolution.moves[]`,
  action outcome from `resolution.actions[]` for this character,
  damage-taken-from from incoming `resolution.actions[]` of `kind:
  "attack"` / `kind: "overwatch"` against this character, said-text
  from `resolution.speech[]`). On turn 1 (no previous turn), the line
  is omitted.
- Per-Visible character bullets gain `[HP~bucket, holding <weapon>,
  observed-action]` brackets. The observed-action component is collected
  at runMatch time from the previous turn's resolution filtered by
  what THIS observer could see.

**Sort order** within the Visible section:

1. Living characters (closest first, ties → id ASC).
2. Chests/corpses (closest first; `[drained]` corpses sort after
   non-drained at equal distance).
3. Cover/walls (closest first; walls last per ADR §5).
4. `Evac` singleton (always last).

The 8-cap (`VISIBLE_ENTITY_CAP`) applies to category 1+2 (living
characters + chests/corpses) only. Cover, walls, and Evac are
unbounded except for the ADR §5 wall safety ceiling.

**Rationale.**

- Per North Star §1 — locked design decision; do not re-litigate.
- The user's read in mental-model.md §11: phase-1's prompt design
  treated the 5 input slots (system / persona / scratchpad / digest /
  tool) as independent. The new shape treats them as one rolled
  context. The digest leans on the system prompt for grammar; the
  system prompt teaches the digest's vocabulary. Affordances become
  redundant.
- The `Last turn (you):` line is the load-bearing addition. Without it,
  the agent has no causal channel between turns — it's running blind
  on each turn, with the scratchpad the only memory. The line is
  short, structured, and machine-introspectable for the closing-10
  outcome-attribution metric.

**Alternatives considered.**

- *Render `Last turn (you):` as a bullet list rather than a single
  line.* Rejected on token-cost grounds; the line shape is ~30-50
  tokens vs ~80-120 for a 4-bullet block. The single-line shape is
  also more skimmable for the model.
- *Include `Last turn (others):` lines for every visible character
  the agent saw act last turn.* Considered — folded into the per-
  Visible observation brackets instead, which is the form locked in
  North Star §1.
- *Keep `Affordances:` as a fallback for very short personas.*
  Rejected per North Star §1 + mental-model.md §11.

**Consequences.**

- `convex/llm/inputBuilder.ts` rewrite. Existing
  `buildAffordanceLines`, `buildHeardLines`, `buildLastKnownLines`,
  `buildEvacLines` functions deleted; new `buildLastTurnLine` and
  observation-bracket logic added.
- `convex/runMatch.ts` collects last-turn observations per agent at
  start of each new turn (one read of the prior `turns` row).
- `convex/engine/affordances.ts` — DELETED.
- `tests/engine/affordances.test.ts` — DELETED.
- `tests/llm/inputBuilder.test.ts` rewrite for the new digest shape.

---

## 7. System prompt — full rewrite as schema teacher

**Decision.** `convex/llm/systemPrompt.ts` is rewritten under a new
section ordering:

1. **Identity + tool-name reminder** — "You are an extraction-arena
   agent. Emit one tool call to `decide_turn` per turn."
2. **How to read Visible** — terminology key: typed ids
   (`Player_N`, `Chest_NNN`, `Corpse_PlayerN`, `Cover_X_Y`,
   `Wall_X_Y`, `Evac`); `dist` + 8-octant bearing; per-character
   observation brackets and what they mean.
3. **How to act on Visible** — the action grammar:
   - Move: `relative dx,dy` (bounded), `toward_entity Player_N`,
     `away_from_entity Player_N`, `toward_object <id>`,
     `toward_evac`, `none`.
   - Action: `loot <Visible.id>` (chests OR corpses; same kind),
     `attack Player_N`, `none`.
   - Overwatch: set `primary: "overwatch"`, set `overwatch_stance`
     to `"offensive"` or `"defensive"`. Action must be `none`.
4. **Match shape + urgency framing** — 50 turns; turn 30 reveals evac;
   turn 50 extracts living agents in the 3×3 evac zone. **Outside
   evac at turn 50 → incinerated.**
5. **Output discipline** — concrete targets only (no predicates),
   safe-default replaces invalid choices.
6. **Persona deference** — the persona body that follows is your
   character.

The schema literals are presented as a *consequence* of the teaching
block, not a separate reminder.

**Token budget** — target ≤ 500 tokens (chars/4 proxy). Phase-1's
system prompt was ≤ 400 tokens; the new prompt is denser (more
teaching) and the +100-token allowance is the budget headroom from
deleting the `Affordances:` digest section.

**Rationale.**

- Per North Star §2 — locked design decision.
- The `Affordances:` block was a band-aid for the system prompt not
  teaching the digest's shape. With the prompt rewritten as schema
  teacher, the band-aid is unnecessary.
- The "outside evac at turn 50, you're incinerated" framing is
  load-bearing for the urgency loop — it's the single biggest driver
  of late-game decisions, and phase-1's prompt didn't surface it
  bluntly enough.

**Alternatives considered.**

- *Keep the prompt terse and rely on the persona to teach grammar.*
  Rejected — personas are 80 tokens; they can't carry teaching weight
  for the schema.
- *Add a "few-shot" example of a complete decision.* Considered, then
  rejected on token-cost grounds. The schema-literals reminder
  embedded in the action-grammar block is enough.

**Consequences.**

- `convex/llm/systemPrompt.ts` rewrite.
- `tests/llm/inputBuilder.test.ts` token-budget assert covers the
  composed input including the new system prompt.
- The trace's `systemPromptHash` changes (a different hash from phase
  1). Historical traces are invalidated by the POC schema wipe anyway.

---

## 8. Concept-spec source-of-truth diff

**Decision.** WP-A includes targeted edits to
`docs/project/spec/concept-spec.md` for the §s impacted by the schema
break:

- **§11 (Overwatch)** — replace the "overwatch priority" prose with
  the structured stance (offensive / defensive). Add the defensive
  counter-fire rule.
- **§13 (Gear and loot)** — clarify that the engine's action vocabulary
  unifies chest open and corpse loot under a single `loot` action; the
  conceptual distinction in prose remains accurate.
- **§21 (Agent output shape)** — replace `overwatch_priority` with
  `overwatch_stance` in the example output shape.

The concept-spec is the why-layer for engine semantics; it must reflect
the new contract. Other §s remain accurate.

**Rationale.**

- `architecture.md` §4 says "the schema is the contract; runtime is
  swappable." The concept-spec defines the rules the schema
  implements; if the schema changes, the spec describes the new rules.
- Reviewers reading the spec post-phase-3 should see consistent
  semantics; out-of-date prose creates compounding confusion in
  later phases.

**Consequences.**

- `concept-spec.md` ships a v0.2 with the §11/§13/§21 edits.
- A note at the top of the file points to phase-3's
  `architecture-decisions.md` for the schema rationale; the spec
  itself stays implementation-free.

---

## Changelog

- **2026-05-08, v1.0** — Initial. Locks ADRs §1–§8.
