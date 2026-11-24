import { describe, expect, it } from 'vitest';
import { HISTORICAL_MATCHES } from '../src/data/historical-stats.js';
import { evaluateWalkForward } from '../src/engine/walk-forward.js';
import { makePaperPick, summarizePaperPicks } from '../src/services/bettingRecordService.js';
import type { Fixture } from '../src/types/football.js';
import type { OddsSnapshot } from '../src/types/odds.js';

const now = Date.parse('2026-11-24T18:00:00Z');
const kickoff = '2026-11-24T19:00:00Z';
const fixture: Fixture = {
  ...HISTORICAL_MATCHES[0],
  id: 'espn-123',
  date: kickoff.slice(0, 10),
  kickoffTime: kickoff,
  status: 'TIMED',
};
const quote: OddsSnapshot = {
  id: 'quote',
  sportKey: 'soccer_epl',
  homeTeam: fixture.homeTeam.name,
  awayTeam: fixture.awayTeam.name,
  commenceTime: kickoff,
  preMatch: true,
  provider: 'The Odds API',
  retrievedAt: new Date(now - 1000).toISOString(),
  bookmakers: [1.98, 2.05].map((price, index) => ({
    key: String(index),
    title: `Book ${index}`,
    lastUpdate: new Date(now - 1000).toISOString(),
    markets: [{
      key: 'h2h',
      lastUpdate: new Date(now - 1000).toISOString(),
      outcomes: [{ name: fixture.homeTeam.name, price }],
    }],
  })),
};

describe('paper ROI', () => {
  it('only captures pre-kickoff, positive-edge picks with a named bookmaker', () => {
    expect(makePaperPick(fixture, 'HOME_WIN', 0.55, quote, now)).toMatchObject({
      bookmaker: 'Book 1',
      odds: 2.05,
      probability: 0.55,
      publishedAt: new Date(now).toISOString(),
    });
    expect(makePaperPick(fixture, 'HOME_WIN', 0.4, quote, now)).toBeNull();
    expect(makePaperPick(fixture, 'HOME_WIN', 0.55, quote, Date.parse(kickoff))).toBeNull();
    expect(makePaperPick(fixture, 'HOME_WIN', 0.55, { ...quote, preMatch: false }, now)).toBeNull();
    expect(makePaperPick(fixture, 'HOME_WIN', 0.55, { ...quote, commenceTime: new Date(now - 1).toISOString() }, now)).toBeNull();
  });

  it('keeps pending picks out of the stake denominator', () => {
    const pick = makePaperPick(fixture, 'HOME_WIN', 0.55, quote, now)!;
    expect(summarizePaperPicks([pick]).roi).toBeNull();
    const record = summarizePaperPicks([pick, { ...pick, outcome: 'HIT' }, { ...pick, outcome: 'MISS' }]);
    expect(record.pending).toBe(1);
    expect(record.settled).toBe(2);
    expect(record.profit).toBeCloseTo(0.05);
    expect(record.roi).toBeCloseTo(2.5);
  });
});

describe('walk-forward benchmark', () => {
  const results = Array.from({ length: 80 }, (_, index): Fixture => ({
    ...fixture,
    id: `result-${index}`,
    status: 'FINISHED',
    date: new Date(Date.UTC(2024, 7, 1 + index)).toISOString().slice(0, 10),
    homeScore: index % 4,
    awayScore: 1,
  }));

  it('does not learn from other matches on the target date', () => {
    const sameDay = results.map(result => ({ ...result, date: '2024-08-01' }));
    expect(evaluateWalkForward(sameDay).report.totalEvaluatedPredictions).toBe(0);
  });

  it('keeps benchmark samples aligned after warmup and sorts reversed input', () => {
    const evaluation = evaluateWalkForward(results);
    expect(evaluation).toEqual(evaluateWalkForward([...results].reverse()));
    expect(evaluation.report.totalEvaluatedPredictions).toBe(75 * 4);
    expect(evaluation.comparison.fixtures).toBe(30);
    expect(evaluation.comparison.fixedPrior.logLoss).not.toBeNull();
    expect(evaluation.comparison.leaguePrior.logLoss).not.toBeNull();
    expect(evaluation.comparison.logistic.logLoss).not.toBeNull();
  });
});
