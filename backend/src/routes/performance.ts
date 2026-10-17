import { Router, Request, Response } from 'express';
import { DataProviderFactory } from '../providers/provider-factory.js';
import { HISTORICAL_MATCHES } from '../data/historical-stats.js';
import { computeModelPerformance } from '../engine/evaluator.js';
import { MarketPrediction } from '../types/football.js';

export function createPerformanceRouter(factory: DataProviderFactory): Router {
  const router = Router();

  /**
   * GET /api/model/performance
   */
  router.get('/', async (req: Request, res: Response) => {
    try {
      const historicalEvaluations: MarketPrediction[] = [];
      for (const m of HISTORICAL_MATCHES) {
        const details = await factory.getMatchDetails(m.id);
        if (details && details.marketPredictions) {
          historicalEvaluations.push(...details.marketPredictions.filter(p => p.actualOutcome !== 'PENDING'));
        }
      }

      const report = computeModelPerformance(historicalEvaluations);
      return res.json(report);
    } catch (err: any) {
      console.error('[PerformanceRouter] Error:', err);
      return res.status(500).json({ error: 'Failed to compute performance metrics', details: err.message });
    }
  });

  return router;
}
