# Phase 04 — De-risking

> Three load-bearing risks for the phase-4 redesign. Each entry: what we
> don't yet know, why it matters, the probe / mitigation that retires it,
> the trip-wire that escalates. Probes run **before** the dependent WP
> commits, not after — the phase-3 pattern (D-P3-1 reasoning-capture
> probe ran first, branch-decided WP-A) carries forward.

The phase-3 risks (D-P3-1 reasoning capture / D-P3-4 outcome attribution
heuristic) are closed in `PHASE-3-CLOSURE.md`. Phase-4's risks are
distinct: they sit on the prompt-and-context surface, not on the trace
substrate.

---

## D1 — Slim system prompt regresses tool-call pass rate

**The risk.** Phase-3 ADR §7 framed the system prompt as a "schema
teacher" — it duplicated the tool-schema grammar in English because
phase-1 closed at 84.5% safe-default rate and the diagnosis was that
the model wasn't reading the JSON Schema's own contract. Phase-3 closed
that gap (down to 8.256% fellback-to-safe-default at the WP-G post-fix
state).

Phase-4 deletes the English mirror and relies on the tool-schema
`description` fields (ADR §3) plus the system prompt's slim
stakes+rules shape (ADR §2). The plausible failure mode: **the model
parses the description fields less reliably than the system-prompt
text it was reading in phase 3**, and the fellback-to-safe-default
rate regresses toward the phase-1 floor.

The phase-3 evidence for whether the model reads `description` fields
is indirect — the schema descriptions WERE shipped in phase-3, but the
load-bearing teaching was in the system prompt. Removing the
duplication is the experiment. We don't have a phase-3 trace where the
description-only path was exercised in isolation.

**Why it matters.** Phase-3 closed at 8.256% fellback. A regression
of ~5 pp (fellback > 13%) would push past the phase-3 ≤ 10%
threshold, which phase-4 acceptance §5 prescribes as "no regression"
hard-gate territory. The D1 trip-wire is set TIGHTER than the
hard-gate threshold — **3 pp regression** (fellback > 11.3%) — so
the decision is made before the hard gate is busted. A regression
bigger than 3 pp triggers iterate/escalate per the decision rule
below. The 3 pp number is the canonical trip-wire; the 5 pp number
in this paragraph is only the threshold-bust inflection point and is
NOT a competing decision rule.

**Probe (D1.1).** Pre-flight before WP-D commits the user-message
rebuild:

1. Branch from current main with WP-C (slim system prompt + enriched
   descriptions) landed but **without** WP-D (user-message rebuild) or
   WP-E (Visible format bench). The Visible digest remains phase-3
   shape; the persona prompt and scratchpad wrapping remain phase-3.
   Only the system prompt and tool-schema descriptions are different.
2. Run a fixed-seed 10-match cohort (suggested seed pattern: phase-3
   closing-10 seeds reused) on this branch.
3. Measure fellback-to-safe-default rate (single-source metric on
   `agentRecord.llm.fellBackToSafeDefault`).
4. Compare against the phase-3 closing-10 baseline (8.256%).

**Decision rule (CANONICAL THRESHOLDS — supersedes any earlier
phase-4 doc that quotes a different number).**

- Pass rate within **3 pp** of phase-3 baseline (fellback ≤ 11.3%) →
  WP-D commits. WP-G's closing pass is the final verdict.
- Pass rate regresses 3–10 pp (fellback 11.3–18.3%) → ITERATE. Add
  per-arm `description` fields to the move/action unions (a layer
  finer than WP-C's parent-property descriptions), re-run the
  probe. The phase-3 schema-validity-failure clusters (missing
  `say`, `Corpse_Player_N` rejection) suggest the model parses
  schema descriptions when they're at the right granularity.
- Pass rate regresses > 10 pp → ESCALATE. Either restore a short
  "Action grammar:" block in the system prompt (the smallest English
  mirror that gets pass rate back), OR document the regression and
  accept the trade in `PHASE-4-CLOSURE.md`.

This 3 pp number is the single source of truth for the D1 trip-wire.
work-packages.md WP-C risk text is aligned to it.

**Trip-wire.** WP-D acceptance (`work-packages.md` §WP-D) is
**explicitly probe-gated** on D1: WP-D must NOT commit without the
D1 probe data in `lever-probe.md` (or sibling) AND a green decision
from the user. The user is the final arbiter on "accept the regression
or restore some teaching".

**Why this matters more than it looks.** The phase-3 W-G.2 fix (JSON
Schema `required[]` field-list aligned to all 7) was load-bearing
evidence that the model DOES read schema-shape contracts. But
`required[]` is a structural constraint; `description` is freeform
prose. The reading-pathways may be different. D1 is the only probe
that can answer this directly.

---

## D2 — Visible-object format bench cohort is too noisy

**The risk.** WP-E's bench probes three Visible-object serialisations
(JSON-style, YAML-style, keyed-inline) and picks the winner on pass
rate, no-op rate, and token cost. Cohort design: 5 matches × 8 personas
× 50 turns = 2 000 per-turn calls per format. Three formats × 2 000
calls = 6 000 calls total.

The risk is that pass-rate and no-op-rate differences across formats
may be < 3 pp — within noise on a 2 000-call cohort. The phase-3
closing-10 fellback rate variance across runs was non-trivial (some
runs ~5%, some ~12%); 5 runs × 8 personas is a small denominator for
detecting < 3 pp deltas.

**Why it matters.** WP-E's whole reason for being is to pick the
Visible format empirically. If the data are inconclusive, the
decision degrades to "pick JSON by prior" — which is defensible but
defeats the bench's purpose.

The WP-G closing pass needs the WP-E winner pinned to run on a stable
substrate. An inconclusive WP-E doesn't block WP-G (JSON-by-prior is
the fallback), but the user steps through phase-4 closing-10 not
knowing whether YAML or keyed-inline would have done better.

**Probe (D2.1).** Bench cohort sizing pre-flight before WP-E commits:

1. Run a 1-match-per-format pilot on the WP-D-redesigned substrate
   (D1 probe complete, slim system prompt + redesigned user message,
   max_output_tokens 1 200, reasoning.effort "low").
2. Compute the per-format pass rate, no-op rate, and chars/4 token
   cost variance ACROSS the 50 turns × 8 personas = 400 calls in
   each match.
3. Estimate the per-call variance σ; project the 95% CI width on a
   2 000-call cohort.

**Decision rule.**

- 95% CI width < 2 pp → 2 000 calls per format is sufficient. WP-E
  runs as scoped.
- 95% CI width 2–5 pp → SCALE UP. Run 10 matches per format (4 000
  calls). Acceptable phase-4 budget (~ $0.30 extra).
- 95% CI width > 5 pp → ACCEPT inconclusive. Document the pilot in
  `visible-format-bench.md`; pin JSON-style by prior; the WP-G
  closing-10 IS the head-to-head against the JSON-by-prior baseline.

**Trip-wire.** WP-E acceptance (`work-packages.md` §WP-E) is
**explicitly probe-gated** on D2: WP-E must NOT commit without the
D2 cohort-sizing pilot recorded in `visible-format-bench.md` AND a
green decision from the user. If WP-E's measured per-format deltas
are within the 95% CI width, the bench output records "inconclusive"
rather than a forced ranking. The user reviews the data before WP-G's
substrate is pinned.

**Mitigation.** The cohort sizing is a one-line knob in the probe
harness. Scaling 5×8 to 10×8 is a 2× cost increase and a 2× runtime
increase. Phase-3's closing-50 was 50×8 = 400 matches; phase-4's
worst-case bench is 30 matches across the three formats — well within
the phase budget envelope.

---

## D3 — Kill feed surface trips Azure content moderation

**The risk.** Phase-1 surfaced an Azure content-moderation incident:
the "betrayer" persona archetype tripped moderation persistently and
was archetype-swapped to "opportunist" mid-phase (mental-model §12).
The trigger was repeated mentions of deception and betrayal in the
persona prompt + speech actions.

The phase-4 kill feed introduces a new content surface: every player's
prior turn includes a line like `Player_2 killed Player_1 with axe`,
broadcast to all surviving agents. Multi-turn matches accumulate
multiple kill-feed lines, and a closing-10 cohort will produce hundreds
of kill-feed renderings across the LLM context. The content is
structurally violent (kill verb + weapon noun), and the moderation
layer may flag patterns we haven't seen.

The weapon name is the second-order risk. Phase-4 weapons (rusty_blade,
sword, axe, greatsword, plus cloth/leather/chain/plate armour) are
benign individually. But the kill feed concatenates the weapon name
into a violent-action sentence ("killed ... with axe"), and the
phase-5+ cursed-item flavour text seam (intent §3, pillar 5) plans to
make weapon names carry in-world prose. If the moderation layer flags
"killed ... with axe", it will definitely flag "killed ... with the
Whispering Cleaver of Cain" in phase 5+.

**Why it matters.** A moderation-triggered safe-default cluster would
mimic D1's regression mode (fellback rate rises) AND would be
indistinguishable in the persisted trace from a model-side schema
failure UNTIL WP-B's diagnostic bundle (which surfaces
`failureReason: "content_filter_blocked"` distinctly from
`failureReason: "schema_validation_failed"`).

Phase-3 captured `failureReason` per row; phase-4 makes it visible per
row. If kill-feed content trips moderation, WP-B is the diagnostic
surface that catches it.

**Probe (D3.1).** Pre-flight kill-feed moderation probe before WP-D
ships:

1. Branch from current main with WP-A landed (kill-feed records
   threaded through) but with a synthetic harness that constructs an
   inputBuilder fixture containing the maximum-density kill-feed:
   `Player_2 killed Player_1 with axe` × 7 lines (i.e. seven kills
   visible to the observer's prior turn — worst case at turn 50 when
   the match has resolved most agents).
2. Send 50 such requests to Azure (the same dev deployment used by
   phase-3) with a benign persona prompt.
3. Measure: count of `failureReason === "content_filter_blocked"`.

**Decision rule.**

- Zero `content_filter_blocked` failures in 50 requests → ship as
  scoped.
- 1–5 failures (≤ 10%) → MITIGATE. Soften the kill-feed phrasing
  options (the load-bearing alternatives are listed below). Re-probe.
- > 5 failures (> 10%) → ESCALATE. Reframe the kill feed entirely
  (the load-bearing alternatives are listed below). Re-probe.

**Mitigation alternatives — re-scope paths, not engineer-discretion
fallbacks.** The canonical kill-feed shape per intent §3 is
`<killer> killed <victim> with <weapon>` and the README §3 Cucumber
acceptance asserts on those exact prose tokens. Any of the
alternatives below ALTERS the canonical shape and is therefore a
**scope-change requiring (a) user approval AND (b) an explicit
acceptance-criteria update in README §3 / per-turn-context-intent §3**
before WP-D ships it. An engineer cannot pick from this list
unilaterally — D3 must escalate to the user. Listed in order of
intent-anchor proximity:

1. **Phrasing pass 1 — replace "killed" with "eliminated" or
   "defeated".** Tested phrasing on benign Azure deployments suggests
   "eliminated" is moderation-neutral. Cost: small phrasing edit in
   `buildKillFeedLines`. **Re-scope: alters the canonical verb in
   intent §3 prose; requires user approval AND README §3 Cucumber
   line update from "killed" to the new verb.**
2. **Phrasing pass 2 — remove the weapon name from the line.**
   `Player_2 eliminated Player_1` without the "with axe" suffix. The
   match-meta information (who's down) is preserved; the weapon-name
   carrier (phase-5 cursed-item seam) is deferred. **Re-scope: drops
   a load-bearing piece of intent §3 (weapon name) AND defers the
   phase-5 cursed-item seam; requires user approval AND README §3
   acceptance update.**
3. **Drop the kill feed entirely; keep only alive count.** The alive
   count line (`M/8 players alive`) is the load-bearing match-meta
   signal — it unlocks the rat-lays-low behaviour. The kill feed is
   the persona-behaviour amplifier (trader, opportunist) — important
   but not load-bearing for the < 5% no-op threshold. **Re-scope:
   drops intent §3's primary affordance; requires user approval AND
   removal of the kill-feed Cucumber scenarios from README §3.**

**Trip-wire.** WP-D acceptance (`work-packages.md` §WP-D) is
**explicitly probe-gated** on D3: WP-D must NOT commit without the
D3 probe data in `kill-feed-moderation.md` (or a §3 in
`visible-format-bench.md`) AND a green decision from the user.
Combined with D1, WP-D therefore needs BOTH D1 AND D3 sign-off
before commit.

**Why this is a real risk, not paranoia.** Phase-1's betrayer
moderation event was unexpected — the team didn't predict it from the
persona prose alone. Moderation behaviour on Azure is opaque and
version-drifts (the phase-1 trigger was on a model version that may
have rolled). A pre-flight probe is cheap (~ $0.50, ~ 5 min) and
catches the risk before it contaminates WP-G's closing-10 (which is
both more expensive and more diagnostic-laden).

---

## Probe execution order

```
WP-B (diagnostic bundle) lands first
  │
  ├─ WP-A engine + state ────────┐
  │                              │
  ├─ WP-C system prompt slim ────┤
  │                              │
  │     D1 probe runs HERE        │
  │     (slim prompt + enriched   │
  │      descriptions, phase-3    │
  │      user message)            │
  │                              │
  └─────── WP-A + WP-C land ─────┤
                                 │
                                 ▼
                            WP-D user message rebuild
                                 │
                                 │     D3 probe runs HERE
                                 │     (kill-feed moderation,
                                 │      worst-case density)
                                 │
                                 ▼
                            WP-D lands
                                 │
                                 │     D2 probe runs HERE
                                 │     (Visible format bench
                                 │      cohort sizing)
                                 │
                                 ▼
                            WP-E format bench
                                 │
                                 ▼
                            WP-F lever probe
                                 │
                                 ▼
                            WP-G closing-10
```

Probes block the next WP from committing until the decision rule
fires. The user reviews each probe's data before the dependent WP
ships.

---

## Cross-references

- `docs/project/phases/03-substrate-refinement/de-risking.md` —
  phase-3 risk pattern; D-P3-1 (reasoning capture probe) is the
  precedent for "probe before committing the dependent WP".
- `docs/project/phases/03-substrate-refinement/PHASE-3-CLOSURE.md`
  §3.3 — precedent for documenting a residual miss honestly rather
  than forcing a fix; phase-4's D1 escalation path uses the same
  pattern.
- `docs/project/spec/mental-model.md` §12 — phase-1 content
  moderation finding (betrayer → opportunist swap). Direct evidence
  for D3.
- `docs/project/spec/per-turn-context-intent.md` §3 — kill feed
  scope (match-meta only). The intent-anchor framing IS the contract;
  D3's mitigations preserve the intent within moderation constraints.
- `convex/llm/azure.ts` — content-filter detection
  (`isContentFilterBlocked`) and `failureReason:
  "content_filter_blocked"` mapping. D3 probe reads this signal
  directly.
