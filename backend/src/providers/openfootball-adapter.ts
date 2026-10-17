import fs from 'fs';
import path from 'path';
import { IFootballDataProvider, ProviderHealth } from './provider-interface.js';
import { Fixture, League } from '../types/football.js';
import { config } from '../config/env.js';

interface OpenFootballRaw {
  date?: string;
  league?: string;
  competition?: string;
  home?: string;
  away?: string;
  homeTeam?: string;
  awayTeam?: string;
  homeGoals?: number | null;
  awayGoals?: number | null;
  home_goals?: number | null;
  away_goals?: number | null;
  season?: string;
  round?: string;
  venue?: string;
}

const LEAGUE_MAP: Record<string, League> = {
  'english premier league': 'EPL',
  'premier league': 'EPL',
  'epl': 'EPL',
  'championship': 'CHAMPIONSHIP',
  'efl championship': 'CHAMPIONSHIP',
  'la liga': 'LALIGA',
  'ligue 1': 'LIGUE1',
  'champions league': 'CHAMPIONS_LEAGUE',
  'europa league': 'EUROPA_LEAGUE',
  'conference league': 'CONFERENCE_LEAGUE',
};

function toLeague(raw?: string): League | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  if (LEAGUE_MAP[key]) return LEAGUE_MAP[key];
  // partial match
  for (const k of Object.keys(LEAGUE_MAP)) {
    if (key.includes(k)) return LEAGUE_MAP[k];
  }
  return null;
}

function makeTeam(name: string, league: League): any {
  return {
    id: `of-${name.toLowerCase().replace(/\s+/g, '-')}`,
    name,
    shortName: name,
    code: name.substring(0, 3).toUpperCase(),
    league,
    stadium: '',
    city: '',
    logo: '',
  };
}

function normalise(raw: OpenFootballRaw, file: string): Fixture | null {
  const home = raw.home || raw.homeTeam;
  const away = raw.away || raw.awayTeam;
  const date = raw.date;
  if (!home || !away || !date) return null;
  const league = toLeague(raw.league || raw.competition);
  if (!league) return null;
  const hg = raw.homeGoals ?? raw.home_goals ?? null;
  const ag = raw.awayGoals ?? raw.away_goals ?? null;
  const finished = hg !== null && ag !== null;
  const d = date.length === 10 ? date : new Date(date).toISOString().slice(0, 10);
  return {
    id: `of-${d}-${home}-${away}`.replace(/\s+/g, '-').toLowerCase(),
    externalId: `of-${d}-${home}-${away}`,
    league,
    season: raw.season || d.substring(0, 4),
    round: raw.round || 'Regular Season',
    date: d,
    kickoffTime: d,
    status: finished ? 'FINISHED' : 'TIMED',
    homeTeam: makeTeam(home, league),
    awayTeam: makeTeam(away, league),
    homeScore: hg,
    awayScore: ag,
    htHomeScore: null,
    htAwayScore: null,
    venue: raw.venue || '',
    statistics: null,
    dataSource: 'OpenFootball (Historical)',
  };
}

export class OpenFootballAdapter implements IFootballDataProvider {
  readonly name = 'OpenFootball (Historical)';
  private dataDir: string;

  constructor(dataDir?: string) {
    this.dataDir = dataDir || config.openfootballDataDir;
  }

  private readAll(): Fixture[] {
    const out: Fixture[] = [];
    const seen = new Set<string>();
    if (!fs.existsSync(this.dataDir)) return out;
    let files: string[] = [];
    try {
      files = fs.readdirSync(this.dataDir);
    } catch {
      return out;
    }
    const jsonFiles = files.filter((f) => f.endsWith('.json'));
    for (const f of jsonFiles) {
      const full = path.join(this.dataDir, f);
      let raw: any;
      try {
        raw = JSON.parse(fs.readFileSync(full, 'utf8'));
      } catch {
        continue;
      }
      const arr: OpenFootballRaw[] = Array.isArray(raw) ? raw : (raw?.matches || []);
      for (const item of arr) {
        const fx = normalise(item, f);
        if (!fx) continue;
        if (seen.has(fx.id)) continue;
        seen.add(fx.id);
        out.push(fx);
      }
    }
    return out;
  }

  async getFixturesByDate(date: string, league: string = 'ALL'): Promise<Fixture[]> {
    // Historical source: only serve past dates (do not treat as current/live)
    const today = new Date().toISOString().slice(0, 10);
    if (date > today) return [];
    const all = this.readAll();
    return all.filter((f) => f.date === date && (league === 'ALL' || f.league === league));
  }

  async getMatchDetails(fixtureId: string): Promise<any> {
    // Historical source does not provide analysis bundles
    return null;
  }

  async getHealth(): Promise<ProviderHealth> {
    const exists = fs.existsSync(this.dataDir);
    let count = 0;
    if (exists) {
      try { count = this.readAll().length; } catch { count = 0; }
    }
    return {
      providerName: this.name,
      isAvailable: exists,
      lastSync: new Date().toISOString(),
      details: exists ? `Loaded ${count} historical fixtures from ${this.dataDir}` : `Data directory not found: ${this.dataDir}`,
    };
  }
}
