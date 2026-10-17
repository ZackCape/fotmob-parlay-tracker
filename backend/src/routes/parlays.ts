import { Router, Request, Response } from 'express';
import { DataProviderFactory } from '../providers/provider-factory.js';
import { buildStatisticalParlay } from '../parlays/parlay-builder.js';
import { ParlayRepository } from '../database/repositories.js';
import { MarketPrediction, ParlayLegCount, ParlayMode, StatisticalParlay } from '../types/football.js';
import { LiveParlayTrackerService } from '../parlays/live-tracker.js';

export function createParlaysRouter(
  factory: DataProviderFactory,
  parlayRepo: ParlayRepository,
  trackerService: LiveParlayTrackerService
): Router {
  const router = Router();

  /**
   * POST /api/parlays/generate
   */
  router.post('/generate', async (req: Request, res: Response) => {
    try {
      const {
        date = new Date().toISOString().substring(0, 10),
        legsCount = 5,
        minProbability = 0.58,
        allowedMarkets,
        leagueFilter = 'ALL',
        mode = 'ANTI_CORRELATED' as ParlayMode,
        targetFixtureId,
      } = req.body;

      const validLegCounts: ParlayLegCount[] = [5, 10, 15, 20, 25];
      if (!validLegCounts.includes(legsCount)) {
        return res.status(400).json({ error: `Invalid legsCount. Must be one of: 5, 10, 15, 20, 25` });
      }

      // Fetch fixtures on that date
      const fixtures = await factory.getFixturesByDate(date, leagueFilter);

      // Collect candidate predictions
      const candidatePredictions: MarketPrediction[] = [];
      for (const fx of fixtures) {
        const details = await factory.getMatchDetails(fx.id);
        if (details && details.marketPredictions) {
          candidatePredictions.push(...details.marketPredictions);
        }
      }

      // Build statistical parlay with requested correlation mode (Anti-Correlated, SGP, or Correlated Allowed)
      const parlay = buildStatisticalParlay(candidatePredictions, {
        targetLegsCount: legsCount as ParlayLegCount,
        minProbability: parseFloat(minProbability),
        allowedMarkets,
        leagueFilter,
        mode,
        targetFixtureId,
      });

      // Save generated parlay
      await parlayRepo.saveParlay(parlay);

      // Auto-track the latest parlay in live tracker
      await trackerService.trackParlay(parlay);

      return res.json(parlay);
    } catch (err: any) {
      console.error('[ParlaysRouter] Error generating parlay:', err);
      return res.status(500).json({ error: 'Failed to generate statistical parlay', details: err.message });
    }
  });

  /**
   * POST /api/parlays/track
   * Register a custom or saved parlay for live motion tracking
   */
  router.post('/track', async (req: Request, res: Response) => {
    try {
      const parlay = ((req.body as any)?.parlay || req.body) as StatisticalParlay;
      if (!parlay || !parlay.legs) {
        return res.status(400).json({ error: 'Invalid parlay object payload' });
      }
      const tracked = await trackerService.trackParlay(parlay);
      return res.json({ tracked, ...tracked });
    } catch (err: any) {
      return res.status(500).json({ error: 'Failed to track parlay', details: err.message });
    }
  });

  /**
   * GET /api/parlays/live
   * Returns all currently active live tracked parlays
   */
  router.get('/live', async (_req: Request, res: Response) => {
    try {
      const tracked = trackerService.getTrackedParlays();
      return res.json({ count: tracked.length, parlays: tracked, activeParlays: tracked });
    } catch (err: any) {
      return res.status(500).json({ error: 'Failed to get live tracked parlays', details: err.message });
    }
  });

  /**
   * GET /api/parlays/live/:id
   * Returns live movement and status for a specific parlay
   */
  router.get('/live/:id', async (req: Request, res: Response) => {
    try {
      const parlayId = req.params.id as string;
      const tracked = await trackerService.evaluateParlayProgress(parlayId);
      return res.json({ tracked, ...tracked });
    } catch (err: any) {
      return res.status(404).json({ error: 'Tracked parlay not found or evaluation failed', details: err.message });
    }
  });

  /**
   * POST /api/parlays/live/:id/tick
   * Advances simulated live match ticker to test visual motion
   */
  router.post('/live/:id/tick', async (req: Request, res: Response) => {
    try {
      const parlayId = req.params.id as string;
      const updated = await trackerService.advanceSimulationTick(parlayId);
      return res.json({ tracked: updated, ...updated });
    } catch (err: any) {
      return res.status(500).json({ error: 'Failed to advance simulation tick', details: err.message });
    }
  });

  /**
   * GET /api/parlays/history
   */
  router.get('/history', async (_req: Request, res: Response) => {
    try {
      const history = await parlayRepo.getRecentParlays();
      return res.json({ count: history.length, parlays: history });
    } catch (err: any) {
      return res.status(500).json({ error: 'Failed to retrieve parlay history', details: err.message });
    }
  });

  return router;
}
