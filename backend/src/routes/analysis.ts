import { Router, Request, Response } from 'express';
import { DataProviderFactory } from '../providers/provider-factory.js';

export function createAnalysisRouter(factory: DataProviderFactory): Router {
  const router = Router();

  /**
   * GET /api/fixtures/:id/analysis
   */
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const fixtureId = req.params.id as string;
      const analysis = await factory.getMatchDetails(fixtureId);

      if (!analysis) {
        return res.status(404).json({ error: `Match analysis not found for fixture ID: ${fixtureId}` });
      }

      return res.json(analysis);
    } catch (err: any) {
      console.error('[AnalysisRouter] Error:', err);
      return res.status(500).json({ error: 'Failed to retrieve match analysis', details: err.message });
    }
  });

  return router;
}
