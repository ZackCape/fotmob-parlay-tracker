/**
 * Dynamic corner line scaling engine.
 *
 * Computes Poisson probabilities for multiple corner lines (7.5, 8.5, 9.5,
 * 10.5, 11.5) based on team attack velocity and historical corner averages.
 */

export interface CornerAnalysis {
  expectedTotal: number;
  lines: Array<{ line: number; overProb: number; underProb: number }>;
  primaryLine: number;
  primaryOverProb: number;
}

export function calculateCornerProbabilities(
  homeCornersAvg: number,
  awayCornersAvg: number,
  homeAttackVelocity: number = 1.0,
  awayAttackVelocity: number = 1.0,
): CornerAnalysis {
  // Blend historical averages with attack velocity
  const homeExpected = Math.max(0.5, homeCornersAvg * homeAttackVelocity);
  const awayExpected = Math.max(0.5, awayCornersAvg * awayAttackVelocity);
  const totalLambda = homeExpected + awayExpected;

  const lines = [7.5, 8.5, 9.5, 10.5, 11.5].map((line) => {
    // Poisson P(X > line) = 1 - P(X <= floor(line))
    const threshold = Math.floor(line);
    let cumProb = 0;
    let poissonTerm = Math.exp(-totalLambda);
    for (let k = 0; k <= threshold; k++) {
      cumProb += poissonTerm;
      poissonTerm *= totalLambda / (k + 1);
    }
    const overProb = Math.max(0, Math.min(1, 1 - cumProb));
    return { line, overProb: Number(overProb.toFixed(4)), underProb: Number((1 - overProb).toFixed(4)) };
  });

  // Primary line is the one closest to 50%
  const primary = lines.reduce((best, l) => Math.abs(l.overProb - 0.5) < Math.abs(best.overProb - 0.5) ? l : best, lines[0]);

  return {
    expectedTotal: Number(totalLambda.toFixed(2)),
    lines,
    primaryLine: primary.line,
    primaryOverProb: primary.overProb,
  };
}

export function formatCornerCard(analysis: CornerAnalysis, homeTeam: string, awayTeam: string): string {
  const lines = analysis.lines.map((l) =>
    `Over ${l.line}: ${(l.overProb * 100).toFixed(1)}% | Under ${l.line}: ${(l.underProb * 100).toFixed(1)}%`
  ).join('\n');
  return `Expected Total Corners: ${analysis.expectedTotal}\nPrimary Line: Over ${analysis.primaryLine} (${(analysis.primaryOverProb * 100).toFixed(1)}%)\n\n${lines}`;
}

export default { calculateCornerProbabilities, formatCornerCard };
