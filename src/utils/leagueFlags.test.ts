import { describe, it, expect } from 'vitest';
import {
  leagueFlagCode,
  leagueFlagUrl,
  leagueFlagEmoji,
  leagueCountryLabel,
  leagueDisplayName,
  leagueMeta,
  LEAGUE_META,
  SUPPORTED_LEAGUES,
  SUPPORTED_LEAGUE_COUNT,
  LEAGUE_DISPLAY_ORDER,
} from './leagueFlags';

describe('leagueFlags', () => {
  it('maps the top European leagues to their country codes', () => {
    expect(leagueFlagCode('EPL')).toBe('gb-eng');
    expect(leagueFlagCode('LALIGA')).toBe('es');
    expect(leagueFlagCode('LIGUE1')).toBe('fr');
    expect(leagueFlagCode('SERIE_A')).toBe('it');
    expect(leagueFlagCode('BUNDESLIGA')).toBe('de');
    expect(leagueFlagCode('BUNDESLIGA2')).toBe('de');
  });

  it('maps both continental cups to the European Union flag', () => {
    expect(leagueFlagCode('CHAMPIONS_LEAGUE')).toBe('eu');
    expect(leagueFlagCode('EUROPA_LEAGUE')).toBe('eu');
    expect(leagueFlagCode('CONFERENCE_LEAGUE')).toBe('eu');
  });

  it('maps the second English division to England', () => {
    expect(leagueFlagCode('CHAMPIONSHIP')).toBe('gb-eng');
  });

  it('builds crisp flagcdn URLs at the requested width', () => {
    expect(leagueFlagUrl('LALIGA')).toBe('https://flagcdn.com/w40/es.png');
    expect(leagueFlagUrl('EPL')).toBe('https://flagcdn.com/w40/gb-eng.png');
    expect(leagueFlagUrl('CHAMPIONS_LEAGUE', 20)).toBe('https://flagcdn.com/w20/eu.png');
  });

  it('returns null for competitions without a country', () => {
    expect(leagueFlagCode('ALL')).toBeNull();
    expect(leagueFlagUrl('ALL')).toBeNull();
    expect(leagueFlagCode(undefined)).toBeNull();
    expect(leagueFlagUrl('')).toBeNull();
  });

  it('is case-insensitive and trims input', () => {
    expect(leagueFlagCode(' laliga ')).toBe('es');
    expect(leagueFlagUrl('epl')).toBe('https://flagcdn.com/w40/gb-eng.png');
  });

  it('provides an emoji fallback for every league it can flag', () => {
    for (const league of [
      'EPL', 'CHAMPIONSHIP', 'LALIGA', 'LIGUE1', 'SERIE_A',
      'BUNDESLIGA', 'BUNDESLIGA2', 'CHAMPIONS_LEAGUE', 'EUROPA_LEAGUE', 'CONFERENCE_LEAGUE',
    ]) {
      expect(leagueFlagEmoji(league)).not.toBe('⚽');
    }
    expect(leagueFlagEmoji('UNKNOWN_LEAGUE')).toBe('⚽');
    expect(leagueFlagEmoji('ALL')).toBe('🌍');
  });

  it('exposes readable country labels for the sidebar copy', () => {
    expect(leagueCountryLabel('EPL')).toBe('England');
    expect(leagueCountryLabel('LALIGA')).toBe('Spain');
    expect(leagueCountryLabel('CHAMPIONS_LEAGUE')).toBe('Europe');
    expect(leagueCountryLabel('SOMETHING_ELSE')).toBe('Europe');
  });
});

/* ================================================================== *
 * Expanded coverage — the ten additional competitions
 * ================================================================== */

/** The ten new leagues and the flag code each must resolve to. */
const EXPANDED_COVERAGE: Array<[string, string]> = [
  ['EREDIVISIE', 'nl'],
  ['EKSTRAKLASA', 'pl'],
  ['PRIMEIRA_LIGA', 'pt'],
  ['PRO_LEAGUE', 'be'],
  ['SCOTTISH_PREM', 'gb-sct'],
  ['CHAMPIONSHIP', 'gb-eng'], // listed as EFL Championship in the brief
  ['SUPER_LIG', 'tr'],
  ['SWISS_SUPER', 'ch'],
  ['AUSTRIAN_BUNDESLIGA', 'at'],
  ['DANISH_SUPERLIGA', 'dk'],
];

describe('leagueFlags — expanded European coverage', () => {
  it.each(EXPANDED_COVERAGE)('maps %s to country code %s', (league, code) => {
    expect(leagueFlagCode(league)).toBe(code);
  });

  it.each(EXPANDED_COVERAGE)('builds the crisp flagcdn URL for %s', (league, code) => {
    expect(leagueFlagUrl(league)).toBe(`https://flagcdn.com/w40/${code}.png`);
  });

  it('resolves the brief\u2019s lowercase league ids case-insensitively', () => {
    expect(leagueFlagCode('eredivisie')).toBe('nl');
    expect(leagueFlagCode('ekstraklasa')).toBe('pl');
    expect(leagueFlagCode('primeira_liga')).toBe('pt');
    expect(leagueFlagCode('pro_league')).toBe('be');
    expect(leagueFlagCode('scottish_prem')).toBe('gb-sct');
    expect(leagueFlagCode('super_lig')).toBe('tr');
    expect(leagueFlagCode('swiss_super')).toBe('ch');
    expect(leagueFlagCode('austrian_bundesliga')).toBe('at');
    expect(leagueFlagCode('danish_superliga')).toBe('dk');
  });

  it('aliases the brief\u2019s efl_championship id onto the existing EFL Championship', () => {
    expect(leagueFlagCode('efl_championship')).toBe('gb-eng');
    expect(leagueFlagUrl('EFL_CHAMPIONSHIP')).toBe('https://flagcdn.com/w40/gb-eng.png');
    expect(leagueMeta('efl_championship')?.id).toBe('CHAMPIONSHIP');
    // One id per competition: the alias must not create a duplicate row.
    const ids = LEAGUE_META.map((m) => m.id);
    expect(ids).not.toContain('EFL_CHAMPIONSHIP');
    expect(ids.filter((id) => id === 'CHAMPIONSHIP')).toHaveLength(1);
  });

  it('exposes readable country labels for the new competitions', () => {
    expect(leagueCountryLabel('EREDIVISIE')).toBe('Netherlands');
    expect(leagueCountryLabel('EKSTRAKLASA')).toBe('Poland');
    expect(leagueCountryLabel('PRIMEIRA_LIGA')).toBe('Portugal');
    expect(leagueCountryLabel('PRO_LEAGUE')).toBe('Belgium');
    expect(leagueCountryLabel('SCOTTISH_PREM')).toBe('Scotland');
    expect(leagueCountryLabel('CHAMPIONSHIP')).toBe('England');
    expect(leagueCountryLabel('SUPER_LIG')).toBe('Turkey');
    expect(leagueCountryLabel('SWISS_SUPER')).toBe('Switzerland');
    expect(leagueCountryLabel('AUSTRIAN_BUNDESLIGA')).toBe('Austria');
    expect(leagueCountryLabel('DANISH_SUPERLIGA')).toBe('Denmark');
  });

  it('exposes display names for the sidebar and match cards', () => {
    expect(leagueDisplayName('EREDIVISIE')).toBe('Eredivisie');
    expect(leagueDisplayName('EKSTRAKLASA')).toBe('Ekstraklasa');
    expect(leagueDisplayName('PRIMEIRA_LIGA')).toBe('Primeira Liga');
    expect(leagueDisplayName('PRO_LEAGUE')).toBe('Pro League');
    expect(leagueDisplayName('SCOTTISH_PREM')).toBe('Scottish Premiership');
    expect(leagueDisplayName('SUPER_LIG')).toBe('Süper Lig');
    expect(leagueDisplayName('SWISS_SUPER')).toBe('Swiss Super League');
    expect(leagueDisplayName('AUSTRIAN_BUNDESLIGA')).toBe('Austrian Bundesliga');
    expect(leagueDisplayName('DANISH_SUPERLIGA')).toBe('Danish Superliga');
    // Unknown ids fall back to the raw id rather than inventing a name.
    expect(leagueDisplayName('NOT_A_LEAGUE')).toBe('NOT_A_LEAGUE');
  });

  it('records the provider ids given for the ten new competitions', () => {
    const expected: Record<string, { espn: string | null; apiFootball: number; oddsApi: string }> = {
      EREDIVISIE: { espn: 'ned.1', apiFootball: 88, oddsApi: 'soccer_netherlands_eredivisie' },
      // ESPN has no Polish top flight, so no ESPN code is claimed.
      EKSTRAKLASA: { espn: null, apiFootball: 106, oddsApi: 'soccer_poland_ekstraklasa' },
      PRIMEIRA_LIGA: { espn: 'por.1', apiFootball: 94, oddsApi: 'soccer_portugal_primeira_liga' },
      PRO_LEAGUE: { espn: 'bel.1', apiFootball: 144, oddsApi: 'soccer_belgium_first_div' },
      SCOTTISH_PREM: { espn: 'sco.1', apiFootball: 179, oddsApi: 'soccer_spl' },
      CHAMPIONSHIP: { espn: 'eng.2', apiFootball: 40, oddsApi: 'soccer_efl_champ' },
      SUPER_LIG: { espn: 'tur.1', apiFootball: 203, oddsApi: 'soccer_turkey_super_league' },
      SWISS_SUPER: { espn: 'sui.1', apiFootball: 207, oddsApi: 'soccer_switzerland_superleague' },
      AUSTRIAN_BUNDESLIGA: { espn: 'aut.1', apiFootball: 218, oddsApi: 'soccer_austria_bundesliga' },
      DANISH_SUPERLIGA: { espn: 'den.1', apiFootball: 119, oddsApi: 'soccer_denmark_superliga' },
    };

    for (const [league, ids] of Object.entries(expected)) {
      const meta = leagueMeta(league);
      expect(meta, `${league} missing from LEAGUE_META`).not.toBeNull();
      expect(meta!.espn).toBe(ids.espn);
      expect(meta!.apiFootball).toBe(ids.apiFootball);
      expect(meta!.oddsApi).toBe(ids.oddsApi);
    }
  });
});

describe('leagueFlags — catalogue integrity', () => {
  it('covers nineteen competitions plus the ALL selector', () => {
    expect(LEAGUE_META.filter((m) => m.id === 'ALL')).toHaveLength(1);
    expect(SUPPORTED_LEAGUE_COUNT).toBe(19);
    expect(LEAGUE_META).toHaveLength(20);
  });

  it('gives every real competition a flag URL, a country and an emoji fallback', () => {
    for (const meta of LEAGUE_META) {
      if (meta.id === 'ALL') continue;
      expect(leagueFlagUrl(meta.id), `${meta.id} has no flag URL`).toMatch(/^https:\/\/flagcdn\.com\/w40\/.+\.png$/);
      expect(leagueFlagEmoji(meta.id), `${meta.id} has no emoji fallback`).not.toBe('⚽');
      expect(meta.country).not.toBe('');
      expect(meta.name).not.toBe('');
    }
  });

  it('keeps LEAGUE_DISPLAY_ORDER in step with the catalogue', () => {
    expect(LEAGUE_DISPLAY_ORDER).toHaveLength(SUPPORTED_LEAGUE_COUNT);
    expect(new Set(LEAGUE_DISPLAY_ORDER).size).toBe(LEAGUE_DISPLAY_ORDER.length);
    const catalogueIds = new Set(SUPPORTED_LEAGUES);
    for (const id of LEAGUE_DISPLAY_ORDER) {
      expect(catalogueIds.has(id), `${id} is displayed but not in the catalogue`).toBe(true);
    }
  });

  it('mirrors the same competitions into SUPPORTED_LEAGUES', () => {
    expect(SUPPORTED_LEAGUES).not.toContain('ALL' as never);
    for (const id of SUPPORTED_LEAGUES) {
      expect(leagueFlagCode(id), `${id} has no flag code`).not.toBeNull();
    }
  });
});

