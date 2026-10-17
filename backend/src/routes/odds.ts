import { Router, Request, Response } from 'express';
import { DataProviderFactory } from '../providers/provider-factory.js';
import { computeOddsComparison } from '../utils/oddsMath.js';

export function createOddsRouter(factory: DataProviderFactory): Router {
  const router = Router();

  // GET /api/odds?home=..&away=..&kickoff=..&league=EPL&modelHome=..&modelDraw=..&modelAway=..
  router.get('/', async (req: Request, res: Response) => {
    try {
      const home = String(req.query.home || '');
      const away = String(req.query.away || '');
      const kickoff = String(req.query.kickoff || '');
      const league = (req.query.league as any) || 'EPL';
      if (!home || !away || !kickoff) {
        return res.status(400).json({ error: 'home, away and kickoff are required' });
      }
      if (!factory.isOddsConfigured()) {
        return res.status(200).json({ available: false, reason: 'odds_provider_not_configured', odds: null });
      }
      const fixture = {
        id: `query-${home}-${away}`,
        externalId: '',
        league,
        season: kickoff.substring(0, 4),
        round: '',
        date: kickoff.substring(0, 10),
        kickoffTime: kickoff,
        status: 'TIMED' as any,
        homeTeam: { id: '', name: home, shortName: home, code: '', league, stadium: '', city: '', logo: '' },
        awayTeam: { id: '', name: away, shortName: away, code: '', league, stadium: '', city: '', logo: '' },
        homeScore: null,
        awayScore: null,
        htHomeScore: null,
        htAwayScore: null,
        venue: '',
        dataSource: '',
      };
      const odds = await factory.getOddsForFixture(fixture as any);
      if (!odds) {
        return res.json({ available: false, reason: 'no_odds_found', odds: null, usage: factory.getOddsUsage() });
      }
      // extract 1X2 odds from first bookmaker that has h2h
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