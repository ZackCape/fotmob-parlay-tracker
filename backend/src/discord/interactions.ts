import {
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder,
  ButtonStyle, StringSelectMenuOptionBuilder,
} from 'discord.js';
import { DataProviderFactory } from '../providers/provider-factory.js';
import { isVerifiedFixture } from '../utils/fixtureValidation.js';
import { MarketPrediction, MarketType } from '../types/football.js';
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
export * from './liveEvents.js';
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
 * /fixtures : full schedule with multi-market GUI, league selection
 * and per-match live tracking
 * ------------------------------------------------------------------ */

/**
 * Markets shown for every fixture in the /fixtures GUI.
 * OVER_0_5 is deliberately excluded (near-certain on almost every match).
 */
const FIXTURE_MARKETS: Array<{
  market: MarketType;
  label: string;
  emoji: string;
}> = [
  { market: 'HOME_WIN', label: 'H', emoji: '🏠' },
  { market: 'DRAW', label: 'D', emoji: '🤝' },
  { market: 'AWAY_WIN', label: 'A', emoji: '✈️' },
  { market: 'OVER_1_5', label: 'O1.5', emoji: '⚽' },
  { market: 'OVER_2_5', label: 'O2.5', emoji: '⚽' },
  { market: 'OVER_8_5_CORNERS', label: 'Corners', emoji: '🟨' },
  { market: 'OVER_3_5_CARDS', label: 'Cards', emoji: '🟥' },
];

const FIXTURES_PER_PAGE = 10;

/** Per-user fixtures browser state. */
export interface FixturesBrowserState {
  league: string;
  page: number;
}

const fixturesState = new Map<string, FixturesBrowserState>();

export function getFixturesState(userId: string): FixturesBrowserState {
  let s = fixturesState.get(userId);
  if (!s) {
    s = { league: 'ALL', page: 1 };
    fixturesState.set(userId, s);
  }
  return s;
}

export function setFixturesLeague(userId: string, league: string): void {
  const s = getFixturesState(userId);
  s.league = league;
  s.page = 1;
}

export function setFixturesPage(userId: string, page: number): void {
  getFixturesState(userId).page = page;
}

export function clearFixturesState(userId: string): void {
  fixturesState.delete(userId);
}

/** Format the multi-market probability line for a single fixture row. */
export function formatFixtureMarkets(
  preds: MarketPrediction[] | null | undefined,
): string {
  const list = (preds || []).filter((p): p is MarketPrediction => !!p);
  const parts = FIXTURE_MARKETS.map(({ market, label, emoji }) => {
    const p = list.find((x) => x.market === market);
    return p ? `${emoji}${label} ${(p.estimatedProbability * 100).toFixed(0)}%` : '';
  }).filter(Boolean);
  return parts.length ? parts.join(' • ') : 'markets N/A';
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

/** Rich embed listing fixtures with multi-market model picks. */
export function buildFixturesEmbed(
  fixturesPage: any[],
  predictionsByFixture: Map<string, MarketPrediction[]>,
  league: string,
  page: number,
  totalPages: number,
): EmbedBuilder {
  const e = baseEmbed('Cape Predictor — Today\'s Full Match Schedule');

  if (!fixturesPage.length) {
    e.setDescription(
      '**Football Intelligence • High Probability & Market Analytics** • ' +
      'No verified fixtures are available for this league today. ' +
      'Providers may be rate-limited or the league may be out of season.',
    );
    e.setFooter({ text: `Cape Predictor Engine • Dixon-Coles & Multi-Market Analytics • ${page}/${totalPages}` });
    return e;
  }

  const lines = fixturesPage.map((f, i) => {
    const globalIndex = (page - 1) * FIXTURES_PER_PAGE + i + 1;
    const preds = predictionsByFixture.get(f.id) || [];
    const markets = formatFixtureMarkets(preds);
    const score = f.status === 'FINISHED' ? ` **${f.homeScore}-${f.awayScore}**` : '';
    const elapsed = f.status === 'LIVE' ? ` • ${f.status}` : '';
    return `\`${String(globalIndex).padStart(2, '0')}\` ${statusEmoji(f.status)} **${f.homeTeam.name}** vs **${f.awayTeam.name}**${score}\n     ${f.league} • ${formatKickoff(f.kickoffTime)}${elapsed} • ${markets}`;
  });

  const header = `**Football Intelligence • High Probability & Market Analytics** • ${fixturesPage.length} match${fixturesPage.length === 1 ? '' : 'es'} (page ${page}/${totalPages})`;
  e.setDescription([header, '', lines.join('\n')].join('\n'));
  e.setFooter({ text: `Cape Predictor Engine • Dixon-Coles & Multi-Market Analytics • ${page}/${totalPages}` });
  return e;
}

/** League filter select menu shown on the /fixtures league prompt and fixtures view. */
export function buildFixtureLeagueSelectRow(current = 'ALL'): ActionRowBuilder<StringSelectMenuBuilder> {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('cp:fixtures:league')
    .setPlaceholder(`League: ${leagueLabel(current)}`)
    .addOptions(
      LEAGUE_OPTIONS.map((l) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(l.label)
          .setValue(l.id)
          .setDescription(l.description)
          .setDefault(l.id === current)),
    );
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

/** Track button for a single match row. */
function buildTrackButton(fixtureId: string, label: string): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(`cp:fixtures:track:${fixtureId}`)
    .setLabel(label)
    .setEmoji('⚡')
    .setStyle(ButtonStyle.Secondary);
}

/** Action rows: one track button per match row on the page (max 5 per row). */
export function buildFixtureTrackRows(fixturesPage: any[]): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  const chunk = 5;
  for (let i = 0; i < fixturesPage.length; i += chunk) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const f of fixturesPage.slice(i, i + chunk)) {
      const label = `${f.homeTeam.name.slice(0, 12)} v ${f.awayTeam.name.slice(0, 12)}`.slice(0, 80);
      row.addComponents(buildTrackButton(f.id, label));
    }
    rows.push(row);
  }
  return rows;
}

/** Pagination buttons. */
export function buildFixturePaginationRow(page: number, totalPages: number): ActionRowBuilder<ButtonBuilder>[] {
  if (totalPages <= 1) return [];
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('cp:fixtures:prev')
        .setLabel('◀️ Prev')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 1),
      new ButtonBuilder()
        .setCustomId('cp:fixtures:next')
        .setLabel('Next ▶️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages),
    ),
  ];
}

/** Full /fixtures payload: embed + league select + track buttons + pagination. */
export function buildFixturesPayload(
  fixtures: any[],
  predictionsByFixture: Map<string, MarketPrediction[]>,
  league: string,
  page: number,
) {
  const totalPages = Math.max(1, Math.ceil(fixtures.length / FIXTURES_PER_PAGE));
  const clampedPage = Math.min(Math.max(1, page), totalPages);
  const start = (clampedPage - 1) * FIXTURES_PER_PAGE;
  const fixturesPage = fixtures.slice(start, start + FIXTURES_PER_PAGE);

  const components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [
    buildFixtureLeagueSelectRow(league),
    ...buildFixtureTrackRows(fixturesPage),
    ...buildFixturePaginationRow(clampedPage, totalPages),
  ];

  return {
    embeds: [buildFixturesEmbed(fixturesPage, predictionsByFixture, league, clampedPage, totalPages)],
    components,
  };
}

/** Standalone "pick a league" entry point (used by the /fixtures command + help nav). */
export function leaguePickerEmbed(): EmbedBuilder {
  return baseEmbed('Cape Predictor — Select League or Competition',
    `*${BRAND.tagline}*\nChoose a competition below to see today's verified fixtures with multi-market model picks.`);
}

/** Keep the legacy league-select row name working for the help nav. */
export function buildLeagueSelectRow(): ActionRowBuilder<StringSelectMenuBuilder> {
  return buildFixtureLeagueSelectRow('ALL');
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