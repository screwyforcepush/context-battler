# Architecture — context-battler

> The system-shape layer. Names the concrete tech, owns the cross-cutting decisions, and explains why each piece is the right fit.
> The *why* lives in `mental-model.md`. Game mechanics live in `concept-spec.md`. Operational details live in `docs/project/guides/`.

---

## 1. The principle — three slices, one contract

context-battler is built as three independent slices that meet only at the data:

```
┌──────────────┐       ┌──────────────┐       ┌──────────────┐
│   ENGINE     │       │    STATE     │       │   RENDERER   │
│  (anywhere)  │ ────▶ │   (Convex)   │ ◀──── │   (web)      │
│  reads /     │       │   canonical  │       │  subscribes  │
│  writes      │       │   game data  │       │  to queries  │
└──────────────┘       └──────────────┘       └──────────────┘
```

- **State is the contract.** The Convex schema (characters, prompts, character state, world state, turn ledger) is the moat. Anything else can be rewritten.
- **Engine and renderer never call each other.** They both talk to State. The engine doesn't push events to the client; the client subscribes to data the engine wrote.
- **Any slice is replaceable.** Rewrite the engine in Rust, swap the renderer for native, migrate state to a different backend — the contract is the schema, not the runtime.

This is the load-bearing decision under everything else in this document. It is also the seventh pillar in `mental-model.md` §6.

## 2. Phase 1 stack

Locked for the simulation-proving phase:

| Slice | Tech | Why |
|---|---|---|
| LLM | Azure OpenAI (Responses API) | Already provisioned. See `guides/azure-llm.md` for endpoint, auth, tool-use shape. |
| State | Convex | Reactive queries, transactional writes, scheduled actions, near-zero infra. See `guides/convex-backend.md`. |
| Engine | **Convex actions** (TypeScript) | Co-located with state, free turn-pacing via scheduler, no extra deploy target. |
| Renderer | **Not in phase 1.** | Phase 1 has no UI. Replays are inspectable directly via Convex queries / CLI. |

## 3. Engine — why Convex actions

For phase 1, running the engine as Convex actions is the highest-fit answer, not a compromise:

1. **State reads/writes are transactional and colocated.** The engine is fundamentally read-current-state → call LLMs → resolve → write next state. Running inside Convex means no consistency window between "engine resolved turn 4" and "client sees turn 4."
2. **Turn pacing is natively expressible.** `scheduler.runAfter(0, advanceTurn, { matchId })` chains turns. No external orchestrator, no cron, no queue.
3. **LLM calls fit the action model.** Convex actions can call out over HTTP, so the Azure call lives inside the same function. Each turn = one action, well within Convex's 10-minute action timeout.
4. **Per-turn fan-out is cheap.** A turn calls N LLM endpoints (one per agent) in parallel via `Promise.all` over `fetch`. Per-turn wall-clock = max LLM latency, not sum.
5. **Zero extra infra during substrate-proving.** `npx convex dev` is the entire developer loop.
6. **Lock-in is low.** The schema is the moat; the runtime is replaceable. If perf, determinism, or polyglot needs ever push the engine out of Convex, the schema stays.

**Gotcha:** Convex functions don't see local `.env`. The Azure key must be set on the deployment via `npx convex env set AZURE_API_KEY ...`. (See `guides/convex-backend.md` §6.)

**Gotcha:** Each turn is a fresh stateless LLM call. Do **not** use the Responses API's `previous_response_id` to chain across turns — that would smuggle hidden conversation history past the scratchpad-only-memory invariant. `previous_response_id` is fine within a single turn (e.g., tool-result roundtrips); it must not span turns. (See `guides/azure-llm.md` §7.)

## 4. State — Convex schema (conceptual)

The schema is the contract, so it deserves naming up front. Concrete shape evolves in the codebase; the high-level entities are:

- **`matches`** — match metadata: settings, current turn, status, winners, prize-split outcome.
- **`characters`** — agent records: display name, owner, behavioural prompt, equipped gear, HP, position, scratchpad, hidden state, alive/dead.
- **`turns`** (the turn ledger) — one record per (match, turn). Captures the visible-state shown to each agent, the decision returned, the resolved diff. The ledger *is* the replay.
- **`worldState`** — terrain, cover, crates, corpses; whatever isn't agent-local.

Two non-obvious properties:
- **The turn ledger is the replay.** The renderer doesn't "render the engine" — it renders the ledger. This is what makes engine/renderer decoupling work.
- **Per-agent visible-state is persisted, not recomputed at render time.** Cheap, deterministic, debuggable. A replay always shows the player exactly what their agent saw, not what we recompute later.

## 5. Renderer (phase 2 — not yet locked)

Loose preference: **web client**, subscribing to Convex queries.

- Browser → Convex `useQuery(...)` over `turns` for a match → reactive replay updates as the engine advances.
- Wall-clock pacing of replay is a *renderer* concern (slow scrub, fast-forward, frame-by-frame). The engine writes turns at LLM speed; the renderer plays them at whatever cadence makes the moment legible. This is exactly §1 in action.
- Web is preferred because zero-install access matches the guest-mode flow ("pick a card, type a sentence, watch what happens").

Tech choice (React, Svelte, plain Canvas, etc.) is deferred until phase 2 is being cooked.

## 6. Explicit non-decisions

Calling these out so they don't get argued prematurely:

- **Renderer framework.** Deferred to phase 2.
- **Auth, accounts, leaderboards.** Convex has primitives; not phase 1.
- **Multi-region, scaling.** N/A until there's traffic.
- **Monitoring / observability.** Convex logs are sufficient for phase 1. Revisit if/when the engine moves out of Convex.
- **Determinism / replay-equivalence under engine rewrites.** Stated as a future-proofing claim, not a phase-1 requirement.
- **Prompt caching.** The Azure Responses API supports caching; treat it as future optimization, not a load-bearing assumption (`concept-spec.md` §2A.5).

## 7. When this document changes

- Engine moves out of Convex actions → §3 rewrite, plus a migration note.
- Schema entities change shape → §4 update.
- Renderer tech is chosen → §5 update.
- A new slice is added (e.g., a separate match-orchestrator service) → §1 diagram update.

This document captures the *system shape*, not the *system code*. Update it when the shape changes, not when implementations evolve within a slice.
