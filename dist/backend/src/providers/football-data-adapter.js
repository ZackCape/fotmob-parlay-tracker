import axios from 'axios';
export class FootballDataOrgAdapter {
    name = 'Football-Data.org (REST)';
    apiKey;
    baseUrl = 'https://api.football-data.org/v4';
    cooldownUntil = 0;
    authFailed = false;
    constructor(apiKey) {
        this.apiKey = apiKey;
    }
    isQuotaExhausted() {
        return this.authFailed;
    }
    isInCooldown() {
        return Date.now() < this.cooldownUntil;
    }
    getHeaders() {
        const headers = {};
        if (this.apiKey) {
            headers['X-Auth-Token'] = this.apiKey;
        }
        return headers;
    }
    async getFixturesByDate(date, league = 'ALL') {
        // Football-Data.org's free tier only carries the English top two divisions.
        // For any other competition we return nothing so the pipeline falls through
        // to a provider that can actually serve it, rather than answering an
        // Eredivisie request with Premier League fixtures.
        const COMPETITION_CODES = { EPL: 'PL', CHAMPIONSHIP: 'ELC' };
        const requestedCode = COMPETITION_CODES[league];
        if (league !== 'ALL' && !requestedCode)
            return [];
        const competitions = league === 'ALL' ? 'PL,ELC' : requestedCode;
        const fixtures = [];
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
                const leagueName = m.competition.code === 'PL' ? 'EPL' : 'CHAMPIONSHIP';
                if (league !== 'ALL' && leagueName !== league)
                    continue;
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
            const status = err?.response?.status;
            console.warn('[FootballDataOrgAdapter] Error fetching fixtures:', err.message);
            if (status === 429)
                this.cooldownUntil = Date.now() + 60000;
            if (status === 401 || status === 403)
                this.authFailed = true;
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
