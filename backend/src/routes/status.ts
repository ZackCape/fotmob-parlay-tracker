import { Router, Request, Response } from 'express';
import { DataProviderFactory } from '../providers/provider-factory.js';
import { getDatabase } from '../database/db.js';
import { config } from '../config/env.js';

export function createStatusRouter(factory: DataProviderFactory): Router {
  const router = Router();

  /**
   * GET /api/system/status
   */
  router.get('/', async (req: Request, res: Response) => {
    try {
      const health = await factory.getHealth();
      const db = getDatabase();

      return res.json({
        service: 'EPL & Championship Football Statistical Analytics Engine',
        version: '1.0.0',
        environment: config.nodeEnv,
        currentTimestamp: new Date().toISOString(),
        database: {
          type: db.isPostgres() ? 'PostgreSQL (Cloud / Enterprise)' : 'Local SQLite / In-Memory Development Store',
          configured: !!config.databaseUrl,
        },
        providers: {
          configuredMode: config.dataProvider,
          primary: health.primary,
          fallback: health.fallback,
        },
        caching: {
          activeEntries: health.cacheSize,
          ttlMinutes: config.cacheTtlMinutes,
        },
        supportedCompetitions: [
          { code: 'EPL', name: 'English Premier League', teams: 20 },
          { code: 'CHAMPIONSHIP', name: 'English Football League Championship', teams: 24 },
        ],
      });
    } catch (err: any) {
      return res.status(500).json({ error: 'Failed to retrieve system status', details: err.message });
    }
  });

  return router;
}
