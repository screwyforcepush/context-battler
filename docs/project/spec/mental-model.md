# Mental Model — context-battler

> The why layer. Purpose, vision, principles, pillars, user mental models.
> No implementation details, no code. No assignment logs, dispatch/closure
> records, ADRs, or current-state architecture — those live in
> `docs/project/phases/`, `architecture.md`, and the spec docs. This file
> holds intent only.

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

1. **The player writes the mind, not the moves.** Failures must feel attributable to the prompt, never to the UI. The outcome line always tells the truth about what the engine actually did.
2. **Rules simple, minds messy.** Combat/movement stay blunt and legible. Depth comes from limited vision, scarce gear, social deception, prompt injection, evac pressure, and agent memory.
3. **No mid-run babysitting.** No tactical commands during a match. Prompt updates between runs only.
4. **The scratchpad is the explainability layer.** No post-run AI coaching. The player observes, infers, and revises. The agent's live tactical memory is exposed; its self-reflection is not. The scratchpad carries *intel* (what was inside, who has what) — never bookkeeping the substrate could signal itself.
5. **Text is terrain.** Speech, item names, inscriptions, corpse notes, signs, and the kill feed — all can influence agents. Prompt injection is *part of the game*, not a vulnerability. The outcome line is also the *discovery channel*: discoverable mechanics are learned by producing the behaviour and reading what the engine says happened — never taught in the schema or system prompt.
6. **Build the substrate; let the strategy emerge.** The engine provides affordances; players' prompts produce strategy. Diplomacy, lying, and betrayal are emergent consequences of speech + scratchpad + prompt authorship, not engine features. The engine does the path/geometry arithmetic so prompts don't have to — new mechanics are substrate affordances, not puzzles the prompt must solve. Asymmetric schema/engine treatment of conceptually-uniform things is a design smell; fix the substrate, don't band-aid with prompt teaching. The per-turn input is *one coherent rolled context*, not disjoint slots.
7. **State is the contract; runtime is swappable.** Convex holds the canonical game state and turn ledger. The engine and the renderer meet only at this data — neither knows about the other. Any slice can be rewritten in another language without touching the others. The contract holds *what mutates*, not what is static. See `architecture.md`.
8. **Vision is the affordance channel.** Vision contains only points of interest intended to impact gameplay or behaviour. Inert scenery filters out. Spent affordances (empty crates, drained corpses) fall out of Vision *as absence*, not as a `spent: true` flag — the agent never has to track *whether* something is spent; contents and intel live in the text-as-terrain layer (pillar 5). If the answer to *what behaviour does this entry change* is *none*, it doesn't belong in Vision. Vision emits the substrate's *natural structure* (walls, cover, evac as the rectangles the engine stores, with a `shape` discriminator), not a tile enumeration — tile dumps leak the storage representation and tax attention. Inside-state for any enterable terrain shares one convention regardless of type. LOS gating applies uniformly to every entity type, walls included; the only non-LOS-gated entries are intentionally match-meta, minimap-style signals (evac post-reveal; an inbound airdrop's public sky-telegraph; kill feed; alive count), not spatial perception. The replay-render modality is orthogonal — looted crates and mapped walls can stay visible scenery for the human watcher without entering the LLM context.

## 7. The decision filter

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
- No prompt that tells the model invalid output is safely defaulted. Downstream handling stays downstream; teaching the model a graceful fallback exists is exactly the wrong incentive.

## 10. Iteration discipline (load-bearing intent)

How the substrate is grown, stated as enduring intent rather than a phase log:

- **One handcrafted reference map while mechanics are being shaped.** The same map every run keeps regressions diagnosable and replays comparable. Procedural generation and RNG are *deliberately deferred* — not rejected, sequenced. A single dedicated RNG slice lands **after** the mechanics substrate settles and **before** the consumer render phase, and will introduce variance across *several* axes at once on purpose: loot, spawn positions (players too), walls, cover, evac. Until then every new mechanic is authored deterministically so its behavioural signal reads in isolation. One variable at a time.

- **Prompt economy is a design constraint, not a style.** Each turn is one small, snappy LLM call: a tight rolled context (rules, persona, scratchpad, visible-state digest) returning one compact tool call. Sprawling prompts make turns slow, calls expensive, persona differentiation muddier. Tokens earn their keep by changing what the agent might do.

- **Reasoning is on, at a small budget.** The agent must deliberate over visible state before committing. Reasoning off collapses persona signal and breaks attribution. The tension between *snappy* and *thinks first* is real and intentional.

- **The proof artifact is the report.** The substrate "works" when a multi-run pass produces differentiated, attributable outcomes across personas — not when the engine merely runs to completion. Closing thresholds are a *floor* ("the substrate works and prompts matter"), not a balance ceiling.

- **Diagnostics target building agents first.** Logs, reports, the CLI introspection, and the replay raw-pane are designed for machine introspection; the overseer/replay UI is the user's human-intuition surface. Both consume the same canonical state, and a diagnostic that lies about the substrate is worse than no diagnostic — truthful attribution is a precondition for any behaviour-tuning pass.

- **POC posture.** While in POC, breaking schema and resetting state beats migration shims. Single forward shape, no backward-compat branches.

## 11. Current vision — graded gear & contested public objectives

Where the substrate is heading next, as intent (not an assignment record):

- **Crate vocabulary.** Agents natively prefer "crate" — they say it unprompted. The substrate's vocabulary should match the model's, the same way agents became named personas rather than `Player_N`. Closing that gap is pure agent ergonomics; it removes a translation burden from the scratchpad.

- **Gear is a graded scalar, auto-applied — never a loadout puzzle.** Weapons and armour are coarse single-number tiers (deterministic, hand-placed; roll-noise stays deferred to the RNG slice). The engine alone resolves equipment: looting a crate, corpse, or airdrop equips the item *only if it is strictly better* than what is held — otherwise the weaker item is discarded. Looting gear is therefore *only ever upside*: no equip decision, no bench, no ranking for the prompt to carry. Graded (not binary) tiers exist precisely so the **lootwhore is a viable, legible behavioural archetype** — greed and crate-contesting expressed through *risk and positioning*, not stat-sorting. The weapon number the agent sees is **DPS** (attack speed pre-factored in); any slow/med/fast *tempo* is render-only and never reaches the agent or the engine — equal DPS is mechanically identical, never an initiative axis. Armour is a **percentage** damage reduction capped strictly below 100%, so no agent is ever invincible — flat mitigation could zero out incoming damage and break attributable, terminating matches (pillar 1, §10). The only variance the catalog will ever carry is **textual** — the future pillar-5 cursed-item naming seam, a later deliberate content pass (the moderation tension in §12 must be designed for first). Because stats are auto-honest, a cursed item can only ever lie through its *name*, never its numbers — deception stays cleanly on the text surface.

- **The airdrop is a contested public objective.** Battle-royale convention: a crate is announced to *everyone* (a sky-telegraph — match-meta like the evac reveal, non-spatial, counts down in Vision per-entity), then lands as a normal local lootable. Mid-match drops are deliberately worth more than early ones; the latest drop lands under the incineration clock, so "late loot vs. extraction" becomes a prompt-authored gamble. This deepens prompt-authored behaviour (risk tolerance, greed, timing become legible in replay) — it doesn't just add tactical realism.

- **Telefrag is a discovered consequence, not a taught rule.** An agent standing where the crate lands is vaporised — no corpse, no gear, total erasure ("red mist"). Never in the schema or system prompt; learned by reading the global kill feed (pillar 5 — the outcome line is the discovery channel; pillar 1 — the death is squarely attributable to a prompt that ignored three turns of warning). Movement resolves first, then the crate spawns: an agent who *camped* the spot or *raced onto it* the spawn turn both pay. Frequency is a tuning knob (how close `toward` parks an agent to an inbound drop), not a designed-around damage vector — the intended discovery curve is "rare, funny, shareable," and that is measured, not assumed.

- **Honest attribution is a precondition.** A contested-objective mechanic that kills agents is only legible if the report says *who died how and to whom* — or to no one, for an environmental death. Per-persona kill credit and environmental deaths must be counted truthfully before any behaviour-tuning pass reads them.

## 12. Open questions / live tensions

Tracked here because they shape the why, not the how:

- **How much prompt-injection is fun vs. frustrating?** Cursed item names are great; player-authored item names risk passive spam.
- **Should the agent choose *what* to loot? — Resolved: no.** Considered and rejected by simplification. Multi-axis gear stats (range vs. damage vs. weight) were the only thing that would make a loot-pick interesting; they were cut as tactical-optimization noise on the wrong surface (it failed the §7 filter the same way crits and AP systems do). With graded single-scalar gear that the engine auto-applies, the choice collapses back to "always take the upgrade" — a no-brainer — so no agent loot-pick tool surface is built. The only loot-related decisions left are *whether a crate is worth the spatial risk* and *when to spend the single held consumable* (the §5 anchor). Consumables remain the recurring scarce currency and the one genuinely prompt-authored loot decision.
- **Does formal trade belong eventually?** Speech alone may be sufficient. Adding trade earns depth; loses minimalism.
- **Daily-seed mode as the sticky hook?** Possibly the leaderboard format that converts curiosity into return visits — and the natural home for the deferred RNG slice's seeding.
- **Guest → account conversion trigger.** "Save this idiot" is a candidate; not yet validated.
- **Content moderation vs. deception language.** Aggressive in-world text (threats, lies, corpse notes, prompt-injection inscriptions) is core to pillar 5, but the moderation layer is a real constraint on shippable content (the original "betrayer" archetype tripped Azure moderation and was swapped to "opportunist"). Worth a deliberate design pass before the cursed-item naming layer is authored.

---

*This document evolves as the user's understanding evolves. Update it whenever intent shifts, conflicts surface, or new insight reframes the why. It is the why layer only — keep assignment logs, closure records, ADRs, and current-state architecture out.*
