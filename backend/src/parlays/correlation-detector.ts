import { MarketPrediction, MarketType } from '../types/football.js';

/**
 * Validates that candidate parlay legs do not have duplicate fixtures or correlated outcomes.
 */

// Conflicting or mutually correlated pairs within same or related events
const CONFLICTING_MARKETS: Record<MarketType, MarketType[]> = {
  HOME_WIN: ['DRAW', 'AWAY_WIN', 'DOUBLE_CHANCE_X2', 'UNDER_1_5' as MarketType],
  DRAW: ['HOME_WIN', 'AWAY_WIN', 'DOUBLE_CHANCE_12'],
  AWAY_WIN: ['HOME_WIN', 'DRAW', 'DOUBLE_CHANCE_1X', 'UNDER_1_5' as MarketType],
  OVER_0_5: [],
  OVER_1_5: ['UNDER_2_5', 'UNDER_3_5'],
  OVER_2_5: ['UNDER_2_5', 'UNDER_3_5'],
  UNDER_2_5: ['OVER_1_5', 'OVER_2_5', 'OVER_3_5'],
  OVER_3_5: ['UNDER_2_5', 'UNDER_3_5'],
  UNDER_3_5: ['OVER_2_5', 'OVER_3_5'],
  BTTS_YES: ['BTTS_NO'],
  BTTS_NO: ['BTTS_YES'],
  DOUBLE_CHANCE_1X: ['AWAY_WIN'],
  DOUBLE_CHANCE_X2: ['HOME_WIN'],
  DOUBLE_CHANCE_12: ['DRAW'],
  HOME_OVER_0_5: [],
  AWAY_OVER_0_5: [],
  HT_OVER_0_5: [],
  HT_DRAW: [],
  OVER_5_5_CORNERS: [],
  OVER_7_5_CORNERS: [],
  OVER_8_5_CORNERS: ['UNDER_8_5_CORNERS'],
  UNDER_8_5_CORNERS: ['OVER_8_5_CORNERS', 'OVER_9_5_CORNERS'],
  OVER_9_5_CORNERS: ['UNDER_8_5_CORNERS'],
  UNDER_11_5_CORNERS: ['OVER_8_5_CORNERS', 'OVER_9_5_CORNERS'],
  OVER_2_5_CARDS: ['UNDER_4_5_CARDS'],
  OVER_3_5_CARDS: ['UNDER_4_5_CARDS'],
  OVER_4_5_CARDS: ['UNDER_4_5_CARDS', 'UNDER_5_5_CARDS'],
  UNDER_4_5_CARDS: ['OVER_4_5_CARDS', 'OVER_3_5_CARDS'],
  UNDER_5_5_CARDS: ['OVER_3_5_CARDS', 'OVER_4_5_CARDS'],
};

export function areMarketsConflicting(mA: MarketType, mB: MarketType): boolean {
  if (mA === mB) return true; // duplicate market
  const conflictsA = CONFLICTING_MARKETS[mA] || [];
  const conflictsB = CONFLICTING_MARKETS[mB] || [];
  return conflictsA.includes(mB) || conflictsB.includes(mA);
}

export function areLegsCorrelated(legA: MarketPrediction, legB: MarketPrediction): boolean {
  // Rule 1: STRICT - Never allow two selections from the SAME fixture in independent mode!
  if (legA.fixtureId === legB.fixtureId) {
    return true;
  }
  return false;
}

export function filterNonCorrelatedPredictions(predictions: MarketPrediction[]): MarketPrediction[] {
  const seenFixtures = new Set<string>();
  const filtered: MarketPrediction[] = [];

  // Sort by highest calibrated probability first to take the most reliable selection per match
  const sorted = [...predictions].sort((a, b) => b.estimatedProbability - a.estimatedProbability);

  for (const pred of sorted) {
    if (!seenFixtures.has(pred.fixtureId)) {
      seenFixtures.add(pred.fixtureId);
      filtered.push(pred);
    }
  }

  return filtered;
}
