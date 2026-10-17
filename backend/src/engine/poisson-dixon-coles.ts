/**
 * Dixon-Coles Bivariate Poisson Prediction Engine
 * Based on Dixon & Coles (1997) "Modelling Association Football Scores and Inefficiencies in the Football Betting Market"
 * Strictly uses statistical performance data - NO BETTING ODDS INPUTS.
 */

export interface DixonColesResult {
  homeExpectedGoals: number;
  awayExpectedGoals: number;
  homeAttackStrength: number;
  homeDefenseWeakness: number;
  awayAttackStrength: number;
  awayDefenseWeakness: number;
  homeAdvantage: number;
  scoreMatrix: Array<{ homeScore: number; awayScore: number; probability: number }>;
}

/**
 * Factorial helper
 */
function factorial(n: number): number {
  if (n <= 1) return 1;
  let res = 1;
  for (let i = 2; i <= n; i++) res *= i;
  return res;
}

/**
 * Poisson probability density P(K = k; lambda)
 */
export function poissonPmf(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

/**
 * Poisson Cumulative Distribution Function P(K <= k; lambda)
 */
export function poissonCdf(k: number, lambda: number): number {
  if (lambda <= 0) return 1;
  let sum = 0;
  for (let i = 0; i <= k; i++) {
    sum += poissonPmf(i, lambda);
  }
  return Math.min(1, Math.max(0, sum));
}

/**
 * Dixon-Coles bivariate low-score correction factor tau(x, y; lambda, mu, rho)
 */
export function dixonColesTau(x: number, y: number, lambda: number, mu: number, rho: number = -0.11): number {
  if (x === 0 && y === 0) {
    return Math.max(0.01, 1 - lambda * mu * rho);
  }
  if (x === 0 && y === 1) {
    return Math.max(0.01, 1 + mu * rho);
  }
  if (x === 1 && y === 0) {
    return Math.max(0.01, 1 + lambda * rho);
  }
  if (x === 1 && y === 1) {
    return Math.max(0.01, 1 - rho);
  }
  return 1.0;
}

/**
 * Computes Dixon-Coles parameters and joint score distribution matrix (up to 7x7)
 */
export function calculateDixonColes(
  homeAttack: number,
  homeDefense: number,
  awayAttack: number,
  awayDefense: number,
  league: string = 'EPL',
  homeAdvantageFactor: number = 1.28
): DixonColesResult {
  // Baseline league average goals per team per match
  let baselineRate = 1.40;
  if (league === 'CHAMPIONSHIP') baselineRate = 1.30;
  else if (league === 'LALIGA') baselineRate = 1.25;
  else if (league === 'LIGUE1') baselineRate = 1.32;
  else if (league === 'CHAMPIONS_LEAGUE') baselineRate = 1.55;
  else if (league === 'EUROPA_LEAGUE' || league === 'CONFERENCE_LEAGUE') baselineRate = 1.48;

  // Expected goals (lambda for home, mu for away)
  const homeLambda = Math.max(0.2, baselineRate * homeAttack * awayDefense * homeAdvantageFactor);
  const awayMu = Math.max(0.2, baselineRate * awayAttack * homeDefense);

  const maxGoals = 7;
  const scoreMatrix: Array<{ homeScore: number; awayScore: number; probability: number }> = [];
  let totalProb = 0;

  // Compute joint probabilities for all scorelines from 0-0 to 7-7
  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const tau = dixonColesTau(h, a, homeLambda, awayMu);
      const rawProb = tau * poissonPmf(h, homeLambda) * poissonPmf(a, awayMu);
      scoreMatrix.push({ homeScore: h, awayScore: a, probability: rawProb });
      totalProb += rawProb;
    }
  }

  // Normalize so probabilities sum to 1.0 across the finite grid
  if (totalProb > 0) {
    for (const item of scoreMatrix) {
      item.probability /= totalProb;
    }
  }

  return {
    homeExpectedGoals: Number(homeLambda.toFixed(2)),
    awayExpectedGoals: Number(awayMu.toFixed(2)),
    homeAttackStrength: Number(homeAttack.toFixed(2)),
    homeDefenseWeakness: Number(homeDefense.toFixed(2)),
    awayAttackStrength: Number(awayAttack.toFixed(2)),
    awayDefenseWeakness: Number(awayDefense.toFixed(2)),
    homeAdvantage: Number(homeAdvantageFactor.toFixed(2)),
    scoreMatrix,
  };
}
