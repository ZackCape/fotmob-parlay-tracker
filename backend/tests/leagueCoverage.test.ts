import { describe, it, expect } from 'vitest';
import {
  LEAGUE_MAP,
  ESPN_LEAGUE_IDS,
  ESPN_CODE_BY_LEAGUE,
  SLUG_MAP,
  detectLeague,
} from '../src/providers/espn-adapter.js';
import { ODDS_SPORT_KEYS, oddsLeagues, sportKeyForLeague } from '../src/providers/theodds-adapter.js';
import { API_FOOTBALL_LEAGUE_IDS, leagueFromApiFootballId } from '../src/providers/api-football-adapter.js';
import { LEAGUE_OPTIONS } from '../src/discord/leagues.js';
import { filterPreKickoffFixtures } from '../src/discord/fixtureStatus.js';
import { League } from '../src/types/football.js';

/**
 * The pipeline fans out across several registries that must agree about which
 * competitions exist. A league missing from any one of them is either dropped
 * silently (ESPN attribution, API-Football) or answered with nothing at all
 * (odds feeds), so each registry is asserted here against real provider data.
 */

/** The ten competitions added by the expansion brief, with their upstream ids. */
const EXPANSION: Array<{ id: League; espn: string | null; apiFootball: number; oddsApi: string }> = [
  { id: 'EREDIVISIE', espn: 'ned.1', apiFootball: 88, oddsApi: 'soccer_netherlands_eredivisie' },
  // ESPN's directory has no Polish top flight, so no ESPN code is claimed.
  { id: 'EKSTRAKLASA', espn: null, apiFootball: 106, oddsApi: 'soccer_poland_ekstraklasa' },
  { id: 'PRIMEIRA_LIGA', espn: 'por.1', apiFootball: 94, oddsApi: 'soccer_portugal_primeira_liga' },
  { id: 'PRO_LEAGUE', espn: 'bel.1', apiFootball: 144, oddsApi: 'soccer_belgium_first_div' },
  { id: 'SCOTTISH_PREM', espn: 'sco.1', apiFootball: 179, oddsApi: 'soccer_spl' },
  { id: 'CHAMPIONSHIP', espn: 'eng.2', apiFootball: 40, oddsApi: 'soccer_efl_champ' },
  { id: 'SUPER_LIG', espn: 'tur.1', apiFootball: 203, oddsApi: 'soccer_turkey_super_league' },
  { id: 'SWISS_SUPER', espn: 'sui.1', apiFootball: 207, oddsApi: 'soccer_switzerland_superleague' },
  { id: 'AUSTRIAN_BUNDESLIGA', espn: 'aut.1', apiFootball: 218, oddsApi: 'soccer_austria_bundesliga' },
  { id: 'DANISH_SUPERLIGA', espn: 'den.1', apiFootball: 119, oddsApi: 'soccer_denmark_superliga' },
];

/** Every competition the system now supports. */
const ALL_LEAGUES: League[] = [
  ...EXPANSION.map((e) => e.id),
  'EPL',
  'LALIGA',
  'SERIE_A',
  'LIGUE1',
  'BUNDESLIGA',
  'BUNDESLIGA2',
  'CHAMPIONS_LEAGUE',
  'EUROPA_LEAGUE',
  'CONFERENCE_LEAGUE',
];

describe('ESPN league registry', () => {
  const withEspnCode = EXPANSION.filter((e) => e.espn);

  it.each(withEspnCode)('maps ESPN $espn to $id', ({ espn, id }) => {
    expect(LEAGUE_MAP[espn as string]).toBe(id);
    expect(ESPN_CODE_BY_LEAGUE[id]).toBe(espn);
  });

  it('claims no ESPN code for Ekstraklasa, because ESPN does not carry it', () => {
    expect(LEAGUE_MAP['pol.1']).toBeUndefined();
    expect(ESPN_CODE_BY_LEAGUE['EKSTRAKLASA']).toBeUndefined();
  });

  it('keeps every pre-existing ESPN id working', () => {
    expect(LEAGUE_MAP['eng.1']).toBe('EPL');
    expect(LEAGUE_MAP['esp.1']).toBe('LALIGA');
    expect(LEAGUE_MAP['ger.1']).toBe('BUNDESLIGA');
    expect(LEAGUE_MAP['uefa.champions']).toBe('CHAMPIONS_LEAGUE');
  });

  /**
   * ESPN's numeric league ids, read live from the events' `uid`
   * (`s:600~l:<id>~e:<id>`). These are what make attribution reliable on busy
   * days, when the combined `all` feed truncates at 100 events.
   */
  it('records the verified ESPN numeric league ids', () => {
    const expected: Record<number, League> = {
      700: 'EPL',
      3914: 'CHAMPIONSHIP',
      740: 'LALIGA',
      730: 'SERIE_A',
      720: 'BUNDESLIGA',
      3927: 'BUNDESLIGA2',
      710: 'LIGUE1',
      775: 'CHAMPIONS_LEAGUE',
      776: 'EUROPA_LEAGUE',
      20296: 'CONFERENCE_LEAGUE',
      725: 'EREDIVISIE',
      715: 'PRIMEIRA_LIGA',
      3901: 'PRO_LEAGUE',
      735: 'SCOTTISH_PREM',
      3946: 'SUPER_LIG',
      3944: 'SWISS_SUPER',
      3907: 'AUSTRIAN_BUNDESLIGA',
      3913: 'DANISH_SUPERLIGA',
    };
    expect(ESPN_LEAGUE_IDS).toEqual(expected);
  });

  it('exposes one ESPN code per mapped competition', () => {
    expect(Object.keys(ESPN_CODE_BY_LEAGUE)).toHaveLength(Object.keys(LEAGUE_MAP).length);
    expect(new Set(Object.values(ESPN_CODE_BY_LEAGUE)).size).toBe(Object.values(ESPN_CODE_BY_LEAGUE).length);
  });

  const matchSlug = (slug: string): League | null => {
    for (const [re, league] of SLUG_MAP) if (re.test(slug)) return league;
    return null;
  };

  it('resolves the new competitions from human-readable slugs and names', () => {
    expect(matchSlug('dutch-eredivisie')).toBe('EREDIVISIE');
    expect(matchSlug('Eredivisie')).toBe('EREDIVISIE');
    expect(matchSlug('polish-ekstraklasa')).toBe('EKSTRAKLASA');
    expect(matchSlug('portuguese-primeira-liga')).toBe('PRIMEIRA_LIGA');
    expect(matchSlug('Primeira Liga')).toBe('PRIMEIRA_LIGA');
    expect(matchSlug('belgian-pro-league')).toBe('PRO_LEAGUE');
    expect(matchSlug('scottish-premiership')).toBe('SCOTTISH_PREM');
    expect(matchSlug('Scottish Premiership')).toBe('SCOTTISH_PREM');
    expect(matchSlug('turkish-super-lig')).toBe('SUPER_LIG');
    expect(matchSlug('Süper Lig')).toBe('SUPER_LIG');
    expect(matchSlug('swiss-super-league')).toBe('SWISS_SUPER');
    expect(matchSlug('Swiss Super League')).toBe('SWISS_SUPER');
    expect(matchSlug('austrian-bundesliga')).toBe('AUSTRIAN_BUNDESLIGA');
    expect(matchSlug('Austrian Bundesliga')).toBe('AUSTRIAN_BUNDESLIGA');
    expect(matchSlug('danish-superliga')).toBe('DANISH_SUPERLIGA');
  });

  it('does not let the Austrian competition be swallowed by the German pattern', () => {
    expect(matchSlug('austrian-bundesliga')).toBe('AUSTRIAN_BUNDESLIGA');
    expect(matchSlug('german-bundesliga')).toBe('BUNDESLIGA');
    expect(matchSlug('bundesliga-2')).toBe('BUNDESLIGA2');
  });

  /**
   * ESPN's `all` scoreboard carries every competition worldwide, so a loose
   * pattern files foreign matches under the wrong competition. These cases were
   * all observed live against the real feed.
   */
  it('never files a foreign competition under a supported league', () => {
    expect(matchSlug('2026-27-saudi-pro-league')).toBeNull();
    expect(matchSlug('2026-27-scottish-championship')).toBeNull();
    expect(matchSlug('2026-brasileiro-serie-a')).toBeNull();
    expect(matchSlug('2026-27-laliga2')).toBeNull();
    expect(matchSlug('2026-27-scottish-league-one')).toBeNull();
  });

  it('still resolves the genuine slugs those loose patterns were hiding', () => {
    expect(matchSlug('2026-27-belgian-pro-league')).toBe('PRO_LEAGUE');
    expect(matchSlug('2026-27-english-championship')).toBe('CHAMPIONSHIP');
    expect(matchSlug('2026-27-efl-championship')).toBe('CHAMPIONSHIP');
    expect(matchSlug('2026-27-italian-serie-a')).toBe('SERIE_A');
    expect(matchSlug('2026-27-laliga')).toBe('LALIGA');
    expect(matchSlug('2026-27-scottish-premiership')).toBe('SCOTTISH_PREM');
  });

  /**
   * Attribution precedence. The provider's own league id must win, because the
   * season slugs are ambiguous exactly where it matters most.
   */
  it('prefers the provider league id over an ambiguous season slug', () => {
    // English Championship: the real feed uses the slug "regular-season".
    expect(detectLeague({
      uid: 's:600~l:3914~e:401880205',
      season: { slug: 'regular-season' },
      name: 'Norwich City at Charlton Athletic',
    })).toBe('CHAMPIONSHIP');

    // Scottish Championship is a different competition entirely.
    expect(detectLeague({
      uid: 's:600~l:5202~e:1',
      season: { slug: '2026-27-scottish-championship' },
      name: 'Partick Thistle at Dunfermline Athletic',
    })).toBeNull();

    // Champions League league phase — slug "league-phase" says nothing.
    expect(detectLeague({
      uid: 's:600~l:775~e:401915403',
      season: { slug: 'league-phase' },
      name: 'Slavia Prague at Fenerbahce',
    })).toBe('CHAMPIONS_LEAGUE');

    // Saudi Pro League must not become the Belgian Pro League.
    expect(detectLeague({
      uid: 's:600~l:5487~e:1',
      season: { slug: '2026-27-saudi-pro-league' },
      name: 'Al Hilal at Al Hazem',
    })).toBeNull();
  });

  it('falls back to a league link and then to the slug when no id is present', () => {
    expect(detectLeague({
      uid: '',
      links: [{ href: 'https://www.espn.com/soccer/league/eng.1/match/_/gameId/1' }],
    })).toBe('EPL');

    expect(detectLeague({
      uid: '',
      season: { slug: '2026-27-laliga' },
      name: 'Elche at Rayo Vallecano',
    })).toBe('LALIGA');
  });
});

describe('The Odds API sport keys', () => {
  it.each(EXPANSION)('registers the $oddsApi feed for $id', ({ id, oddsApi }) => {
    expect(ODDS_SPORT_KEYS[id]).toBe(oddsApi);
    expect(sportKeyForLeague(id)).toBe(oddsApi);
  });

  it('covers eleven competitions and never invents a feed for the rest', () => {
    expect(oddsLeagues()).toHaveLength(11);
    // Competitions with no Tier-1 feed must resolve to null, not to a guess.
    expect(sportKeyForLeague('LALIGA')).toBeNull();
    expect(sportKeyForLeague('BUNDESLIGA')).toBeNull();
    expect(sportKeyForLeague('CONFERENCE_LEAGUE')).toBeNull();
  });

  it('uses the exact live catalog spelling for the Swiss league', () => {
    // Verified against The Odds API's /v4/sports listing: there is no
    // `soccer_switzerland_super_league`, only `soccer_switzerland_superleague`.
    expect(ODDS_SPORT_KEYS['SWISS_SUPER']).toBe('soccer_switzerland_superleague');
  });

  it('is case-insensitive on the league id', () => {
    expect(sportKeyForLeague('eredivisie')).toBe('soccer_netherlands_eredivisie');
  });
});

describe('API-Football league registry', () => {
  it.each(EXPANSION)('registers league id $apiFootball for $id', ({ id, apiFootball }) => {
    expect(API_FOOTBALL_LEAGUE_IDS[id]).toBe(apiFootball);
    expect(leagueFromApiFootballId(apiFootball)).toBe(id);
  });

  it('round-trips every registered id exactly once', () => {
    const ids = Object.values(API_FOOTBALL_LEAGUE_IDS);
    expect(new Set(ids).size).toBe(ids.length);
    expect(leagueFromApiFootballId(999999)).toBeNull();
    expect(leagueFromApiFootballId('not-a-number')).toBeNull();
  });
});

describe('Discord league catalogue', () => {
  it('offers every new competition', () => {
    const ids = LEAGUE_OPTIONS.map((l) => l.id);
    for (const { id } of EXPANSION) {
      expect(ids, `${id} missing from the Discord selector`).toContain(id);
    }
  });

  it('stays inside the Discord 25-option select limit', () => {
    expect(LEAGUE_OPTIONS.length).toBeLessThanOrEqual(25);
    expect(LEAGUE_OPTIONS.filter((l) => l.id !== 'ALL').length).toBeGreaterThanOrEqual(16);
  });

  it('has no duplicate league ids', () => {
    const ids = LEAGUE_OPTIONS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('pre-kickoff guardrail across every supported league', () => {
  const now = Date.UTC(2026, 9, 18, 15, 0, 0);
  const FUTURE = new Date(now + 3 * 3600_000).toISOString();
  const PAST = new Date(now - 3 * 3600_000).toISOString();

  const fixture = (league: League, id: string, status: string, kickoffTime: string) => ({
    id,
    league,
    status,
    kickoffTime,
    homeTeam: { name: `Home ${id}` },
    awayTeam: { name: `Away ${id}` },
  });

  it('drops finished and in-play fixtures for all 19 competitions', () => {
    expect(new Set(ALL_LEAGUES).size).toBe(19);

    const slate = ALL_LEAGUES.flatMap((league) => [
      fixture(league, `${league}-keep`, 'TIMED', FUTURE),
      fixture(league, `${league}-finished`, 'FINISHED', PAST),
      fixture(league, `${league}-live`, 'LIVE', FUTURE),
      fixture(league, `${league}-postponed`, 'POSTPONED', FUTURE),
    ]);

    const kept = filterPreKickoffFixtures(slate, now);

    expect(kept).toHaveLength(ALL_LEAGUES.length);
    expect(kept.every((f: any) => f.id.endsWith('-keep'))).toBe(true);
    expect(new Set(kept.map((f: any) => f.league)).size).toBe(ALL_LEAGUES.length);
  });

  it('excludes matches whose kick-off has already passed, in any league', () => {
    const slate = ALL_LEAGUES.map((league) => fixture(league, `${league}-stale`, 'TIMED', PAST));
    expect(filterPreKickoffFixtures(slate, now)).toHaveLength(0);
  });
});
