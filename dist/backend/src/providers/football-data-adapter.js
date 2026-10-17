import axios from 'axios';
export class FootballDataOrgAdapter {
    name = 'Football-Data.org (REST)';
    apiKey;
    baseUrl = 'https://api.football-data.org/v4';
    constructor(apiKey) {
        this.apiKey = apiKey;
    }
    getHeaders() {
        const headers = {};
        if (this.apiKey) {
            headers['X-Auth-Token'] = this.apiKey;
        }
        return headers;
    }
    async getFixturesByDate(date, league = 'ALL') {
        const fixtures = [];
        try {
            const response = await axios.get(`${this.baseUrl}/matches`, {
                params: {
                    dateFrom: date,
                    dateTo: date,
                    competitions: league === 'CHAMPIONSHIP' ? 'ELC' : league === 'EPL' ? 'PL' : 'PL,ELC',
                },
                headers: this.getHeaders(),
                timeout: 6000,
            });
            const matches = response.data?.matches || [];
            for (const m of matches) {
                const leagueName = m.competition.code === 'PL' ? 'EPL' : 'CHAMPIONSHIP';
                const homeTeam = {
                    id: `fd-${m.homeTeam.id}`,
                    name: m.homeTeam.name,
                    shortName: m.homeTeam.shortName || m.homeTeam.name,
                    code: m.homeTeam.tla || 'HOM',
                    league: leagueName,
                    stadium: 'Stadium',
                    city: '',
                    logo: m.homeTeam.crest || '',
                };
                const awayTeam = {
                    id: `fd-${m.awayTeam.id}`,
                    name: m.awayTeam.name,
                    shortName: m.awayTeam.shortName || m.awayTeam.name,
                    code: m.awayTeam.tla || 'AWY',
                    league: leagueName,
                    stadium: '',
                    city: '',
                    logo: m.awayTeam.crest || '',
                };
                let status = 'TIMED';
                if (m.status === 'FINISHED')
                    status = 'FINISHED';
                else if (m.status === 'IN_PLAY' || m.status === 'PAUSED')
                    status = 'LIVE';
                else if (m.status === 'POSTPONED')
                    status = 'POSTPONED';
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
        }
        catch (err) {
            console.warn('[FootballDataOrgAdapter] Error fetching fixtures:', err.message);
        }
        return fixtures;
    }
    async getMatchDetails(fixtureId) {
        // Football-Data.org free tier does not provide detailed in-match xG or shots
        return null;
    }
    async getHealth() {
        return {
            providerName: this.name,
            isAvailable: !!this.apiKey,
            rateLimitRemaining: 10,
            lastSync: new Date().toISOString(),
            details: this.apiKey ? 'API Key configured' : 'API Key missing (PL free tier rate-limited)',
        };
    }
}
