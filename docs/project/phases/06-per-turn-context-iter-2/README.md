# Phase 06 — Per-Turn Context Iteration 2

> Substrate-deeper re-cook of the per-turn LLM context. Collapses the
> phase-3/4 coordination overlays (`primary`, `move`, `overwatch_stance`,
> `consume`) into a `use` + `position` + `action` + `say` + `scratchpad`
> shape. Renames `Player_N` → persona name (Duelist / Camper / …)
> everywhere. Introduces per-turn schema variants (narrows `use` to
> `null`-only when nothing is equipped). Switches engine validator to
> field-scoped rejection. Adds a personal damage feed sibling to the
> global kill feed. Ships an iter-2 status-block + event-log layout in
> the user message. Demonstrates via a 20-run Convex closing report at
> `low/1200`.
>
> Phase status: **closed 2026-05-12**. Closure record:
> `docs/project/phases/06-per-turn-context-iter-2/PHASE-6-CLOSURE.md`
> (16/17 gates PASS; no-op miss deferred to Phase 7). Mental-model anchor:
> `docs/project/spec/mental-model.md` §15. Intent anchors (source of
> truth on shape + prose — do not refactor away):
> `docs/project/spec/decision-tool-schema-draft.md` and
> `docs/project/spec/per-turn-context-intent.md`. Empirical anchor:
> `harness/probe-schema-emission.ts` + `probe-schema-emission-output.json`
> (Azure Responses auto-normalises tool schemas to strict mode; `required[]`
> is decorative; the structural design is what matters).
>
> Authority grants (LOAD-BEARING per north star): Convex dev DB wipe
> authorised (POC posture `project_poc_schema_wipe_acceptable`); free
> reign of the `.env` Azure endpoint for probes + closing run. Workers
> MUST NOT escalate either.

---

## 1. Purpose — why this phase

The phase-3 / phase-4 `decide_turn` shape carried three smells the
2026-05-12 schema-emission probe + doc review exposed:

1. **`primary` was a coordination overlay**, not a verb. It sat alongside
   `move` and `action` as a peer field, encoded "what kind of turn is
   this," and let illegal combinations through structurally. Cross-field
   Zod refines were papering over a bad shape.
2. **`overwatch_stance` was a second coordination overlay** that only
   meant anything when `primary === "overwatch"`. Required-nullable with
   a refine relating it to `primary`. Same smell, smaller.
3. **`consume` asked the model to name `heal` / `speed`** — but the
   engine already knows which consumable is equipped. The model was
   restating data it didn't author.

The probe also confirmed: **Azure Responses normalises tool schemas to
strict mode**, so "optional" is decorative — all declared properties get
emitted on every call. The right lever for *fewer fields per turn* is
**structural** (fewer properties declared at all, plus per-turn schema
variants), not "mark them optional."

Phase 6 is the structural fix, lined up with the user's hand-crafted
intent docs.

The persona-name substrate shift is pillar-aligned: agents *are*
characters with names (pillar 1, "the player writes the mind"). `Player_N`
was an engine-internal index leaking into the model-facing surface. One
match has one of each persona — the names are single-word and id-safe,
so no separate type-safety layer is needed for POC.

The personal damage feed closes the phase-3 outcome-attribution residue
(88.6% at closing-10 — the gap was "agent doesn't know why HP dropped
because attacker is out of LOS"). LOS-independent attribution + the
mirroring kill-feed shape teach the model two scopes of one pattern.

## 2. What "done" means — closing condition

A **20-run Convex closing report at `low/1200`**, persisted with
`reportType: "phase-6-closing-20"`, that the user can step through in the
replay UI and see the new mechanics actually working.

**Carry-over thresholds (phase-3 baseline, MUST NOT regress):**

| Metric | Threshold |
|---|---|
| Runs ending with ≥ 1 extraction | ≥ 30% (≥ 6 of 20) |
| Runs containing ≥ 1 kill | ≥ 80% (≥ 16 of 20) |
| Runs containing ≥ 1 chest equip | ≥ 80% |
| Runs containing ≥ 1 speech event | ≥ 50% |
| Persona extraction-rate spread | ≥ 15 pp |
| 20 consecutive runs, no crashes | required |

**Iter-2 specific thresholds (the new mechanics must demonstrably work):**

| Metric | Threshold | Source |
|---|---|---|
| `use:"consumable"` emitted with nothing equipped | **0** | scan raw `agentRecord.llm.rawArguments` emissions × `agentRecord.input.useVariant` |
| Action+overwatch combo traces resolved cleanly | **≥ 10** | scan trace.actions[] for paired entries on same actor turn |
| Overwatch trigger-fires (fired on a moving enemy) | **≥ 5** | scan trace.actions[] for `kind="overwatch"` + `triggeredByMovement === true` + `result="dmg N"` (see WP-B for the `triggeredByMovement` marker; counting damage alone is NOT sufficient) |
| Counter retaliations resolved cleanly | **≥ 5** | scan trace.actions[] for kind="counter" + result="dmg N" |
| Compass bearings exercised (N, NE, E, SE, S, SW, W, NW) | **all 8** | scan `decision.position.kind === "move"` then `decision.position.direction.kind` |
| Both `toward` AND `away` target-relative arms appear | **both ≥ 1** | scan `decision.position.kind === "move"` then `decision.position.direction.kind` |
| Personal damage feed line appears on every post-damage turn (audit sample) | **100%** of sample | inputBuilder unit assertion + report sampler; formula = deterministic first 20 eligible post-damage turns by match/turn/record iteration order; for each (run, agent, turn N) with `resolution.actions[]` entries targeting agent (after persona-name normalisation), assert agent's turn N+1 `agentRecord.input.composedUserMessage` contains a `<Attacker> attacked you with <weapon> (dmg X)` line per attacker. Damage on the final turn and damage where the victim has no next-turn agent record (including victim dies) are intentionally outside the audit window and are documented on the persisted report. |
| Whole-turn validator zeros (every field of decision rejected) | **0** | scan `agentRecord.llm.validatorFieldErrors`; whole-turn = all of {use, position, action, say, scratchpad} have a fieldErrors entry. Sister metric: `perFieldRejectionRate ≤ 10%` across all (run, agent, turn) tuples (any one field rejected, summed) — preserves phase-3's 8.256% baseline signal |
| No-op rate (iter-2 redefined — see §11.4) | **< 5%** | scan `agentRecord.decision`: all of `use===null`, `say===null`, `action.kind==="none"`, and (`position.kind==="move"` ∧ `position.dist===0`) OR (`position.kind ∈ {overwatch,counter}` ∧ `action.kind==="none"`) |
| `Player_N` literal substring in any agent-facing persisted surface in the 20 runs | **0** | scoped scan over `agentRecord.input.composedUserMessage`, `agentRecord.input.personaPromptText`, `agentRecord.llm.rawArguments`, `agentRecord.decision.*.targetId`, `resolution.actions[].target`, `characters.displayName`, and agent-facing strings in persisted report payloads |

**Hard gates:**

- `npm run lint && npm run typecheck && npm run build && npm test` — green at root AND `apps/replay/`.
- `npx convex dev` reaches a clean push against the **wiped** dev deployment.
- `tests/llm/schemaMirror.test.ts` updated for the new shape AND passing — the schema↔mirror parity contract holds.
- The user can open any of the 20 runs in the replay UI and see, on every turn row:
  - The decision rendered in English for the new arms.
  - The **per-turn shipped tool schema variant** in the raw-pane (not a static reference).
  - `validatorFieldErrors` rendered **per-field** when set (field name + reason).
  - `rawArguments` vs `decision` with matched/diverged indicator.
  - `usage.output_tokens / max_output_tokens` bar with truncation badge at ≥ 95%.

## 3. Scope — Cucumber

Per the north-star, the 10 in-scope scenarios are:

1. Tool shape collapse — schema exposes `use / position / action / say / scratchpad` only.
2. Per-turn schema variant for `use` — narrows to `{type:["null"], enum:[null]}` when nothing equipped.
3. Action+overwatch combo — both resolve in one turn; overwatch trigger arms.
4. Counter retaliation — only fires when attacked; does NOT fire on movement.
5. Personal damage feed — emitted every time damage was taken, LOS-independent, uses persona name.
6. Persona name as agent id — Rat / Duelist / Trader / Opportunist / Paranoid / Camper / Sprinter / Vulture replace `Player_N` everywhere.
7. Field-scoped validator rejection — only invalid fields get zeroed; rest of turn resolves.
8. Status block + Current Game State structure — per `per-turn-context-intent.md` §2.
9. System prompt iter-2 verbatim — per `per-turn-context-intent.md` §1; `leaving cover` dropped; combo-range line added; no safe-default tail.
10. Compass + dist movement — compass arms walk exact dist; target-relative stops at per-entity-type range; dist:0 no-op; all 8 bearings + both toward/away exercised across 20 runs.

The verbatim Cucumber scenarios live in the assignment north star; this
doc does not re-prose them.

## 4. Hard out of scope

Per assignment north star: persona behaviour tuning beyond mechanical
scrub; consumer-facing renderer (fog of war, animation, mobile); cursed-
item flavour text; procedural map generation; reasoning-effort /
max_output_tokens probes (locked at `low/1200`); deployed / public /
authed surfaces; multi-persona-per-match.

## 5. Architecture Design

The three-slice contract (LLM / State / Engine / Renderer) is preserved.
Engine and renderer still meet only at State.

### 5.1 ADRs (locked, ratified at dispatch)

#### ADR-1 — Tool schema is a per-turn builder, not a static const

`convex/llm/decisionTool.ts` exports `buildDecisionTool({useVariant})` and
its companion Zod parser `parseDecision(raw, {useVariant})`. The returned
shape mirrors the **Azure Responses API flat form**:

```ts
{ type: "function", name: "decide_turn", description, parameters }
```

— no nested `function:` wrapper, no `strict` flag (strict is implicit on
Responses per the Azure docs). The two variants:

| useVariant | `use` field shape |
|---|---|
| `"consumable_or_null"` | `{type:["string","null"], enum:["consumable", null], description: "..."}` |
| `"null_only"` | `{type:["null"], enum:[null], description: "No consumable is currently equipped, so nothing can be used."}` |

The discriminator `useVariant: "consumable_or_null" | "null_only"` is
persisted on `agentRecord.input.useVariant` so the replay UI's
tool-schema pane reconstructs the **shipped** schema via
`buildDecisionTool(...)` rather than rendering a static reference.

Compile-time TS asserts in `decisionTool.ts` lock the Zod parser ↔
engine-types `ParsedDecision` equivalence (mirrors the phase-3 pattern at
lines 391–400). `tests/llm/schemaMirror.test.ts` is rewritten to assert
byte-equality across **both variants**.

#### ADR-2 — `ParsedDecision` shape

```ts
export type Direction =
  | { kind: "toward" | "away"; targetId: string }
  | { kind: "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW" };

export type Position =
  | { kind: "overwatch" | "counter" }
  | { kind: "move"; direction: Direction; dist: number };

export type ParsedDecision = {
  use: "consumable" | null;
  position: Position;
  action:
    | { kind: "none" }
    | { kind: "attack" | "loot"; targetId: string };
  say: string | null;
  scratchpad: string | null;
};
```

`primary`, `move`, `overwatch_stance`, `consume`, `scratchpad_update`,
`action.targetCharacterId` are **gone**. Action's targetId is unified —
engine dispatches by id namespace (existing pattern from phase-3 ADR §1).

#### ADR-3 — Persona name = `displayName` = agent id

`convex/matches.ts` initialisation flips:

```ts
displayName: `Player_${spawnIndex + 1}`   // was
displayName: titleCase(personaId)         // now: "Duelist", "Camper", …
```

The seeded `assignPersonasToSpawns` already enforces one-of-each-persona,
so displayName uniqueness within a match is invariant by construction.
Engine `characterId` stays opaque (Convex `_id` in prod, plain string in
tests) — only the model-facing `displayName` rename ships in this phase.

Touched dispatch sites:
- `convex/engine/validation.ts` line 299 — `targetId.startsWith("Player_")` → `PERSONA_DISPLAY_NAMES.has(targetId)`.
- `convex/engine/resolution.ts` line 608 — same.
- `convex/llm/idNormalisation.ts` line 227 — same.
- `convex/llm/inputBuilder.ts` line 211 — **delete** the `^P\d+$` → `Player_$1` regex fallback (it leaks the legacy form); fallback to bare characterId.
- `convex/llm/inputBuilder.ts` corpse render: `Corpse_${displayName}` now produces `Corpse_Camper` for free.

`PERSONA_DISPLAY_NAMES` is a derived `Set<string>` exported from
`convex/engine/types.ts` alongside `PERSONA_IDS`. Helper:

```ts
export const PERSONA_DISPLAY_NAMES = new Set(PERSONA_IDS.map(titleCase));
export function titleCase(id: PersonaId): string { ... }
```

#### ADR-4 — Position commitment replaces primary/move/overwatch_stance

The new `position` is a discriminated union (ADR-2). The cross-field
refine vanishes — illegal combinations are unrepresentable. The compass
table lives in `convex/engine/movement.ts`:

| Compass | (dx, dy) | Compass | (dx, dy) |
|---|---|---|---|
| `N`  | (0, −1) | `S`  | (0, +1) |
| `NE` | (+1, −1) | `SW` | (−1, +1) |
| `E`  | (+1, 0)  | `W`  | (−1, 0) |
| `SE` | (+1, +1) | `NW` | (−1, −1) |

`position.move.dist` is clamped to budget (`8` base / `12` with speed)
at the substep loop. Compass moves walk exactly `dist` steps in the
bearing (or to the budget cap). Target-relative moves obey the existing
per-entity-type `stopAtRange` table (Character/Chest/Corpse 2, Wall 1,
Cover/Evac 0). `dist:0` is a no-op (used for the "loot at feet" pattern).

#### ADR-5 — Action+position combos resolve both arms

When `position.kind ∈ {overwatch, counter}` AND
`action.kind ∈ {attack, loot}`:

- The **deliberate action** resolves this turn against the actor's
  stationary position (existing in-range / liveness / visibility gates).
- The **position trigger** arms in parallel:
  - `overwatch` → fires on the first enemy that moves into weapon range
    during this turn's movement phase. Engine emits a second trace entry
    `kind: "overwatch"` with the same `weapon` field.
  - `counter` → retaliates ONLY if attacked this turn, bounded by weapon
    range. Does NOT fire on movement-into-range.

The phase-3 offensive/defensive split is gone:

| Phase-3 stance | Phase-6 position |
|---|---|
| `overwatch` + `stance: "offensive"` | `position: {kind: "overwatch"}` |
| `overwatch` + `stance: "defensive"` | `position: {kind: "counter"}` |

The engine's existing offensive-fire pass (`resolution.ts` ~ line 380)
becomes the overwatch trigger arm; the existing defensive counter-fire
pass (~ line 677) becomes the counter trigger arm. Trace entries emit
`kind: "overwatch"` for movement-triggered fires (overwatch arm) and
`kind: "counter"` for attack-triggered retaliations (counter arm).
**Trace `stance` field is retired** — the `kind` carries the
discrimination structurally.

**Overwatch must prove movement-trigger semantics.** The current
offensive-fire pass fires on the first visible in-range enemy after
the movement phase; this does NOT prove the target *moved into range
this turn*. WP-B MUST tighten the trigger to fire only when the
target's pre-movement position was OUT of weapon range AND the post-
movement position is IN weapon range (i.e. the target moved into range
this turn). Trace rows emitted by the overwatch arm carry
`triggeredByMovement: true` so the WP-I aggregator can prove Scenario
3 without falsely counting already-in-range damage. Static in-range
targets that did not move into range this turn → no overwatch fire.

**Trace target canonicalisation contract.** Every character-targeted
trace entry written to `resolution.actions[].target` MUST be a persona
displayName, not an internal characterId. The current offensive-
overwatch emit (`resolution.ts:418-425`) writes the internal `targetId`
and the defensive counter emit (`resolution.ts:799-807`) writes
`cf.attackerId` — both internal ids. WP-B normalises both to displayName
via the persona-name id flip from WP-E. This is load-bearing for ADR-8
(personal damage feed) — without it, overwatch/counter damage either
disappears from the feed or leaks `Player_N`-style identifiers.

#### ADR-6 — Field-scoped validator rejection

`validateDecision` returns:

```ts
type ValidationResult = {
  decision: ParsedDecision;       // each invalid field replaced with its safe-default
  fieldErrors: {
    use?: string;
    position?: string;
    action?: string;
    say?: string;
    scratchpad?: string;
  };
};
```

Per-field safe-defaults:

| Field | Safe default on rejection |
|---|---|
| `use` | `null` |
| `position` | `{kind:"move", direction:{kind:"N"}, dist:0}` (true no-op stationary) |
| `action` | `{kind:"none"}` |
| `say` | `null` |
| `scratchpad` | `null` (carry forward unchanged) |

Trace persistence: phase-3's `validatorReason?: v.string()` is replaced
by `validatorFieldErrors?: v.object({use?, position?, action?, say?, scratchpad?})`
(see ADR-9). POC schema break authorised; the closing-20 report includes
a `wholeTurnValidatorZeros` metric that MUST be 0 (at least one field
survives validation on any trace that had any rejection).

#### ADR-7 — Status block + Current Game State layout

Per `per-turn-context-intent.md` §2 verbatim. `inputBuilder.ts` rewrites
to:

```
# <PersonaName>
You adopt <PersonaName> persona:
<persona prompt body>

## Status
📍(X,Y)
❤️HP: cur/max HP
⚔️weapon: <name> [stats] | none
🛡️armour: <name> [stats] | none
🧪consumable: <name> [effect] | none
🗒️scratchpad: <prior-turn scratchpad text>


# Current Game State
Turn N, M/8 players alive
<own-outcome event line if any non-null fragments>
<personal damage event line(s) if damage taken>
<global kill feed event line(s) if any kills happened on prior turn>
{visibleObj...}
```

- Equipment carries stats inline by reading `WEAPONS / ARMOUR / CONSUMABLES`
  from `convex/engine/types.ts` (already locked).
- The `📍` line carries **position only** — last-turn outcome lives in
  Current Game State.
- Phase-3's `Last turn (you):` line is retired; its fragments fold into
  Current Game State as the own-outcome event line.

The full assembled user-role text is persisted on
`agentRecord.input.composedUserMessage` (phase-4 additive field already
present). `azure.ts` drops the legacy `## Persona / ## Scratchpad / ##
Visible state` wrapper — `inputBuilder.ts` owns the whole shape.

`# <PersonaName>` heading: `<PersonaName>` is the agent's persona name
(persona-name = displayName per ADR-3).

**`<Player Name>` system-prompt substitution layer = `azure.ts`.** The
system prompt template (`convex/llm/systemPrompt.ts`) ships with the
literal `<Player Name>` placeholder verbatim per `per-turn-context-
intent.md` §1; substitution to the actor's `displayName` happens in
`convex/llm/azure.ts` at message-composition time, NOT inside
`inputBuilder.ts`. The input builder owns the user-role text only.
This avoids the parallel-WP overlap risk (WP-D and WP-F both touching
the same substitution layer).

**Visible JSON-keyed sample fixture.** WP-A/WP-D pin a canonical sample
of the JSON-keyed Visible serialisation for snapshot tests, e.g.:
```json
{
  "Duelist": {"kind":"character","pos":{"x":3,"y":7},"hp":18,"equipped":{"weapon":"hammer","armour":"leather","consumable":null}},
  "Chest_north": {"kind":"chest","pos":{"x":5,"y":1},"contents":{"weapon":"shotgun"}},
  "Wall_4_4": {"kind":"wall","pos":{"x":4,"y":4}}
}
```
The exact key naming and content shape lives in WP-A's snapshot
fixture and is consumed by WP-D's inputBuilder snapshot test —
preventing silent drift between the two WPs.

#### ADR-8 — Personal damage feed channel

`inputBuilder.ts` adds a `renderDamageEventLines(prev, observer)` helper.
For each entry in `prev.resolution.actions[]` where:

- `entry.target === observer.displayName`
- `entry.result` matches `/^dmg (\d+)$/`
- `entry.kind ∈ {attack, overwatch, counter}` (any inbound damage)

emit one line of shape `<Attacker> attacked you with <weapon> (dmg N)`,
attributed via `entry.characterId → displayName` lookup. The line is
**LOS-independent** — the attacker need not appear in the observer's
current Visible. Multiple lines per turn iff multiple attackers.

The shape mirrors the global kill feed (`<actor> verb <target> with
<weapon>`). Two scopes of one pattern.

#### ADR-9 — Schema break is in (POC posture)

Convex schema diff lands in WP-A + WP-C + WP-I:

| Field | Direction | Notes |
|---|---|---|
| `agentRecord.decision` | full rewrite | new ParsedDecision shape |
| `agentRecord.input.useVariant` | NEW | optional discriminator |
| `agentRecord.llm.validatorReason` | REMOVED | replaced by `validatorFieldErrors` |
| `agentRecord.llm.validatorFieldErrors` | NEW | optional object of field → reason |
| `resolution.actions[].kind` (literal set) | extended | `"counter"` added alongside `"overwatch"` |
| `resolution.actions[].stance` | REMOVED | discriminated by `kind` now |
| `characters.displayName` | semantic-only | now persona-name; type unchanged |
| `reports.phase6Payload` | NEW | sibling to `payload` / `phase3Payload` |

POC posture: Convex dev DB wipe authorised (WP-H). No migration shims,
no dual-shape branches.

#### ADR-10 — `leaving_cover` reveal cause retired

System prompt §1 lists cover-reveal causes as: enemy within 2, attacking,
speaking, looting, consumable. `leaving cover` is gone. To keep the
substrate aligned with what the model is taught, `convex/engine/resolution.ts`
phase-4 movement section stops emitting `revealedBy: "leaving_cover"`.

The `RevealCause` type's `"leaving_cover"` literal stays declared (for
back-compat with historical phase-3 traces being read by the replay UI),
but the engine no longer produces new entries with that cause.

### 5.2 Files touched

| Slice | Files | Nature |
|---|---|---|
| LLM tool schema | `convex/llm/decisionTool.ts` | full rewrite — per-turn builder; Azure Responses flat shape; Zod parser; both variants |
| Engine types | `convex/engine/types.ts` | new `ParsedDecision`, `Direction`, `Position`; new `SAFE_DEFAULT_DECISION`; `PERSONA_DISPLAY_NAMES` + `titleCase` |
| Engine resolution | `convex/engine/resolution.ts` | route position.move (toward/away/compass); fold offensive overwatch ↔ position.overwatch; fold defensive counter ↔ position.counter; both action arms resolve in combo; drop leaving_cover emit; drop scratchpad_update read → scratchpad |
| Engine movement | `convex/engine/movement.ts` | compass→(dx,dy) table; compass-walk-dist logic; dist:0 no-op |
| Engine validation | `convex/engine/validation.ts` | field-scoped rejection; new return shape; per-field safe-default fold-in |
| Engine hiding | `convex/engine/hiding.ts` | reveal-cause list comment audit; behaviour unchanged at function boundary |
| LLM id normalisation | `convex/llm/idNormalisation.ts` | `Player_` prefix dispatch → persona-name set membership |
| LLM input builder | `convex/llm/inputBuilder.ts` | Status block + Current Game State layout; personal damage feed; drop `Last turn (you)` line; drop `^P\d+$` fallback; JSON-style keyed Visible |
| LLM system prompt | `convex/llm/systemPrompt.ts` | verbatim rewrite per §1; `<Player Name>` placeholder |
| LLM Azure wrapper | `convex/llm/azure.ts` | per-turn `buildDecisionTool` call; `useVariant` thread-through; drop legacy section wrapper |
| Schema | `convex/schema.ts` | decisionValidator rewrite; useVariant additive; validatorFieldErrors swap; reports.phase6Payload additive |
| Schema mirror | `convex/_internal_runMatch.ts` | mirror updates |
| Reports | `convex/reports/phase6.ts` | NEW pure aggregator + Convex action; `reportType: "phase-6-closing-20"` |
| Personas | `personas/*.md`, `convex/_data/personas.ts` | LIGHT-touch scrub for dead field refs |
| Replay UI | `apps/replay/src/lib/decisionEnglish.ts` | rewrite for new arms |
| Replay UI | `apps/replay/src/lib/rawPane.ts` | per-turn variant render; per-field validatorFieldErrors |
| Runner | `convex/runMatch.ts` | compute `useVariant` per agent; thread to azure.ts; persist on agentRecord |
| Harness | `harness/run.ts` | extend to fire 20-run closing-20 cohort + persist phase-6 report |
| Spec | `docs/project/spec/concept-spec.md` | update §9 (decision economy) + §10 (movement) + §11 (overwatch/counter) to iter-2 vocabulary |
| Spec | `docs/project/spec/mental-model.md` §15 | dispatch paragraph already landed; no re-edit unless intent shifts |

## 6. Dependency map

```
                    WP-A   Tool schema + Zod + ParsedDecision types
                          │  (substrate contract — blocks B, C, D, G, I)
                          │
                          │
                ║ PARALLEL with WP-A (touches everything; lands early to reduce churn):
                ║
                    WP-E   Persona name = agent id
                          │  (matches.ts displayName flip + dispatch sites + persona scrub)
                          │
                          ▼
              Gate: tests green; one smoke turn completes with new displayName
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
       WP-B              WP-C              WP-F
     (engine)         (variant)        (system prompt)
        │                 │                 │
        └────────┬────────┴────────┬────────┘
                 ▼                 ▼
                WP-D              WP-G
            (input builder)    (replay UI)
                 │                 │
                 └────────┬────────┘
                          ▼
                         WP-H  (persona scrub + DB wipe + smoke)
                          │
                          ▼
                         WP-I  (closing-20 + report aggregator + closure doc)
                          │
                          ▼
                       PHASE 6 CLOSED
```

WP-A is the substrate contract; every downstream WP keys off the new
shape. WP-E touches everything but is single-axis (one search-and-replace
of `Player_` prefix dispatch + the displayName seed); landing it
concurrently with WP-A reduces merge churn in WP-B / WP-D / WP-G.

WP-B (engine), WP-C (variant), WP-F (system prompt) parallelise — disjoint
write sets — after A+E ratify. WP-D (input builder) consumes the new
shape + persona names + engine trace entries; WP-G (replay UI) consumes
the same set. Both parallelise after B/C/F land.

WP-H is the substrate-cleanup gate before the closing run. WP-I is the
closing measurement.

## 7. Work Package Breakdown — UAT vertical slices

Each WP below is a vertical UAT slice (substrate change → contract test
→ persisted-trace verification → replay-UI render of the new surface).
Success criteria are testable; bullet-flag exit criteria are the WP's
verdict gate.

### WP-A — Tool schema + Zod parser + ParsedDecision types

**Scope:**
- Rewrite `convex/llm/decisionTool.ts` to export `buildDecisionTool({useVariant})` per ADR-1. Azure Responses flat shape. Both variants. New Zod parser per `ParsedDecision` shape. Compile-time TS asserts lock the engine ↔ parser equivalence.
- Rewrite `convex/engine/types.ts` `ParsedDecision`, `MoveDecision`/`ActionDecision` types per ADR-2. Add `Position`, `Direction`. Add `SAFE_DEFAULT_DECISION` for the new shape (`use:null`, `position:{kind:"move", direction:{kind:"N"}, dist:0}`, `action:{kind:"none"}`, `say:null`, `scratchpad:null`).
- Rewrite `convex/schema.ts` `decisionValidator` to mirror.
- Rewrite `convex/_internal_runMatch.ts` mirror.
- Rewrite `tests/llm/decisionTool.test.ts` — cover both variants; cover Azure-Responses re-nesting; cover compile-time TS asserts.
- Rewrite `tests/llm/schemaMirror.test.ts` — live-export comparison must cover BOTH variants (parameterise the schema-side fetch through `buildDecisionTool({useVariant})`).

**Success criteria:**
- All five iter-2 fields (`use / position / action / say / scratchpad`) appear in parser AND validator; no legacy fields (`primary`, `move`, `overwatch_stance`, `consume`, `scratchpad_update`, `action.targetCharacterId`, `move.kind`) appear.
- Variant builder produces the §3.1 narrow `use` shape when called with `useVariant:"null_only"`.
- Schema-mirror byte-equality holds for both variants.
- Sample emitted JSON for each scenario (compass move, toward-targetId move, overwatch+attack combo, counter+loot combo, dist:0 no-op, scratchpad-null carry-forward) round-trips through `parseDecision` → `ParsedDecision` cleanly.
- `npm run lint && npm run typecheck && npm test tests/llm/decisionTool.test.ts tests/llm/schemaMirror.test.ts` — green.

**Blocks:** WP-B, WP-C, WP-D, WP-G, WP-I.

---

### WP-E — Persona name = agent id (substrate touch — early)

**Scope:**
- `convex/matches.ts:255` flip `displayName` to `titleCase(personaId)`.
- `convex/engine/types.ts` export `PERSONA_DISPLAY_NAMES` set + `titleCase` helper.
- `convex/engine/validation.ts` line 299 — `Player_` prefix dispatch → set membership.
- `convex/engine/resolution.ts` line 608 — same.
- `convex/llm/idNormalisation.ts` line 227 — same.
- `convex/llm/inputBuilder.ts` line 211 — DELETE the `^P\d+$` regex fallback path.
- Fixture audit: every test file using `displayName: "Player_N"` updated to persona names (Duelist, Camper, etc.).
- `personas/*.md` + `convex/_data/personas.ts`: light scrub of `Player_N` literal references (e.g. `Player_2` in flavor text) → generic "an enemy" phrasing. NO behaviour tune.

**Success criteria:**
- Every character row's `displayName` is in `PERSONA_DISPLAY_NAMES`.
- A unit assertion in `tests/llm/personas.test.ts` (or a new `tests/llm/personaDisplayNames.test.ts`) guards: every persona file is `Player_N`-clean.
- Corpse rendering produces `Corpse_Camper` etc. (existing `Corpse_${displayName}` template).
- One end-to-end match completes (smoke) with the new displayNames; `tests/runMatch.test.ts` updated.
- `npm test` green for engine/llm/runMatch test families.

**Blocks:** WP-D (event log reads displayName-based traces), WP-F (system prompt placeholder substitution), WP-G (replay UI renders persona names), WP-I (zero `Player_N` literals in closing-20 audit).

---

### WP-B — Engine resolution + validation rewrite

**Scope:**
- `convex/engine/resolution.ts`:
  - Read new `decision.position` instead of `decision.primary` + `decision.move` + `decision.overwatch_stance`.
  - Route `position.move` (toward/away/compass + dist) through the existing movement substep loop (after WP-B engine/movement.ts changes).
  - Route `position.overwatch` to the existing offensive-overwatch-fire pass (renamed semantically; trace emits `kind: "overwatch"`).
  - Route `position.counter` to the existing defensive counter-fire pass (renamed; trace emits `kind: "counter"`).
  - Resolve `decision.action` (attack/loot/none) IN ADDITION to `position` when position is overwatch/counter (action+position combo per ADR-5).
  - Read `decision.scratchpad` instead of `decision.scratchpad_update`; `null` = carry-forward (no overwrite).
  - Drop `revealedBy: "leaving_cover"` emit (ADR-10).
- `convex/engine/movement.ts`:
  - Add `COMPASS_TO_DELTA` table.
  - `position.move.direction.kind ∈ {N…NW}` → walk exactly `dist` tiles in bearing, clamped to budget (8 / 12 speed).
  - `position.move.direction.kind ∈ {toward, away}` with `targetId` → existing per-entity-type `stopAtRange` (Char/Chest/Corpse 2, Wall 1, Cover/Evac 0) capped by `dist`.
  - `dist:0` → emit zero moves; no commit.
- `convex/engine/validation.ts`:
  - Return shape: `{decision, fieldErrors}`. Each rejected field replaced by its safe-default (ADR-6 table).
  - Validate `use` against equipped state (residual case where mid-turn state changed; primary protection is the §3.1 variant in WP-C).
  - Validate `position.move.direction.targetId` against visible-target-id set (existing `resolveTypedEntity`).
  - Validate `action.targetId` against id-namespace + liveness + visibility.
  - DROP the phase-3 stance/primary consistency check (no more stance).
- `convex/runMatch.ts`:
  - Update validator integration: persist `validatorFieldErrors` on `agentRecord.llm` (not `validatorReason`).
- Tests: unit per scenario — combo, counter on attack only, compass for each of 8 bearings, toward/away/targetId, dist:0 stationary, dist clamping at 8 vs 12, field-scoped rejection one field at a time.

**Success criteria:**
- Action+overwatch resolves both arms; trace shows kind:"attack" entry AND (when arming fires) kind:"overwatch" entry with same actor characterId.
- Counter retaliates ONLY on attack received; movement past counter-stance agent does NOT trigger fire.
- All 8 compass bearings produce expected (dx,dy) movement; clamped to 8 base / 12 speed.
- `dist:0` → no movement entry in trace.
- Validator rejection zeros one field, leaves others intact; persisted `fieldErrors` carries field name + reason.
- `npm test tests/engine/* tests/runMatch.test.ts` — green.

**Depends:** WP-A. **Blocks:** WP-D, WP-G, WP-I.

---

### WP-C — Per-turn schema variant builder integration

**Scope:**
- `convex/runMatch.ts`: compute `useVariant` per living agent (`actor.equipped.consumable === undefined ? "null_only" : "consumable_or_null"`); pass to `callDecisionTool`.
- `convex/llm/azure.ts`: accept `useVariant` arg; call `buildDecisionTool({useVariant})`; pass the variant tool body to Azure; thread the discriminator back to the caller for trace persistence.
- `convex/schema.ts`: additive `agentRecord.input.useVariant?: v.union(v.literal("consumable_or_null"), v.literal("null_only"))`.
- `convex/_internal_runMatch.ts`: mirror.
- `runMatch.ts`: persist `useVariant` on the agentRecord input block.
- Tests: integration test that for an agent with equipped consumable, variant is `"consumable_or_null"`; with no consumable, variant is `"null_only"`. Smoke test that an Azure round-trip with `null_only` variant rejects `use:"consumable"` structurally (the model cannot emit it).

**Success criteria:**
- 100% of per-turn calls in a 1-run smoke ship the correct variant given the agent's equipped state at that turn.
- Persisted `useVariant` matches the variant the wrapper sent (round-trip).
- **Three-place contract test (new):** Add `tests/llm/useVariantContract.test.ts` asserting that for a sampled (run, agent, turn) tuple, the variant computed in `runMatch.ts`, the variant body sent by `azure.ts` to `buildDecisionTool(...)`, and the discriminator persisted on `agentRecord.input.useVariant` are all in agreement. Silent drift between these three sites would be a coordination overlay smell.
- `npm test` — green.

**Depends:** WP-A. **Blocks:** WP-G (replay tool-schema pane), WP-I (audit metric).

---

### WP-F — System prompt rewrite (iter-2 verbatim)

**Scope:**
- `convex/llm/systemPrompt.ts`: rewrite to `per-turn-context-intent.md` §1 verbatim. `<Player Name>` placeholder substituted at composition time (in `convex/llm/azure.ts` or `convex/llm/inputBuilder.ts` — implement in the layer that already has `actor.displayName` in scope).
- Drop the `leaving cover` reveal-cause segment.
- Add the combo-range line: `Move range max 8 dist + Attack/loot range 2 = move attack/loot 10.`
- Preserve the phase-4 prompt-hygiene guard: no `safe default` / `replaced with` / `invalid choices` / `fallback` / `do nothing` strings in system prompt OR tool-schema descriptions.
- `tests/llm/systemPrompt.test.ts`: byte-equality (modulo persona-name placeholder) against §1 prose; substitution test (Duelist → renders `You are Duelist, ...`); guard test (no leak strings).

**Success criteria:**
- System prompt matches §1 verbatim modulo `<Player Name>` substitution.
- All 8 persona names substitute correctly.
- Hygiene guard passes.
- `npm test tests/llm/systemPrompt.test.ts` — green.

**Depends:** WP-E (persona-name plumbing for substitution).

---

### WP-D — Input builder rewrite (status block + event log + personal damage feed)

**Scope:**
- `convex/llm/inputBuilder.ts`: rewrite per ADR-7. Sections in order:
  - `# <PersonaName>` heading + persona prompt
  - `## Status` block — 📍 ❤️ ⚔️ 🛡️ 🧪 🗒️ lines with inline stats
  - blank line × 2
  - `# Current Game State` — turn meta line, own-outcome event line, personal damage event line(s), kill feed event line(s), Visible (JSON-style keyed object)
- New `renderDamageEventLines(prev, observer)` per ADR-8.
- Visible block: keyed JSON object (preserve phase-3 entity content; just change serialisation). 8-bearing compass vocabulary preserved.
- DROP the phase-3 `Last turn (you):` line wholesale — its fragments fold into the own-outcome event line of Current Game State.
- `convex/llm/azure.ts`: drop the `## Persona / ## Scratchpad / ## Visible state` wrapper; persist `composedUserMessage = inputBuilder.buildAgentInput(...)` body verbatim.
- Tests: snapshot test against §2 example at turn 44 (Duelist scenario); LOS-independent attribution (attacker not in current Visible still produces a damage line); equipment-stats inlining for all weapon/armour/consumable names; `Player_N` regex grep over rendered messages returns 0 matches.

**Success criteria:**
- §2 example renders byte-equal at the documented turn state (modulo persona prompt body which is loaded from disk).
- Personal damage line appears every post-damage turn (10/10 sample assertion).
- LOS-independent: damage line emitted even when attacker not in observer's current Visible.
- Equipment stats render inline correctly for all 4 weapons / 4 armours / 2 consumables.
- `npm test tests/llm/inputBuilder.test.ts tests/llm/integration.test.ts` — green.

**Depends:** WP-A (decision shape), WP-B (engine trace entries), WP-E (persona-name displayName), WP-F (system prompt for end-to-end smoke). **Blocks:** WP-G (raw-pane snapshot), WP-I (closing measurement).

---

### WP-G — Replay UI updates

**Scope:**
- `apps/replay/src/lib/decisionEnglish.ts`: rewrite for new arms.
  - `position.kind`: "Held overwatch" / "Held counter" / "Moved <dist> <bearing>" / "Moved toward <targetId> up to <dist>" / "Moved away from <targetId> up to <dist>" / "Stationary (dist 0)"
  - `action.kind`: "Attacked <targetId>" / "Looted <targetId>" / no action line
  - `use`: "Used consumable" / no consume line
  - `scratchpad`: null = "(carried forward)" / non-null = update fragment
  - Compose intentVsOutcome: position-intent vs movement-outcome; action-intent vs action-outcome; overwatch-trigger-fire vs trigger-outcome; counter-fire vs counter-outcome
- `apps/replay/src/lib/rawPane.ts`:
  - Tool-schema pane: read `agentRecord.input.useVariant` and call `buildDecisionTool({useVariant})` to render the SHIPPED schema. **No production fallback** for the phase-3 const — the DB is wiped in WP-H so persisted traces are guaranteed phase-6 shape. Phase-3-shape historical fixtures (if retained for the replay UI's pre-phase-6 test suites) are handled by a test-only branch guarded behind a fixture detector; that branch MUST NOT participate in the production render path.
  - Validator errors: render `agentRecord.llm.validatorFieldErrors` per-field with field name + reason. Same posture as above — `validatorReason` is test-only fallback for historical fixtures; production traces are field-scoped only.
- `apps/replay/src/lib/__tests__/decisionEnglish.test.ts` + `rawPane.test.ts`: fixture updates + new-arm tests.

**Success criteria:**
- Every new-arm decision shape renders in English (snapshot tests per ADR-5 combos + ADR-2 arms).
- Tool-schema pane shows the SHIPPED variant per (run, agent, turn) — verified by a fixture where `useVariant === "null_only"`.
- Field-scoped validator errors render per-field; no "whole turn rejected" wording remains.
- `npm test apps/replay/src/lib/__tests__/*` — green.

**Depends:** WP-A, WP-B, WP-C, WP-D. **Blocks:** WP-I (user verifies closing-20 via replay UI).

---

### WP-H — Persona prompt scrub + Convex dev DB wipe + smoke

**Scope:**
- Audit all 8 persona prompts in `personas/*.md` and `convex/_data/personas.ts` for dead field references:
  - `overwatch_priority` (phase-1 / pre-phase-3 vocab)
  - `overwatch_stance` (phase-3 vocab)
  - `primary` / `consume` / `scratchpad_update` / `move.kind: relative`
  - `Player_N` literal references in flavor text
- LIGHT TOUCH ONLY — mechanical scrub to iter-2 vocabulary. Reword flavor sentences as necessary. NO behavior tune (separate phase).
- Update `tests/llm/personas.test.ts` cross-check assertions accordingly.
- Wipe Convex dev DB using the existing `spike:wipeOneTable` paginated helper (see `convex/spike.ts:52-78`; phase-5 closure used the same path — `docs/project/phases/05-move-arm-consolidation/closure.md:30-49`):
  ```bash
  # iterate per table until moreToGo===false on each
  for table in turns characters matches worldState runs reports; do
    while : ; do
      out=$(npx convex run spike:wipeOneTable "{\"table\":\"$table\"}")
      echo "$out"
      echo "$out" | grep -q '"moreToGo": false' && break
    done
  done
  # then push new schema
  npx convex dev --once --typecheck=disable
  ```
  Document the exact commands run and per-table row counts deleted in `closure.md` for reproducibility. If a new bulk helper is desired for ergonomics, add it explicitly in WP-H scope; do NOT reference a `wipeAll` helper that does not exist.
- **Repo-wide `Player_N` source-grep cleanup gate (new):** the cleanup gate is repo-wide, not just personas. Run `grep -rnE "Player_[0-9]+|Player_\\$\\{" convex/ apps/ tests/ harness/ personas/ --include='*.ts' --include='*.tsx' --include='*.md'` AND assert zero matches outside of documented historical-doc exclusions. Allowed exclusion list (documented in closure.md): historical phase docs in `docs/project/phases/0{1,2,3,4,5}-*` and the phase-6 plan-review document itself (it cites the old form in evidence).
- One end-to-end smoke match completes against the wiped deployment with the new substrate.

**Success criteria:**
- Persona prompts mention only iter-2 vocabulary. `grep -rE "overwatch_priority|overwatch_stance|primary|consume|scratchpad_update|move\.kind|Player_\d" personas/ convex/_data/personas.ts` returns 0 matches.
- Repo-wide `Player_N` source grep (above) returns 0 matches outside the allowed exclusion list.
- `npx convex dev` reaches a clean push against the wiped deployment.
- One end-to-end smoke match completes.

**Depends:** WP-A through WP-G landing. **Blocks:** WP-I.

---

### WP-I — Closing-20 run + report aggregator + closure record

**Scope:**
- `convex/reports/phase6.ts`: NEW module. Pure aggregator + Convex action wrapping `reports.create` for `reportType: "phase-6-closing-20"`.
  - Carry-over phase-3 metrics (extraction / kill / equip / speech / persona-spread / zero-crashes).
  - Iter-2 specific metrics (§2 table above):
    - `useVariantViolations`, `actionOverwatchCombos`, `overwatchTriggerFires`, `counterRetaliations`, `compassBearingsExercised`, `towardAwayUsed`, `personalDamageFeedAuditSampleRate`, `wholeTurnValidatorZeros`, `perFieldRejectionRate` (≤ 10%; phase-3 baseline analog of `fellBackToSafeDefault 8.256%`), `noOpRate` (iter-2 redefined), `playerNLiteralCount`.
  - **Formula notes (explicit before implementation):**
    - `overwatchTriggerFires` = count of trace rows where `kind==="overwatch"` AND `triggeredByMovement===true` AND `result` matches `/^dmg \d+$/`. The `triggeredByMovement` marker is required (see ADR-5 movement-trigger semantics); damage rows alone are NOT sufficient evidence.
    - `personalDamageFeedAuditSampleRate` = for the deterministic first 20 eligible (run, agent, turn) tuples in match/turn/record iteration order where damage was taken on turn N (any inbound trace entry where `kind ∈ {attack, overwatch, counter}` and persona-normalised `target === agent.displayName`), assert `agentRecord.input.composedUserMessage` at turn N+1 contains the exact `<Attacker> attacked you with <weapon> (dmg X)` line. Score = matches / sample-size; target = 1.0. Damage on the final turn and damage where the victim has no next-turn agent record (including victim dies) are excluded from the audit window and recorded in `damageFeedAuditScopeNote`.
    - `noOpRate` per §11.4 — explicit field expression: `decision.use === null` AND `decision.say === null` AND `decision.action.kind === "none"` AND ((`decision.position.kind === "move"` AND `decision.position.dist === 0`) OR (`decision.position.kind ∈ {overwatch, counter}` AND `decision.action.kind === "none"`)). Divide by total (run, agent, turn) tuples; target < 0.05.
    - `playerNLiteralCount` = scoped count of agent-facing surfaces containing `Player_<digit>` literal: `agentRecord.input.composedUserMessage`, `agentRecord.input.personaPromptText`, `agentRecord.llm.rawArguments`, `agentRecord.decision.*.targetId`, `resolution.actions[].target`, `characters.displayName`, and agent-facing strings in persisted report payloads. Target = 0. Do not JSON-stringify whole Convex rows or count arbitrary Convex ids.
    - `wholeTurnValidatorZeros` = count of `agentRecord.llm.validatorFieldErrors` entries where {use, position, action, say, scratchpad} ALL have a fieldErrors entry. Target = 0.
    - `perFieldRejectionRate` = sum over all agentRecords of `Object.keys(validatorFieldErrors || {}).length`, divided by (total agentRecords × 5 fields). Target ≤ 10%.
- `convex/schema.ts` + mirror: additive `reports.phase6Payload?: v.object({...})` validator.
- `harness/run.ts`: extend with a 20-run closing cohort path; fire 20 runs at `low/1200`; on completion schedule `convex run reports/phase6:computePhase6Report`.
- `docs/project/phases/06-per-turn-context-iter-2/PHASE-6-CLOSURE.md`: closure record per phase-1/3 convention. Threshold table with PASS / WHY-NOT per metric.
- `docs/project/spec/concept-spec.md`: update §9 (decision economy) + §10 (movement) + §11 (overwatch/counter) to iter-2 vocabulary.

**Success criteria:**
- Persisted report row queryable via `convex run reports:getById` (or equivalent existing getter).
- All phase-3 carry-over thresholds met OR documented why-not in closure.md.
- All iter-2 specific thresholds met OR documented why-not.
- 20 runs completed with zero crashes (smoke pass).
- User opens any of the 20 runs in replay UI and confirms the new mechanics visible.

**Depends:** WP-A through WP-H.

## 8. Assignment-Level Success Criteria

This phase closes when ALL of the following hold:

1. **Substrate is iter-2 shape.** `agentRecord.decision` carries
   `use / position / action / say / scratchpad` — no `primary`,
   `overwatch_stance`, `consume`, `scratchpad_update`, or
   `action.targetCharacterId` in any persisted trace.

2. **Persona name is the agent id.** `Player_N` literal grep returns 0
   across all persisted traces, persona prompts, code, and tests in the
   closing-20 cohort.

3. **Per-turn variant works structurally.** Zero traces emit
   `use:"consumable"` with nothing equipped across the 20 runs.

4. **Action + position combos resolve.** ≥ 10 action+overwatch combo
   traces; ≥ 5 overwatch trigger-fires (fire on movement); ≥ 5 counter
   retaliations (fire on attack); ≥ 5 combo traces show both arms
   landing.

5. **Compass + target-relative grammar exercised.** All 8 compass
   bearings appear ≥ 1 time across the 20 runs. Both `toward` AND `away`
   target-relative arms appear ≥ 1 time.

6. **Personal damage feed works.** Audit sample (deterministic first 20
   eligible post-damage turns) shows the damage line emitted with correct
   attribution every time, including LOS-independent cases.

7. **Field-scoped validation works.** Zero traces show every field
   zeroed (always at least one field survives validation when
   `validatorFieldErrors` is non-empty).

8. **No-op rate < 5%** (iter-2 redefined — see §11.4 below).

9. **Phase-3 carry-over thresholds preserved.** Extraction ≥ 30%, kill
   ≥ 80%, equip ≥ 80%, speech ≥ 50%, persona spread ≥ 15 pp, zero
   crashes — measured on the same 20 runs.

10. **Diagnostic surfaces live in the replay UI.** Per-turn tool-schema
    variant pane, field-scoped validatorFieldErrors render, decisionEnglish
    for new arms — verified by the user stepping through ≥ 3 of the 20 runs.

11. **Hard gates green.** lint + typecheck + build + test all green at
    root AND `apps/replay/`. Schema↔mirror parity test passing.

12. **Closure doc written.** `PHASE-6-CLOSURE.md` records the
    threshold-vs-actual table, the persisted reportId, the wipe
    procedure used, and any why-not for residual misses.

## 9. Ambiguities / decisions surfaced for PM sign-off

These are calls I made in the spec; flagging them in case PM disagrees:

1. **Visible-object serialisation = JSON-style keyed.** Per
   `per-turn-context-intent.md` §4 the format is "an empirical probe"
   that phase-4 was supposed to pick. Phase 6 has no probe budget
   (north-star locks `low/1200` + no probes). The pragmatic call: ship
   JSON-style keyed (most-trained-on form); defer YAML / keyed-inline
   probes to a post-phase-6 slice. **Alternative:** stay on phase-3
   bullet-style Visible and probe-then-pick later. My recommendation:
   ship JSON; it's what the intent doc's example implies via
   `{visibleObj...}` placeholder shape.

2. **Safe default for the new shape = `dist:0` no-op move.** The new
   shape has no `primary === "stationary_action"` analogue. I picked
   `position:{kind:"move", direction:{kind:"N"}, dist:0}` for the
   safe-default decision over `position:{kind:"counter"}` because the
   former is a true no-op (no stance commitment); the latter would emit
   a defensive readiness signal the model didn't intend.

3. **Overwatch ↔ Counter mapping retires the `stance` field.** Phase-3
   defensive counter-fire = phase-6 `position: {kind:"counter"}`; phase-3
   offensive overwatch = phase-6 `position: {kind:"overwatch"}`. The
   `kind` carries the discrimination structurally — no need for a
   separate `stance` axis. Trace `actions[].kind` adds `"counter"`
   alongside `"overwatch"`. Backwards compat with phase-3 traces handled
   by the DB wipe.

4. **`leaving_cover` reveal cause retired from engine emit** (ADR-10).
   System prompt drops it from teaching; substrate aligns by no longer
   producing new entries with that cause. Historical phase-3 traces with
   the cause stay readable by the replay UI (type literal preserved).

5. **`validatorFieldErrors` is a structured Convex `v.object({use?,
   position?, action?, say?, scratchpad?})`** rather than a JSON-encoded
   string in the legacy `validatorReason` field. POC schema break is
   authorised; structured shape matches the replay-UI per-field render
   need.

6. **`useVariant` is persisted as a discriminator** (one enum literal
   per agentRecord), not as the full shipped schema text. Trace footprint
   stays small (`(20 runs × 50 turns × 8 agents × ~30 bytes)` vs full
   schema text), and the replay UI reconstructs the shipped schema via
   `buildDecisionTool(...)` at render time.

7. **Persona prompt scrub is LIGHT TOUCH.** WP-H rewords flavor text
   that names `Player_N` literals (e.g. "Player_2 looks weak") to
   generic phrasing ("a weak enemy"). Reference field-name scrubbing
   (`overwatch_priority`, `overwatch_stance`, `consume`,
   `scratchpad_update`) is mandatory. Deep behaviour tuning is OUT.

8. **One-of-each-persona invariant.** Phase-1's
   `assignPersonasToSpawnsInline` already enforces uniqueness when the
   inputs are the 8 PERSONA_IDS. No new code; just an assertion in
   `tests/llm/personas.test.ts` that the assignment for any seed is a
   permutation, not a multiset.

## 10. Recommended job sequence (for PM)

1. **WP-A + WP-E concurrently.** Substrate contract + persona-id rename.
   Both can land in parallel — WP-A touches schema/types/parser/tests;
   WP-E touches matches.ts + dispatch sites + fixtures + persona files.
   Disjoint write sets except for `convex/engine/types.ts` (both add
   exports). Coordinate via a single commit ordering on `types.ts`.

2. **WP-B + WP-C + WP-F concurrently** (after A + E ratify).
   - WP-B is the big engine slice; reviews benefit from a dedicated
     reviewer pass after it lands.
   - WP-C is a focused thread-through with one schema additive.
   - WP-F is the system-prompt verbatim swap + hygiene-guard preserved.
   Disjoint write sets across the three.

3. **WP-D + WP-G concurrently.** Input builder rewrite + replay UI
   rewrite. WP-G fixtures may lag WP-D by half a day to wait for
   inputBuilder snapshot test stabilisation, but otherwise parallel.

4. **WP-H.** Persona scrub + DB wipe + smoke. Single sequencer step.

5. **WP-I.** Closing-20 run + aggregator + closure doc. Single sequencer
   step. **Review-pass before WP-I:** code-review the assembled
   substrate end-to-end before firing the 20-run cohort. The cohort is
   the verification; the review is the validation.

**UAT placement:** the closing-20 run IS the UAT — the user steps through
runs in the replay UI as the verdict gate. Pre-closing smoke (one match
end-to-end after WP-H) is the developer-side smoke. No separate UAT
slice.

**Review vs implement first:** implement first per phase-1/2/3 rhythm.
Reviews fold into each WP's acceptance gate (every WP needs `npm test`
+ a brief diff review before merge). A final code-review pass between
WP-H and WP-I catches any drift from the intent-anchor prose.

## 11. Notes + cross-refs

### 11.1 Empirical anchor

`harness/probe-schema-emission.ts` + `probe-schema-emission-output.json`
(2026-05-12) proved the Azure Responses endpoint **auto-normalises tool
schemas to strict mode**:

- Input: tool with 1 required field, 4 optional.
- Output (echoed by `bodyJson.tools[0]`): `required: ["entree", "appetizer", "dessert", "drink", "notes"]` (all 5).
- Output (5x emission runs): every call emits all 5 keys, even when the customer asked for "Order a pizza" with nothing else.

This is why **structural design** is the right lever — not "mark fields
optional." The per-turn variant principle (§3.1) and the anyOf
discriminated unions in `position` are the load-bearing levers; the
`required[]` list in the JSON Schema is decorative.

### 11.2 Intent anchor protocol

`decision-tool-schema-draft.md` §3 is the verbatim schema; `§3.1` is the
verbatim use-variant. Phase 6 implements them as written, re-nested into
the Azure Responses flat shape per Q10 resolution. ANY deviation from §3
/ §3.1 surface must be flagged to the user for re-ratification.

`per-turn-context-intent.md` §1 is the verbatim system prompt; §2 is the
verbatim user-role layout; §3 defines personal/global event channels.
Phase 6 implements them as written.

### 11.3 References (sources of truth)

- `docs/project/spec/mental-model.md` §15 — phase-6 dispatch record + pillar alignment + authority grants
- `docs/project/spec/decision-tool-schema-draft.md` — verbatim tool schema, §3 main + §3.1 use-variant + §6 resolved Q-decisions
- `docs/project/spec/per-turn-context-intent.md` — verbatim system prompt + user-role layout + §3 personal/global event channels
- `harness/probe-schema-emission.ts` + `harness/probe-schema-emission-output.json` — empirical anchor for strict-mode normalisation
- `docs/project/phases/03-substrate-refinement/PHASE-3-CLOSURE.md` — phase-3 closing thresholds (the non-regression bar)
- `docs/project/phases/04-context-redesign/README.md` — phase-4's parked WP-D context (superseded by this phase's WP-D)
- `docs/project/phases/05-move-arm-consolidation/README.md` — phase-5's 4-arm grammar (replaced by iter-2 position.move shape; phase-5 closure stays as historical record)

### 11.4 No-op rate — iter-2 definition

A turn is a **no-op** when ALL of:
- `decision.use === null`
- `decision.say === null`
- `decision.action.kind === "none"`
- `decision.position` resolves to no movement, i.e.:
  - `position.kind === "move"` AND `position.dist === 0`, OR
  - `position.kind ∈ {overwatch, counter}` AND `action.kind === "none"` (stance with no committed action)

`position: {kind: "overwatch", ...}` with `action: {kind: "attack" | "loot", ...}` is **NOT** a no-op — it is a commitment (attack+overwatch combo). Counter+attack same logic.

Engineering target: < 5% across all (run, agent, turn) tuples in the
20-run cohort.

### 11.5 Token budget cross-check

The new shape is ~ flat token-neutral vs phase-3:
- System prompt slim (≤ 200 tokens) — same as phase-4
- Status block (~ 50 tokens) + Current Game State (~ 100-200 tokens incl. Visible-keyed)
- Tool schema (~ 350-400 tokens including all descriptions; per-turn variant doesn't change the count materially)

Locked at `low/1200` max_output_tokens per the assignment. If
truncation rate surfaces as a problem in the 20-run cohort, that's a
post-phase-6 probe — flagged in closure.md, not a phase-6 gate.

---

*Phase folder convention follows phase-1..5. Supplementary docs
(`architecture-decisions.md`, `work-packages.md`, `de-risking.md`) MAY
be created by their respective WPs if scope warrants — this README.md
is the canonical dispatch artefact at phase open.*
