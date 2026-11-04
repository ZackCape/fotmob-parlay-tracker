import fs from 'fs';
import path from 'path';
import { config } from '../config/env.js';
const LEAGUE_MAP = {
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
function toLeague(raw) {
    if (!raw)
        return null;
    const key = raw.trim().toLowerCase();
    if (LEAGUE_MAP[key])
        return LEAGUE_MAP[key];
    // partial match
    for (const k of Object.keys(LEAGUE_MAP)) {
        if (key.includes(k))
            return LEAGUE_MAP[k];
    }
    return null;
}
function makeTeam(name, league) {
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
function normalise(raw, file) {
    const home = raw.home || raw.homeTeam;
    const away = raw.away || raw.awayTeam;
    const date = raw.date;
    if (!home || !away || !date)
        return null;
    const league = toLeague(raw.league || raw.competition);
    if (!league)
        return null;
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
export class OpenFootballAdapter {
    name = 'OpenFootball (Historical)';
    dataDir;
    constructor(dataDir) {
        this.dataDir = dataDir || config.openfootballDataDir;
    }
    readAll() {
        const out = [];
        const seen = new Set();
        if (!fs.existsSync(this.dataDir))
            return out;
        let files = [];
        try {
            files = fs.readdirSync(this.dataDir);
        }
        catch {
            return out;
        }
        const jsonFiles = files.filter((f) => f.endsWith('.json'));
        for (const f of jsonFiles) {
            const full = path.join(this.dataDir, f);
            let raw;
            try {
                raw = JSON.parse(fs.readFileSync(full, 'utf8'));
            }
            catch {
                continue;
            }
            const arr = Array.isArray(raw) ? raw : (raw?.matches || []);
            for (const item of arr) {
                const fx = normalise(item, f);
                if (!fx)
                    continue;
                if (seen.has(fx.id))
                    continue;
                seen.add(fx.id);
                out.push(fx);
            }
        }
        return out;
    }
    async getFixturesByDate(date, league = 'ALL') {
        // Historical source: only serve past dates (do not treat as current/live)
        const today = new Date().toISOString().slice(0, 10);
        if (date > today)
            return [];
        const all = this.readAll();
        return all.filter((f) => f.date === date && (league === 'ALL' || f.league === league));
    }
    async getMatchDetails(fixtureId) {
        // Historical source does not provide analysis bundles
        return null;
    }
    async getHealth() {
        const exists = fs.existsSync(this.dataDir);
        let count = 0;
        if (exists) {
            try {
                count = this.readAll().length;
            }
            catch {
                count = 0;
            }
        }
        return {
            providerName: this.name,
            isAvailable: exists,
            lastSync: new Date().toISOString(),
            details: exists ? `Loaded ${count} historical fixtures from ${this.dataDir}` : `Data directory not found: ${this.dataDir}`,
        };
    }
}
