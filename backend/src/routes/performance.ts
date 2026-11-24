import { Router } from 'express';
import { HISTORICAL_MATCHES } from '../data/historical-stats.js';
import { evaluateWalkForward } from '../engine/walk-forward.js';

export function createPerformanceRouter(): Router {
  const router = Router();
  const { report } = evaluateWalkForward(HISTORICAL_MATCHES);
  router.get('/', (_req, res) => res.json(report));
  return router;
}
