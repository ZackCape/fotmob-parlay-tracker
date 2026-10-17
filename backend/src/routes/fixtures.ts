import { Router, Request, Response } from 'express';
import { DataProviderFactory } from '../providers/provider-factory.js';

export function createFixturesRouter(factory: DataProviderFactory): Router {
  const router = Router();

  /**
   * GET /api/fixtures?date=YYYY-MM-DD&league=ALL|EPL|CHAMPIONSHIP
   */
  router.get('/', async (req: Request, res: Response) => {
    try {
      const date = (req.query.date as string) || new Date().toISOString().substring(0, 10);
      const league = (req.query.league as any) || 'ALL';

      // Validate date format YYYY-MM-DD
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: 'Invalid date format. Expected YYYY-MM-DD' });
      }

      const fixtures = await factory.getFixturesByDate(date, league);
      
      // Augment each fixture with a fast summary prediction for the dashboard card
      const enriched = await Promise.all(
        fixtures.map(async f => {
          try {
            const analysis = await factory.getMatchDetails(f.id);
            const topPrediction = analysis?.marketPredictions?.[0] || null;
            return {
              ...f,
              topPrediction,
              expectedHomeGoals: analysis?.dixonColesParameters.homeExpectedGoals ?? null,
              expectedAwayGoals: analysis?.dixonColesParameters.awayExpectedGoals ?? null,
            };
          } catch (e) {
            return f;
          }
        })
      );

      return res.json({
        date,
        league,
        count: enriched.length,
        fixtures: enriched,
      });
    } catch (err: any) {
      console.error('[FixturesRouter] Error fetching fixtures:', err);
      return res.status(500).json({ error: 'Failed to retrieve fixtures', details: err.message });
    }
  });

  return router;
}
