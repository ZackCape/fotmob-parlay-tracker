/**
 * PremierBet Zimbabwe odds aggregator.
 *
 * Fetches and parses odds and market lines from PremierBet Zimbabwe,
 * mapping team names and fixture IDs to our internal match feed format.
 */

export interface PremierBetOdds {
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  homeOdds: number | null;
  drawOdds: number | null;
  awayOdds: number | null;
  over25Odds: number | null;
  under25Odds: number | null;
  source: string;
}

export async function fetchPremierBetOdds(fixtureId: string, homeTeam: string, awayTeam: string): Promise<PremierBetOdds | null> {
  // In production, this would fetch from premierbet.co.zw / premierbet.com/zw
  // For now, return a structured placeholder that maps to our format
  try {
    // Attempt to fetch from PremierBet API endpoint
    const url = `https://www.premierbet.com/zw/api/odds/${encodeURIComponent(homeTeam)}-vs-${encodeURIComponent(awayTeam)}`;
    // Note: This is a placeholder - actual implementation would parse PremierBet's response
    return {
      fixtureId,
      homeTeam,
      awayTeam,
      homeOdds: null,
      drawOdds: null,
      awayOdds: null,
      over25Odds: null,
      under25Odds: null,
      source: 'PremierBet Zimbabwe',
    };
  } catch {
    return null;
  }
}

export function mapPremierBetFixture(pbFixture: any): { homeTeam: string; awayTeam: string; league: string } | null {
  if (!pbFixture) return null;
  return {
    homeTeam: pbFixture.homeTeam || pbFixture.home || '',
    awayTeam: pbFixture.awayTeam || pbFixture.away || '',
    league: pbFixture.league || pbFixture.competition || 'Unknown',
  };
}

export function calculateEV(modelProb: number, bookmakerOdds: number): number {
  if (!Number.isFinite(modelProb) || !Number.isFinite(bookmakerOdds) || bookmakerOdds <= 1) return 0;
  const impliedProb = 1 / bookmakerOdds;
  return Number(((modelProb - impliedProb) * 100).toFixed(2));
}

export default { fetchPremierBetOdds, mapPremierBetFixture, calculateEV };
