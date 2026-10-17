import axios from 'axios';
import { IFootballDataProvider, ProviderHealth } from './provider-interface.js';
import { Fixture, League, Team } from '../types/football.js';

const BASE = 'https://www.thesportsdb.com/api/v1/json/3';

function mapStatus(status: string | null): Fixture['status'] {
  const s = (status || '').toLowerCase();
  if (s.includes('finished') || s === 'ft') return 'FINISHED';
  if (s.includes('live') || s.includes('in play')) return 'LIVE';
  if (s.includes('postponed') || s.includes('cancelled')) return 'POSTPONED';
  return 'TIMED';
}

function toLeague(leagueStr: string): League | null {
  const l = (leagueStr || '').toLowerCase();
  if (l.includes('premier league')) return 'EPL';
  if (l.includes('championship')) return 'CHAMPIONSHIP';
  if (l.includes('la liga') || l.includes('primera')) return 'LALIGA';
  if (l.includes('ligue 1')) return 'LIGUE1';
  if (l.includes('champions league')) return 'CHAMPIONS_LEAGUE';
  if (l.includes('europa league')) return 'EUROPA_LEAGUE';
  if (l.includes('conference')) return 'CONFERENCE_LEAGUE';
  if (l.includes('bundesliga')) return 'BUNDESLIGA';
  return null;
}

function makeTeam(name: string, league: League, logo?: string): Team {
  return {
    id: `tsdb-${(name || '').toLowerCase().replace(/\s+/g, '-')}`,
    name: name || 'Unknown',
    shortName: name || 'Unknown',
    code: (name || 'UNK').substring(0, 3).toUpperCase(),
    league,
    stadium: '',
    city: '',
    logo: logo || '',
  };
}

export class TheSportsDBAdapter implements IFootballDataProvider {
  readonly name = 'TheSportsDB (Free)';

  async getFixturesByDate(date: string, league: string = 'ALL'): Promise<Fixture[]> {
    const fixtures: Fixture[] = [];
    try {
      const res = await axios.get(`${BASE}/eventsday.php`, {
        params: { d: date, s: 'Soccer' },
        timeout: 8000,
      });
      const events = res.data?.events || [];
      for (const ev of events) {
        const lg = toLeague(ev.strLeague);
        if (!lg) continue;
        if (league !== 'ALL' && lg !== league) continue;
        const home = ev.strHomeTeam;
        const away = ev.strAwayTeam;
        if (!home || !away) continue;
        const kickoff = ev.strTimestamp || `${date}T00:00:00Z`;
        const homeScore = ev.intHomeScore !== null && ev.intHomeScore !== undefined ? parseInt(ev.intHomeScore, 10) : null;
        const awayScore = ev.intAwayScore !== null && ev.intAwayScore !== undefined ? parseInt(ev.intAwayScore, 10) : null;
        fixtures.push({
          id: `tsdb-${ev.idEvent}`,
          externalId: String(ev.idEvent),
          league: lg,
          season: ev.strSeason || date.substring(0, 4),
          round: ev.intRound || 'Regular Season',
          date: (ev.dateEvent || date),
          kickoffTime: kickoff,
          status: mapStatus(ev.strStatus),
          homeTeam: makeTeam(home, lg, ev.strHomeTeamBadge),
          awayTeam: makeTeam(away, lg, ev.strAwayTeamBadge),
          homeScore: isNaN(homeScore as any) ? null : homeScore,
          awayScore: isNaN(awayScore as any) ? null : awayScore,
          htHomeScore: null,
          htAwayScore: null,
          venue: ev.strVenue || '',
          statistics: null,
          dataSource: 'TheSportsDB (Free)',
        });
      }
    } catch (err: any) {
      console.warn('[TheSportsDBAdapter] Error:', err.message);
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
      details: 'TheSportsDB free soccer endpoint',
    };
  }
}