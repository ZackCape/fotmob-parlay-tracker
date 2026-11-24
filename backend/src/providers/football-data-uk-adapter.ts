import axios from 'axios';
import { IFootballDataProvider, ProviderHealth } from './provider-interface.js';
import { Fixture, League, Team } from '../types/football.js';

// Football-Data.co.uk uses compact season codes, e.g. 2627 for 2026/27.
const BASE = 'https://www.football-data.co.uk';
const LEAGUE_CODES: ReadonlyArray<{ code: string; league: League }> = [
  { code: 'E0', league: 'EPL' },
  { code: 'E1', league: 'CHAMPIONSHIP' },
  { code: 'SP1', league: 'LALIGA' },
  { code: 'I1', league: 'SERIE_A' },
  { code: 'D1', league: 'BUNDESLIGA' },
  { code: 'D2', league: 'BUNDESLIGA2' },
  { code: 'F1', league: 'LIGUE1' },
];

function makeTeam(name: string, league: League): Team {
  return {
    id: `fduk-${(name || '').toLowerCase().replace(/\s+/g, '-')}`,
    name: name || 'Unknown',
    shortName: name || 'Unknown',
    code: (name || 'UNK').substring(0, 3).toUpperCase(),
    league,
    stadium: '',
    city: '',
    logo: '',
  };
}

function matchingDate(value: string, requestedDate: string): boolean {
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!match) return false;
  const [, day, month, year] = match;
  const requestedYear = requestedDate.slice(0, 4);
  const yearMatches = year === (year.length === 2 ? requestedYear.slice(2) : requestedYear);
  return yearMatches && requestedDate.slice(5) === `${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function parseScore(value: string | undefined): number | null {
  return value && /^\d+$/.test(value) ? Number(value) : null;
}

function parseCsv(csv: string): Record<string, string>[] {
  const lines = csv.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = lines[0].replace(/^\uFEFF/, '').split(',').map(h => h.trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    // naive CSV split (fields here have no embedded commas in the feeds we use)
    const cells = lines[i].split(',');
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = (cells[idx] || '').trim(); });
    rows.push(row);
  }
  return rows;
}

export class FootballDataUkAdapter implements IFootballDataProvider {
  readonly name = 'Football-Data.co.uk (Free CSV)';

  private seasonForDate(date: string): string {
    const y = parseInt(date.substring(0, 4), 10);
    const m = parseInt(date.substring(5, 7), 10);
    const start = m >= 7 ? y : y - 1;
    return `${String(start).slice(2)} ${String((start + 1) % 100).padStart(2, '0')}`;
  }

  private async fetchCsv(path: string): Promise<string | null> {
    try {
      const res = await axios.get(`${BASE}${path}`, { timeout: 10000, responseType: 'text' });
      if (res.status !== 200 || !res.data) return null;
      return res.data;
    } catch (err: any) {
      console.warn(`[FootballDataUkAdapter] fetch failed ${path}:`, err.message);
      return null;
    }
  }

  async getFixturesByDate(date: string, league: string = 'ALL'): Promise<Fixture[]> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
    const season = this.seasonForDate(date);
    const seasonCode = season.replace(' ', '');
    const leagues = LEAGUE_CODES.filter(entry => league === 'ALL' || entry.league === league);
    const feeds = await Promise.all(leagues.map(entry => this.fetchCsv(`/mmz4281/${seasonCode}/${entry.code}.csv`)));

    const fixtures: Fixture[] = [];
    for (const [index, c] of leagues.entries()) {
      const csv = feeds[index];
      if (!csv) continue;
      for (const r of parseCsv(csv)) {
        if (!matchingDate(r.Date || r.date || '', date)) continue;
        const home = r.HomeTeam || r.home_team;
        const away = r.AwayTeam || r.away_team;
        if (!home || !away) continue;
        const hs = parseScore(r.FTHG);
        const as = parseScore(r.FTAG);
        const time = r.Time && /^([01]\d|2[0-3]):[0-5]\d$/.test(r.Time) ? r.Time : '00:00';
        fixtures.push({
          id: `fduk-${c.code}-${date}-${home}-${away}`.replace(/\s+/g, '-').toLowerCase(),
          externalId: `${c.code}-${date}-${home}-${away}`,
          league: c.league,
          season,
          round: c.code,
          date,
          kickoffTime: `${date}T${time}:00Z`,
          status: hs !== null && as !== null ? 'FINISHED' : 'TIMED',
          homeTeam: makeTeam(home, c.league),
          awayTeam: makeTeam(away, c.league),
          homeScore: hs,
          awayScore: as,
          htHomeScore: null,
          htAwayScore: null,
          venue: r.Venue || '',
          statistics: null,
          dataSource: this.name,
        });
      }
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
      details: `Domestic CSV feeds (${LEAGUE_CODES.map(entry => entry.code).join('/')})`,
    };
  }
}
