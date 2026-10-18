import axios from 'axios';
import { IFootballDataProvider, ProviderHealth } from './provider-interface.js';
import { Fixture, MatchAnalysis, League, Team } from '../types/football.js';

export class FootballDataOrgAdapter implements IFootballDataProvider {
  readonly name = 'Football-Data.org (REST)';
  private apiKey?: string;
  private baseUrl = 'https://api.football-data.org/v4';
  private cooldownUntil: number = 0;
  private authFailed: boolean = false;

  constructor(apiKey?: string) {
    this.apiKey = apiKey;
  }

  public isQuotaExhausted(): boolean {
    return this.authFailed;
  }

  public isInCooldown(): boolean {
    return Date.now() < this.cooldownUntil;
  }

  private getHeaders() {
    const headers: Record<string, string> = {};
    if (this.apiKey) {
      headers['X-Auth-Token'] = this.apiKey;
    }
    return headers;
  }

  async getFixturesByDate(date: string, league: string = 'ALL'): Promise<Fixture[]> {
    // Football-Data.org's free tier only carries the English top two divisions.
    // For any other competition we return nothing so the pipeline falls through
    // to a provider that can actually serve it, rather than answering an
    // Eredivisie request with Premier League fixtures.
    const COMPETITION_CODES: Record<string, string> = { EPL: 'PL', CHAMPIONSHIP: 'ELC' };
    const requestedCode = COMPETITION_CODES[league];
    if (league !== 'ALL' && !requestedCode) return [];
    const competitions = league === 'ALL' ? 'PL,ELC' : requestedCode;

    const fixtures: Fixture[] = [];
    try {
      const response = await axios.get(`${this.baseUrl}/matches`, {
        params: {
          dateFrom: date,
          dateTo: date,
          competitions,
        },
        headers: this.getHeaders(),
        timeout: 6000,
      });

      const matches = response.data?.matches || [];
      for (const m of matches) {
        const leagueName: League = m.competition.code === 'PL' ? 'EPL' : 'CHAMPIONSHIP';
        if (league !== 'ALL' && leagueName !== league) continue;
        const homeTeam: Team = {
          id: `fd-${m.homeTeam.id}`,
          name: m.homeTeam.name,
          shortName: m.homeTeam.shortName || m.homeTeam.name,
          code: m.homeTeam.tla || 'HOM',
          league: leagueName,
          stadium: 'Stadium',
          city: '',
          logo: m.homeTeam.crest || '',
        };

        const awayTeam: Team = {
          id: `fd-${m.awayTeam.id}`,
          name: m.awayTeam.name,
          shortName: m.awayTeam.shortName || m.awayTeam.name,
          code: m.awayTeam.tla || 'AWY',
          league: leagueName,
          stadium: '',
          city: '',
          logo: m.awayTeam.crest || '',
        };

        let status: Fixture['status'] = 'TIMED';
        if (m.status === 'FINISHED') status = 'FINISHED';
        else if (m.status === 'IN_PLAY' || m.status === 'PAUSED') status = 'LIVE';
        else if (m.status === 'POSTPONED') status = 'POSTPONED';

        fixtures.push({
          id: `fd-match-${m.id}`,
          externalId: String(m.id),
          league: leagueName,
          season: String(m.season?.startDate?.substring(0, 4) || '2026'),
          round: `Matchday ${m.matchday || 1}`,
          date,
          kickoffTime: m.utcDate || '',
          status,
          homeTeam,
          awayTeam,
          homeScore: m.score?.fullTime?.home ?? null,
          awayScore: m.score?.fullTime?.away ?? null,
          htHomeScore: m.score?.halfTime?.home ?? null,
          htAwayScore: m.score?.halfTime?.away ?? null,
          venue: 'Stadium',
          statistics: null,
          dataSource: 'Football-Data.org',
        });
      }
    } catch (err: any) {
      const status = err?.response?.status;
      console.warn('[FootballDataOrgAdapter] Error fetching fixtures:', err.message);
      if (status === 429) this.cooldownUntil = Date.now() + 60000;
      if (status === 401 || status === 403) this.authFailed = true;
    }
    return fixtures;
  }

  async getMatchDetails(fixtureId: string): Promise<MatchAnalysis | null> {
    // Football-Data.org free tier does not provide detailed in-match xG or shots
    return null;
  }

  async getHealth(): Promise<ProviderHealth> {
    return {
      providerName: this.name,
      isAvailable: !!this.apiKey,
      rateLimitRemaining: 10,
      lastSync: new Date().toISOString(),
      details: this.apiKey ? 'API Key configured' : 'API Key missing (PL free tier rate-limited)',
    };
  }
}
