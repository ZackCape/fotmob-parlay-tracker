import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { MatchAnalysisModal } from '../components/MatchAnalysisModal.jsx';
import { CapeMatchRow } from '../components/CapeMatchRow.jsx';

const baseFixture = {
  id: 'espn-1', externalId: '1', league: 'EPL', season: '2026', round: 'Regular Season',
  date: '2026-10-17', kickoffTime: '2026-10-17T11:30:00Z', status: 'FINISHED',
  homeTeam: { id: 't1', name: 'Everton', shortName: 'Everton', code: 'EVE', league: 'EPL', stadium: '', city: '', logo: '' },
  awayTeam: { id: 't2', name: 'Chelsea', shortName: 'Chelsea', code: 'CHE', league: 'EPL', stadium: '', city: '', logo: '' },
  homeScore: 0, awayScore: 2, htHomeScore: null, htAwayScore: null, venue: '',
  dataSource: 'ESPN Public Scoreboard (Free)',
};

describe('MatchAnalysisModal render safety', () => {
  it('renders a full analysis without TDZ/initialisation errors', () => {
    const analysis: any = {
      fixture: { ...baseFixture, statistics: { shotsHome: 6, shotsAway: 18, shotsOnTargetHome: 5, shotsOnTargetAway: 7, xgHome: null, xgAway: null, cornersHome: 5, cornersAway: 7, foulsHome: 8, foulsAway: 15, yellowCardsHome: 3, yellowCardsAway: 4, redCardsHome: 0, redCardsAway: 0, possessionHome: 47.2, possessionAway: 52.8 } },
      homeForm: { matchesPlayed: 5, wins: 3, draws: 1, losses: 1, goalsScored: 7, goalsConceded: 3, cleanSheets: 2, failedToScore: 0, avgShots: 12, avgShotsOnTarget: 4, avgCorners: 5, avgYellowCards: 1, avgXg: 1.4, last5Results: ['W', 'D', 'W', 'L', 'W'], recentFixtures: [] },
      awayForm: { matchesPlayed: 5, wins: 2, draws: 2, losses: 1, goalsScored: 5, goalsConceded: 4, cleanSheets: 1, failedToScore: 0, avgShots: 11, avgShotsOnTarget: 3, avgCorners: 4, avgYellowCards: 2, avgXg: 1.2, last5Results: ['W', 'W', 'D', 'L', 'D'], recentFixtures: [] },
      headToHead: { totalMeetings: 4, homeWins: 2, draws: 1, awayWins: 1, avgGoals: 2.5, recentMeetings: [] },
      dixonColesParameters: { homeExpectedGoals: 1.2, awayExpectedGoals: 1.5, homeAttackStrength: 1.1, homeDefenseWeakness: 1, awayAttackStrength: 1.2, awayDefenseWeakness: 1.05, homeAdvantage: 1.1 },
      scoreMatrix: [{ homeScore: 0, awayScore: 0, probability: 0.25 }],
      marketPredictions: [
        { id: 'a', fixtureId: 'espn-1', league: 'EPL', fixtureDescription: 'Everton vs Chelsea', kickoff: '2026-10-17T11:30:00Z', market: 'HOME_WIN', marketLabel: 'Full-Time Result', selection: 'Everton', estimatedProbability: 0.32, rawProbability: 0.33, confidenceLower: 0.2, confidenceUpper: 0.4, supportingStatistics: {}, sampleSize: 500, dataFreshnessDays: 0, riskFactors: [] },
        { id: 'b', fixtureId: 'espn-1', league: 'EPL', fixtureDescription: 'Everton vs Chelsea', kickoff: '2026-10-17T11:30:00Z', market: 'DRAW', marketLabel: 'Full-Time Result', selection: 'Draw', estimatedProbability: 0.28, rawProbability: 0.28, confidenceLower: 0.2, confidenceUpper: 0.4, supportingStatistics: {}, sampleSize: 500, dataFreshnessDays: 0, riskFactors: [] },
        { id: 'c', fixtureId: 'espn-1', league: 'EPL', fixtureDescription: 'Everton vs Chelsea', kickoff: '2026-10-17T11:30:00Z', market: 'AWAY_WIN', marketLabel: 'Full-Time Result', selection: 'Chelsea', estimatedProbability: 0.4, rawProbability: 0.39, confidenceLower: 0.25, confidenceUpper: 0.5, supportingStatistics: {}, sampleSize: 500, dataFreshnessDays: 0, riskFactors: [] },
      ],
      injuries: null,
      lineups: { home: { teamId: 't1', formation: '4-3-3', isConfirmed: true, startingXI: [{ id: 'p1', name: 'Pickford', number: 1, position: 'G' }], substitutes: [], coach: null }, away: null },
      dataQualityNotes: ['ESPN public feed'],
    };
    const html = renderToString(React.createElement(MatchAnalysisModal as any, { analysis, onClose: () => {} }));
    expect(html).toContain('Everton');
    expect(html).toContain('Chelsea');
  });

  it('renders with a completely sparse analysis payload (no crash)', () => {
    const sparse: any = { fixture: baseFixture };
    expect(() => renderToString(React.createElement(MatchAnalysisModal as any, { analysis: sparse, onClose: () => {} }))).not.toThrow();
  });

  it('returns null when analysis or fixture is missing', () => {
    expect(renderToString(React.createElement(MatchAnalysisModal as any, { analysis: null, onClose: () => {} }))).toBe('');
    expect(renderToString(React.createElement(MatchAnalysisModal as any, { analysis: {} as any, onClose: () => {} }))).toBe('');
  });
});

describe('CapeMatchRow render safety', () => {
  it('renders with missing team fields and undefined scores', () => {
    const broken: any = { ...baseFixture, homeTeam: undefined, awayTeam: undefined, homeScore: undefined, awayScore: undefined };
    expect(() => renderToString(React.createElement(CapeMatchRow as any, { fixture: broken, onSelect: () => {} }))).not.toThrow();
  });
});
