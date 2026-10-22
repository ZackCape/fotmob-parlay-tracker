/**
 * Prediction Engine — applies human logic and tier disparity calibration
 * before generating match probabilities.
 *
 * Wraps the raw Dixon-Coles output with tier disparity adjustments,
 * David vs Goliath compression, and hybrid ensemble calibration.
 */

import { applyHumanLogic } from './humanLogicEngine.js';
import { getLeagueQuality } from './tierDisparityService.js';

export interface CalibratedPrediction {
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
  homeXg: number;
  awayXg: number;
  topPick: string;
  adjustments: string[];
  matchDynamic: string;
  cornerBias: string;
}

export function calibrateFixture(
  homeTeam: string,
  awayTeam: string,
  homeLeague: string,
  awayLeague: string,
  baseHomeProb: number,
  baseDrawProb: number,
  baseAwayProb: number,
  baseHomeXg: number,
  baseAwayXg: number,
  isCupMatch: boolean = false,
  isEuropeanKnockout: boolean = false,
  homeEuropeanMatches: number = 0,
  awayEuropeanMatches: number = 0,
  h2hResults: Array<{ homeGoals: number; awayGoals: number }> = [],
): CalibratedPrediction {
  const result = applyHumanLogic(
    {
      homeTeam,
      awayTeam,
      homeLeague,
      awayLeague,
      isCupMatch,
      isEuropeanKnockout,
      homeEuropeanMatches,
      awayEuropeanMatches,
      homeForm: [],
      awayForm: [],
      h2hResults,
    },
    baseHomeProb,
    baseDrawProb,
    baseAwayProb,
    baseHomeXg,
    baseAwayXg,
  );

  // Hybrid ensemble: blend with market odds if available
  // P_final = 0.75 * P_market + 0.25 * P_model
  // (Market odds integration happens at the embed level via oddsAggregatorService)

  return {
    homeWinProb: result.homeWinProb,
    drawProb: result.drawProb,
    awayWinProb: result.awayWinProb,
    homeXg: result.homeXg,
    awayXg: result.awayXg,
    topPick: result.topPick,
    adjustments: result.adjustments,
    matchDynamic: result.matchDynamic,
    cornerBias: result.cornerBias,
  };
}

export default { calibrateFixture };
