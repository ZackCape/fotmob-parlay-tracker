import axios from 'axios';
import { IFootballDataProvider, ProviderHealth } from './provider-interface.js';
import { Fixture, League, Team, MatchAnalysis, FixtureStatistics, Lineup, LineupPlayer, MarketPrediction } from '../types/football.js';
import { calculateDixonColes } from '../engine/poisson-dixon-coles.js';
import { deriveMarketPredictions } from '../engine/market-calculator.js';
import { estimateTeamStrengths, sampleFromResults } from '../utils/teamStrength.js';

/**
 * ESPN public scoreboard + summary adapter.
 * Scoreboard: https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard?dates=YYYYMMDD
 * Summary:    https://site.api.espn.com/apis/site/v2/sports/soccer/all/summary?event={id}
 * No API key required. Covers all major global league schedules, live scores and match statistics.
 */
const BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/all';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** ESPN league slug/code -> Cape Predictor League */
const LEAGUE_MAP: Record<string, League> = {
  'eng.1': 'EPL',
  'eng.2': 'CHAMPIONSHIP',
  'esp.1': 'LALIGA',
  'ita.1': 'SERIE_A',
  'ger.1': 'BUNDESLIGA',
  'ger.2': 'BUNDESLIGA2',
  'fra.1': 'LIGUE1',
  'uefa.champions': 'CHAMPIONS_LEAGUE',
  'uefa.europa': 'EUROPA_LEAGUE',
  'uefa.europa.conf': 'CONFERENCE_LEAGUE',
};

const SLUG_MAP: Array<[RegExp, League]> = [
  [/english-premier-league/i, 'EPL'],
  [/championship/i, 'CHAMPIONSHIP'],
  [/laliga/i, 'LALIGA'],
  [/italian-serie-a|serie-a/i, 'SERIE_A'],
  [/german-bundesliga/i, 'BUNDESLIGA'],
  [/bundesliga-2|2-bundesliga/i, 'BUNDESLIGA2'],
  [/ligue-1/i, 'LIGUE1'],
  [/uefa-champions|champions-league/i, 'CHAMPIONS_LEAGUE'],
  [/europa-league/i, 'EUROPA_LEAGUE'],
  [/conference-league/i, 'CONFERENCE_LEAGUE'],
];

function mapState(state?: string): Fixture['status'] {
  const s = (state || '').toLowerCase();
  if (s === 'post') return 'FINISHED';
  if (s === 'in') return 'LIVE';
  return 'TIMED';
}

function detectLeague(event: any): League | null {
  for (const l of event?.links || []) {
    const m = (l?.href || '').match(/league\/([^?\/]+)/);
    if (m && LEAGUE_MAP[m[1]]) return LEAGUE_MAP[m[1]];
  }
  const slug = event?.season?.slug || '';
  for (const [re, lg] of SLUG_MAP) if (re.test(slug)) return lg;
  const name = event?.name || '';
  for (const [re, lg] of SLUG_MAP) if (re.test(name)) return lg;
  return null;
}

function makeTeam(displayName: string, league: League, logo?: string, id?: string): Team {
  return {
    id: `espn-${id || displayName}`,
    name: displayName || 'Unknown',
    shortName: displayName || 'Unknown',
    code: (displayName || 'UNK').substring(0, 3).toUpperCase(),
    league,
    stadium: '',
    city: '',
    logo: logo || '',
  };
}

/** Convert an ESPN statistic displayValue (e.g. "47.2", "3") to a number or null. */
function num(v: any): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v));
  return isNaN(n) ? null : n;
}

/**
 * Parse an ESPN scoreline string written from one team's perspective,
 * e.g. "2-1" or "6-3". Returns null when the value is not a scoreline.
 */
function scoreline(v: any): { forGoals: number; againstGoals: number } | null {
  if (typeof v !== 'string') return null;
  const m = v.trim().match(/^(\d+)\s*-\s*(\d+)$/);
  if (!m) return null;
  const forGoals = parseInt(m[1], 10);
  const againstGoals = parseInt(m[2], 10);
  if (!Number.isFinite(forGoals) || !Number.isFinite(againstGoals)) return null;
  return { forGoals, againstGoals };
}

export interface EspnMatchStats {
  eventId: string;
  statistics: FixtureStatistics | null;
  events: Array<{ minute: string | null; team: string | null; type: string; detail: string | null; player: string | null }>;
  lineups: { home: Lineup | null; away: Lineup | null };
  form: { home: Array<'W' | 'D' | 'L'>; away: Array<'W' | 'D' | 'L'> };
  /**
   * Real scorelines from the last five completed matches, used to derive
   * genuine per-team attack / defence strengths for the Dixon-Coles model.
   */
  recentGoals: {
    home: Array<{ goalsFor: number; goalsAgainst: number }>;
    away: Array<{ goalsFor: number; goalsAgainst: number }>;
  };
}

export class EspnAdapter implements IFootballDataProvider {
  readonly name = 'ESPN Public Scoreboard (Free)';

  private headers() {
    return { 'User-Agent': UA, Accept: 'application/json' };
  }

  async getFixturesByDate(date: string, league: string = 'ALL'): Promise<Fixture[]> {
    const fixtures: Fixture[] = [];
    try {
      const compact = date.replace(/-/g, '');
      const res = await axios.get(`${BASE}/scoreboard`, {
        params: { dates: compact },
        headers: this.headers(),
        timeout: 12000,
      });
      const events: any[] = res.data?.events || [];
      for (const ev of events) {
        const lg = detectLeague(ev);
        if (!lg) continue;
        if (league !== 'ALL' && lg !== league) continue;
        const comp = ev.competitions?.[0];
        if (!comp) continue;
        const competitors = comp.competitors || [];
        const home = competitors.find((c: any) => c.homeAway === 'home');
        const away = competitors.find((c: any) => c.homeAway === 'away');
        if (!home || !away) continue;

        const state = comp.status?.type?.state || ev.status?.type?.state;
        const hs = num(home.score);
        const as = num(away.score);
        const kickoff = comp.date || ev.date || `${date}T00:00:00Z`;

        fixtures.push({
          id: `espn-${ev.id}`,
          externalId: String(ev.id),
          league: lg,
          season: String(ev.season?.year || date.substring(0, 4)),
          round: ev.season?.type?.description || 'Regular Season',
          date: (kickoff || '').substring(0, 10) || date,
          kickoffTime: kickoff,
          status: mapState(state),
          homeTeam: makeTeam(home.team?.displayName, lg, home.team?.logo, home.team?.id),
          awayTeam: makeTeam(away.team?.displayName, lg, away.team?.logo, away.team?.id),
          homeScore: hs,
          awayScore: as,
          htHomeScore: null,
          htAwayScore: null,
          venue: comp.venue?.fullName || ev.venue?.fullName || '',
          statistics: null,
          dataSource: 'ESPN Public Scoreboard (Free)',
        });
      }
    } catch (err: any) {
      console.warn('[EspnAdapter] Error:', err.message);
    }
    return fixtures;
  }

  /** Fetch and map raw match statistics from the ESPN summary endpoint. */
  async getMatchStats(eventId: string): Promise<EspnMatchStats | null> {
    try {
      const res = await axios.get(`${BASE}/summary`, {
        params: { event: eventId },
        headers: this.headers(),
        timeout: 12000,
      });
      const data = res.data;
      if (!data) return null;

      // ---- Team statistics ----
      const teams = data.boxscore?.teams || [];
      const homeStats: Record<string, any> = {};
      const awayStats: Record<string, any> = {};
      for (const t of teams) {
        const map: Record<string, any> = {};
        for (const s of t.statistics || []) map[s.name] = num(s.displayValue);
        if (t.homeAway === 'home') Object.assign(homeStats, map);
        else Object.assign(awayStats, map);
      }
      const statistics: FixtureStatistics | null =
        (Object.keys(homeStats).length || Object.keys(awayStats).length)
          ? {
              shotsHome: homeStats.totalShots ?? null,
              shotsAway: awayStats.totalShots ?? null,
              shotsOnTargetHome: homeStats.shotsOnTarget ?? null,
              shotsOnTargetAway: awayStats.shotsOnTarget ?? null,
              xgHome: homeStats.expectedGoals ?? null,
              xgAway: awayStats.expectedGoals ?? null,
              cornersHome: homeStats.wonCorners ?? null,
              cornersAway: awayStats.wonCorners ?? null,
              foulsHome: homeStats.foulsCommitted ?? null,
              foulsAway: awayStats.foulsCommitted ?? null,
              yellowCardsHome: homeStats.yellowCards ?? null,
              yellowCardsAway: awayStats.yellowCards ?? null,
              redCardsHome: homeStats.redCards ?? null,
              redCardsAway: awayStats.redCards ?? null,
              possessionHome: homeStats.possessionPct ?? null,
              possessionAway: awayStats.possessionPct ?? null,
            }
          : null;

      // ---- Key events ----
      const events: EspnMatchStats['events'] = [];
      for (const ke of data.keyEvents || []) {
        const type = ke.type?.text || ke.type?.type || '';
        const scoring = !!ke.scoringPlay;
        const card = ke.type?.type === 'yellowcard' ? 'Yellow Card' : ke.type?.type === 'redcard' ? 'Red Card' : null;
        if (!scoring && !card && ke.type?.type !== 'substitution') continue;
        const participant = (ke.participants || [])[0];
        events.push({
          minute: ke.clock?.displayValue || null,
          team: ke.team?.displayName || null,
          type: scoring ? 'Goal' : (card || ke.type?.text || 'Event'),
          detail: scoring ? null : (card || null),
          player: participant?.athlete?.displayName || null,
        });
      }

      // ---- Lineups ----
      const lineups: { home: Lineup | null; away: Lineup | null } = { home: null, away: null };
      for (const r of data.rosters || []) {
        const players: LineupPlayer[] = (r.roster || []).map((p: any) => ({
          id: String(p.athlete?.id || ''),
          name: p.athlete?.displayName || 'Unknown',
          number: parseInt(p.jersey || '0', 10) || 0,
          position: (p.position?.abbreviation || 'M') as any,
        }));
        const starters = players.filter(p => r.roster.find((x: any) => x.athlete?.id === p.id)?.starter);
        const subs = players.filter(p => !r.roster.find((x: any) => x.athlete?.id === p.id)?.starter);
        const lineup: Lineup = {
          teamId: String(r.team?.id || ''),
          formation: r.formation || null,
          isConfirmed: true,
          startingXI: starters.length ? starters : null,
          substitutes: subs.length ? subs : null,
          coach: (r.coach || [])[0]?.displayName || null,
        };
        if (r.homeAway === 'home') lineups.home = lineup;
        else lineups.away = lineup;
      }

      // ---- Form + recent goals (last five games) ----
      //
      // NOTE: ESPN's `lastFiveGames` feed is NOT shaped like a scoreboard
      // competitor list. Each entry looks like:
      //   { displayOrder: 1 | 2, team: { id }, events: [{
      //       atVs: 'vs' | '@', score: 'myGoals-opponentGoals',
      //       homeTeamScore, awayTeamScore, gameResult: 'W' | 'L' | 'D' }] }
      // `score` is always written from the team's own perspective, and
      // `displayOrder` is numeric, not the strings 'home'/'away'.
      const form: EspnMatchStats['form'] = { home: [], away: [] };
      const recentGoals: EspnMatchStats['recentGoals'] = { home: [], away: [] };

      const currentHomeId = String(data.header?.competitions?.[0]?.competitors?.find((c: any) => c.homeAway === 'home')?.team?.id ?? '');
      const currentAwayId = String(data.header?.competitions?.[0]?.competitors?.find((c: any) => c.homeAway === 'away')?.team?.id ?? '');

      for (const lf of data.lastFiveGames || []) {
        const teamId = String(lf.team?.id ?? '');

        // Prefer an explicit id match against the current fixture; fall back to
        // ESPN's numeric displayOrder (1 = home, 2 = away).
        let side: 'home' | 'away' | null = null;
        if (teamId && currentHomeId && teamId === currentHomeId) side = 'home';
        else if (teamId && currentAwayId && teamId === currentAwayId) side = 'away';
        else if (lf.displayOrder === 1 || lf.displayOrder === '1') side = 'home';
        else if (lf.displayOrder === 2 || lf.displayOrder === '2') side = 'away';
        if (!side) continue;

        const results: Array<'W' | 'D' | 'L'> = [];
        const scorelines: Array<{ goalsFor: number; goalsAgainst: number }> = [];

        for (const ev of lf.events || []) {
          // Preferred: the "for-against" scoreline string (e.g. "2-1").
          const line = scoreline(ev.score);
          if (line) {
            results.push(line.forGoals > line.againstGoals ? 'W' : line.forGoals === line.againstGoals ? 'D' : 'L');
            scorelines.push({ goalsFor: line.forGoals, goalsAgainst: line.againstGoals });
            continue;
          }

          // Fallback: explicit home/away totals combined with venue (atVs).
          const homeScore = num(ev.homeTeamScore);
          const awayScore = num(ev.awayTeamScore);
          if (homeScore === null || awayScore === null) continue;
          const atHome = ev.atVs !== '@';
          const forGoals = atHome ? homeScore : awayScore;
          const againstGoals = atHome ? awayScore : homeScore;
          results.push(forGoals > againstGoals ? 'W' : forGoals === againstGoals ? 'D' : 'L');
          scorelines.push({ goalsFor: forGoals, goalsAgainst: againstGoals });
        }

        form[side] = results.slice(-5);
        recentGoals[side] = scorelines.slice(-5);
      }

      return { eventId: String(eventId), statistics, events, lineups, form, recentGoals };
    } catch (err: any) {
      console.warn(`[EspnAdapter] getMatchStats error for ${eventId}:`, err.message);
      return null;
    }
  }

  /** Build a full MatchAnalysis bundle for an ESPN fixture. */
  async getMatchDetails(fixtureId: string): Promise<MatchAnalysis | null> {
    const eventId = fixtureId.replace(/^espn-/, '');
    let fixture: Fixture | null = null;

    // Resolve fixture identity from scoreboard (search recent dates)
    for (const d of [-1, 0, 1, -2, 2]) {
      const date = new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
      const list = await this.getFixturesByDate(date, 'ALL');
      const found = list.find(f => f.id === fixtureId);
      if (found) { fixture = found; break; }
    }

    const stats = await this.getMatchStats(eventId);
    if (!fixture) {
      // Identity could not be verified - fail closed rather than substitute another match
      console.warn(`[EspnAdapter] Could not verify fixture identity for ${fixtureId}`);
      return null;
    }
    if (fixture.statistics === null && stats?.statistics) {
      fixture.statistics = stats.statistics;
    }
    fixture.homeLineup = stats?.lineups.home || null;
    fixture.awayLineup = stats?.lineups.away || null;

    // Build form from ESPN last-five (or neutral defaults when unavailable)
    const st = fixture.statistics;
    const homeForm = this.buildForm(stats?.form.home || [], st || null, 'home');
    const awayForm = this.buildForm(stats?.form.away || [], st || null, 'away');

    // Derive genuine per-team strengths from observed scorelines rather than
// the previously hardcoded constants, which produced identical probabilities
    // for every fixture on the slate.
    const strength = estimateTeamStrengths({
      league: fixture.league,
      homeRecent: sampleFromResults(stats?.recentGoals.home),
      awayRecent: sampleFromResults(stats?.recentGoals.away),
      homeXg: st?.xgHome ?? null,
      awayXg: st?.xgAway ?? null,
    });

    const dcResult = calculateDixonColes(
      strength.homeAttack, strength.homeDefense,
      strength.awayAttack, strength.awayDefense,
      fixture.league,
    );

    const supportingStats = {
      homeGoalAverageLast5: st?.xgHome ?? sampleFromResults(stats?.recentGoals.home)?.goalsForPerMatch ?? 1.5,
      awayGoalAverageLast5: st?.xgAway ?? sampleFromResults(stats?.recentGoals.away)?.goalsForPerMatch ?? 1.3,
      homeConcededAverageLast5: sampleFromResults(stats?.recentGoals.home)?.goalsConcededPerMatch ?? 1.1,
      awayConcededAverageLast5: sampleFromResults(stats?.recentGoals.away)?.goalsConcededPerMatch ?? 1.2,
      homeXgAverage: st?.xgHome ?? dcResult.homeExpectedGoals,
      awayXgAverage: st?.xgAway ?? dcResult.awayExpectedGoals,
      bttsFrequencyLast10: 0.55,
      over25FrequencyLast10: 0.58,
      h2hSummary: 'ESPN public match feed',
      cleanSheetRateHome: 0.32,
      cleanSheetRateAway: 0.24,
    };

    const marketPredictions = deriveMarketPredictions(
      fixture,
      strength.homeAttack, strength.homeDefense,
      strength.awayAttack, strength.awayDefense,
      supportingStats,
      homeForm.matchesPlayed,
      awayForm.matchesPlayed,
      []
    ) as MarketPrediction[];

    return {
      fixture,
      homeForm,
      awayForm,
      headToHead: { totalMeetings: 0, homeWins: 0, draws: 0, awayWins: 0, avgGoals: 0, recentMeetings: [] },
      dixonColesParameters: {
        homeExpectedGoals: dcResult.homeExpectedGoals,
        awayExpectedGoals: dcResult.awayExpectedGoals,
        homeAttackStrength: dcResult.homeAttackStrength,
        homeDefenseWeakness: dcResult.homeDefenseWeakness,
        awayAttackStrength: dcResult.awayAttackStrength,
        awayDefenseWeakness: dcResult.awayDefenseWeakness,
        homeAdvantage: dcResult.homeAdvantage,
      },
      scoreMatrix: dcResult.scoreMatrix,
      marketPredictions,
      injuries: null,
      lineups: { home: stats?.lineups.home || null, away: stats?.lineups.away || null },
      dataQualityNotes: [
        'Live data feed: ESPN public scoreboard/summary (no API key).',
        fixture.statistics
          ? 'Team statistics populated from ESPN boxscore.'
          : 'Match statistics unavailable at this time.',
        `Model strengths: ${strength.basis}.`,
        strength.priorOnly
          ? 'No recent results were published for these teams, so probabilities fall back to a neutral league prior and should be treated as low-confidence.'
          : 'Probabilities are model estimates, not bookmaker odds, and are not a guarantee of outcome.',
      ],
    };
  }

  private buildForm(results: Array<'W' | 'D' | 'L'>, st: FixtureStatistics | null, side: 'home' | 'away') {
    // Never claim matches were played when the provider supplied none.
    const played = results.length;
    const wins = results.filter(r => r === 'W').length;
    const draws = results.filter(r => r === 'D').length;
    const losses = results.filter(r => r === 'L').length;
    return {
      matchesPlayed: played,
      wins,
      draws,
      losses,
      goalsScored: st ? (side === 'home' ? st.shotsOnTargetHome : st.shotsOnTargetAway) ?? 0 : 0,
      goalsConceded: st ? (side === 'home' ? st.shotsOnTargetAway : st.shotsOnTargetHome) ?? 0 : 0,
      cleanSheets: 0,
      failedToScore: 0,
      avgShots: st ? (side === 'home' ? st.shotsHome : st.shotsAway) : null,
      avgShotsOnTarget: st ? (side === 'home' ? st.shotsOnTargetHome : st.shotsOnTargetAway) : null,
      avgCorners: st ? (side === 'home' ? st.cornersHome : st.cornersAway) : null,
      avgYellowCards: st ? (side === 'home' ? st.yellowCardsHome : st.yellowCardsAway) : null,
      avgXg: st ? (side === 'home' ? st.xgHome : st.xgAway) : null,
      last5Results: results,
      recentFixtures: [],
    };
  }

  async getHealth(): Promise<ProviderHealth> {
    return {
      providerName: this.name,
      isAvailable: true,
      lastSync: new Date().toISOString(),
      details: 'ESPN public scoreboard + summary endpoints (no API key, high capacity)',
    };
  }
}
