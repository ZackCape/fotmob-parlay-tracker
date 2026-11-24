import axios from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeModelPerformance } from '../src/engine/evaluator.js';
import { FootballDataUkAdapter } from '../src/providers/football-data-uk-adapter.js';

afterEach(() => vi.restoreAllMocks());

describe('Football-Data.co.uk fallback', () => {
  const csv = [
    '\uFEFFDate,Time,HomeTeam,AwayTeam,FTHG,FTAG',
    '7/8/24,19:00,Home,Away,0,2',
    '07/08/2024,20:00,Second Home,Second Away,1,1',
    '08/08/2024,19:00,Other Home,Other Away,2,2',
  ].join('\r\n');

  it('loads the compact season URL and recognizes both date formats', async () => {
    const get = vi.spyOn(axios, 'get').mockResolvedValue({ status: 200, data: csv });
    const fixtures = await new FootballDataUkAdapter().getFixturesByDate('2024-08-07', 'SERIE_A');

    expect(get).toHaveBeenCalledExactlyOnceWith(
      'https://www.football-data.co.uk/mmz4281/2425/I1.csv',
      expect.objectContaining({ responseType: 'text' }),
    );
    expect(fixtures).toHaveLength(2);
    expect(fixtures[0]).toMatchObject({ league: 'SERIE_A', status: 'FINISHED', homeScore: 0, awayScore: 2 });
    expect(fixtures[1].homeTeam.name).toBe('Second Home');
  });

  it('returns available leagues when one feed fails', async () => {
    const get = vi.spyOn(axios, 'get').mockImplementation(async (url) => {
      if (url.endsWith('/D1.csv')) throw new Error('Feed unavailable');
      return { status: 200, data: csv };
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const fixtures = await new FootballDataUkAdapter().getFixturesByDate('2024-08-07');

    expect(get).toHaveBeenCalledTimes(7);
    expect(new Set(fixtures.map(fixture => fixture.league))).toEqual(
      new Set(['EPL', 'CHAMPIONSHIP', 'LALIGA', 'SERIE_A', 'BUNDESLIGA2', 'LIGUE1']),
    );
  });

  it('skips competitions outside the domestic CSV catalogue', async () => {
    const get = vi.spyOn(axios, 'get');

    expect(await new FootballDataUkAdapter().getFixturesByDate('2024-08-07', 'CHAMPIONS_LEAGUE')).toEqual([]);
    expect(get).not.toHaveBeenCalled();
  });
});

describe('model performance', () => {
  it('does not produce scores for unsettled or invalid predictions', () => {
    const report = computeModelPerformance([
      { league: 'EPL', market: 'HOME_WIN', actualOutcome: 'PENDING', estimatedProbability: 0.4 },
      { league: 'EPL', market: 'DRAW', actualOutcome: 'HIT', estimatedProbability: Number.NaN },
    ]);

    expect(report).toEqual({
      overallBrierScore: null,
      overallLogLoss: null,
      overallHitRate: null,
      totalEvaluatedPredictions: 0,
      leagueBreakdown: {},
      marketBreakdown: {},
      calibrationBuckets: [],
    });
  });

  it('groups settled predictions across leagues and includes probabilities below 50%', () => {
    const report = computeModelPerformance([
      { league: 'LALIGA', market: 'DRAW', actualOutcome: 'MISS', estimatedProbability: 0.25 },
      { league: 'CHAMPIONS_LEAGUE', market: 'OVER_2_5', actualOutcome: 'HIT', estimatedProbability: 1 },
    ]);

    expect(report.totalEvaluatedPredictions).toBe(2);
    expect(report.overallBrierScore).toBe(0.031);
    expect(report.overallLogLoss).toBe(0.144);
    expect(report.overallHitRate).toBe(0.5);
    expect(report.leagueBreakdown).toEqual({
      LALIGA: { brierScore: 0.063, hitRate: 0, sampleCount: 1 },
      CHAMPIONS_LEAGUE: { brierScore: 0, hitRate: 1, sampleCount: 1 },
    });
    expect(report.marketBreakdown.OVER_2_5).toEqual({ brierScore: 0, hitRate: 1, sampleCount: 1 });
    expect(report.calibrationBuckets).toMatchObject([
      { minProb: 0.2, predictedMean: 0.25, observedFrequency: 0, sampleCount: 1 },
      { maxProb: 1, predictedMean: 1, observedFrequency: 1, sampleCount: 1 },
    ]);
  });
});
