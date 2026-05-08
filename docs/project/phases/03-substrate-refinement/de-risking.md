# Phase 03 — De-risking

> Load-bearing unknowns and the spikes/probes that retire them. Each item
> tracks: the question, the spike, the success criterion, and the branch
> decisions downstream of the spike's outcome.
>
> Two of the three items are gated by an empirical probe (Azure response
> shape; defensive counter-fire stability under multi-attacker contention).
> The third is a measurement-only item — outcome-attribution heuristic
> calibration runs as part of WP-E and informs reporting, not
> implementation.

---

## D-P3-1 — Reasoning text on Azure Responses API output[]

**Question.** Does the project's Azure deployment expose reasoning text
in `response.output[]` items when `reasoning.effort: "low"` is set, or
only the token count in `usage.output_tokens_details.reasoning_tokens`?

**Why it matters.** The North Star calls for "reasoning text persisted
on ≥ 80% of completed (non-fallback) per-turn calls". The replay UI's
raw-pane has reasoning as one of three sections. If Azure doesn't expose
reasoning text, the entire branch from WP-A.1 onward changes.

**Background research (Perplexity, 2026-05-08).** Azure docs and
community posts strongly suggest reasoning text is hidden by default on
Azure Responses API deployments — only `reasoning_tokens` counts are
returned, with no reasoning items in `output[]`. OpenAI-direct API
returns reasoning summaries (`{type: "reasoning", summary: [{type:
"summary_text", text: "..."}]}`); Azure does not appear to mirror this
on the standard deployment. The status of `reasoning.summary` request
parameters on Azure is unclear.

**Spike (WP-A.1).** A small one-call test:

1. Compose a per-turn-shape request (system + user + tool + tool_choice
   "required") against the project's dev Azure deployment.
2. Set `reasoning.effort: "low"` (the project's default).
3. Optionally try `reasoning.summary: "auto"` as a request parameter to
   see if Azure honours it (recent OpenAI docs feature this; Azure may
   or may not).
4. Dump `response.output[]` and `response.usage` to a file.
5. Inspect: are there any `output[].type === "reasoning"` items? Do
   they contain `text` or `summary`?

**Success criterion.** The spike produces a definitive answer:
**Branch A** (reasoning text exposed) or **Branch B** (only token
counts). No ambiguous middle ground — the response shape is empirical.

**Branch A (reasoning text exposed).**

- WP-A.2 schema additions: `agentRecord.llm.reasoning: v.union(
  v.string(), v.null())` per ADR §2 / PM lock D13 (required nullable,
  *not* `v.optional(v.string())` — avoids the `undefined !== null`
  counting bug).
- WP-A.2 azure.ts: extract reasoning text from `output[]` reasoning
  items, sanitise via the existing `sanitiseHttpBody` helper (or a
  reasoning-specific sanitiser), truncate to ≤ 4 KB. Persist `null`
  on every non-captured path (Branch A failure responses, Branch A
  responses without reasoning items).
- `decision.rationale` field is NOT added.
- ADR §7 system-prompt Section 5b is **omitted** on Branch A (saves
  tokens; no rationale ask in the rendered prompt).
- Replay UI's raw-pane reads `agentRecord.llm.reasoning ?? "(no
  reasoning captured)"`.

**Branch B (only token counts).**

- WP-A.2 schema additions: `agentRecord.llm.reasoning: v.union(
  v.string(), v.null())` (same shape as Branch A; always `null` on
  Branch B). Plus `decision.rationale: string | null` is added to the
  tool schema (max 280 chars).
- WP-A.2 azure.ts: the wrapper does not attempt extraction; sets
  `reasoning: null` on every result (not `undefined`).
- **WP-C.2 system-prompt rewrite includes ADR §7 Section 5b** — the
  conditional rationale ask: "Optionally include a one-sentence
  rationale in `rationale` to explain your choice (≤ 280 chars). The
  replay UI shows it in the diagnostic pane." This is the load-bearing
  Branch B wiring — without it, the ≥ 80% reasoning-capture metric
  fails silently because the model is never asked. Cross-references:
  ADR §7 (Section 5b conditional), WP-C.2 (scope explicitly Branch-B
  conditional), `tests/llm/systemPrompt.test.ts` (Branch B render
  asserts the rationale ask is present; Branch A asserts it's
  absent).
- Replay UI's raw-pane reads `agentRecord.llm.reasoning ??
  agentRecord.decision.rationale ?? "(no reasoning captured)"`.

**Status.** RESOLVED 2026-05-08 — **Branch A** (reasoning text exposed).

**Probe result.** `harness/probe-reasoning.ts` ran one tool-use call
against the project's dev Azure deployment (`AZURE_MODEL=gpt-5.4-mini`,
endpoint `webfoundtrack.cognitiveservices.azure.com`, api-version
`2025-04-01-preview`) with `reasoning.effort: "low"` AND
`reasoning.summary: "auto"`. Both parameters were honoured. HTTP 200.

`response.output[]` contained 2 items in order:
  1. `{ type: "reasoning", id: "rs_…", summary: [{ type:
     "summary_text", text: "**Deciding movement strategy**\\n\\n..." }] }`
  2. `{ type: "function_call", arguments: "...", call_id: "…", name:
     "decide_turn" }`

`response.usage.output_tokens_details.reasoning_tokens = 197`.
The deployment echoed `reasoning.summary: "detailed"` back on the
response, indicating Azure normalised `auto` to `detailed`.

Full dump preserved at `harness/probe-reasoning-output.json`.

**Branch A wiring (now binding for WP-A.2 onward).**

- WP-A.2 schema: `agentRecord.llm.reasoning: v.union(v.string(),
  v.null())` per ADR §2 / PM lock D13. Required-nullable; persisted as
  `null` on every non-captured path (failure rows, responses without
  reasoning items).
- WP-A.2 `azure.ts`: extract reasoning text by walking `output[]` for
  items with `type === "reasoning"`. For each, prefer the joined
  `summary[].text` strings (`summary` is the canonical Azure shape
  per the probe); fall back to `item.text` if a future deployment
  exposes that. Multiple reasoning items concatenate with double
  newline. Sanitise via `sanitiseHttpBody` (already tested to leave
  legitimate prose intact); truncate to ≤ 4 KB.
- `decision.rationale` is **NOT** added to the tool schema (Branch A
  saves the tokens).
- ADR §7 Section 5b conditional rationale ask is **omitted** from the
  WP-C system-prompt rewrite (Branch A path; saves tokens).
- Replay UI raw-pane reads `agentRecord.llm.reasoning ?? "(no reasoning
  captured)"` (no rationale fallback layer needed on Branch A).
- `tests/llm/systemPrompt.test.ts` (WP-C) asserts the rationale ask is
  ABSENT in the rendered prompt.

---

## D-P3-2 — Defensive overwatch counter-fire under multi-attacker
contention

**Question.** When a defensive overwatcher is hit by N simultaneous
attackers, does the engine's existing simultaneous-resolution model
support a counter-fire pass without reordering or double-counting
damage?

**Why it matters.** The North Star locks the rule: "defensive
overwatcher counter-fires once per attacker, bounded by weapon range,
batched into the same simultaneous-attacks pass". This is a structural
extension to phase 1's combat resolution. If the existing
`applyDamage` batch can't accommodate counter-fires correctly,
the engine fix becomes more invasive than WP-B currently scopes.

**Background.** Phase 1's `resolution.ts` collects all attacks into an
`attacks: AttackEvent[]` array, then applies them in a batch via
`applyDamage`. Counter-fires need to be additional `AttackEvent`s
generated *within* the same phase, with `fromOverwatch: true` and the
counter-fire-specific reveal contract.

**Spike (within WP-B).** Implement the counter-fire pass against the
existing batch-collect-then-apply structure. Test cases:

1. Single attacker hits defensive overwatcher → 1 counter-fire entry.
2. Three attackers hit defensive overwatcher simultaneously → 3
   counter-fire entries (one per attacker).
3. Three attackers, two within range, one out-of-range → 2
   counter-fires + 1 `result: "out_of_range"` entry.
4. Defensive overwatcher and one of its attackers kill each other in
   the same pass → both die in `phase 6 deaths`; both have
   `fromOverwatch` traces.
5. Two defensive overwatchers attacking each other → both counter-fire,
   both reveal. Trace contains 4 attack entries (2 originating, 2
   counter-fire).

**Success criterion.** All 5 test cases pass with deterministic
ordering (sort by attacker→defender stable order). The
`resolution.actions[]` array contains the expected entries; no
double-application of damage; reveal-on-fire fires on every
overwatcher who counter-fires.

**Branch.** None. Either the spike works or WP-B's effort estimate
(1.5–2.0 days) extends to ~3 days for a refactor.

**Status.** OPEN — to be exercised by WP-B test cases. Pre-spike
expectation: works cleanly because the batch-collect-then-apply
structure was designed for exactly this kind of extension.

---

## D-P3-3 — Token-budget overshoot risk

**Question.** Does the rebuilt digest + new system prompt fit within
the 1 200-token budget?

**Why it matters.** The new system prompt is targeted at ≤ 500 tokens
(up from ≤ 400) to absorb the schema-teaching content. The digest
adds a `Last turn (you):` line and per-Visible observation brackets
while removing `Affordances:`, `Heard:`, `Last-known:`, `Evac:`
sections. Net is approximately neutral or slightly positive (see
README §8 cross-check). But empirical measurement under realistic
last-turn outcomes (e.g. 4 simultaneous attackers, 8 visible characters
all with full observation brackets) is the real test.

**Background.** Phase 1's `chars / 4` proxy is the deterministic
budget assert. Composed input includes:

- system prompt (~ 500 tokens target)
- persona (~ 80 tokens, locked)
- scratchpad (≤ 125 tokens, schema-bounded at 500 chars)
- visible-state digest (~ 250–450 tokens target)

Total target: ~ 1 005 tokens (avg) to ~ 1 155 tokens (p95). Headroom:
~ 50–150 tokens.

**Spike (within WP-C).** The rewritten `inputBuilder.test.ts` includes
a token-budget assert against:

1. A "minimal" fixture: no last turn, 2 visible characters, no
   observations.
2. A "rich" fixture: full last turn with 4 attackers, 8 visible
   characters all with brackets, every persona body.
3. The smoke run from WP-C's acceptance generates real prod data;
   chars/4 is asserted on every agentRecord on every turn from every
   persona.

**Success criterion.** Every measured composed input is ≤ 1 200 tokens.
P95 ≤ 1 100 tokens (≥ 100 tokens of headroom).

**Branch.**

- **A (within budget).** No action. WP-C ships as planned.
- **B (over budget).** Trim path (cheap → expensive):
  1. Lower `VISIBLE_ENTITY_CAP` from 8 to 6. Saves ~ 30 tokens worst
     case.
  2. Trim the system prompt by reducing terminology repetition
     (e.g. drop the schema-literals reminder section). Saves
     ~ 50–100 tokens.
  3. Drop one of the per-Visible bracket components (e.g. drop
     `holding <weapon>`). Saves ~ 10–20 tokens per visible char.
  4. Reduce the `Last turn (you):` line from 4 fragments to 3
     (drop `said "..."` — least important; `attacked Player_X`
     is the load-bearing fragment). Saves ~ 20 tokens.

**Status.** OPEN — to be measured by WP-C tests. Pre-spike
expectation: A (within budget), based on the README §8 cross-check.

---

## D-P3-4 — Outcome-attribution heuristic calibration

**Question.** What's the reasonable measurement-only threshold for
"turn N+1 references damage taken in turn N"? The North Star sets it
at ≥ 50% as a best-effort heuristic. Is 50% achievable, too easy, too
strict?

**Why it matters.** This is the closing-10 metric that most directly
tests pillar 4 (scratchpad as explainability). If agents *can* reason
about damage they took, their next-turn decisions should reference the
attacker (counter-attack, flee, heal, scratchpad note). The metric is
the user's diagnostic for "did the substrate refinement actually
work?".

**Background.** The metric is computable from existing trace fields
post-phase-3:

- For each (turn N, agent A) where A took damage in turn N (per
  `resolution.actions[]` of `kind: "attack"` or `"overwatch"` against
  A) — collect the attacker id(s).
- In turn N+1, A's `agentRecord.decision` and `scratchpadAfter` are
  searched for the attacker id (e.g. "Player_3") OR an
  `attack`/`away_from_entity`/`toward_entity` action targeting the
  attacker OR a `consume: "heal"`.
- Success = any of these markers present.
- Numerator: count of (N, A) pairs where success holds.
- Denominator: count of (N, A) pairs where A took damage in turn N
  AND survives to turn N+1.

**Spike.** Run a 1-match smoke during WP-C and compute the rate
informally. If the rate is above 80% with the basic heuristic, tighten
(require the attacker id explicitly in scratchpad, not just an
attack/heal). If below 30%, loosen (also count "any change to
scratchpad after damage" as success).

**Success criterion.** WP-E's closing-10 report carries the rate
honestly, with the heuristic definition stated, and the user can read
the rate in context.

**Branch.** None — measurement-only. The metric reports whatever the
substrate produces. The user's vibe-judgement on whether the rate is
"good enough" closes the phase.

**Status.** OPEN — measured at WP-E. The heuristic definition is
finalised in WP-E.3 (the aggregator extension) based on what the
WP-C smoke run shows.

---

## Status summary

| Item | Status | Owner | Resolves at |
|---|---|---|---|
| D-P3-1 reasoning text on Azure | RESOLVED — Branch A | WP-A.1 spike | resolved 2026-05-08 |
| D-P3-2 counter-fire under multi-attacker | OPEN | WP-B test cases | WP-B gate |
| D-P3-3 token-budget overshoot | OPEN | WP-C tests + smoke | WP-C gate |
| D-P3-4 outcome-attribution calibration | OPEN | WP-E aggregator | WP-E.4 deliverable |

All four risks are tractable with no architectural unknowns. The
phase-3 plan is buildable end-to-end on the current substrate; the
de-risking items are calibration, not redirection.
