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

## 12. Open questions / live tensions

Tracked here because they shape the why, not the how:

- **How much prompt-injection is fun vs. frustrating?** Cursed item names are great; player-authored item names risk passive spam.
- **Does formal trade belong eventually?** Speech alone may be sufficient. Adding trade earns depth; loses minimalism.
- **Daily-seed mode as the sticky hook?** Possibly the leaderboard format that converts curiosity into return visits.
- **Guest → account conversion trigger.** "Save this idiot" is a candidate; not yet validated.
- **Content moderation vs. deception language.** Surfaced in phase 1: the original "betrayer" archetype tripped Azure content moderation persistently and was archetype-swapped to "opportunist" mid-phase. Phase 2's cursed-item layer leans on aggressive in-world text (threats, lies, corpse notes, prompt-injection inscriptions); the moderation layer is a real constraint on what content can ship. Worth a deliberate design pass before phase 2 starts authoring item flavour text.

---

*This document evolves as the user's understanding evolves. Update it whenever intent shifts, conflicts surface, or new insight reframes the why.*
