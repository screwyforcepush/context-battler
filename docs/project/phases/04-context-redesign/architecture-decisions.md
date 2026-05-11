# Phase 04 — Architecture Decisions

> Decisions this phase makes that extend phase-3 ADRs §1–§9 with the
> per-turn-context redesign + diagnostic bundle. Each is an ADR-shaped
> block: decision, rationale, alternatives, consequences. Stable for the
> duration of the phase.
>
> The **canonical source of truth on prose and structure** is the user-
> hand-crafted intent anchor at `docs/project/spec/per-turn-context-
> intent.md`. The ADRs below codify how the intent lands in code without
> re-deciding what the intent is.

The phase-3 ADRs (§1 decision schema unify, §2 reasoning capture, §3
overwatch stance attribution, §4 drained corpse trace, §5 walls in
digest, §6 per-turn input shape, §7 system prompt, §8 concept-spec edits,
§9 blocked-move trace) remain in force where they aren't superseded
below. Specifically:

- Phase-3 ADR §1 (3-arm action union, `overwatch_stance` field, no
  `interact` arm) — unchanged.
- Phase-3 ADR §2 (reasoning capture from `output[].type === "reasoning"`,
  required-nullable string) — unchanged.
- Phase-3 ADR §3 (overwatch `fromOverwatch` + `stance` on the action
  trace) — **extended** in §1 below with an additive `weapon?: string`
  field on the same array entries.
- Phase-3 ADR §6 (per-turn input shape — You: / Last turn (you) /
  Visible) — **superseded** in §4 below by the new sectioned ordering.
- Phase-3 ADR §7 (system prompt as schema teacher) — **superseded** in
  §2 below; the schema teaches itself via §3 description enrichment.

---

## 1. Trace surfaces for the global kill feed + faithful raw-pane (additive)

This phase lands **two** additive schema fields, both optional, both
backward-compatible with phase-3 trace rows. Together they avoid any
Convex wipe.

### §1a. Action-trace `weapon?: string` (kill-feed weapon name)

**Decision.** Extend `convex/schema.ts`'s `resolution.actions[]` validator
with an optional `weapon?: string` field. Emitted by
`convex/engine/resolution.ts` (and `convex/engine/combat.ts`) on every
entry whose `kind ∈ {"attack", "overwatch"}` AND whose `result` is a
damage outcome (i.e. `result.startsWith("dmg ")` or any future kill-
encoding result). The string is the **killer's equipped weapon name at
strike resolution time** — read from the killer's `equipped.weapon.name`
before any post-strike state mutation (death cleanup, equipment swap).

### §1b. Agent-input `composedUserMessage?: string` (raw-pane faithfulness)

**Decision.** Extend `convex/schema.ts`'s `agentInputValidator` with an
optional `composedUserMessage?: string` field. Populated by
`convex/runMatch.ts` from the inputBuilder's assembled phase-4 user
message (the persona body + `## previous turn` + `# Current Game State`
+ Visible-object output that is literally sent to Azure as the user
role's content). Phase-3 trace rows omit the field; phase-4 trace rows
carry it.

```ts
// convex/schema.ts — agentInputValidator
const agentInputValidator = v.object({
  systemPromptHash: v.string(),
  systemPromptText: v.string(),
  personaPromptHash: v.string(),
  personaPromptText: v.string(),
  visibleStateDigest: v.string(),       // narrows in phase-4 to Visible body only
  scratchpadBefore: v.string(),
  composedUserMessage: v.optional(v.string()),  // PHASE-4 ADR §1b — NEW
});
```

The raw-pane reads `composedUserMessage` verbatim when present
(phase-4 traces); falls back to phase-3 client-side composition
(`systemPromptText` + wrapped persona + scratchpad + digest) when
absent. A single `if (composedUserMessage) render verbatim; else legacy
compose` switch in `apps/replay/src/lib/rawPane.ts:composeFullLlmInput`
— no dual-shape detection branch needed.

**Owner.** WP-A.1 lands the schema additive (`agentInputValidator`
extension + `convex/_internal_runMatch.ts` mirror). WP-D.5 owns the
populate path in `runMatch.ts` (it assembles the userMessage anyway,
so writing it onto `agentRecord.input` is one line). WP-B reads the
field with the fallback switch.

### §1a continued — kill-feed renderer contract

For the kill-feed renderer's contract: given a death entry in
`resolution.deaths[]` on turn N, the killer is the `characterId` on the
matching `resolution.actions[]` entry (kind ∈ {attack, overwatch}, target
matches the deceased's `displayName`); the weapon is that entry's
`weapon` field.

**Kill-attribution rule (deterministic).** Combat resolution batches
damage: `convex/engine/resolution.ts:797-799` calls `applyDamage` in a
loop over the `attacks[]` array in iteration order. When multiple
attackers target the same victim on the same turn, **the killer is the
attacker whose `applyDamage` call pushed the victim's cumulative damage
across the HP=0 threshold (the first such entry in resolution order)**.
This is unambiguous because `attacks[]` iteration order is
deterministic (actor-id-sorted, overwatch counter-fires appended). The
kill-feed renderer walks `resolution.actions[]` filtering for
damage-result entries (`result.startsWith("dmg ")`), then for the
victim's death, identifies the first such entry whose cumulative damage
on that victim ≥ victim's HP-at-start-of-phase-5 — that entry's
`characterId` is the killer; that entry's `weapon` is the weapon.
WP-A.2 lands a unit test exercising the multi-attacker case.

```ts
// convex/schema.ts — resolutionValidator.actions[] entry
v.object({
  characterId: v.id("characters"),
  kind: v.string(),
  target: v.string(),
  result: v.string(),
  fromOverwatch: v.optional(v.boolean()),     // phase-3 ADR §3
  stance: v.optional(v.union(                  // phase-3 ADR §3
    v.literal("offensive"),
    v.literal("defensive"),
  )),
  weapon: v.optional(v.string()),              // PHASE-4 ADR §1 — NEW
})
```

The engine emit shape locks the **strike-time weapon**, not the
characters-table snapshot at end-of-turn. Resolution proceeds in phases
(per `concept-spec.md` §23); a death's body-loot pass may transfer the
weapon onto the corpse before the renderer runs. Persisting `weapon` on
the action entry sidesteps the reconstruction-from-state race entirely.

**Rationale.**

- The kill-feed line shape is `<killer> killed <victim> with <weapon>`
  per intent §3. The weapon is part of the broadcast.
- Reconstructing the killer's weapon from `characters.equipped` at render
  time is racy (post-kill cleanup can move it), state-dependent (the
  killer may have swapped between strike and render), and adds renderer-
  side knowledge of engine ordering. Single-emit at strike time is the
  honest source.
- Additive optional field: historical rows validate without migration;
  new rows carry the field. No POC wipe required.
- The kill-feed also surfaces the seam for phase-5+ cursed-item flavour
  text (pillar 5: text is terrain). When weapon names start carrying
  in-world text, the existing field is the carrier.

**Diff vs phase-3 ADR §3.** Phase-3 ADR §3 added `fromOverwatch?: boolean`
+ `stance?: "offensive" | "defensive"` to action trace entries; that
contract is preserved unchanged. Phase-4 ADR §1 adds `weapon?: string`
as a third additive field on the same array; the three fields are
orthogonal (a defensive-overwatch counter-fire entry can carry both
`fromOverwatch: true`, `stance: "defensive"`, AND `weapon: "axe"`).

**Alternatives considered.**

- *Read killer's `equipped.weapon` at render time.* Rejected — race
  between strike-time and end-of-turn-render-time mutation. The corpse
  body-loot pass per phase-3 ADR §4 moves equipment to the corpse before
  the renderer runs; reading post-cleanup gets the wrong answer.
- *Add a separate `kills[]` array to the resolution validator with
  `{killer, victim, weapon}` triples.* Rejected — `resolution.deaths[]`
  + the matching action entry already encode the (victim, killer)
  pairing. Adding a third array is a denormalised second source of
  truth; phase-3's contract-drift pattern (D24/D36/H1 — fixed downstream
  artefacts reading pre-fix shapes) makes any new denormalised emit a
  liability. Augmenting the existing actions array is the minimum
  delta.
- *Render the kill feed from the prior-turn characters-table snapshot
  rather than from a persisted weapon field.* Rejected — same race as
  above, and the characters table is mutated in-place by the engine
  pipeline (not snapshotted per-turn), so there is no prior-turn
  equipped value to read.

**Consequences.**

- `convex/engine/combat.ts` (the producer of attack-result entries) and
  `convex/engine/resolution.ts` (the producer of overwatch counter-fire
  entries and offensive overwatch entries) both need the emit-weapon
  hook. WP-A.2 lands both call sites in one bundle.
- **`convex/runMatch.ts:adaptResolutionForSchema` (lines 456–576)** is
  the persistence adapter that maps engine `ActionTraceEntry` shape to
  the Convex validator shape, currently mirroring `fromOverwatch` and
  `stance` via conditional spread. WP-A.2 extends the same adapter with
  the same conditional-spread idiom for `weapon`. This is the same
  seam class that produced the phase-3 D24/D36/H1 drift (adapter
  dropped new fields silently when not updated in lockstep with the
  schema); WP-A scope **explicitly** names this file to make the
  dependency load-bearing in the work package.
- `convex/llm/inputBuilder.ts`'s `PrevTurnRow` type gains a (read)
  reference to the prior turn's `actions[].weapon` field on attack and
  overwatch entries (it's already reading other fields off the same
  array for the Last-turn-you line) — wiring is purely additive.
- `convex/reports/phase3.ts` aggregator is unaffected — the existing
  metrics don't depend on the weapon string. Phase-4's no-op rate
  metric (WP-G) is also weapon-independent.
- The `resolutionValidator` change is backward-compatible (Convex
  `v.optional` accepts both present and absent); no wipe; the
  `tests/integration/persistAdaptParity.test.ts` parity test extends
  naturally to the new field.
- **`agentInputValidator` change (§1b)** is also `v.optional` —
  phase-3 trace rows continue to validate (the field is absent and the
  raw-pane falls back to the legacy compose path); phase-4 trace rows
  carry the field and the raw-pane renders it verbatim. No dual-shape
  detection branch in the UI — a single presence check is enough.
- WP-D narrows `visibleStateDigest` to the Visible-object body only
  (per ADR §4 consequences). Phase-3 stored "You: + Last-turn-you +
  Visible bullets" in the field; phase-4 stores just the Visible
  keyed-object body. With `composedUserMessage` present, the raw-pane
  doesn't need to re-assemble from individual fields anyway.

---

## 2. System prompt slim contract (supersedes phase-3 ADR §7)

**Decision.** Replace the phase-3 system prompt (`convex/llm/systemPrompt
.ts`, ~480 chars, ~120 tokens at chars/4 proxy) with the user's hand-
crafted slim version per intent §1. Verbatim authoring constraint:

```
You are an extraction-arena agent. Each turn, emit ONE tool call to `decide_turn`.

Match shape:
- 7 other agents competing for the prize pool.
- 50 turns. Turn 30 reveals evac zone. Turn 50 extracts living agents inside the 3×3 zone and splits the prize. Outside evac at turn 50 you are incinerated.
- Walls block LOS and movement; cover hides you from other agents' vision (revealed by enemy within 2, attacking, speaking, looting, consumable, or leaving cover).
```

**Deliberately deleted from the phase-3 prompt:**

- `How to read Visible:` section (typed-id glossary, dist+bearing
  semantics, bracket vocabulary) — Visible is now a self-descriptive
  keyed object per ADR §4 / intent §4.
- `How to act on Visible:` section (move arms, action arms, overwatch
  stance teaching) — relocated to tool-schema `description` fields per
  ADR §3 / intent §5.
- `Output discipline:` section, including the load-bearing prompt-
  hygiene leak: `Invalid choices are replaced with the safe default (do
  nothing).` This line is the headline acceptance B bug. See ADR §3
  consequences for the hygiene-guard test contract.

**Deliberately added to the phase-3 prompt:**

- Stakes framing: "7 other agents competing for the prize pool" — sets
  social stakes up front (was implicit in phase-3).
- Cover affordance: cover hides you from other agents' vision, plus the
  five reveal triggers from `convex/engine/hiding.ts:30-36` (enemy
  within 2, attacking, speaking, looting, consumable, leaving cover).
  Phase-3 told the model what cover *doesn't* do; this finally tells it
  what cover *does*.
- Walls block movement: phase-3 covered this implicitly via the
  `blockedBy: "wall"` Last-turn line; phase-4 states it in the prompt.

**Token target:** ≤ 200 tokens (chars/4 proxy ≤ 800 chars). Asserted in
`tests/llm/systemPrompt.test.ts`.

**Rationale.**

- The user's intent anchor §1 is the contract. Phase-3 ADR §7 framed the
  system prompt as "schema teacher" — that framing made sense before the
  tool-schema descriptions were honest carriers. Once ADR §3 fixes that
  carrier, the system prompt's job collapses to "stable rules-of-the-
  game spoken by the referee" — exactly the slim shape intent §1
  prescribes.
- Two encodings of the same contract (English in system prompt + JSON
  Schema in tool spec) is a phase-3 drift seam. Removing the English
  mirror cuts ~300 tokens off the request body and removes the drift.
- The `Output discipline` line teaches the model that nonsense has a
  graceful fallback — exactly backwards. Per memory
  `feedback_prompt_hygiene_no_fallback_leak`: prompts must not tell the
  model that invalid output gets safe-defaulted; that teaches a graceful
  fallback exists. Downstream safe-defaulting stays downstream.

**Alternatives considered.**

- *Keep the phase-3 schema-teacher shape and add a "stakes" line on
  top.* Rejected — the user's intent anchor §1 is hand-crafted to the
  slim shape, and the schema-teacher framing IS the problem (two
  encodings).
- *Move the deleted English sections into the tool-schema descriptions
  verbatim.* Rejected — intent §5 prescribes "self-descriptive" tool
  descriptions, not English-mirror dumps. WP-C authors fresh
  description prose at description-appropriate length.
- *Keep the `Output discipline` line and append "but you should never
  rely on this".* Rejected — the line teaches the safe-default exists.
  Any version of "but" is a softening that the model is free to
  discount. The honest fix is to delete the leak.

**Consequences.**

- `tests/llm/systemPrompt.test.ts` is rewritten to assert:
  - The three deleted section headings are absent.
  - The four hygiene-leak phrases are absent (see ADR §3 consequences).
  - The slim verbatim shape is present (stakes, match-shape, walls/cover
    bullets).
  - The chars/4 budget cap (≤ 800 chars) is met.
- `tests/llm/integration.test.ts` refresh: phase-3's integration test
  imports `SYSTEM_PROMPT` verbatim; the import still works, but the
  digest-shape assertions it carries need updating to the new sectioned
  user message (ADR §4). WP-D covers the integration test refresh.
- The persona-deference line ("The persona body that follows is your
  character. Visible state is authoritative.") is removed — the persona
  body is rendered under the persona heading in the user message per
  ADR §4 / intent §2, and the framing is unambiguous without the line.

---

## 3. Tool-schema descriptions carry the action grammar (NEW contract)

**Decision.** Enrich the `description` field on `decide_turn` (top-level)
and on the five named properties of `parameters`, per intent §5. The
JSON Schema **shape** does not change — same 6-arm move union, same
3-arm action union, same `overwatch_stance` enum, same field set with
the same required list. Only the `description` strings change.

Authoring requirements per property (intent §5):

- **`decide_turn` (top-level)** — keep the phase-3 description's
  decision-bundle framing; augment with the overwatch-stance dual
  contract (overwatch_stance required when primary='overwatch', null
  otherwise — already in the description, but make the prose carry the
  load-bearing semantics rather than relying on the model to infer
  from the enum union).
- **`move` property** — add the 6-arm grammar verbatim: `relative dx,dy`
  (integers in [-12,12]); `toward_entity Player_N`; `away_from_entity
  Player_N`; `toward_object <Chest_NNN|Corpse_Player_N>`;
  `toward_evac`; `none`. Plus the movement range: "Movement range max 8
  (12 w/ speed)".
- **`action` property** — add the 3-arm grammar: `attack Player_N`;
  `loot <Chest_NNN|Corpse_Player_N>` (copy id verbatim); `none`. Plus
  the range: "Attack/loot range 2 (Chebyshev)".
- **`primary` property** — describe the three values with the overwatch
  dual relationship: `move` resolves the move then the action from the
  new position; `stationary_action` resolves the action in place;
  `overwatch` commits to a reactive stance — set `overwatch_stance` to
  "offensive" or "defensive"; `action` MUST be `none` under overwatch.
- **`overwatch_stance` property** — describe the offensive/defensive
  semantics (offensive: fire on first valid in-range enemy after move;
  defensive: counter-fire each attacker, weapon-range bounded) and the
  null-when-not-overwatch contract.
- **`scratchpad_update` property** — the usage hint: "Use scratchpad for
  core memories and multi-turn objectives. ≤ 500 chars. Carries forward
  to next turn as `Scratchpad:` under `## previous turn`."

**Authoring constraints (locked):**

- **No `additionalProperties` change, no `required` change.** Phase-3
  WP-G.2 / D39 PM-lock pinned `required[]` to all 7 fields with the
  `schemaMirror` parity test; phase-4 must not regress it.
- **No safe-default leak.** No description field contains any of the
  hygiene-leak phrases (see consequences below).
- **No imperative voice that the system prompt should carry.** "Movement
  range max 8" is a schema property of the move arm; "Do not stand still
  if you can move" is a strategy directive that belongs in the persona,
  not the schema description.

**Vision range tunable — deliberate omission (locked).** Intent §1
relocates vision/movement/attack tunables off the system prompt and
onto the tool-schema property descriptions. Movement range lives on
`move`; attack/loot range lives on `action`. **Vision range
(Chebyshev 20)** does NOT have a corresponding tool-schema property
to attach to — there is no `vision` arm because vision is not a
decision the agent makes. Phase-4 leaves vision range UNSTATED in
both the slim system prompt AND the tool-schema descriptions. The
rationale: the Visible-object's typed-id glossary (`Player_N`,
`Chest_NNN`, etc.) and distance fields reveal vision-range
implicitly — the model sees exactly the entities within 20-Chebyshev
of its position, and the dist field bounds the answer. If a future
phase shows the model misjudging vision range (e.g. attempts to
`toward_entity Player_X` where Player_X is invisible because they
moved beyond range), pin vision range onto the `decide_turn` top-
level description as a one-line addendum. Until then: silent on
purpose.

**Rationale.**

- The JSON Schema is shipped on every request. Its `description` fields
  reach the model as part of the tool spec — the same surface the
  system prompt was duplicating in English. Lean into the schema's own
  contract rather than mirroring it.
- Drift between the English and the schema was a phase-3 maintenance
  burden (WP-G.2 corrected an asymmetry between Zod-required-7 and
  schema-required-4). Centralising the grammar on the schema side closes
  the drift seam.
- Token budget: the description-field tax is ~+100 tokens on the request
  body, but the system-prompt savings (~−300 tokens — ADR §2) net to
  ~−200 tokens per request even before the user-message redesign.

**Alternatives considered.**

- *Send a separate `## grammar` block in the user message.* Rejected —
  that's a third encoding, even worse than the two-encoding problem.
- *Embed grammar in each move/action arm's individual `description`
  rather than on the parent property.* Rejected — Azure's tool spec
  surfaces the property `description` more reliably than the
  per-arm-of-`oneOf` ones. WP-C may add per-arm descriptions as
  belt-and-suspenders if the WP-E bench shows the model misses the
  parent-level signal, but the contract lives at the parent level.

**Consequences.**

- `tests/llm/decisionTool.test.ts` extends with assertions on the
  description fields' content — at minimum, each enriched description
  must contain its load-bearing keywords (e.g. `move` description must
  contain `"relative"`, `"toward_entity"`, `"toward_object"`,
  `"toward_evac"`, `"none"`, and `"Movement range"`).
- **Prompt-hygiene guard** (load-bearing, acceptance B): a new test
  asserts that the strings `safe default`, `replaced with`, `invalid
  choices`, `fallback`, `do nothing` do NOT appear in either
  `SYSTEM_PROMPT` or any `decisionTool` description field. The check
  walks the schema's `description` fields recursively (top-level +
  parameters.properties.*.description) and asserts the negative match.
- The phase-3 `tests/llm/schemaMirror.test.ts` parity test continues to
  guard the `required[]` field-list alignment between JSON Schema and
  Zod; no regression risk on the schema shape.
- Persisted `agentRecord.input` shape is unaffected (the tool schema is
  shipped on the request but not persisted on the agent record). The
  replay UI reads the live schema from `convex/llm/decisionTool.ts` at
  render time per ADR §5.

---

## 4. Per-turn user message ordering (supersedes phase-3 ADR §6)

**Decision.** Replace the phase-3 user-message shape (`## Persona /
## Scratchpad / ## Visible state` wrapper in `convex/llm/azure.ts` +
flat digest body from `convex/llm/inputBuilder.ts`) with the user's
hand-crafted sectioned ordering per intent §2:

```
<persona body>

## previous turn
You: <move outcome>, <action outcome>, <damage from whom>, said "..."
Scratchpad: <prior-turn text>
<killer> killed <victim> with <weapon>
<...>

# Current Game State
Turn N, M/8 players alive
You: at (X,Y), HP/maxHP, weapon/armour/consumable[, in/not in evac zone]
Visible:
  <keyed-object format chosen by WP-E>
```

**Section semantics (locked, intent §2):**

- **Persona body** — rendered as-is (passed through from
  `personas/<id>.md`). No section header (the persona body IS the
  identity statement; a heading would compete with it). The persona
  body's own prose may use its own headings — that's the prompt
  author's choice.
- **`## previous turn`** — replaces the phase-3 `Last turn (you):`
  single line. Subsumes three sub-fields:
  - `You: <outcome fragments>` — same content as phase-3 last-turn-line
    (move outcome, action outcome, damage from whom, said). Renders
    `no-op` if every fragment is null.
  - `Scratchpad: <prior-turn text>` — the agent's own notes from the
    turn that just ended. Phase-3's `## Scratchpad` top-level section
    is **gone**; the scratchpad lives here under `## previous turn`,
    which removes the ambiguity against the `scratchpad_update` tool
    field (the two were textually similar in phase-3 but temporally
    distinct — the tool field is the agent's *write* for next turn;
    the user-message scratchpad is the agent's *prior write read back*).
  - **Global kill feed** — zero-or-more lines, one per kill event on
    the prior turn: `<killer> killed <victim> with <weapon>`. Drawn
    from `resolution.deaths[]` cross-referenced with the matching
    `resolution.actions[]` entry's `weapon` field per ADR §1.
    Suppressed on turn 1 (no prior turn).
- **`# Current Game State`** — top-level "snapshot now" header. The
  hierarchy difference (`#` for current state vs `##` for previous turn)
  is intentional: current state is the top-level grounding; previous
  turn is the secondary context that scopes it.
  - `Turn N, M/8 players alive` — match-meta line. Turn number was
    implicit in phase-3; alive count is new per intent §3.
  - `You: at (X,Y), HP/maxHP, weapon/armour/consumable[, in/not in evac zone]`
    — phase-3 You: line preserved verbatim.
  - `Visible:` keyed-object — the WP-E winner format. The Visible block
    sits UNDER the `# Current Game State` heading; it is the spatial-
    perception slice of "what is now", not its own top-level section.

**Rationale.**

- The user's intent §2 is hand-crafted and explicit on ordering:
  "separation of game state vs visible obj (visibleObj is still under
  the gamestate heading), and the previous turn with scratchpad →
  current game state narrative." This ADR codifies the prose into the
  builder contract.
- Phase-3's `## Scratchpad` top-level section was named the same as the
  agent's tool-field `scratchpad_update`; the two were temporally
  distinct (read-from-prior vs write-for-next) but textually
  conflated. Folding the scratchpad under `## previous turn` resolves
  the ambiguity by tying the heading to *when in time* the content
  applies.
- The kill feed and alive count are net-new affordances (intent §3);
  putting them in the existing sectioned structure rather than
  inventing new top-level sections respects the existing prompt
  budget.

**Diff vs phase-3 ADR §6.** Phase-3 ADR §6 prescribed:
```
You: ...
Last turn (you): ...
Visible:
- ...
```
Phase-4 ADR §4 prescribes (verbatim intent §2):
```
<persona body>
## previous turn
You: ...
Scratchpad: ...
<kill feed lines>
# Current Game State
Turn N, M/8 players alive
You: ...
Visible:
<keyed object>
```
The phase-3 sort order within Visible (tier 1 chars → tier 2 chests/
corpses → tier 3 cover → tier 4 walls → tier 5 evac singleton) is
preserved; only the rendering format inside Visible changes per ADR §5.

**Alternatives considered.**

- *Keep the phase-3 flat digest and add the kill feed at the top.*
  Rejected — intent §2 is explicit on the sectioned ordering.
- *Use `# Previous turn` and `# Current game state` (both H1) to keep
  hierarchy parallel.* Rejected — intent §2 hand-codes the `##` /
  `#` asymmetry; the user's read is that current state IS the top-
  level grounding and previous turn IS subordinate context.
- *Render the persona body under `## Persona` to preserve the phase-3
  label.* Rejected — intent §2 shows the persona body before any
  heading. The persona body's identity is the prompt's grounding;
  prefixing a `## Persona` heading is the kind of refactor-the-intent-
  away that this ADR explicitly disallows.

**Consequences.**

- `convex/llm/inputBuilder.ts`'s `buildAgentInput` return type changes:
  it now returns a single composed user message (not a tuple of
  systemPrompt + visibleStateDigest) — OR it returns the digest body
  AND `convex/llm/azure.ts` joins it differently. WP-D picks the seam;
  the contract is that the assembled user message matches §2 exactly.
- `convex/llm/azure.ts:buildUserMessage` is simplified or deleted —
  the phase-3 `## Persona / ## Scratchpad / ## Visible state` wrapper
  comes out. The persona prompt is no longer wrapped; the scratchpad is
  no longer a top-level section; the digest is no longer labelled
  `## Visible state`.
- `tests/llm/inputBuilder.test.ts` is rewritten to assert the new
  ordering exhaustively (presence of `## previous turn`, presence of
  `# Current Game State`, kill feed lines when prior turn has deaths,
  alive count line correctness, no `## Scratchpad` heading anywhere).
- The persisted `agentRecord.input.visibleStateDigest` field narrows to
  the Visible-object body only (matching phase-3 semantics for "the
  spatial-perception slice"). The full assembled user message is
  persisted on the **new additive field `agentRecord.input.
  composedUserMessage?: string`** per ADR §1b — this is the raw-pane's
  primary read path on phase-4 traces. Phase-3 trace rows omit the
  field; the raw-pane falls back to phase-3 client-side composition
  (`personaPromptText` + wrapped scratchpad + `visibleStateDigest`).
  Single presence-check, no shape-detection branch.

---

## 5. Diagnostic bundle contract (replay UI)

**Decision.** Land four diagnostic surfaces in the replay UI, all
reading already-persisted fields except the tool schema which is read
from the live module. No schema changes required.

The four surfaces per intent §6 / acceptance D:

1. **`rawArguments` vs `decision` matched/diverged render.**
   - When `agentRecord.llm.rawArguments === JSON.stringify(agentRecord.decision)`
     modulo whitespace + key ordering, render a single pane with a
     "✓ matched" indicator.
   - When they diverge (the wrapper safe-defaulted, or
     `multiple_function_calls` kept the first call), render side-by-side
     with a "⚠ diverged" indicator. The diff is the load-bearing diagnostic
     — it answers "did the engine zero a valid-looking decision, or
     did the model emit nonsense and the safe-default kick in?"
   - Helper composer: `composeRawArgumentsVsDecision(agentRecord) →
     { matched: boolean, rendered: string }` in
     `apps/replay/src/lib/rawPane.ts`.

2. **`validatorReason` surface.**
   - When `agentRecord.llm.validatorReason` is set (non-null,
     non-undefined), render the value inline on the TurnFeed row AND
     in the ExpandModal's raw-args pane. The validator reason is the
     engine-side rejection signal (target not visible, out of range,
     etc) — distinct from `failureReason` (which is wrapper-level:
     HTTP/parse/schema failures).
   - The phase-3 trace ledger already persists `validatorReason` (per
     `convex/schema.ts` `agentLlmValidator:257`); WP-B is pure UI.

3. **`usage.output_tokens / max_output_tokens` bar with 🔴 truncated
   indicator.**
   - On every TurnFeed row, render the ratio as a compact bar (e.g.
     `[1140 / 1200]`). When `output_tokens ≥ 0.95 × max_output_tokens`,
     light up the "🔴 truncated" indicator. The 5% headroom is the
     hypothesis-honest threshold for "the model may have shipped a
     minimal tool call to satisfy `tool_choice: required` after
     exhausting its reasoning budget".
   - `max_output_tokens` is read from the matches row (post-WP-F lever
     probe parameterises it; pre-WP-F it's the constant 1200).
   - `usage.output_tokens` is already persisted in
     `agentRecord.llm.usage` per phase-1 ADR.

4. **Tool schema section in `composeFullLlmInput`.**
   - Extend `composeFullLlmInput` from a 2-section render
     (system role + user role) to a **3-section render** with
     `--- tool schema ---` appended. The tool schema is read from
     `convex/llm/decisionTool.ts` at build time (the `decisionTool`
     constant is the live source); pretty-printed JSON.
   - **Contract (intent §6): `composeFullLlmInput` is request-inputs-
     only — system role + user role + tool schema. Reasoning text is
     model OUTPUT, not input; it MUST NOT be appended to
     `composeFullLlmInput`.** The existing `composeReasoningText` pane
     in the ExpandModal continues to render reasoning text in its own
     dedicated section; the diagnostic bundle preserves that
     separation. Putting reasoning inside the Input pane would be
     semantically false (the model never received its own reasoning
     text as input) and would duplicate content already rendered
     elsewhere in the modal.
   - User-message content sourcing per ADR §1b: on phase-4 traces the
     user role is `agentRecord.input.composedUserMessage` rendered
     verbatim; on phase-3 traces (where the field is absent) the user
     role is the phase-3 client-side composition.
   - Trade-off: if the schema evolves between when the run executed
     and when the user replays, the rendered schema is the *current*
     shape, not the historical one. For POC posture, this is acceptable
     — the schema is stable within a phase and no in-phase rollback is
     planned. If post-phase-4 work touches the schema again, the
     historical-shape question can be revisited (probably by persisting
     a schema hash on each agent record, as systemPromptHash does for
     the system prompt).

**Rationale.**

- Every field this surface renders is already persisted on the phase-3
  trace ledger (`rawArguments`, `validatorReason`, `usage`,
  `systemPromptText`, `personaPromptText`, `visibleStateDigest`,
  `scratchpadBefore`, `decision`, `llm.reasoning`). The diagnostic
  bundle is a pure-UI delta; no schema migration, no historical-trace
  invalidation, no engine touch.
- WP-B lands FIRST in the phase-4 sequence (per README §11) for
  diagnosis-before-redesign: the user needs to see what the bench is
  measuring and what the closing-10 is regressing-or-not BEFORE the
  redesign ships. Without rawArguments-vs-decision visibility, the
  bench can't distinguish "the model emitted the wrong shape" from
  "the engine zeroed it" from "the wrapper safe-defaulted". Without
  the truncation indicator, the no-op-vs-reasoning-budget question is
  invisible.
- The tool-schema surface is the request-body completeness check: the
  Full LLM Input pane is the user's introspection on "what the model
  literally received this turn". Phase-3 left the schema invisible;
  phase-4 closes the gap.

**Alternatives considered.**

- *Persist the tool schema JSON on each agent record.* Rejected for
  phase-4 — additive but storage-heavy (~3 KB × 8 agents × 50 turns ×
  10 runs ≈ 12 MB per closing-10). Reading from the live module is
  cheap and accurate within a phase. Revisit if schema versioning ever
  becomes a cross-phase concern.
- *Compute matched/diverged at persistence time and store a boolean.*
  Rejected — the comparison is cheap at render time (one
  `JSON.parse + canonicalise + stringify`) and storing a derived
  boolean would freeze the comparison contract. Render-time is
  flexible (e.g. WP-F's reasoning.effort probe may want to whitespace-
  normalise the comparison; that's a renderer change, not a schema
  migration).
- *Light up the truncation indicator at 100% of cap (i.e. only when
  `output_tokens === max_output_tokens`).* Rejected — Azure's
  output-tokens accounting includes reasoning + tool-call tokens; the
  exact-equal threshold misses near-misses where the model shipped a
  minimal call with one token of headroom. The 95% threshold catches
  the cluster.

**Consequences.**

- `apps/replay/src/lib/rawPane.ts` gains:
  - `composeFullLlmInput` extended from 2 → **3** sections (system
    role + user role + tool schema). Reasoning text is NOT appended;
    it stays in its own existing `composeReasoningText` pane.
  - User-role sourcing branches on `agentRecord.input.
    composedUserMessage` presence: render verbatim when present
    (phase-4 traces); fall back to legacy compose path when absent
    (phase-3 traces).
  - `composeRawArgumentsVsDecision` new pure-function helper.
  - `composeToolSchemaSection` new pure-function helper reading the
    live `decisionTool` constant.
- `apps/replay/src/components/ExpandModal.tsx` extends from 3 → 4
  pane sections: (1) Full LLM Input — now 3 sub-sections per the
  contract above; (2) Reasoning text — UNCHANGED, kept distinct from
  Full LLM Input on purpose (reasoning is output, not input); (3)
  Tool call — with rawArguments-vs-decision as a sub-render; (4) NEW
  `validatorReason` block when `agentRecord.llm.validatorReason` is
  set.
- `apps/replay/src/components/TurnFeed.tsx` gains:
  - A small "⚠" badge per row when `decision` and `rawArguments`
    diverge (or when `validatorReason` is set).
  - A compact `[output / max]` token bar with the 🔴 truncated
    indicator at ≥ 95%.
- New unit tests in `apps/replay/src/lib/__tests__/rawPane.test.ts`
  covering all three new composer helpers.
- WP-B is wholly independent of WP-A (engine emit), WP-C (system prompt
  + tool-schema descriptions), and WP-D (user-message rebuild). It can
  land first; it can also be reviewed against the phase-3 closing-10
  traces before any other phase-4 change ships.

---

## Cross-references

- `docs/project/spec/per-turn-context-intent.md` — canonical intent
  anchor (§1 system role / §2 user-message ordering / §3 kill feed +
  alive count / §4 Visible-object format / §5 tool-schema descriptions
  / §6 diagnostic surface / §7 levers / §8 success criteria).
- `docs/project/spec/mental-model.md` §13 — phase-4 dispatch paragraph.
- `docs/project/phases/03-substrate-refinement/architecture-decisions.md` —
  phase-3 ADRs §1–§9 (extended, not superseded, by the above).
- `docs/project/phases/03-substrate-refinement/PHASE-3-CLOSURE.md` — the
  closing-10 thresholds phase-4 must not regress.
- `convex/llm/systemPrompt.ts` — current system prompt (ADR §2 source).
- `convex/llm/decisionTool.ts` — current JSON Schema + descriptions
  (ADR §3 source).
- `convex/llm/inputBuilder.ts` — current digest builder (ADR §4 source).
- `convex/llm/azure.ts` — current wrapper (ADR §4 + §5 source).
- `convex/engine/resolution.ts` + `convex/engine/combat.ts` — current
  action trace emit (ADR §1 source).
- `apps/replay/src/lib/rawPane.ts` + `apps/replay/src/components/ExpandModal.tsx`
  + `apps/replay/src/components/TurnFeed.tsx` — diagnostic bundle
  landing zone (ADR §5).
