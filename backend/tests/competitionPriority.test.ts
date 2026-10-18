import { describe, it, expect } from 'vitest';
import {
  PRIORITY_LEAGUES,
  PRIORITY_LEAGUE_LABEL,
  NON_PRIORITY_RANK,
  canonicalPriorityId,
  isPriorityLeague,
  competitionPriority,
  compareCompetitionPriority,
  orderByCompetitionPriority,
  orderFixturesByPriority,
  orderPredictionsByPriority,
} from '../src/utils/competitionPriority.js';

/**
 * Competition priority is a single policy shared by the value picks, the
 * morning briefing, the Discord generators and the HTTP generator. These pin
 * the two things that matter: which spellings resolve to the Premier League /
 * Champions League, and that priority reorders tiers without disturbing the
 * caller's ordering inside a tier.
 */

function prediction(fixtureId: string, league: string, probability: number): any {
  return { fixtureId, league, estimatedProbability: probability };
}

describe('competition priority — leagues', () => {
  it('ranks the Premier League first and the Champions League second', () => {
    expect(PRIORITY_LEAGUES).toEqual(['EPL', 'CHAMPIONS_LEAGUE']);
    expect(competitionPriority('EPL')).toBe(0);
    expect(competitionPriority('CHAMPIONS_LEAGUE')).toBe(1);
  });

  it('ranks every other supported competition last', () => {
    for (const league of ['LALIGA', 'SERIE_A', 'BUNDESLIGA', 'CHAMPIONSHIP', 'DANISH_SUPERLIGA']) {
      expect(competitionPriority(league)).toBe(NON_PRIORITY_RANK);
    }
  });

  it('resolves the provider slugs and shorthands from the brief', () => {
    expect(canonicalPriorityId('eng.1')).toBe('EPL');
    expect(canonicalPriorityId('uefa.champions')).toBe('CHAMPIONS_LEAGUE');
    expect(canonicalPriorityId('UCL')).toBe('CHAMPIONS_LEAGUE');
    expect(canonicalPriorityId('Premier League')).toBe('EPL');
    expect(canonicalPriorityId('uefa champions league')).toBe('CHAMPIONS_LEAGUE');
    expect(canonicalPriorityId('soccer_epl')).toBe('EPL');
  });

  it('normalises case, punctuation and padding', () => {
    expect(canonicalPriorityId(' epl ')).toBe('EPL');
    expect(canonicalPriorityId('Eng-1')).toBe('EPL');
    expect(canonicalPriorityId('UEFA_Champions')).toBe('CHAMPIONS_LEAGUE');
  });

  it('rejects near-misses and empty input', () => {
    expect(canonicalPriorityId('eng.2')).toBeNull();
    expect(canonicalPriorityId('CHAMPIONSHIP')).toBeNull();
    expect(canonicalPriorityId('EUROPA_LEAGUE')).toBeNull();
    expect(canonicalPriorityId('')).toBeNull();
    expect(canonicalPriorityId(null)).toBeNull();
    expect(canonicalPriorityId(undefined)).toBeNull();
    expect(isPriorityLeague('LALIGA')).toBe(false);
    expect(isPriorityLeague('EPL')).toBe(true);
  });

  it('exposes a comparator', () => {
    expect(compareCompetitionPriority('EPL', 'LALIGA')).toBeLessThan(0);
    expect(compareCompetitionPriority('LALIGA', 'EPL')).toBeGreaterThan(0);
    expect(compareCompetitionPriority('EPL', 'EPL')).toBe(0);
    expect(compareCompetitionPriority('EPL', 'CHAMPIONS_LEAGUE')).toBeLessThan(0);
  });

  it('labels the policy for user-facing copy', () => {
    expect(PRIORITY_LEAGUE_LABEL).toBe('EPL & UCL priority');
  });
});

describe('orderByCompetitionPriority', () => {
  it('moves priority leagues to the front, preserving order inside a tier', () => {
    const items = [
      { league: 'LALIGA', id: 'a' },
      { league: 'SERIE_A', id: 'b' },
      { league: 'EPL', id: 'c' },
      { league: 'DANISH_SUPERLIGA', id: 'd' },
      { league: 'CHAMPIONS_LEAGUE', id: 'e' },
      { league: 'EPL', id: 'f' },
    ];
    expect(orderByCompetitionPriority(items, (i) => i.league).map((i) => i.id))
      .toEqual(['c', 'f', 'e', 'a', 'b', 'd']);
  });

  it('leaves the input order untouched when prioritisation is off', () => {
    const items = [{ league: 'LALIGA', id: 'a' }, { league: 'EPL', id: 'b' }];
    expect(orderByCompetitionPriority(items, (i) => i.league, { prioritize: false }).map((i) => i.id))
      .toEqual(['a', 'b']);
  });

  it('does not mutate the caller\'s array', () => {
    const items = [{ league: 'LALIGA', id: 'a' }, { league: 'EPL', id: 'b' }];
    orderByCompetitionPriority(items, (i) => i.league);
    expect(items.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('tolerates empty and nullish input', () => {
    expect(orderByCompetitionPriority([], () => 'EPL')).toEqual([]);
    expect(orderByCompetitionPriority(null, () => 'EPL')).toEqual([]);
    expect(orderByCompetitionPriority(undefined, () => 'EPL')).toEqual([]);
  });

  it('keeps an unknown or missing league at the bottom', () => {
    const items = [{ league: 'LALIGA', id: 'a' }, { league: undefined, id: 'b' }, { league: 'EPL', id: 'c' }];
    expect(orderByCompetitionPriority(items, (i: any) => i.league).map((i) => i.id))
      .toEqual(['c', 'a', 'b']);
  });
});

describe('orderFixturesByPriority', () => {
  it('sorts a mixed fixture slate EPL, UCL, then the rest in kick-off order', () => {
    const slate = [
      { id: '1', league: 'BUNDESLIGA' },
      { id: '2', league: 'EPL' },
      { id: '3', league: 'PRO_LEAGUE' },
      { id: '4', league: 'CHAMPIONS_LEAGUE' },
      { id: '5', league: 'EPL' },
    ];
    expect(orderFixturesByPriority(slate as any).map((f: any) => f.id))
      .toEqual(['2', '5', '4', '1', '3']);
  });
});

describe('orderPredictionsByPriority', () => {
  it('ranks EPL/UCL predictions ahead of a stronger secondary-league pick', () => {
    const pool = [
      prediction('laliga-1', 'LALIGA', 0.9),
      prediction('epl-1', 'EPL', 0.62),
      prediction('ucl-1', 'CHAMPIONS_LEAGUE', 0.61),
      prediction('serie-1', 'SERIE_A', 0.88),
    ];
    expect(orderPredictionsByPriority(pool as any).map((p) => p.fixtureId))
      .toEqual(['epl-1', 'ucl-1', 'laliga-1', 'serie-1']);
  });

  it('can be switched off for a pure pool order', () => {
    const pool = [prediction('laliga-1', 'LALIGA', 0.9), prediction('epl-1', 'EPL', 0.62)];
    expect(orderPredictionsByPriority(pool as any, false).map((p) => p.fixtureId))
      .toEqual(['laliga-1', 'epl-1']);
  });
});
