import { Router, Request, Response } from 'express';
import { DataProviderFactory } from '../providers/provider-factory.js';
import { computeOddsComparison } from '../utils/oddsMath.js';

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
      const source = String(fixture.dataSource || '');
      if (!/api-football|football-data/i.test(source)) {
        console.info(`[OddsRoute] rejected non-live fixture ${fixtureId} source=${source}`);
        return res.json({ available: false, reason: 'non_live_fixture', odds: null });
      }

      if (!factory.isOddsConfigured()) {
        return res.status(200).json({ available: false, reason: 'odds_provider_not_configured', odds: null });
      }

      console.info(`[OddsRoute] request fixture=${fixtureId} home=${fixture.homeTeam.name} away=${fixture.awayTeam.name} kickoff=${fixture.kickoffTime}`);

      const odds = await factory.getOddsForFixture(fixture as any);
      if (!odds) {
        return res.json({ available: false, reason: 'no_odds_found', odds: null, usage: factory.getOddsUsage() });
      }

      let bookmaker: any = null;
      let market: any = null;
      for (const b of odds.bookmakers) {
        const m = b.markets.find((mk: any) => mk.key === 'h2h');
        if (m) { bookmaker = b; market = m; break; }
      }
      const homeOdds = market?.outcomes?.find((o: any) => o.name === odds.homeTeam)?.price ?? null;
      const awayOdds = market?.outcomes?.find((o: any) => o.name === odds.awayTeam)?.price ?? null;
      const drawOdds = market?.outcomes?.find((o: any) => /draw/i.test(o.name))?.price ?? null;

      const modelHome = req.query.modelHome ? Number(req.query.modelHome) : null;
      const modelDraw = req.query.modelDraw ? Number(req.query.modelDraw) : null;
      const modelAway = req.query.modelAway ? Number(req.query.modelAway) : null;

      const comparison = computeOddsComparison(homeOdds, drawOdds, awayOdds, modelHome, modelDraw, modelAway);

      return res.json({
        available: true,
        odds,
        bookmaker: bookmaker ? { key: bookmaker.key, title: bookmaker.title, lastUpdate: bookmaker.lastUpdate } : null,
        market: market ? { key: market.key, lastUpdate: market.lastUpdate } : null,
        homeOdds, drawOdds, awayOdds,
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