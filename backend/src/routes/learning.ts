import { Router, Request, Response } from 'express';
import { DataProviderFactory } from '../providers/provider-factory.js';
import { Fixture, League } from '../types/football.js';

export function createLearningRouter(factory: DataProviderFactory): Router {
  const router = Router();
  const engine = factory.getLearningEngine();

  /**
   * GET /api/learning/stats
   * Returns current learning metrics, ratings summary, and latest learning event
   */
  router.get('/stats', (_req: Request, res: Response) => {
    try {
      const stats = engine.getEngineStats();
      return res.json(stats);
    } catch (err: any) {
      return res.status(500).json({ error: 'Failed to retrieve learning stats', details: err.message });
    }
  });

  /**
   * GET /api/learning/ratings
   * Returns all dynamic team attack & defense ratings
   */
  router.get('/ratings', (_req: Request, res: Response) => {
    try {
      const ratings = engine.getAllTeamRatings();
      return res.json({ count: ratings.length, ratings });
    } catch (err: any) {
      return res.status(500).json({ error: 'Failed to retrieve team ratings', details: err.message });
    }
  });

  /**
   * GET /api/learning/events
   * Returns chronological learning history events
   */
  router.get('/events', (_req: Request, res: Response) => {
    try {
      const events = engine.getLearningEvents();
      return res.json({ count: events.length, events });
    } catch (err: any) {
      return res.status(500).json({ error: 'Failed to retrieve learning events', details: err.message });
    }
  });

  /**
   * POST /api/learning/learn-match
   * Manually feeds a finished match result to trigger online learning and recalibrate future games
   */
  router.post('/learn-match', async (req: Request, res: Response) => {
    try {
      const {
        fixtureId,
        homeTeamName = 'Arsenal',
        awayTeamName = 'Chelsea',
        homeScore = 2,
        awayScore = 1,
        cornersHome = 7,
        cornersAway = 4,
        yellowCardsHome = 2,
        yellowCardsAway = 3,
        league = 'EPL' as League,
      } = req.body;

      let fixture: Fixture | null = null;

      if (fixtureId) {
        const details = await factory.getMatchDetails(fixtureId);
        if (details?.fixture) {
          fixture = {
            ...details.fixture,
            homeScore: Number(homeScore),
            awayScore: Number(awayScore),
            status: 'FINISHED',
            statistics: {
              shotsHome: 15,
              shotsAway: 11,
              shotsOnTargetHome: 6,
              shotsOnTargetAway: 4,
              xgHome: 1.85,
              xgAway: 1.15,
              cornersHome: Number(cornersHome),
              cornersAway: Number(cornersAway),
              foulsHome: 12,
              foulsAway: 14,
              yellowCardsHome: Number(yellowCardsHome),
              yellowCardsAway: Number(yellowCardsAway),
              redCardsHome: 0,
              redCardsAway: 0,
              possessionHome: 54,
              possessionAway: 46,
            },
          };
        }
      }

      if (!fixture) {
        fixture = {
          id: fixtureId || `custom-${Date.now()}-${homeTeamName}-${awayTeamName}`,
          externalId: `ext-${Date.now()}`,
          league,
          season: '2026-2027',
          round: 'League Match',
          date: new Date().toISOString().substring(0, 10),
          kickoffTime: new Date().toISOString(),
          status: 'FINISHED',
          homeTeam: {
            id: `team-${homeTeamName.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
            name: homeTeamName,
            shortName: homeTeamName,
            code: homeTeamName.substring(0, 3).toUpperCase(),
            league,
            stadium: 'Stadium',
            city: '',
            logo: '',
          },
          awayTeam: {
            id: `team-${awayTeamName.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
            name: awayTeamName,
            shortName: awayTeamName,
            code: awayTeamName.substring(0, 3).toUpperCase(),
            league,
            stadium: '',
            city: '',
            logo: '',
          },
          homeScore: Number(homeScore),
          awayScore: Number(awayScore),
          htHomeScore: 1,
          htAwayScore: 0,
          venue: 'Stadium',
          statistics: {
            shotsHome: 16,
            shotsAway: 10,
            shotsOnTargetHome: 7,
            shotsOnTargetAway: 3,
            xgHome: 1.95,
            xgAway: 1.10,
            cornersHome: Number(cornersHome),
            cornersAway: Number(cornersAway),
            foulsHome: 11,
            foulsAway: 13,
            yellowCardsHome: Number(yellowCardsHome),
            yellowCardsAway: Number(yellowCardsAway),
            redCardsHome: 0,
            redCardsAway: 0,
            possessionHome: 56,
            possessionAway: 44,
          },
          dataSource: 'Adaptive Learning Live Ingest',
        };
      }

      // Learn from match
      const event = await engine.learnFromFinishedMatch(fixture);

      return res.json({
        success: true,
        message: `Successfully adapted stats from ${homeTeamName} ${homeScore} - ${awayScore} ${awayTeamName}! Future games recalibrated.`,
        learningEvent: event,
        homeUpdatedRating: engine.getTeamRating(fixture.homeTeam.id, fixture.homeTeam.name, fixture.league),
        awayUpdatedRating: engine.getTeamRating(fixture.awayTeam.id, fixture.awayTeam.name, fixture.league),
      });
    } catch (err: any) {
      return res.status(500).json({ error: 'Failed to process match learning', details: err.message });
    }
  });

  return router;
}
