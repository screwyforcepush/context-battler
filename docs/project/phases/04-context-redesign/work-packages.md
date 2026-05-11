# Phase 04 — Work Packages

> Seven work packages sequenced as Diagnostic-bundle-first (WP-B) →
> Trace surfaces (WP-A) || System-prompt slim (WP-C) → User-message
> rebuild (WP-D) → Visible-format bench (WP-E) || Lever probe (WP-F) →
> Closing-10 (WP-G). Each WP has scope, acceptance, test strategy, and
> risks. Tests-first per `.agents/AGENTS.md` AOP for every pure-function
> module under refactor.
>
> WP IDs continue the alphabet (phase-3 closed at WP-I). Phase-4 uses
> WP-A through WP-G as fresh ids — the alphabet resets per phase so each
> phase's WP-A is the foundation slice of that phase.

---

# Foundation — sequencing

**WP-B lands first.** Diagnostic surfaces are UI-only and read already-
persisted phase-3 trace fields, so they have no schema or engine
dependency. The user must be able to see `rawArguments`, `validatorReason`,
and the truncation indicator BEFORE the bench (WP-E) and closing pass
(WP-G), otherwise the data those measure cannot be diagnosed. WP-B may
ship as soon as the engineer's local replay can open a phase-3 closing-10
trace and verify the four new surfaces render.

**WP-A and WP-C land in parallel with WP-B** (disjoint write sets). WP-A
is engine + state slice (action-trace `weapon` emit + runMatch threading);
WP-C is LLM-slice config (systemPrompt + decisionTool descriptions). WP-B
is renderer slice. All three can be reviewed and merged independently.

**WP-D depends on WP-A + WP-C.** The user-message rebuild needs the
kill-feed trace data (WP-A) and the slim system prompt (WP-C) to land
the §2 ordering coherently.

**WP-E depends on WP-D.** The bench probes the Visible-object format,
which is the renderer-side switch added in WP-D.

**WP-F can overlap WP-E in implementation/plumbing, but lever-probe
cohorts run AFTER WP-E pins the Visible-format winner.** Probes
`max_output_tokens` and `reasoning.effort`; orthogonal to the Visible
format axis in design but the probe is run ON the winning format to
avoid confounding lever data with a moving Visible-shape target.
Implementation seam (parameterise `MAX_OUTPUT_TOKENS` via the
`matches` row, harness CLI flag) can be done concurrently with WP-E
— but the cohort that produces the probe data fires after the
winner is pinned in `inputBuilder.ts` `VISIBLE_FORMAT`.

**WP-G is the closing gate.** 10 runs on the pinned redesigned substrate;
phase-4 report row; closure doc.

The "review before close" rhythm from phases 1/2/3 carries over —
reviewers run before WP-G, not after.

---

## WP-A — Trace surfaces for kill feed + alive count

**Scope.**

- **WP-A.1 — Schema additives (`convex/schema.ts`).** Two optional
  fields, both additive per ADR §1:
  - Add `weapon?: string` to the `resolution.actions[]` entry
    validator:
    ```ts
    v.object({
      characterId: v.id("characters"),
      kind: v.string(),
      target: v.string(),
      result: v.string(),
      fromOverwatch: v.optional(v.boolean()),
      stance: v.optional(v.union(v.literal("offensive"), v.literal("defensive"))),
      weapon: v.optional(v.string()),  // PHASE-4 ADR §1a
    })
    ```
  - Add `composedUserMessage?: string` to `agentInputValidator`:
    ```ts
    const agentInputValidator = v.object({
      systemPromptHash: v.string(),
      systemPromptText: v.string(),
      personaPromptHash: v.string(),
      personaPromptText: v.string(),
      visibleStateDigest: v.string(),
      scratchpadBefore: v.string(),
      composedUserMessage: v.optional(v.string()),  // PHASE-4 ADR §1b
    })
    ```
  Mirror BOTH changes in `convex/_internal_runMatch.ts`
  (`resolutionValidator` AND `agentInputValidator` mirrors) per the
  phase-3 ADR §1 "Mirror note" — these MUST land in lockstep or the
  persistence adapter rejects new-shape rows. Both additives are
  backward-compatible; no DB wipe. The populate path for
  `composedUserMessage` lives in WP-D.5 (`runMatch.ts` writes the
  assembled userMessage onto `agentRecord.input`); WP-A.1 lands the
  validator only.
- **WP-A.2 — Engine emit (`convex/engine/combat.ts` +
  `convex/engine/resolution.ts`).** On every attack and overwatch trace
  emission, populate `weapon` with the killer's `equipped.weapon?.name`
  at strike resolution time (before any post-strike state mutation
  such as the corpse body-loot pass). The field is OPTIONAL on the
  trace entry; emit `undefined` (omit) when the striker has no weapon
  equipped — combat resolution is well-defined for unarmed strikes
  but the field reads honest as "no weapon at strike". `runStats.ts`
  remains untouched (no metric reads this field yet).
- **WP-A.3 — Engine `types.ts` mirror.** Extend the TS `ActionTraceEntry`
  alias to carry the same `weapon?: string`. Compile-time check that the
  Convex validator and TS type stay aligned.
- **WP-A.4 — `convex/llm/inputBuilder.ts` `PrevTurnRow` typing +
  kill-feed renderer.** Extend the `actions[]` shape in `PrevTurnRow`
  with the new optional `weapon` field. Add a new pure helper
  `buildKillFeedLines(prev, state) → string[]`.

  **Resolution path (deterministic; intent §3 + ADR §1).** The
  schema has two id shapes that need bridging: `resolution.deaths[]`
  carries `Id<"characters">` (Convex doc ids); `resolution.actions[]
  .target` carries the `Player_N` displayName; `actions[]
  .characterId` is `Id<"characters">`; `state.characters[].
  characterId` is the engine string id (e.g. `"P1"`); `state
  .characters[].displayName` is `"Player_1"`. The renderer walks
  **`prev.resolution.actions[]`** (NOT `deaths[]`):

  1. Filter for damage-result entries: `kind ∈ {"attack",
     "overwatch"} AND result.startsWith("dmg ")`.
  2. **Group damage entries by victim** (use `target` —
     displayName — as the grouping key, since that's what the
     trace carries directly).
  3. For each group, determine whether the victim died this turn by
     resolving the victim's `displayName → Id<"characters">` via
     `state.characters.find(c => c.displayName === target)?.
     characterId` and checking membership in `prev.resolution.
     deaths[]`. (Or, simpler: a victim died iff the cumulative
     damage in the group ≥ that victim's HP at start of phase 5;
     but `deaths[]` is the engine's authoritative answer, so use
     it directly via the displayName→id resolve.)
  4. If the victim died, the **killer is the actor on the FIRST
     damage entry in iteration order whose cumulative damage on
     that victim crossed the HP=0 threshold** (kill-attribution
     rule per ADR §1). Resolve the killer's `characterId →
     displayName` via `state.characters.find(c => c.characterId ===
     action.actor)?.displayName`. The weapon is the killer entry's
     `weapon` field.
  5. Render `<killer-displayName> killed <victim-displayName>
     with <weapon>` for each kill. When `weapon` is absent, render
     `<killer> killed <victim> with bare hands` (defensible
     default; rare per the engine's combat semantics).

  **Multi-attacker unit test (mandatory).** Two attackers (P2 and
  P3) both deal damage to P1 in the same turn; P3's strike is the
  one that pushes cumulative damage ≥ P1's HP. The kill-feed line
  attributes the kill to Player_3 (not Player_2), with Player_3's
  weapon. Locks the kill-attribution rule against drift.
- **WP-A.5 — `convex/runMatch.ts` alive-count + kill-feed plumbing.**
  In `advanceTurn`, compute `aliveCount = characters.filter(c =>
  c.alive).length` after the prior turn's resolution applies but
  before the new digest is built. Pass `aliveCount` through to
  `buildAgentInput`. The kill-feed lines are derived inside the builder
  from `PrevTurnRow` — no new runMatch plumbing required beyond the
  existing prior-turn threading.
- **WP-A.6 — `convex/runMatch.ts` resolution adapter `weapon`
  preservation (LOAD-BEARING).** The current adapter
  `adaptResolutionForSchema` (lines 456–576) maps engine
  `ActionTraceEntry` shape to the persisted validator shape via
  conditional spread for `fromOverwatch` and `stance`. WP-A.6 extends
  the SAME adapter with the SAME conditional-spread idiom for
  `weapon`:
  ```ts
  actions: trace.actions.map((a) => ({
    characterId: a.characterId as Id<"characters">,
    kind: a.kind,
    target: a.target,
    result: a.result,
    ...(a.fromOverwatch !== undefined ? { fromOverwatch: a.fromOverwatch } : {}),
    ...(a.stance !== undefined ? { stance: a.stance } : {}),
    ...(a.weapon !== undefined ? { weapon: a.weapon } : {}),  // WP-A.6
  })),
  ```
  This is the same seam class that caused the phase-3 D24/D36/H1
  drift (adapter silently dropped new engine-emit fields when the
  schema-mirror update missed it). WP-A.6 is called out explicitly so
  the engineer wires it AND extends the
  `tests/integration/persistAdaptParity.test.ts` parity assertion in
  the same commit. Same pattern applies if the engine
  `ActionTraceEntry` mirror in `convex/engine/types.ts` (WP-A.3)
  introduces additional fields — they must round-trip through this
  adapter.

**Acceptance.**

- [ ] `convex/schema.ts` `resolutionValidator.actions[]` carries the
  optional `weapon` field. `convex/schema.ts` `agentInputValidator`
  carries the optional `composedUserMessage` field.
  `convex/_internal_runMatch.ts` mirrors BOTH validators.
- [ ] `convex/runMatch.ts:adaptResolutionForSchema` is extended to
  conditionally-spread the new `weapon` field on `actions[]` entries
  per WP-A.6. (The `composedUserMessage` populate is owned by WP-D.5;
  WP-A.1 only adds the validator slot.)
- [ ] `tests/engine/combat.test.ts` extends with: a strike that produces
  a `dmg N` result also produces a trace entry whose `weapon` matches
  the striker's equipped weapon name. Defensive overwatch counter-fire
  entries carry `weapon` from the overwatcher's weapon at strike time.
- [ ] `tests/engine/resolution.test.ts` extends with: a kill (deaths[]
  entry) is paired with an actions[] entry whose `weapon` equals the
  killer's strike-time weapon (NOT post-cleanup, NOT the corpse's
  contents).
- [ ] `tests/llm/inputBuilder.test.ts` extends with: (a) a turn whose
  prior resolution carries `deaths[]: [<id-for-Player_1>]` + a matching
  `actions[]: [{kind: "attack", characterId: <id-for-Player_2>, target:
  "Player_1", result: "dmg 50", weapon: "axe"}]` renders a single
  kill-feed line `Player_2 killed Player_1 with axe`; the renderer
  resolves the killer via `state.characters.find(c => c.characterId
  === action.actor)?.displayName`. (b) Multi-attacker case: two
  attackers (Player_2 with sword + Player_3 with axe) both deal damage
  to Player_1; Player_3's strike pushes cumulative damage across the
  HP=0 threshold; the kill-feed line attributes the kill to Player_3
  with axe (NOT Player_2 with sword). (c) Multiple distinct kills
  render multiple lines. (d) Zero kills renders zero lines (no empty
  section, no `(no kills)` placeholder).
- [ ] `tests/integration/persistAdaptParity.test.ts` extends to cover
  the new fields (round-trip a `resolution.actions[]` entry with
  `weapon` set; round-trip another with `weapon` absent; round-trip an
  `agentRecord.input` with `composedUserMessage` set; round-trip
  another with it absent — all four shapes should serialise +
  deserialise cleanly). This is the regression-guard against the
  D24/D36/H1 adapter-drift pattern.
- [ ] `npm run typecheck && npm test` green at root.
- [ ] One smoke run completes turn-by-turn; the persisted trace contains
  at least one `actions[]` entry with `weapon` set.

**Test strategy.**

- Unit-first for `buildKillFeedLines` — pure function, deterministic on
  `PrevTurnRow` + `state.characters` for the displayName lookup.
- Engine integration tests for the strike-time-weapon contract: a test
  where the striker swaps weapon mid-resolution (artificial; not a real
  engine path) confirms that the field captured the pre-swap value.
  This is the contract that justifies persisting the field rather than
  reconstructing from state.
- Persistence parity test extension is the integration-test backstop;
  the existing test pattern at `tests/integration/persistAdaptParity.test.ts`
  is the pattern.

**Risks.**

- *Schema mirror drift*: phase-3's recurring pattern (D24 / D36 / WP-H)
  was that the persistence-adapter mirror drifted from the schema. WP-A.1
  bundles both edits in one commit; the existing `tests/llm/schemaMirror
  .test.ts` parity test extends to cover the new field. Low residual
  risk.
- *`weapon` field bloats trace size*: rough math — 8 agents × 50 turns ×
  10 runs × ~10 chars ≈ 40 KB per closing-10. Trivial.
- *Defensive overwatch counter-fire entries carry the OVERWATCHER's
  weapon, not the original attacker's*: that's the correct semantics —
  the counter-fire IS the overwatcher's strike. The kill-feed reads
  `actions[].weapon` for the entry that produced the kill, so it picks
  up the correct (overwatcher's) weapon on counter-fire kills.

**Dependencies.** None outside WP-A. Disjoint write set from WP-B and
WP-C. Can land in parallel with both.

---

## WP-B — Replay UI diagnostic bundle (lands FIRST)

**Scope.**

- **WP-B.1 — `apps/replay/src/lib/rawPane.ts` extensions.** Three new /
  extended pure-function composers:
  - `composeFullLlmInput` extended from 2 sections (system role + user
    role) to **3 sections** (system role + user role + tool schema).
    Tool schema section imports the live `decisionTool` constant from
    `convex/llm/decisionTool.ts` and pretty-prints with 2-space indent.
    **Reasoning text is NOT appended to `composeFullLlmInput`** —
    reasoning is model output, not input; it stays in the
    `composeReasoningText` pane, which is rendered separately by
    ExpandModal (see WP-B.2). Per ADR §5 / intent §6.
  - **User-role sourcing.** The user role is sourced from
    `agentRecord.input.composedUserMessage` when present (phase-4
    traces) — rendered verbatim. When absent (phase-3 traces), fall
    back to the existing client-side composition (`## Persona /
    ## Scratchpad / ## Visible state` wrapper). Single `if
    (composedUserMessage) render verbatim; else legacy compose`
    switch; no shape-detection branch.
  - `composeRawArgumentsVsDecision(agentRecord) → { matched: boolean,
    rendered: string }` — new pure helper.
    - `matched: true` when the canonicalised `JSON.parse(rawArguments)`
      strict-equals `agentRecord.decision` (key-order-insensitive, no
      whitespace). Renders as a single pretty-printed pane.
    - `matched: false` when they differ (e.g. wrapper safe-defaulted
      after a parse failure; `multiple_function_calls` kept the first
      call but normalised it; the model emitted a shape that Zod's
      strict-mode rejected but JSON.parse succeeded). Renders as a
      side-by-side `--- rawArguments ---` / `--- decision ---`
      block. `rawArguments` is shown verbatim (including invalid JSON);
      `decision` is pretty-printed.
    - Edge case: `rawArguments === null` (the wrapper safe-defaulted
      before any function call materialised — `no_function_call`,
      `http_non_200`, etc). Render `(no rawArguments — wrapper-level
      failure)` and surface `failureReason`.
  - `composeUsageBar(agentRecord, maxOutputTokens) → { rendered:
    string, truncated: boolean }`. Returns the compact bar string
    (`"[output_tokens / max] tokens"`) and the `truncated` flag
    (`true` iff `output_tokens >= 0.95 * max`). Caller renders the
    indicator separately.
- **WP-B.2 — `apps/replay/src/components/ExpandModal.tsx` 4-pane raw
  modal.** Replace the phase-3 3-section render with 4 panes:
  1. **Full LLM Input** — now 3 sub-sections from WP-B.1 (system
     role + user role + tool schema). Request-inputs-only;
     **reasoning text is NOT in this pane** (it has its own pane
     below).
  2. **Reasoning text** — UNCHANGED from phase-3 (model output,
     dedicated pane). Kept distinct from Full LLM Input.
  3. **Tool call** — rawArguments vs decision matched/diverged from
     WP-B.1.
  4. **`validatorReason` block** (NEW) when
     `agentRecord.llm.validatorReason` is set.
- **WP-B.3 — `apps/replay/src/components/TurnFeed.tsx` indicators.**
  - Small `⚠` badge per row when (decision diverges from rawArguments)
    OR `validatorReason` is set OR `failureReason` is set. Click reveals
    the ExpandModal (existing affordance).
  - Compact usage bar `[output / max]` per row. 🔴 truncated indicator
    visible when ≥ 95% of cap.
- **WP-B.4 — Tests** (`apps/replay/src/lib/__tests__/rawPane.test.ts` +
  the existing `apps/replay/src/components/__tests__`):
  - Matched-case rawArguments-vs-decision render returns
    `matched: true` for an equal-modulo-whitespace pair.
  - Diverged case: agent record with the wrapper's safe-default decision
    + a populated `rawArguments` shows `matched: false` with both panes.
  - rawArguments null case renders the wrapper-failure pane.
  - Usage bar renders the ratio; `truncated` flag fires at 95% cap.
  - Tool schema section pretty-prints the `decide_turn` definition with
    the load-bearing description fields visible (probably just an
    assertion that the rendered string contains `"decide_turn"` + the
    canonical move/action keywords; WP-C's description content is
    tested separately in `tests/llm/decisionTool.test.ts`).

**Acceptance.**

- [ ] Opening any phase-3 closing-10 match in the replay UI shows the
  rawArguments-vs-decision diagnostic on every agent turn (collapsed
  to one pane when matched; side-by-side when diverged).
- [ ] `validatorReason` surfaces on TurnFeed rows where it's set in the
  phase-3 trace, and in the ExpandModal for any row.
- [ ] Token usage bar renders on every TurnFeed row; the 🔴 truncated
  indicator lights up on rows where `usage.output_tokens / 1200 ≥ 0.95`.
- [ ] Full LLM Input pane has **3** sub-sections (system role + user
  role + tool schema). Reasoning text is NOT in this pane — it
  remains in its own existing reasoning-text pane.
- [ ] On phase-4 traces, the user-role section renders
  `agentRecord.input.composedUserMessage` verbatim; on phase-3 traces
  (field absent), it falls back to the legacy client-side compose
  path. A WP-B.4 test fixture covers both branches.
- [ ] `npm run lint && npm run typecheck && npm run build && npm test`
  green at root and in `apps/replay/`.

**Test strategy.**

- Pure-function tests in `apps/replay/src/lib/__tests__/rawPane.test.ts`
  for all three composers. Match the existing rawPane test pattern.
- React component tests for TurnFeed indicators are not load-bearing
  (the pure-function helpers carry the logic); add minimal smoke
  rendering tests if the existing pattern in
  `apps/replay/src/components/__tests__` makes it cheap, otherwise
  defer to manual QA against a phase-3 trace.
- Manual QA: the user opens at least one phase-3 closing-10 match and
  steps through three turns confirming all four surfaces render
  correctly. This IS the load-bearing acceptance — the diagnostic
  bundle is the user's tool, so the user is the validator.

**Risks.**

- *`rawArguments` canonicalisation false-positives*: a model that emits
  `{"primary": "move", "consume": "none", ...}` in different key order
  than `agentRecord.decision`'s persisted shape would render as
  "diverged" even though the parsed semantics match. Mitigation: the
  canonicalisation walks both as deep-equal-keys-sorted JSON before
  the equality check. The Zod parser preserves key order on parse but
  the schema validator persists in the schema-declared order, so
  canonical comparison is the honest check.
- *Tool schema section bloats the Full LLM Input pane*: the
  `decisionTool` JSON pretty-prints to ~ 3 KB. Acceptable for the
  expand modal (the pane is scrollable). If the user feedback is
  "too much", a collapse-by-default render is a cheap follow-up.
- *Truncation threshold tuning*: 95% is a hypothesis. WP-G's closing-10
  data may suggest 90% or 98% catches the cluster better. The constant
  lives in `composeUsageBar`; tuning is a one-line change with no
  schema implication.

**Dependencies.** None. UI-only against the phase-3 trace ledger. Can
land BEFORE WP-A and WP-C.

---

## WP-C — System prompt slim + tool-schema description enrichment

**Scope.**

- **WP-C.1 — `convex/llm/systemPrompt.ts` slim rewrite.** Replace the
  current `SYSTEM_PROMPT` constant with the user's hand-crafted shape
  per intent §1 / ADR §2 (verbatim block in ADR §2). Target ≤ 200
  tokens (chars/4 proxy ≤ 800 chars). Delete the `How to read Visible`,
  `How to act on Visible`, and `Output discipline` sections; delete the
  persona-deference closing line; delete the `Match shape:` token-
  tunable suffix line (`Vision 20 (Chebyshev). Walls block LOS, cover
  does not. Movement 8 ...`) since those are tool-schema-property
  semantics per ADR §3.
- **WP-C.2 — `convex/llm/decisionTool.ts` description enrichment.**
  Per intent §5 / ADR §3:
  - `decide_turn` top-level description — keep the existing decision-
    bundle framing, augment with the overwatch-stance dual contract
    (already partially there; load-bearing prose, not enum-inferred).
  - `move` property description — add 6-arm grammar verbatim from
    intent §5: `relative dx,dy` (integers in [-12,12]);
    `toward_entity Player_N`; `away_from_entity Player_N`;
    `toward_object <Chest_NNN|Corpse_Player_N>`; `toward_evac`;
    `none`. Plus: "Movement range max 8 (12 w/ speed)."
  - `action` property description — `attack Player_N`; `loot
    <Chest_NNN|Corpse_Player_N>` (copy id verbatim); `none`. Plus:
    "Attack/loot range 2 (Chebyshev)."
  - `primary` property description — 3-value semantics + overwatch dual.
  - `overwatch_stance` property description — offensive/defensive
    semantics + null-iff-not-overwatch.
  - `scratchpad_update` property description — usage hint.
- **WP-C.3 — Prompt-hygiene guard test.** New section in
  `tests/llm/systemPrompt.test.ts` (or a new
  `tests/llm/promptHygiene.test.ts`) asserting that the strings
  `safe default`, `replaced with`, `invalid choices`, `fallback`, `do
  nothing` do NOT appear in either `SYSTEM_PROMPT` or any
  `decisionTool` description field (top-level + all property
  descriptions). Walks the schema recursively.
- **WP-C.4 — `tests/llm/systemPrompt.test.ts` rewrite.** Lock the slim
  contract:
  - Asserts presence of the stakes line and the match-shape bullets.
  - Asserts absence of the three deleted section headings.
  - Asserts ≤ 800 chars (chars/4 ≤ 200 tokens).
  - Imports + re-runs the prompt-hygiene guard from WP-C.3.
- **WP-C.5 — `tests/llm/decisionTool.test.ts` extension.** Per-property
  description-content asserts (each description must contain its
  load-bearing keywords). The `move` description MUST contain **all
  six move arms** plus the movement-range marker: `relative`,
  `toward_entity`, `away_from_entity`, `toward_object`,
  `toward_evac`, `none`, `Movement range`. Omitting `away_from_entity`
  in earlier drafts was a content-keyword gap; the test guards all
  six arms.
- **WP-C.6 — `tests/llm/integration.test.ts` refresh.** The existing
  integration test imports `SYSTEM_PROMPT` verbatim (per phase-3
  WP-H.3); the new slim shape needs the test's digest-shape
  assertions updated, but those are mostly handled in WP-D's
  inputBuilder rewrite. WP-C.6's minimum is: the integration test
  still compiles + runs against the slim prompt without false
  failures (the digest-shape assertions are a WP-D concern).

**Acceptance.**

- [ ] `convex/llm/systemPrompt.ts` `SYSTEM_PROMPT` matches the verbatim
  shape in intent §1 / ADR §2.
- [ ] The chars/4 budget is ≤ 200 tokens (≤ 800 chars).
- [ ] None of the 5 hygiene-leak phrases appear in `SYSTEM_PROMPT` or
  any `decisionTool` description (top-level OR property-level).
- [ ] Each enriched description carries its load-bearing keywords per
  intent §5 (move arms, action arms, ranges, stance contract,
  scratchpad usage).
- [ ] `npm test` green for `tests/llm/systemPrompt.test.ts`,
  `tests/llm/decisionTool.test.ts`, `tests/llm/schemaMirror.test.ts`
  (the existing parity test continues to pass — description-only
  changes do not affect `required[]` alignment).

**Test strategy.**

- Tests-first per AOP. The hygiene-leak guard test (WP-C.3) is
  load-bearing for acceptance B and must be authored before the
  prompt rewrite lands.
- Description-content tests (WP-C.5) are content asserts on stable
  strings — fragile-by-construction, but the fragility IS the contract:
  if a future engineer waters down the description without re-asserting
  the load-bearing keywords, the test catches it.

**Risks.**

- *Slim prompt regresses tool-call pass rate*: phase-3's schema-teacher
  framing was a response to phase-1's 84.5% safe-default rate. Removing
  the English mirror in phase-4 risks regressing to that floor. See
  de-risking D1 — the mitigation is a 10-run pre-flight probe on a
  fixed seed cohort with the slim prompt + enriched descriptions, BEFORE
  WP-D's user-message rebuild. **Canonical threshold (de-risking.md
  §D1): if pass rate regresses > 3 pp** vs the phase-3 closing-10
  baseline (fellback rate > 11.3%), WP-C iterates (per-arm
  descriptions); > 10 pp escalates. The 3 pp threshold is the
  canonical number; earlier README drafts using "> 5 pp" are
  superseded.
- *Description-content asserts are fragile*: a future engineer may
  re-word a description (legitimate edit) and break the test on a
  keyword the engineer didn't realise was load-bearing. Mitigation: the
  test asserts on the load-bearing **keyword set** (e.g. all six move-
  arm names must be present), not on full strings. Re-wording around
  the keyword set is fine; removing a keyword fails the test.

**Dependencies.** None. Disjoint write set from WP-A and WP-B. Can land
in parallel with both.

---

## WP-D — Per-turn user message rebuild

**Scope.**

- **WP-D.1 — `convex/llm/inputBuilder.ts` user-message composer.**
  Replace the phase-3 `buildAgentInput` return shape (`{ systemPrompt,
  visibleStateDigest }`) with a new shape that owns the whole user
  message. Two options under consideration:
  - (a) Return `{ systemPrompt, userMessage }` where `userMessage` is
    the fully-assembled string per intent §2.
  - (b) Return `{ systemPrompt, personaPromptText, previousTurnBlock,
    currentGameStateBlock }` and let `convex/llm/azure.ts` join.
  WP-D picks (a) — the assembly is a single ordering contract and
  splitting it across two modules invites drift. The persisted
  `agentRecord.input.visibleStateDigest` field continues to carry just
  the Visible-object body (the spatial-perception slice); the
  reconstructed full user message is computed at render time by the
  replay UI from the persisted fields + the prior turn row.
- **WP-D.2 — `convex/llm/azure.ts:buildUserMessage` simplification.**
  Delete the phase-3 `## Persona / ## Scratchpad / ## Visible state`
  wrapper. The wrapper now passes the inputBuilder-assembled
  `userMessage` straight through to the request body's
  `input[].role: "user"` content.
- **WP-D.3 — `inputBuilder.ts` section renderers (pure functions).**
  - `renderPreviousTurnBlock(state, characterId, prev) → string` —
    composes the `## previous turn` block: `You: ...` outcome line
    (reuses phase-3's `buildLastTurnLine` logic), `Scratchpad: ...`
    (the scratchpad-before line), `<killer> killed <victim> with
    <weapon>` lines (one per kill from `buildKillFeedLines`, WP-A.4).
    Returns the empty string on turn 1 (no prior turn).
  - `renderCurrentGameStateBlock(state, observer, aliveCount) →
    string` — composes the `# Current Game State` block: `Turn N,
    M/8 players alive` (from `state.world.turn` + `aliveCount`),
    `You: ...` (reuses phase-3 `buildYouLine`), `Visible:` followed
    by the Visible-object body.
  - `renderVisibleObject(visibleEntries, format) → string` — the
    format switch. `format ∈ {"json", "yaml", "keyed-inline"}`.
    WP-D ships all three implementations (so WP-E can probe); the
    default `VISIBLE_FORMAT` constant defaults to `"json"` as the
    starting point.
- **WP-D.4 — `inputBuilder.ts` Scratchpad relabel.** Phase-3 routed
  the scratchpad through the `azure.ts` wrapper's `## Scratchpad`
  section label. WP-D moves it inline as `Scratchpad: <text>` under
  `## previous turn`. The agent's tool-field `scratchpad_update`
  remains unchanged — that field is the write for next turn; the
  user-message Scratchpad: line is the read of the prior turn's
  write.
- **WP-D.5 — `convex/runMatch.ts` plumbing + composedUserMessage
  populate.** Pass `aliveCount` (computed from `characters.filter(c
  => c.alive).length`) through to `buildAgentInput`. Pass the prior-
  turn `actions[].weapon` data through `PrevTurnRow` (already on the
  row post-WP-A). **Additionally, write the assembled user message
  onto `agentRecord.input.composedUserMessage` at persist time** per
  ADR §1b — the inputBuilder already produces this string (it is the
  string sent to Azure as the user role's content), so persisting it
  is a one-line addition to the agent-record write. This is the
  primary read path for WP-B's raw-pane on phase-4 traces. The
  `visibleStateDigest` field continues to be written with the Visible-
  object body only.
- **WP-D.6 — `tests/llm/inputBuilder.test.ts` rewrite.** Lock the
  new ordering:
  - User message structure: persona body → `## previous turn` →
    `# Current Game State`.
  - Kill-feed lines appear in `## previous turn` when prior turn
    had deaths; absent on turn 1; absent when no deaths.
  - `Turn N, M/8 players alive` line is correct for representative
    cases (turn 1 + 8 alive; turn 30 + 3 alive; turn 50 + 1 alive).
  - No `## Scratchpad` top-level section anywhere.
  - Visible-object format renders correctly in all three modes
    (`json` / `yaml` / `keyed-inline`) on the same fixture.
  - Smoke: chars/4 budget for the full composed input (system +
    user) remains under ~1 200 tokens on a representative turn.
  - **Phase-4 end-to-end budget test** (extends the phase-3
    `tests/llm/inputBuilder.test.ts:1238-1324` budget block): assert
    that on a max-density representative fixture (slim system prompt
    + assembled user message with 500-char scratchpad + 7-line
    kill-feed at turn 50 + Visible-keyed-object) the composed user
    message stays ≤ 1 200 tokens (chars/4). Separately, assert that
    the enriched `decisionTool` schema descriptions add ≤ 350 tokens
    of request-body tax. Together they envelope the phase-4 request
    shape end-to-end per README §7.

**Acceptance.**

- [ ] **PROBE-GATED: WP-D commit requires green D1 sign-off** (slim-
  prompt regression probe, de-risking.md §D1, fellback ≤ 11.3% i.e.
  within 3 pp of phase-3 baseline) **AND green D3 sign-off** (kill-
  feed moderation pre-flight, de-risking.md §D3, zero
  `content_filter_blocked` failures on the 50-request probe). The
  de-risking probes block WP-D from landing per the
  de-risking.md "Probe execution order" diagram; the gates are
  recorded as a single line in the WP-D PR description with a link
  to the probe artifacts.
- [ ] `convex/llm/inputBuilder.ts` `buildAgentInput` returns the slim
  shape that owns the user message assembly.
- [ ] `convex/llm/azure.ts` `buildUserMessage` is deleted or simplified
  to a pass-through.
- [ ] The user-message ordering exactly matches intent §2 (persona
  body → `## previous turn` → `# Current Game State`).
- [ ] **`agentRecord.input.composedUserMessage` is populated on every
  phase-4 trace row** (the assembled user-message string sent to
  Azure). Phase-3 trace rows retain the field as absent — the schema
  additive is `v.optional`.
- [ ] Kill-feed lines render correctly from WP-A's persisted
  `actions[].weapon` field.
- [ ] Alive-count line is correct across representative turn snapshots.
- [ ] The Visible-object renderer ships all three formats with the
  default pinned to `"json"`.
- [ ] `npm run lint && npm run typecheck && npm run build && npm test`
  green at root.
- [ ] One smoke run end-to-end completes; the replay UI raw-pane reads
  `agentRecord.input.composedUserMessage` and renders it verbatim
  (the read path WP-B uses for phase-4 traces). The pane should match
  bytes-for-bytes what Azure received as the user role's content.

**Test strategy.**

- Tests-first per AOP. The user-message ordering is the load-bearing
  contract; the `tests/llm/inputBuilder.test.ts` rewrite is the
  first edit in WP-D.
- The three Visible-format renderers are pure functions on a fixture
  `VisibleEntry[]`; each gets its own test fixture asserting the
  expected output bytes-for-bytes.
- Integration test (`tests/llm/integration.test.ts`) refresh: extend
  the existing phase-3 fixture to cover the new ordering. The
  integration test ALSO becomes the regression guard for "the
  composed input fits the chars/4 budget".

**Risks.**

- *Persisted `visibleStateDigest` field semantics shift*: phase-3's
  field held the full digest body (You: + Last-turn-you: + Visible
  bullets). Phase-4 narrows it to just the Visible-object body. **The
  risk is retired by ADR §1b**: WP-A.1 adds an additive
  `agentRecord.input.composedUserMessage?: string` field, and
  WP-D.5 populates it with the assembled user-message string at
  persist time. The replay UI's raw-pane reads
  `composedUserMessage` verbatim on phase-4 traces and falls back to
  the legacy compose path on phase-3 traces — single presence-check,
  no dual-shape branch. The `visibleStateDigest` field's narrowed
  scope is fine because it is no longer the raw-pane's reconstruction
  source on phase-4 traces.
- *Visible-format choice locked too early*: WP-D defaults to JSON-style
  as the starting point; WP-E may pin a different winner. The format
  parameterisation in `renderVisibleObject` makes the swap cheap (one
  constant edit). No persisted-shape change required.
- *Token-budget over-shoot*: the slim system prompt (WP-C) buys ~300
  tokens of headroom. Phase-3 token-budget tests at chars/4 ≤ 1 200
  tokens remain in force. WP-D.6's chars/4 smoke catches over-shoot
  before WP-E's bench runs.

**Dependencies.** WP-A (kill-feed records + `weapon` field threaded
through `PrevTurnRow`); WP-C (slim system prompt so we don't double-
teach grammar). Cannot land before both.

---

## WP-E — Visible-object format bench

**Scope.**

- **WP-E.1 — Probe harness.** A scripted variant of `harness/run.ts`
  (or a new `harness/probe-visible-format.ts`) that runs N short
  matches (suggested: 5 matches × 8 personas × 50 turns = 2 000
  per-turn calls per format) holding seed + persona assignment FIXED
  across the three Visible-format settings. The format axis is the
  only variable.
- **WP-E.2 — Measurements.** Three primary metrics per format:
  - **Token cost**: mean chars/4 proxy of the rendered Visible-object
    body across all turns.
  - **Tool-call pass rate (CANONICAL, intent §4): `rawArguments ==
    decision`** — JSON-parse both sides, key-canonicalise (sort keys
    + drop whitespace), and assert semantic equality. The same
    canonicalisation `composeRawArgumentsVsDecision` uses in WP-B.1
    (intent §4: "Tool-call pass rate = rawArguments == decision").
    Computed per agent record; aggregated as the fraction of records
    where the equality holds.
  - **No-op rate**: percentage of turns where `primary ===
    "stationary_action"` AND `move.kind === "none"` AND `action.kind
    === "none"`.

  **Supporting telemetry** (reported alongside; NOT the headline):
  - `fellBackToSafeDefault` rate: reads
    `agentRecord.llm.fellBackToSafeDefault` directly. This is a
    wrapper-side signal (the wrapper fell back to the safe default
    after a parse/schema failure); it overlaps with the canonical
    pass-rate metric but diverges in edge cases (e.g. semantically-
    valid tool call that the engine validator zeroed:
    `rawArguments == decision` but `fellBackToSafeDefault === false`
    — the engine zeroing is captured by `validatorReason`, not by
    fellback).
  - `validatorReason != null` rate: engine-zeroed-but-syntactically-
    valid rate. Distinct from fellback. Useful for diagnosing
    "format looks good to the LLM but the engine rejected the
    target".
- **WP-E.3 — Decision rule.** Pick the format that maximises the
  **canonical tool-call pass rate (`rawArguments == decision`)**
  first, then minimises no-op rate, then minimises token cost. (Pass
  rate dominates because it's the load-bearing schema-honesty signal
  per intent §4; no-op rate is the headline acceptance F threshold;
  token cost is the tie-breaker.) If JSON and YAML tie on pass rate
  + no-op rate, keep JSON (the LLM is most-trained on JSON). Document
  the decision.
- **WP-E.4 — `visible-format-bench.md`.** New file in the phase folder
  recording the cohort design, per-format measurements, the chosen
  winner, and the data that justifies the choice.
- **WP-E.5 — Pin the winner.** Update the `VISIBLE_FORMAT` constant in
  `convex/llm/inputBuilder.ts` to the chosen value.

**Acceptance.**

- [ ] **PROBE-GATED: WP-E commit requires green D2 sign-off** (cohort-
  sizing pilot per de-risking.md §D2). The pilot data + projected 95%
  CI width are recorded in `visible-format-bench.md` BEFORE the
  full bench runs; if the projected CI width is > 5 pp, the bench
  records "inconclusive" rather than forcing a ranking.
- [ ] Probe runs complete for at least the JSON-style and YAML-style
  formats; keyed-inline is a stretch goal.
- [ ] The **canonical** pass-rate metric (`rawArguments == decision`,
  intent §4) is the headline reported number for each format;
  `fellBackToSafeDefault` and `validatorReason != null` are reported
  alongside as supporting telemetry.
- [ ] The bench data are persisted (Convex reports row tagged
  `reportType: "phase-4-visible-format-bench"` or a sibling type;
  the existing report-row pattern is reusable).
- [ ] `visible-format-bench.md` records the cohort, the metrics, and
  the winner.
- [ ] `convex/llm/inputBuilder.ts` `VISIBLE_FORMAT` constant is pinned
  to the chosen value.

**Test strategy.**

- The probe IS the test. WP-D's renderer tests cover the rendering
  fidelity; WP-E measures behavioural impact.
- Sanity: the probe harness MUST hold the seed + persona assignment
  fixed across the three formats. If those vary, the data is
  uninterpretable.

**Risks.**

- *Bench cohort too small*: 2 000 calls per format may be too noisy
  to distinguish pass-rate deltas < 3 pp. Mitigation: WP-E.3's tie-
  breaker rule gives a deterministic decision; if the data are
  inconclusive, fall back to JSON (the priors favourite). Document
  the inconclusive read in `visible-format-bench.md`.
- *Confounding with WP-F lever probe*: keep WP-E and WP-F orthogonal.
  WP-E holds `max_output_tokens` at 1 200 and `reasoning.effort` at
  "low". WP-F probes those levers separately on the winning Visible
  format.

**Dependencies.** WP-D (the format switch lives in inputBuilder).

---

## WP-F — Lever probe (max_output_tokens, reasoning.effort)

**Scope.**

- **WP-F.1 — Parameterise `max_output_tokens`.** Add an optional
  `maxOutputTokens` field to the `matches` row validator (mirror the
  existing `reasoningEffort` pattern). `convex/runMatch.ts` reads
  the field, defaulting to 1 200 when absent. The harness CLI
  (`harness/run.ts`) accepts a `--max-output-tokens` flag that
  plumbs through `matches.start`.
- **WP-F.2 — Probe `max_output_tokens`.** Fixed-seed cohort of 5
  matches × 8 personas at `max_output_tokens ∈ {1200, 1500, 2000}`.
  Measure: tool-call pass rate, no-op rate, truncation rate
  (`output_tokens ≥ 0.95 × max`). The hypothesis: truncation at
  1 200 contributes to no-op turns; lifting the cap reduces both.
- **WP-F.3 — Probe `reasoning.effort`.** Fixed-seed cohort at
  `reasoning.effort ∈ {"low", "medium"}` on the winning
  `max_output_tokens` value. Measure: pass rate, no-op rate,
  reasoning capture rate (`reasoning !== null`), per-call latency.
  The hypothesis: medium effort lifts capture rate above the
  phase-3 ~68.8% Azure-side floor (per PHASE-3-CLOSURE.md §3.3).
- **WP-F.4 — Decide and document.** Pin the chosen values. Record
  the data in `lever-probe.md` (or extend `visible-format-bench.md`
  with a §2 for lever data).
- **WP-F.5 — Pin the chosen values.** Update the constants in
  `convex/runMatch.ts` (or the harness default flags) to the chosen
  values.

**Acceptance.**

- [ ] `matches.maxOutputTokens?` field added to the schema; harness
  CLI flag wired through.
- [ ] Probe data persisted for both axes.
- [ ] Chosen values documented with the justifying data.
- [ ] Phase-4 default `max_output_tokens` and `reasoning.effort` are
  set to the chosen values.

**Test strategy.**

- The probe IS the test. Unit tests cover the schema additive +
  harness CLI plumbing; the data quality is reviewed by the user
  before WP-G's closing pass.

**Risks.**

- *Lever probe data is confounded by Visible-format choice*: WP-F
  runs on the WP-E winner. If WP-E is inconclusive, WP-F runs on
  JSON-style by default and the result is "given the JSON-style
  format, these are the chosen levers". Acceptable scope.
- *Lifting `max_output_tokens` to 2 000 inflates Azure cost ~1.7×*:
  budget-tracker concern. The phase-3 closing-10 cost ~ $0.50; a
  closing-10 at 2 000 tokens is ~ $0.85. Negligible for POC. WP-F
  doesn't gate on cost.

**Dependencies.** WP-D (so the lever probe measures the redesigned
context, not the phase-3 one). WP-F's **implementation** (schema
additive for `matches.maxOutputTokens?`, harness CLI flag plumbing)
can overlap WP-E in time. WP-F's **probe-cohort runs**, however,
must come AFTER WP-E pins the Visible-format winner — otherwise the
lever data is confounded by a moving Visible-shape target.

---

## WP-G — Closing-10 pass + closure record

**Scope.**

- **WP-G.1 — Phase-4 report aggregator.** Extend or sibling-fork
  `convex/reports/phase3.ts` into `convex/reports/phase4.ts`. The
  new aggregator carries the phase-3 substrate-refinement metrics
  (extraction rate, kill rate, equip rate, speech rate, persona
  spread, no-crash, fellback-to-safe-default, wall-blocked move rate,
  drained-corpse repeat, corpse-loot success, overwatch
  differentiation, outcome attribution, reasoning capture) AND the
  new **no-op rate** metric per phase-4 acceptance F.
- **WP-G.2 — Schema sibling field.** Add `phase4Payload` to the
  `reports` table validator (sibling to `phase3Payload`, same shape
  pattern). Optional field; no migration.
- **WP-G.3 — 10-run harness pass.** Fire 10 Convex-persisted runs
  against the dev deployment on the pinned redesigned substrate
  (WP-E winner + WP-F chosen levers). Persist a phase-4 report row
  with `reportType: "phase-4-closing-10"`.
- **WP-G.4 — Validate the gates.**
  - No-op rate < 5% — HEADLINE.
  - All phase-3 thresholds met on the same 10-run cohort (i.e.
    none regressed).
  - 0 crashes.
- **WP-G.5 — `PHASE-4-CLOSURE.md`.** Single-file handoff record.
  Mirrors `PHASE-3-CLOSURE.md` structure: §1 what we set out to
  build, §2 done-bar verdict (threshold table with verdict per
  metric), §3 documented-why-not for any miss, §4 substrate proof
  points, §5 architecture artefacts inventory (phase-4 deltas), §6
  out-of-scope reaffirmed for phase 5+, §7 open follow-ups, §8
  cross-references.
- **WP-G.6 — `mental-model.md` §13 status flip.** Update the §13
  paragraph from "dispatched 2026-05-11" to "closed YYYY-MM-DD" with
  the persisted reportId.
- **WP-G.7 — Concept-spec §7 edit.** Update the visible-state digest
  example in `concept-spec.md` §7 to the WP-E winner format. One-line
  diff.

**Acceptance.**

- [ ] 10 Convex-persisted matches reach `status: "completed"`.
- [ ] Phase-4 report row persists with the new metrics including
  no-op rate.
- [ ] No-op rate < 5% on the 10-run cohort.
- [ ] Phase-3 thresholds carry over without regression.
- [ ] `PHASE-4-CLOSURE.md` is written, including the persisted
  reportId, the WP-E + WP-F decisions, and a one-paragraph "what the
  user saw stepping through it" debrief.
- [ ] `mental-model.md` §13 status flipped.
- [ ] Concept-spec §7 updated to the WP-E winner format.

**Test strategy.**

- The closing pass IS the integration test. Pre-flight: a 1-run smoke
  on the pinned substrate verifies the pipeline.
- The user steps through at least three of the 10 runs in the replay
  UI before signing off the closure record.

**Risks.**

- *No-op rate regresses to ≥ 5%*: the headline metric. If WP-G's
  closing-10 misses the threshold, the no-op cluster's `rawArguments`
  + `validatorReason` + `usage` signals (visible via WP-B) tell us
  why. Mitigation paths: (a) push `max_output_tokens` higher; (b)
  iterate on the system prompt's stakes framing; (c) iterate on the
  tool-schema descriptions. Each is a one-line edit; a follow-up
  10-run is cheap.
- *Phase-3 threshold regression*: the redesign is meant to be neutral-
  or-better on the substrate. If any phase-3 metric regresses on the
  closing-10, the cause is in scope for phase-4 (it's still phase-4
  substrate). The closure doc records the regression honestly per
  phase-3 §3.3 precedent.
- *10-run cohort too noisy to confirm < 5% no-op rate*: a 50-run
  follow-up is the documented fallback per phase-4 acceptance F.
  Phase-3 closed on 10 runs (and would have been more confident on
  50); phase-4 uses the same default with the 50-run escape hatch.

**Dependencies.** All of WP-A through WP-F. WP-G IS the closing gate.

---

## Cross-references

- `README.md` — phase overview, dep map, recommended sequence.
- `architecture-decisions.md` — ADRs §1–§5.
- `de-risking.md` — D1 / D2 / D3 (slim-prompt regression, format bench
  cohort sizing, kill-feed moderation).
- `docs/project/spec/per-turn-context-intent.md` — canonical intent
  anchor. The WP scopes elaborate; the intent prescribes.
- `docs/project/phases/03-substrate-refinement/PHASE-3-CLOSURE.md` —
  the threshold list phase-4 must not regress.
