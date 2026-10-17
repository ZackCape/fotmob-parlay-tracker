import { Router } from 'express';
export function createAnalysisRouter(factory) {
    const router = Router();
    /**
     * GET /api/fixtures/:id/analysis
     */
    router.get('/:id', async (req, res) => {
        try {
            const fixtureId = req.params.id;
            const analysis = await factory.getMatchDetails(fixtureId);
            if (!analysis) {
                return res.status(404).json({ error: `Match analysis not found for fixture ID: ${fixtureId}` });
            }
            return res.json(analysis);
        }
        catch (err) {
            console.error('[AnalysisRouter] Error:', err);
            return res.status(500).json({ error: 'Failed to retrieve match analysis', details: err.message });
        }
    });
    return router;
}
