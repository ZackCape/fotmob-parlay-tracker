import { Router, Request, Response } from 'express';
import { DataProviderFactory } from '../providers/provider-factory.js';

export function createNewsRouter(factory: DataProviderFactory): Router {
  const router = Router();

  /**
   * GET /api/news
   * Returns authentic breaking European football news headlines and match previews
   * scraped directly from FootballDatabase.eu.
   */
  router.get('/', async (req: Request, res: Response) => {
    try {
      const articles = await factory.getLatestNews();
      return res.json({
        success: true,
        count: articles.length,
        articles,
      });
    } catch (err: any) {
      console.error('[NewsRouter] Failed to retrieve news:', err);
      return res.status(500).json({
        error: 'Failed to retrieve football news',
        details: err.message,
      });
    }
  });

  return router;
}
