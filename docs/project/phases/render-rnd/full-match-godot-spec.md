# Full-Match Godot/WASM Renderer — Spec

> Pre-§10-gate exploration. Round-3 of the render R&D (post substrate
> ratification). Drives a real completed match end-to-end inside Godot,
> from a Convex HTTP endpoint that escapes throwaway as the de-facto
> match-data contract.

⭐ North Star ⭐ — Throwaway full-match Godot/WASM replay renderer —
completed-only, dual-camera, scrubbable, sidebar, FPS kill feed — fed by a
real Convex HTTP action that escapes throwaway as the de-facto match-data
contract.

🚫 **BLIND ASSIGNMENT** — No browsertools, no chromium UAT, no `uat` job.
Visual UAT is performed by the user themselves *after* assignment closure.
Validation = lint + typecheck + build + unit tests + reviewer judgment
against acceptance criteria. The implementer/reviewer must hand the user a
written summary so the user can do informed visual UAT.

---

## 1. Purpose

Two intertwined outcomes, neither sufficient alone:

1. **R&D the felt experience of a full match in Godot** — pacing, scrub,
   camera modes, sidebar legibility, kill-feed reading — so the user can
   give grounded feedback before any consumer-render commitment. The
   prototype is throwaway (mental-model §10, §13 — still pre-§10-gate).
2. **Lock in the match-data contract** — the Convex HTTP endpoint that
   returns a `replay-snapshot.json`-shaped JSON document for any
   completed match. This *is not* throwaway: it remains as the
   load-bearing read surface every future renderer (R&D prototype,
   consumer render, even the existing React diagnostic) is meant to
   share. Mental-model §13: "prototypes come and go, the contract
   stays."

Decision filter (§7): does this make prompt-authored behaviour more
*interesting, legible, or exploitable*? — Yes: a watchable end-to-end
replay surface is the canonical sharing/diagnosis substrate (§5, §12,
§13).

---

## 2. Overview

What is being built:

| Layer | Throwaway? | Lives at |
|---|---|---|
| **Convex match-data contract** (2 HTTP endpoints + supporting export module + reconstruction relocation) | **No — escapes throwaway** | `convex/http.ts`, `convex/replay/` |
| **Godot full-match prototype** (project, picker, player, sidebar, kill-feed overlay) | **Yes — throwaway** | `throwaway-prototypes/d-full-match/` |

The contract is the thing that survives. The prototype is the
felt-experience probe that informs *whether* and *how* the consumer
render era eventually proceeds (still §10-gated, still deferred until
after the player-facing layer matures).

Gherkin acceptance scenarios are listed verbatim in the North Star
brief and are not duplicated here; success criteria below are the
testable derivatives.

---

## 3. Architecture Design

### 3.1 Match-data contract — Convex HTTP surface

Two public endpoints, no auth, JSON, CORS-open (read-only public data):

```
GET  /replay/listMatches
GET  /replay/exportMatch?matchId=<id>
OPTIONS /replay/*               (CORS preflight)
```

**Implementation file layout:**

```
convex/
├── http.ts                          ← NEW. httpRouter + the 2 routes + OPTIONS.
├── replay.ts                        ← KEEP. Existing in-process queries (used by apps/replay).
├── replay/
│   ├── reconstruct.ts               ← MOVED FROM apps/replay/src/lib/reconstruct.ts.
│   │                                  Single source of truth. Pure module.
│   ├── snapshot.ts                  ← NEW. buildMatchSnapshot(bundle, mapDescriptor)
│   │                                  → MatchSnapshotJson. Wraps reconstruct.ts walk
│   │                                  across turn 1..N; assembles full frames + killFeed
│   │                                  + speechLog + agentTraces + map + outcome.
│   └── snapshotTypes.ts             ← NEW. MatchSnapshotJson + MatchSummary types.
│                                      Exported so apps/replay can re-use the same shape
│                                      when it eventually consumes the same contract.
apps/replay/src/lib/
├── reconstruct.ts                   ← REPLACED with a one-line re-export from
│                                      ../../../../convex/replay/reconstruct.ts. Keeps
│                                      existing imports working; no callsite churn.
```

**Why move reconstruct.ts into `convex/`** — the engine owns
reconstruction semantically; convex's bundler already imports `maps/*.json`
the same way the renderer side does, and `apps/replay/src/lib/reconstruct.ts`
already imports `../../../../convex/_generated/dataModel`. The move makes
the data flow read inside-out (engine emits the contract; consumers read
it) rather than the current outside-in (renderer-owned module shaping
engine data). Mental-model §13: "renderers do not carry their own
reconstruction copies."

**`http.ts` skeleton (canonical Convex pattern):**

```ts
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";
import { buildMatchSnapshot, summariseMatch } from "./replay/snapshot";
import { getMapDescriptor } from "./engine/map";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
} as const;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });

const http = httpRouter();

http.route({
  path: "/replay/listMatches",
  method: "GET",
  handler: httpAction(async (ctx) => {
    // D11: characters must be joined per-match server-side to populate
    // MatchSummary.characterIds[]. Implementer picks (a) per-match runQuery loop
    // or (b) a new combined query `api.replay.listMatchesWithCharacters`.
    // Either way, return MatchSummary[] (NOT raw Doc<"matches">[]).
    const summaries = await ctx.runQuery(api.replay.listMatchesWithCharacters, {
      paginationOpts: { numItems: 100, cursor: null },
    });
    return json(summaries.map(summariseMatch));
  }),
});

http.route({
  path: "/replay/exportMatch",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const matchId = new URL(req.url).searchParams.get("matchId");
    if (!matchId) return json({ error: "missing_match_id" }, 400);
    let bundle;
    try {
      bundle = await ctx.runQuery(api.replay.getReplayBundle, {
        matchId: matchId as any, // Convex v.id() validator will throw on malformed strings
      });
    } catch (_e) {
      // Malformed id => 400 (not 500). v.id() validation failures bubble here.
      return json({ error: "bad_match_id" }, 400);
    }
    if (!bundle) return json({ error: "not_found" }, 404);
    if (bundle.match.status !== "completed") {
      return json({ error: "match_not_completed", status: bundle.match.status }, 409);
    }
    const mapDescriptor = getMapDescriptor(bundle.match.mapId);
    return json(buildMatchSnapshot(bundle, mapDescriptor));
  }),
});

http.route({
  path: "/replay/listMatches",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { status: 204, headers: CORS })),
});
http.route({
  path: "/replay/exportMatch",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { status: 204, headers: CORS })),
});

export default http;
```

**`MatchSnapshotJson` shape** — conforms to the canonical fixture at
`throwaway-prototypes/shared-harness/replay-snapshot.json` (mental-model
§13 line 291 "the contract returns the existing replay-snapshot.json
shape"). The fixture's `timeline.frames[]` container is preserved
verbatim — the new contract is additive (extra fields on each frame +
new top-level `killFeed`/`speechLog`/`agentTraces` arrays + `outcome`
projection). Because the additions are additive, schemaVersion bumps
to **2**. The prototype's scripted `highlightedEvents` field is
dropped and replaced by auto-derived `killFeed`.

```ts
export type MatchSnapshotJson = {
  schemaVersion: 2;
  source: {
    matchId: string;
    mapId: string;             // "reference" | "split-basin" | ...
    completedAt: number;       // unix ms
    rngSeed: string;
  };
  playback: {
    turnCount: number;          // total turns in this match
    secondsPerTurn: number;     // suggested pacing (PM default 0.6 — see §7 Q3)
    sliceDurationSeconds: number; // turnCount × secondsPerTurn
    fpsHint: number;            // 60
    startTurn: 1;               // matches fixture: turn-1 is the first ledger row
    endTurn: number;            // turnCount
  };
  map: {
    size: { w: number; h: number };
    walls: Array<{ x: number; y: number; w: number; h: number }>;
    coverClusters: Array<{ x: number; y: number; w: number; h: number }>;
    evac: { centre: Tile; zone: Rect; revealedAtTurn: number | null };
    staticCrates: Array<{ id: string; pos: Tile; contents: ItemRef | null }>;
    airdrops: Array<{ id: string; pos: Tile; landsAtTurn: number; contents: ItemRef }>;
  };
  characters: Array<{
    characterId: string;
    personaId: PersonaId;
    displayName: string;
    spawnIndex: number;
    spawn: Tile;
    cardId: string | null;
    prompts: { system: string | null; persona: string | null };
  }>;
  timeline: {
    frames: Array<{
      turn: number;                // 1..turnCount (matches fixture; turn 0 is synthetic — see §3.1 step 2)
      timeSeconds: number;
      snapshot: EntitySnapshot;    // existing shape from reconstruct.ts
      equippedByCharacter: Record<string, Equipped | null>; // per-turn, from agentRecords.input.status
      hpByCharacter: Record<string, number>;                // per-turn, from agentRecords.input.status
    }>;
  };
  killFeed: Array<{
    turn: number;
    victimId: string;
    killerId: string | null;     // null = environmental (telefrag, etc.)
    weapon: string | null;
    kind: "duel" | "environmental";
    text: string;                // pre-formatted "Sprinter killed Vulture with greatsword"
  }>;
  speechLog: Array<{
    turn: number;
    characterId: string;
    text: string;
    heardBy: string[];           // for sidebar filtering
  }>;
  agentTraces: Array<{
    turn: number;
    characterId: string;
    scratchpadBefore: string;
    scratchpadAfter: string;
    decisionSay: string | null;
    reasoning: string | null;
  }>;
  outcome: {
    extracted: string[];
    lastSurvivor: string | null;             // schema is v.optional(v.id()); coerce undefined → null at projection
    pointsByCharacter: Array<{ id: string; points: number }>; // D9: mirror schema {id, points} verbatim — no rename
  };
};

export type MatchSummary = {
  matchId: string;
  completedAt: number;
  mapId: string;
  characterIds: string[];
  characterCount: number;
  turnCount: number;
  outcome: {
    extractedCount: number;
    lastSurvivor: string | null;
  };
};
```

**`buildMatchSnapshot` algorithm** (pure, deterministic):

1. Read `bundle.match`, `bundle.turns`, `bundle.characters`, `bundle.worldState`, `bundle.promptsLookup`.

2. **Turn walk via `turnRowByTurn` map (D-P2-13).** The ledger's `turns[]`
   array does NOT use array-index = turn-number — `bundle.turns[0].turn === 1`
   (rows start at turn 1; turn 0 is synthetic / pre-first-action state).
   Build `const turnRowByTurn = new Map<number, TurnRow>(bundle.turns.map(t => [t.turn, t]))`,
   then iterate `for (let t = 1; t <= turnCount; t++) { const row = turnRowByTurn.get(t); ... }`
   to assemble each `timeline.frames[]` entry. The contract emits frames
   for `turn = 1..turnCount` (matching the canonical fixture which starts
   at `timeline.frames[0].turn === 1`). Turn 0 is NOT emitted as a frame
   — its only role is feeding `reconstruct(bundle, t)` with the synthetic
   pre-action state when needed; if a future consumer wants a turn-0
   frame, append explicitly with `equippedByCharacter` /
   `hpByCharacter` populated from `bundle.characters[c].equipped` /
   `.hp` spawn defaults (deferred until needed).
   - `equippedByCharacter[charId]` and `hpByCharacter[charId]` for turn
     `t` come from `row.agentRecords.find(r => r.characterId === charId)
     .input.status.{equipped, hp}` — see §3.1 D-P2-11 scope note below.
   - **Dead-character carry-forward.** `agentRecords` stops carrying a
     character starting the turn after death/extraction. For every
     character whose record is absent in turn `t`, copy that character's
     last-seen `{equipped, hp}` from the most recent prior frame.
     Implementation: maintain a running `lastSeenStatus: Map<charId,
     {equipped, hp}>` outside the loop, write into it from each turn's
     present records, and fill missing slots from the map. This keeps
     SidePanel (WP4) able to show a dead character's terminal loadout
     when the user cycles to them in anchored cam.

3. **`killFeed` via shared kill-attribution helper.** Reuse
   `convex/engine/killAttribution.ts` — specifically its `isDamageAction`
   predicate (`kind in {"attack","overwatch","counter"}` AND
   `result` matches `/^dmg\s+\d+/i`) plus its `buildTargetIdLookup`
   alias-normaliser (action targets may be display names or persona
   names, not characterIds). Same posture as porting `reconstruct.ts`:
   one canonical engine helper, no parallel implementation.
   - Either import the existing exports (preferred), or extract
     `isDamageAction` + `buildTargetIdLookup` into a small shared
     module that both `killAttribution.ts` and `snapshot.ts` consume —
     implementer judgment. Do NOT inline an attack-only re-implementation
     (silent under-count of overwatch and counter kills).
   - For each turn `t`: for each `victimId` in
     `row.resolution.deaths`, find the matching damage action whose
     normalised target equals `victimId`; emit `{ turn: t, victimId,
     killerId: action.characterId, weapon: action.weapon ?? null,
     kind: "duel", text: formatKillLine(...) }`. If no damage action
     normalises to that victim (e.g. counter that killed without an
     explicit action row), `killerId = null` with
     `kind: "duel"` is acceptable but document the gap in test fixtures.
   - For each `victimId` in `row.resolution.environmentalDeaths`:
     emit `{ turn: t, victimId, killerId: null, weapon: null,
     kind: "environmental", text: formatEnvLine(...) }`.

4. `speechLog` = flatten `row.resolution.speech` across all turns.
5. `agentTraces` = flatten `row.agentRecords` projection across all turns.

6. **`map` field — explicit field sourcing.** `getMapDescriptor(bundle.match.mapId)`
   is the descriptor source-of-truth for static geometry; `bundle.worldState`
   holds mutable / runtime fields. The merge:
   - `snapshot.map.size` = `mapDescriptor.size`
   - `snapshot.map.walls` = `bundle.worldState.walls` (already joined from
     `worldStatic` by `getReplayBundle`)
   - `snapshot.map.coverClusters` = `bundle.worldState.coverClusters`
     (same provenance as `walls`)
   - `snapshot.map.evac.centre` = `bundle.worldState.evac.centre`
   - `snapshot.map.evac.zone` = `mapDescriptor.evac.zone` (worldState has
     NO `zone` — schema.ts:1073-1076 confirms `evac` only has
     `{centre, revealedAtTurn}`; the rect lives in the descriptor)
   - `snapshot.map.evac.revealedAtTurn` = `bundle.worldState.evac.revealedAtTurn`
   - `snapshot.map.staticCrates` = derived from `bundle.worldState.crates`
     (with descriptor's spawn metadata for `id`/`pos` if needed)
   - `snapshot.map.airdrops` = derived from `bundle.worldState.airdrops`
     (includes `landsAtTurn`, `contents`)

7. **`outcome` projection.** `outcome.extracted` and
   `outcome.pointsByCharacter` map through verbatim from
   `bundle.match.outcome` (D9: schema's `{id, points}` shape is preserved
   in the snapshot — no `id → characterId` rename). `outcome.lastSurvivor`
   coerces `undefined` to `null` (schema is `v.optional(v.id())` →
   `Id | undefined`; JSON contract is `string | null`): `lastSurvivor:
   bundle.match.outcome.lastSurvivor ?? null`.

8. `characters[]` includes resolved `prompts` from `bundle.promptsLookup`
   (system + persona prompt text keyed by the character's
   `cardPromptHash`).

**D-P2-11 scope note.** `apps/replay/src/lib/reconstruct.ts:78-81`
declares `EntitySnapshot.equipped` and `EntitySnapshot.hp` as
non-derivable (the D-P2-11 invariant). That invariant scopes to
**`EntitySnapshot` only** — those two fields remain `null` inside every
`timeline.frames[t].snapshot` per the existing invariant. The new
sibling fields `equippedByCharacter` / `hpByCharacter` ARE derivable:
`agentRecords.input.status.{equipped, hp}` is the authoritative
per-turn ledger for live (and last-seen, for the dead) status. Do NOT
chase the EntitySnapshot invariant into the new fields.

**§3.1 sub-note — `apps/` boundary interpretation (PM-ratified, D5).**
North Star AC #1 ("`apps/` MUST NOT be touched") scopes to **prototype
code** — i.e. the throwaway full-match prototype tree lives at
`throwaway-prototypes/d-full-match/` and does not leak into `apps/`.
A one-line type-preserving re-export shim at
`apps/replay/src/lib/reconstruct.ts` is permitted, justified by
mental-model §13 line 296-300 ("wraps OR ports") and the
substrate-ownership flip (engine owns reconstruction; renderers read
the contract). This is a documented PM decision, not a quiet bullet
inside §3.1. The shim is the ONLY apps/ change in this assignment.

**§3.1 sub-note — `listMatches` summary join (D11).** The existing
`api.replay.listMatches` query (`convex/replay.ts:44`) returns paginated
`Doc<"matches">` rows ONLY — no characters joined. To populate
`MatchSummary.characterIds[]` + `characterCount`, the httpAction must
either:
- (a) loop `page.page` and call `ctx.runQuery(api.replay.getCharactersForMatch, { matchId })`
  per match (one extra query per match — fine for 100-row pages,
  document the cost), OR
- (b) add a new combined query `api.replay.listMatchesWithCharacters`
  in `convex/replay.ts` that fans out characters in one round trip
  (server-side fan-out — preferred for performance).

Implementer chooses one and documents the choice in the PR. Either
way, a WP1 unit test asserts `summary.characterIds.length === summary.characterCount`
for every returned summary.

**§3.1 sub-note — HTTP error semantics.** The handler must distinguish:
- **400** `missing matchId param` — absent query string.
- **400** `malformed matchId` — Convex `v.id()` validation will throw
  on a malformed ID; the handler must `try { ... } catch (e) { return json({ error: "bad_match_id" }, 400) }`
  around the `runQuery` call so a malformed ID returns 400, NOT 500.
- **404** `not_found` — well-formed ID, no matching row
  (`bundle === null`).
- **409** `match_not_completed` — match exists but
  `status !== "completed"`. Body includes the actual status for the
  client's information.
- **200** — success.
- **CORS headers** (`Access-Control-Allow-Origin: *`) attached to ALL
  responses above PLUS the OPTIONS preflight responses. The `json()`
  helper in the skeleton already enforces this; tests assert it on
  every status code.

CORS posture — match-data is public; the deployment is a POC and the
contract is intentionally open (`Allow-Origin: *`). When the contract
is eventually consumed by the player-facing layer (§12), origin
allow-listing becomes a deliberate later layer.

Payload size — a 50-turn full match with 8 agents is well within
single-response-buffered territory (~1-3 MB JSON). No streaming
required.

### 3.2 Godot prototype scaffold

```
throwaway-prototypes/d-full-match/
├── README.md                       ← throwaway label + assignment ref + run command
├── package.json                    ← cloned from c-godot-wasm; renamed
├── project.godot                   ← config_version=5; "Context Battler Full Match"
├── export_presets.cfg              ← web export; copied + path-adjusted
├── scenes/
│   ├── MatchPicker.tscn            ← list scene
│   └── MatchPlayer.tscn            ← renderer scene
├── src/
│   ├── AppState.gd                 ← AUTOLOAD. selected_match_id, convex_url, snapshot cache.
│   ├── ConvexClient.gd             ← AUTOLOAD. async fetch helpers + JSON parse.
│   ├── MatchPicker.gd              ← scene 1 script. listMatches → ItemList → click.
│   ├── MatchPlayer.gd              ← scene 2 root. snapshot ingest + playback driver.
│   ├── PlaybackClock.gd            ← time + scrub state; emits frame ticks.
│   ├── SceneBuilder.gd             ← builds map (walls/cover/evac/crates) from snapshot.map.
│   ├── EntityRenderer.gd           ← spawns + updates character + corpse + airdrop nodes.
│   ├── CameraRig.gd                ← single Camera3D, FREE | ANCHORED modes.
│   ├── KillFeedOverlay.gd          ← FPS-banner top-corner ticker.
│   ├── SidePanel.gd                ← scratchpad/equipment/prompt/speech tabs.
│   └── TimelineHud.gd              ← HSlider + play/pause + scrub.
└── scripts/                        ← Node build/serve helpers cloned from c-godot-wasm.
    ├── export-web.mjs
    └── serve.mjs
```

**`AppState` (autoload)** carries the selected matchId across the scene
swap and caches the snapshot blob to avoid a re-fetch on
picker→player→back-to-picker bouncing. Convex URL is read from the
URL hash (`#convex=https://...convex.cloud`) so the user can flip
deployments without rebuilding.

**`ConvexClient`** wraps `HTTPRequest` with the `await
http.request_completed` signal pattern. Returns `Dictionary | null`.

**`SceneBuilder`** reads `snapshot.map.{walls, coverClusters, evac,
staticCrates}` — covers all 5 maps automatically because each comes
through the contract with its own walls/cover/evac (no hard-coded
reference-map layout, unlike `c-godot-wasm` which had reference baked
in).

**`PlaybackClock`** is the single owner of `currentTurn` (float) and
`isPlaying`. The timeline HUD writes to it on scrub; `EntityRenderer`
and `KillFeedOverlay` and `SidePanel` read from it. Frame
interpolation between integer turns is the `c-godot-wasm`
`_sample_frame` algorithm, generalised over all 8 characters and the
full turn range (not the 5-turn scripted slice).

**`CameraRig`** — one `Camera3D`, `mode: FREE | ANCHORED`. Mode toggle
binds to **C** key + an on-screen button. In `ANCHORED`, **[** and
**]** cycle through `snapshot.characters` (including dead/extracted —
the camera flies to the corpse / extraction tile when its anchor is
gone). Publishes two signals consumed by WP4: `anchor_changed(character_id)`
on every cycle, `mode_changed(mode)` on every FREE↔ANCHORED toggle.

**`KillFeedOverlay`** — `CanvasLayer` with a `VBoxContainer` in the
top-right. On each integer-turn boundary it pushes any
`snapshot.killFeed[turn === t]` lines. Each line auto-dismisses after
~6s. Always visible (FREE or ANCHORED).

**`SidePanel`** — `CanvasLayer` on the right edge.
- FREE mode: collapsed (just a "Director" badge + map + turn counter).
- ANCHORED mode: tabbed view per the anchored character — Equipment,
  Scratchpad (read `agentTraces[turn ≤ current && char === anchored]`
  most recent `scratchpadAfter`), Prompt (read `characters[anchored].prompts.persona`),
  Speech (filter `speechLog` to anchored character).

### 3.3 Data flow

```
[picker]                             [renderer]
   │                                    │
   ├─ GET /replay/listMatches           │
   │      ──> [MatchSummary[]]          │
   │                                    │
   ├─ click(matchId) → AppState         │
   │                                    │
   └─ change_scene → MatchPlayer ──────►│
                                        │
                                        ├─ GET /replay/exportMatch?matchId=...
                                        │      ──> [MatchSnapshotJson]
                                        │
                                        ├─ SceneBuilder.build(snapshot.map)
                                        ├─ EntityRenderer.spawn(snapshot.characters)
                                        ├─ PlaybackClock.start(snapshot.playback)
                                        │
                                        └─ per frame:
                                              EntityRenderer.update(turn)
                                              CameraRig.update(turn)
                                              KillFeedOverlay.tick(turn)
                                              SidePanel.refresh(turn)
                                              TimelineHud.sync(turn)
```

### 3.4 What we are NOT building (load-bearing exclusions)

- **No LOS / fog of war / perception overlay.** Render is ground truth
  always (§13). Perception inspection lives in the React overseer
  (apps/replay) — out of scope here.
- **No live/subscribe-and-cache mode.** Completed-only first probe
  (§13). HTTP fetch + replay; the snapshot is the whole match.
- **No new persisted Convex data.** The contract reads existing rows;
  no schema change.
- **No browsertools / chromium / visual UAT.** Reviewer judgment + unit
  tests are the validation layer. User performs visual UAT themselves
  after closure.
- **No `uat` job in the WP dispatch sequence.** Explicit per the North
  Star brief.
- **No mobile-tuned cold-load work.** §13 niche-art positioning makes
  cold-load non-load-bearing; carry the same WASM floor as
  `c-godot-wasm` (~9.5 MB gzip).
- **No 3D speech bubbles.** Speech is sidebar log only (Gherkin).

---

## 4. Dependency Map

```
                 ┌───────────────────────────────────────────────┐
                 │ WP1  Convex match-data contract               │
                 │      (escapes throwaway)                      │
                 │  - move reconstruct.ts → convex/replay/       │
                 │  - convex/replay/snapshot.ts builder          │
                 │  - convex/http.ts httpRouter                  │
                 │  - unit tests (incl. shape, CORS, errors)     │
                 └─────┬─────────────────────────────────┬───────┘
                       │ contract shape DOC freezes      │ deploys
                       │ early (after design step in WP1)│
                       │                                 │
                       ▼                                 ▼
        ┌───────────────────────────┐      (live endpoint usable
        │ WP2 Godot scaffold +      │       for WP3/WP4 dev)
        │     match picker          │
        │  - clone c-godot-wasm/    │
        │  - AppState + ConvexClient│
        │  - MatchPicker scene      │
        │  - MatchPlayer stub       │
        └─────┬─────────────────────┘
              │
              ▼
        ┌──────────────────────────────────────────┐
        │ WP3 Playback engine + cameras + maps     │
        │  - SceneBuilder over all 5 maps          │
        │  - PlaybackClock, scrub, play/pause      │
        │  - EntityRenderer over all 8 chars       │
        │  - CameraRig FREE + ANCHORED + cycle     │
        │  - TimelineHud                           │
        └─────┬────────────────────────────────────┘
              │
              ▼
        ┌──────────────────────────────────────────┐
        │ WP4 Sidebar + kill feed + speech +       │
        │     equipment                            │
        │  - KillFeedOverlay (FPS banner)          │
        │  - SidePanel (scratchpad/eq/prompt/say)  │
        │  - blind-UAT handoff summary             │
        └──────────────────────────────────────────┘
```

**Parallelism opportunities:**

- **WP1 ↔ WP2 contract-shape parallelism.** WP1's first deliverable is
  the `MatchSnapshotJson` and `MatchSummary` type declarations + a
  literal example JSON checked into the repo (e.g. as a vitest fixture
  output). Once those land — *before* the endpoint is fully wired —
  WP2 can begin against the fixture. Dispatch WP1 first; dispatch WP2
  ~6h later (estimated) when the contract types are committed.
- **WP3 ↔ WP4 sidebar scaffold parallelism.** Once WP2 has scenes
  wired and WP1 is producing real snapshots, WP3 and WP4 can run in
  parallel: WP3 owns the 3D scene + camera + timeline; WP4 owns the
  CanvasLayer overlays + sidebar. **Shared API surface WP3 publishes
  early in its commit history** (so WP4 can stub against it):
  - `CameraRig.anchor_changed(character_id: String)` signal — WP4
    SidePanel subscribes for tab content swap.
  - `CameraRig.mode_changed(mode: int)` signal — WP4 SidePanel
    subscribes to switch between FREE-mode collapsed view and
    ANCHORED-mode full view.
  - `PlaybackClock.turn_changed(turn: int)` signal — WP4 KillFeedOverlay
    + SidePanel subscribe to refresh per-turn content.
  - `PlaybackClock.current_turn` getter (float) — read by WP4 when
    refreshing scratchpad / kill banner rebuild on scrub.
  - Shared read access to the parsed snapshot `Dictionary` via the
    `AppState` autoload established in WP2.
- **Reviewer pass is single-final** across all four WPs once each WP
  implementer reports "implementation complete + tests green". No
  per-WP UAT.

---

## 5. Work Packages

### WP1 — Convex match-data contract (escapes throwaway)

**Scope:**
1. Move `apps/replay/src/lib/reconstruct.ts` →
   `convex/replay/reconstruct.ts`. Update imports inside the moved
   module (relative path for `_generated/dataModel` and `maps/*.json`
   shifts by one `..`). Add a thin re-export shim at the old path:
   `export * from "../../../../convex/replay/reconstruct";` so
   `apps/replay` callsites keep working unchanged.
2. New `convex/replay/snapshotTypes.ts` — `MatchSnapshotJson`,
   `MatchSummary`, ancillary type aliases.
3. New `convex/replay/snapshot.ts` —
   - `buildMatchSnapshot(bundle, mapDescriptor): MatchSnapshotJson`
     pure function. Walks `reconstruct(bundle, t)` over `t = 1..turnCount`
     via a `turnRowByTurn` map (see §3.1 step 2 — array index ≠ turn
     number) and assembles the extension fields (killFeed using
     `convex/engine/killAttribution.ts::isDamageAction`, speechLog,
     agentTraces, per-turn equipped/hp from
     `agentRecords.input.status`, with dead-character carry-forward).
   - `summariseMatch(match, characters): MatchSummary`. Lightweight
     projection consumed by `listMatches` after the server-side
     characters join (D11).
4. Either extend `convex/replay.ts` with a new
   `listMatchesWithCharacters` query (preferred, D11(b)) or rely on a
   per-match `getCharactersForMatch` runQuery loop inside the
   httpAction (D11(a)). Implementer documents the choice.
5. New `convex/http.ts` — httpRouter exporting routes per §3.1, with
   the OPTIONS preflight + CORS-open posture.
6. **Tests (TDD red first) — minimum 9 cases:**
   - `tests/convex/replaySnapshot.test.ts`:
     1. **Happy path (canonical-shape conformance).** Synthesise a
        5-turn 3-character `ReplayBundle` fixture (mirrors the
        `reconstruct.test.ts` pattern); assert the produced snapshot
        contains every top-level key from the canonical fixture
        skeleton: `schemaVersion === 2`, `source`, `playback`, `map`,
        `characters`, `timeline.frames`, plus the additive extension
        fields `killFeed`, `speechLog`, `agentTraces`, `outcome`.
        Assert `timeline.frames.length === turnCount`,
        `timeline.frames[0].turn === 1`,
        `timeline.frames[timeline.frames.length - 1].turn === turnCount`.
     2. **Kill attribution — attack.** A `kind: "attack"` resolution
        action whose target is in `resolution.deaths` produces
        `killFeed[i].killerId === attacker`,
        `weapon === action.weapon`, `kind === "duel"`.
     3. **Kill attribution — overwatch (NEW, item 2 of patch list).**
        A `kind: "overwatch"` action whose `result` matches `/^dmg \d+/i`
        and whose target ends up in `deaths` produces
        `killFeed[i].killerId !== null` (NOT silently dropped). Same
        assertion shape for `kind: "counter"` if implementer adds
        a sibling case.
     4. **Environmental death.** An `environmentalDeaths[]` entry
        produces `killerId === null`, `kind === "environmental"`.
     5. **Equipped/HP merge.** `timeline.frames[t].equippedByCharacter[charId]`
        reflects the per-turn `agentRecords.input.status.equipped`
        for the matching character; same for `hpByCharacter`.
     6. **Dead-character carry-forward (NEW, item 8 of patch list).**
        Construct a fixture where a character dies on turn 3.
        Assert `timeline.frames` for turn 7 contains
        `equippedByCharacter[deadCharId]` equal to the turn-3 value,
        and `hpByCharacter[deadCharId]` equal to the turn-3 value
        (last-seen status carried forward).
     7. **Outcome propagation.** `snapshot.outcome.extracted ===
        bundle.match.outcome.extracted`;
        `snapshot.outcome.pointsByCharacter[i].id` (NOT `characterId`)
        and `.points` mirror the schema verbatim;
        `snapshot.outcome.lastSurvivor` coerces an `undefined` to
        `null` (test both branches: a real `Id` survivor and an
        `undefined` survivor).
     8. **Multi-map parametrised (NEW, item 11 of patch list).**
        Iterate all 5 mapIds (`reference`, `split-basin`, `crosswind`,
        `market-maze`, `faultline`). For each, build a minimal
        bundle, run the snapshot builder, and assert
        `snapshot.map.walls.length` and
        `snapshot.map.coverClusters.length` match the respective
        `getMapDescriptor(mapId)` counts (since walls/cover flow
        through `worldStatic` and the descriptor is the source of
        truth). Also assert `snapshot.map.evac.zone` is populated
        from the descriptor (worldState doesn't carry it).
   - `tests/convex/http.test.ts` (or the closest existing harness
     equivalent — implementer judgment):
     9. **`listMatches` summary join (NEW, item 5 of patch list).**
        Returns `MatchSummary[]`, every summary has
        `characterIds.length === characterCount` and every entry is
        a real character id for the corresponding match. All
        returned summaries have `status === "completed"`. Sorted
        desc by `completedAt`.
     10. **HTTP error matrix (NEW, item 10 of patch list):**
         - `GET /replay/exportMatch` with no `matchId` → **400**
           `missing_match_id`.
         - `GET /replay/exportMatch?matchId=not-a-real-id` (malformed)
           → **400** `bad_match_id` (NOT 500).
         - `GET /replay/exportMatch?matchId=<well-formed-but-absent>` →
           **404** `not_found`.
         - `GET /replay/exportMatch?matchId=<in-progress-match>` →
           **409** `match_not_completed`.
         - `GET /replay/listMatches` and `GET /replay/exportMatch`
           on success and on each error code attach
           `Access-Control-Allow-Origin: *`.
         - `OPTIONS /replay/listMatches` and
           `OPTIONS /replay/exportMatch` both return 204 with CORS
           headers.
   - **Existing `reconstruct.test.ts` must still pass** without
     modification (the move is import-path only).
7. Lint/typecheck/build/test all green.

**Success criteria:**
- `convex/http.ts` exists and registers the two routes + their OPTIONS.
- `convex/replay/snapshot.ts::buildMatchSnapshot` is a pure function
  consumed by the httpAction; identical input → identical output.
- `apps/replay/src/lib/reconstruct.ts` becomes a re-export shim; no
  callsite under `apps/replay/` needs to change.
- All 5 maps in the pool are exportable end-to-end via the
  parametrised multi-map test in step 6 case 8 (asserts walls /
  coverClusters / evac.zone match each `getMapDescriptor`).
- `convex/engine/killAttribution.ts::isDamageAction` (or a shared
  extracted helper) is the kill-attribution path; no parallel
  attack-only inline re-implementation.
- `outcome.pointsByCharacter` JSON uses `{id, points}` (NOT
  `{characterId, points}`); `outcome.lastSurvivor` is `string | null`
  with `undefined → null` coercion documented in the code.
- Reviewer can `curl http://localhost:.../replay/listMatches` (against
  `npx convex dev`) and get JSON back.
- `npm run lint && npm run typecheck && npm run build && npm run test`
  green from repo root.

**Not in scope for WP1:**
- Live/subscribe path. Stays §13-deferred.
- Auth / origin allow-listing. POC posture: open.
- Streaming response. Buffered JSON.

---

### WP2 — Godot prototype scaffold + match picker

**Scope:**
1. Create `throwaway-prototypes/d-full-match/`. Structural sibling of
   `c-godot-wasm/`. README labels prototype as throwaway and links to
   this spec + the assignment.
2. Copy + adapt `project.godot`, `export_presets.cfg`, build/serve
   `scripts/*.mjs`, `package.json`. Rename project to
   `"Context Battler Full Match"`.
3. New `src/AppState.gd` autoload — `selected_match_id: String`,
   `convex_url: String` (read from URL hash with a default fallback),
   `snapshot_cache: Dictionary` (matchId → JSON).
4. New `src/ConvexClient.gd` autoload — `fetch_json(path: String) ->
   Variant` awaiting the `HTTPRequest.request_completed` signal.
   JSON-parse + null on error. CORS-friendly default headers.
5. New `scenes/MatchPicker.tscn` + `src/MatchPicker.gd`:
   - On `_ready`: `ConvexClient.fetch_json("/replay/listMatches")`.
   - Renders the list into an `ItemList` (one row per match: mapId +
     completedAt-as-human-time + outcome summary).
   - `item_activated` (Enter / double-click) sets
     `AppState.selected_match_id` and calls
     `get_tree().change_scene_to_file("res://scenes/MatchPlayer.tscn")`.
   - Empty-list state — visible message "no completed matches".
   - Error state — visible message + retry button.
6. New `scenes/MatchPlayer.tscn` + `src/MatchPlayer.gd` STUB:
   - On `_ready`: reads `AppState.selected_match_id`, fetches
     `/replay/exportMatch?matchId=...`, prints turnCount to a Label.
   - A "Back" button returns to `MatchPicker.tscn`.
   - No 3D scene yet — that's WP3.
7. Bind `project.godot::run/main_scene` to `MatchPicker.tscn`.
8. Boot signal compatibility — keep `window.__telefragReady`-style
   flags or rename to `window.__d_full_match_ready` (implementer
   judgment; document the chosen name in README).
9. CORS: NONE — Godot client doesn't enforce CORS; the browser does.
   Documented in README so the reviewer understands no client-side
   CORS plumbing is needed.

**Success criteria:**
- `cd throwaway-prototypes/d-full-match && npm run build` succeeds
  (assuming Godot 4.6.2 toolchain installed — same prerequisite as
  `c-godot-wasm`).
- `npm run serve` opens the picker scene and lists completed matches
  from the configured Convex deployment.
- Clicking a match routes to MatchPlayer, which fetches the snapshot
  and prints `turnCount`.
- `apps/` is untouched.
- README clearly labels throwaway + links to this spec.
- `npm run lint && npm run typecheck && npm run build && npm run test`
  green from repo root (Godot WP doesn't add new TS surface to the
  root project; this just verifies it doesn't break what's there).

**Not in scope for WP2:**
- 3D rendering of the match. WP3.
- Camera modes / scrub. WP3.
- Sidebar / kill feed. WP4.
- Equipment / scratchpad UI. WP4.

---

### WP3 — Playback engine, cameras, multi-map support

**Scope:**
1. `src/SceneBuilder.gd` — builds map geometry from
   `snapshot.map.{size, walls, coverClusters, evac, staticCrates,
   airdrops}` so all 5 maps render off the contract alone, no
   per-map code path. Carry forward the cyberpunk-neon
   materials/lighting from `c-godot-wasm/src/Main.gd::_make_materials`
   + `_make_world_environment` + `_make_lighting`.
2. `src/EntityRenderer.gd`:
   - Spawns one node per `snapshot.characters[i]` using the
     Quaternius `Astronaut.glb` (copy into
     `d-full-match/shared-harness/art-kit/` — same CC0 manifest as
     `c-godot-wasm`).
   - Per-frame update: position from
     `timeline.frames[t].snapshot.characters[i].pos`,
     `visible = alive && !extracted`, persona color from a stable
     palette keyed by `personaId`.
   - Corpses: render at `timeline.frames[t].snapshot.corpses[i].pos`
     once `diedAtTurn !== null`.
   - Crates: render `timeline.frames[t].snapshot.crates` (opened vs.
     unopened visual differentiation).
   - Airdrops: render `timeline.frames[t].snapshot.airdrops` with
     state-based visuals (`pre` hidden, `telegraphed` sky-beam,
     `landed` crate, `spent` looted-marker). Carry the c-godot-wasm
     telegraph beam + red-mist VFX for environmental-death turns.
3. `src/PlaybackClock.gd`:
   - State: `current_turn: float`, `is_playing: bool`, `speed: float`.
   - On `_process(delta)`: if playing, advance
     `current_turn += (delta * speed) / secondsPerTurn`, clamp to
     `[1, turnCount]` (turn-1 is the first emitted frame per the
     canonical fixture; turn 0 is synthetic and NOT in
     `timeline.frames[]`). Emit `turn_changed(turn)` on every
     integer-boundary crossing.
   - `scrub_to(turn: float)`: pause + set + emit `turn_changed`.
   - `set_speed(multiplier)`: 0.5x / 1x / 2x toggle (D6).
4. `src/TimelineHud.gd`:
   - `HSlider` bound to `PlaybackClock.current_turn`, range `[1,
     turnCount]`.
   - Play/Pause toggle button.
   - **Speed selector — REQUIRED (D6).** 0.5x / 1x / 2x toggle (1x
     default). Calls `PlaybackClock.set_speed(multiplier)`.
   - Turn counter label "Turn 17 / 42".
5. `src/CameraRig.gd`:
   - Single `Camera3D`, `mode: FREE | ANCHORED`.
   - `FREE`: orbit/pan/zoom on a free anchor (carry
     `c-godot-wasm/src/Main.gd::_update_camera` pattern).
   - `ANCHORED`: target = `snapshot.characters[anchor_index]`. On
     death/extraction, anchor stays on the last-known tile (or the
     corpse, if a corpse exists).
   - `cycle_anchor(delta_int)` advances anchor_index modulo
     `characters.length` — including dead/extracted (Gherkin: "alive
     AND dead").
   - Mode toggle: `C` key + on-screen button.
   - Anchor cycle: `[` / `]` keys + on-screen prev/next buttons.
   - **Signals published early in WP3's commit history** (see §4
     shared-API enumeration):
     - `anchor_changed(character_id: String)` — emitted on every
       cycle. WP4 SidePanel subscribes.
     - `mode_changed(mode: int)` — emitted on every FREE↔ANCHORED
       toggle. WP4 SidePanel subscribes for collapse/expand.
6. Frame interpolation between integer turns: linear lerp on
   character positions (carry `c-godot-wasm`'s `_interpolate_frames`
   pattern, generalised over all 8 chars + full match range).
7. Integration test (where Godot headless permits) or written test
   plan: assert `SceneBuilder` produces one wall-mesh per
   `snapshot.map.walls[i]` for each of the 5 maps — load 5 fixture
   snapshots, count wall nodes.

**Success criteria:**
- All 5 maps render correctly (visually testable by user post-closure;
  programmatically testable: node-count assertions against snapshot
  geometry).
- Play / Pause / scrub-backward / scrub-forward all work without state
  drift (deterministic re-render at the same `current_turn`).
- Camera toggle works; anchored mode cycles through all 8
  characters including dead/extracted.
- No fog/LOS code anywhere in WP3 (reviewer check).
- `npm run lint && npm run typecheck && npm run build && npm run test`
  green from repo root.

---

### WP4 — Sidebar + FPS kill feed + speech log + equipment

**Scope:**
1. `src/KillFeedOverlay.gd`:
   - `CanvasLayer`, top-right `VBoxContainer`.
   - Subscribes to `PlaybackClock.turn_changed`.
   - On integer-turn boundary crossing: push all
     `snapshot.killFeed` entries where `turn === current_turn_int`.
   - Each banner auto-dismisses after ~6s (tween alpha).
   - Always visible (FREE or ANCHORED).
   - Scrub backward correctly *removes* banners (rebuild from
     `[t - 6s/secondsPerTurn, t]`).
2. `src/SidePanel.gd`:
   - `CanvasLayer`, right edge, ~360 px wide.
   - Subscribes to `CameraRig.anchor_changed`,
     `CameraRig.mode_changed`, `PlaybackClock.turn_changed`.
   - Reads the parsed snapshot `Dictionary` from the `AppState`
     autoload (shared via WP2's plumbing).
   - **FREE mode**: collapsed — shows map name + turn counter + alive
     count.
   - **ANCHORED mode** — tabs / sections:
     - **Identity:** persona name, character name, alive/dead/extracted badge.
     - **Equipment:** weapon name + DPS tier (or `unarmed`), armour
       name + % reduction (or `unarmoured`), held consumable. Read
       from `timeline.frames[current_turn].equippedByCharacter[anchor]`.
     - **Scratchpad:** latest `agentTraces[turn ≤ current_turn &&
       characterId === anchor]` `scratchpadAfter`. Monospace, wraps,
       scrollable.
     - **Prompt:** `characters[anchor].prompts.persona` (collapsible
       by default; click to expand).
     - **Speech log:** `speechLog` filtered to anchored character
       (chronological list of `"Turn N: <said>"`).
3. Equipment-tier visualisation in the scene (OPTIONAL per North
   Star §6 "welcomed but not required"). If implementer chooses to
   implement, document in README; otherwise label-only via SidePanel
   is sufficient.
4. **Written summary for blind-UAT handoff** — implementer writes
   `throwaway-prototypes/d-full-match/IMPLEMENTATION-SUMMARY.md`
   describing what was built, what keyboard shortcuts exist, which
   things differ from `c-godot-wasm`, and what the user should look
   for during their own visual UAT.

**Success criteria:**
- KillFeed surfaces every `snapshot.killFeed[]` entry at the right
  turn boundary and dismisses correctly.
- SidePanel swaps content on `anchor_changed` and refreshes on
  `turn_changed` (scratchpad reflects scrub).
- FREE-mode SidePanel is collapsed/minimal; ANCHORED-mode shows full
  per-character payload.
- No 3D speech bubbles in the scene (reviewer check — Gherkin).
- `IMPLEMENTATION-SUMMARY.md` exists and is detailed enough for the
  user to run their own visual UAT without back-and-forth.
- `npm run lint && npm run typecheck && npm run build && npm run test`
  green from repo root.

---

## 6. Assignment-Level Success Criteria

Mapped to North Star Acceptance Criteria 1-6:

| # | Criterion | Validated by |
|---|---|---|
| 1 | Prototype lives at `throwaway-prototypes/d-full-match/`; `apps/` otherwise untouched except for the one-line reconstruct.ts re-export shim ratified by D5 (§3.1); README labelled throwaway | WP2 + reviewer file-tree check |
| 2 | Convex HTTP routes `/replay/listMatches` + `/replay/exportMatch` exist; reconstruct.ts ported into `convex/replay/` as single source of truth (per D5); kill attribution reuses `convex/engine/killAttribution.ts` (D8); unit tests cover the 10-case matrix in WP1 step 6 | WP1 tests + reviewer |
| 3 | In-Godot picker, dual cameras, sidebar (anchored), FPS kill feed, scrubbable timeline, all 5 maps | WP2 + WP3 + WP4; reviewer + user post-closure visual UAT |
| 4 | NO fog, NO LOS, NO ghost markers, NO perception overlay — render is ground truth always | Reviewer grep for forbidden code paths |
| 5 | NO browsertools, NO uat job, validation = lint/typecheck/build/test + reviewer judgment + user post-closure visual UAT | Dispatch sequence + reviewer |
| 6 | Cyberpunk × Diablo neon vibe inherited from c-godot-wasm Round-2 polish baseline | Reviewer + user post-closure visual UAT |

**Definition of Done (assignment-level):**
- WP1 + WP2 + WP3 + WP4 all complete + reviewed.
- Convex action shipped with unit tests; lint/typecheck/build/test all green.
- Godot prototype builds and exports under
  `throwaway-prototypes/d-full-match/dist/`.
- Implementer/reviewer summary (`IMPLEMENTATION-SUMMARY.md`) exists
  for user's blind-UAT handoff.
- No browsertools / visual UAT artefacts anywhere.

---

## 7. Ambiguities & Open Questions — CLOSED (PM-ratified)

All seven dispatch-time questions are resolved per PM ratification.
Recorded here for traceability; implementers should treat these as
binding defaults, NOT open questions.

1. **Match selection filter — CLOSED.** `listMatches` returns the last
   100 completed matches, sorted desc by `completedAt`. Single page,
   non-paginated. Reason: POC posture; >100 historical matches is
   highly unlikely in this dev environment; the picker should always
   load fast.
2. **Pagination on picker side — CLOSED.** None. Single page (item 1).
   If the user later wants infinite-scroll, a follow-up WP can add it
   without changing the contract shape.
3. **`secondsPerTurn` default — CLOSED (D6).** Default `secondsPerTurn
   = 0.6` (→ ~30s per 50-turn match). **TimelineHud exposes a speed
   selector with 0.5x / 1x / 2x toggles** so the felt-experience knob
   is tunable at runtime without a rebuild. Recorded as
   `playback.secondsPerTurn` in the snapshot so other consumers see
   the same default.
4. **Convex deployment URL plumbing — CLOSED.** Read from URL hash
   (`#convex=https://...convex.cloud`) with a build-time default for
   the dev deployment. Same WASM export points at dev/prod via the
   hash alone. Documented in `d-full-match/README.md`.
5. **Empty-state copy — CLOSED.** Picker shows "no completed matches
   — run `npm run harness` to seed one" plus a retry button.
   Implementer is free to refine copy in their summary doc.
6. **Reconstruct-move as separate WP — CLOSED.** Subsumed in WP1.
   The move is a no-behavior-change refactor; if WP1 implementer
   prefers to land it as the first commit inside the WP1 PR for
   bisectability, that's fine but not required.
7. **Equipment-tier scene-level visuals — CLOSED.** Skip for v0.
   Sidebar-label differentiation only (WP4 §2 Equipment tab).
   Scene-level mesh/material differentiation is OUT of scope; if a
   WP4 implementer wants to land it, they MUST flag it in
   `IMPLEMENTATION-SUMMARY.md` for the user's blind UAT.

**§3.1 cross-reference — PM-ratified decisions also landed in §3.1:**
- D5: `apps/` boundary narrow reading + one-line re-export shim
  permitted (§3.1 "`apps/` boundary interpretation" sub-note).
- D7: snapshot conforms to the canonical fixture shape
  (`timeline.frames` container).
- D8: kill attribution reuses `convex/engine/killAttribution.ts`.
- D9: `outcome.pointsByCharacter` keeps schema `{id, points}` shape;
  `lastSurvivor` coerces `?? null`.
- D10: turn walk via `turnRowByTurn` map; turns `1..turnCount`; turn
  0 synthetic and NOT emitted.
- D11: `listMatches` joins characters server-side.
- D12: evac merge — centre + revealedAtTurn from worldState; zone
  from MapDescriptor.
- D13: dead-character equipped/hp carry-forward last-seen
  `agentRecords.input.status`; D-P2-11 invariant scope is
  `EntitySnapshot` only.

---

## 8. Recommended Job Sequence

Strict dispatch order optimising for parallelism + minimum back-and-forth:

```
T+0:    dispatch WP1-implement  (engineer, ~6-10h)
T+6h:   WP1 contract types committed → dispatch WP2-implement (engineer, ~4-6h)
T+10h:  WP1 finishes → dispatch WP1-review (reviewer, ~2h)
T+12h:  WP2 finishes → dispatch WP2-review (reviewer, ~1h)
T+13h:  WP1+WP2 reviewed → dispatch WP3-implement AND WP4-implement IN PARALLEL
        (two engineers, ~8h each; WP4 stubs against the shared API surface
        WP3 publishes early in its commit history per §4 — `CameraRig.anchor_changed`,
        `CameraRig.mode_changed`, `PlaybackClock.turn_changed`,
        `PlaybackClock.current_turn` getter, AppState snapshot Dictionary)
T+21h:  WP3+WP4 finish → dispatch FINAL-REVIEW across all four WPs (reviewer, ~3h)
T+24h:  ASSIGNMENT COMPLETE → user runs visual UAT themselves
```

**🚫 No `uat` job at any point in this sequence.** Reviewer is the
validation layer.

If single-engineer-at-a-time is preferred, fall back to strict serial
WP1 → WP2 → WP3 → WP4 with reviewer pass between each.

---

## 9. References

- `docs/project/spec/mental-model.md` §10 — throwaway posture,
  consumer-render gating, diagnostics-target-agents
- `docs/project/spec/mental-model.md` §13 — consumer replay render art
  direction, side-pane separation, niche-art positioning, substrate
  flip JS→WASM, hybrid renderer/data architecture, match-data
  contract, completed-only-first
- `docs/project/phases/render-rnd/round-2-closing-readout.md` — R&D
  close, substrate ratification, per-arm scorecards
- `throwaway-prototypes/c-godot-wasm/` — structural template
- `throwaway-prototypes/shared-harness/replay-snapshot.json` — shape
  template for the contract
- `apps/replay/src/lib/reconstruct.ts` — reconstruction logic (moves
  to `convex/replay/reconstruct.ts` in WP1)
- `maps/*.json` — 5-map pool (reference, split-basin, crosswind,
  market-maze, faultline)
- `convex/replay.ts` — existing in-process queries the HTTP actions
  delegate to (`listMatches`, `getReplayBundle`)
- `convex/engine/map.ts` — existing map registry / descriptor helpers
- `convex/schema.ts` — canonical data shapes the snapshot builder
  reads
