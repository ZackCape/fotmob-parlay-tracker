import axios from 'axios';
import { IFootballDataProvider, ProviderHealth } from './provider-interface.js';
import { Fixture, League, Team, MatchAnalysis, FixtureStatistics, Lineup, LineupPlayer, MarketPrediction } from '../types/football.js';
import { calculateDixonColes } from '../engine/poisson-dixon-coles.js';
import { deriveMarketPredictions } from '../engine/market-calculator.js';
import { estimateTeamStrengths, sampleFromResults } from '../utils/teamStrength.js';

/**
 * ESPN public scoreboard + summary adapter.
 * Scoreboard: https://site.api.espn.com/apis/site/v2/sports/soccer/{league}/scoreboard?dates=YYYYMMDD
 * Summary:    https://site.api.espn.com/apis/site/v2/sports/soccer/all/summary?event={id}
 * No API key required. Covers all major global league schedules, live scores and match statistics.
 */
const SPORT_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const BASE = `${SPORT_BASE}/all`;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * ESPN league code -> Cape Predictor League.
 *
 * Every code here is verified against ESPN's own league directory and
 * per-league scoreboard endpoint, and `getFixturesByDate` fetches each of them
 * directly, so a competition missing from this map can never be served.
 * Keep it in step with `src/utils/leagueFlags.ts`.
 *
 * Poland is deliberately absent. ESPN's 220-league soccer directory carries no
 * Polish top flight and `pol.1` answers HTTP 400, so Ekstraklasa comes from a
 * fallback provider (or not at all) rather than being pointed at a guessed slug.
 */
export const LEAGUE_MAP: Record<string, League> = {
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
  // Expanded European coverage.
  'ned.1': 'EREDIVISIE',
  'por.1': 'PRIMEIRA_LIGA',
  'bel.1': 'PRO_LEAGUE',
  'sco.1': 'SCOTTISH_PREM',
  'tur.1': 'SUPER_LIG',
  'sui.1': 'SWISS_SUPER',
  'aut.1': 'AUSTRIAN_BUNDESLIGA',
  'den.1': 'DANISH_SUPERLIGA',
};

/**
 * ESPN numeric league id -> Cape Predictor League.
 *
 * ESPN stamps every event's `uid` with its competition, e.g.
 * `s:600~l:3914~e:401880205` is an English Championship match and `l:775` is
 * the Champions League. That is the most dependable attribution available, and
 * it matters: the season slugs of the English and Scottish second tiers are
 * both unhelpful ("regular-season" / "…-championship"), so slug matching alone
 * files Scottish matches under the English division.
 */
export const ESPN_LEAGUE_IDS: Record<number, League> = {
  700: 'EPL',
  3914: 'CHAMPIONSHIP',
  740: 'LALIGA',
  730: 'SERIE_A',
  720: 'BUNDESLIGA',
  3927: 'BUNDESLIGA2',
  710: 'LIGUE1',
  775: 'CHAMPIONS_LEAGUE',
  776: 'EUROPA_LEAGUE',
  20296: 'CONFERENCE_LEAGUE',
  725: 'EREDIVISIE',
  715: 'PRIMEIRA_LIGA',
  3901: 'PRO_LEAGUE',
  735: 'SCOTTISH_PREM',
  3946: 'SUPER_LIG',
  3944: 'SWISS_SUPER',
  3907: 'AUSTRIAN_BUNDESLIGA',
  3913: 'DANISH_SUPERLIGA',
};

/** Cape Predictor league -> ESPN code, derived so the two maps cannot drift. */
export const ESPN_CODE_BY_LEAGUE: Record<string, string> = Object.fromEntries(
  Object.entries(LEAGUE_MAP).map(([code, league]) => [league, code]),
);

/** The numeric league id ESPN embeds in an event's `uid` (`s:600~l:<id>~e:<id>`). */
function espnLeagueId(event: any): number | null {
  const m = String(event?.uid || '').match(/~l:(\d+)~/);
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isFinite(id) ? id : null;
}

/**
 * Fallback matcher for events whose links do not carry a `league/{code}` path.
 * Tested against both the season slug and the event name, in order, so the more
 * specific patterns must come first.
 *
 * These patterns are deliberately narrow. ESPN's `all` scoreboard carries every
 * competition on the planet, and a loose pattern silently files foreign matches
 * under the wrong competition — verified live: a bare `championship` matched
 * `2026-27-scottish-championship`, a bare `serie-a` matched
 * `2026-brasileiro-serie-a`, and `pro-league` matched
 * `2026-27-saudi-pro-league`. Each is now pinned to its own country.
 */
export const SLUG_MAP: Array<[RegExp, League]> = [
  [/english-premier-league/i, 'EPL'],
  // English second tier only — not the Scottish Championship or USL Championship.
  [/english[-\s]?championship|efl[-\s]?championship/i, 'CHAMPIONSHIP'],
  // Spanish top flight only — not LaLiga 2 (the second division).
  [/laliga(?!2)|la-liga(?!2)/i, 'LALIGA'],
  // Italian top flight only — not the Brazilian Série A.
  [/italian-serie-a|italy-serie-a/i, 'SERIE_A'],
  [/german-bundesliga/i, 'BUNDESLIGA'],
  [/bundesliga-2|2-bundesliga/i, 'BUNDESLIGA2'],
  [/ligue-1/i, 'LIGUE1'],
  [/uefa-champions|champions-league/i, 'CHAMPIONS_LEAGUE'],
  [/europa-league/i, 'EUROPA_LEAGUE'],
  [/conference-league/i, 'CONFERENCE_LEAGUE'],
  // Expanded European coverage.
  [/dutch-eredivisie|eredivisie/i, 'EREDIVISIE'],
  [/polish-ekstraklasa|ekstraklasa/i, 'EKSTRAKLASA'],
  [/portuguese-primeira-liga|primeira[-\s]?liga/i, 'PRIMEIRA_LIGA'],
  // Belgian top flight only — not the Saudi Pro League.
  [/belgian[-\s]?pro[-\s]?league|belgian[-\s]?first[-\s]?division|jupiler[-\s]?pro[-\s]?league/i, 'PRO_LEAGUE'],
  [/scottish[-\s]?premiership|scottish[-\s]?prem(?!iership)/i, 'SCOTTISH_PREM'],
  [/swiss[-\s]?super[-\s]?league/i, 'SWISS_SUPER'],
  [/austrian[-\s]?bundesliga/i, 'AUSTRIAN_BUNDESLIGA'],
  [/danish[-\s]?superliga/i, 'DANISH_SUPERLIGA'],
  // Last of the expanded set on purpose: `\b` stops "Superliga"/"Super League"
  // being read as the Turkish Süper Lig, and the named leagues above win first.
  [/turkish[-\s]?super[-\s]?lig|s[uü]per[-\s]?lig\b/i, 'SUPER_LIG'],
];

function mapState(state?: string): Fixture['status'] {
  const s = (state || '').toLowerCase();
  if (s === 'post') return 'FINISHED';
  if (s === 'in') return 'LIVE';
  return 'TIMED';
}

/**
 * Attribute a raw ESPN event to a Cape Predictor league.
 *
 * Exported so the attribution rules can be unit-tested directly: the ordering
 * (provider league id, then link code, then slug) is what keeps the English and
 * Scottish second tiers apart.
 */
export function detectLeague(event: any): League | null {
  // 1. The provider's own league id, straight off the event's `uid`.
  const numeric = espnLeagueId(event);
  if (numeric !== null && ESPN_LEAGUE_IDS[numeric]) return ESPN_LEAGUE_IDS[numeric];
  // 2. A `league/{code}` link path, when ESPN includes one.
  for (const l of event?.links || []) {
    const m = (l?.href || '').match(/league\/([^?\/]+)/);
    if (m && LEAGUE_MAP[m[1]]) return LEAGUE_MAP[m[1]];
  }
  // 3. Last resort: the season slug / event name.
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

/**
 * A single normalised match event.
 *
 * Every field is nullable on purpose: ESPN omits data depending on the league
 * and the stage of the match. Notably this league feed carries **no assist**
 * and **no VAR** entries, so those stay null rather than being invented.
 */
export interface EspnMatchEvent {
  /** ESPN's stable event id - the de-duplication key for live alerts. */
  id: string;
  /** Normalised category. */
  type: 'goal' | 'yellow-card' | 'red-card' | 'substitution' | 'penalty-missed' | 'var' | 'period' | 'other';
  /** Human label straight from the provider ("Goal", "Red Card", "Halftime"). */
  label: string;
  /** Display clock, e.g. "23'", "45'+2'". */
  minute: string | null;
  /** Elapsed seconds, when the provider supplies it. */
  minuteValue: number | null;
  /** Match period number (1 = first half, 2 = second half, ...). */
  period: number | null;
  teamId: string | null;
  team: string | null;
  /** Scorer for goals; the player booked/sent off for cards. */
  player: string | null;
  /** Assist, only when the provider actually publishes one. */
  assist: string | null;
  /** Substitution: player leaving / entering. */
  playerOut: string | null;
  playerIn: string | null;
  /** Provider's own sentence, when present (richest available context). */
  text: string | null;
  /** True for goals and other scoring plays. */
  scoring: boolean;
}

export interface EspnMatchStats {
  eventId: string;
  homeScore: number | null;
  awayScore: number | null;
  statistics: FixtureStatistics | null;
  /**
   * Normalised match events.
   *
   * `id` is ESPN's stable event identifier and is what the live-event
   * broadcaster uses to avoid re-alerting the same goal.
   */
  events: EspnMatchEvent[];
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

  /**
   * One competition's scoreboard.
   *
   * Returns null instead of throwing when ESPN rejects a code, so a single bad
   * league cannot take down a whole date's fetch.
   */
  private async fetchLeagueScoreboard(code: string, compact: string): Promise<any[] | null> {
    try {
      const res = await axios.get(`${SPORT_BASE}/${code}/scoreboard`, {
        params: { dates: compact },
        headers: this.headers(),
        timeout: 12000,
      });
      return res.data?.events || [];
    } catch (err: any) {
      console.warn(`[EspnAdapter] ${code} scoreboard unavailable: ${err.response?.status ?? err.message}`);
      return null;
    }
  }

  /** The broad `all` scoreboard: one request covering whatever ESPN lists today. */
  private async fetchAllScoreboard(compact: string): Promise<any[] | null> {
    try {
      const res = await axios.get(`${BASE}/scoreboard`, {
        params: { dates: compact },
        headers: this.headers(),
        timeout: 12000,
      });
      return res.data?.events || [];
    } catch (err: any) {
      console.warn('[EspnAdapter] all scoreboard unavailable:', err.message);
      return null;
    }
  }

  /** Map one raw ESPN event onto the domain model. */
  private mapEvent(ev: any, lg: League, date: string): Fixture | null {
    const comp = ev?.competitions?.[0];
    if (!comp) return null;
    const competitors = comp.competitors || [];
    const home = competitors.find((c: any) => c.homeAway === 'home');
    const away = competitors.find((c: any) => c.homeAway === 'away');
    if (!home || !away) return null;

    const state = comp.status?.type?.state || ev.status?.type?.state;
    const statusBlock = comp.status || ev.status || {};
    const kickoff = comp.date || ev.date || `${date}T00:00:00Z`;

    return {
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
      homeScore: num(home.score),
      awayScore: num(away.score),
      htHomeScore: null,
      htAwayScore: null,
      venue: comp.venue?.fullName || ev.venue?.fullName || '',
      statistics: null,
      // Real live clock straight from ESPN's status block (never inferred).
      liveClock: statusBlock?.displayClock ? String(statusBlock.displayClock).trim() : null,
      livePeriod: Number.isFinite(statusBlock?.period) ? Number(statusBlock.period) : null,
      providerStatus: statusBlock?.type?.name ? String(statusBlock.type.name) : null,
      dataSource: 'ESPN Public Scoreboard (Free)',
    };
  }

  /**
   * Fixtures for a date, for one league or for every supported competition.
   *
   * ESPN's combined `all` scoreboard is capped at 100 events per day, so on a
   * busy Saturday it silently truncates supported matches (measured live: the
   * English Championship's 11 fixtures and the Champions League's 9 were both
   * dropped, while `eng.2`/`uefa.champions` returned them in full). We therefore
   * sweep each competition's own endpoint, which is authoritative and complete.
   *
   * With `league === 'ALL'` the broad feed is also queried as a safety net, in
   * case ESPN moves a competition to a code we do not have yet.
   */
  async getFixturesByDate(date: string, league: string = 'ALL'): Promise<Fixture[]> {
    const compact = date.replace(/-/g, '');

    const codes: Array<[string, League]> = league === 'ALL'
      ? Object.entries(LEAGUE_MAP)
      : (ESPN_CODE_BY_LEAGUE[league] ? [[ESPN_CODE_BY_LEAGUE[league], league as League]] : []);
    if (codes.length === 0) return [];

    const fixtures: Fixture[] = [];
    const seen = new Set<string>();
    const push = (mapped: Fixture | null) => {
      if (!mapped || seen.has(mapped.id)) return;
      seen.add(mapped.id);
      fixtures.push(mapped);
    };

    // Small batches: polite fan-out without serialising the whole sweep.
    const BATCH_SIZE = 5;
    for (let i = 0; i < codes.length; i += BATCH_SIZE) {
      const batch = codes.slice(i, i + BATCH_SIZE);
      const settled = await Promise.allSettled(
        batch.map(([code]) => this.fetchLeagueScoreboard(code, compact)),
      );
      settled.forEach((result, index) => {
        if (result.status !== 'fulfilled' || !result.value) return;
        const expected = batch[index][1];
        for (const ev of result.value) push(this.mapEvent(ev, expected, date));
      });
    }

    if (league === 'ALL') {
      const all = await this.fetchAllScoreboard(compact);
      for (const ev of all || []) {
        const detected = detectLeague(ev);
        if (detected) push(this.mapEvent(ev, detected, date));
      }
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

      // ---- Score from header ----
      const headerComp = data.header?.competitions?.[0];
      const headerHome = headerComp?.competitors?.find((c: any) => c.homeAway === 'home');
      const headerAway = headerComp?.competitors?.find((c: any) => c.homeAway === 'away');
      const homeScore = num(headerHome?.score);
      const awayScore = num(headerAway?.score);

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
      //
      // ESPN's `type.type` values are hyphenated ('yellow-card', 'red-card',
      // 'end-regular-time'). The previous parser compared against the
      // un-hyphenated 'yellowcard'/'redcard', so it never matched and NO card
      // event was ever captured.
      const events: EspnMatchEvent[] = [];
      for (const ke of data.keyEvents || []) {
        const rawType = String(ke.type?.type || '').toLowerCase();
        const scoring = !!ke.scoringPlay;

        let type: EspnMatchEvent['type'] = 'other';
        if (scoring || rawType === 'goal' || rawType === 'penalty' || rawType === 'own-goal') type = 'goal';
        else if (rawType === 'red-card' || rawType === 'redcard' || rawType === 'second-yellow-card') type = 'red-card';
        else if (rawType === 'yellow-card' || rawType === 'yellowcard') type = 'yellow-card';
        else if (rawType === 'substitution') type = 'substitution';
        else if (rawType.includes('var')) type = 'var';
        else if (
          rawType.includes('half') || rawType.includes('period') || rawType.includes('kickoff')
          || rawType.includes('regular-time') || rawType.includes('extra-time')
          || rawType.includes('delay') || rawType.includes('penalty-shootout')
        ) type = 'period';

        // Only surface events worth alerting on; TV broadcast noise (start
        // delay / end delay) is deliberately dropped from the live feed.
        if (type === 'other') continue;
        if (rawType === 'start-delay' || rawType === 'end-delay') continue;

        const participants: any[] = ke.participants || [];
        // Some feeds tag the second participant of a goal as the assist.
        const assistEntry = participants.find((p: any) => {
          const pt = String(p.type || p.participantType || '').toLowerCase();
          return pt.includes('assist');
        });
        const assistName = assistEntry?.athlete?.displayName || ke.assist?.displayName || null;

        events.push({
          id: String(ke.id || `${ke.clock?.value ?? 'x'}-${rawType}-${ke.team?.id ?? ''}-${participants[0]?.athlete?.id ?? ''}`),
          type,
          label: ke.type?.text || type,
          minute: ke.clock?.displayValue || null,
          minuteValue: Number.isFinite(ke.clock?.value) ? Math.round(ke.clock.value) : null,
          period: Number.isFinite(ke.period?.number) ? ke.period.number : null,
          teamId: ke.team?.id ? String(ke.team.id) : null,
          team: ke.team?.displayName || null,
          player: participants[0]?.athlete?.displayName || null,
          assist: assistName,
          playerOut: type === 'substitution' ? (participants[0]?.athlete?.displayName || null) : null,
          playerIn: type === 'substitution' ? (participants[1]?.athlete?.displayName || null) : null,
          text: ke.text || null,
          scoring,
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

      return { eventId: String(eventId), homeScore, awayScore, statistics, events, lineups, form, recentGoals };
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
      homeTeam: fixture.homeTeam?.name ?? null,
      awayTeam: fixture.awayTeam?.name ?? null,
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
