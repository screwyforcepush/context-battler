# Phase 7 — Context Payload Iter-3 + Behavioural Diagnostics

> **Status:** dispatched 2026-05-13. Three workstreams in one assignment;
> the crew sequences/parallelises.
>
> Canonical intent anchors:
> - [`docs/project/spec/context-payload-iter-3-intent.md`](../../spec/context-payload-iter-3-intent.md) (substrate)
> - [`docs/project/spec/behavioural-diagnostics-intent.md`](../../spec/behavioural-diagnostics-intent.md) (tooling)
> - [`docs/project/spec/mental-model.md`](../../spec/mental-model.md) §16 (dispatch why)
> - [`docs/project/phases/06-per-turn-context-iter-2/PHASE-6-CLOSURE.md`](../06-per-turn-context-iter-2/PHASE-6-CLOSURE.md) (predecessor)

---

## 1. Purpose

Phase 6 closed substrate-correct but exposed three pillar regressions and a
metric-vs-substrate mismatch:

1. **Vision is over-sharing.** Chest `opened`, corpse `drained`, lootable
   `contents`, full opponent `equipped`, and absolute `pos.x/y` are engine-state
   leaks into the agent's perception channel. Pillar 4 (scratchpad-as-explainability)
   only carries weight when the substrate forces the agent to author its own
   memory. Pillar 5 (text is terrain) underperforms because weapon/armour intel
   propagates structurally instead of through speech / kill-feed / corpse loot.
2. **In-range inbound speech is missing.** Regression from the phase-4 / 6
   rewrites: other agents' speech is no longer delivered to the listener's
   per-turn context. The trader persona's reason to exist is broken without it.
3. **Loot outcomes are silent on empty and unnamed on success.** Agents cannot
   write useful scratchpad notes when the substrate does not tell them what
   they got.
4. **No-op metric mismatch.** The phase-6 `noOpRate < 5%` gate (43.245 % on the
   canonical report) conflated *armed-stance pause* (the model deliberately
   priming reactive fires) with *true do-nothing*. This is a measurement
   problem, not a behaviour-policy problem.

On the tooling side, the user cannot answer cohort-pattern questions (is anyone
using `counter + attack`? does paranoid pivot at the turn-30 reveal? what about
`dist:0 + action≠none`?) from the replay UI's one-turn-at-a-time view. Convex's
16 MB per-function read budget blocked any aggregator that pulls full per-turn
LLM input across 20 matches in a single call.

This phase ships three workstreams in one slice:

- **A. Substrate.** Lean Vision; restore in-range hearing; verbose-honest loot
  outcomes; chest ids coord-encoded engine-wide; two-phase evac countdown.
- **B. Convex 16 MB unblock.** Slim per-match query + client-side fan-out — no
  schema change, no materialised tables.
- **C. Behavioural diagnostics view.** CLI + replay-app dashboard tab over the
  last N ≤ 20 matches, three metric families, deep-linking drill-down to the
  existing replay turn modal.

---

## 2. Overview — what is being built

### Workstream A — Substrate (per `context-payload-iter-3-intent.md`)

- `Vision:` (renamed from `Visible:`) keeps only what the model should reason
  on: `dist`, `bearing`, plus `hp` + `armed` for characters. Drops `kind`,
  `pos`, `opened`, `drained`, `contents`, `equipped` tree, `inZone`.
- Status block gains a `Outside Evac` / `Inside Evac` flag on the `📍` line,
  and renders `⚔️weapon: unarmed [dmg 5]` for unarmed agents (the 5 is
  `MIN_DAMAGE_FLOOR` from `convex/engine/combat.ts`).
- Current Game State feed restructured: own outcome line is mechanical-only;
  own speech becomes a separate feed event (`You said "…"`); inbound in-range
  speech is restored as feed events (`<Persona> said "…"`); loot outcome line
  names the contents on success (`looted speed from Chest_53_54`) or marks
  empty on failure (`looted nothing from empty Corpse_Duelist`).
- Inside-evac suppression: when the agent is inside the 3×3 evac zone, the
  `Evac` entry is absent from Vision; Status's flag is the single signal.
- Chest ids move from ordinal (`chest_012`) to coord-encoded (`Chest_53_54`)
  engine-wide — schema break, dev DB wipe authorised under
  `project_poc_schema_wipe_acceptable`, no migration shims.
- System prompt carries a two-phase evac/extraction countdown line:
  pre-turn-30 `Evac location spawns in <N> turns`; post-turn-30
  `Extraction in <N> turns`. Win-condition line rephrased.
- 8 persona prompts get a mechanical scrub for dead chest-id references; **not**
  a behaviour-tune pass.

### Workstream B — Convex 16 MB Unblock (Option A)

- New Convex query that returns per-match agentRecords projected to the
  diagnostics-relevant fields, with heavy text projected out of the response:
  `input.systemPromptText`, `input.personaPromptText`, `input.visibleStateDigest`,
  `input.scratchpadBefore`, `input.composedUserMessage`, `llm.reasoning`,
  `llm.rawArguments`, `llm.httpBodyExcerpt`.
- The CLI and the replay dashboard fan out N parallel calls (one per
  `matchId`) and aggregate client-side. Drill-down on click continues to fetch
  the full agentRecord via the existing `turns.getAgentTurn` query.
- No new schema fields, no write-path hooks, no materialised rollup tables.

### Workstream C — Behavioural Diagnostics View (per `behavioural-diagnostics-intent.md`)

- CLI at `harness/diagnostics.ts` (sibling pattern to `harness/analyze-match.ts`);
  `--last N ≤ 20`; emits JSON + markdown over three metric families.
- Dashboard tab in `apps/replay`; same `--last N ≤ 20` arg as a UI control;
  minimal chart lib (inline SVG bars or a tiny dep — crew chooses); aggregate
  rows are clickable and deep-link to the existing replay turn-detail modal at
  `#/match/<matchId>?turn=<n>&character=<persona>`. No new modal.
- Three metric families:
  1. **Critical fails** — fallback rate × `failureReason`, retry recovery,
     `usage.output_tokens` cap-proximity histogram, per-field validator-rejection
     breakdown, persona × failure-reason cross-tab.
  2. **Game-mechanic sanity** — attack outcomes, overwatch fires split by
     `triggeredByMovement`, counter retaliations, chest/corpse loot funnels,
     consume waste, speech metrics (count / length / fanout), damage-feed
     delivery audit, wall-blocked moves, declared-vs-actual move distance.
  3. **Behavioural distribution** — top-level totals (persona × turn-phase),
     contextual combos (the table from intent §3.3.2), cross-cuts (persona /
     turn-phase / visibility / equipment), "saw enemy AND no-op" carve-out.
- Recompute on demand; no persisted aggregate rows.

### No-op metric redefinition (cross-cutting)

The phase-6 `noOpRate < 5%` gate is replaced — not lowered. The diagnostics
view exposes two separate distributions:

- `armedStancePauseRate` — `position.kind ∈ {overwatch, counter}` AND
  `action.kind === "none"`. This is the model deliberately priming reactive
  fires; the phase-6 closing report categorised it as "do-nothing", which the
  substrate analysis showed is wrong.
- `trueStationaryRate` — `position.kind === "move"` AND `position.dist === 0`
  AND `action.kind === "none"`. This is the actual "did nothing" bucket.

Both are reported; neither is gated. The phase-7 closing report records them
and leaves judgement to the user. No behaviour tuning in scope.

---

## 3. Architecture Design

### 3.1 Substrate (workstream A) — file-level surface

| File | Change |
|---|---|
| `convex/engine/map.ts:127` | `chest_<NNN>` → `Chest_<x>_<y>` at expansion time. Drop zero-padded ordinal index; key by `(x,y)`. |
| `convex/matches.ts:97-160` (`expandMapInline`) | **HIGH — silent breakage if missed.** Inline mirror of `expandMap` (Convex bundler can't resolve `node:fs` for the `engine/map.ts` path in the default runtime). Mirror the chest-id rename here in lock-step or `matches.start` will seed chests with old ids while `runMatch` resolves loot dispatch against new ids. |
| `convex/engine/resolution.ts:445-557` (dispatch validation) | Drop the `Chest_*` → `chest_*` translation (`:517-519`). Single id namespace. |
| `convex/engine/resolution.ts:721-743` (chest trace emission) | Loot trace augmentation site for chests. Emit `lootedItem?: string` on success per §3.1.2; replace silent `continue` (`:723`) for `chest.opened || chest.contents === null` with an explicit trace push (`result: "already_opened"` or `result: "empty"`) per §3.1.2 / WP-A4. |
| `convex/engine/resolution.ts:766-816` (corpse trace emission) | Loot trace augmentation site for corpses. Emit `lootedItem?: string` on success (`result: "looted"` push at `:811-816`). The drained-corpse `result: "empty"` path at `:786-794` already exists — keep, just enrich rendering. |
| `convex/engine/runStats.ts:217-225` | Chest-equip gate currently keys on `target.startsWith("chest_")`. After rename, switch to a tiny helper `isChestId(id) => /^Chest_-?\d+_-?\d+$/.test(id)` (defined locally in each runtime layer that needs it; trivial). Without this fix, chest equips drop to zero in runStats and the `equip ≥ 80%` closing gate goes hot. |
| `convex/engine/validation.ts:30-31` | Drop chest case-folding; single namespace. |
| `convex/llm/idNormalisation.ts:104-117` | Collapse `chestTargetIds()` — chests have one id form. `findChestByTargetId` simplified. |
| `convex/llm/idNormalisation.ts:206` | Second `Chest_||chest_` case-folding branch (canonicalisation path); collapse to a single coord-encoded form. |
| `convex/llm/inputBuilder.ts:84-88` | `renderChestId` becomes coord-encoded. |
| `convex/llm/inputBuilder.ts:251-413` | Vision entries shrink: drop `kind`, `pos`, `opened`, `contents`, `equipped` tree, `inZone`. Reduce char to `dist/bearing/hp/armed`. Strip the `kind === "evac"` entry when observer is inside the zone. Rename root to `Vision:`. |
| `convex/llm/inputBuilder.ts:425-435` | Status block: append `Outside Evac` / `Inside Evac` to `📍` line; render `unarmed [dmg 5]` for unarmed weapon slot. |
| `convex/llm/inputBuilder.ts:158-173` | `buildOwnOutcomeLine` drops speech fragment. New `buildOwnSpeechLine` → `You said "…"`. Loot fragment renders new shape (see §3.1.2). |
| `convex/llm/inputBuilder.ts:36-43` (`PrevTurnRow`) | Adapter type that mirrors `ResolutionTrace.actions[]`; widen to carry the new optional `lootedItem?: string` so the renderer can name contents on success. |
| `convex/llm/inputBuilder.ts:458-476` (event composition site) | Insertion point for new `buildInboundSpeechLines` (regression-restored — see next row) AND for re-ordering events. Final event order inside `# Current Game State`: own-outcome → personal-damage feed → own-speech → inbound-speech → kill-feed. Chronologically grouped per the intent doc's sample. (Single canonical line range: `:458-476`. Earlier draft cited `:464-477` — disregard.) |
| `convex/llm/inputBuilder.ts` (new helper inside the module) | New `buildInboundSpeechLines` — scans `prev.resolution.speech` for entries where `observer.characterId ∈ heardBy` AND `speaker !== observer`; emits `<DisplayName> said "<text>"`. **Regression restoration.** Reuse the existing `buildHeardForObserver` filter from `convex/runMatch.ts` rather than reimplementing the heardBy match. |
| `convex/llm/inputBuilder.ts:451,479` | System-prompt callsite: `state.turn` is already in scope inside `buildAgentInput`. Replace `SYSTEM_PROMPT` constant references with `buildSystemPrompt(state.turn)`. (No edit to `azure.ts` needed — the prompt string is materialised here, then handed to azure as a plain string.) |
| `convex/llm/systemPrompt.ts` | Replace const string with `buildSystemPrompt(turn: number)`. New two-phase countdown line; rephrased win condition. |
| `personas/*.md` | Mechanical scrub of dead chest-id literals. No behaviour edits. |
| `apps/replay/src/lib/decisionEnglish.ts`, `formatters.ts` | Update chest id references in renderer. |
| `apps/replay/src/lib/reconstruct.ts:224-230` | **Load-bearing chest-open-flip guard** (snapshot consumes `target.startsWith("chest_")` to disambiguate chest-loot from corpse-loot in the same `kind: "loot"` namespace). Update to `isChestId(...)` helper or the replay snapshot will stop flipping `opened: true` and the chest visual stays "closed" forever in the UI. |
| `apps/replay/src/components/HoverCard.tsx:327-328` | Hover tooltip references chest id format — update to coord-encoded form. |
| `harness/analyze-match.ts:58-64` | CLI consumer that gates on chest id prefix; update to `isChestId(...)` helper. |
| Any `convex/reports/*.ts` consumer that gates on `target.startsWith("chest_")` | Sweep & switch to `isChestId(...)`. The `phase-7-closing-20` aggregator (WP-D1) consumes the same predicate via the diagnostics modules and must follow the same rename. |
| `convex/schema.ts:351-356` | `chestValidator.id` is still `v.string()`; no schema change needed for chest id rename itself. (Add `chestState.id` semantic note in module docstring.) |
| `convex/schema.ts:312-329` | `resolution.actions[]` validator gains an optional `lootedItem: v.optional(v.string())` field per §3.1.2. Additive. |
| `convex/schema.ts:142-159` (additive — see §3.1.5) | `agentLlmValidator` gains `retried: v.optional(v.boolean())` so retry-recovery rate is computable in workstream C. Additive — historical rows validate cleanly. |
| `convex/_internal_runMatch.ts:194-208` and `convex/runMatch.ts:427-494` | `buildAgentLlmRecord` plumbing for the new optional `retried` field (read from `azure.ts` raw return, persist into the `llm` block). Persistence parity tests required. Same surfaces also carry the new `lootedItem` from the resolution trace into the persisted `resolution.actions[]` shape. |
| `convex/engine/types.ts:304-315` (`ActionTraceEntry`) | Trace TS type gains `lootedItem?: string`. The adapter shapes (`adaptResolutionForSchema` and friends) propagate the new optional field through to schema-side persistence. |
| **Test fixtures — bulk rename** | ~94 `chest_NNN` literals across the test suite. Hot files: `tests/llm/inputBuilder.test.ts`, `tests/engine/resolution.test.ts`, `tests/runStats.test.ts`, `tests/llm/idNormalisation.test.ts`, `tests/engine/map.test.ts`, plus any harness or replay snapshot fixtures. WP-A1 owns the bulk rename in a single commit. |

#### 3.1.1 Inside-evac suppression detail

`buildVisibleObject` already computes `observerInEvacZone`. When `true`:

- Do NOT push the `Evac` entry into `entries`.
- Status's `📍` line renders `Inside Evac` instead of `Outside Evac`.

Outside-evac path is symmetric: push Evac entry; Status renders `Outside Evac`.
Pre-reveal (`evac.revealedAtTurn === null`): no Evac entry at all; Status reads
`Outside Evac` (the agent isn't *in* the unrevealed zone; matches the intent
doc's samples).

> **Q-A1 — RESOLVED:** Status renders `Outside Evac` pre-reveal (structurally
> stable Status line; Vision still carries no Evac entry before reveal).

#### 3.1.2 Loot outcome line — trace augmentation + same-turn collision

The intent doc requires the outcome line to NAME the looted item on success
and FLAG empty on failure. The current trace entry is too sparse — `result:
"opened"` / `result: "looted"` / `result: "already_opened"` / `result: "empty"`
— it does not carry the picked item's name. AND the chest path silently
`continue`s on dud / same-turn-collision (`convex/engine/resolution.ts:723`),
violating the verbose-honest contract.

**Two changes, both additive:**

1. **Add `lootedItem?: string` to the success trace push.** Captures the
   picked item's name. Schema diff: `convex/schema.ts:312-329` `resolution.actions[]`
   validator gains `lootedItem: v.optional(v.string())`. TS type
   `convex/engine/types.ts:304-315` (`ActionTraceEntry`) gains the same
   optional field. Adapter and `PrevTurnRow` (`inputBuilder.ts:36-43`)
   propagate it through. Historical rows validate cleanly.

2. **Replace the chest dud/same-turn-collision silent skip with explicit
   trace entries.** Mirror the corpse path: `convex/engine/resolution.ts:721-743`
   currently does `if (!chest || chest.opened || chest.contents === null)
   continue;` — change to emit a discriminated trace entry instead:
   - chest already opened by an earlier actor in this same loop, OR opened
     in a prior turn → `result: "already_opened"`, no `lootedItem`.
   - chest never had contents (dud at spawn) → `result: "empty"`, no
     `lootedItem`.
   - chest entity not found at all (defensive; shouldn't happen) → keep the
     `continue` (this is a programming error, not a game outcome).

   The renderer (Q-A3 default: keep trace vocabulary, unify only the rendered
   line) collapses both `already_opened` and `empty` into the same agent-facing
   line `looted nothing from empty <target>` per the intent doc lines 116-122.
   The trace stays diagnostically discriminable (the diagnostics view splits
   `chestEmptyAtSpawnRate` from `chestSameTurnCollisionRate` from
   `chestRepeatLootRate`); the agent's user-role message gets the unified
   honest line.

```ts
// convex/engine/resolution.ts — chest success push (line ~738)
trace.actions.push({
  characterId: ev.actorId,
  kind: "loot",
  target: ev.chestId,             // e.g. "Chest_53_54"
  result: "opened",                // unchanged vocabulary
  lootedItem: item.name,           // NEW — "speed" / "sword" / "chain"
});

// convex/engine/resolution.ts — chest empty/collision (line ~723, replaces silent continue)
if (!chest) continue;              // defensive — programming error
if (chest.opened) {
  trace.actions.push({
    characterId: ev.actorId,
    kind: "loot",
    target: ev.chestId,
    result: "already_opened",
  });
  continue;
}
if (chest.contents === null) {
  trace.actions.push({
    characterId: ev.actorId,
    kind: "loot",
    target: ev.chestId,
    result: "empty",
  });
  continue;
}
```

For successful loot, `inputBuilder.renderActionFragment` looks at `lootedItem`
to render `looted <item> from <target>`. For `already_opened` / `empty` /
drained corpse repeat, the renderer outputs the unified
`looted nothing from empty <target>` line.

> **Q-A3 — RESOLVED:** keep `opened` / `looted` / `already_opened` / `empty`
> as discriminated trace vocabulary; unify only the rendered agent-facing line.

**WP-A4 acceptance gain (§5):** integration test for two looters declaring
the same chest in the same turn — winner gets `result: "opened"` with
`lootedItem`, loser gets `result: "already_opened"` with no `lootedItem`,
both render `looted ...` lines in their next-turn user-role messages.

Alternative considered and rejected: encode item into `result` (e.g.,
`result: "looted speed"`). Rejected because it conflates the result vocabulary
(which downstream consumers grep on) with content; an additive optional field
is cleaner.

#### 3.1.3 System prompt turn-binding

Current `SYSTEM_PROMPT` is a constant. The two-phase countdown requires turn
input:

```ts
// convex/llm/systemPrompt.ts
export function buildSystemPrompt(turn: number): string {
  const evacReveal = 30;
  const extraction = 50;
  const countdown =
    turn < evacReveal
      ? `Evac location spawns in ${evacReveal - turn} turns`
      : `Extraction in ${extraction - turn} turns`;
  return [
    `You are <Player Name>, extraction-arena agent. Each turn, emit ONE tool call to \`decide_turn\`.`,
    `Match shape:`,
    `- 7 other agents competing for the prize pool.`,
    `- On turn 50, living agents Inside the Evac 3×3 zone are extracted and split the prize. You will be incinerated if outside Evac at turn 50.`,
    `- ${countdown}.`,
    `- Walls block LOS and movement.`,
    `- Cover hides you from other agents' vision (revealed by enemy within 2, attacking, speaking, looting, consumable).`,
    `- Move range max 8 dist + Attack/loot range 2 = move attack/loot 10.`,
  ].join("\n");
}
```

Callers: the system prompt is materialised inside `convex/llm/inputBuilder.ts`
at the existing constants references at `:451,479` (NOT `convex/llm/azure.ts`
— `state.turn` is already in scope inside `buildAgentInput`; azure receives
the materialised string and is unchanged). Trace persistence still records
the resolved string in `agentRecord.input.systemPromptText` per ADR §7
(self-containment). The hash captured in `systemPromptHash` is computed over
the resolved (turn-bound) string.

> **Q-A2 — RESOLVED:** Turn-bound system prompt hash. The actual prompt varies
> by turn (countdown), so the hash should identify the actual LLM input.
> Update tests/comments from "stable across match" to **"stable across personas
> within the same turn; varies across turns"**. Downstream usage is light
> (tests + trace display), not replay dedupe — no breakage.

#### 3.1.4 Chest-id rename — dev DB wipe sequence

POC posture endorses a clean wipe. Sequence:

1. Land all schema + engine + LLM + test changes on the branch (incl. the
   `convex/matches.ts:expandMapInline` mirror — see §3.1 surface table).
2. `convex/spike.ts:wipeOneTable` walks the six tables in dependency order
   (phase-6 closure §4 precedent: `turns → matches → characters → worldState
   → runs → reports`).
3. `npx convex dev --once --typecheck=disable` re-pushes functions.
4. Harness 1-run smoke before the 10-run iteration loop. Smoke acceptance:
   zero `chest_\d+` literals anywhere in the persisted trace; chest hover
   card and replay snapshot's chest-open-flip both render.

#### 3.1.5 Retry-recovery persistence — additive `llm.retried`

The diagnostics view's critical-fails family requires a **retry-recovery
rate** metric — i.e. for each persisted LLM call, did the wrapper make a
second HTTP attempt (transient retryable status: `{429, 500, 502, 503, 504}`)
and what fraction of those second attempts succeeded? Today, the wrapper
captures `raw.retried: boolean` at `convex/llm/azure.ts:60-67` but the
field is dropped on the way to persistence — `buildAgentLlmRecord` and the
Convex `agentLlmValidator` don't carry it.

**Additive change (no migration):**

- `convex/schema.ts:142-159` (`agentLlmValidator`): add
  `retried: v.optional(v.boolean())`. Historical rows validate cleanly.
- `convex/_internal_runMatch.ts:194-208` and `convex/runMatch.ts:427-494`
  (`buildAgentLlmRecord`): copy `raw.retried` into the persisted `llm`
  block.
- `convex/turns.ts:byMatchSlim` (workstream B): include `llm.retried` in
  the slim projection (it's a single boolean — well under the budget).
- Diagnostics: `harness/diagnostics/critical.ts` computes
  `retryRecoveryRate = count(retried === true && fellBackToSafeDefault === false) / count(retried === true)`.

This is an additive WP scoped under workstream A (substrate) because the
schema lives in `convex/schema.ts`. Implementation grouped with WP-A1's
schema edit so it lands in the same Convex push as the other additive
fields (`lootedItem`).

### 3.2 Convex 16 MB unblock (workstream B)

#### 3.2.1 New query `turns.byMatchSlim`

Add a sibling to `byMatch` in `convex/turns.ts`. The implementation reads the
same rows (Convex read budget is per-function, measured on what the function
reads, not what it returns), then PROJECTS heavy text out AND COMPUTES lean
derived per-record signals before returning. **Both projections matter** —
heavy-text removal keeps the response under budget, derived signals unblock
diagnostics workstream C and closing-report workstream D.

**Heavy text omitted from response (still costs read budget):**
`input.systemPromptText`, `input.personaPromptText`, `input.visibleStateDigest`,
`input.scratchpadBefore`, `input.composedUserMessage`, `llm.reasoning`,
`llm.rawArguments`, `llm.httpBodyExcerpt`.

**Lean derived per-record signals computed inside the query** (these are
small — booleans, counts, single-word enums — and unblock the metric families
in `behavioural-diagnostics-intent.md` §3 without re-shipping the heavy text):

| Field | Shape | Source | Used by |
|---|---|---|---|
| `scratchpadChanged` | `boolean` | `r.input.scratchpadBefore !== r.scratchpadAfter` | scratchpad churn metric (intent §3.3) |
| `visibleSummary` | `{ enemies: number, chests: number, corpses: number, evacSeen: boolean }` | parsed from `r.input.visibleStateDigest` (counts only — no ids/text) | visibility cross-cuts, saw-enemy-and-no-op carve-out |
| `selfEquipment` | `{ weapon: string\|null, armour: string\|null }` | own equipped slots from the state row (opponent equipment stays masked) | equipment cross-cuts |
| `damageFeedAudit` | `{ incoming: number, outgoing: number, dealtKills: number }` | counts from `row.resolution` damage/kill events involving this character | damage-feed delivery audit (intent §3.2) |
| `inboundSpeechCount` | `number` | count of `row.resolution.speech[]` entries with `r.characterId ∈ heardBy` AND speaker ≠ self | speech metrics |
| `lootOutcomeFeed` | `Array<{ result: "opened" \| "looted" \| "already_opened" \| "empty" \| "no_corpse", item?: string }>` | this character's `row.resolution.actions[]` loot entries with the new `lootedItem` field | loot-funnel metrics; iter-3 verbose-honest gate verification |
| `llm.retried` | `boolean \| undefined` | `r.llm.retried` (additive field per §3.1.5) | retry-recovery rate |

```ts
export const byMatchSlim = query({
  args: { matchId: v.id("matches") },
  handler: async (ctx, { matchId }) => {
    const rows = await ctx.db
      .query("turns")
      .withIndex("by_match_turn", (q) => q.eq("matchId", matchId))
      .order("asc")
      .collect();
    return rows.map((row) => ({
      _id: row._id,
      matchId: row.matchId,
      turn: row.turn,
      resolution: row.resolution, // includes new lootedItem field per §3.1.2
      agentRecords: row.agentRecords.map((r) => ({
        characterId: r.characterId,
        personaId: r.personaId,
        decision: r.decision,
        scratchpadAfter: r.scratchpadAfter,
        // ── derived signals (computed here; small) ─────────────────────
        scratchpadChanged: r.input.scratchpadBefore !== r.scratchpadAfter,
        visibleSummary: summariseVisible(r.input.visibleStateDigest),
        selfEquipment: extractSelfEquipment(row, r.characterId),
        damageFeedAudit: auditDamageFeed(row.resolution, r.characterId),
        inboundSpeechCount: countInboundSpeech(row.resolution.speech, r.characterId),
        lootOutcomeFeed: extractLootOutcomes(row.resolution.actions, r.characterId),
        // ── projected non-text fields ──────────────────────────────────
        input: {
          systemPromptHash: r.input.systemPromptHash,
          personaPromptHash: r.input.personaPromptHash,
          useVariant: r.input.useVariant,
          // OMITTED: systemPromptText, personaPromptText, visibleStateDigest,
          // scratchpadBefore, composedUserMessage
        },
        llm: {
          responseId: r.llm.responseId,
          callId: r.llm.callId,
          usage: r.llm.usage,
          latencyMs: r.llm.latencyMs,
          httpStatus: r.llm.httpStatus,
          fellBackToSafeDefault: r.llm.fellBackToSafeDefault,
          failureReason: r.llm.failureReason,
          validatorFieldErrors: r.llm.validatorFieldErrors,
          retried: r.llm.retried, // §3.1.5
          // OMITTED: rawArguments, httpBodyExcerpt, reasoning
        },
      })),
    }));
  },
});
```

The `summariseVisible` / `extractSelfEquipment` / `auditDamageFeed` /
`countInboundSpeech` / `extractLootOutcomes` helpers are pure and live next
to the query in `convex/turns.ts` (or a co-located `convex/turns/derive.ts`
module — engineer's call). They MUST be unit-testable from harness side
(import-shape compatible with `tests/harness/diagnostics.test.ts`).

> **Per-match size check (measured, not estimated):** the canonical
> phase-6 match `j97e6dvmegsemdvazv52g66jxd86j7ad` is 50 turns × 380
> agentRecords × ~12.5 KB/record = ~4.7 MB full response via `turns:byMatch`.
> Slim projection drops the heavy text fields → ~389 KB per match. The READ
> side still costs the full ~4.7 MB per match (Convex meters reads on
> document size, not projection size), well under the 16 MB per-function
> budget. A 20-match server-side aggregation would read ~95 MB and blow the
> budget — confirming Option A's per-match-call design.

**Why derived signals here vs in the diagnostics CLI:** the heavy text
fields (`visibleStateDigest`, `scratchpadBefore`, `composedUserMessage`)
are exactly what we want OUT of the response. Computing the derived signals
inside the query lets the CLI/dashboard work from a small payload without
ever shipping the text — the parse happens once, server-side, against the
text that's already loaded into the function's read budget.

#### 3.2.2 Client-side fan-out helper

Shared between CLI and dashboard. Lives in a place importable by both — the
CLI's `harness/client.ts` already wraps a `ConvexHttpClient`; for the
dashboard the helper lives in `apps/replay/src/lib/diagnosticsFanout.ts`.

```ts
async function fetchSlimAcross(client, matchIds: string[]) {
  return Promise.all(
    matchIds.map((id) => client.query(api.turns.byMatchSlim, { matchId: id }))
  );
}
```

> **Why client-side fan-out over a server-side aggregator?** Per intent doc
> §6: server-side aggregation would still consume the per-function read budget
> for whatever subset of fields it touches. Client-side fan-out is one Convex
> function call per match — each call independently under-budget — and the
> aggregation happens in CLI / browser memory, which is unbounded. Material-
> ised aggregate tables are deferred until a closing-50 demands them.

### 3.3 Behavioural diagnostics view (workstream C)

#### 3.3.1 CLI `harness/diagnostics.ts`

Sibling to `harness/analyze-match.ts`. CLI shape:

```bash
npx tsx harness/diagnostics.ts --last 20 [--format json|markdown] [--out path]
```

Flow:

1. Resolve the last N completed matches. `convex/replay.ts:43-51`'s
   `api.replay.listMatches` is paginated (`paginationOptsValidator`), so the
   CLI either calls it via `ConvexHttpClient` with `{ numItems: N, cursor: null }`,
   OR adds a small `replay.listLastCompletedMatches` query that returns the
   last N completed match metadata in one call. Engineer's call — both are
   trivial.
2. Fan out `byMatchSlim` across N matches via the WP-B2 helper.
3. Compute three metric families in pure functions (`harness/diagnostics/critical.ts`,
   `harness/diagnostics/mechanics.ts`, `harness/diagnostics/behaviour.ts` —
   pure, vitest-able, decoupled from Convex). These functions consume the
   `byMatchSlim` derived-signal contract from §3.2.1; they do NOT re-parse
   the heavy text fields (which are absent).
4. Emit JSON + markdown. Markdown carries deep-link URLs for each contextual-combo
   row's drill-down items (top-K entries; full list in JSON).

#### 3.3.2 Dashboard tab — `apps/replay`

New hash route: `#/diagnostics?last=N`. Lives alongside existing `#/` (picker)
and `#/match/<id>` (replay).

- `apps/replay/src/main.tsx:92-102` — extend the route table to recognise
  the new `#/diagnostics` route alongside `#/` (picker) and `#/match/<id>`
  (replay).
- App-level header / tab strip exposes `Matches | Diagnostics` as
  primary navigation. The MatchPicker also gains a small "View
  diagnostics across last N matches →" affordance as a secondary
  discovery path.
- Reuse `useHashRoute.parseHash` extension to recognise the new route and
  parse `?last=N` (mirror existing `?turn=N` parsing convention).
- `routes/Diagnostics.tsx` — owns the `last` slider control, calls the
  fan-out helper, renders three families as collapsible sections.
- Inline SVG bars (no chart lib dep) for histograms / persona × X bars.

> **Q-C1 — RESOLVED:** Inline SVG. The dashboard is diagnostic-grade and
> needs bars/tables, not a charting dep. Recharts can wait until the UI
> needs richer interaction.

> **Q-C2 — RESOLVED:** App-level `Diagnostics` tab/route is the primary
> entry (the North Star explicitly says "dashboard tab"). MatchPicker
> entry is a secondary affordance — keeps cohort view discoverable
> without burying it.

#### 3.3.3 Deep-link drill-down — `?character=` param

Extend `useHashRoute` to parse `?character=<persona>`. In `Replay.tsx`,
when both `?turn` and `?character` are set on mount, auto-open the
`ExpandModal` for that `(turn, characterId)` tuple. `<persona>` is the
display name (e.g. `Duelist`); the route resolves it to `characterId`
via the bundle's `characters[]` list.

URL examples:

- `#/diagnostics?last=20` — diagnostics dashboard tab.
- `#/match/j97abc?turn=33&character=Duelist` — opens replay at turn 33,
  ExpandModal auto-open for Duelist.

### 3.4 Closing report (workstream D)

Pattern mirrors the phase-6 closing path. **The 16 MB unblock from
workstream B opens two viable paths; Path 2 is the default:**

- **Path 2 (DEFAULT — phase-6-proven pattern):** CLI / local compute
  fan-outs `byMatchSlim` across matchIds, aggregates client-side using
  the same pure metric modules WP-C1 ships, then persists a small payload
  via a thin `persistComputedPhase7Report` mutation. The closing-report
  payload itself is ~30 KB and persists cleanly. This is exactly the
  pattern phase-6 fell back to after the 16 MB failure
  (`PHASE-6-CLOSURE.md:137-145`).
- **Path 1 (OPTIONAL LATER SPIKE — if a closing-50 needs server-side):**
  a Convex **action** (NOT a mutation — mutations cannot call queries)
  that calls `ctx.runQuery(api.turns.byMatchSlim, { matchId })` per match
  in a loop, aggregates in action-local memory, then calls
  `ctx.runMutation(api.reports.persistComputedPhase7Report, { payload })`
  to persist. Treat as future work after Path 2 is green; the per-call
  `ctx.runQuery` budget semantics (does it share the parent action's 16 MB?
  Convex docs are ambiguous) are an open spike.

> **Q-B1 — RESOLVED:** Path 2 (local compute + small persist) is the
> default. It is phase-6-proven, avoids the ambiguous `ctx.runQuery` budget
> semantics, and avoids the mutation/action confusion. Path 1 is
> deferred-spike-only.

Report type: `phase-7-closing-20` (new `reports.reportType` discriminator).
Schema diff in `convex/schema.ts`: add an optional `phase7Payload` validator
sibling to `phase6Payload` (mirroring the phase-3 / phase-6 precedent).

> **Q-D1 — RESOLVED:** `phase-7-closing-20` reportType (matches phase-3 /
> phase-6 precedent). Do NOT add a separate diagnostics-view reportType;
> the diagnostics view recomputes on demand and persists nothing
> (intent §6).

**Thresholds preserved from phase-6 (the comparable ones):**

| Gate | Threshold |
|---|---:|
| Runs with extraction | ≥ 30 % |
| Runs with kill | ≥ 80 % |
| Runs with equip | ≥ 80 % |
| Runs with speech | ≥ 50 % |
| Persona extraction spread | ≥ 15 pp |
| Failed matches | 0 |
| `null_only` raw `use:"consumable"` emissions | 0 |
| Action+overwatch combos | ≥ 10 |
| Movement-triggered overwatch fires | ≥ 5 |
| Counter retaliations | ≥ 5 |
| Compass bearings | all 8 |
| Personal damage feed missing lines | 0 |
| Whole-turn validator zeroes | 0 |
| Per-field rejection rate | ≤ 10 % |
| `Player_N` literals | 0 |

**New gates (substrate iter-3 specific):**

| Gate | Threshold | Rationale |
|---|---:|---|
| In-range inbound speech feed events delivered | > 0 over the 20-run set | Regression-restored signal. Trader persona must actually speak heard-by listeners. |
| Loot-outcome line carries item name on success | 100 % of successful loots | Pillar 4 substrate contract. |
| Loot-outcome line marks `empty` on failure | 100 % of `already_opened` / drained-repeat loots | Same. |
| Chest target id literals coord-encoded | 100 % (zero `chest_NNN` in any trace target / outcome line) | Rename completeness. |

**Replaced (not lowered):** the `noOpRate < 5 %` phase-6 gate. Phase-7 records
`armedStancePauseRate` and `trueStationaryRate` separately in the closing
payload; neither is gated. Documented-why-not lives in the closure record per
phase-6 precedent.

---

## 4. Dependency Map & Parallelisation

```
                     ┌─────────────────────┐
                     │ WP-A1 chest rename  │
                     │ (DB wipe gate)      │
                     └────────┬────────────┘
                              │
       ┌──────────────────────┼──────────────────────┐
       │                      │                      │
┌──────▼──────┐       ┌──────▼──────┐         ┌──────▼──────┐
│ WP-A2 Vision│       │ WP-A3 Status│         │ WP-A4 Feed  │
│ shrink      │       │ block       │         │ restructure │
└──────┬──────┘       └──────┬──────┘         └──────┬──────┘
       │                     │                      │
       └─────────────┬───────┴──────────────────────┘
                     │
              ┌──────▼──────┐
              │ WP-A5 System│
              │ prompt 2-ph │
              └──────┬──────┘
                     │
                     │ (substrate iter-3 LIVE)
                     │
                     ▼
              ┌─────────────┐
              │ WP-D1 + D2  │
              │ closing-20  │
              └─────────────┘

(parallel track, can start day-1)
┌─────────────────────────┐
│ WP-B1 slim query        │
│ + derived-signal SHAPE  │──┐
└─────────────────────────┘  │
                             ▼
              ┌─────────────────────┐
              │ WP-B2 fan-out helper│
              └────────┬────────────┘
                       │
       ┌───────────────┴───────────────┐
       │ (C1 cannot start hardening    │
       │  metrics until B1 SHAPE is    │
       │  locked — see sequencing)     │
       │                               │
┌──────▼──────┐                ┌──────▼──────┐
│ WP-C1 CLI   │                │ WP-C2 dash  │
│ diagnostics │                │ tab         │
└─────────────┘                │ + WP-C3 link│
                               └─────────────┘
```

**Sequencing notes:**

- **WP-A1 (chest rename + additive schema fields) is the workstream-A gate.**
  Dev DB wipe + schema rename + the additive `lootedItem` / `retried` fields
  must land before any downstream WP-A* depends on the new ids or WP-D1
  consumes the new fields. Once it's in, A2-A4 can be done as one engineer
  pass or three (the surfaces are separable but they all live in
  `inputBuilder.ts`).
- **Workstream B is fully independent of A on the slim-query mechanics**, but
  the derived-signal contract (`lootOutcomeFeed.item`, `llm.retried`) reads
  from WP-A1's additive schema fields. B1 can land structurally without those
  fields populated (helpers tolerate `undefined`); the **fields populate** as
  WP-A1 lands. B2 (fan-out helper) is mechanical and independent.
- **Workstream C consumes B's derived-signal contract.** C1 (CLI) MUST NOT
  start hardening metrics until WP-B1's slim-query SHAPE is locked (the
  tests/turns.test.ts assertions). C1 may pre-stub against the contract, but
  the iter-3-specific metrics (loot-outcome naming, chest coord literal
  audits, visibility/equipment cross-cuts, damage-feed delivery) cannot be
  validated end-to-end until A's substrate AND B's slim-query both land. Use
  phase-6 traces for shape/logic smoke only; reserve metric-correctness
  validation for fresh phase-7 traces.
- **WP-D depends on A being live** (the closing run needs the new substrate)
  AND on B+C being live (Path 2 driver consumes B's slim query AND C1's pure
  metric modules). The closing report's metric computation reuses pure
  functions from WP-C1's diagnostics modules.

**Recommended parallelisation (revised):**

- Day 1: WP-A1 (one engineer — chest rename + additive schema fields, dev
  DB wipe). + WP-B1 (slim-query SHAPE — derived-signal contract; one
  engineer, in parallel). + WP-B2 (fan-out helper, mechanical; can be the
  same engineer as B1 or a third).
- Day 2: WP-A2 + WP-A3 + WP-A4 (one engineer, sequential — same module
  `inputBuilder.ts`) + WP-C1 CLI starts against the locked B1 contract
  (one engineer; iter-3-only metrics stubbed-but-not-validated).
- Day 3: WP-A5 (system prompt) + WP-C2 + WP-C3 (dashboard tab + deep-link).
- Day 4: WP-D1 (closing-report aggregator + Path 2 driver) + WP-D2
  (20-run + closure record).

---

## 5. Work Package Breakdown

Each WP is a UAT-shippable vertical slice (engineer ships tests + code + a
specific observable artifact the user can step through).

### WP-A1 — Chest id rename engine-wide + additive schema fields

**Scope:**

- `convex/engine/map.ts`: `expandMap` emits `id: "Chest_<x>_<y>"` per chest
  (drop ordinal padding).
- `convex/matches.ts:97-160` (`expandMapInline`): mirror the rename in
  lockstep — silent breakage if missed (Convex bundler / `node:fs` reasons).
- `convex/engine/resolution.ts`: drop the `Chest_*` → `chest_*` translation
  branch; single id namespace. Strip the case-folding fallback.
- `convex/engine/runStats.ts:217-225`: switch chest equip gate from
  `target.startsWith("chest_")` to a tiny `isChestId(...)` helper. Without
  this, chest equips drop to zero in runStats.
- `convex/engine/validation.ts:30-31`: drop chest case-folding.
- `convex/llm/idNormalisation.ts:104-117` AND `:206`: collapse
  `chestTargetIds` to a single passthrough; simplify `findChestByTargetId`;
  remove the second case-folding branch at `:206`.
- `convex/llm/inputBuilder.ts:84-88`: `renderChestId` returns `Chest_<x>_<y>`
  directly from the entity's position.
- `apps/replay/src/lib/reconstruct.ts:224-230`: load-bearing chest-open-flip
  guard — switch to `isChestId(...)` or replay snapshot stops flipping
  `opened: true`.
- `apps/replay/src/components/HoverCard.tsx:327-328`: chest id format in tooltip.
- `apps/replay/src/lib/decisionEnglish.ts`, `formatters.ts`: chest id renderer
  references.
- `harness/analyze-match.ts:58-64`: CLI consumer that gates on chest id prefix.
- Sweep `convex/reports/*.ts` for any `target.startsWith("chest_")` and switch.
- `personas/*.md`: grep for `chest_` and replace any dead literals.
- **Additive schema diffs (bundled into the same Convex push):**
  - `convex/schema.ts:142-159` (`agentLlmValidator`):
    `retried: v.optional(v.boolean())` per §3.1.5.
  - `convex/schema.ts:312-329` (`resolution.actions[]`):
    `lootedItem: v.optional(v.string())` per §3.1.2.
  - `convex/_internal_runMatch.ts:194-208` and `convex/runMatch.ts:427-494`
    (`buildAgentLlmRecord`): plumb `raw.retried` through to persisted `llm`.
  - `convex/engine/types.ts:304-315` (`ActionTraceEntry`): add
    `lootedItem?: string`.
- Tests: update every fixture using `chest_NNN` / `Chest_NNN` (bulk rename
  across hot files listed in §3.1 surface table — ~94 literals); persistence
  parity tests for `retried` and `lootedItem` (round-trip through
  `_internal_runMatch.ts`).
- Dev DB wipe + Convex repush.
- 1-run smoke pass through the harness.

**Success criteria:**

- All tests green (`npm test`, `npm run typecheck`, `npm run lint`).
- `npx convex run reports:byId` over a freshly produced match shows
  zero `chest_\d+` literals anywhere in the persisted trace —
  audited in `resolution.actions[].target`,
  `agentRecord.decision.action.targetId`, and
  `agentRecord.decision.position.direction.targetId`.
- Replay UI loads a fresh match without errors; chest hover-card / Grid
  references render the new id.
- A persisted `agentRecord.llm.retried` round-trips end-to-end (probe via
  `azure.ts`'s synthetic-retry path or a unit test mocking the wrapper).
- A persisted `resolution.actions[]` loot success entry carries
  `lootedItem: "<weapon|armour|consumable name>"`; `result: "already_opened"`
  / `result: "empty"` chest entries exist when same-turn collision or dud
  occurs.

### WP-A2 — Vision shrink to `Vision:` block

**Scope:**

- Rewrite `inputBuilder.buildVisibleObject` to emit the slim shape per intent
  doc §1. Character entries: `{ dist, bearing, hp, armed }`. Chest / Corpse /
  Cover / Wall: `{ dist, bearing }` only. Evac: same when outside zone;
  ABSENT when inside.
- Suppress Evac entry inside the 3×3 zone (`observerInEvacZone === true`).
- Rename the JSON serialisation header — the composed user-role message now
  reads `Vision:\n{ … }` instead of just `{ … }`.

**Success criteria:**

- `tests/llm/inputBuilder.test.ts` updated and green: assert no `kind`,
  `pos`, `opened`, `drained`, `contents`, `equipped`, `inZone` keys appear
  in `visibleStateDigest`. Character entries carry `armed: boolean`.
- Replay UI's full-LLM-input pane (ExpandModal) shows `Vision:` header
  with the slim shape on a fresh trace turn.

### WP-A3 — Status block update (Evac flag + unarmed damage)

**Scope:**

- `renderStatusBlock` appends `Outside Evac` / `Inside Evac` to the `📍` line.
- `renderWeaponSlot` returns `unarmed [dmg 5]` (where 5 is read from
  `MIN_DAMAGE_FLOOR`, exported from `convex/engine/types.ts:95-100` —
  NOT from `combat.ts` where `UNARMED_BASE_DAMAGE` is module-local) when
  the weapon slot is empty.

**Success criteria:**

- Pure unit tests on `renderStatusBlock` / `renderWeaponSlot` for inside,
  outside, and pre-reveal (Outside) cases, and unarmed vs equipped.
- ExpandModal preview confirms a fresh-match agent inside the evac zone
  sees `📍(48,48) Inside Evac` and no `Evac:` entry in Vision.

### WP-A4 — Feed restructuring (split own-speech, loot enrichment, inbound-speech restore, same-turn loot collision)

**Scope:**

- `buildOwnOutcomeLine`: drop the speech fragment; outcome is mechanical-only.
- New `buildOwnSpeechLine` returns `You said "<text>"` or null. Quote and
  newline-normalise the speech text (Q-A4: no length cap, but JSON-safe
  rendering so the feed line stays parseable).
- `renderActionFragment` (loot path): for chest-open success, render
  `looted <item> from <chestId>` using the new `lootedItem` field; for
  corpse-loot success, `looted <item> from Corpse_<persona>`. For
  empty / drained / already_opened, render the unified
  `looted nothing from empty <target>` line per Q-A3.
- **Trace contract — chest empty / same-turn collision.** Update
  `convex/engine/resolution.ts:721-743` to replace the silent `continue`
  on `chest.opened || chest.contents === null` with explicit trace pushes
  per §3.1.2. Two cases:
  - `chest.opened` → `result: "already_opened"`.
  - `chest.contents === null` → `result: "empty"`.
  - `!chest` → keep silent `continue` (defensive; programming error).
- New `buildInboundSpeechLines` scans `prev.resolution.speech` for entries
  with the observer in `heardBy` AND speaker ≠ observer; emits
  `<DisplayName> said "<text>"` (same JSON-safe quoting as own-speech).
  **Regression restoration — critical.** Reuse the existing
  `buildHeardForObserver` filter from `convex/runMatch.ts` rather than
  reimplementing the heardBy match.
- Event ordering in `buildAgentInput` updates to: own-outcome → personal
  damage → own-speech → inbound-speech → kill-feed.

**Success criteria:**

- `tests/llm/inputBuilder.test.ts` covers all four loot-outcome shapes
  (chest success with named item, chest empty/already_opened, corpse
  success with named item, corpse drained).
- `tests/engine/resolution.test.ts` adds a **same-turn two-looters**
  integration test: A and B both queue `loot Chest_X_Y` in the same turn;
  one wins with `result: "opened"` + `lootedItem: "..."`; the other gets
  `result: "already_opened"` with no `lootedItem`. Both render
  `looted ...` lines in their NEXT-turn user-role messages
  (one names the item, one renders `looted nothing from empty Chest_X_Y`).
- `tests/llm/inputBuilder.test.ts` covers inbound-speech delivery: when
  agent A speaks within LOS / proximity of agent B, B's next-turn user-role
  message contains `A said "…"` (JSON-safe quoted).
- `tests/llm/inputBuilder.test.ts` covers own-speech as a SEPARATE event
  line, distinct from the mechanical outcome line.
- Snapshot-style assertion that the event ordering matches the intent
  doc's sample.

### WP-A5 — System prompt two-phase countdown

**Scope:**

- `convex/llm/systemPrompt.ts`: replace const string with
  `buildSystemPrompt(turn: number)`.
- Plumb `state.turn` into the caller at `convex/llm/inputBuilder.ts:451,479`
  (`buildAgentInput` already has `state.turn` in scope; just swap
  `SYSTEM_PROMPT` for `buildSystemPrompt(state.turn)`). **NOT
  `convex/llm/azure.ts`** — azure receives the materialised string and is
  unchanged.
- Persisted `agentRecord.input.systemPromptText` carries the resolved
  (turn-bound) string. `systemPromptHash` is computed over that resolved
  string per Q-A2 (turn-bound hash).
- Update any test/comment language describing the hash from "stable across
  match" to "stable across personas within the same turn; varies across
  turns."
- Rephrase win-condition line per the intent doc.

**Success criteria:**

- `tests/llm/systemPrompt.test.ts` (new) covers pre-30, exactly-30, and
  post-30 turn cases — verifies the countdown line text flip.
- ExpandModal's system-prompt pane shows the new line on a fresh-match
  turn 5 trace (`Evac location spawns in 25 turns`) and turn 35 trace
  (`Extraction in 15 turns`).
- `systemPromptHash` is identical across all 8 personas at the same turn,
  and differs from the previous turn's hash (assertion in
  `tests/llm/inputBuilder.test.ts`).

### WP-B1 — Slim per-match query + derived signals

**Scope:**

- Add `byMatchSlim` to `convex/turns.ts` per §3.2.1.
- Add the five derived-signal helpers (`summariseVisible`,
  `extractSelfEquipment`, `auditDamageFeed`, `countInboundSpeech`,
  `extractLootOutcomes`) — pure, co-located in `convex/turns.ts` or a
  sibling `convex/turns/derive.ts` module. Engineer's call.
- Helpers must be importable into `tests/turns.test.ts` AND
  `tests/harness/diagnostics.test.ts` (workstream C consumes the same
  pure functions).
- Convex repush.

**Success criteria:**

- `tests/turns.test.ts` (new or extended) verifies:
  - Heavy text omitted: the five `input.*` text fields
    (`systemPromptText`, `personaPromptText`, `visibleStateDigest`,
    `scratchpadBefore`, `composedUserMessage`) and three `llm.*` text
    fields (`rawArguments`, `httpBodyExcerpt`, `reasoning`) are absent
    in the returned shape.
  - Lean derived signals present and well-shaped: `scratchpadChanged`,
    `visibleSummary` (counts only), `selfEquipment` (own loadout —
    opponent stays masked), `damageFeedAudit`, `inboundSpeechCount`,
    `lootOutcomeFeed`, `llm.retried`.
  - Pure helper unit tests covering the obvious edge cases (no enemies
    visible → `enemies: 0`; pre-evac-reveal → `evacSeen: false`; loot
    `result: "already_opened"` → no `item` in feed entry).
- Smoke: `npx convex run turns:byMatchSlim '{"matchId": "<known id>"}'`
  succeeds without 16 MB error; the returned per-match payload is
  ≤ ~500 KB on the canonical phase-6 50-turn match.

### WP-B2 — Client-side fan-out helper

**Scope:**

- Shared helper exported from `harness/diagnostics/fanout.ts` for the CLI,
  mirrored under `apps/replay/src/lib/diagnosticsFanout.ts` for the
  dashboard (or a single shared module if the build tooling allows).
- Helper resolves a list of matchIds, fires N parallel `byMatchSlim`
  queries via `Promise.all`, returns the aggregated array.

**Success criteria:**

- Unit test mocking `ConvexHttpClient.query` confirms parallel issue
  (all N calls fired before any resolves).
- CLI smoke: `npx tsx harness/diagnostics.ts --last 5` returns 5 match
  payloads aggregated client-side, no Convex errors.

### WP-C1 — CLI `harness/diagnostics.ts`

**Scope:**

- New file `harness/diagnostics.ts` consuming `harness/diagnostics/fanout.ts`.
- Three metric-family modules under `harness/diagnostics/` (pure, testable):
  - `critical.ts` — failure-mode distribution, retry recovery, output-token
    cap-proximity histogram, per-field validator rejection, persona × failure
    cross-tab.
  - `mechanics.ts` — attack outcomes, overwatch split, counter, loot funnels,
    consume waste, speech metrics, damage-feed audit, wall-blocked moves,
    declared-vs-actual move distance.
  - `behaviour.ts` — top-level totals, contextual combos (the full table from
    intent §3.3.2), cross-cuts, saw-enemy-and-no-op carve-out, plus the
    `armedStancePauseRate` / `trueStationaryRate` split.
- CLI arg parsing: `--last N` (default 20, clamped to 20), `--format
  {markdown, json}` (default markdown), `--out <path>` (default stdout).

**Success criteria:**

- `tests/harness/diagnostics.test.ts` covers each metric module with
  synthetic agent-record fixtures (a record where `position.kind ===
  "overwatch" && action.kind === "none"` is counted in `armedStancePauseRate`
  but NOT in `trueStationaryRate`, etc.).
- CLI smoke: `npx tsx harness/diagnostics.ts --last 20 --format json` over
  the existing phase-6 closing-20 set produces well-formed JSON; markdown
  output renders in a terminal at ~120 cols without runaway wrapping.

### WP-C2 — Replay dashboard diagnostics tab

**Scope:**

- `apps/replay/src/main.tsx:92-102`: extend the route table for the new
  `#/diagnostics` route alongside `#/` (picker) and `#/match/<id>` (replay).
- New route `#/diagnostics?last=N` parsed by extended `useHashRoute`.
- App-level `Matches | Diagnostics` tab/header strip (per Q-C2 default).
  MatchPicker also gains a small secondary "View diagnostics →" affordance
  for discoverability.
- `apps/replay/src/routes/Diagnostics.tsx` — wires the fan-out helper to the
  three metric modules (imported from a shared lib OR re-exported from a
  vite-compatible path; crew chooses build-time strategy).
- Inline SVG bars / tables; minimal styling; lists clickable to deep-links.

**Success criteria:**

- Manual UAT: load `#/diagnostics?last=20` against a Convex deployment
  carrying ≥ 5 completed matches; the three families render without
  console errors; a click on any list row navigates to the deep-link URL
  and opens the existing ExpandModal at the right turn / character.
- The `Matches | Diagnostics` tab is visible from the picker route and
  toggles between picker and diagnostics without page reload.
- Visual: nothing fancy; the user has explicitly said simple is fine.

### WP-C3 — Deep-link plumbing (`?character=` param)

**Scope:**

- Extend `useHashRoute.parseHash` to parse `?character=<displayName>` on
  the `/match/<id>` route.
- `Replay.tsx`: on mount, if route carries both `turn` and `character`,
  resolve `character` → `characterId` via `bundle.characters`, call
  `setModalTarget({ turn, characterId })`.
- Defensive: unknown `character` value is ignored (no modal opens).

**Success criteria:**

- `apps/replay/src/lib/__tests__/useHashRoute.test.ts` (correct path —
  the file lives under `__tests__` next to the lib, not under a top-level
  `tests/` dir) extended for the `?character=` parse case.
- Manual UAT: paste `#/match/<id>?turn=33&character=Duelist` directly into
  the address bar; ExpandModal auto-opens.

### WP-D1 — Closing-report aggregator `phase-7-closing-20`

**Scope:**

- New `convex/reports/phase7.ts` mirroring the phase-6 file layout, plus
  `harness/closing/phase7.ts` (Path 2 driver — local compute + small
  persist). The aggregator math itself is shared pure functions imported
  from WP-C1's diagnostics modules; only the orchestration differs.
- Path 2 (DEFAULT per Q-B1): the harness driver fans out `byMatchSlim`
  across the 20 matchIds, aggregates locally using WP-C1's pure modules,
  then calls a thin `convex/reports/phase7.ts:persistComputedPhase7Report`
  mutation with the small (~30 KB) payload.
- Schema diff: `phase7PayloadValidator` added as a sibling optional
  field on `reports`, parallel to `phase6Payload`. New `reportType`
  literal `"phase-7-closing-20"`.
- Threshold gates per §3.4. Two new metrics included as DATA, not gates:
  `armedStancePauseRate`, `trueStationaryRate`. (The single phase-6
  `noOpRate < 5%` gate is REPLACED, not lowered.)
- Includes the new substrate-iter-3 gates from §3.4: inbound speech
  delivered > 0, loot success names item 100%, loot empty marks empty
  100%, zero `chest_\d+` literals, retry-recovery rate computed (data
  not gate — just must be defined / non-NaN).

**Success criteria:**

- `tests/reports/phase7.test.ts` covers each new gate with synthetic
  fixtures.
- Aggregator runs cleanly over a small set of fresh-substrate matches
  (3-5 runs) as smoke before the 20-run pass.
- `convex/reports/phase7.ts:persistComputedPhase7Report` round-trips a
  small payload without 16 MB read budget concerns (it doesn't read
  trace data; it only writes the pre-aggregated payload).

### WP-D2 — 20-run closing report execution + closure record

**Scope:**

- Wipe dev DB.
- Run 20-match closing pass at `low / 1200` (phase-6 baseline; no probe
  tuning in scope).
- Persist phase-7 closing report.
- Author `docs/project/phases/07-context-payload-iter-3/PHASE-7-CLOSURE.md`
  following the phase-6 closure pattern: canonical reportId, threshold
  verdict table, documented-why-not for any miss, OCC substitution policy,
  damage-feed audit scope note, ADR rollup, replay/UI verification, deferred
  items.

**Success criteria:**

- 20-match closing report row persisted with `reportType =
  "phase-7-closing-20"`.
- Closure record committed.
- All gates from §3.4 PASS (with substrate-iter-3 gates load-bearing) OR
  any miss is honestly documented per phase-6 precedent.

---

## 6. Assignment-Level Success Criteria

The phase closes when ALL of the following hold:

1. **Substrate iter-3 LIVE on a fresh closing run:**
   - Vision serialises per intent doc §1 (slim shape; `Vision:` header;
     inside-evac suppression).
   - Status block carries the Evac flag (`Outside Evac` / `Inside Evac`,
     including `Outside Evac` pre-reveal per Q-A1) and the
     `⚔️weapon: unarmed [dmg 5]` line.
   - Outcome line is mechanical-only.
   - Own-speech is a separate feed event (`You said "…"`), JSON-safe quoted.
   - Inbound in-range speech is delivered as feed events
     (`<Persona> said "…"`). REGRESSION RESTORED.
   - Loot outcome names item on success / marks empty on failure (incl.
     same-turn collisions emit explicit `result: "already_opened"` trace).
   - Chest ids are coord-encoded engine-wide (`Chest_<x>_<y>`); zero
     `chest_\d+` literals anywhere in the persisted trace (audited across
     `resolution.actions[].target`, `agentRecord.decision.action.targetId`,
     `agentRecord.decision.position.direction.targetId`).
   - System prompt carries the two-phase countdown line; hash is
     turn-bound per Q-A2.
   - Additive schema fields populate on every fresh row: `llm.retried`
     (boolean) and `resolution.actions[].lootedItem` (string, on success).

2. **Convex 16 MB unblock LIVE:** `turns.byMatchSlim` callable per match
   under-budget; CLI / dashboard fan out across 20 matches without
   exceeding 16 MB on any single call. The slim response carries the
   six derived signals (`scratchpadChanged`, `visibleSummary`,
   `selfEquipment`, `damageFeedAudit`, `inboundSpeechCount`,
   `lootOutcomeFeed`) plus `llm.retried` per §3.2.1.

3. **Behavioural diagnostics view LIVE:**
   - CLI emits the three metric families over the last 20 matches in
     JSON and markdown. Critical-fails family includes a defined
     (non-NaN) `retryRecoveryRate`.
   - Dashboard renders the same with clickable drill-down to the existing
     replay ExpandModal at `#/match/<m>?turn=<t>&character=<persona>`.
   - App-level `Matches | Diagnostics` tab present per Q-C2.
   - No new ExpandModal variant.

4. **Closing report `phase-7-closing-20` persisted (Path 2 default):**
   - All comparable phase-6 thresholds preserved (extraction ≥ 30 %,
     kill ≥ 80 %, equip ≥ 80 %, speech ≥ 50 %, persona spread ≥ 15 pp,
     zero crashes, ≥ 5 counter / ≥ 5 overwatch trigger / ≥ 10
     action+overwatch combos, all 8 compass bearings, zero illegal
     `use:"consumable"`, zero `Player_N` literals, zero whole-turn
     validator zeroes, per-field rejection ≤ 10 %).
   - Four new substrate-iter-3 gates PASS (inbound speech > 0, loot
     names item 100 %, loot empty marks empty 100 %, zero `chest_\d+`).
   - `armedStancePauseRate` + `trueStationaryRate` reported as data
     (not gated); replaces phase-6's single `noOpRate` gate.
   - `retryRecoveryRate` reported as data (not gated; just must be
     defined).

5. **Closure record published** at
   `docs/project/phases/07-context-payload-iter-3/PHASE-7-CLOSURE.md`
   following the phase-6 closure pattern.

---

## 7. Resolved Decisions (formerly Open Questions)

All eight Q-A* / Q-B* / Q-C* / Q-D* decisions are resolved by the
Navigator before dispatch (defaults locked from REVIEW.md). Implementers
follow the resolutions; do not reopen without surfacing back to the user.

| ID | Resolution | Rationale | Carried in |
|---|---|---|---|
| Q-A1 | **Status renders `Outside Evac` pre-reveal.** Vision still carries no Evac entry before reveal. | Matches the intent doc samples; structurally stable Status line. | §3.1.1 |
| Q-A2 | **Turn-bound system prompt hash.** Test/comment language updates: "stable across personas within the same turn; varies across turns." | The actual prompt varies by turn (countdown), so the hash should identify the actual LLM input. Downstream usage is light (tests + trace display), not replay dedupe. | §3.1.3 |
| Q-A3 | **Keep existing trace vocabulary** (`opened`, `looted`, `already_opened`, `empty`); unify only the rendered agent-facing line to `looted nothing from empty <target>`. | Preserves diagnostic discrimination (chestSameTurnCollisionRate vs chestEmptyAtSpawnRate vs chestRepeatLootRate) while satisfying the agent-facing contract. | §3.1.2, WP-A4 |
| Q-A4 | **No speech cap for iter-3.** Render with JSON-style quoting / newline normalization so feed lines stay parseable. Diagnostics reports speech length / fanout so future bloat is measured. | Uncapped speech preserves pillar 5 (text is terrain). The cap is a measurement question, not a substrate question — defer until diagnostics surfaces a bloat signal. | WP-A4 |
| Q-B1 | **Path 2 (local compute + small persist) is the default.** Path 1 is a deferred-spike-only Convex action calling `ctx.runQuery` per match. | Path 2 is phase-6-proven; avoids ambiguous `ctx.runQuery` budget semantics and the original mutation/action confusion. | §3.4 |
| Q-C1 | **Inline SVG.** No chart-lib dep. | Diagnostic-grade dashboard — bars/tables suffice. Recharts can wait until the UI needs richer interaction. | §3.3.2 |
| Q-C2 | **App-level `Diagnostics` tab/route is primary.** MatchPicker entry is a secondary discovery affordance. | The North Star explicitly says "dashboard tab." A top-level tab keeps cohort view discoverable. | §3.3.2 |
| Q-D1 | **`phase-7-closing-20`** as the new `reports.reportType`. No separate diagnostics-view reportType. | Matches phase-3 / phase-6 precedent. The diagnostics view recomputes on demand and persists nothing (intent §6). | §3.4 |

---

## 8. Recommended Job Sequence

(For the PM dispatching subagents.)

**Track 1 — Substrate (workstream A):** sequential engineer-led implement WPs,
ordered. Single engineer can carry the workstream.

1. WP-A1 (chest rename + additive `lootedItem` / `retried` schema diffs +
   DB wipe). UAT GATE: 1-run smoke clean; one persisted row carries
   `llm.retried` and one carries `resolution.actions[].lootedItem`.
2. WP-A2 + WP-A3 + WP-A4 bundled (all live in `inputBuilder.ts`; can be one
   commit with three test groups). UAT GATE: 1-run smoke; user steps through
   a fresh match's turn-5 in the replay's ExpandModal and confirms the
   Vision / Status / feed shape; same-turn-collision integration test green.
3. WP-A5 (system prompt). UAT GATE: ExpandModal shows new countdown
   line at turn 5 and turn 35.

**Track 2 — Unblock (workstream B):** parallel with Track 1. (B1 SHAPE is
the gate for C1's metric hardening.)

1. WP-B1 (slim query + derived-signal contract per §3.2.1). UAT GATE:
   `convex run` smoke under-budget; `tests/turns.test.ts` asserts the
   six derived signals AND the omitted heavy-text fields.
2. WP-B2 (fan-out helper). UAT GATE: CLI prototype fires 20 parallel calls.

**Track 3 — Diagnostics (workstream C):** structurally depends on B1
SHAPE being locked. Iter-3-only metrics validated only after A lands.

1. WP-C1 (CLI). UAT GATE: CLI emits JSON + markdown over phase-6 traces
   for shape/logic. Iter-3-only gates (loot-naming, chest-coord audits,
   damage-feed delivery) pre-stubbed; correctness validated against a
   fresh phase-7 trace once Track 1 closes.
2. WP-C2 + WP-C3 bundled (dashboard tab + deep-link). UAT GATE: user
   loads `#/diagnostics?last=20`, clicks a row, ExpandModal opens at
   the right turn/character; `Matches | Diagnostics` tab visible.

**Track 4 — Closing (workstream D):** depends on Track 1 complete + WP-C1
modules importable.

1. WP-D1 (aggregator + Path 2 driver). UAT GATE: aggregator runs over a
   small set of fresh-substrate matches without errors.
2. WP-D2 (closing run + closure record). FINAL UAT GATE: phase-7
   closing report persisted; closure record committed.

**Review vs implement placement:**

- **Implement first, review at WP boundaries.** Each WP is self-contained
  enough that a code-review pass at completion is cheaper than a planning
  re-review mid-stream. Trigger an `ultrareview` only after Track 1 closes
  if the user wants a second-opinion on the iter-3 prose / event ordering.
- The closing run (WP-D2) is the implicit final review — the closing report
  thresholds are the regression test.

---

## 9. References

- `docs/project/spec/mental-model.md` §16
- `docs/project/spec/context-payload-iter-3-intent.md`
- `docs/project/spec/behavioural-diagnostics-intent.md`
- `docs/project/spec/per-turn-context-intent.md` (predecessor — iter-2)
- `docs/project/spec/decision-tool-schema-draft.md` (schema unchanged)
- `docs/project/phases/06-per-turn-context-iter-2/PHASE-6-CLOSURE.md`
- `convex/engine/types.ts:95-100` (`MIN_DAMAGE_FLOOR = 5` — Status block
  source; `combat.ts:35-37`'s `UNARMED_BASE_DAMAGE` is module-local and
  equals the floor)
- `convex/llm/inputBuilder.ts` (workstream A focal file; system-prompt
  callsites at `:451,479`)
- `convex/llm/systemPrompt.ts` (workstream A focal file)
- `convex/engine/resolution.ts:721-743` (chest loot trace augmentation
  site) and `:766-816` (corpse loot trace augmentation site)
- `convex/engine/map.ts` (chest-id rename site)
- `convex/matches.ts:97-160` (`expandMapInline` mirror — must rename in
  lockstep)
- `convex/engine/runStats.ts:217-225` (chest equip gate — `isChestId`
  switch)
- `convex/llm/idNormalisation.ts:104-117` and `:206` (chest-id consumer
  + second case-folding branch)
- `convex/turns.ts` (`byMatchSlim` new home + derived-signal helpers)
- `convex/schema.ts:142-159` (additive `llm.retried`) and `:312-329`
  (additive `lootedItem`)
- `convex/_internal_runMatch.ts:194-208` and `convex/runMatch.ts:427-494`
  (`buildAgentLlmRecord` plumbing — retry + lootedItem)
- `convex/llm/azure.ts:60-67` (raw `retried` capture point — read by
  `buildAgentLlmRecord`)
- `convex/reports/phase6.ts` (pattern to mirror in `phase7.ts`;
  `PHASE-6-CLOSURE.md:137-145` for the local-compute precedent)
- `harness/analyze-match.ts:58-64` (chest-id consumer; sibling pattern
  for `harness/diagnostics.ts`)
- `apps/replay/src/main.tsx:92-102` (route table — add `#/diagnostics`)
- `apps/replay/src/lib/useHashRoute.ts` and
  `apps/replay/src/lib/__tests__/useHashRoute.test.ts` (deep-link parse
  extension + tests)
- `apps/replay/src/lib/reconstruct.ts:224-230` (chest-open-flip guard —
  load-bearing)
- `apps/replay/src/components/HoverCard.tsx:327-328` (chest tooltip
  format)
- `apps/replay/src/routes/Replay.tsx` (auto-open ExpandModal on
  `?character=`)
- `apps/replay/src/components/ExpandModal.tsx` (drill-down target)
