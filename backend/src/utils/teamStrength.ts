/**
 * Team strength estimation shared by every provider adapter.
 *
 * The Dixon-Coles engine consumes *relative multipliers* around 1.0:
 *
 *   homeLambda = leagueBaseline * homeAttack * awayDefense * homeAdvantage
 *   awayMu     = leagueBaseline * awayAttack * homeDefense
 *
 * Previously the ESPN adapter passed the same hardcoded constants
 * (1.25 / 0.95 / 1.10 / 1.10) for every fixture, which made the bot report
 * identical H/D/A probabilities for all matches. This module derives those
 * multipliers from *real observed data* instead.
 *
 * Evidence is ranked by quality and blended with a league prior so that
 * sparse samples never produce extreme values:
 *
 *   1. Observed goals for / conceded from recent completed matches (real).
 *   2. Provider expected-goals values attached to the fixture (real).
 *   3. League prior (neutral 1.0 multipliers) when nothing is observed.
 *
 * Nothing here invents statistics: every input is either supplied by a
 * provider or an explicit neutral prior, and the returned `basis` string
 * records which sources were actually used so the UI can disclose it.
 */

import { lookupTeamPower } from '../engine/teamPower.js';

/** League baseline goals per team per match, mirroring the DC engine. */
export function leagueBaselineRate(league: string): number {
  switch (league) {
    case 'CHAMPIONSHIP': return 1.30;
    case 'LALIGA': return 1.25;
    case 'LIGUE1': return 1.32;
    case 'CHAMPIONS_LEAGUE': return 1.55;
    case 'EUROPA_LEAGUE':
    case 'CONFERENCE_LEAGUE': return 1.48;
    default: return 1.40; // EPL, SERIE_A, BUNDESLIGA and unknown leagues
  }
}

export interface RecentGoalSample {
  /** Average goals scored per match over the observed window. */
  goalsForPerMatch?: number | null;
  /** Average goals conceded per match over the observed window. */
  goalsConcededPerMatch?: number | null;
  /** Number of completed matches the averages are based on. */
  matches?: number;
}

export interface StrengthInput {
  league: string;
  homeRecent?: RecentGoalSample | null;
  awayRecent?: RecentGoalSample | null;
  /** Provider xG for the home side in this specific fixture (preferred). */
  homeXg?: number | null;
  awayXg?: number | null;
  /** Home team name, used to look up its ELO power prior. */
  homeTeam?: string | null;
  /** Away team name, used to look up its ELO power prior. */
  awayTeam?: string | null;
}

export interface TeamStrengths {
  homeAttack: number;
  homeDefense: number;
  awayAttack: number;
  awayDefense: number;
  /** Human-readable description of the evidence actually used. */
  basis: string;
  /** True when only neutral league priors were available. */
  priorOnly: boolean;
}

/**
 * Shrinkage weight toward the league prior.
 *
 * Five matches of form is thin evidence, especially with heavy-tailed goal
 * distributions (a single 6-3 inflates the mean badly). With n/(n+5) a
 * five-match sample carries only half the weight, so a freak run cannot
 * produce a superhuman multiplier.
 */
function sampleWeight(matches: number): number {
  const n = Math.max(0, Math.min(20, matches));
  return n / (n + 5);
}

/** A single match beyond this many goals is treated as an outlier. */
const GOAL_WINSORISE_CAP = 4;

function finitePositive(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Clamp a multiplier to a defensible range.
 * Five matches cannot justify modelling a side as 2x better than average, so
 * the band is deliberately narrow around the prior.
 */
function clampMultiplier(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.max(0.55, Math.min(1.80, value));
}

/**
 * Blend an observed rate with a prior multiplier using sample shrinkage.
 *
 * The prior is normally the team's ELO power rating (alpha / beta); it defaults
 * to the neutral 1.0 when the club is unknown, which preserves the previous
 * behaviour exactly.
 */
function shrink(observed: number, baseline: number, matches: number, prior: number = 1): number {
  const raw = observed / baseline;
  const w = sampleWeight(matches);
  return clampMultiplier(prior * (1 - w) + raw * w);
}

/**
 * Attack multiplier: provider xG for this specific fixture is the most
 * specific signal, so it is blended in ahead of recent scoring form. Observed
 * evidence is shrunk toward the team's ELO power prior, never toward a bare 1.0.
 */
function attackMultiplier(
  baseline: number,
  xg: number | null | undefined,
  recent: RecentGoalSample | null | undefined,
  prior: number = 1,
): { value: number; used: boolean } {
  const xgValue = finitePositive(xg);
  const gf = finitePositive(recent?.goalsForPerMatch);
  const n = recent?.matches ?? 0;

  if (xgValue !== null && gf !== null) {
    // 65% fixture xG / 35% form, each already shrunk toward the prior.
    const fromXg = shrink(xgValue, baseline, n, prior);
    const fromForm = shrink(gf, baseline, n, prior);
    return { value: clampMultiplier(fromXg * 0.65 + fromForm * 0.35), used: true };
  }
  if (xgValue !== null) return { value: shrink(xgValue, baseline, n, prior), used: true };
  if (gf !== null && n > 0) return { value: shrink(gf, baseline, n, prior), used: true };

  // No observed attacking signal: use the ELO power prior (neutral 1.0 if unknown).
  return { value: clampMultiplier(prior), used: prior !== 1 };
}

/** Defensive multiplier is expressed as goals *conceded* relative to baseline. */
function defenseMultiplier(
  baseline: number,
  recent: RecentGoalSample | null | undefined,
  prior: number = 1,
): { value: number; used: boolean } {
  const ga = finitePositive(recent?.goalsConcededPerMatch);
  const n = recent?.matches ?? 0;
  if (ga !== null && n > 0) return { value: shrink(ga, baseline, n, prior), used: true };
  return { value: clampMultiplier(prior), used: prior !== 1 };
}

/**
 * Estimate the four Dixon-Coles multipliers for a fixture.
 * Every returned value is strictly positive and finite.
 */
export function estimateTeamStrengths(input: StrengthInput): TeamStrengths {
  const baseline = leagueBaselineRate(input.league);

  // ELO power priors (alpha = attack, beta = defensive weakness).
  const homePower = lookupTeamPower(input.homeTeam);
  const awayPower = lookupTeamPower(input.awayTeam);
  const homeAtkPrior = homePower?.attack ?? 1;
  const homeDefPrior = homePower?.defense ?? 1;
  const awayAtkPrior = awayPower?.attack ?? 1;
  const awayDefPrior = awayPower?.defense ?? 1;

  const homeAtk = attackMultiplier(baseline, input.homeXg, input.homeRecent, homeAtkPrior);
  const awayAtk = attackMultiplier(baseline, input.awayXg, input.awayRecent, awayAtkPrior);
  const homeDef = defenseMultiplier(baseline, input.homeRecent, homeDefPrior);
  const awayDef = defenseMultiplier(baseline, input.awayRecent, awayDefPrior);

  const used: string[] = [];
  if (input.homeXg || input.awayXg) used.push('fixture xG');
  if (input.homeRecent?.matches || input.awayRecent?.matches) {
    used.push(`recent form (${(input.homeRecent?.matches ?? 0) + (input.awayRecent?.matches ?? 0)} matches)`);
  }
  if (homePower || awayPower) used.push('ELO power ratings');

  const priorOnly = used.length === 0;

  return {
    homeAttack: homeAtk.value,
    homeDefense: homeDef.value,
    awayAttack: awayAtk.value,
    awayDefense: awayDef.value,
    basis: priorOnly
      ? `League prior only (${baseline.toFixed(2)} goals/team baseline) - no recent results available`
      : `Derived from ${used.join(' + ')} against a ${baseline.toFixed(2)} league baseline`,
    priorOnly,
  };
}

/**
 * Convert real recent scorelines into a winsorized goals-per-match sample.
 *
 * Individual match goal totals are capped at GOAL_WINSORISE_CAP before
 * averaging so that one rout (e.g. a 6-3) cannot dominate a five-game
 * window. Winsorizing (rather than discarding) keeps the result monotonic
 * in the raw data.
 */
export function sampleFromResults(
  results: Array<{ goalsFor: number; goalsAgainst: number }> | null | undefined,
): RecentGoalSample | null {
  if (!results || results.length === 0) return null;
  const valid = results.filter(
    (r) => Number.isFinite(r.goalsFor) && Number.isFinite(r.goalsAgainst) && r.goalsFor >= 0 && r.goalsAgainst >= 0,
  );
  if (valid.length === 0) return null;

  const cap = (g: number) => Math.min(GOAL_WINSORISE_CAP, Math.max(0, g));
  const totalFor = valid.reduce((sum, r) => sum + cap(r.goalsFor), 0);
  const totalAgainst = valid.reduce((sum, r) => sum + cap(r.goalsAgainst), 0);

  return {
    goalsForPerMatch: Number((totalFor / valid.length).toFixed(3)),
    goalsConcededPerMatch: Number((totalAgainst / valid.length).toFixed(3)),
    matches: valid.length,
  };
}

export default estimateTeamStrengths;