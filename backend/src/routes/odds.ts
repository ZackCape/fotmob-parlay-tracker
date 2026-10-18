import { Router, Request, Response } from 'express';
import { DataProviderFactory } from '../providers/provider-factory.js';
import { computeOddsComparison } from '../utils/oddsMath.js';
import { isVerifiedFixture } from '../utils/fixtureValidation.js';
import { bayesianBlend, OutcomeProbabilities, MARKET_BLEND_WEIGHT } from '../engine/poisson-dixon-coles.js';

/** Fair (overround-free) decimal odds from a probability. */
const fairOdds = (p: number | null): number | null =>
  p !== null && p > 0 ? Number((1 / p).toFixed(2)) : null;

export function createOddsRouter(factory: DataProviderFactory): Router {
  const router = Router();

  // GET /api/odds?fixtureId=...&date=YYYY-MM-DD&league=EPL&modelHome=..&modelDraw=..&modelAway=..
  router.get('/', async (req: Request, res: Response) => {
    try {
      const fixtureId = String(req.query.fixtureId || '');
      const date = String(req.query.date || '');
      const league = (req.query.league as any) || 'ALL';
      if (!fixtureId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: 'fixtureId and date (YYYY-MM-DD) are required' });
      }

      // Resolve the fixture from the backend's own (cached) fixture list — trusted metadata.
      const fixtures = await factory.getFixturesByDate(date, league);
      const fixture = fixtures.find((f: any) => f.id === fixtureId);
      if (!fixture) {
        return res.json({ available: false, reason: 'fixture_not_found', odds: null });
      }

      // Only real current fixtures may have odds.
      if (!isVerifiedFixture(fixture)) {
        console.info(`[OddsRoute] rejected non-verified fixture ${fixtureId} source=${fixture.dataSource}`);
        return res.json({ available: false, reason: 'non_live_fixture', odds: null });
      }

      // --- Hybrid multi-tier odds resolution ---
      const tiered = await factory.resolveOdds(fixture as any);

      // Model probabilities from the Dixon-Coles engine (or the caller-supplied values).
      let modelHome: number | null = null;
      let modelDraw: number | null = null;
      let modelAway: number | null = null;
      let details: any = null;
      try {
        details = await factory.getMatchDetails(fixtureId);
      } catch { /* analysis unavailable */ }
      const preds: any[] = details?.marketPredictions || [];
      for (const p of preds) {
        if (p.market === 'HOME_WIN') modelHome = p.estimatedProbability;
        else if (p.market === 'DRAW') modelDraw = p.estimatedProbability;
        else if (p.market === 'AWAY_WIN') modelAway = p.estimatedProbability;
      }

      const reqModelHome = req.query.modelHome ? Number(req.query.modelHome) : null;
      const reqModelDraw = req.query.modelDraw ? Number(req.query.modelDraw) : null;
      const reqModelAway = req.query.modelAway ? Number(req.query.modelAway) : null;
      modelHome = reqModelHome ?? modelHome;
      modelDraw = reqModelDraw ?? modelDraw;
      modelAway = reqModelAway ?? modelAway;

      const hasBookmaker = tiered.home !== null && tiered.draw !== null && tiered.away !== null;

      // Bayesian shrinkage: 0.70 * market + 0.30 * model when a full line exists.
      let blended: OutcomeProbabilities | null = null;
      if (hasBookmaker) {
        const market: OutcomeProbabilities = {
          home: 1 / (tiered.home as number),
          draw: 1 / (tiered.draw as number),
          away: 1 / (tiered.away as number),
        };
        if (modelHome !== null && modelDraw !== null && modelAway !== null) {
          blended = bayesianBlend(market, { home: modelHome, draw: modelDraw, away: modelAway });
        } else {
          blended = bayesianBlend(market, market, 1);
        }
      }

      const comparison = computeOddsComparison(
        tiered.home, tiered.draw, tiered.away,
        modelHome, modelDraw, modelAway,
      );

      // Bookmaker odds when available; otherwise Cape Fair Odds (model implied).
      const effectiveHome = hasBookmaker ? tiered.home : fairOdds(modelHome);
      const effectiveDraw = hasBookmaker ? tiered.draw : fairOdds(modelDraw);
      const effectiveAway = hasBookmaker ? tiered.away : fairOdds(modelAway);

      const overround = hasBookmaker
        ? 1 / (tiered.home as number) + 1 / (tiered.draw as number) + 1 / (tiered.away as number)
        : null;

      // `available` is now always true when we returned a verified fixture: the
      // pipeline can always fall back to calibrated fair odds (Tier 3).
      return res.json({
        available: true,
        tier: tiered.tier,
        source: tiered.source,
        reason: tiered.reason,
        odds: tiered.odds,
        bookmaker: tiered.source === 'bookmaker' ? 'consensus' : null,
        overround,
        homeOdds: effectiveHome,
        drawOdds: effectiveDraw,
        awayOdds: effectiveAway,
        // Explicit fair odds (1 / P) — always populated when the model has run.
        fairOddsHome: fairOdds(modelHome),
        fairOddsDraw: fairOdds(modelDraw),
        fairOddsAway: fairOdds(modelAway),
        modelHome, modelDraw, modelAway,
        blended,
        blendWeight: MARKET_BLEND_WEIGHT,
        comparison,
        usage: factory.getOddsUsage(),
      });
    } catch (err: any) {
      console.error('[OddsRouter] Error:', err);
      return res.status(500).json({ error: 'Failed to retrieve odds', details: err.message });
    }
  });

  return router;
}
