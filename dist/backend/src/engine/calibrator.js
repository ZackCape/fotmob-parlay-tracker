/**
 * Probability Calibrator & Uncertainty Bounds
 * Employs Bayesian shrinkage towards league priors to avoid overconfident probabilities
 * from small sample sizes, and calculates binomial standard error confidence intervals.
 */
export function calibrateProbability(rawProbability, priorProbability, sampleSize, priorWeight = 5.0) {
    // Clamp raw between 0.01 and 0.99
    const clampedRaw = Math.min(0.99, Math.max(0.01, rawProbability));
    // Bayesian shrinkage towards empirical league prior
    const effectiveSample = Math.max(1, sampleSize);
    const calibrated = (clampedRaw * effectiveSample + priorProbability * priorWeight) / (effectiveSample + priorWeight);
    // Binomial standard error: SE = sqrt( p * (1-p) / N )
    const se = Math.sqrt((calibrated * (1 - calibrated)) / effectiveSample);
    // 95% confidence interval (z = 1.96)
    const margin = 1.96 * se;
    const lowerBound = Math.max(0.01, Number((calibrated - margin).toFixed(3)));
    const upperBound = Math.min(0.99, Number((calibrated + margin).toFixed(3)));
    return {
        calibrated: Number(calibrated.toFixed(3)),
        raw: Number(clampedRaw.toFixed(3)),
        lowerBound,
        upperBound,
    };
}
