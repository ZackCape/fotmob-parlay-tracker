import { Router } from 'express';
import { HISTORICAL_MATCHES } from '../data/historical-stats.js';
import { computeModelPerformance } from '../engine/evaluator.js';
export function createPerformanceRouter(factory) {
    const router = Router();
    /**
     * GET /api/model/performance
     */
    router.get('/', async (req, res) => {
        try {
            const historicalEvaluations = [];
            for (const m of HISTORICAL_MATCHES) {
                const details = await factory.getMatchDetails(m.id);
                if (details && details.marketPredictions) {
                    historicalEvaluations.push(...details.marketPredictions.filter(p => p.actualOutcome !== 'PENDING'));
                }
            }
            const report = computeModelPerformance(historicalEvaluations);
            return res.json(report);
        }
        catch (err) {
            console.error('[PerformanceRouter] Error:', err);
            return res.status(500).json({ error: 'Failed to compute performance metrics', details: err.message });
        }
    });
    return router;
}
