export function computeModelPerformance(predictions) {
    const evaluated = predictions.filter(p => (p.actualOutcome === 'HIT' || p.actualOutcome === 'MISS')
        && Number.isFinite(p.estimatedProbability)
        && p.estimatedProbability >= 0
        && p.estimatedProbability <= 1);
    let totalBrier = 0;
    let totalLogLoss = 0;
    let totalHits = 0;
    const leagueStats = new Map();
    const marketStats = new Map();
    const buckets = Array.from({ length: 10 }, () => ({ predSum: 0, hits: 0, count: 0 }));
    for (const pred of evaluated) {
        const outcome = pred.actualOutcome === 'HIT' ? 1 : 0;
        const p = pred.estimatedProbability;
        const brier = (p - outcome) ** 2;
        const logProbability = Math.max(0.001, outcome === 1 ? p : 1 - p);
        totalBrier += brier;
        totalLogLoss -= Math.log(logProbability);
        totalHits += outcome;
        const league = leagueStats.get(pred.league) ?? { brierSum: 0, hits: 0, count: 0 };
        league.brierSum += brier;
        league.hits += outcome;
        league.count++;
        leagueStats.set(pred.league, league);
        const market = marketStats.get(pred.market) ?? { brierSum: 0, hits: 0, count: 0 };
        market.brierSum += brier;
        market.hits += outcome;
        market.count++;
        marketStats.set(pred.market, market);
        const bucket = buckets[Math.min(9, Math.floor(p * 10))];
        bucket.predSum += p;
        bucket.hits += outcome;
        bucket.count++;
    }
    const n = evaluated.length;
    const round = (value) => Number(value.toFixed(3));
    const summarize = ([key, stats]) => [key, {
            brierScore: round(stats.brierSum / stats.count),
            hitRate: round(stats.hits / stats.count),
            sampleCount: stats.count,
        }];
    return {
        overallBrierScore: n ? round(totalBrier / n) : null,
        overallLogLoss: n ? round(totalLogLoss / n) : null,
        overallHitRate: n ? round(totalHits / n) : null,
        totalEvaluatedPredictions: n,
        leagueBreakdown: Object.fromEntries(Array.from(leagueStats, summarize)),
        marketBreakdown: Object.fromEntries(Array.from(marketStats, summarize)),
        calibrationBuckets: buckets.flatMap((bucket, index) => bucket.count ? [{
                bucketLabel: `${index * 10}% – ${(index + 1) * 10}%`,
                minProb: index / 10,
                maxProb: (index + 1) / 10,
                predictedMean: round(bucket.predSum / bucket.count),
                observedFrequency: round(bucket.hits / bucket.count),
                sampleCount: bucket.count,
            }] : []),
    };
}
