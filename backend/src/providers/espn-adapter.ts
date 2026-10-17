import axios from 'axios';
import { IFootballDataProvider, ProviderHealth } from './provider-interface.js';
import { Fixture, League, Team } from '../types/football.js';

/**
 * ESPN public scoreboard adapter.
 * Endpoint: https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard?dates=YYYYMMDD
 * No API key required. Covers all major global league schedules, live scores and status.
 */
const BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard';
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
  // 1) explicit league code from links
  const links = event?.links || [];
  for (const l of links) {
    const m = (l?.href || '').match(/league\/([^?\/]+)/);
    if (m && LEAGUE_MAP[m[1]]) return LEAGUE_MAP[m[1]];
  }
  // 2) season slug
  const slug = event?.season?.slug || '';
  for (const [re, lg] of SLUG_MAP) {
    if (re.test(slug)) return lg;
  }
  // 3) uid league token (l:700 etc.) fallback: name
  const name = event?.name || '';
  for (const [re, lg] of SLUG_MAP) {
    if (re.test(name)) return lg;
  }
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

export class EspnAdapter implements IFootballDataProvider {
  readonly name = 'ESPN Public Scoreboard (Free)';

  async getFixturesByDate(date: string, league: string = 'ALL'): Promise<Fixture[]> {
    const fixtures: Fixture[] = [];
    try {
      const compact = date.replace(/-/g, '');
      const res = await axios.get(BASE, {
        params: { dates: compact },
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        timeout: 12000,
      });
      const events: any[] = res.data?.events || [];
      for (const ev of events) {
        const lg = detectLeague(ev);
        if (!lg) continue; // unsupported competition
        if (league !== 'ALL' && lg !== league) continue;

        const comp = ev.competitions?.[0];
        if (!comp) continue;
        const competitors = comp.competitors || [];
        const home = competitors.find((c: any) => c.homeAway === 'home');
        const away = competitors.find((c: any) => c.homeAway === 'away');
        if (!home || !away) continue;

        const state = comp.status?.type?.state || ev.status?.type?.state;
        const hs = home.score !== undefined && home.score !== null && home.score !== '' ? parseInt(home.score, 10) : null;
        const as = away.score !== undefined && away.score !== null && away.score !== '' ? parseInt(away.score, 10) : null;
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

  async getMatchDetails(fixtureId: string): Promise<any> {
    return null;
  }

  async getHealth(): Promise<ProviderHealth> {
    return {
      providerName: this.name,
      isAvailable: true,
      lastSync: new Date().toISOString(),
      details: 'ESPN public scoreboard endpoint (no API key, high capacity)',
    };
  }
}
