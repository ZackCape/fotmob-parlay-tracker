import { Router } from 'express';
import { HISTORICAL_MATCHES } from '../data/historical-stats.js';
export function createPredictionsRouter(factory, predRepo) {
    const router = Router();
    /**
     * GET /api/predictions/history
     */
    router.get('/history', async (req, res) => {
        try {
            // Gather historical evaluated predictions from archive matches
            const evaluatedPredictions = [];
            for (const m of HISTORICAL_MATCHES) {
                const details = await factory.getMatchDetails(m.id);
                if (details && details.marketPredictions) {
                    evaluatedPredictions.push(...details.marketPredictions.filter(p => p.actualOutcome !== 'PENDING'));
                }
            }
            // Also get any saved user predictions from repository
            const repoPredictions = await predRepo.getAllPredictions();
            const combined = [...evaluatedPredictions, ...repoPredictions];
            return res.json({
                total: combined.length,
                predictions: combined.slice(0, 100), // Return recent 100
            });
        }
        catch (err) {
            console.error('[PredictionsRouter] Error:', err);
            return res.status(500).json({ error: 'Failed to retrieve predictions', details: err.message });
        }
    });
    return router;
}
