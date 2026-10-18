import { describe, it, expect } from 'vitest';
import {
  leagueFlagCode,
  leagueFlagUrl,
  leagueFlagEmoji,
  leagueCountryLabel,
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
