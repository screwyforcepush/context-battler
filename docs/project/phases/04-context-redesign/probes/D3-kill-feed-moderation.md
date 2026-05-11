# D3 Kill Feed Moderation Probe Artifact

Date: 2026-05-11

Scope: renderer-output artifact only. This probe generated sample kill-feed
lines through `buildKillFeedLines(prev, state)` with synthetic
`resolution.actions[]` and `deaths[]` fixtures. It did not call Azure, an LLM,
or any moderation API.

## Verdict

Moderation pre-flight verdict: renderer wording is ready for user review. The
sample surface is the canonical `<killer> killed <victim> with <weapon>` shape
from `docs/project/spec/per-turn-context-intent.md` section 3. No Azure
requests were sent for this artifact, so this records renderer wording only and
does not claim a `content_filter_blocked` pass rate.

Coverage included:

- Weapons: `rusty_blade`, `sword`, `axe`, `greatsword`, and `bare hands`.
- Trace kinds: direct `attack`, offensive overwatch
  (`kind: "overwatch", stance: "offensive"`), and defensive overwatch
  (`kind: "overwatch", fromOverwatch: true, stance: "defensive"`).
- Attribution edges: multi-attacker first-crossing cases, exact-threshold
  crossing, blank or missing `weapon` fallback to `bare hands`, mixed multiple
  deaths, and both display-name and character-id target resolution.

## Generator Invocation

Successful invocation used:

```bash
npx tsx <<'JS'
import { buildKillFeedLines } from "./convex/llm/inputBuilder.ts";

function character(n, hp) {
  return {
    characterId: `P${n}`,
    personaId: "rat",
    spawnIndex: n - 1,
    displayName: `Player_${n}`,
    hp,
    maxHp: 50,
    pos: { x: n, y: n },
    equipped: {},
    scratchpad: "",
    hidden: false,
    alive: hp > 0,
    lastKnown: [],
  };
}

function state(finalHpByVictim) {
  return {
    matchId: "D3-kill-feed-moderation-probe",
    turn: 44,
    rngSeed: "D3-synthetic",
    world: {
      size: { w: 100, h: 100 },
      walls: [],
      coverTiles: [],
      chests: [],
      corpses: [],
      evac: { centre: { x: 50, y: 50 }, revealedAtTurn: 30 },
    },
    characters: Array.from({ length: 8 }, (_, i) => {
      const n = i + 1;
      return character(n, finalHpByVictim[n] ?? 50);
    }),
  };
}

function action(s) {
  const target = s.targetAs === "characterId" ? `P${s.victim}` : `Player_${s.victim}`;
  const overwatch = s.kind !== "attack";
  return {
    characterId: `P${s.actor}`,
    kind: overwatch ? "overwatch" : "attack",
    target,
    result: `dmg ${s.damage}`,
    ...(s.kind === "overwatch-offensive" ? { stance: "offensive" } : {}),
    ...(s.kind === "overwatch-defensive" ? { fromOverwatch: true, stance: "defensive" } : {}),
    ...(s.weapon !== undefined ? { weapon: s.weapon } : {}),
  };
}

function renderFixture(fixture) {
  const prev = {
    resolution: {
      consumed: [],
      speech: [],
      moves: [],
      visibilityUpdates: [],
      actions: fixture.strikes.map(action),
      deaths: fixture.deaths.map((n) => `P${n}`),
    },
  };
  const lines = buildKillFeedLines(prev, state(fixture.finalHpByVictim));
  if (lines.length !== fixture.deaths.length) {
    throw new Error(`${fixture.label}: expected ${fixture.deaths.length} lines, got ${lines.length}`);
  }
  return lines;
}

const singleWeapons = ["rusty_blade", "sword", "axe", "greatsword", undefined];
const singleKinds = ["attack", "overwatch-offensive", "overwatch-defensive"];
const fixtures = [];
let fixtureId = 1;
for (const kind of singleKinds) {
  for (const weapon of singleWeapons) {
    const victim = ((fixtureId - 1) % 8) + 1;
    const actor = (victim % 8) + 1;
    fixtures.push({
      label: `single-${fixtureId}`,
      finalHpByVictim: { [victim]: 0 },
      deaths: [victim],
      strikes: [{ actor, victim, damage: 50, kind, weapon }],
    });
    fixtureId += 1;
  }
}

fixtures.push(
  {
    label: "multi-attack-third-crosses-rusty-blade",
    finalHpByVictim: { 1: -7 },
    deaths: [1],
    strikes: [
      { actor: 2, victim: 1, damage: 12, kind: "attack", weapon: "sword" },
      { actor: 3, victim: 1, damage: 20, kind: "attack", weapon: "axe" },
      { actor: 4, victim: 1, damage: 25, kind: "attack", weapon: "rusty_blade" },
    ],
  },
  {
    label: "multi-attack-second-crosses-greatsword",
    finalHpByVictim: { 2: -10 },
    deaths: [2],
    strikes: [
      { actor: 5, victim: 2, damage: 15, kind: "attack", weapon: "rusty_blade" },
      { actor: 6, victim: 2, damage: 35, kind: "attack", weapon: "greatsword" },
      { actor: 7, victim: 2, damage: 10, kind: "attack", weapon: "axe" },
    ],
  },
  {
    label: "multi-first-exact-crossing-keeps-first-killer",
    finalHpByVictim: { 3: -20 },
    deaths: [3],
    strikes: [
      { actor: 8, victim: 3, damage: 50, kind: "attack", weapon: "sword" },
      { actor: 1, victim: 3, damage: 20, kind: "attack", weapon: "greatsword" },
    ],
  },
  {
    label: "multi-offensive-overwatch-crosses",
    finalHpByVictim: { 4: -5 },
    deaths: [4],
    strikes: [
      { actor: 1, victim: 4, damage: 20, kind: "attack", weapon: "rusty_blade" },
      { actor: 2, victim: 4, damage: 35, kind: "overwatch-offensive", weapon: "axe" },
    ],
  },
  {
    label: "multi-defensive-overwatch-crosses",
    finalHpByVictim: { 5: -5 },
    deaths: [5],
    strikes: [
      { actor: 3, victim: 5, damage: 15, kind: "attack", weapon: "sword" },
      { actor: 4, victim: 5, damage: 40, kind: "overwatch-defensive", weapon: "greatsword" },
    ],
  },
  {
    label: "multi-bare-hands-crosses-with-blank-weapon",
    finalHpByVictim: { 6: -3 },
    deaths: [6],
    strikes: [
      { actor: 5, victim: 6, damage: 30, kind: "attack", weapon: "axe" },
      { actor: 7, victim: 6, damage: 23, kind: "attack", weapon: "" },
    ],
  },
  {
    label: "multi-character-id-target-resolution",
    finalHpByVictim: { 7: -2 },
    deaths: [7],
    strikes: [
      { actor: 8, victim: 7, damage: 18, kind: "attack", weapon: "rusty_blade", targetAs: "characterId" },
      { actor: 1, victim: 7, damage: 34, kind: "attack", weapon: "sword", targetAs: "characterId" },
    ],
  },
  {
    label: "multi-defensive-bare-hands-crosses",
    finalHpByVictim: { 8: -4 },
    deaths: [8],
    strikes: [
      { actor: 2, victim: 8, damage: 26, kind: "attack", weapon: "axe" },
      { actor: 3, victim: 8, damage: 28, kind: "overwatch-defensive" },
    ],
  },
  {
    label: "multi-offensive-greatsword-crosses-after-bare-hands-chip",
    finalHpByVictim: { 1: -6 },
    deaths: [1],
    strikes: [
      { actor: 6, victim: 1, damage: 25, kind: "attack" },
      { actor: 7, victim: 1, damage: 31, kind: "overwatch-offensive", weapon: "greatsword" },
    ],
  },
  {
    label: "multi-attack-axe-crosses-after-two-chips",
    finalHpByVictim: { 2: -8 },
    deaths: [2],
    strikes: [
      { actor: 1, victim: 2, damage: 10, kind: "attack", weapon: "rusty_blade" },
      { actor: 3, victim: 2, damage: 17, kind: "overwatch-offensive", weapon: "sword" },
      { actor: 4, victim: 2, damage: 31, kind: "attack", weapon: "axe" },
    ],
  },
  {
    label: "multi-sword-crosses-on-defensive-response",
    finalHpByVictim: { 3: -1 },
    deaths: [3],
    strikes: [
      { actor: 5, victim: 3, damage: 22, kind: "attack", weapon: "greatsword" },
      { actor: 6, victim: 3, damage: 29, kind: "overwatch-defensive", weapon: "sword" },
    ],
  },
  {
    label: "multi-rusty-blade-crosses-after-overwatch-chip",
    finalHpByVictim: { 4: -2 },
    deaths: [4],
    strikes: [
      { actor: 7, victim: 4, damage: 21, kind: "overwatch-offensive", weapon: "axe" },
      { actor: 8, victim: 4, damage: 31, kind: "attack", weapon: "rusty_blade" },
    ],
  },
  {
    label: "multi-bare-hands-crosses-from-missing-weapon-overwatch",
    finalHpByVictim: { 5: -9 },
    deaths: [5],
    strikes: [
      { actor: 1, victim: 5, damage: 24, kind: "attack", weapon: "sword" },
      { actor: 2, victim: 5, damage: 35, kind: "overwatch-offensive" },
    ],
  },
  {
    label: "multi-greatsword-exact-crossing",
    finalHpByVictim: { 6: -15 },
    deaths: [6],
    strikes: [
      { actor: 3, victim: 6, damage: 19, kind: "attack", weapon: "axe" },
      { actor: 4, victim: 6, damage: 31, kind: "attack", weapon: "greatsword" },
      { actor: 5, victim: 6, damage: 15, kind: "overwatch-defensive", weapon: "rusty_blade" },
    ],
  },
  {
    label: "multi-two-deaths-order-attack-then-overwatch",
    finalHpByVictim: { 7: 0, 8: 0 },
    deaths: [7, 8],
    strikes: [
      { actor: 6, victim: 7, damage: 50, kind: "attack", weapon: "axe" },
      { actor: 5, victim: 8, damage: 50, kind: "overwatch-offensive", weapon: "sword" },
    ],
  },
  {
    label: "multi-two-deaths-defensive-and-bare-hands",
    finalHpByVictim: { 1: 0, 2: 0 },
    deaths: [1, 2],
    strikes: [
      { actor: 4, victim: 1, damage: 50, kind: "overwatch-defensive", weapon: "greatsword" },
      { actor: 8, victim: 2, damage: 50, kind: "attack" },
    ],
  },
  {
    label: "multi-three-deaths-mixed-kinds",
    finalHpByVictim: { 3: 0, 4: 0, 5: 0 },
    deaths: [3, 4, 5],
    strikes: [
      { actor: 1, victim: 3, damage: 50, kind: "attack", weapon: "rusty_blade" },
      { actor: 2, victim: 4, damage: 50, kind: "overwatch-offensive", weapon: "axe" },
      { actor: 6, victim: 5, damage: 50, kind: "overwatch-defensive", weapon: "sword" },
    ],
  },
);

while (fixtures.reduce((sum, fixture) => sum + fixture.deaths.length, 0) < 50) {
  const index = fixtures.length + 1;
  const victim = ((index + 2) % 8) + 1;
  const actor = ((victim + 3) % 8) + 1;
  const weapon = singleWeapons[index % singleWeapons.length];
  const kind = singleKinds[index % singleKinds.length];
  fixtures.push({
    label: `filler-${index}`,
    finalHpByVictim: { [victim]: 0 },
    deaths: [victim],
    strikes: [{ actor, victim, damage: 50, kind, weapon }],
  });
}

const lines = fixtures.flatMap(renderFixture);
if (lines.length !== 50) {
  throw new Error(`expected 50 sample lines, got ${lines.length}`);
}
console.log(lines.join("\n"));
JS
```

## Sample Lines

Line count: 50.

```text
Player_2 killed Player_1 with rusty_blade
Player_3 killed Player_2 with sword
Player_4 killed Player_3 with axe
Player_5 killed Player_4 with greatsword
Player_6 killed Player_5 with bare hands
Player_7 killed Player_6 with rusty_blade
Player_8 killed Player_7 with sword
Player_1 killed Player_8 with axe
Player_2 killed Player_1 with greatsword
Player_3 killed Player_2 with bare hands
Player_4 killed Player_3 with rusty_blade
Player_5 killed Player_4 with sword
Player_6 killed Player_5 with axe
Player_7 killed Player_6 with greatsword
Player_8 killed Player_7 with bare hands
Player_4 killed Player_1 with rusty_blade
Player_6 killed Player_2 with greatsword
Player_8 killed Player_3 with sword
Player_2 killed Player_4 with axe
Player_4 killed Player_5 with greatsword
Player_7 killed Player_6 with bare hands
Player_1 killed Player_7 with sword
Player_3 killed Player_8 with bare hands
Player_7 killed Player_1 with greatsword
Player_4 killed Player_2 with axe
Player_6 killed Player_3 with sword
Player_8 killed Player_4 with rusty_blade
Player_2 killed Player_5 with bare hands
Player_4 killed Player_6 with greatsword
Player_6 killed Player_7 with axe
Player_5 killed Player_8 with sword
Player_4 killed Player_1 with greatsword
Player_8 killed Player_2 with bare hands
Player_1 killed Player_3 with rusty_blade
Player_2 killed Player_4 with axe
Player_6 killed Player_5 with sword
Player_8 killed Player_4 with greatsword
Player_1 killed Player_5 with bare hands
Player_2 killed Player_6 with rusty_blade
Player_3 killed Player_7 with sword
Player_4 killed Player_8 with axe
Player_5 killed Player_1 with greatsword
Player_6 killed Player_2 with bare hands
Player_7 killed Player_3 with rusty_blade
Player_8 killed Player_4 with sword
Player_1 killed Player_5 with axe
Player_2 killed Player_6 with greatsword
Player_3 killed Player_7 with bare hands
Player_4 killed Player_8 with rusty_blade
Player_5 killed Player_1 with sword
```
