/**
 * Tier Disparity Service — contextual strength-of-schedule and league quality.
 *
 * Moves beyond raw unweighted goals by applying opponent-adjusted form
 * ratings, league quality coefficients, and cross-league experience penalties.
 */

export interface LeagueTier {
  league: string;
  qualityIndex: number; // Q_L in [0.5, 2.0]
  tier: 1 | 2 | 3 | 4;
}

export interface OpponentAdjustedForm {
  home: number;
  away: number;
  homeTier: number;
  awayTier: number;
  disparity: number;
  matchDynamic: string;
}

// League quality coefficients
const LEAGUE_QUALITY: Record<string, { q: number; tier: 1 | 2 | 3 | 4 }> = {
  EPL: { q: 1.95, tier: 1 },
  LALIGA: { q: 1.90, tier: 1 },
  SERIE_A: { q: 1.88, tier: 1 },
  BUNDESLIGA: { q: 1.92, tier: 1 },
  CHAMPIONS_LEAGUE: { q: 2.00, tier: 1 },
  LIGUE1: { q: 1.60, tier: 2 },
  EREDIVISIE: { q: 1.55, tier: 2 },
  PRIMEIRA_LIGA: { q: 1.50, tier: 2 },
  CHAMPIONSHIP: { q: 1.45, tier: 2 },
  EUROPA_LEAGUE: { q: 1.65, tier: 2 },
  PRO_LEAGUE: { q: 1.35, tier: 3 },
  SWISS_SUPER: { q: 1.30, tier: 3 },
  CONFERENCE_LEAGUE: { q: 1.40, tier: 3 },
  AUSTRIAN_BUNDESLIGA: { q: 1.25, tier: 3 },
  DANISH_SUPERLIGA: { q: 1.20, tier: 3 },
  SUPER_LIG: { q: 1.30, tier: 3 },
  SCOTTISH_PREM: { q: 1.25, tier: 3 },
  EKSTRAKLASA: { q: 1.15, tier: 3 },
  // Women's
  WSL: { q: 1.40, tier: 3 },
  NWSL: { q: 1.35, tier: 3 },
  UWCL: { q: 1.60, tier: 2 },
  LIGA_F: { q: 1.30, tier: 3 },
  FRAUEN_BL: { q: 1.35, tier: 3 },
  PL_WOMEN: { q: 1.25, tier: 3 },
  // International
  FIFA_WC: { q: 2.00, tier: 1 },
  UEFA_EUROS: { q: 1.90, tier: 1 },
  AFCON: { q: 1.50, tier: 2 },
  COPA_AMERICA: { q: 1.80, tier: 1 },
  UNL: { q: 1.70, tier: 2 },
  // Lower tier
  EFL_1: { q: 1.00, tier: 4 },
  EFL_2: { q: 0.90, tier: 4 },
  ACL: { q: 1.30, tier: 3 },
  INTL_FRIENDLIES: { q: 1.00, tier: 4 },
};

const DEFAULT_TIER: { q: number; tier: 1 | 2 | 3 | 4 } = { q: 1.0, tier: 4 };

export function getLeagueQuality(league: string): { q: number; tier: 1 | 2 | 3 | 4 } {
  return LEAGUE_QUALITY[league?.toUpperCase()] ?? DEFAULT_TIER;
}

const WEIGHTS = [0.35, 0.25, 0.20, 0.12, 0.08];

function resultScore(result: 'W' | 'D' | 'L'): number {
  return result === 'W' ? 1.0 : result === 'D' ? 0.5 : 0.0;
}

export function calculateOpponentAdjustedForm(
  homeResults: Array<{ result: 'W' | 'D' | 'L'; opponentLeague: string }>,
  awayResults: Array<{ result: 'W' | 'D' | 'L'; opponentLeague: string }>,
): OpponentAdjustedForm {
  const homeTier = getLeagueQuality(homeResults[0]?.opponentLeague ?? '').tier;
  const awayTier = getLeagueQuality(awayResults[0]?.opponentLeague ?? '').tier;

  let homeForm = 0;
  for (let i = 0; i < Math.min(5, homeResults.length); i++) {
    const r = homeResults[i];
    const q = getLeagueQuality(r.opponentLeague).q;
    homeForm += WEIGHTS[i] * resultScore(r.result) * q;
  }

  let awayForm = 0;
  for (let i = 0; i < Math.min(5, awayResults.length); i++) {
    const r = awayResults[i];
    const q = getLeagueQuality(r.opponentLeague).q;
    awayForm += WEIGHTS[i] * resultScore(r.result) * q;
  }

  const homeQ = getLeagueQuality(homeResults[0]?.opponentLeague ?? '').q;
  const awayQ = getLeagueQuality(awayResults[0]?.opponentLeague ?? '').q;
  const disparity = Math.abs(homeQ - awayQ);

  let matchDynamic = 'Balanced matchup';
  if (disparity >= 0.60) matchDynamic = 'David vs Goliath - Elite dominance expected';
  else if (disparity >= 0.30) matchDynamic = 'Moderate tier disparity';
  else if (disparity >= 0.15) matchDynamic = 'Slight tier advantage';

  return {
    home: Number(homeForm.toFixed(3)),
    away: Number(awayForm.toFixed(3)),
    homeTier: homeQ,
    awayTier: awayQ,
    disparity: Number(disparity.toFixed(3)),
    matchDynamic,
  };
}

export function getEuropeanExperiencePenalty(team: string, europeanMatches: number): number {
  // Teams with limited European experience get a penalty
  if (europeanMatches <= 0) return 0.75; // 25% penalty
  if (europeanMatches <= 3) return 0.85; // 15% penalty
  if (europeanMatches <= 6) return 0.92; // 8% penalty
  return 1.0; // No penalty
}

export default { getLeagueQuality, calculateOpponentAdjustedForm, getEuropeanExperiencePenalty };
