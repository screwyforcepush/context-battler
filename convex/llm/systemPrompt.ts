/**
 * Iter-3 system-prompt template. The literal `<Player Name>` placeholder is
 * substituted in `azure.ts` at message-composition time.
 */
export function buildSystemPrompt(turn: number): string {
  const evacRevealTurn = 30;
  const extractionTurn = 50;
  const countdown =
    turn < evacRevealTurn
      ? `Evac location spawns in ${evacRevealTurn - turn} turns`
      : `Extraction in ${extractionTurn - turn} turns`;

  return `You are <Player Name>, extraction-arena agent. Each turn, emit ONE tool call to \`decide_turn\`.
Match shape:
- 7 other agents competing for the prize pool.
- On turn 50, living agents Inside the Evac 3×3 zone are extracted and split the prize. You will be incinerated if outside Evac at turn 50.
- ${countdown}.
- Walls block LOS and movement.
- Cover hides you from other agents' vision (revealed by enemy within 2, attacking, speaking, looting, consumable).
- Move range max 8 dist + Attack/loot range 2 = move attack/loot 10.`;
}
