import { Router, Request, Response } from 'express';
import { DataProviderFactory } from '../providers/provider-factory.js';

const EMPTY_FORM = {
  matchesPlayed: 0, wins: 0, draws: 0, losses: 0, goalsScored: 0, goalsConceded: 0,
  cleanSheets: 0, failedToScore: 0, avgShots: null, avgShotsOnTarget: null, avgCorners: null,
  avgYellowCards: null, avgXg: null, last5Results: [], recentFixtures: [],
};
const EMPTY_DC = {
  homeExpectedGoals: 0, awayExpectedGoals: 0, homeAttackStrength: 0, homeDefenseWeakness: 0,
  awayAttackStrength: 0, awayDefenseWeakness: 0, homeAdvantage: 0,
};

/**
 * Normalise any provider payload into a fully-populated shape so the
 * frontend never crashes on a missing field.
 */
function normaliseAnalysis(analysis: any) {
  return {
    fixture: {
      statistics: null,
      injuries: null,
      homeLineup: null,
      awayLineup: null,
      ...analysis.fixture,
      homeTeam: analysis.fixture?.homeTeam ?? { id: '', name: 'Home', shortName: 'Home', code: 'HOM', league: 'EPL', stadium: '', city: '', logo: '' },
      awayTeam: analysis.fixture?.awayTeam ?? { id: '', name: 'Away', shortName: 'Away', code: 'AWY', league: 'EPL', stadium: '', city: '', logo: '' },
    },
    homeForm: { ...EMPTY_FORM, ...(analysis.homeForm ?? {}), last5Results: analysis.homeForm?.last5Results ?? [] },
    awayForm: { ...EMPTY_FORM, ...(analysis.awayForm ?? {}), last5Results: analysis.awayForm?.last5Results ?? [] },
    headToHead: {
      totalMeetings: 0, homeWins: 0, draws: 0, awayWins: 0, avgGoals: 0,
      ...(analysis.headToHead ?? {}), recentMeetings: analysis.headToHead?.recentMeetings ?? [],
    },
    dixonColesParameters: { ...EMPTY_DC, ...(analysis.dixonColesParameters ?? {}) },
    scoreMatrix: analysis.scoreMatrix ?? [],
    marketPredictions: (analysis.marketPredictions ?? []).map((p: any) => ({
      ...p,
      riskFactors: p.riskFactors ?? [],
      supportingStatistics: p.supportingStatistics ?? {},
    })),
    injuries: analysis.injuries ?? null,
    lineups: analysis.lineups ?? { home: null, away: null },
    dataQualityNotes: analysis.dataQualityNotes ?? [],
  };
}

export function createAnalysisRouter(factory: DataProviderFactory): Router {
  const router = Router();

  /**
   * GET /api/analysis/:id
   */
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const fixtureId = req.params.id as string;
      const analysis = await factory.getMatchDetails(fixtureId);

      if (!analysis || !analysis.fixture) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.status(404).json({ error: `Match analysis not found for fixture ID: ${fixtureId}` });
      }

      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.json(normaliseAnalysis(analysis));
    } catch (err: any) {
      console.error('[AnalysisRouter] Error:', err);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.status(500).json({ error: 'Failed to retrieve match analysis', details: err.message });
    }
  });

  return router;
}
