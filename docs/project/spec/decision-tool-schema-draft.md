# Decision-Tool Schema — Draft (2026-05-12)

> **Status:** Draft, in-flight redesign. Owned by Outcome Steward.
> Sibling to [`per-turn-context-intent.md`](./per-turn-context-intent.md).
> Refines the per-turn tool-call shape after the schema-emission probe
> (`harness/probe-schema-emission.ts`) and the Azure-structured-outputs
> doc review of 2026-05-12.
>
> **Iteration 2 (2026-05-12)** — user-authored verbatim schema below
> in §3. Notable shifts from iteration 1: `hold` arm removed (counter
> is the neutral-ready alternative — only attacks if attacked); `say`
> field reinstated as top-level (iter-2 first pass dropped it by
> oversight — see §3, §6 Q1 resolved); raw `(dx, dy)` arm removed
> (compass + dist is the only relative form — Visible's 8-bearing
> vocab and the schema now share); per-turn schema **variant**
> introduced for the no-consumable case (§3.1) — narrows the `use`
> field's type to `["null"]` when no consumable is equipped, so an
> illegal `use:"consumable"` becomes structurally unrepresentable.
> Validator rejection of `use:"consumable"` when nothing's equipped
> is **field-scoped** (zeros only `use`, not the whole turn).
>
> **Persona name = agent id.** All `targetId` strings (and corpse
> ids) use the persona name (`Duelist`, `Camper`, ..., `Corpse_Camper`)
> rather than `Player_N`. See
> [`per-turn-context-intent.md`](./per-turn-context-intent.md) move 0.

---

## 0. Why this draft exists

The phase-3 / phase-4 `decide_turn` shape carried three smells the
probe + doc-review exposed:

1. **`primary` was a coordination overlay**, not a real verb. It encoded
   "what kind of turn is this," sat alongside `move` and `action` as
   peer fields, and let illegal combinations through structurally
   (`primary='overwatch'` with `move.kind='toward_entity'`). Cross-field
   rules in Zod refines were papering over a bad shape.
2. **`overwatch_stance` was a second coordination overlay** that only
   meant anything when `primary='overwatch'`. Required-nullable with a
   refine relating it to `primary`. Same smell, smaller.
3. **`consume` asked the model to name `heal` / `speed`** — but the
   engine already knows which consumable is equipped. The model was
   restating data it didn't author.

The probe also confirmed: Azure Responses-API auto-normalises tool
schemas to strict mode, so `required[]` and "optional" are decorative —
all declared properties get emitted on every call. The right lever for
*fewer fields per turn* is **structural** (fewer properties declared at
all, plus per-turn schema variants), not "mark them optional."

This draft is the structural fix.

---

## 1. Target shape (shorthand)

```ts
decide_turn = {
  use: "consumable" | null,           // narrows to `null` when no consumable equipped (§3.1)

  position:
    | { kind: "overwatch" | "counter" }
    | {
        kind: "move",
        direction:
          | { kind: "toward" | "away", targetId: string }
          | { kind: "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW" },
        dist: integer
      },

  action:
    | { kind: "none" }
    | { kind: "attack" | "loot", targetId: string },

  say: string | null,                  // broadcast speech this turn; reveals you in cover

  scratchpad: string | null            // null = carry prior scratchpad forward unchanged
}
```

Per-turn decision economy reads:
1. **Use equipped consumable slot?** (`use` — narrowed by per-turn variant if nothing equipped)
2. **Position commitment.** (`position` — overwatch / counter / move)
3. **Immediate action.** (`action` — attack / loot / none)
4. **Speak?** (`say` — free; broadcast within hearing range; reveals if hidden in cover)
5. **Update memory.** (`scratchpad` — write or carry forward unchanged)

---

## 2. Examples

**Speed-rush a crate:**

```json
{
  "use": "consumable",
  "position": {
    "kind": "move",
    "direction": { "kind": "toward", "targetId": "Crate_012" },
    "dist": 8
  },
  "action": { "kind": "loot", "targetId": "Crate_012" },
  "say": null,
  "scratchpad": "Use speed to close on the crate and loot if reachable."
}
```

**Overwatch + attack:**

```json
{
  "use": null,
  "position": { "kind": "overwatch" },
  "action": { "kind": "attack", "targetId": "Vulture" },
  "say": null,
  "scratchpad": "Shoot Vulture while holding offensive guard."
}
```

**Compass retreat with parting threat:**

```json
{
  "use": null,
  "position": {
    "kind": "move",
    "direction": { "kind": "NW" },
    "dist": 5
  },
  "action": { "kind": "none" },
  "say": "Touch me again and I split your skull at evac.",
  "scratchpad": null
}
```

**Counter-stance negotiation:**

```json
{
  "use": null,
  "position": { "kind": "counter" },
  "action": { "kind": "loot", "targetId": "Corpse_Camper" },
  "say": "Truce until evac. I split with whoever doesn't fire.",
  "scratchpad": "Trying truce. Watch Trader for hostile move."
}
```

---

## 3. JSON Schema (user-authored, verbatim — iteration 2)

```jsonc
{
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "decide_turn",
        "description": "Choose position commitment, action, memory update, and whether or not to use your consumable.",
        "strict": true,
        "parameters": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "use",
            "position",
            "action",
            "say",
            "scratchpad"
          ],
          "properties": {
            "use": {
              "type": [
                "string",
                "null"
              ],
              "enum": [
                "consumable",
                null
              ],
              "description": "Use your equipped consumable slot, or null to use nothing."
            },
            "position": {
              "description": "Choose exactly one position commitment: hold a stance, or move in a target-relative or compass direction by up to dist range.",
              "anyOf": [
                {
                  "type": "object",
                  "additionalProperties": false,
                  "required": ["kind"],
                  "properties": {
                    "kind": {
                      "type": "string",
                      "enum": ["overwatch", "counter"],
                      "description": "No movement. 'overwatch' attacks anyone that moves into range, and 'counter' is defensive retaliation stance."
                    }
                  }
                },
                {
                  "type": "object",
                  "additionalProperties": false,
                  "required": ["kind", "direction", "dist"],
                  "properties": {
                    "kind": {
                      "type": "string",
                      "enum": ["move"],
                      "description": "Move by up to dist tiles in the chosen direction."
                    },
                    "direction": {
                      "description": "Direction of movement. Target-relative directions require targetId; compass directions do not.",
                      "anyOf": [
                        {
                          "type": "object",
                          "additionalProperties": false,
                          "required": ["kind", "targetId"],
                          "properties": {
                            "kind": {
                              "type": "string",
                              "enum": ["toward", "away"],
                              "description": "Move toward or away from a visible entity."
                            },
                            "targetId": {
                              "type": "string",
                              "description": "Visible entity id. Copy verbatim from Visible."
                            }
                          }
                        },
                        {
                          "type": "object",
                          "additionalProperties": false,
                          "required": ["kind"],
                          "properties": {
                            "kind": {
                              "type": "string",
                              "enum": ["N", "NE", "E", "SE", "S", "SW", "W", "NW"],
                              "description": "Compass bearing to move."
                            }
                          }
                        }
                      ]
                    },
                    "dist": {
                      "type": "integer",
                      "description": "Maximum attempted movement distance in tiles."
                    }
                  }
                }
              ]
            },
            "action": {
              "description": "Choose exactly one immediate action. Action is either no-payload or target-based.",
              "anyOf": [
                {
                  "type": "object",
                  "additionalProperties": false,
                  "required": [
                    "kind"
                  ],
                  "properties": {
                    "kind": {
                      "type": "string",
                      "enum": [
                        "none"
                      ],
                      "description": "Take no immediate action."
                    }
                  }
                },
                {
                  "type": "object",
                  "additionalProperties": false,
                  "required": [
                    "kind",
                    "targetId"
                  ],
                  "properties": {
                    "kind": {
                      "type": "string",
                      "enum": [
                        "attack",
                        "loot"
                      ],
                      "description": "Attack a visible living character or loot a visible crate/corpse. Pair with `position.move.toward` to close actopm range delta."
                    },
                    "targetId": {
                      "type": "string",
                      "description": "Visible target id. Copy verbatim from Visible."
                    }
                  }
                }
              ]
            },
            "say": {
              "type": [
                "string",
                "null"
              ],
              "description": "Speech broadcast to every agent within hearing range this turn. Reveals you if hidden in cover. Use for lies, threats, truces, baiting. Use null to stay silent."
            },
            "scratchpad": {
              "type": [
                "string",
                "null"
              ],
              "description": "Private memory carried to future turns. Use for long term planning, trauma, critical observations. Use null to keep prior scratchpad unchanged."
            }
          }
        }
      }
    }
  ]
}
```

### 3.1 Per-turn variant — no consumable equipped

When the agent has no consumable in the equipped slot for the current
turn, ship this narrower `use` field in place of the one in §3:

```json
"use": {
  "type": [
    "null"
  ],
  "enum": [
    null
  ],
  "description": "No consumable is currently equipped, so nothing can be used."
}
```

**Implication.** The schema itself reflects per-turn equipped-state
truth. `use: "consumable"` is *structurally unrepresentable* when
nothing is equipped — no validator rejection needed. This is the same
principle as discriminated arms (`anyOf`): push illegal combinations
into shape-mismatches the model can't even attempt to emit.

Architectural consequences:
- Tool schema generation moves from compile-time `const` to per-turn
  build (the agent's equipped state is the only input that varies).
- Replay UI's tool-schema pane (per phase-4 intent §6) must render
  the *per-turn shipped schema*, not a static reference — diagnostic
  surface depends on knowing what the model was actually shown.
- This principle could extend further: narrow `action.attack`/`loot`
  arms based on whether a viable target is in Visible, narrow
  `position.move.toward` based on whether any entity is targetable.
  Slippery slope — see Q9.

---

## 4. What this shape makes structurally impossible

| Old illegal combination | Why it's gone |
|---|---|
| `primary='overwatch'` + `move.kind='toward_entity'` | `overwatch` is a `position` arm; `move` is a different arm. Can't pick both. |
| `primary='overwatch'` + `overwatch_stance=null` | Stance fold-in: `overwatch` / `counter` are first-class position kinds. |
| `primary='stationary_action'` + `move.kind='toward'` (move silently ignored) | Stationary commitments (`overwatch` / `counter`) have no `direction` / `dist` fields at all. |
| `consume='heal'` with no heal equipped | Model can't name the consumable; engine decides what gets used. Per-turn variant §3.1 makes `use:"consumable"` itself unrepresentable when nothing is equipped. |
| `relative dx=-99 dy=99` (out-of-range raw delta) | `direction` is target-id or compass; `dist` is the only scalar, capped by engine. No raw delta arm. |

---

## 5. Migration shape

Schema break is acceptable under POC posture
(`project_poc_schema_wipe_acceptable`). Touchpoints (non-exhaustive):

- `convex/llm/decisionTool.ts` — JSON Schema + Zod parser, full
  rewrite. **Also**: schema construction moves from `const` export to
  per-turn builder fn that takes equipped state.
- `convex/llm/azure.ts` — `requestBody.tools[0]` now sourced from the
  per-turn builder. Trace persistence (or replay-side reconstruction)
  must capture which schema variant was shipped.
- `convex/engine/types.ts` — `ParsedDecision` shape change, downstream
  type lock.
- `convex/engine/resolution.ts` — resolution dispatch reads the new
  shape; move arms split (`direction.kind` ∈ {toward, away, compass}).
  Compass→`(dx,dy)` conversion table at one point.
- `convex/engine/validation.ts` — old refine logic deleted; engine
  validator gains: target liveness check (attack), target type check
  (loot vs. attack dispatch by id namespace), dist clamping, no-op on
  `dist:0`. Rejection policy is **field-scoped** (zero the offending
  field with a `validatorReason`; other fields still resolve).
- `convex/schema.ts` — `decisionValidator` rebuild; Convex state wipe.
- `convex/llm/inputBuilder.ts` — visible digest unaffected; system
  prompt unaffected (schema descriptions teach the grammar).
- `apps/replay/src/lib/decisionEnglish.ts` — render the new shape in
  human English (overwatch/counter, compass+dist, etc.).
- `apps/replay/src/lib/__tests__/decisionEnglish.test.ts` — fixture
  update.
- `apps/replay/src/lib/rawPane.ts` — tool-schema pane must show the
  per-turn variant that was sent (§3.1 implication).
- `tests/llm/decisionTool.test.ts`,
  `tests/llm/schemaMirror.test.ts`,
  `tests/engine/*.test.ts` — broad rewrite.
- `convex/_data/personas.ts` — persona prompts mention the old arm
  names (e.g. "use scratchpad", "overwatch_priority"); audit + rewrite.

---

## 6. Open questions

### Q1 — `say` field placement *(resolved)*

Iteration-2 first pass dropped `say` by oversight. Decision: **keep
top-level** as `say: string | null` (iteration-1's original position).
Speech remains a free action that does not compete with attack/loot on
the action slot. Pillar 5 / pillar 6 preserved.

### Q2 — No `hold` arm: counter is the neutral-ready alternative *(resolved)*

Intentional drop. `counter` *only* attacks if attacked — so a counter
stance is the neutral-ready posture (stand still, retaliate if hit, but
don't fire on movement into range). `overwatch` is the aggressive
sibling (fire on first valid in-range enemy). Two flavours of
"standing"; no separate `hold` needed.

Persona reads:
- Camper / Rat / Trader-trying-to-negotiate → `counter` (passive
  readiness; doesn't fire unprovoked).
- Ambusher / Duelist holding angle → `overwatch` (active threat;
  fires on the first thing that walks in).

### Q3 — `scratchpad: null = carry forward unchanged` *(resolved)*

Confirmed in the iteration-2 description:
> *"Use null to keep prior scratchpad unchanged."*

The engine overwrites scratchpad only on non-null emission. Today's
`scratchpad_update` "write-or-clear" semantic is dropped.

### Q4 — Naming: `position` *(resolved)*

User retained `position` through iteration 2.

### Q5 — `use` enum vs. boolean *(resolved)*

User retained `enum: ["consumable", null]` with `type: ["string","null"]`.
Self-describing in raw JSON.

### Q6 — `dist: 0` semantic *(resolved)*

`dist: 0` resolves as a no-op (stationary). Required for the
"loot at feet" use case under Q2's no-`hold`-arm shape — emit
`position: {kind:"move", direction:{...}, dist:0}` to stand still.

### Q7 — Per-turn schema variants vs. validator rejection *(resolved)*

Iteration 2 introduces variant-by-state (§3.1). The principle: *make
the impossible structurally unrepresentable*. Validator rejection only
applies to combinations the schema can't express.

Validator-rejection policy when residue still slips through (e.g.,
mid-flight state changes): **field-scoped, not turn-scoped.** Zeroing
the offending field with a `validatorReason` is the correct response;
the rest of the turn still resolves. Example: `use:"consumable"` with
nothing equipped → engine treats `use` as `null`, surfaces a
`validatorReason` on the trace, resolves `position`/`action`/`say`/
`scratchpad` normally.

Open: how far to push variants? See Q9.

### Q8 — Compass-only direction *(resolved)*

Intentional drop of raw `(dx, dy)`. Reasoning:
- Raw delta confuses the model; it mis-emits coordinate-style fields
  more readily than direction-style.
- Visible already presents bearings in 8-way compass (`dist 7 SE`);
  the schema's `direction.compass` mirrors the same vocabulary the
  model is *reading*.
- 8 bearings is sufficient granularity for arena-scale movement.
- Knight's-moves (e.g., "3 east, 2 south") are unrepresentable;
  this is accepted scope.

### Q9 — How far to extend per-turn schema variants *(resolved)*

**Stop at the `use` variant.** Equipped state is small and high-
signal; further variant extensions (visible-id enums for
`action.targetId` / `direction.toward.targetId`) balloon schema size,
busts API-layer caching, and yields diminishing returns. Validator
rejection (field-scoped — Q7) handles the residue.

### Q10 — API surface *(resolved)*

**Stay on the Responses API.** The verbatim Chat-Completions-style
schema in §3 is re-nested at integration time into the Responses-API
flat shape: `{type:"function", name, description, parameters}` —
no nested `function:` wrapper, no `strict` flag (strict is implicit
on Responses per the Azure docs). The phase-3 reasoning-capture
pipeline stays intact.

---

## 7. Cross-references

- [`mental-model.md` §6](./mental-model.md) — pillars 2, 5, 6 are
  load-bearing for Q1 (speech absence) and Q2 (no `hold`).
- [`per-turn-context-intent.md`](./per-turn-context-intent.md) — schema
  descriptions are the teaching surface (§5).
- `harness/probe-schema-emission.ts` + `probe-schema-emission-output.json`
  — empirical evidence that Responses API normalises to strict.
- Azure structured-outputs doc (in-thread on 2026-05-12) — confirms
  `anyOf` support, strict-mode constraints, unsupported keyword list
  (`minLength`, `maxLength`, `minimum`, `maximum` — drives §6 Q6).

---

*This draft will be refined by the user and either land verbatim or be
re-cooked into a phase-6 plan. Schema break + Convex wipe are on the
table per POC posture.*
