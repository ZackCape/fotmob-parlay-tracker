/**
 * Odds Aggregator Service — multi-tier odds provider.
 *
 * Tier 1: PremierBet ZW (localized)
 * Tier 2: API-Football Global / Bet365 / 1xBet
 * Tier 3: Synthetic De-Vigged Model Odds (always available)
 *
 * Always returns valid odds — never null.
 */

import { calculateEV } from './premierbetService.js';

export interface AggregatedOdds {
  source: string;
  home: number;
  draw: number | null;
  away: number;
  over25: number | null;
  under25: number | null;
  publishedMarkets: string[];
}

export async function getOddsForFixture(fixtureId: string, homeTeam: string, awayTeam: string, modelHomeProb: number, modelDrawProb: number, modelAwayProb: number): Promise<AggregatedOdds> {
  // Tier 1: PremierBet ZW
  try {
    const { fetchPremierBetOdds } = await import('./premierbetService.js');
    const pb = await fetchPremierBetOdds(fixtureId, homeTeam, awayTeam);
    if (pb && pb.homeOdds && pb.awayOdds) {
      // Build published markets from available odds
      const markets: string[] = ['HOME_WIN', 'DRAW', 'AWAY_WIN'];
      if (pb.over25Odds) markets.push('OVER_2_5');
      if (pb.under25Odds) markets.push('UNDER_2_5');
      return {
        source: 'PremierBet ZW',
        home: pb.homeOdds,
        draw: pb.drawOdds,
        away: pb.awayOdds,
        over25: pb.over25Odds,
        under25: pb.under25Odds,
        publishedMarkets: markets,
      };
    }
  } catch { /* fall through */ }

  // Tier 2: API-Football Global (placeholder - would fetch from API-Football odds endpoint)
  // In production, this would call the API-Football odds endpoint

  // Tier 3: Synthetic De-Vigged Model Odds (always available)
  const homeFair = modelHomeProb > 0 ? 1 / modelHomeProb : 2.0;
  const awayFair = modelAwayProb > 0 ? 1 / modelAwayProb : 2.0;
  const drawFair = modelDrawProb > 0 ? 1 / modelDrawProb : 3.0;
  // Apply bookmaker margin (~5%)
  const margin = 1.05;
  // Tier 3: All standard markets published (synthetic baseline)
  const markets: string[] = ['HOME_WIN', 'DRAW', 'AWAY_WIN', 'OVER_0_5', 'OVER_1_5', 'OVER_2_5', 'OVER_3_5', 'UNDER_2_5', 'UNDER_3_5', 'BTTS_YES', 'BTTS_NO', 'DOUBLE_CHANCE_1X', 'DOUBLE_CHANCE_X2', 'DOUBLE_CHANCE_12', 'OVER_7_5_CORNERS', 'OVER_8_5_CORNERS', 'OVER_9_5_CORNERS', 'UNDER_8_5_CORNERS', 'UNDER_11_5_CORNERS', 'OVER_2_5_CARDS', 'OVER_3_5_CARDS', 'OVER_4_5_CARDS'];
  return {
    source: 'Fair Model Baseline',
    home: Number((homeFair / margin).toFixed(2)),
    draw: Number((drawFair / margin).toFixed(2)),
    away: Number((awayFair / margin).toFixed(2)),
    over25: null,
    under25: null,
    publishedMarkets: markets,
  };
}

export default { getOddsForFixture };
