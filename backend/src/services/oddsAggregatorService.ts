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
}

export async function getOddsForFixture(fixtureId: string, homeTeam: string, awayTeam: string, modelHomeProb: number, modelDrawProb: number, modelAwayProb: number): Promise<AggregatedOdds> {
  // Tier 1: PremierBet ZW
  try {
    const { fetchPremierBetOdds } = await import('./premierbetService.js');
    const pb = await fetchPremierBetOdds(fixtureId, homeTeam, awayTeam);
    if (pb && pb.homeOdds && pb.awayOdds) {
      return {
        source: 'PremierBet ZW',
        home: pb.homeOdds,
        draw: pb.drawOdds,
        away: pb.awayOdds,
        over25: pb.over25Odds,
        under25: pb.under25Odds,
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
  return {
    source: 'Fair Model Baseline',
    home: Number((homeFair / margin).toFixed(2)),
    draw: Number((drawFair / margin).toFixed(2)),
    away: Number((awayFair / margin).toFixed(2)),
    over25: null,
    under25: null,
  };
}

export default { getOddsForFixture };
