/**
 * Curated intent bonuses as a final ranking band.
 *
 * Kept separate from the BM25/vector pipeline: this is product routing policy
 * (which tool family should surface for a known intent), not retrieval math.
 */
export function applyIntentBonusBandToScores(
  scores: Float64Array,
  docCount: number,
  docNameIndex: ReadonlyMap<string, number>,
  intentToolBonuses: ReadonlyMap<string, number>,
): void {
  if (intentToolBonuses.size === 0) return;

  let maxScore = 0;
  for (let i = 0; i < docCount; i++) {
    maxScore = Math.max(maxScore, scores[i]!);
  }

  let maxBonus = 0;
  for (const bonus of intentToolBonuses.values()) {
    maxBonus = Math.max(maxBonus, bonus);
  }
  if (maxBonus <= 0) return;

  const bonusBand = Math.max(1, maxScore + 1);
  const distinctBonuses = [
    ...new Set([...intentToolBonuses.values()].filter((bonus) => bonus > 0)),
  ].toSorted((a, b) => a - b);
  const bonusTierByValue = new Map<number, number>();
  for (let i = 0; i < distinctBonuses.length; i++) {
    bonusTierByValue.set(distinctBonuses[i]!, i + 1);
  }

  for (const [toolName, bonus] of intentToolBonuses) {
    if (bonus <= 0) continue;
    const docIndex = docNameIndex.get(toolName);
    if (docIndex === undefined) continue;
    const tier = bonusTierByValue.get(bonus);
    if (tier === undefined) continue;
    scores[docIndex]! += bonusBand * tier;
  }
}
