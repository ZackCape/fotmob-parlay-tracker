import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { TheOddsAdapter } from '../src/providers/theodds-adapter.js';

vi.mock('axios');

function makeFixture(home: string, away: string, kickoff: string) {
  return {
    id: `fx-${home}-${away}`,
    league: 'EPL',
    homeTeam: { name: home },
    awayTeam: { name: away },
    kickoffTime: kickoff,
  } as any;
}

function mockResponse(events: any[]) {
  (axios.get as any).mockResolvedValue({ data: events, headers: {} });
}

describe('TheOddsAdapter matching', () => {
  beforeEach(() => vi.clearAllMocks());

  it('exact match returns odds', async () => {
    mockResponse([{
      id: 'ev1', sport_key: 'soccer_epl', home_team: 'Everton', away_team: 'Chelsea',
      commence_time: '2026-10-17T11:30:00Z',
      bookmakers: [{ key: 'skybet', title: 'Sky Bet', last_update: '2026-10-17T11:00:00Z', markets: [{ key: 'h2h', last_update: '2026-10-17T11:00:00Z', outcomes: [{ name: 'Everton', price: 2.9 }, { name: 'Draw', price: 2.75 }, { name: 'Chelsea', price: 2.63 }] }] }],
    }]);
    const adapter = new TheOddsAdapter('key', 'uk', 500, 50);
    const odds = await adapter.getOddsForFixture(makeFixture('Everton', 'Chelsea', '2026-10-17T11:30:00Z'));
    expect(odds).not.toBeNull();
    expect(odds!.id).toBe('ev1');
  });

  it('same teams different date -> no match', async () => {
    mockResponse([{
      id: 'ev1', sport_key: 'soccer_epl', home_team: 'Everton', away_team: 'Chelsea',
      commence_time: '2026-10-18T11:30:00Z',
      bookmakers: [],
    }]);
    const adapter = new TheOddsAdapter('key', 'uk', 500, 50);
    const odds = await adapter.getOddsForFixture(makeFixture('Everton', 'Chelsea', '2026-10-17T11:30:00Z'));
    expect(odds).toBeNull();
  });

  it('home/away reversed -> no match', async () => {
    mockResponse([{
      id: 'ev1', sport_key: 'soccer_epl', home_team: 'Chelsea', away_team: 'Everton',
      commence_time: '2026-10-17T11:30:00Z',
      bookmakers: [],
    }]);
    const adapter = new TheOddsAdapter('key', 'uk', 500, 50);
    const odds = await adapter.getOddsForFixture(makeFixture('Everton', 'Chelsea', '2026-10-17T11:30:00Z'));
    expect(odds).toBeNull();
  });

  it('kickoff outside tolerance -> no match', async () => {
    mockResponse([{
      id: 'ev1', sport_key: 'soccer_epl', home_team: 'Everton', away_team: 'Chelsea',
      commence_time: '2026-10-17T13:30:00Z',
      bookmakers: [],
    }]);
    const adapter = new TheOddsAdapter('key', 'uk', 500, 50);
    const odds = await adapter.getOddsForFixture(makeFixture('Everton', 'Chelsea', '2026-10-17T11:30:00Z'));
    expect(odds).toBeNull();
  });

  it('ambiguous multiple candidates -> no match', async () => {
    mockResponse([
      { id: 'ev1', sport_key: 'soccer_epl', home_team: 'Everton', away_team: 'Chelsea', commence_time: '2026-10-17T11:30:00Z', bookmakers: [] },
      { id: 'ev2', sport_key: 'soccer_epl', home_team: 'Everton', away_team: 'Chelsea', commence_time: '2026-10-17T11:32:00Z', bookmakers: [] },
    ]);
    const adapter = new TheOddsAdapter('key', 'uk', 500, 50);
    const odds = await adapter.getOddsForFixture(makeFixture('Everton', 'Chelsea', '2026-10-17T11:30:00Z'));
    expect(odds).toBeNull();
  });

  it('invalid odds handling in computeOddsComparison', async () => {
    const { computeOddsComparison } = await import('../src/utils/oddsMath.js');
    const r = computeOddsComparison(0, 3, 4, 0.4, 0.3, 0.3);
    expect(r.homeOdds).toBeNull();
  });
});