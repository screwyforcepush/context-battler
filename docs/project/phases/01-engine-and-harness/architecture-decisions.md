# Phase 01 — Architecture Decisions

> Decisions this phase needs to make that are not already locked in `docs/project/spec/architecture.md`. Each is an ADR-shaped block: decision, rationale, alternatives considered, consequences. Stable for the duration of the phase; revisit only if implementation surfaces a fact that breaks the assumption.

---

## 1. Runtime, language, package layout

**Decision.** TypeScript everywhere. Single package, no monorepo. Top-level layout:

```
context-battler/
├── convex/                 # Convex actions + mutations + queries (engine + state)
│   ├── schema.ts
│   ├── matches.ts          # match lifecycle mutations + queries
│   ├── turns.ts            # turn ledger writes / reads
│   ├── engine/             # pure engine logic (no Convex imports)
│   │   ├── distance.ts     # Chebyshev
│   │   ├── vision.ts
│   │   ├── resolution.ts   # the 8-phase resolver
│   │   ├── combat.ts
│   │   ├── movement.ts
│   │   ├── affordances.ts
│   │   └── types.ts
│   ├── llm/                # Azure tool-use wrapper
│   │   ├── azure.ts
│   │   ├── decisionTool.ts # the per-turn tool definition
│   │   └── prompts.ts      # system prompt + persona registry
│   ├── runMatch.ts         # the per-match scheduled action chain
│   └── reports.ts          # multi-run aggregation
├── harness/                # local CLI
│   ├── run.ts              # `--runs N --concurrency C` entry
│   └── client.ts           # Convex client wrapper
├── personas/               # 8 persona prompts (markdown for human edit, loaded as strings)
├── maps/
│   └── reference.json      # the hand-crafted map descriptor
├── tests/
│   ├── engine/             # unit tests for pure engine
│   ├── llm/                # mocked Azure round-trips
│   └── integration/        # in-Convex test harness (convex-test)
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── eslint.config.mjs
```

**Rationale.**
- TS for the engine matches `architecture.md` §3 (Convex actions are TS).
- Pure engine logic lives under `convex/engine/` but imports zero Convex APIs — so it's unit-testable with plain Vitest, no Convex test harness needed for the bulk of business logic. Convex modules (mutations, actions, queries) are thin wrappers that read state, hand it to pure functions, and write the result back.
- Single package keeps tooling simple. Splitting `engine/` into its own package buys nothing in phase 1; it can be hoisted later if a polyglot rewrite ever happens.
- `harness/` is a separate folder, not under `convex/`, because it's local-machine code that drives Convex from outside.

**Alternatives.**
- *Engine in Rust / Go.* Rejected for phase 1: violates `architecture.md` §3 ("Convex actions") and burns time on cross-runtime plumbing before the substrate is proven. A polyglot rewrite is explicitly future work in `architecture.md` §1.
- *Monorepo (pnpm workspaces).* Rejected for phase 1: no second consumer of the engine package yet. Premature.

**Consequences.** Engine pure-functions are unit-testable with no Convex runtime. Convex modules are thin and integration-tested separately. Adding a renderer in phase 2 means a new top-level folder, not a refactor.

---

## 2. Test runner, lint, typecheck, build

**Decision.**

| Tool | Choice |
|---|---|
| Test runner | **Vitest** |
| Linter | **ESLint** with `@typescript-eslint` |
| Typecheck | **`tsc --noEmit`** |
| Build | **none for phase 1** — Convex deploys via `npx convex dev`; harness runs via `tsx harness/run.ts` |

WP1 wires these into `package.json` scripts: `lint`, `typecheck`, `test`, `build` (build is a no-op or `tsc --noEmit` alias). `.agents/repo.md` gets updated to point at these commands.

**Rationale.**
- Vitest is fast, parallel-by-default, TS-native, and has good mocking. Engine tests will be the bulk of test count; Vitest's per-file isolation makes parallel-run state isolation easy to assert in tests too.
- ESLint with `@typescript-eslint` is the boring, well-supported choice. Biome / oxlint are tempting but underspecified for the current TS-eslint plugin coverage. Keep it boring.
- No build step in phase 1 because nothing is shipped — Convex deploys directly from source, the harness runs via `tsx`.

**Alternatives.**
- *Node built-in `node:test`.* Rejected: weaker mocking story, less ergonomic for parallel test runs of stateful Convex helpers.
- *Biome (lint + format).* Reasonable but coverage of TS-specific rules is still narrower than `@typescript-eslint`. Revisit in a future phase.

**Consequences.** WP1 lands a working `npm run lint && npm run typecheck && npm test`, all green on a near-empty repo. Subsequent WPs add tests in TDD red→green order.

---

## 3. Harness CLI shape and parallel-run isolation

**Decision.** A local TS CLI at `harness/run.ts` that:

1. Parses `--runs N` and `--concurrency C` (both required).
2. For each run, calls a Convex mutation `matches.start` that creates a fresh match record (new map snapshot, new agent set, fresh trace stream).
3. The `matches.start` mutation schedules `runMatch.advanceTurn` for turn 1; each turn's action schedules the next via `ctx.scheduler.runAfter(0, ...)`.
4. The CLI maintains a semaphore at size `C`: it triggers up to `C` matches at a time, then awaits a Convex query `matches.status` per match until each completes.
5. Once all `N` matches reach `status: "completed"`, the CLI calls `reports.aggregate` to write the aggregated report row.

**Parallel-run isolation.** Every match is its own Convex `matches` document. Engine code never reads or writes to anything keyed off "current match" globally — every read/write is keyed by `matchId`. There is no shared mutable state across matches. The Convex scheduler runs matches concurrently; concurrency is bounded only by the CLI's semaphore (which controls *triggering rate*) and by Convex's own scheduler concurrency (which controls in-flight execution). Per-match LLM calls are stateless per-turn (`previous_response_id` only within a tool-loop turn).

**Rationale.**
- Putting parallelism inside Convex (one scheduled action per turn per match) means we get transactional consistency for free. The CLI is just an orchestrator + waiter, not a runtime.
- A semaphore on the CLI side gives a clean knob for `--concurrency` without re-implementing rate limiting inside Convex.
- Match-id-keyed state is the natural Convex idiom and rules out cross-match contamination by construction. Tests can assert this with two parallel matches sharing nothing.

**Alternatives.**
- *Engine fan-out via a single Convex action that spawns N match-actions.* Reasonable, but pushes orchestration into Convex for no win — the CLI still has to read aggregated results back, and observing rate-limit behaviour is harder when everything is in-cluster.
- *Local-process engine, Convex only as state sink.* Rejected: violates `architecture.md` §3.

**Consequences.** WP11 builds the CLI as a thin wrapper around the Convex client. WP10 must produce a `runMatch` that is fully `matchId`-scoped and survives concurrent invocation. WP13 measures rate-limit pressure and tunes `--concurrency` reactively — no upfront backoff machinery.

---

## 4. Azure tool-use loop wrapper

**Decision.** A single TypeScript module at `convex/llm/azure.ts` that exposes one function:

```ts
type FailureReason =
  | "http_non_200"
  | "status_not_completed"           // response.status !== "completed"
  | "incomplete_details"             // response.incomplete_details set
  | "content_filter_blocked"
  | "no_function_call"               // tool_choice:"required" produced output_text instead
  | "multiple_function_calls"        // parallel_tool_calls:false not honoured
  | "json_parse_failed"              // arguments was not valid JSON
  | "schema_validation_failed"       // valid JSON but failed Zod schema
  | "abort_timeout";                 // AbortController fired at 60s

async function callDecisionTool(input: {
  systemPrompt: string;
  personaPrompt: string;
  scratchpad: string;
  visibleStateDigest: string;
  tool: ToolDefinition;
  reasoningEffort: "low" | "medium" | "high";
  maxOutputTokens: number;
  abortTimeoutMs?: number;           // default 60_000
}): Promise<{
  decision: ParsedDecision;          // safe-default if fellBackToSafeDefault===true
  callId: string | null;             // null when no function_call was returned
  rawArguments: string | null;       // raw arguments JSON string from the tool call
  fellBackToSafeDefault: boolean;
  failureReason?: FailureReason;
  raw: {
    responseId: string | null;
    usage: AzureUsage | null;
    latencyMs: number;
    httpStatus: number | null;
  };
}>;
```

The wrapper **never throws** — all failure modes resolve to a per-agent safe-default decision with a populated `failureReason`, so the caller (the per-turn match action) can persist the trace and continue.

Internals (per `azure-llm.md` §7):

1. Set up `AbortController` with `setTimeout(() => controller.abort(), abortTimeoutMs ?? 60_000)`. Pass `signal` into `fetch`. Clear on completion.
2. POST to `AZURE_URI` with `input` array `[system, user]`, `tools: [decisionTool]`, `tool_choice: "required"`, `parallel_tool_calls: false`, `reasoning.effort` set, `store: false`, `max_output_tokens` set.
3. **HTTP non-200** → `failureReason = "http_non_200"`, safe-default, log status + body excerpt.
4. **`response.status !== "completed"`** → `failureReason = "status_not_completed"`, safe-default.
5. **`response.incomplete_details` populated** → `failureReason = "incomplete_details"`, safe-default.
6. **Content-filter blocked** (Azure surfaces a content-filter result item or status) → `failureReason = "content_filter_blocked"`, safe-default. Log so we can see if a persona prompt is tripping a filter.
7. Filter `output[]` for items where `type === "function_call"`. **0 items** → `failureReason = "no_function_call"`, safe-default. **>1 items** → take the first, set `failureReason = "multiple_function_calls"` for telemetry, but proceed (don't waste the parsed decision); log that `parallel_tool_calls: false` was not honoured.
8. `JSON.parse(arguments)` — on failure → `failureReason = "json_parse_failed"`, safe-default with `rawArguments` preserved.
9. Validate parsed object against the Zod schema for `ParsedDecision` — on failure → `failureReason = "schema_validation_failed"`, safe-default with `rawArguments` preserved.
10. **Abort fires (60 s)** → `failureReason = "abort_timeout"`, safe-default.
11. On success: set `decision = parsed`, `callId = item.call_id`, `rawArguments = item.arguments`, `fellBackToSafeDefault = false`, no `failureReason`. **Do not** send a `function_call_output` back — we don't need a synthesised text response; the tool call IS the decision. `previous_response_id` is unused at this layer.
12. Surface usage (`output_tokens_details.reasoning_tokens` etc.) and `latencyMs` for trace persistence.

**Safe default constant.**

```ts
const SAFE_DEFAULT_DECISION: ParsedDecision = {
  consume: "none",
  primary: "stationary_action",
  move:    { kind: "none" },
  action:  { kind: "none" },
  say: null,
  overwatch_priority: null,
  scratchpad_update: null,
};
```

**Decision tool shape.** One tool, name `decide_turn`, parameters mirror `concept-spec.md` §21. `move` and `action` are concrete discriminated unions — locked as the contract WP5 (validation) and WP6 (tool definition + parser) share:

```jsonc
{
  "type": "object",
  "additionalProperties": false,
  "required": ["consume", "primary", "move", "action"],
  "properties": {
    "consume":            { "enum": ["none", "heal", "speed"] },
    "primary":            { "enum": ["move", "stationary_action", "overwatch"] },

    "move": {
      "oneOf": [
        { "type": "object", "additionalProperties": false,
          "required": ["kind", "dx", "dy"],
          "properties": {
            "kind": { "const": "relative" },
            "dx":   { "type": "integer", "minimum": -12, "maximum": 12 },
            "dy":   { "type": "integer", "minimum": -12, "maximum": 12 }
          }
        },
        { "type": "object", "additionalProperties": false,
          "required": ["kind", "targetCharacterId"],
          "properties": {
            "kind": { "const": "toward_entity" },
            "targetCharacterId": { "type": "string" }
          }
        },
        { "type": "object", "additionalProperties": false,
          "required": ["kind", "targetCharacterId"],
          "properties": {
            "kind": { "const": "away_from_entity" },
            "targetCharacterId": { "type": "string" }
          }
        },
        { "type": "object", "additionalProperties": false,
          "required": ["kind", "targetObjectId"],
          "properties": {
            "kind": { "const": "toward_object" },
            "targetObjectId": { "type": "string" }   // chest id or corpse id
          }
        },
        { "type": "object", "additionalProperties": false,
          "required": ["kind"],
          "properties": { "kind": { "const": "toward_evac" } }
        },
        { "type": "object", "additionalProperties": false,
          "required": ["kind"],
          "properties": { "kind": { "const": "none" } }
        }
      ]
    },

    "action": {
      "oneOf": [
        { "type": "object", "additionalProperties": false,
          "required": ["kind", "targetCharacterId"],
          "properties": {
            "kind": { "const": "attack" },
            "targetCharacterId": { "type": "string" }
          }
        },
        { "type": "object", "additionalProperties": false,
          "required": ["kind", "targetObjectId"],
          "properties": {
            "kind": { "const": "interact" },     // e.g. open chest
            "targetObjectId": { "type": "string" }
          }
        },
        { "type": "object", "additionalProperties": false,
          "required": ["kind", "targetCorpseId"],
          "properties": {
            "kind": { "const": "loot" },
            "targetCorpseId": { "type": "string" }
          }
        },
        { "type": "object", "additionalProperties": false,
          "required": ["kind"],
          "properties": { "kind": { "const": "none" } }
        }
      ]
    },

    "say":                { "type": ["string", "null"], "maxLength": 280 },
    "overwatch_priority": { "type": ["string", "null"], "maxLength": 80 },
    "scratchpad_update":  { "type": ["string", "null"], "maxLength": 500 }
  }
}
```

`tool_choice: "required"` plus `additionalProperties: false` means the model must produce a structured decision; free-form refusals are disallowed by the contract. The Zod schema for `ParsedDecision` mirrors this shape exactly; WP6 includes a structural-equivalence test so the JSON Schema and the Zod parser cannot drift.

**Rationale.**
- A single tool with discriminated-union sub-fields beats N specialised tools — keeps the model from picking the wrong tool and matches the §21 "compact decision" spec.
- `parallel_tool_calls: false` is required; the schema disallows multi-action turns by design. The wrapper still defends against violations.
- Safe-default fallback on every failure mode is non-negotiable per §2A.3 and is part of the engine-as-referee invariant.
- The AbortController lives **inside** the wrapper (not at the call site) so every caller — not just `runMatch.advanceTurn` — gets the same timeout behaviour.
- Stateless per-turn — no `previous_response_id` chaining across turns. (`azure-llm.md` §7 final paragraph.)

**Alternatives.**
- *JSON-mode (`text.format: json_object`).* Rejected per `azure-llm.md` §7 and per the trace contract in ADR §7: tool calls give typed args + `call_id`, both load-bearing for trace persistence. JSON-mode loses both. **Not a planned fallback** — see `de-risking.md` Spike A.
- *Multiple tools, one per primary commitment (`do_move`, `do_overwatch`, `do_stationary`).* Rejected: more surface for the model to confuse, no expressive gain over a single tool with a discriminator.
- *AbortController at the call site.* Rejected: would let a future caller forget the timeout and hang the whole turn action.

**Consequences.** WP6 produces the tool definition + parser + AbortController-aware fetch + the unit tests for every `FailureReason`. WP10 calls `callDecisionTool` once per agent per turn, using `Promise.all` for the 8-agent fan-out, and persists `callId` / `rawArguments` / `failureReason?` / `fellBackToSafeDefault` into the `turns.agentRecords[].llm` field (ADR §6). The function is unit-testable by mocking the `fetch`.

---

## 5. Reference map shape

**Decision.** Hand-author a map descriptor JSON, not a tile grid. Descriptor shape:

```jsonc
{
  "size":        { "w": 100, "h": 100 },
  "walls":       [ { "x": 10, "y": 20, "w": 5, "h": 1 }, /* rectangles */ ],
  "coverClusters":[ { "x": 30, "y": 40, "w": 4, "h": 4 }, /* rectangles */ ],
  "chests":      [ { "x": 12, "y": 88, "lootTable": "starter" }, /* points */ ],
  "spawns":      [ { "x":  5, "y":  5 }, /* 8 points */ ],
  "evac":        { "x": 48, "y": 48 } // 3x3 zone centre, hidden until turn 30
}
```

The engine expands the descriptor into a tile grid at match start.

**Rationale.**
- A 100×100 hand-authored grid is 10 000 tiles — tedious, error-prone, and useless to a reviewing agent. A descriptor is small (~30–80 entries), legible, and easy to diff.
- Same map every run is a phase-1 invariant (`mental-model.md` §10). Descriptor → grid is deterministic, so this holds.
- Loot tables are referenced by name so chest spawns are reproducible across runs.

**Alternatives.**
- *ASCII grid file.* Reasonable for a 30×30 map; ugly for 100×100. Loses chest loot-table assignment.
- *Procedural with a fixed seed.* Rejected: explicit out-of-scope for phase 1 (`mental-model.md` §10), would mask regressions during engine shake-out.

**Consequences.** WP3 produces `maps/reference.json` plus an expander function `expandMap(descriptor) → WorldState`. The map is hand-tuned during WP15 (tuning loop) if persona signal is too low because, e.g., chests are too far from spawns or cover is sparse near evac.

---

## 6. Convex schema (concrete shape)

**Decision.** Six tables. Names and key fields below; full schema lands in WP2.

```ts
// PersonaId is locked to the kebab-case filename (without extension) of the
// 8 prompts in personas/. Every consumer (schema, loader, aggregator, report)
// uses this same literal union.
type PersonaId =
  | "rat" | "duelist" | "trader" | "opportunist"
  | "paranoid" | "camper" | "sprinter" | "vulture";

// matches — one per match
matches: {
  _id, status: "pending" | "running" | "completed" | "failed",
  turn: number, // current turn number, 0..50
  startedAt, completedAt,
  mapId: string, // "reference" for phase 1
  rngSeed: string, // seeds chest loot rolls AND persona-to-spawn assignment
  outcome: { extracted: Id<"characters">[]; lastSurvivor?: Id<"characters">; pointsByCharacter: { id, points }[] },
  failure?: { turn: number; reason: string },
}

// characters — one per agent per match (NOT per player; phase-1 has no players)
characters: {
  _id, matchId,
  personaId: PersonaId, // which persona prompt — kebab-case literal
  spawnIndex: number,    // 0..7, the spawn slot this character was seeded into (see §7 trace shape)
  displayName: string,   // Player_1..Player_8
  hp: number,
  pos: { x: number; y: number },
  equipped: { weapon?: ItemRef; armour?: ItemRef; consumable?: ItemRef },
  scratchpad: string,
  hidden: boolean,
  alive: boolean,
  diedAtTurn?: number,
  extractedAtTurn?: number,
  // per-character last-known map; computed by the engine at the visibility-update phase.
  // Capped at 3 most-recent entries (oldest-first eviction). Owned by WP5.
  lastKnown: Array<{ characterId: Id<"characters">, pos: { x, y }, atTurn: number }>,
}

// turns — the ledger; one row per (matchId, turn). The canonical replay/introspection record.
turns: {
  _id, matchId, turn,
  agentRecords: Array<{
    characterId,
    personaId: PersonaId,                 // duplicated from characters for trace self-containment
    // EVERYTHING the model actually saw on this turn — self-contained
    // enough to reconstruct after WP15 prompt edits.
    input: {
      systemPromptHash: string,            // sha256 of system prompt text
      systemPromptText: string,            // full text (terse — ≤ 400 tokens by WP8)
      personaPromptHash: string,           // sha256 of persona prompt text
      personaPromptText: string,           // full text (≤ 80 tokens by WP9)
      visibleStateDigest: string,          // the tactical digest plain-text per §7
      scratchpadBefore: string,
    },
    decision: ParsedDecision,              // the tool call result (or safe default on failure)
    scratchpadAfter: string,
    llm: {
      responseId: string | null,
      callId: string | null,               // tool call_id (null on failure)
      rawArguments: string | null,         // raw JSON string from the tool call (null on hard failures)
      usage: AzureUsage | null,            // input/output/reasoning tokens
      latencyMs: number,
      httpStatus: number | null,
      fellBackToSafeDefault: boolean,
      failureReason?: FailureReason,       // see ADR §4
    },
  }>,
  // per-phase resolution outputs (compact)
  resolution: {
    consumed: Array<{ characterId, item }>,
    speech: Array<{ characterId, text, heardBy: Id<"characters">[] }>,
    moves: Array<{ characterId, from, to }>,
    actions: Array<{ characterId, kind, target, result }>,
    deaths: Id<"characters">[],
    visibilityUpdates: Array<{ characterId, hidden: boolean, revealedBy?: "attack" | "loot" | "speech" | "consumable" | "leaving_cover" | "proximity" }>,
  },
}

// worldState — terrain, cover, chests, corpses
worldState: {
  _id, matchId,
  walls: Wall[],
  coverTiles: Tile[],
  chests: Array<{ id, pos, contents: ItemRef | null, opened: boolean }>,
  corpses: Array<{ characterId, pos, contents: { weapon?, armour?, consumable? } }>,
  evac: { centre: Tile; revealedAtTurn: number | null },
}

// runs — per-match aggregated stats (computed on completion). Owned by WP12.
runs: {
  _id, matchId,
  kills: number, extractions: number, equips: number, speechEvents: number,
  perPersona: Record<PersonaId, { survivedTurns, kills, extracted, equips, speechEvents }>,
}

// reports — multi-run aggregate (one per harness invocation). Owned by WP14.
//
// Additive schema (v2 / WP14 land): the table preserves the v1 fields
// (`runIds`, `runCount`, `generatedAt`, `metrics`, `metBar`) as required —
// older readers continue to validate. WP14 added matchIds-based addressing
// and the §10 done-bar payload as optional fields, plus an index on
// `(matchIdsHash, reportType)` for the idempotency lookup. The `payload`
// object mirrors `ReportPayload` from `convex/engine/reportStats.ts`.
reports: {
  _id,

  // ── v1 fields (preserved verbatim) ────────────────────────────────
  runIds: Id<"runs">[], runCount: number,
  generatedAt,
  metrics: {
    extractionRate: number,
    runsWithKill: number,
    runsWithEquip: number,
    runsWithSpeech: number,
    perPersonaExtractionRate: Record<PersonaId, number>,
    personaSpread: number,
  },
  metBar: boolean, // whether all thresholds in mental-model §10 are met

  // ── v2 / WP14 additive fields ─────────────────────────────────────
  matchIds?: Id<"matches">[],            // input matchIds (caller order)
  matchIdsHash?: string,                 // SHA-256 hex of sorted-then-joined matchIds
  reportType?: string,                   // discriminator (e.g. "stage-3-50run")
  payload?: ReportPayload,               // §10 done-bar payload (mirrors engine type)
  missingRunsForMatchIds?: Id<"matches">[], // matchIds that had no `runs` row at read time
}

// Index added in WP14: `by_matchIdsHash_reportType`. The mutation
// `reports.create` reads by this tuple before insert; re-fires with the
// same matchIds set + reportType return the existing row (idempotent).
//
// `ReportPayload` shape (mirrors convex/engine/reportStats.ts):
//   runCount, kills, extractions, equips, speechEvents,
//   runsWithAtLeastOneKill, runsWithAtLeastOneExtraction,
//   runsWithAtLeastOneEquip, runsWithAtLeastOneSpeech,
//   killRate, extractionRate, equipRate, speechRate,
//   perPersona[8] = { personaId, kills, equips, speechEvents, extracted,
//                     extractionsCount, extractionRate },
//   personaExtractionSpread (in percentage points, 0..100),
//   meetsExtractionThreshold, meetsKillThreshold, meetsEquipThreshold,
//   meetsSpeechThreshold, meetsPersonaSpreadThreshold, meetsAllThresholds.
```

### v0 item stat tiers (locked, per `concept-spec.md` §14)

The loot tables in WP3 resolve to `ItemRef`s drawn from these instances. WP7 combat tests assert the math directly.

```ts
type WeaponName = "rusty_blade" | "sword" | "axe" | "greatsword";
type ArmourName = "cloth" | "leather" | "chain" | "plate";
type ConsumableName = "heal" | "speed";

const WEAPONS: Record<WeaponName, { damage: number; range: number }> = {
  rusty_blade: { damage: 10, range: 2 },
  sword:       { damage: 15, range: 2 },
  axe:         { damage: 20, range: 2 },
  greatsword:  { damage: 25, range: 2 },
};

const ARMOUR: Record<ArmourName, { reduction: number }> = {
  cloth:   { reduction: 0 },
  leather: { reduction: 3 },
  chain:   { reduction: 6 },
  plate:   { reduction: 10 },
};

const CONSUMABLES: Record<ConsumableName, { effect: "heal_pct" | "speed_override"; value: number }> = {
  heal:  { effect: "heal_pct",       value: 20 },   // restore 20% of max HP
  speed: { effect: "speed_override", value: 12 },   // movement = 12 this turn (vs default 8)
};

const MIN_DAMAGE_FLOOR = 5;
// Damage formula (WP7): max(MIN_DAMAGE_FLOOR, weapon.damage - armour.reduction)
// Examples (WP7 must assert exactly):
//   axe (20) vs leather (3)  => 17
//   sword (15) vs plate (10) => 5  (floor binds)
//   rusty_blade (10) vs plate (10) => 5 (floor binds)
//   greatsword (25) vs cloth (0) => 25
```

**Rationale.**
- The `turns` ledger answers the introspection contract directly: query by `(matchId, turn)`, pull `agentRecords[characterId]`, see the **full** input (system + persona text + digest + scratchpad-before), the decision (with `callId` + `rawArguments`), `scratchpadAfter`, and the LLM call metadata. After WP15 edits a persona prompt, the trace still reconstructs *exactly* what was sent on each historical turn because the prompt text is captured per-row, not pulled from `personas/` at read time.
- `personaPromptHash` lets aggregators / reviewers detect "all turns in run #17 used persona prompt at hash abc…", which is cheap to compare across runs without re-reading the full text.
- `runs` is a denormalised per-match summary so `reports.aggregate` doesn't have to re-walk the ledger.
- `reports` is the artefact the done-bar is checked against. It's a single Convex query the user (or an agent) can run to verify the closing condition.
- `worldState` is per-match, not global, because the map descriptor is expanded per match. Chest contents are resolved at match start using `rngSeed`. `spawnIndex` + `rngSeed` together let the closing report split per-persona stats from per-spawn-position bias.
- `lastKnown` lives on `characters` (not on `turns`) because it's per-character mutable state, updated each turn at the visibility-update phase. WP5 owns the update; WP8 reads it for the digest.
- The item stat tiers are locked here (not in `concept-spec.md`, which calls them "possible v0") so WP3 loot tables and WP7 combat tests share one source of truth.

**Alternatives.**
- *Single mega-table with embedded turn logs.* Convex scales fine to 50 × 50 = 2 500 turn rows; querying-per-turn is cleaner with a separate table.
- *Computed-on-demand `runs` and `reports`.* Reasonable, but precomputing makes the introspection queries cheap and idempotent.
- *Store persona prompt text once on `matches` and reference by id.* Rejected: defeats post-edit auditability, which is the whole point of capturing input per-turn.

**Consequences.** WP2 lands the full `convex/schema.ts` including the literal `PersonaId` union and the item-stat constants. WP10 writes `turns` and updates `characters`/`worldState` per turn. WP12 writes `runs` on match completion (NOT WP10 — see §3 / WP10 acceptance). WP14 writes `reports`.

---

## 7. Trace shape — what's queryable

**Decision.** For any (matchId, turn, characterId), an agent can run the equivalent of:

```ts
const turnDoc = await db.query("turns")
  .withIndex("by_match_turn", q => q.eq("matchId", m).eq("turn", t))
  .unique();
const record  = turnDoc.agentRecords.find(r => r.characterId === c);
// record has the FULL self-contained shape from §6:
// {
//   characterId, personaId,
//   input: {
//     systemPromptHash, systemPromptText,
//     personaPromptHash, personaPromptText,
//     visibleStateDigest,
//     scratchpadBefore,
//   },
//   decision,                // ParsedDecision (incl. discriminated-union move/action)
//   scratchpadAfter,
//   llm: { responseId, callId, rawArguments, usage, latencyMs, httpStatus,
//          fellBackToSafeDefault, failureReason?, validatorReason?,
//          httpBodyExcerpt? },
// }
```

WP10 must add a Convex query helper `turns.getAgentTurn(matchId, turn, characterId)` returning exactly this shape, plus a CLI invocation example documented in `closing-notes.md` (created by WP16) and a worked example in WP10's acceptance.

**Why the input fields are persisted in full.** After WP15 tunes prompts, the source files in `personas/*.md` and the system prompt in `convex/llm/prompts.ts` will have changed. Without per-turn persisted prompt text, no reviewing agent could ever reconstruct what was actually sent on (run #1, turn 23). The hashes are for cheap cross-run diffing ("did all turns in this run use the same persona text?"); the full text is for direct inspection.

**Why `callId` and `rawArguments` are persisted.** The `callId` is the model's claim about which tool invocation produced this decision; useful when debugging a `multiple_function_calls` failure mode. `rawArguments` is the un-validated JSON string — when `failureReason === "schema_validation_failed"`, the parsed decision is the safe default but `rawArguments` shows what the model actually tried to emit, which is the only path to understanding *why* it failed.

**Rationale.** The introspection contract (`mental-model.md` §10, memory `feedback_observability_targets_agents`) is the thing that makes phase 1 useful to building agents. Surface it as a first-class query, not "build it yourself from raw tables." A self-contained per-turn record means a reviewer can understand a single decision without joining four other tables.

**Consequences.** WP10's acceptance includes a worked example query that returns the full record for `(run #1, turn 23, Player_4)` and matches what was actually fed to the LLM and what the LLM returned. Storage cost: ~3 KB per agent record × 8 agents × 50 turns × 50 runs ≈ 60 MB per closing report — well within Convex tier limits.

---

## 8. Concurrency knob default + rate-limit posture

**Decision.** `--concurrency` defaults to **1** at stage 1, **5** at stage 2, **10** at stage 3. The CLI errors if `--concurrency` is omitted at stage ≥ 2 — explicitness over silent default. No upfront backoff machinery. WP13 spike measures actual Azure RPM/TPM behaviour at concurrency 10 with 8 agents × 50 turns. If backoff is needed, the policy is locked verbatim in WP13 + Spike C:

- 0 % 429s: stage-3 concurrency = 10, no backoff machinery.
- 0–5 % 429s: add 3-retry exponential backoff (base 1 s, jittered) to `azure.ts`. After re-spike clean: stage-3 concurrency = 10.
- 5–20 % 429s: add the same backoff AND lower concurrency (start at 7, then 5) until re-spike is clean. Stage-3 concurrency = whichever value ran clean.
- > 20 % 429s: stage-3 concurrency = 5 with backoff. If still > 20 % at concurrency 5, escalate to user (PM) before running 50.

**Rationale.** `mental-model.md` §10 plus the assignment north star §9 explicitly say "concurrency tuning is reactive." Building backoff before observing the system is over-engineering for a known-unknown. Repeating the policy in three places (here, WP13, Spike C) keeps the contract from drifting.

**Consequences.** WP13 may surface "the deployment is fine at 10× but degrades at 20×" → we lock concurrency at 10 for stage 3. Or it may surface persistent 429s → we add the 3-retry backoff and re-spike. Either way, the spike is the gate, not the architecture.

---

## Changelog — v1.1

Diff vs v1.0, by section:

- **§4 Azure tool-use loop wrapper.** Locked concrete discriminated unions for `move` (`relative` | `toward_entity` | `away_from_entity` | `toward_object` | `toward_evac` | `none`) and `action` (`attack` | `interact` | `loot` | `none`). Expanded the wrapper return shape to include `callId`, `rawArguments`, `fellBackToSafeDefault`, `failureReason?`, `httpStatus`, `latencyMs`, `responseId`. Defined the `FailureReason` union (HTTP non-200, status-not-completed, incomplete_details, content-filter, no/multiple function_calls, JSON parse failure, schema validation failure, abort timeout). Moved the 60 s `AbortController` requirement INTO the wrapper (was previously only in WP10 risk text). Wrapper never throws — every failure mode resolves to a per-agent safe default with a populated `failureReason`. Reaffirmed JSON-mode is not a planned fallback (cross-ref Spike A).
- **§6 Convex schema.** Locked `PersonaId` as a literal kebab-case union of the 8 persona ids. Added `spawnIndex` to `characters` so per-persona vs per-spawn-position bias can be split in the closing report. Added `lastKnown` (capped 3 entries) to `characters` with explicit ownership note (WP5 computes, WP8 reads). Replaced `agentRecords[].visibleState` with a fuller `input` object: `{ systemPromptHash, systemPromptText, personaPromptHash, personaPromptText, visibleStateDigest, scratchpadBefore }`. Expanded `agentRecords[].llm` to mirror the wrapper return shape (`callId`, `rawArguments`, `httpStatus`, `failureReason?`, `fellBackToSafeDefault`). Added `revealedBy` to `visibilityUpdates`. Locked v0 item stat tiers (weapons / armour / consumables / `MIN_DAMAGE_FLOOR`) with worked examples WP7 must assert.
- **§7 Trace shape.** Updated the worked example to reflect the §6 fuller `input` shape and the `llm` failure-reason fields. Added rationale on why prompt text is persisted in full (post-edit auditability) and why `callId` + `rawArguments` are persisted (failure debugging). Storage cost noted (~60 MB per closing report).
- **§8 Concurrency.** Repeated the locked rate-limit threshold policy verbatim from WP13 + Spike C. Removed the looser "minimal backoff" wording.
- **§6 Consequences.** Clarified WP10 does NOT write the `runs` summary — that boundary is owned by WP12 (cross-ref WP10 acceptance).
