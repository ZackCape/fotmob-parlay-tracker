import axios from 'axios';
import { IFootballDataProvider, ProviderHealth } from './provider-interface.js';
import { Fixture, League, Team } from '../types/football.js';

/**
 * Football-Data.co.uk free CSV feeds (no API key required).
 * Public endpoint: https://www.football-data.co.uk/mmz4281/{season}/E0.csv
 * season format: 2026 27  (2026/2027 season)
 */
const BASE = 'https://www.football-data.co.uk';

function toLeagueFromCode(code: string): League | null {
  const c = (code || '').toUpperCase();
  if (c === 'E0') return 'EPL';
  if (c === 'E1') return 'CHAMPIONSHIP';
  if (c === 'SP1') return 'LALIGA';
  if (c === 'D1') return 'BUNDESLIGA';
  if (c === 'D2') return 'BUNDESLIGA2';
  if (c === 'F1') return 'LIGUE1';
  return null;
}

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

function parseDate(d: string, t?: string): string {
  // dd/mm/yyyy (+ optional hh:mm)
  const parts = (d || '').split('/');
  if (parts.length !== 3) return '';
  const [dd, mm, yyyy] = parts;
  const time = t && t.trim().length === 5 ? t.trim() : '00:00';
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}T${time}:00Z`;
}

function parseCsv(csv: string): Record<string, string>[] {
  const lines = csv.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim());
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
    const season = this.seasonForDate(date);
    const codes: Array<{ code: string; league: League }> = [];
    if (league === 'ALL' || league === 'EPL') codes.push({ code: 'E0', league: 'EPL' });
    if (league === 'ALL' || league === 'CHAMPIONSHIP') codes.push({ code: 'E1', league: 'CHAMPIONSHIP' });

    const fixtures: Fixture[] = [];
    for (const c of codes) {
      const csv = await this.fetchCsv(`/mmz4281/${season}/${c.code}.csv`);
      if (!csv) continue;
      const rows = parseCsv(csv);
      for (const r of rows) {
        const rowDate = r.Date || r.date || '';
        const iso = parseDate(rowDate, r.Time);
        if (!iso || iso.slice(0, 10) !== date) continue;
        const home = r.HomeTeam || r.home_team;
        const away = r.AwayTeam || r.away_team;
        if (!home || !away) continue;
        const hs = r.FTHG !== undefined && r.FTHG !== '' ? parseInt(r.FTHG, 10) : null;
        const as = r.FTAG !== undefined && r.FTAG !== '' ? parseInt(r.FTAG, 10) : null;
        fixtures.push({
          id: `fduk-${c.code}-${date}-${home}-${away}`.replace(/\s+/g, '-').toLowerCase(),
          externalId: `${c.code}-${date}-${home}-${away}`,
          league: c.league,
          season: season.trim(),
          round: c.code,
          date,
          kickoffTime: iso,
          status: hs !== null && as !== null ? 'FINISHED' : 'TIMED',
          homeTeam: makeTeam(home, c.league),
          awayTeam: makeTeam(away, c.league),
          homeScore: hs,
          awayScore: as,
          htHomeScore: null,
          htAwayScore: null,
          venue: r.Venue || '',
          statistics: null,
          dataSource: 'Football-Data.co.uk (Free CSV)',
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
      details: 'Football-Data.co.uk free CSV feeds (E0/E1), no API key required',
    };
  }
}
