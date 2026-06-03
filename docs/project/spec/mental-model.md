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

- **The RNG slice is curated-pool seeded selection, not procedural generation (ratified).** When the RNG slice lands it picks among a pool of *hand-authored* maps (and permutes loot/spawns on top) rather than procedurally placing geometry. Each map in the pool stays an individually authored, diagnosable reference — a regression reproduces by re-seeding that map. Full procgen is rejected on the §7 filter: it buys tactical variance that mostly fails the "deepens *prompt-authored* behaviour" test, while a curated pool delivers the real payoff (prompts cannot overfit one fixed layout) at a fraction of the engine surface. The **map pool is the first brick** and is built *before* the RNG-selection logic: a hand-authored asymmetric pool, exercised on its own, is the render/test-fixture layout-coupling canary that lets the consumer-render era proceed provably layout-agnostic. Maps in this first pool are deliberately asymmetric and *un-tuned* — their purpose is *variety* (anti-overfit + coupling canary), not balance; map taste/balance is a deferred, separate later loop.

- **The consumer-render era is gated by the player-facing layer, which is deferred — the overseer/replay is not that era.** The §12 player-facing stack (accounts, player-facing card authoring, the matchmaking facade) is the "how do other people get involved" layer and is intentionally parked until it is needed. The personal overseer / replay surface is an *internal diagnostic DB-wrapper* (machine-introspection-first, §10 "diagnostics target building agents first"), **not** the consumer-render phase — so building it does not trip the §10 "RNG before consumer render" ordering. That ordering bites only when the *external player-facing* surface is built.

- **Prompt economy is a design constraint, not a style.** Each turn is one small, snappy LLM call: a tight rolled context (rules, persona, scratchpad, visible-state digest) returning one compact tool call. Sprawling prompts make turns slow, calls expensive, persona differentiation muddier. Tokens earn their keep by changing what the agent might do.

- **Reasoning is on, at a small budget.** The agent must deliberate over visible state before committing. Reasoning off collapses persona signal and breaks attribution. The tension between *snappy* and *thinks first* is real and intentional.

- **The proof artifact is the report.** The substrate "works" when a multi-run pass produces differentiated, attributable outcomes across personas — not when the engine merely runs to completion. Closing thresholds are a *floor* ("the substrate works and prompts matter"), not a balance ceiling.

- **Diagnostics target building agents first.** Logs, reports, the CLI introspection, and the replay raw-pane are designed for machine introspection; the overseer/replay UI is the user's human-intuition surface. Both consume the same canonical state, and a diagnostic that lies about the substrate is worse than no diagnostic — truthful attribution is a precondition for any behaviour-tuning pass.

- **POC posture.** While in POC, breaking schema and resetting state beats migration shims. Single forward shape, no backward-compat branches.

### 10.1 Breadth-sampling discipline

- **R&D samples breadth before consolidating, recursively on finer axes.**
  A pre-gate R&D probe explores by *sampling* — distinct candidate options
  side by side — before any *curation* pass picks a lane. Inconsistency
  across slots is the data the user reads to choose a direction; premature
  consolidation destroys that signal. Consolidation is a deliberate later
  round, not the next-obvious move once breadth lands. The pattern is
  recursive: once one axis consolidates, the next finer axis becomes
  breadth-able in turn. Each loop is *sample → evaluate side-by-side in the
  showroom → consolidate → reveal the next axis*.

- **Signal legibility is the real discipline, not a literal
  one-axis-per-round rule.** The user's pick must stay attributable — you
  must be able to tell which variable produced the effect. *Coupled* axes,
  where mixing muddies attribution, move one at a time. *Independent* axes
  that the viewing surface can isolate on demand may be sampled
  **concurrently**: skin, gore, weapons, and armour are orthogonal surface
  treatments the showroom toggles à la carte, so the user separates their
  signals at view-time rather than across rounds.

- **A consolidated axis is locked, not implicitly re-opened.** Once the user
  picks a lane (e.g. the substrate body), later rounds do not silently
  re-open it to manufacture variety. Re-opening a locked axis is a
  deliberate, named decision — never the accidental byproduct of a round
  nominally about a finer axis. Surface-treatment rounds keep the body fixed
  and vary only the adhering layer (§13).

- **Locking a winner preserves the validated *instance*, not just the
  technique label.** What gets locked is the exact artifact the user saw and
  approved — the specific texture, the specific mark set, the specific death
  pose — not the category name it belongs to. Re-deriving the look from the
  label in a later round ("everyone now uses the uv-painted approach")
  homogenizes the personas and throws away the distinctive thing the user
  actually chose. And a fix to one property (e.g. extending a texture to cover
  the whole body) must never regress a separately-validated property (the
  texture's richness, the personas' distinctiveness). Preserve-then-extend;
  never rebuild-from-label.

- **Breadth needs a dedicated viewing surface.** Once breadth-sampling
  is wide, chasing comparison moments in replay scrubs does not scale
  — the user cannot reliably evaluate 8 personas × N animation states
  × M equipment tiers by waiting for the right moment to occur in a
  match. The R&D throwaway grows a **showroom / playpen** companion
  surface alongside replay: stable side-by-side display of every
  sampled asset, on-demand triggers for every animation state, and
  on-demand equipment swaps — so curation decisions are made under
  controlled conditions rather than chance. The showroom is a
  *curator's diagnostic* (the user *is* the building agent for the
  asset-curation loop, per §10's "diagnostics target building agents
  first"); it is not a player-facing surface and is not the consumer-
  render era.

- **Sourced inventory before engineer-procedural authoring.** When an asset
  category fails user evaluation, the next move is **CC0 pack research**, not
  better procedural generation. Breadth-sampling *techniques* assumes a
  baseline of *real-looking* assets; engineer-generated procedurals dampen
  the technique signal to noise. Procedural authoring is a fallback when no
  sourced CC0 option exists for a category, not the default.

## 11. Current vision — graded gear & contested public objectives

Where the substrate is heading next, as intent (not an assignment record):

- **Crate vocabulary.** Agents natively prefer "crate" — they say it unprompted. The substrate's vocabulary should match the model's, the same way agents became named personas rather than `Player_N`. Closing that gap is pure agent ergonomics; it removes a translation burden from the scratchpad.

- **Gear is a graded scalar, auto-applied — never a loadout puzzle.** Weapons and armour are coarse single-number tiers (deterministic, hand-placed; roll-noise stays deferred to the RNG slice). The engine alone resolves equipment: looting a crate, corpse, or airdrop equips the item *only if it is strictly better* than what is held — otherwise the weaker item is discarded. Looting gear is therefore *only ever upside*: no equip decision, no bench, no ranking for the prompt to carry. Graded (not binary) tiers exist precisely so the **lootwhore is a viable, legible behavioural archetype** — greed and crate-contesting expressed through *risk and positioning*, not stat-sorting. The weapon number the agent sees is **DPS** (attack speed pre-factored in); any slow/med/fast *tempo* is render-only and never reaches the agent or the engine — equal DPS is mechanically identical, never an initiative axis. Armour is a **percentage** damage reduction capped strictly below 100%, so no agent is ever invincible — flat mitigation could zero out incoming damage and break attributable, terminating matches (pillar 1, §10). The only variance the catalog will ever carry is **textual** — the future pillar-5 cursed-item naming seam, a later deliberate content pass (the moderation tension in §12 must be designed for first). Because stats are auto-honest, a cursed item can only ever lie through its *name*, never its numbers — deception stays cleanly on the text surface.

- **The airdrop is a contested public objective.** Battle-royale convention: a crate is announced to *everyone* (a sky-telegraph — match-meta like the evac reveal, non-spatial, counts down in Vision per-entity), then lands as a normal local lootable. Mid-match drops are deliberately worth more than early ones; the latest drop lands under the incineration clock, so "late loot vs. extraction" becomes a prompt-authored gamble. This deepens prompt-authored behaviour (risk tolerance, greed, timing become legible in replay) — it doesn't just add tactical realism.

- **Telefrag is a discovered consequence, not a taught rule.** An agent standing where the crate lands is vaporised — no corpse, no gear, total erasure ("red mist"). Never in the schema or system prompt; learned by reading the global kill feed (pillar 5 — the outcome line is the discovery channel; pillar 1 — the death is squarely attributable to a prompt that ignored three turns of warning). Movement resolves first, then the crate spawns: an agent who *camped* the spot or *raced onto it* the spawn turn both pay. Frequency is a tuning knob (how close `toward` parks an agent to an inbound drop), not a designed-around damage vector — the intended discovery curve is "rare, funny, shareable," and that is measured, not assumed.

- **Honest attribution is a precondition.** A contested-objective mechanic that kills agents is only legible if the report says *who died how and to whom* — or to no one, for an environmental death. Per-persona kill credit and environmental deaths must be counted truthfully before any behaviour-tuning pass reads them.

## 12. Player-facing meta — the card, the matchmaking facade, seasons

The substrate's first life keys everything to 8 fixed personas (§10). The product's
real persistent unit is different. This section is the why for the player-facing layer.

- **The card is the unit, not the account.** A card is *more than a saved prompt*:
  an agent name, a prompt, and a build — level/progression and (coming soon)
  unlockable prompt segments — that **evolves as it plays**. A user/account is an
  optional ownership-and-evolution wrapper around cards; a card *may or may not*
  carry a user ref. **The ranked unit is the card.** Ownerless cards (guest cards,
  forkable presets, handcrafted backfill) are first-class — the card substrate must
  be coherent with no account attached. Accounts come *after* cards; the card stands
  alone first.

- **Presets are forkable on-ramps, deliberately vanilla.** The current 8 personas are
  throwaway scaffolding — fine to start, expected to change. Their product role is
  the guest entry point and a fork base, not a balance target. The closed 8-persona
  substrate harness (§10) and the open card pool are two different consumers of the
  same engine; growing the card layer must not break the substrate-proof harness.
  A card's persona *lineage* is an **internal engine-substrate adapter** — the
  persona slot the still-locked-union engine requires on every character
  (kill-attribution, per-persona aggregation) — *not* a player-meaningful
  attribute; the card's actual mind is its own prompt. That lineage is currently
  a mandatory choice in the personal overseer is **accepted, not a defect**,
  while that surface is the user's own diagnostic tool rather than an external
  player-facing one. The genuine pillar-6 fix — decoupling card identity from the
  locked persona union through kill-attribution and aggregation — is deferred
  until a real player-facing card-authoring surface exists; only then does the
  leak actually bite.

- **The matchmaking lobby is theatre.** Final-form UX: pick a card, refine, start
  matchmaking, a ≤30s "searching" loader, lobby fills with 8, a ~10s countdown with
  agents trash-talking, match starts. None of that reflects what happens. On commit
  the backend draws cards from the pool and runs the match *immediately*; the
  searching/fill/countdown exists to (a) mask backend compute so the replay streams
  without a buffer race, and (b) sell live-multiplayer fantasy over an **asynchronous
  card draw**. The honesty underneath the trick: the opponents *are* real other
  users' cards — just not live. This is *passive multiplayer*. Genuine concurrent
  matchmaking is deferred until there is concurrent-user scale to justify it; the
  facade is what makes single-player-shaped traffic feel populated until then.

- **Everyone is a card; difficulty is curated, not human-vs-bot.** There is no
  integrity axis between "human" and "bot" opponents — every competitor is an
  autonomous prompt-creature regardless of authorship, which is the whole premise
  (§1, §3). The lever is *curated difficulty*: handcrafted "unhinged" challenge
  cards backfill empty pool slots; vanilla presets are gentle on-ramps. Opponent
  strength is a content/curation knob, not a matchmaking-fairness problem.

- **The leaderboard is disposable; seasons are the reset valve.** Scoring keeps the
  §5 model (fixed prize pool, equal split among extractors, 100 to last-agent-
  standing) and ranks on prize-per-match — the denominator counts *every* match the
  card was drawn into, win or turn-2 death, because that ratio *is* prompt quality
  and can't be out-grinded (pillar 1). But the formula is an experiment, not a
  contract: when it's gamed or corrupted, wipe and rebalance under a new **season**.
  The design is freed from getting scoring perfect up front (consistent with §10's
  POC posture).

- **Ranked metric vs. vanity.** Prize-per-match is the one ladder that defines skill.
  K/D is a play-style signal that may graduate to a *parallel* ladder. Wall
  face-slams and their kin are shareable comedy stats (pillar 5; the §5 best-failure
  shareability), never progression.

## 13. The consumer replay render — slick spectacle, honest diagnosis

The player-facing replay (distinct from the internal overseer/diagnostic
surface, §10) has a ratified art direction: **cyberpunk × Diablo** — dark,
neon, moody, spectacle-forward. Its job is **shareable theatre (§12) and
legible diagnosis (§5) at once**; these don't conflict because different
layers carry them.

- **Diagnosis sits on a side pane**, not on the 3D scene — equipment, the
  scratchpad rendered as the agent's *thoughts*, speech as a chat log, the
  card prompt unfolding against the action. **Render = ground truth, full
  stop.** The consumer replay does **not** model agent vision, fog, or
  last-known intel: anchored to a character the camera *follows* them, but
  the scene still shows every entity, wall, and crate. Perception inspection
  (LOS, fog, last-known intel) is *not* on this surface — it lives in the
  overseer/diagnostic surface (§10), whose Vision-faithful grid views are
  built for it. The consumer renderer's job is spectacle + legible action
  attribution, not perception emulation — the load-bearing separation
  between the two replay modalities (pillar 8).
- **"Slick" is a pipeline property, not an asset-fidelity arms race.** It
  comes mostly from lighting, postprocessing, VFX, and camera — not
  hand-modeled art. The render is never blocked on an art budget;
  sourced/stylized assets suffice and self-modeling is out. The signature
  shareable beat is the airdrop **telefrag → red mist** (§11) — a VFX/camera
  moment, not a modeling one. **Operationalising "slick is pipeline" means
  *using* the pipeline:** spectacle must speak the substrate's native
  language — **decals** for surface marks (blood, scorch, signs), **material
  swaps** for state changes on existing meshes (armour tier as a
  metallic/emissive shift on the body, not a separately-attached floating
  mesh), **particles and postprocess** for impacts, and **textured PBR** over
  base geometry for walls/cover/floor (never flat single-colour blocks).
  Spawning a new entity-mesh as a stand-in for what should be a
  material/decal/particle effect is a renderer smell — it makes visual state
  look like *more objects in the scene* rather than properties of the objects
  already there, and breaks the felt experience the pipeline is meant to
  carry.
- **Skeletal animation is part of the spectacle floor, not polish.**
  Walking, attacking, looting, and idling must drive a **rigged skeleton**
  with clip selection per engine event; limbs must visibly move. Static-pose
  translation, whole-body-tilt attacks, and rigid sliding figures cannot be
  compensated for by lighting/material/VFX work elsewhere — they are the
  dominant felt-experience signal, and a missing rig is visible from the
  first second. Sourced rigged character packs with anim clips are the
  operational answer; sourced-not-modeled.
- **Renderer respects engine resolution order within a turn.** The engine
  resolves a turn as **movement first, then actions** (attacks/loots/equips/
  death). The renderer plays it back in that order: the move animation
  completes (or substantially completes) before loot/gore/attack visuals
  fire. This sequencing is *implicit in the snapshot* — movement and action
  events are separate arrays in engine-resolution order, with no within-turn
  timestamp required. A renderer that batches every event at t=0 is a
  renderer bug, not a contract gap. Honest within-turn sequencing is
  load-bearing for §5 attribution: the user must see the move that *led to*
  the loot, not the loot detached from its cause.
- **Camera intent:** a follow-anchor on the player's card with free orbit;
  the "director" view is the same camera with the anchor released — one
  system, not two.
- **Audience positioning — niche art, not mass-market mobile.** The §8
  audiences remain accurate. Mass-market mobile compatibility is *not* a
  load-bearing constraint on substrate choice — desktop is the assumed
  primary surface, mobile acceptable where it works but not a hard floor.
  The product is niche art that does not promise every-device reach.
- **Substrate direction: a WASM-compiled engine (Godot) as the renderer.**
  The visual ceiling of a real game engine — "like a game that could have
  physics" rather than "like CSS transitions" — is the "slick is pipeline"
  advantage made concrete, and under the niche-art positioning the cold-load
  cost is not load-bearing. The pillar-7 interop tax stays small: a single
  snapshot-shape sync at the load boundary plus a schema-version check on
  load, not per-frame plumbing — the renderer pulls the match as a whole
  rather than streaming per-frame state.
- **Renderer / data architecture: single code path, two cases.** The
  renderer subscribes to the canonical match document and plays back from a
  **local cache that grows under it**. Re-watched completed matches arrive
  whole on the first response; just-finished matches arrive as an initial
  slice plus appends as the backend completes subsequent turns. The
  renderer's clock owns pacing in both cases — the bridge merely appends new
  turn data. The §12 matchmaking theatre exists to keep **backend
  turn-production ahead of renderer playback**, so the playback clock never
  blocks on the network in practice. Catch-up to the production edge is the
  recognised failure mode and a §12 theatre-tuning concern, not an
  architectural one. Free side-effects: backward scrubbing is trivial,
  forward scrubbing is bounded by what is loaded, network blips are invisible
  until playback catches the production edge.
- **The match-data contract escapes throwaway.** Whatever renderer is in
  play — R&D prototype, future consumer surface, the existing diagnostic —
  reads the canonical match document through one **small Convex read
  surface** that returns it in the established replay-snapshot shape. The
  React replay's reconstruction logic is the source of truth; the Convex
  surface wraps or ports it — renderers do **not** carry their own
  reconstruction copies. This is the load-bearing detail: prototypes come
  and go, the contract stays.
- **Completed-only is the first probe; subscribe-and-cache is the full
  form.** The R&D full-match render exercises only the simpler case:
  re-watch a finished match via plain HTTP fetch against the contract above.
  The subscribe-and-cache live-streaming half is deferred until the
  player-facing matchmaking surface (§12) exists and there is something live
  to watch. The HTTP-fetch path is a strict subset of the eventual
  subscription path (same shape, same reconstruction), so it carries forward
  without rework.
- **Renderer reads engine-emitted truth; never duplicates engine logic.**
  Pillar 6 extends to the renderer: the engine owns geometry/path arithmetic
  so the *render* doesn't have to. When the engine slides a character along a
  wall, the snapshot exposes the *actual waypoint sequence* taken, not just
  start+end — the renderer animates along the waypoints rather than
  re-implementing pathing to make the visual line up. The same posture
  governs every spectacle event (attacks, loots, movement waypoints,
  wall-blocked annotations). Renderers are projection surfaces, not gameplay
  reasoners; a renderer that does its own pathing is a bug. Adding new
  spectacle event streams is a substrate change on the engine's side with a
  forward-only schema bump (§10 POC posture), not a renderer-internal concern
  — old throwaway prototypes broken on bump is acceptable; real consumer
  surfaces read the latest schema.
- **Gore intensity is loud by design.** The niche-art positioning licenses
  spectacle that does not chase mass-market comfort floors. Telefrag → red
  mist is the floor, not the ceiling: per-attack blood, dismemberment,
  persistent pools, screen-shake on heavy hits — VFX-pipeline work, but
  unapologetic. The Diablo half of "cyberpunk × Diablo" carries this;
  diagnosis stays clean on the side pane (pillar 1, §5 attribution preserved)
  while the scene is free to be operatically violent.
### 13.1 The substrate body and the adherence problem

- **The substrate body is locked.** There is one consolidated character
  body — the single skinned mesh the engine animates for every agent
  (currently the mesh2motion base). It is **not** re-opened as a breadth
  axis to manufacture showroom variety. In a match an agent has one
  persistent body; its gore, armour, and weapon appear as **dynamic state
  changes on that body** (§11 graded gear), never as a swap to a different
  model. Substituting whole foreign character packs to look varied is a dead
  end — it sidesteps the real problem and produces variety that can never
  become render code.

- **Adherence is the load-bearing problem for skinned characters.** Surface
  decorations (gore, decals, armour, painted regions) that work on a static
  mesh do not automatically follow skeletal deformation. Cracking adherence
  *on the locked body* — not body substitution — is the work. Surface-
  treatment R&D rounds keep the body fixed and breadth-sample only the
  adhering layer; the showroom must demonstrate **adherence to the locked
  body**. Because skin, gore, weapons, and armour are independent layers the
  showroom toggles à la carte, a single round can sample all four at once
  without losing signal (§10.1).

- **Each spectacle category picks the adherence approach that fits its
  physics, and breadth-sampling has settled most lanes.** **Rigid items**
  (weapons, helmets, armour plates) attach to a **live skeleton bone** and
  follow it through animation — a static root socket or single static bind
  leaves them floating/detached, so dynamic bone-follow is the confirmed lane;
  they accept protrusion rather than true wrapping, and the source asset is
  scaled to fit the body. **Whole-body state changes** (death pose,
  dismemberment, charred-skin recolour) use a baked mesh/material variant.
  **Skin** is settled on UV-painted texture on the skinned body — it must
  cover the **whole body**, not just deform-zones, and depends on well-laid-out
  UVs (a bone-pinned sticker decal slides and floats instead). **Gore** reads
  best as **many small, localized, individual marks**, not one broad region —
  density/count scales for intensity. A flat **adhering region with no
  thickness** was trialled for both gore and armour and fits neither: armour
  needs real prop geometry (the rigid bone-attached piece above), gore needs
  discrete marks. The approach is chosen per category by physical semantics,
  not one technique forced everywhere.

- **Idea bank — techniques whose flaws are someone else's features.** A
  technique that fails on the character body can be ideal elsewhere:
  world-space-projected mapping "slides" on a deforming body but makes
  **cover** surfaces shimmer attractively as units move through them; flat
  pinned decals fail to wrap a body but point toward **armour** if done as a
  true surface-conforming projection or a UV-painted region; and the glowy
  floating sticker-decal that failed as **skin** (it hovers off the body
  instead of wrapping) is a natural **energy / forcefield armour** shell —
  precisely *because* it floats and glows. Bankable insights for where a
  technique meets its proper application surface — not current-round work.

- This whole surface stays **§10-gated**: the consumer-render era, sequenced
  *after* the map pool and RNG slice. R&D de-risked the substrate direction;
  it does not bypass the sequencing gate.

## 14. Open questions / live tensions

Tracked here because they shape the why, not the how:

- **How much prompt-injection is fun vs. frustrating?** Cursed item names are great; player-authored item names risk passive spam.
- **Should the agent choose *what* to loot? — Resolved: no.** Considered and rejected by simplification. Multi-axis gear stats (range vs. damage vs. weight) were the only thing that would make a loot-pick interesting; they were cut as tactical-optimization noise on the wrong surface (it failed the §7 filter the same way crits and AP systems do). With graded single-scalar gear that the engine auto-applies, the choice collapses back to "always take the upgrade" — a no-brainer — so no agent loot-pick tool surface is built. The only loot-related decisions left are *whether a crate is worth the spatial risk* and *when to spend the single held consumable* (the §5 anchor). Consumables remain the recurring scarce currency and the one genuinely prompt-authored loot decision.
- **Does formal trade belong eventually?** Speech alone may be sufficient. Adding trade earns depth; loses minimalism.
- **Daily-seed mode as a sticky hook? — reframed.** The §12 matchmaking facade is now the primary stickiness mechanism (pick a card, "find a match", watch the replay). Daily-seed becomes a possible *mode* and a natural home for the deferred RNG slice's seeding, not the core hook.
- **Guest → account conversion trigger. — reframed.** Cards exist ownerless (§12); the account is the evolution/ownership wrapper, not a prerequisite to play. The conversion moment is therefore "keep evolving this card" rather than "save this idiot"; the exact trigger is still unvalidated.
- **Content moderation vs. deception language.** Aggressive in-world text (threats, lies, corpse notes, prompt-injection inscriptions) is core to pillar 5, but the moderation layer is a real constraint on shippable content — an over-aggressive archetype can trip the endpoint's moderation filter. Worth a deliberate design pass before the cursed-item naming layer is authored. The direction is known: relaxing the endpoint filter measurably helps, so it's a tunable lever, not an unbounded unknown. Text-as-terrain is confirmed *polish* (a later content pass), not a blocker.

---

*This document evolves as the user's understanding evolves. Update it whenever intent shifts, conflicts surface, or new insight reframes the why. It is the why layer only — keep assignment logs, closure records, ADRs, and current-state architecture out.*
