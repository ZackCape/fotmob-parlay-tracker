/**
 * Human Logic Engine — rule-based heuristics mimicking experienced handicappers.
 *
 * Applies David vs Goliath compression, motivation/rotation profiling,
 * and head-to-head domain context to raw model probabilities.
 */

export interface MatchContext {
  homeTeam: string;
  awayTeam: string;
  homeLeague: string;
  awayLeague: string;
  isCupMatch: boolean;
  isEuropeanKnockout: boolean;
  homeEuropeanMatches: number;
  awayEuropeanMatches: number;
  homeForm: Array<'W' | 'D' | 'L'>;
  awayForm: Array<'W' | 'D' | 'L'>;
  h2hResults: Array<{ homeGoals: number; awayGoals: number }>;
}

export interface HumanLogicResult {
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
  homeXg: number;
  awayXg: number;
  cornerBias: 'high' | 'medium' | 'low';
  matchDynamic: string;
  adjustments: string[];
  topPick: string;
}

import { getLeagueQuality, getEuropeanExperiencePenalty } from './tierDisparityService.js';

const ELITE_TEAMS = new Set([
  'real madrid', 'barcelona', 'bayern munich', 'bayern', 'manchester city', 'man city',
  'psg', 'liverpool', 'arsenal', 'chelsea', 'manchester united', 'man united',
  'juventus', 'inter milan', 'ac milan', 'atletico madrid', 'borussia dortmund',
  'napoli', 'tottenham', 'newcastle',
]);

function isElite(team: string): boolean {
  return ELITE_TEAMS.has(team.toLowerCase());
}

export function applyHumanLogic(ctx: MatchContext, baseHomeProb: number, baseDrawProb: number, baseAwayProb: number, baseHomeXg: number, baseAwayXg: number): HumanLogicResult {
  const adjustments: string[] = [];
  const homeQ = getLeagueQuality(ctx.homeLeague);
  const awayQ = getLeagueQuality(ctx.awayLeague);
  const disparity = Math.abs(homeQ.q - awayQ.q);

  let homeProb = baseHomeProb;
  let drawProb = baseDrawProb;
  let awayProb = baseAwayProb;
  let homeXg = baseHomeXg;
  let awayXg = baseAwayXg;
  let cornerBias: 'high' | 'medium' | 'low' = 'medium';

  // 1. David vs Goliath Defensive Compression
  if (disparity >= 0.60) {
    const lowerIsHome = homeQ.q < awayQ.q;
    const lowerTeam = lowerIsHome ? ctx.homeTeam : ctx.awayTeam;
    const higherTeam = lowerIsHome ? ctx.awayTeam : ctx.homeTeam;

    // Cap lower-tier team xG
    const lowerXg = lowerIsHome ? homeXg : awayXg;
    const cappedXg = Math.min(lowerXg, 0.85);
    if (lowerIsHome) homeXg = cappedXg;
    else awayXg = cappedXg;

    // Set win probability floor for higher-tier team
    const higherProb = lowerIsHome ? awayProb : homeProb;
    const floorProb = Math.max(higherProb, 0.65);
    if (lowerIsHome) awayProb = floorProb;
    else homeProb = floorProb;

    // Re-normalize probabilities while preserving the floor
    const total = homeProb + drawProb + awayProb;
    if (total > 1) {
      const scale = (1 - Math.max(homeProb, awayProb, 0.65)) / (total - Math.max(homeProb, awayProb, 0.65));
      if (homeProb < awayProb) {
        homeProb *= scale;
        drawProb *= scale;
      } else {
        awayProb = Math.max(awayProb, 0.65);
        const rem = 1 - awayProb;
        const subTotal = homeProb + drawProb;
        if (subTotal > 0) {
          homeProb = rem * (homeProb / subTotal);
          drawProb = rem * (drawProb / subTotal);
        }
      }
    } else {
      homeProb /= total;
      drawProb /= total;
      awayProb /= total;
    }

    cornerBias = 'high';
    adjustments.push(`David vs Goliath: ${higherTeam} territorial dominance expected (High Corner/Possession bias)`);
    adjustments.push(`Lower-tier ${lowerTeam} xG capped at ${cappedXg.toFixed(2)}`);
    adjustments.push(`Elite ${higherTeam} win probability floor set to ${(floorProb * 100).toFixed(0)}%`);

    // European experience penalty for lower-tier team
    const lowerEuropean = lowerIsHome ? ctx.homeEuropeanMatches : ctx.awayEuropeanMatches;
    const penalty = getEuropeanExperiencePenalty(lowerTeam, lowerEuropean);
    if (penalty < 1.0) {
      if (lowerIsHome) homeXg *= penalty;
      else awayXg *= penalty;
      adjustments.push(`Out-of-Depth penalty: ${lowerTeam} European experience limited (${(penalty * 100).toFixed(0)}% multiplier)`);
    }
  }

  // 2. Motivation & Rotation Profiler
  if (ctx.isCupMatch) {
    const eliteTeam = isElite(ctx.homeTeam) ? 'home' : isElite(ctx.awayTeam) ? 'away' : null;
    if (eliteTeam) {
      const reduction = 0.12; // 12% reduction
      if (eliteTeam === 'home') homeXg *= (1 - reduction);
      else awayXg *= (1 - reduction);
      adjustments.push(`Cup rotation: Elite team attack weight reduced by ${reduction * 100}% (dense schedule)`);
    }
  }

  if (ctx.isEuropeanKnockout) {
    const eliteTeam = isElite(ctx.homeTeam) ? 'home' : isElite(ctx.awayTeam) ? 'away' : null;
    if (eliteTeam) {
      const boost = 1.15;
      if (eliteTeam === 'home') { homeXg *= boost; homeProb *= boost; }
      else { awayXg *= boost; awayProb *= boost; }
      adjustments.push(`European knockout: Maximum motivation multiplier applied to ${eliteTeam === 'home' ? ctx.homeTeam : ctx.awayTeam}`);
    }
  }

  // 3. Head-to-Head context
  if (ctx.h2hResults.length > 0) {
    const homeWins = ctx.h2hResults.filter((r) => r.homeGoals > r.awayGoals).length;
    const awayWins = ctx.h2hResults.filter((r) => r.awayGoals > r.homeGoals).length;
    if (homeWins > awayWins + 1) {
      homeProb *= 1.05;
      adjustments.push(`H2H: ${ctx.homeTeam} dominates recent meetings (${homeWins}-${awayWins})`);
    } else if (awayWins > homeWins + 1) {
      awayProb *= 1.05;
      adjustments.push(`H2H: ${ctx.awayTeam} dominates recent meetings (${awayWins}-${homeWins})`);
    }
  }

  // Re-normalize after H2H adjustments
  const total2 = homeProb + drawProb + awayProb;
  homeProb /= total2;
  drawProb /= total2;
  awayProb /= total2;

  // Determine top pick
  const bttsProb = (homeXg > 0.5 && awayXg > 0.5) ? Math.min(0.85, (1 - Math.exp(-homeXg)) * (1 - Math.exp(-awayXg)) * 1.1) : 0.4;
  const over25Prob = 1 - Math.exp(-(homeXg + awayXg)) * (1 + (homeXg + awayXg) + (homeXg + awayXg) ** 2 / 2);

  let topPick = '1X2 Moneyline';
  if (over25Prob > 0.65 && homeXg + awayXg > 2.5) topPick = 'Over 2.5 Goals';
  else if (bttsProb > 0.60) topPick = 'BTTS Yes';
  else if (homeProb > 0.70) topPick = `${ctx.homeTeam} Win`;
  else if (awayProb > 0.70) topPick = `${ctx.awayTeam} Win`;

  const qualityDisparity = `${homeQ.tier === 1 ? 'Tier 1' : homeQ.tier === 2 ? 'Tier 2' : homeQ.tier === 3 ? 'Tier 3' : 'Tier 4'} vs ${awayQ.tier === 1 ? 'Tier 1' : awayQ.tier === 2 ? 'Tier 2' : awayQ.tier === 3 ? 'Tier 3' : 'Tier 4'}`;

  return {
    homeWinProb: Number(homeProb.toFixed(3)),
    drawProb: Number(drawProb.toFixed(3)),
    awayWinProb: Number(awayProb.toFixed(3)),
    homeXg: Number(homeXg.toFixed(2)),
    awayXg: Number(awayXg.toFixed(2)),
    cornerBias,
    matchDynamic: disparity >= 0.60 ? 'David vs Goliath - Elite dominance expected' : 'Balanced matchup',
    adjustments,
    topPick,
  };
}

export default { applyHumanLogic };
