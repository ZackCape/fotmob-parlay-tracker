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

      let fixtures = await factory.getFixturesByDate(date, league);
      // Never serve synthetic/archive fixtures as live matches
      fixtures = fixtures.filter((f: any) => !/archive|calendar|historical|offline/i.test(f.dataSource || ''));

      // Do not fetch match analysis for every fixture (avoids N+1 API calls).
      // Detailed analysis is loaded on demand via /api/analysis/:id.
      return res.json({
        date,
        league,
        count: fixtures.length,
        fixtures,
      });
    } catch (err: any) {
      console.error('[FixturesRouter] Error fetching fixtures:', err);
      return res.status(500).json({ error: 'Failed to retrieve fixtures', details: err.message });
    }
  });

  return router;
}
