# Round-3 Closing Readout — Full-Match Godot/WASM Replay

Round 3 of the render R&D. Substrate was ratified in Round 2 (Godot/WASM). This round drove a **real completed match end-to-end** inside Godot from a live Convex HTTP endpoint, exercising the full data-driven pipeline: match picker, all 5 maps, dual cameras, scrubbable timeline, FPS kill feed, anchored sidebar, and ground-truth render. Commit `bb87176`.

Spec: [`full-match-godot-spec.md`](./full-match-godot-spec.md). Blind-UAT handoff: [`IMPLEMENTATION-SUMMARY.md`](../../../throwaway-prototypes/d-full-match/IMPLEMENTATION-SUMMARY.md).

---

## 1. What Was Built

Two layers, deliberately separated by throwaway boundary:

| Layer | Throwaway? | Location | Purpose |
|---|---|---|---|
| **Convex match-data contract** | No — escapes throwaway | `convex/http.ts`, `convex/replay/` | Canonical read surface for any renderer. 2 HTTP endpoints + reconstruction ownership flip. |
| **Godot full-match prototype** | Yes | `throwaway-prototypes/d-full-match/` | Felt-experience probe: full match playback, dual cameras, sidebar, kill feed, 5-map support. |

### 1a. Convex match-data contract (escapes throwaway)

- `GET /replay/listMatches` — returns `MatchSummary[]` for completed matches. Server-side character fan-out via `listMatchesWithCharacters` query (D11). Sorted desc by `completedAt`, capped at 100.
- `GET /replay/exportMatch?matchId=<id>` — returns `MatchSnapshotJson` (schemaVersion 2). Full turn walk, kill feed, speech log, agent traces, per-turn equipped/hp, outcome.
- `OPTIONS /replay/*` — CORS preflight. `Access-Control-Allow-Origin: *` on all responses (POC posture).
- HTTP error semantics: 400 (missing/malformed matchId), 404 (not found), 409 (not completed), 200 (success). All with CORS headers.

### 1b. Godot full-match prototype (throwaway)

- In-Godot match picker calling `/replay/listMatches` via HTTPRequest.
- Full snapshot loader calling `/replay/exportMatch`.
- Data-driven 3D scene from `snapshot.map`: walls, cover, evac zone, crates, airdrops. All 5 maps render from the contract with no per-map code path.
- Playback clock: play/pause, backward/forward scrub, 0.5x/1x/2x speed selector.
- Director camera (free-roam orbit/pan/zoom) + anchored camera (follow selected character, cyclable through alive/dead/extracted).
- Right-side panel: director summary in FREE mode; anchored Identity/Equipment/Scratchpad/Prompt/Speech sections.
- Top-right FPS-style kill feed overlay, rebuilt correctly on scrub-backward.
- Ground-truth render: no fog, no LOS, no ghost markers, no perception overlay.
- No 3D speech bubbles (sidebar-only speech, per Gherkin).
- Cyberpunk x Diablo neon visual baseline inherited from `c-godot-wasm` Round-2 polish (dark arena, neon lighting/materials, custom loader, red environmental-death mist).

---

## 2. What Escapes Throwaway vs. What Is Throwaway

### Escapes throwaway (production code)

| Artifact | Path | Role |
|---|---|---|
| HTTP router + 2 replay endpoints + CORS | `convex/http.ts` | Match-data contract entry point |
| Snapshot builder (`buildMatchSnapshot`) | `convex/replay/snapshot.ts` | Pure function: `ReplayBundle` + `MapDescriptor` → `MatchSnapshotJson` |
| Summary projector (`summariseJoinedMatch`) | `convex/replay/snapshot.ts` | `MatchWithCharacters` → `MatchSummary` |
| Contract types | `convex/replay/snapshotTypes.ts` | `MatchSnapshotJson` (schemaVersion 2), `MatchSummary`, `MatchWithCharacters` |
| Reconstruction logic (moved) | `convex/replay/reconstruct.ts` | Single source of truth, ported from `apps/replay/src/lib/` |
| Re-export shim | `apps/replay/src/lib/reconstruct.ts` | One-line `export *` — keeps existing `apps/replay` imports working |
| `listMatchesWithCharacters` query | `convex/replay.ts` | Server-side character fan-out for the picker |
| Unit tests (18 cases) | `tests/convex/replaySnapshot.test.ts`, `tests/convex/http.test.ts` | 10-case builder matrix + 8 HTTP route cases |
| ESLint ignore for throwaway dist | `eslint.config.mjs` | Prevents lint noise from generated prototype output |

### Throwaway (R&D only, will be deleted)

| Artifact | Path |
|---|---|
| Entire Godot prototype | `throwaway-prototypes/d-full-match/` |

The prototype has zero imports from production code. It consumes the contract via HTTP only. Deleting the `d-full-match/` directory has zero production impact.

---

## 3. Shape of the Contract

### `MatchSnapshotJson` (schemaVersion 2)

Defined in `convex/replay/snapshotTypes.ts`. Conforms to the canonical `throwaway-prototypes/shared-harness/replay-snapshot.json` fixture shape. Additive extensions over the Round-1/2 fixture:

| Field | Source | Notes |
|---|---|---|
| `schemaVersion: 2` | Literal | Bumped from implicit 1 to track additive fields |
| `source` | `bundle.match` | matchId, mapId, completedAt, rngSeed |
| `playback` | Derived | turnCount, secondsPerTurn (0.6 default), sliceDurationSeconds, fpsHint (60), startTurn (1), endTurn |
| `map` | `MapDescriptor` + `worldState` | walls/coverClusters from worldState; evac.zone from MapDescriptor (worldState has no zone — D12); evac.centre/revealedAtTurn from worldState |
| `characters` | `bundle.characters` + `promptsLookup` | Includes resolved system/persona prompt text, cardId |
| `timeline.frames[]` | `reconstruct(bundle, t)` for t=1..turnCount | Each frame carries `snapshot` (EntitySnapshot) + `equippedByCharacter` + `hpByCharacter` from `agentRecords.input.status` |
| `killFeed` | Turn walk + `isDamageAction` from `killAttribution.ts` (D8) | Handles attack, overwatch, counter kills + environmental deaths |
| `speechLog` | `resolution.speech` flattened | Per-turn, per-character, with heardBy[] |
| `agentTraces` | `agentRecords` projection | scratchpadBefore/After, decisionSay, reasoning |
| `outcome` | `bundle.match.outcome` | `pointsByCharacter` keeps schema `{id, points}` (D9); `lastSurvivor` coerces `undefined → null` |

**Dead-character carry-forward (D13).** When a character dies or extracts, `agentRecords` stops carrying their row. The builder maintains a running `lastSeenStatus` map and fills `equippedByCharacter`/`hpByCharacter` from the last-seen values for absent characters. The `EntitySnapshot` invariant (D-P2-11: `.equipped`/`.hp` = null) is NOT violated — the carry-forward lives in the sibling fields only.

**Turn walk (D10).** Uses `turnRowByTurn` map. Frames emitted for turns 1..turnCount. Turn 0 is synthetic and NOT emitted.

### `MatchSummary`

Returned by `listMatches`. Fields: `matchId`, `completedAt`, `mapId`, `characterIds[]`, `characterCount`, `turnCount`, `outcome.extractedCount`, `outcome.lastSurvivor`. Server-side character join (D11) populates `characterIds` in a single round trip.

---

## 4. Reconstruction Ownership Flip

`apps/replay/src/lib/reconstruct.ts` → `convex/replay/reconstruct.ts`.

- **Before:** Reconstruction logic lived in the renderer (`apps/replay`). The engine's data flowed outward; the renderer shaped it.
- **After:** Reconstruction lives in `convex/replay/`. The engine owns reconstruction; renderers read the contract. Mental-model §13: "renderers do not carry their own reconstruction copies."
- **Shim:** `apps/replay/src/lib/reconstruct.ts` is now a one-line re-export: `export * from "../../../../convex/replay/reconstruct";`. No `apps/replay` callsite changes required. This is the ONLY `apps/` change in the assignment (D5-ratified narrow reading of "apps/ MUST NOT be touched").
- **Existing tests:** `tests/llm/inputBuilder.test.ts` and all other consumers of the old import path continue to work through the shim.

---

## 5. Pre-§10-Gate Posture Reminder

This round is **pre-§10-gate exploration**. The consumer-render era remains gated by the player-facing layer (§10, §12, §13). Specifically:

- The Godot prototype is throwaway. It does not constitute a consumer-render commitment.
- The match-data contract escapes throwaway and is load-bearing for any future renderer, but its existence does not bypass the §10 sequencing gate.
- The substrate direction (Godot/WASM, ratified Round 2) is a directional signal, not a locked-in production decision. The contract is renderer-agnostic by design (plain HTTP + JSON).
- The subscribe-and-cache live-streaming half (§13 "full form") is deferred until the player-facing matchmaking surface (§12) is built. The HTTP-fetch path is a strict subset of the eventual subscription path (same data shape, same reconstruction).

---

## 6. What the Next Render-Era Probe Could Be

Still §10-gated. These are directional possibilities, not commitments:

- **Subscribe-and-cache live playback.** The contract currently serves completed matches via HTTP fetch. The §13 "full form" subscribes to in-progress matches and appends turns into a local cache. This is the natural next probe once §12 matchmaking exists, but requires the player-facing layer to produce something live to watch.
- **Camera/pacing tuning pass.** The 0.5x/1x/2x speed selector and 0.6s secondsPerTurn are runtime-tunable knobs. A tuning pass against real match pacing feedback (from the user's blind UAT of this round) could refine defaults without new code.
- **Equipment-tier scene-level visuals.** Explicitly deferred (spec §7 Q7). Sidebar labels only for now. Scene-level mesh/material differentiation is a future polish item.
- **Audio layer.** Out of scope for all R&D rounds. A natural felt-experience addition if the consumer-render era proceeds.

None of these bypass the §10 gate. The next concrete step is the user's blind visual UAT of this round's prototype.

---

## 7. Blind Visual UAT

The user performs visual UAT themselves, post-closure, against [`throwaway-prototypes/d-full-match/IMPLEMENTATION-SUMMARY.md`](../../../throwaway-prototypes/d-full-match/IMPLEMENTATION-SUMMARY.md).

That document covers:
- What was built (feature inventory).
- Keyboard/mouse controls (`C` toggle, `[`/`]` cycle, orbit/pan/zoom, HUD play/pause/scrub/speed).
- Differences from `c-godot-wasm` (real match data vs scripted fixture, functional camera vs kill-cam, contract-driven sidebar/kill-feed vs scripted metadata).
- UAT focus areas: full-match playback, scrub coherence, camera modes, sidebar legibility, 5-map geometry, ground-truth confirmation.

No browsertools, Chromium, screenshots, or visual UAT artefacts exist in the work. Validation was lint + typecheck + build + tests (897 passed, 2 skipped) + scaffold checks (116 green) + Godot web export.

---

## 8. Validation Summary

| Check | Result |
|---|---|
| `npm run lint` | Clean |
| `npm run typecheck` | Clean |
| `npm run build` | Clean |
| `npm test` | 897 passed, 2 skipped |
| `npm --prefix throwaway-prototypes/d-full-match test` | 116 scaffold checks passed |
| `npm --prefix throwaway-prototypes/d-full-match run build` | Godot web export succeeded |
| Reviewer grep for fog/LOS/perception code | None found |
| Reviewer grep for browsertools/screenshot artefacts | None found |

---

## 9. Decision Trace

Key PM-ratified decisions that shaped this round (full record in spec §7):

| Decision | Summary |
|---|---|
| D5 | `apps/` boundary narrow reading: one-line re-export shim permitted. Port justified by §13 "wraps OR ports". |
| D6 | `secondsPerTurn=0.6` default + runtime 0.5x/1x/2x speed selector. |
| D7 | Snapshot conforms to canonical fixture shape (`timeline.frames` container). |
| D8 | Kill attribution reuses `convex/engine/killAttribution.ts::isDamageAction`. |
| D9 | `outcome.pointsByCharacter` keeps schema `{id, points}`; `lastSurvivor` coerces `?? null`. |
| D10 | Turn walk via `turnRowByTurn` map; turns 1..turnCount; turn 0 synthetic, not emitted. |
| D11 | `listMatches` joins characters server-side via `listMatchesWithCharacters`. |
| D12 | Evac merge: centre + revealedAtTurn from worldState; zone from MapDescriptor. |
| D13 | Dead-character carry-forward from last-seen `agentRecords.input.status`. |
