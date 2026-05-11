# D2 Format Bench Sizing

> Statistical sizing exercise for D2. This is not a WP-E bench run and
> does not select a Visible format from observed gameplay data.

## Source Anchors

- `docs/project/spec/mental-model.md` §13: Phase 4 picks the Visible
  keyed-object serialisation empirically as part of the per-turn context
  redesign.
- `docs/project/spec/per-turn-context-intent.md` §4: Visible format is
  probed on token cost, tool-call pass rate, and no-op rate.
- `docs/project/phases/04-context-redesign/de-risking.md` D2: the bench
  is noisy if JSON/YAML deltas are under about 3 percentage points, and
  the scoped cohort is 5 matches × 8 personas × 50 turns = 2,000 calls
  per format.
- `docs/project/phases/04-context-redesign/work-packages.md` WP-E:
  pass rate dominates, then no-op rate, then token cost; seed and
  persona assignment must be fixed across formats.

## Verdict For WP-E Planning

Recommended cohort:

- JSON-style: **4,000 calls** = 10 matches × 8 personas × 50 turns.
- YAML-style: **4,000 calls** = 10 matches × 8 personas × 50 turns.
- Keyed-inline, if included rather than treated as a stretch goal:
  **4,000 calls** by the same rule. Do not compare it at a smaller N
  against JSON/YAML.

This scales the currently scoped 5-match cohort from 2,000 to 4,000
calls per format. The 2,000-call cohort is acceptable only if the D2
pilot shows near-independent call variance and the observed JSON-vs-YAML
lead is clearly larger than the projected 95% CI. For planning, scale to
10 matches per format because WP-E's decision is a head-to-head selection
and Phase 3 already showed non-trivial run-level variance.

If the final WP-E measured JSON-vs-YAML lead is inside the 95% CI for
the difference, record the result as inconclusive and pin JSON by prior,
per WP-E's tie-breaker.

## Metrics

### Tool-Call Pass Rate

The canonical pass-rate metric is:

```text
rawArguments == decision
```

Use the WP-B canonicalisation: parse `rawArguments` as JSON, compare it
with the persisted `decision` after key-sorting and whitespace removal,
and count semantic equality as pass.

`fellBackToSafeDefault` is supporting telemetry only. It is not the
headline pass-rate metric for D2/WP-E because it misses edge cases where
the model emitted parseable arguments that were later normalised or
engine-zeroed.

### No-Op Rate

No-op is the WP-E/Phase-4 definition:

```text
primary == "stationary_action"
AND move.kind == "none"
AND action.kind == "none"
```

This is also a binary proportion, but it is a separate behavioral
outcome from tool-call pass rate. A format can have a high
`rawArguments == decision` pass rate and still produce too many
stationary turns.

### Token Cost

Token cost is sized separately from the behavioral proportions. It is
the mean `chars / 4` proxy for the rendered Visible-object body, ideally
computed as a paired comparison over the same Visible-state fixtures:

```text
d_i = tokenCost_json_i - tokenCost_yaml_i
mean difference = mean(d_i)
```

This does not require additional LLM calls. The same Visible states can
be rendered as JSON and YAML locally, and the paired cost difference can
be estimated from those renderings.

## Assumptions

- Confidence target: 95% intervals.
- Selection target: distinguish JSON-vs-YAML behavioral deltas of about
  3 percentage points; smaller deltas may reasonably be declared
  inconclusive.
- Reported CI width below means half-width / margin of error. The full
  interval is twice this number.
- Planning pass-rate baseline: `p = 0.92`, using Phase 3's 8.256%
  fallback rate as a rough variance anchor. The canonical
  `rawArguments == decision` rate is not identical to `1 - fellback`,
  but this is a sizing proxy.
- Planning no-op rates: `p = 0.05` target and `p = 0.10` stress case.
- Calls are clustered by match/persona/turn, so effective N is smaller
  than raw calls. Use a planning design effect of `D = 1.8`, equivalent
  to a small match-level ICC of about 0.002 with 400 calls per match:

```text
D = 1 + (cluster_size - 1) * ICC
D = 1 + (400 - 1) * 0.002 = 1.798
```

The pilot should replace this planning design effect with measured
run-level variance or a match-block bootstrap.

## Formulas

For a binary proportion with equal N in JSON and YAML:

```text
N_eff = N_raw / D
SE(diff) = sqrt((p_json * (1 - p_json) / N_eff)
              + (p_yaml * (1 - p_yaml) / N_eff))
```

When planning with `p_json ~= p_yaml ~= p`:

```text
SE(diff) ~= sqrt(2 * p * (1 - p) / N_eff)
95% half-width = 1.96 * SE(diff)
N_raw required = D * 2 * p * (1 - p) * (1.96 / h)^2
```

Where `h` is the target half-width in probability units. For `h = 0.02`,
the target is +/- 2 percentage points on the JSON-vs-YAML difference.

For paired token cost:

```text
SE(mean token difference) = s_d / sqrt(n_pairs)
95% half-width = 1.96 * s_d / sqrt(n_pairs)
n_pairs required = (1.96 * s_d / h_tokens)^2
```

Where `s_d` is the standard deviation of per-fixture token-cost
differences.

## Concrete Calculations

### Behavioral Proportions

At the scoped 2,000 calls per format and assuming independent calls:

```text
pass p=0.92:
95% half-width = 1.96 * sqrt(2 * 0.92 * 0.08 / 2000)
               = 0.0168 = +/- 1.68 pp

no-op p=0.05:
95% half-width = 1.96 * sqrt(2 * 0.05 * 0.95 / 2000)
               = 0.0135 = +/- 1.35 pp
```

Under the planning design effect `D = 1.8`, the 2,000-call cohort has
only `2,000 / 1.8 = 1,111` effective independent calls:

```text
pass p=0.92:
95% half-width = 1.96 * sqrt(2 * 0.92 * 0.08 / 1111)
               = 0.0226 = +/- 2.26 pp

no-op p=0.10:
95% half-width = 1.96 * sqrt(2 * 0.10 * 0.90 / 1111)
               = 0.0249 = +/- 2.49 pp
```

That misses the +/- 2 pp planning bar for a head-to-head format
selection.

At 4,000 calls per format with the same design effect,
`N_eff = 4,000 / 1.8 = 2,222`:

```text
pass p=0.92:
95% half-width = 1.96 * sqrt(2 * 0.92 * 0.08 / 2222)
               = 0.0160 = +/- 1.60 pp

no-op p=0.10:
95% half-width = 1.96 * sqrt(2 * 0.10 * 0.90 / 2222)
               = 0.0176 = +/- 1.76 pp
```

The direct required-N calculation for +/- 2 pp confirms the same order
of magnitude:

```text
pass p=0.92, D=1.8:
N_raw = 1.8 * 2 * 0.92 * 0.08 * (1.96 / 0.02)^2
      = 2,545 calls per format

no-op p=0.10, D=1.8:
N_raw = 1.8 * 2 * 0.10 * 0.90 * (1.96 / 0.02)^2
      = 3,112 calls per format
```

Because WP-E runs in whole-match units of 400 calls, the no-op stress
case rounds to 8 matches. The recommendation rounds up to **10 matches**
to match D2's scale-up knob, improve match-block stability, and preserve
headroom if the pilot estimates a slightly larger design effect.

### Token Cost

Token-cost sizing does not drive the LLM cohort size. If the paired
standard deviation of JSON-vs-YAML rendered-cost differences were
`s_d = 16` tokens and the desired 95% half-width were 2 tokens:

```text
n_pairs = (1.96 * 16 / 2)^2
        = 246 paired Visible states
```

For a tighter +/- 1 token estimate:

```text
n_pairs = (1.96 * 16 / 1)^2
        = 984 paired Visible states
```

Even the 1-match D2 pilot has 400 paired states by the scoped math, and
the 2,000- or 4,000-call behavioral cohorts are more than enough for
token-cost estimation. Token cost should therefore remain the WP-E
tie-breaker, not a reason to increase LLM calls.

## Reporting Guidance For WP-E

- Report JSON and YAML with identical seed/persona assignments.
- Report the canonical pass rate first: `rawArguments == decision`.
- Report `fellBackToSafeDefault` and `validatorReason != null` only as
  supporting telemetry.
- Report no-op rate as the second behavioral metric.
- Report token cost as a paired rendered-cost mean with a separate CI.
- Include both per-call CIs and a match-block sensitivity check. If the
  match-block interval crosses zero for the leading behavioral metric,
  call the result inconclusive.
- If 4,000 calls per format still leaves the observed lead within the
  95% CI, do not force-rank YAML over JSON. Pin JSON by prior and record
  the uncertainty in `visible-format-bench.md`.
