import axios from 'axios';
import { IFootballDataProvider, ProviderHealth } from './provider-interface.js';
import { Fixture, League, Team } from '../types/football.js';

const BASE = 'https://api.openligadb.de';

const LEAGUE_MAP: Record<string, League> = {
  bl1: 'BUNDESLIGA',
  bl2: 'BUNDESLIGA2',
  bl3: 'BUNDESLIGA2',
};

function mapStatus(match: any): Fixture['status'] {
  if (match.matchIsFinished) return 'FINISHED';
  const now = new Date();
  const kickoff = new Date(match.matchDateTimeUTC || match.matchDateTime);
  if (kickoff < now) return 'LIVE';
  return 'TIMED';
}

function makeTeam(name: string, league: League): Team {
  return {
    id: `oldb-${(name || '').toLowerCase().replace(/\s+/g, '-')}`,
    name: name || 'Unknown',
    shortName: name || 'Unknown',
    code: (name || 'UNK').substring(0, 3).toUpperCase(),
    league,
    stadium: '',
    city: '',
    logo: '',
  };
}

export class OpenLigaDBAdapter implements IFootballDataProvider {
  readonly name = 'OpenLigaDB (Free)';

  async getFixturesByDate(date: string, league: string = 'ALL'): Promise<Fixture[]> {
    const fixtures: Fixture[] = [];
    // Only German leagues are supported here.
    const targets: Array<{ shortcut: string; season: string }> = [];
    const season = date.substring(0, 4);
    if (league === 'ALL' || league === 'BUNDESLIGA' || league === 'BUNDESLIGA2') {
      targets.push({ shortcut: 'bl1', season });
      targets.push({ shortcut: 'bl2', season });
    }
    for (const t of targets) {
      try {
        const res = await axios.get(`${BASE}/getmatchdata/${t.shortcut}/${t.season}`, { timeout: 8000 });
        const matches = Array.isArray(res.data) ? res.data : [];
        for (const m of matches) {
          const matchDate = (m.matchDateTimeUTC || m.matchDateTime || '').substring(0, 10);
          if (matchDate !== date) continue;
          const lg = LEAGUE_MAP[t.shortcut];
          if (league !== 'ALL' && lg !== league) continue;
          const home = m.team1?.teamName || m.team1?.shortName;
          const away = m.team2?.teamName || m.team2?.shortName;
          if (!home || !away) continue;
          const homeScore = m.matchResults?.[0]?.pointsTeam1 ?? null;
          const awayScore = m.matchResults?.[0]?.pointsTeam2 ?? null;
          fixtures.push({
            id: `oldb-${m.matchID}`,
            externalId: String(m.matchID),
            league: lg,
            season: t.season,
            round: m.group?.groupName || 'Regular Season',
            date: matchDate,
            kickoffTime: m.matchDateTimeUTC || m.matchDateTime,
            status: mapStatus(m),
            homeTeam: makeTeam(home, lg),
            awayTeam: makeTeam(away, lg),
            homeScore,
            awayScore,
            htHomeScore: null,
            htAwayScore: null,
            venue: m.location?.locationStadium || '',
            statistics: null,
            dataSource: 'OpenLigaDB (Free)',
          });
        }
      } catch (err: any) {
        console.warn(`[OpenLigaDBAdapter] Error for ${t.shortcut}:`, err.message);
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
      details: 'OpenLigaDB free German league data',
    };
  }
}