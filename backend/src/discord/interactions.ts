import {
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder,
  ButtonStyle, StringSelectMenuOptionBuilder,
} from 'discord.js';
import { DataProviderFactory } from '../providers/provider-factory.js';
import { isVerifiedFixture } from '../utils/fixtureValidation.js';
import { MarketPrediction } from '../types/football.js';
import { BRAND } from './brand.js';
import { LEAGUE_OPTIONS, LeagueOption, leagueLabel } from './leagues.js';

/* ------------------------------------------------------------------ *
 * Cape Predictor Discord surface
 *
 * This module owns the fixtures browser and the help directory. Match analysis,
 * the parlay builder and the live tracker live in their own modules and are
 * re-exported here so the bot can consume a single namespace.
 * ------------------------------------------------------------------ */

export { BRAND } from './brand.js';
export { LEAGUE_OPTIONS, leagueLabel } from './leagues.js';
export type { LeagueOption } from './leagues.js';
export {
  buildAnalysisEmbed, buildAnalysisPayload, buildAnalysisTabRow, buildAnalysisActionRow,
  buildStatsTab, buildProbabilitiesTab, buildScoreMatrixTab, buildLineupsTab,
  ANALYSIS_TABS,
} from './analysisEmbeds.js';
export type { AnalysisTab } from './analysisEmbeds.js';
export * from './parlayBuilder.js';
export * from './liveTracker.js';
export { buildStatisticalParlay } from '../parlays/parlay-builder.js';

export function baseEmbed(title: string, description?: string): EmbedBuilder {
  const e = new EmbedBuilder()
    .setColor(BRAND.accent)
    .setAuthor({ name: BRAND.author })
    .setTitle(title)
    .setFooter({ text: BRAND.footer })
    .setTimestamp(new Date());
  if (description) e.setDescription(description);
  return e;
}

/* ------------------------------------------------------------------ *
 * /fixtures : league selector
 * ------------------------------------------------------------------ */
export function buildLeagueSelectRow(): ActionRowBuilder<StringSelectMenuBuilder> {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('cp:fixtures:league')
    .setPlaceholder('Select a league…')
    .addOptions(
      LEAGUE_OPTIONS.map((l) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(l.label)
          .setValue(l.id)
          .setDescription(l.description)),
    );
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

export function leaguePickerEmbed(): EmbedBuilder {
  return baseEmbed('Fixtures • Select a League',
    `*${BRAND.tagline}*\nChoose a competition below to see today's verified fixtures with model win / draw / away probabilities.`);
}

/** Fetch verified fixtures for a league. Never returns unverified rows. */
export async function fetchVerifiedFixtures(factory: DataProviderFactory, date: string, league: string) {
  const all = await factory.getFixturesByDate(date, league === 'ALL' ? 'ALL' : league);
  return all.filter(isVerifiedFixture);
}

export function statusEmoji(status: string): string {
  if (status === 'LIVE') return '\u{1F534}';
  if (status === 'FINISHED') return '\u26BD';
  if (status === 'POSTPONED') return '\u23F8';
  return '\u23F3';
}

function formatKickoff(iso: string): string {
  if (!iso) return 'TBC';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'TBC';
  return `<t:${Math.floor(d.getTime() / 1000)}:t>`;
}

/** Embed of match cards with model probabilities. */
export function buildFixturesEmbed(
  fixtures: any[],
  predictionsByFixture: Map<string, MarketPrediction[]>,
  league: string,
): EmbedBuilder {
  const label = leagueLabel(league);
  const e = baseEmbed(`Fixtures • ${label}`,
    `*${BRAND.tagline}* • ${fixtures.length} verified match${fixtures.length === 1 ? '' : 'es'}`);

  if (!fixtures.length) {
    e.setDescription('No verified fixtures are available for this league today. Providers may be rate-limited or the league may be out of season.');
    return e;
  }

  const lines = fixtures.slice(0, 12).map((f, i) => {
    const preds = predictionsByFixture.get(f.id) || [];
    const probs = (['HOME_WIN', 'DRAW', 'AWAY_WIN'] as const)
      .map((m) => preds.find((p) => p.market === m))
      .filter((p): p is MarketPrediction => !!p)
      .map((p) => `${(p.estimatedProbability * 100).toFixed(0)}%`)
      .join(' / ');
    const score = f.status === 'FINISHED' ? ` **${f.homeScore}-${f.awayScore}**` : '';
    return `\`${String(i + 1).padStart(2, '0')}\` ${statusEmoji(f.status)} **${f.homeTeam.name}** vs **${f.awayTeam.name}**${score}\n     ${f.league} • ${formatKickoff(f.kickoffTime)}${probs ? ` • H/D/A ${probs}` : ''}`;
  });

  e.setDescription(lines.join('\n'));
  e.setFooter({ text: `${BRAND.footer} • H/D/A = model estimate` });
  return e;
}

/**
 * One Analyse / Track button pair per visible fixture, so users can jump
 * straight into analysis for any match rather than only the first.
 */
export function buildFixtureActionRows(fixtures: any[]): ActionRowBuilder<ButtonBuilder>[] {
  const visible = fixtures.slice(0, 5);
  if (!visible.length) return [];
  return visible.map((f) =>
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`cp:analyze:${f.id}`)
        .setLabel(`Analyze ${f.homeTeam.name} v ${f.awayTeam.name}`.slice(0, 80))
        .setEmoji('📊')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`cp:track:${f.id}`)
        .setLabel('Track Live')
        .setEmoji('⚡')
        .setStyle(ButtonStyle.Secondary),
    ));
}

/* ------------------------------------------------------------------ *
 * /help : navigation buttons
 * ------------------------------------------------------------------ */
export const HELP_BUTTONS: Array<{ id: string; label: string; emoji: string }> = [
  { id: 'cp:nav:fixtures', label: 'Fixtures', emoji: '⚽' },
  { id: 'cp:nav:parlay', label: 'Custom Parlay', emoji: '🎟️' },
  { id: 'cp:nav:live', label: 'Live Tracking', emoji: '📡' },
  { id: 'cp:dashboard', label: 'Web App', emoji: '🚀' },
];

export function buildHelpRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    HELP_BUTTONS.map((h) =>
      new ButtonBuilder().setCustomId(h.id).setLabel(h.label).setEmoji(h.emoji).setStyle(ButtonStyle.Secondary)),
  );
}

export function buildHelpEmbed(): EmbedBuilder {
  const e = baseEmbed('Cape Predictor • Command Directory',
    `*${BRAND.tagline}*\nStatistical football intelligence powered by a Dixon-Coles probability engine and real verified fixture data.`);
  e.addFields(
    { name: '⚽ Fixtures', value: '`/fixtures` — pick a league, see kickoff times and H/D/A model probabilities.', inline: false },
    { name: '📊 Match Analysis', value: '`/analysis` or press **📊 Analyze** — tabbed stats, model probabilities, score matrix and lineups.', inline: false },
    { name: '🎟️ Custom Parlay', value: '`/customparlay` — pick your own matches and markets, save the slip.', inline: false },
    { name: '📡 Live Tracking', value: '`/livetracking` — select a match and get an auto-refreshing embed.', inline: false },
    { name: '🚀 Web App', value: '`/dashboard` — launch the full React dashboard, optionally embedded in Discord.', inline: false },
    { name: '⚙️ Settings', value: '`/interval` set broadcast cadence • `/channel` link a channel.', inline: false },
  );
  return e;
}

/* ------------------------------------------------------------------ *
 * Interval recalibration
 * ------------------------------------------------------------------ */
export type Interval = '5m' | '15m' | '30m' | '45m' | '1h';

export function cronForInterval(interval: Interval): string {
  switch (interval) {
    case '5m': return '*/5 * * * *';
    case '15m': return '*/15 * * * *';
    case '30m': return '*/30 * * * *';
    case '45m': return '*/45 * * * *';
    case '1h': return '0 * * * *';
    default: return '0 * * * *';
  }
}

/**
 * Auto-recalibrate the broadcast cadence from live match activity:
 * live matches -> 5m, matches still to start -> 15m, otherwise the configured
 * interval is left alone.
 */
export function recalibrateInterval(fixtures: any[], configured: Interval): Interval {
  if (fixtures.some((f) => f.status === 'LIVE')) return '5m';
  if (fixtures.some((f) => f.status === 'TIMED')) return '15m';
  return configured;
}