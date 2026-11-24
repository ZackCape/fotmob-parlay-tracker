import type { Fixture } from '../types/football.js';
import { computeModelPerformance } from './evaluator.js';
import { calculateDixonColes } from './poisson-dixon-coles.js';

const MARKETS = ['HOME_WIN', 'DRAW', 'AWAY_WIN', 'OVER_2_5'] as const;
const DEFAULT_PRIORS = [0.44, 0.25, 0.31, 0.52];
type GoalMarket = typeof MARKETS[number];
type Evaluation = Parameters<typeof computeModelPerformance>[0][number];
type Result = Fixture & { homeScore: number; awayScore: number };

interface LeagueHistory {
  matches: number;
  homeGoals: number;
  awayGoals: number;
  outcomes: number[];
  form: Map<string, Array<{ scored: number; conceded: number }>>;
}

function emptyHistory(): LeagueHistory {
  return { matches: 0, homeGoals: 0, awayGoals: 0, outcomes: [0, 0, 0, 0], form: new Map() };
}

function expectedForm(history: LeagueHistory, teamId: string, averageGoals: number) {
  const games = history.form.get(teamId) ?? [];
  return {
    attack: (games.reduce((total, game) => total + game.scored, 4 * averageGoals) / (games.length + 4)) / averageGoals,
    defense: (games.reduce((total, game) => total + game.conceded, 4 * averageGoals) / (games.length + 4)) / averageGoals,
  };
}

function remember(history: LeagueHistory, team: string, scored: number, conceded: number) {
  history.form.set(team, [...(history.form.get(team) ?? []).slice(-9), { scored, conceded }]);
}

export function evaluateWalkForward(fixtures: readonly Fixture[]) {
  const days = new Map<string, Result[]>();
  const seen = new Set<string>();
  for (const fixture of fixtures) {
    if (fixture.status !== 'FINISHED' || fixture.homeScore === null || fixture.awayScore === null
      || !/^\d{4}-\d{2}-\d{2}$/.test(fixture.date) || seen.has(fixture.id)) continue;
    seen.add(fixture.id);
    const day = days.get(fixture.date) ?? [];
    day.push(fixture as Result);
    days.set(fixture.date, day);
  }

  const histories = new Map<string, LeagueHistory>();
  const calibrated: Evaluation[] = [];
  const fixedOver: Evaluation[] = [];
  const calibratedOver: Evaluation[] = [];
  const challengerOver: Evaluation[] = [];
  const weights = [0, 0, 0, 0];
  let trainingMatches = 0;

  for (const date of [...days.keys()].sort()) {
    // Build the day's entire slate before learning any of its outcomes.
    const day = days.get(date)!.map(fixture => {
      const history = histories.get(fixture.league) ?? emptyHistory();
      histories.set(fixture.league, history);
      const homeAverage = (history.homeGoals + 20 * 1.55) / (history.matches + 20);
      const awayAverage = (history.awayGoals + 20 * 1.30) / (history.matches + 20);
      const average = (homeAverage + awayAverage) / 2;
      const home = expectedForm(history, fixture.homeTeam.id, average);
      const away = expectedForm(history, fixture.awayTeam.id, average);
      const model = calculateDixonColes(
        home.attack, home.defense, away.attack, away.defense, fixture.league, 1.12,
        homeAverage * home.attack * away.defense, awayAverage * away.attack * home.defense,
      );
      const raw = [0, 0, 0, 0];
      for (const cell of model.scoreMatrix) {
        raw[cell.homeScore > cell.awayScore ? 0 : cell.homeScore === cell.awayScore ? 1 : 2] += cell.probability;
        if (cell.homeScore + cell.awayScore > 2) raw[3] += cell.probability;
      }
      const priors = DEFAULT_PRIORS.map((prior, index) => (history.outcomes[index] + 30 * prior) / (history.matches + 30));
      const probabilities = raw.map((p, index) => 0.8 * p + 0.2 * priors[index]);
      const fixed = 0.8 * raw[3] + 0.2 * DEFAULT_PRIORS[3];
      const features = [1, model.homeExpectedGoals - 1.55, model.awayExpectedGoals - 1.30, (priors[3] - 0.52) * 4];
      const challenger = 1 / (1 + Math.exp(-weights.reduce((sum, weight, i) => sum + weight * features[i], 0)));
      return { fixture, history, probabilities, fixed, features, challenger };
    });

    for (const { fixture, history, probabilities, fixed, features, challenger } of day) {
      const { homeScore, awayScore, league } = fixture;
      const observed = [homeScore > awayScore, homeScore === awayScore, awayScore > homeScore, homeScore + awayScore > 2];
      const evaluation = (market: GoalMarket, probability: number, hit: boolean): Evaluation => ({
        league, market, estimatedProbability: probability, actualOutcome: hit ? 'HIT' : 'MISS',
      });
      if (history.matches >= 5) {
        calibrated.push(...MARKETS.map((market, i) => evaluation(market, probabilities[i], observed[i])));
      }
      if (trainingMatches >= 50 && history.matches >= 5) {
        fixedOver.push(evaluation('OVER_2_5', fixed, observed[3]));
        calibratedOver.push(evaluation('OVER_2_5', probabilities[3], observed[3]));
        challengerOver.push(evaluation('OVER_2_5', challenger, observed[3]));
      }
    }

    for (const { fixture, history, features, challenger } of day) {
      const { homeScore, awayScore } = fixture;
      const observed = [homeScore > awayScore, homeScore === awayScore, awayScore > homeScore, homeScore + awayScore > 2];
      history.matches++;
      history.homeGoals += homeScore;
      history.awayGoals += awayScore;
      observed.forEach((hit, index) => { if (hit) history.outcomes[index]++; });
      remember(history, fixture.homeTeam.id, homeScore, awayScore);
      remember(history, fixture.awayTeam.id, awayScore, homeScore);
      const error = Number(observed[3]) - challenger;
      features.forEach((feature, index) => { weights[index] += 0.02 * (error * feature - 0.01 * weights[index]); });
      trainingMatches++;
    }
  }

  const scores = (items: Evaluation[]) => {
    const report = computeModelPerformance(items);
    return { brierScore: report.overallBrierScore, logLoss: report.overallLogLoss };
  };
  return {
    report: computeModelPerformance(calibrated),
    comparison: {
      fixtures: fixedOver.length,
      fixedPrior: scores(fixedOver),
      leaguePrior: scores(calibratedOver),
      logistic: scores(challengerOver),
    },
  };
}
