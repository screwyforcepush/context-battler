# Mental Model — context-battler

> The why layer. Purpose, core flows, user mental models, business logic.
> No implementation details. No code. Specific mechanics and tunables live in `concept-spec.md`.

---

## 1. What this product is

Two interlocking things:

1. **A turn-based battle royale arena.** Eight agents on a grid. Limited vision, scarce gear, simultaneous turn resolution, evac timer, last-one-standing rules. The engine enforces all of it. The arena is real — agents really die, prizes really split, points really stick.

2. **A prompt-authoring meta-game.** Players don't control their agent during a match. They write the behavioural prompt that decides how their agent fights, talks, hides, betrays, or runs. They watch what their words actually produced, infer what went wrong, and revise the prompt for next match.

Player skill = writing the mind. The arena is what evaluates it.

## 2. The unique value

> Autonomous prompt-creatures surviving, deceiving, misreading, adapting, and occasionally being psychologically defeated by cursed item text.

What players are buying:
- The thrill of writing a mind and watching it act in public.
- The diagnostic puzzle of inferring *why* their agent did what it did.
- The cognitive warfare of speech, item names, and environmental text as a live attack surface.
- The social comedy of agents misreading each other.

What players are **not** buying:
- Tactical depth in the XCOM sense.
- Twitch skill expression.
- Optimal-play theorycrafting against deterministic systems.

## 3. What is built vs. what emerges

The single most important boundary in the product. The team builds the substrate; players' prompts produce the strategy.

| The engine builds (mechanic) | Players' prompts produce (emergent) |
|---|---|
| Turn-based simulation, simultaneous resolution | When to fight, flee, hide, push |
| Vision, movement, attack, equip, loot rules | Risk tolerance, combat doctrine, loot priorities |
| Speech as an action — broadcast within hearing range | Lies, threats, false truces, baiting |
| Equipped item names appearing in agent context | Prompt-injection attacks via item naming |
| Visible scratchpad — agent's persistent memory | What the agent chooses to remember; what the player infers |
| Evac mechanic, win conditions, scoring | Diplomacy, alliances, betrayal at the line |

The engine **enables** social dynamics. It does not **enforce** them. Lying, betrayal, manipulation, prompt-injection chains, and emergent diplomacy are properties of *how players write prompts*, not features the engine implements. Resist the urge to bake "diplomacy systems," "trust scores," or "alliance contracts" into the engine. The substrate is enough.

## 4. Player skill, defined

Player skill = **behavioural design + prompt compression + strategic debugging + exploiting other agents' weird little brains**.

A skilled player writes prompts that are:
- Robust to in-world prompt injection (cursed swords, lying opponents, false signs).
- Decisive under partial information (limited vision, paranoia, last-known states).
- Coherent under pressure (evac timer, dwindling HP, betrayal).
- Compressed — saying more with fewer tokens.

A skilled player is not someone who memorises hit tables. There are no hit tables.

## 5. Core emotional loop

```
Write prompt.
Watch agent enter arena.
Agent loots, lies, hides, fights, gets baited, or panics.
See the scratchpad. Infer the failure.
Revise prompt for next run.
```

The two best-feeling failure/success modes that anchor design:

- **Best failure:** "My agent trusted a sword name and wasted its heal."
- **Best success:** "My agent camped evac in cover, convinced two enemies to share extraction, then overwatched the wounded one to shrink the split."

If a design decision makes either of those moments more likely, more legible, or more shareable — it's probably right.

## 6. Design pillars

Non-negotiable framings. Mechanics serve them, not the other way around.

1. **The player writes the mind, not the moves.** Failures must feel attributable to the prompt, never to the UI.
2. **Rules simple, minds messy.** Combat/movement stay blunt and legible. Depth comes from limited vision, scarce gear, social deception, prompt injection, evac pressure, and agent memory.
3. **No mid-run babysitting.** No tactical commands during a match. Prompt updates between runs only.
4. **The scratchpad is the explainability layer.** No post-run AI coaching. The player observes, infers, and revises. The agent's live tactical memory is exposed; its self-reflection is not.
5. **Text is terrain.** Speech, item names, inscriptions, corpse notes, signs — all can influence agents. Prompt injection is *part of the game*, not a vulnerability.
6. **Build the substrate; let the strategy emerge.** The engine provides affordances. Players' prompts produce strategy. Diplomacy, lying, and betrayal are not engine features — they are emergent consequences of speech + scratchpad + prompt authorship.
7. **State is the contract; runtime is swappable.** Convex holds the canonical game state and turn ledger. The engine and the renderer meet only at this data — neither knows about the other. Any slice can be rewritten in another language without touching the others. See `architecture.md`.

## 7. North star (decision filter)

When considering any new rule, mechanic, or feature, ask:

> Does this make prompt-authored behaviour more interesting, legible, or exploitable?

- **Yes** → consider it.
- **Only adds tactical realism without changing how prompts express character** → delay or reject.

The arena is load-bearing — but the test is not "does this deepen the simulation," it is "does this deepen *prompt-authored behaviour*." A new mechanic that makes the arena more legible *for prompt authors* is welcome. Hit chance, crits, AP systems, flanking arcs make tactics richer and prompts noisier — they fail the filter.

## 8. The user, in three audiences

- **Guest / curious player.** Picks a preset card, types a sentence, watches what happens. Conversion moment: *"Want to save this idiot and make it stronger?"*
- **Returning player.** Iterates on a saved agent across runs. Cares about leaderboards, replays, and the satisfaction of a prompt that finally clicks.
- **Prompt-craft enthusiast.** Treats prompts as code. Cares about prompt sections, scratchpad capacity, build sharing, and edge-case exploitation (cursed items, speech baiting, betrayal traps).

Progression rewards the *ability to shape the mind* — more prompt length, more sections, more scratchpad, saved cards. Not raw combat stats. Permanent power asymmetries break the prompt-authorship premise.

## 9. What is intentionally absent

These omissions are load-bearing for the product identity:

- No mid-run prompt editing (in PvP).
- No post-run AI coaching or auto-postmortem. The player does the thinking.
- No giant action menu for the agent. Compact decision contract over local affordances.
- No conditional logic in turn tool calls — concrete actions and targets only, no predicates or fallbacks. The LLM thinks before committing; the engine resolves after. Misreads and wasted actions are features, not bugs to design around.
- No conversation history or session memory across turns. The scratchpad is the agent's *only* persistent state.
- No engine-enforced diplomacy, alliance, or betrayal mechanics. These emerge from prompts.
- No real-time interrupts. Turn-based, simultaneous resolution.

## 10. Current focus — phase 1

> **Status: CLOSED — 2026-05-07.** All 6 done-bar thresholds met on the persisted Convex closing-50 report (`reportId jd760kqja7sfwvt71mn0gdcexh8686jd`): extraction 96%, kill 96%, equip 100%, speech 100%, persona spread 28 pp, 0 crashes. Per-(run, agent, turn) introspection live via `convex run turns:getAgentTurn`. Closure record: `docs/project/phases/01-engine-and-harness/PHASE-1-CLOSURE.md`. The spec below is preserved as the record of what the bar was; phase 2 dispatch is the next decision.

The first delivery slice is **simulation + evaluation harness**:
- 8 pre-baked agent personas with minimal behavioural prompts. The 8 preset cards in `concept-spec.md` (Rat, Duelist, Trader, Betrayer, Paranoid, Camper, Sprinter, Vulture) are **illustrative, not prescribed** — the only requirements are that the roster is 8 personas and that they are *sufficiently differentiated* in behaviour to register on the simulation report.
- Full turn loop: visible state → LLM call → decision → engine resolution → next turn.
- Stateless per-turn LLM calls. Scratchpad is the only persistent memory.
- A single hand-crafted reference map for phase 1. Procedural map generation is deferred — same map every run keeps regressions diagnosable while the engine is being shaken out.
- A multi-run harness that fires N matches and aggregates stats (kills, extractions, survival turns, speech, equips, movement) into a **simulation report** — leaderboard-shaped, but evaluation-only, not player-facing.
- No player input, no rendering layer, no progression, no public leaderboard.

**Prompt economy is load-bearing.** Each turn is one small, snappy LLM call: the model receives the system prompt (game rules + objective + available actions), the persona prompt, the scratchpad, and the visible-state summary, and returns a single tool call with a compact action object. All four inputs are kept tight — system prompt is terse, persona prompts are short, the scratchpad is bounded, the visible-state summary is a tactical digest rather than a tile dump. Sprawling prompts would make turns slow, calls expensive, and persona differentiation muddier. Brevity is a design constraint, not a stylistic preference.

**Reasoning is on, at a small budget.** The agent needs to actually deliberate over the visible state before committing to a tool call — turning reasoning off would degrade the decision to next-token autocompletion, which collapses persona signal and breaks attribution. The Azure deployment supports `reasoning.effort` (`"low" | "medium" | "high"`); the exact level is a tuning knob for the engineering loop, not a fixed value. The tension between *snappy* and *thinks first* is real and intentional — start low and tune up only if persona behaviour is too shallow on the report.

The goal is to prove the substrate produces watchable, attributable behaviour from prompts alone. The **proof artifact is the simulation report**: differentiated outcomes across personas, with at least some agents reaching extraction.

This means **prompt and value tuning is in scope for phase 1** — but only to the extent needed to produce a meaningful signal in the report. A clean engine that runs to completion but yields all-zero stats (no kills, no extractions, no movement) has not met the phase 1 bar. Tuning beyond "engine clearly works" is a downstream loop, not phase 1.

**Quantitative done-bar** (50-run evaluation pass, sampled with all 8 personas in every run):

- ≥ **30%** of runs end with at least one agent extracting at evac (≥ 15 of 50).
- ≥ **80%** of runs contain at least one kill.
- ≥ **80%** of runs contain at least one chest equip.
- ≥ **50%** of runs contain at least one speech event.
- **Persona differentiation**: across the 8 personas, the spread (max − min) of extraction rate is ≥ **15 percentage points**. Prompts must be visibly shaping behaviour, not all converging to identical outcomes.
- Engine completes 50 consecutive runs with **no crashes or invalid states**.

These numbers are the closing condition for phase 1, not the design ceiling. They are intentionally lenient — the bar is "the substrate works and prompts matter," not "the meta is balanced."

**Iteration cadence** (three stages, each a precondition for the next):

1. **1 run, sequential** — engine smoke. Single match completes end-to-end without crashing or hitting invalid states. This validates the turn loop, resolution order, and LLM round-trip before parallelism is introduced.
2. **10 runs, parallel** — fast in-loop iteration during build/tuning. Each run is independent; the harness fans them out concurrently. This is the everyday loop while shaping prompts, spawns, and values.
3. **50 runs, parallel** — closing report. The run that's measured against the quantitative done-bar above and persisted to Convex.

Parallelism is required from stage 2 onward — sequential 50-run passes would be too slow to iterate against. Per-run state must be fully independent: no shared mutable state, no order dependence.

Player input, rendered playback, progression, public leaderboards, and prompt-injection item naming are all downstream of phase 1.

## 11. Current focus — phase 2 (replay overseer, v0)

> **Status: dispatched 2026-05-08.** Phase 1 closed with persona-differentiated stats on a 50-run report (extraction 96%, kill 96%, persona spread 28 pp). Stats are a coarse signal. Phase 2's first slice is a **personal replay overseer** — a local browser tool the user runs against their Convex dev deployment to *look an actual run in the eye*.

This is **not** the eventual consumer-facing spectator experience (third-person POV, vision masks, terrain, speech bubbles, multi-watcher). That is a later phase. This v0 is the **diagnostic-grade overseer** the user needs *before* committing to a consumer renderer:

- One user (the project's Outcome Steward / operator). No auth, no public deploy.
- **Ground truth, always.** No fog-of-war. The user sees what every agent is doing, not what one agent saw. Per-agent visibility lives in the `visibleStateDigest` field of the trace, surfaced as inspectable text — not as a rendered fog mask.
- **Bird's-eye grid.** The 100×100 reference map, fit to viewport. No zoom, no pan, no textures. Glyphs and colors. A grid is enough to *feel* whether the agents are playing the game.
- **Step, don't stream.** Forward-only turn stepper. No timer, no animation. The user controls the cadence because the value is *reading the moment*, not watching it.
- **The tool call is the explainability surface.** Each turn's per-agent decision (move + action + say + overwatch + consume + scratchpad delta) is rendered in human English, not raw JSON. Verbose surfaces (full persona prompt, full visibleStateDigest, full scratchpad-before/after) are click-to-expand so the feed stays skimmable.
- **Visual analogue of `harness/analyze-match.ts`.** Same data, different modality. The CLI tool is for agent introspection (per `feedback_observability_targets_agents`); this overseer is for *human* intuition.

The success criterion is vibe, not metrics. The user is asking: *are these minds messy in the way the design pillars promise? does the substrate actually produce watchable, attributable behaviour?* If the user can step through three matches and form a confident answer, the v0 has done its job.

**Architectural posture (carried into phase 2):**
- Renderer slice subscribes to State only — no engine coupling, per architecture §1. The renderer reads `matches`, `turns`, `worldState`, `characters` and reconstructs entity positions by walking `resolution.moves[]`. The engine doesn't push events to the renderer.
- **Batch fetch over reactive subscribe** for v0. The replay target is a *completed* match. Live spectate (in-progress matches) is a different feature, deferred to whichever phase ships the consumer renderer.
- Tech stack is intentionally pragmatic — local browser, "whatever runs". The consumer renderer will be re-cooked from scratch when its own constraints (fog-of-war, animation, multi-watcher, mobile) drive the choice. Decoupled from this v0.

**What this slice unblocks:**
- Decisions about persona behaviour the report can't show (e.g. *why* rat extracts; *what* trader's 1 583 speech events actually look like; *whether* paranoid's evac-corner camp is interesting or boring to watch).
- Decisions about cursed-item flavour text moderation — the user needs a sense of how speech and item names actually feel in-context before authoring aggressive prompt-injection content.
- Eventual specification of the consumer-facing third-person POV experience — the v0 reveals which inspection surfaces are load-bearing for *understanding* a match, which informs what the consumer version must replicate (probably less than this overseer shows) versus what's diagnostic-only.

**What this slice deliberately is not:**
- Not a public spectator. Not authed. Not deployed.
- Not the consumer renderer. The eventual third-person POV with division/textures/fog of war is a re-cook, not an extension of this v0.
- Not a metrics dashboard. The closing report covers metrics. This is for what metrics can't capture.
- Not live. Completed-match replay only.

**Phase 2 v0 surfaced a substrate refinement (2026-05-08).** Stepping through replays revealed that the agent's per-turn input is missing the outcome-attribution channel needed to close the explainability loop on pillar 4. Specifically: agents don't know why their HP dropped (no record of incoming attacks in the digest), retry actions on already-resolved targets (drained corpses silently no-op), get stuck on terrain they can't see (walls were never emitted), and emit decoration into fields the engine ignores (`overwatch_priority`). The deeper read: phase 1's `Affordances:` block was a band-aid for a disjointed prompt design — system prompt, persona, scratchpad, visible digest, and tool schema were authored as independent slots rather than as one coherent rolled context. A substrate-refinement slice is therefore scoped before consumer-facing work: digest rebuild with outcome attribution, system prompt rewritten to teach the digest's shape and the action schema's grammar, schema break to unify loot/interact and replace `overwatch_priority` with a structured stance, reasoning text persisted, replay UI's expand-modal collapsed into a single raw-dump pane. None of this changes the design pillars; it makes pillar 4 (scratchpad-as-explainability) actually attainable — the scratchpad alone can't preserve what the engine never told the agent.

**Phase 3 closed (2026-05-08).** The substrate-refinement slice landed: schema break (loot/interact unify, `overwatch_stance` replaces `overwatch_priority`, `agentRecord.llm.reasoning` persisted), engine fixes (walls emitted in digest, drained-corpse trace, wall-blocked move marker, defensive overwatch counter-fire, offensive first-in-range, loot dispatch by id namespace), digest+system-prompt rewrite (Last-turn-you line, observation brackets, no Affordances/Heard/Last-known/Evac sections; system prompt as schema teacher), replay UI raw-pane (5 tabs → 3 sections: full LLM input + reasoning text + tool-call JSON). Closing-10 report `jd7b98r81fxarkb3yyctsap2p186bbj7` (`reportType: "phase-3-closing-10"`) persisted to Convex; closure record at [`docs/project/phases/03-substrate-refinement/PHASE-3-CLOSURE.md`](../phases/03-substrate-refinement/PHASE-3-CLOSURE.md). 13 / 14 thresholds met after the WP-F (persistence/render half), WP-G (LLM↔engine contract half: corpse-id normalisation + JSON-Schema field-list alignment + chest-loot phrasing polish), and WP-H (metric-formula correction: the corpse-loot success filter in `convex/reports/phase3.ts` was still keyed on the pre-WP-G.1 target shape, so honest post-kill loot pivots were undercounted as 0% — the third occurrence of the contract-drift pattern, this time on the report-aggregator side) substrate-correctness bundles, with the schema-validity gap closing 18.73% → 8.256% (load-bearing WP-G measurement, well under the ≤10% bar) on top of the WP-F flips of kill rate (30→90%), defensive and offensive overwatch fires (0→18 / 0→4), and outcome attribution (vacuous → 88.6%) to PASS, and the WP-H flip of corpse-loot success (0% → 80% of runs) to PASS; single residual miss documented as a why-not in the closure record — reasoning capture 68.8% (Azure response-shape constraint at `effort: "low"`, an Azure-side floor independent of the substrate). The diagnostic loop and machine-introspection surface are intact: every rejected decision carries a `validatorReason`, every reasoning emission is persisted (~⅔ non-fallback capture rate at `effort: "low"`), and the replay UI's raw-pane shows the agent's full input + chain of thought + tool call for any (run, agent, turn).

## 13. Phase 4 — per-turn context redesign (dispatched 2026-05-11)

> **Status: dispatched 2026-05-11.** User stepped through phase-3 replays and surfaced four classes of issue: (a) duplication and prompt-hygiene leakage in the system prompt, (b) the Visible digest's unkeyed bracketed observations forcing the model to *infer* field semantics, (c) diagnostic gaps in the replay UI (`rawArguments` masked by `decision`, no `validatorReason`, no `usage.output_tokens` cap awareness, no tool-schema visibility), (d) reasoning-rich-but-stationary turns whose root cause is hidden behind those diagnostic gaps. The intent anchor is [`docs/project/spec/per-turn-context-intent.md`](./per-turn-context-intent.md) — a user-hand-crafted, near-verbatim sketch of the redesigned context structure and prose. Treat that doc as canonical.

The redesign lands four moves at once:

1. **System role** = stable rules-of-the-game spoken by the referee. Three short bullet groups: stakes ("7 other agents competing for the prize pool"), match shape (50 turns, turn 30 reveal, incineration at turn 50), and affordance affordances of walls and cover (cover is *finally* explained as the hide affordance — phase-3 told the model what cover *doesn't* do but never what it does).
2. **Tool schema** carries the action grammar via property `description` fields (move arms, action arms, movement range, scratchpad-usage hint, overwatch stance). The phase-3 system prompt taught these in English while the JSON Schema declared them again — two encodings, drift-prone, token-wasteful. From phase 4 on, the schema is self-descriptive.
3. **Visible** becomes a self-descriptive **keyed object** rather than bullet-text-with-unkeyed-brackets. The exact serialisation (JSON / YAML / keyed-inline) is **chosen empirically** by a token-cost + tool-call-pass-rate bench. "Parse mode" is the deliberate framing — the model treats Visible as data, not prose.
4. **Per-turn narrative** has explicit ordered sections: `## previous turn` (own outcome → own scratchpad → **global kill feed**) then `# Current Game State` (turn, alive count, You: line, Visible). Scratchpad is no longer ambiguously labelled — it sits inside `## previous turn` where it temporally belongs.

**New design surface — global kill feed and alive count.** Phase 4 *deliberately departs from strict fog-of-war* for match-meta. `<killer> killed <victim> with <weapon>` broadcasts globally (BR-genre convention: kill feed independent of LOS), as does `M/8 players alive`. Spatial perception stays local — no positions, no HP, no last-seen — but match-meta is shared knowledge. This unlocks persona behaviour that the current local-only signal cannot: trader negotiates based on who's left, rat lays low after the feed thins, opportunist swoops on a survivor they never saw. The weapon name in the kill feed is also the seam for phase 5+ cursed-item flavour text (pillar 5: text is terrain).

**Prompt hygiene fix (load-bearing).** The phase-3 system prompt closed with `Output discipline: Concrete targets only — no predicates. Invalid choices are replaced with the safe default (do nothing).` That line **teaches the model that emitting nonsense has a graceful fallback** — exactly the wrong incentive. Phase 4 deletes it. Downstream handling stays downstream; the prompt only tells the model what a legitimate response looks like.

**Diagnostic bundle.** Three observability gaps land in the same slice: render `rawArguments` alongside `decision` (with a matched/diverged indicator) so safe-default substitution is visible; surface `validatorReason` whenever the engine validator zeroed an LLM-valid decision; show `usage.output_tokens / max_output_tokens` with a "🔴 truncated" indicator at ≥ 95% of cap (the leading hypothesis for the reasoning-rich-but-stationary turns); add a `--- tool schema ---` section to `Full LLM Input` so the model's complete request body is inspectable.

**Levers in scope:** `max_output_tokens` (current 1200 → probe 1500/2000), `reasoning.effort` (current "low" → probe "medium"), Visible serialisation format (JSON / YAML / keyed-inline).

**Done bar:** the user can step through a 10-run pass in the replay UI with **< 5% no-op turns** (a no-op = `primary:"stationary_action"` AND `move.kind === "none"` AND `action.kind === "none"`), without regressing phase-3 closing thresholds (extraction ≥ 30%, kill ≥ 80%, etc.).

## 14. Substrate refactor — move-arm consolidation (dispatched 2026-05-12)

> **Status: dispatched 2026-05-12.** Standalone substrate refactor, orthogonal to the blocked phase-4 D1 user gate. The phase-4 assignment stays parked at its prompt-strategy decision; this one ships the substrate underneath it so whichever prompt direction the user picks, the surface is principled.

The trigger was a D1 finding: 56+ of the 806 slim-cohort validator zeros were `move.kind='toward_object' targetObjectId='Cover_54_42' is not a known chest or corpse`. The user pushed back: *"seems ergonomic player perspective and fits gameplay. Why can't the player move toward target? Are we staring down the barrel of a refactor?"*

Yes — and the design pillars endorsed it. The current 6-arm move grammar (`relative` / `toward_entity` / `away_from_entity` / `toward_object` / `toward_evac` / `none`) splits navigation by entity *category* (characters vs lootables vs evac vs everything-else-becomes-arithmetic). From the player perspective there is no category distinction — every visible entity is "a thing in the world I can navigate toward". The only real per-type difference is *how close* you want to get; that's a property of the entity, not a structural feature of the verb grammar.

**The principled shape:** 6 arms → 4:
- `toward { targetId }` — any visible entity id
- `away  { targetId }` — any visible entity id
- `relative { dx, dy }` — escape hatch
- `none`

Per-type `stopAtRange` becomes data attached to the entity type (the engine looks it up by id namespace):

| Entity type | stopAtRange | Why |
|---|---:|---|
| Character (living) | 2 | weapon / attack range |
| Chest | 2 | loot range |
| Corpse | 2 | loot range |
| Cover | 0 | step onto — cover only hides while standing on it |
| Wall | 1 | adjacent — wall-hugging for LOS break, can't enter walls |
| Evac | 0 | step into the 3×3 zone — fold from old `toward_evac` arm |

**Three user-confirmed scope decisions:**
1. **Allow `away` for everything**, not just characters. Consistency over ergonomic restriction; persona self-selects what makes sense.
2. **Fold `Evac` into `toward Evac`** — no special-case arm. Once revealed, evac is just another visible entity with `stopAtRange = 0`.
3. **Wall stop-at-range 1.** Adjacent. Makes wall-hugging-for-LOS a first-class verb instead of arithmetic.

**Why this is pillar-aligned, not scope-creep:**
- Pillar 2 ("rules simple, minds messy") — collapsing 6 arms into 4 makes the rule blunter and the model's surface more legible. Persona depth comes from when/why to use these verbs, not from learning which obscure verb fits which entity category.
- Pillar 6 ("build the substrate; let the strategy emerge") — cover-camping, wall-hugging, evac-rushing become *substrate affordances*, not arithmetic puzzles the prompt has to solve. The Camper, Rat, Trader-hiding-to-negotiate, Paranoid personas all benefit.
- Pillar 4 ("scratchpad as explainability") — fewer asymmetric arm names → fewer failure modes the scratchpad has to explain back to the player.

**What this fixes:**
- 56+ cover-as-toward_object validator zeros — structurally retired.
- Wall-toward and evac-toward become first-class verbs.
- The slim-prompt teaching surface shrinks: there is no longer an asymmetric "characters use this arm, lootables use that arm, evac has its own arm" rule for the system prompt to teach.

**What it does NOT solve (D1's bigger fish):**
- 510 chest-re-loot rejections — separate `[opened]` semantics gap.
- 96 `consume='speed'` without consumable — separate equipped-state semantics gap.
- The +6.850 pp foundation residual — unknown source, needs its own probe.

**POC posture:** schema break acceptable (`project_poc_schema_wipe_acceptable`); Convex wipe is on the table. Phase-4 doesn't unblock or block on this refactor — when WP-D unblocks, it will redesign against the new 4-arm grammar, which makes its job easier (less to teach in either prompt prose or schema descriptions).

## 15. Phase 6 — per-turn context iteration 2 (dispatched 2026-05-12)

> **Status:** dispatched 2026-05-12. Supersedes phase-4's parked WP-D
> with a substrate-deeper re-cook. The canonical intent anchors are
> [`docs/project/spec/per-turn-context-intent.md`](./per-turn-context-intent.md)
> (system prompt + user-role structure) and
> [`docs/project/spec/decision-tool-schema-draft.md`](./decision-tool-schema-draft.md)
> (verbatim tool schema). The empirical trigger was the 2026-05-12
> schema-emission probe (`harness/probe-schema-emission.ts`) which
> proved the Azure Responses API silently normalises tool schemas to
> strict mode — making "optional" decorative and the model's dense
> sentinel emission unavoidable on this endpoint. The fix is
> structural, not optional-by-required.

The six moves landing in one slice:

1. **Tool shape collapse.** `primary` + `move` + `action` +
   `overwatch_stance` + `consume` (7 fields, two coordination overlays)
   → `use` + `position` + `action` + `say` + `scratchpad` (5 fields,
   no overlays). Position commitment (`{kind:"overwatch"|"counter"}`
   stationary; `{kind:"move", direction, dist}` mobile) replaces the
   primary/move pair. Cross-field stance/primary refines disappear —
   the shape itself makes illegal combinations unrepresentable.

2. **Compass-only direction.** `relative {dx, dy}` removed. `direction`
   is target-relative (`{kind:"toward"|"away", targetId}`) or compass
   (`{kind:"N"|"NE"|...|"NW"}`). Mirrors the 8-bearing vocabulary the
   Visible digest already uses (`dist 7 SE`). Knight's-moves are not
   expressible; accepted as a scope tradeoff.

3. **`use: "consumable" | null`.** Engine knows what's equipped; the
   model just signals "use it or don't." Names of consumables
   (`heal` / `speed`) are no longer in the schema's emission surface.

4. **Per-turn schema variants — first application.** When no
   consumable is equipped, the `use` field's schema narrows to
   `{type:["null"], enum:[null]}` — *structurally* preventing
   `use:"consumable"` emission. Variant scope is intentionally
   bounded to `use` (Q9 in the schema draft); broader target-id
   variants would balloon schema size and bust API cache.

5. **Personal damage feed.** A new event channel: when the agent
   takes damage, the next-turn user message includes
   `<Attacker> attacked you with <weapon> (dmg N)` under
   `# Current Game State` — emitted **regardless of LOS**, closing
   the phase-3 outcome-attribution residue. Sits alongside the
   global kill feed; same line shape, two scopes.

6. **Persona name = agent id.** The 8 personas (Rat / Duelist /
   Trader / Opportunist / Paranoid / Camper / Sprinter / Vulture)
   replace numeric `Player_N` ids in *every* per-turn surface — kill
   feed, damage feed, Visible, status block, `<Player Name>`
   placeholder substitution, attack/loot `targetId`, corpse ids
   (`Corpse_Camper`). One match has one of each persona; names are
   single-word and id-safe. Pillar-aligned: agents *are* characters
   with names. Model-attention strategy: the model sees its own
   identity and other agents' identities by name, not by index.

**Field-scoped validator rejection.** When the variant doesn't catch
something (e.g., mid-turn state changes), the engine validator zeroes
the offending field only — `validatorReason` is per-field, the rest
of the turn resolves. Replaces the old "whole-turn safe-default" pattern.

**Status block + event log structure** (per
`per-turn-context-intent.md` §2):

- `# <PersonaName>` heading + persona prompt.
- `## Status` — `📍` position, `❤️` HP, `⚔️` weapon `[stats]`,
  `🛡️` armour, `🧪` consumable `[effect]`, `🗒️` scratchpad. "Your
  stuff." Equipment carries stats inline.
- `# Current Game State` — turn meta, own-outcome event line,
  personal damage line(s), global kill feed line(s), Visible. "The
  world."

Ownership split (your stuff / the world), not temporal split (then /
now). Last-turn outcome lives in Current Game State, not in a
separate `## previous turn` section.

**Action+overwatch / action+counter are now first-class combos.** A
turn with `position:{kind:"overwatch"}` AND `action:{kind:"attack"}`
resolves both: the deliberate attack lands, AND the overwatch
trigger arms and fires on the next enemy that walks into range.
Counter is the neutral-ready cousin — only retaliates if attacked,
does not fire on movement.

**Authority for execution:**
- Convex dev DB wipe authorised; no backward compatibility, no
  migration shims. POC posture (`project_poc_schema_wipe_acceptable`).
- Azure `.env` endpoint free reign for testing and the closing-20
  run at `low/1200` (phase-3 baseline; no probes this slice).
- 8 persona prompts get a mechanical scrub for dead field refs —
  *not* a behaviour-tune pass; that's deferred.

**Done bar:** 20-run Convex closing report (reportType
`"phase-6-closing-20"`) with phase-3 thresholds preserved
(extraction ≥ 30%, kill ≥ 80%, equip ≥ 80%, speech ≥ 50%, persona
spread ≥ 15 pp, zero crashes), iter-2 specific thresholds met (zero
illegal `use:"consumable"` emissions, ≥10 action+overwatch combo
traces, ≥5 counter-retaliation traces, ≥5 overwatch trigger-fires,
all 8 compass bearings exercised, no-op rate < 5%), and the
diagnostic surfaces (per-turn variant pane, field-scoped
validatorReason render, decisionEnglish for new arms) live in the
replay UI.

### Phase-6 Closure Record

Phase 6 closes as substrate-closed, not metric-perfect. The canonical
persisted report id is `jd78f616beq7dvs84gcs1n2f9586kbqt`;
`reportType` is `"phase-6-closing-20"`; `metBar` is `false`; 16/17
gates pass. The honest miss is no-op rate 43.245% vs <5%. The bar
is not lowered or redefined;
the miss is carried forward as a behaviour-policy problem rather than
a schema, engine, replay, or report-correctness failure.

ADRs 1-10 honoured. The iter-2 contract landed in the intended shape:
five-field tool calls, named personas as agent ids, Status plus
Current Game State event log, personal damage feed, global kill feed,
per-turn `use` narrowing, action+overwatch/action+counter combos, and
field-scoped validator rejection.

OCC replacement policy: a Convex optimistic-concurrency storage-layer
transient was excluded from the
canonical set and replaced 1-for-1 by a concurrency-1 live rerun. That
transient is not counted as an engine crash or invalid state. The
canonical report still represents 20 completed matches with zero
failed matches in the selected set.

Deferred to Phase 7: no-op reduction via persona/policy tuning,
harness auto-retry for OCC, and paginated server-side aggregation if
future reports need server recompute.

## 12. Open questions / live tensions

Tracked here because they shape the why, not the how:

- **How much prompt-injection is fun vs. frustrating?** Cursed item names are great; player-authored item names risk passive spam.
- **Does formal trade belong eventually?** Speech alone may be sufficient. Adding trade earns depth; loses minimalism.
- **Daily-seed mode as the sticky hook?** Possibly the leaderboard format that converts curiosity into return visits.
- **Guest → account conversion trigger.** "Save this idiot" is a candidate; not yet validated.
- **Content moderation vs. deception language.** Surfaced in phase 1: the original "betrayer" archetype tripped Azure content moderation persistently and was archetype-swapped to "opportunist" mid-phase. Phase 2's cursed-item layer leans on aggressive in-world text (threats, lies, corpse notes, prompt-injection inscriptions); the moderation layer is a real constraint on what content can ship. Worth a deliberate design pass before phase 2 starts authoring item flavour text.

---

*This document evolves as the user's understanding evolves. Update it whenever intent shifts, conflicts surface, or new insight reframes the why.*
