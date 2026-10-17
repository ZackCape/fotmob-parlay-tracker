import axios from 'axios';
import { IFootballDataProvider, ProviderHealth } from './provider-interface.js';
import { Fixture, League, Team } from '../types/football.js';

/**
 * OpenFootball raw GitHub JSON datasets (unmetered, static).
 * Source: https://github.com/openfootball
 * Tertiary fixture source used only as a last-resort fallback.
 */
const RAW_BASES = [
  'https://raw.githubusercontent.com/openfootball/football.json/master/2024-25/en.1.json',
  'https://raw.githubusercontent.com/openfootball/football.json/master/2023-24/en.1.json',
];

function toLeague(name?: string): League | null {
  const l = (name || '').toLowerCase();
  if (l.includes('premier league')) return 'EPL';
  if (l.includes('championship')) return 'CHAMPIONSHIP';
  if (l.includes('la liga')) return 'LALIGA';
  if (l.includes('bundesliga')) return 'BUNDESLIGA';
  if (l.includes('ligue 1')) return 'LIGUE1';
  return null;
}

function makeTeam(name: string, league: League): Team {
  return {
    id: `openfoot-${(name || '').toLowerCase().replace(/\s+/g, '-')}`,
    name,
    shortName: name,
    code: name.substring(0, 3).toUpperCase(),
    league,
    stadium: '',
    city: '',
    logo: '',
  };
}

export class OpenFootballGitHubAdapter implements IFootballDataProvider {
  readonly name = 'OpenFootball (Static GitHub Datasets)';

  private async loadSeasons(): Promise<Fixture[]> {
    const out: Fixture[] = [];
    for (const url of RAW_BASES) {
      try {
        const res = await axios.get(url, { timeout: 10000, responseType: 'text' });
        if (res.status !== 200 || !res.data) continue;
        out.push(...this.parseText(res.data));
      } catch (err: any) {
        console.warn(`[OpenFootballGitHubAdapter] fetch failed ${url}:`, err.message);
      }
    }
    return out;
  }

  private parseText(text: string): Fixture[] {
    const fixtures: Fixture[] = [];
    const league = toLeague(text) || 'EPL';
    const lines = text.split(/\r?\n/);
    let season = '';
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (/^\d{4}\/\d{2,4}$/.test(line)) {
        season = line;
        continue;
      }
      const m = line.match(/^(.+?)\s+(\d+)\s*-\s*(\d+)\s+(.+)$/);
      if (!m) continue;
      const home = m[1].trim();
      const away = m[4].trim();
      if (!home || !away) continue;
      fixtures.push({
        id: `openfoot-${league}-${home}-${away}-${fixtures.length}`.replace(/\s+/g, '-').toLowerCase(),
        externalId: `openfoot-${home}-${away}`,
        league,
        season,
        round: 'Regular Season',
        date: '',
        kickoffTime: '',
        status: 'FINISHED',
        homeTeam: makeTeam(home, league),
        awayTeam: makeTeam(away, league),
        homeScore: parseInt(m[2], 10),
        awayScore: parseInt(m[3], 10),
        htHomeScore: null,
        htAwayScore: null,
        venue: '',
        statistics: null,
        dataSource: 'OpenFootball (Static Dataset)',
      });
    }
    return fixtures;
  }

  async getFixturesByDate(date: string, league: string = 'ALL'): Promise<Fixture[]> {
    const fixtures = await this.loadSeasons();
    return fixtures.filter(f => (league === 'ALL' || f.league === league));
  }

  async getMatchDetails(fixtureId: string): Promise<any> {
    return null;
  }

  async getHealth(): Promise<ProviderHealth> {
    return {
      providerName: this.name,
      isAvailable: true,
      lastSync: new Date().toISOString(),
      details: 'OpenFootball static GitHub datasets (unmetered)',
    };
  }
}
