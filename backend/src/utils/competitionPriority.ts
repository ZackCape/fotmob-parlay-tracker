/* ------------------------------------------------------------------ *
 * Competition priority — Premier League and UEFA Champions League first
 *
 * Every ranking surface (calibrated value picks, the morning briefing, and the
 * statistical parlay builders on both the Discord and HTTP sides) orders its
 * candidate pool through this module, so "EPL and UCL first" is one decision
 * made once rather than four subtly different sorts.
 *
 * Priority is a **tier, not a filter**. A Premier League or Champions League
 * candidate outranks a secondary domestic league, and inside a tier the caller's
 * own ordering (highest calibrated probability, biggest edge, kick-off order) is
 * preserved exactly. Candidates below the tier still fill a parlay when the
 * priority pool cannot supply enough legs, and a priority fixture that fails the
 * caller's own minimum-probability threshold is never promoted over an eligible
 * one — priority never overrides a quality gate.
 * ------------------------------------------------------------------ */

import type { Fixture, MarketPrediction } from '../types/football.js';

/** Competitions ranked ahead of every other league, in display order. */
export const PRIORITY_LEAGUES: readonly string[] = ['EPL', 'CHAMPIONS_LEAGUE'];

/** Rank assigned to a competition that is not in `PRIORITY_LEAGUES`. */
export const NON_PRIORITY_RANK = PRIORITY_LEAGUES.length;

/**
 * The provider spellings, shorthands and slugs that resolve to a priority
 * competition. `eng.1` is ESPN's Premier League slug and `uefa.champions` its
 * Champions League slug; `UCL` is the id used in the task brief and in the
 * Discord copy, while the pipeline's own id stays `CHAMPIONS_LEAGUE`.
 */
const PRIORITY_ALIASES: Record<string, string> = {
  EPL: 'EPL',
  ENG_1: 'EPL',
  SOCCER_EPL: 'EPL',
  PREMIER_LEAGUE: 'EPL',
  ENGLISH_PREMIER_LEAGUE: 'EPL',
  UCL: 'CHAMPIONS_LEAGUE',
  UEFA_CHAMPIONS: 'CHAMPIONS_LEAGUE',
  UEFA_CHAMPIONS_LEAGUE: 'CHAMPIONS_LEAGUE',
  CHAMPIONS_LEAGUE: 'CHAMPIONS_LEAGUE',
  CHAMPIONSLEAGUE: 'CHAMPIONS_LEAGUE',
  EUROPEAN_CUP: 'CHAMPIONS_LEAGUE',
};

/** Human label used in Discord/web copy. */
export const PRIORITY_LEAGUE_LABEL = 'EPL & UCL priority';

/**
 * Normalise any league spelling to a comparable token: upper-cased, with every
 * run of non-alphanumeric characters collapsed to a single underscore, so
 * `eng.1`, `eng-1` and ` English 1 ` all compare equal.
 */
function normalize(league?: string | null): string {
  return league
    ? String(league).trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
    : '';
}

/** Canonical priority id (`EPL` / `CHAMPIONS_LEAGUE`), or null when not a priority competition. */
export function canonicalPriorityId(league?: string | null): string | null {
  const key = normalize(league);
  if (!key) return null;
  return PRIORITY_ALIASES[key] ?? null;
}

/** True when the league is the Premier League or the UEFA Champions League. */
export function isPriorityLeague(league?: string | null): boolean {
  return canonicalPriorityId(league) !== null;
}

/**
 * Sort key for a competition: 0 for the Premier League, 1 for the Champions
 * League, `NON_PRIORITY_RANK` for everything else. Lower sorts first.
 */
export function competitionPriority(league?: string | null): number {
  const canonical = canonicalPriorityId(league);
  if (canonical === null) return NON_PRIORITY_RANK;
  const index = PRIORITY_LEAGUES.indexOf(canonical);
  return index >= 0 ? index : NON_PRIORITY_RANK;
}

/** Comparator form of `competitionPriority`, for use with `Array#sort`. */
export function compareCompetitionPriority(a?: string | null, b?: string | null): number {
  return competitionPriority(a) - competitionPriority(b);
}

/**
 * Stable priority ordering for any list that carries a league.
 *
 * Implemented as a decorate-sort-undecorate so the incoming order is guaranteed
 * to survive inside a tier (V8's sort is stable, but the guarantee is explicit
 * here rather than inherited). `prioritize: false` returns the input untouched,
 * which is what a caller opts into when it wants a purely score-based ranking.
 */
export function orderByCompetitionPriority<T>(
  items: readonly T[] | null | undefined,
  leagueOf: (item: T) => string | null | undefined,
  options: { prioritize?: boolean } = {},
): T[] {
  const list = [...(items ?? [])];
  if (options.prioritize === false) return list;
  return list
    .map((item, index) => ({ item, index, rank: competitionPriority(leagueOf(item)) }))
    .sort((a, b) => (a.rank - b.rank) || (a.index - b.index))
    .map((entry) => entry.item);
}

/**
 * Priority ordering with an explicit score as the in-tier ranking.
 *
 * Use this when a tier's legs must be ranked on their own merit — the strongest
 * calibrated probability, the biggest edge — instead of inheriting whatever
 * order the provider happened to publish. Higher score sorts first; a tie falls
 * back to the incoming order.
 */
export function orderByCompetitionPriorityThenScore<T>(
  items: readonly T[] | null | undefined,
  leagueOf: (item: T) => string | null | undefined,
  scoreOf: (item: T) => number,
  options: { prioritize?: boolean } = {},
): T[] {
  const list = [...(items ?? [])];
  if (options.prioritize === false) return list;
  return list
    .map((item, index) => ({ item, index, rank: competitionPriority(leagueOf(item)) }))
    .sort((a, b) =>
      (a.rank - b.rank) || ((scoreOf(b.item) || 0) - (scoreOf(a.item) || 0)) || (a.index - b.index))
    .map((entry) => entry.item);
}

/**
 * Priority ordering for model predictions: the tier first, then the strongest
 * calibrated probability inside that tier.
 */
export function orderPredictionsByPriority(
  predictions: readonly MarketPrediction[] | null | undefined,
  prioritize = true,
): MarketPrediction[] {
  return orderByCompetitionPriorityThenScore(
    predictions,
    (p) => p?.league,
    (p) => p?.estimatedProbability ?? 0,
    { prioritize },
  );
}

/** Priority ordering for fixtures (used by briefings, value picks and generators). */
export function orderFixturesByPriority<T = Fixture>(
  fixtures: readonly T[] | null | undefined,
  prioritize = true,
): T[] {
  return orderByCompetitionPriority(fixtures, (f: any) => f?.league, { prioritize });
}

export default {
  PRIORITY_LEAGUES,
  PRIORITY_LEAGUE_LABEL,
  NON_PRIORITY_RANK,
  canonicalPriorityId,
  isPriorityLeague,
  competitionPriority,
  compareCompetitionPriority,
  orderByCompetitionPriority,
  orderByCompetitionPriorityThenScore,
  orderPredictionsByPriority,
  orderFixturesByPriority,
};
