import { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuOptionBuilder, } from 'discord.js';
import { isVerifiedFixture } from '../utils/fixtureValidation.js';
import { BRAND } from './brand.js';
import { LEAGUE_OPTIONS, leagueLabel } from './leagues.js';
/* ------------------------------------------------------------------ *
 * Cape Predictor Discord surface
 *
 * This module owns the fixtures browser and the help directory. Match analysis,
 * the parlay builder and the live tracker live in their own modules and are
 * re-exported here so the bot can consume a single namespace.
 * ------------------------------------------------------------------ */
export { BRAND } from './brand.js';
export { LEAGUE_OPTIONS, leagueLabel } from './leagues.js';
export { buildAnalysisEmbed, buildAnalysisPayload, buildAnalysisTabRow, buildAnalysisActionRow, buildStatsTab, buildProbabilitiesTab, buildScoreMatrixTab, buildLineupsTab, ANALYSIS_TABS, } from './analysisEmbeds.js';
export * from './parlayBuilder.js';
export * from './savedParlays.js';
export * from './liveTracker.js';
export * from './liveEvents.js';
export { isUpcomingFixture, filterUpcomingFixtures, isPreKickoffFixture, filterPreKickoffFixtures, isActiveLiveFixture, liveClockLabel } from './fixtureStatus.js';
export { buildStatisticalParlay } from '../parlays/parlay-builder.js';
export function baseEmbed(title, description) {
    const e = new EmbedBuilder()
        .setColor(BRAND.accent)
        .setAuthor({ name: BRAND.author })
        .setTitle(title)
        .setFooter({ text: BRAND.footer })
        .setTimestamp(new Date());
    if (description)
        e.setDescription(description);
    return e;
}
/* ------------------------------------------------------------------ *
 * Interaction acknowledgement
 *
 * Discord gives a component interaction three seconds to acknowledge before it
 * renders "This interaction failed" to the user. Every button and select handler
 * in the bot does at least one provider call (a fixture sweep, a match analysis,
 * an odds lookup) before it can produce a payload, and any of those can take
 * longer than three seconds on a cold cache. Acknowledging first and editing
 * afterwards makes the click instant regardless of provider latency.
 * ------------------------------------------------------------------ */
/**
 * Acknowledge a button/select interaction immediately, before any provider work.
 *
 * `ephemeral` selects the acknowledgement that matches what the handler will
 * send:
 *   - `false` (default) — `deferUpdate()`, then edit the component's own message
 *     with `editReply()`. For panels, tabs and in-place menus.
 *   - `true` — `deferReply({ ephemeral: true })`, then answer with
 *     `editReply(...)`. For handlers that post a private reply.
 *
 * Already-acknowledged interactions return untouched: a second acknowledgement
 * is rejected by Discord and would replace the real error with a silent failure.
 */
export async function ackInteraction(interaction, options = {}) {
    if (!interaction || interaction.deferred || interaction.replied)
        return;
    try {
        if (options.ephemeral) {
            await interaction.deferReply({ ephemeral: true });
        }
        else {
            await interaction.deferUpdate();
        }
    }
    catch { /* already acknowledged, or the token expired before we got here */ }
}
/**
 * Send the payload for an acknowledged interaction by editing the message it
 * points at, falling back to an ephemeral follow-up when that message can no
 * longer be edited (deleted, or the interaction token has moved on).
 */
export async function editOrFollowUp(interaction, payload) {
    if (!interaction)
        return;
    try {
        await interaction.editReply(payload);
    }
    catch {
        await interaction.followUp({ ...payload, ephemeral: true }).catch(() => { });
    }
}
/* ------------------------------------------------------------------ *
 * /fixtures : full schedule with multi-market GUI, league selection
 * and per-match live tracking
 *
 * Match rows use a clean, emoji-free 3-line card format:
 *
 *   **01. AFC Bournemouth vs Sunderland** `EPL • 3:00 PM`
 *   > **Win Odds:** `Home 46%` | `Draw 25%` | `Away 29%`
 *   > **Goals:** `Over 1.5 Goals (82%)` | `Over 2.5 Goals (58%)`
 *   > **Stats:** `Over 8.5 Corners (71%)` | `Over 3.5 Cards (58%)`
 * ------------------------------------------------------------------ */
/**
 * Markets shown for every fixture in the /fixtures GUI.
 * OVER_0_5 is deliberately excluded (near-certain on almost every match).
 * Labels are explicit (Home / Draw / Away / Over X Goals) rather than
 * shorthand (H / D / A) so users never have to guess.
 */
const FIXTURE_MARKETS = [
    { market: 'HOME_WIN', label: 'Home', format: (p) => `${Math.round(p * 100)}%` },
    { market: 'DRAW', label: 'Draw', format: (p) => `${Math.round(p * 100)}%` },
    { market: 'AWAY_WIN', label: 'Away', format: (p) => `${Math.round(p * 100)}%` },
    { market: 'OVER_1_5', label: 'Over 1.5 Goals', format: (p) => `${Math.round(p * 100)}%` },
    { market: 'OVER_2_5', label: 'Over 2.5 Goals', format: (p) => `${Math.round(p * 100)}%` },
    { market: 'OVER_8_5_CORNERS', label: 'Over 8.5 Corners', format: (p) => `${Math.round(p * 100)}%` },
    { market: 'OVER_3_5_CARDS', label: 'Over 3.5 Cards', format: (p) => `${Math.round(p * 100)}%` },
];
const FIXTURES_PER_PAGE = 10;
const fixturesState = new Map();
export function getFixturesState(userId) {
    let s = fixturesState.get(userId);
    if (!s) {
        s = { league: 'ALL', page: 1 };
        fixturesState.set(userId, s);
    }
    return s;
}
export function setFixturesLeague(userId, league) {
    const s = getFixturesState(userId);
    s.league = league;
    s.page = 1;
}
export function setFixturesPage(userId, page) {
    getFixturesState(userId).page = page;
}
export function clearFixturesState(userId) {
    fixturesState.delete(userId);
}
const bt = (s) => `\`${s}\``;
export function formatFixtureMarkets(preds) {
    const list = (preds || []).filter((p) => !!p);
    const find = (market) => list.find((x) => x.market === market);
    const getPct = (market) => {
        const pred = find(market);
        return pred ? pred.estimatedProbability : null;
    };
    const home = getPct('HOME_WIN');
    const draw = getPct('DRAW');
    const away = getPct('AWAY_WIN');
    const o15 = getPct('OVER_1_5');
    const o25 = getPct('OVER_2_5');
    const corners = getPct('OVER_8_5_CORNERS');
    const cards = getPct('OVER_3_5_CARDS');
    // Explicit label + probability + implied fair odds, e.g. `Home 46% (2.17x)`.
    const withOdds = (label, p) => bt(`${label} ${(p * 100).toFixed(0)}% (${(1 / p).toFixed(2)}x)`);
    return {
        winOdds: [
            home !== null ? withOdds('Home', home) : null,
            draw !== null ? withOdds('Draw', draw) : null,
            away !== null ? withOdds('Away', away) : null,
        ].filter(Boolean).join(' | ') || '`N/A`',
        goals: [
            o15 !== null ? bt(`Over 1.5 Goals (${(o15 * 100).toFixed(0)}%)`) : null,
            o25 !== null ? bt(`Over 2.5 Goals (${(o25 * 100).toFixed(0)}%)`) : null,
        ].filter(Boolean).join(' | ') || '`N/A`',
        stats: [
            corners !== null ? bt(`Over 8.5 Corners (${(corners * 100).toFixed(0)}%)`) : null,
            cards !== null ? bt(`Over 3.5 Cards (${(cards * 100).toFixed(0)}%)`) : null,
        ].filter(Boolean).join(' | ') || '`N/A`',
    };
}
/** Fetch verified fixtures for a league. Never returns unverified rows. */
export async function fetchVerifiedFixtures(factory, date, league) {
    const all = await factory.getFixturesByDate(date, league === 'ALL' ? 'ALL' : league);
    return all.filter(isVerifiedFixture);
}
/** Format a kickoff ISO string as 12-hour time (e.g. "3:00 PM"). */
function formatKickoff(iso) {
    if (!iso)
        return 'TBC';
    const d = new Date(iso);
    if (isNaN(d.getTime()))
        return 'TBC';
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}
/** Rich embed listing fixtures with multi-market model picks. */
export function buildFixturesEmbed(fixturesPage, predictionsByFixture, league, page, totalPages) {
    const e = baseEmbed('Cape Predictor — Today\'s Full Match Schedule');
    if (!fixturesPage.length) {
        e.setDescription('**Football Intelligence • High Probability & Market Analytics** • ' +
            'No verified fixtures are available for this league today. ' +
            'Providers may be rate-limited or the league may be out of season.');
        e.setFooter({ text: BRAND.footer });
        return e;
    }
    const lines = fixturesPage.map((f, i) => {
        const globalIndex = (page - 1) * FIXTURES_PER_PAGE + i + 1;
        const preds = predictionsByFixture.get(f.id) || [];
        const markets = formatFixtureMarkets(preds);
        const score = f.status === 'FINISHED' ? ` **${f.homeScore}-${f.awayScore}**` : '';
        const live = f.status === 'LIVE' ? ' • LIVE' : '';
        const kickoff = formatKickoff(f.kickoffTime);
        return [
            `\`${String(globalIndex).padStart(2, '0')}\` **${f.homeTeam.name} vs ${f.awayTeam.name}**${score} \`${f.league} • ${kickoff}${live}\``,
            `> **Win Odds:** ${markets.winOdds}`,
            `> **Goals:** ${markets.goals}`,
            `> **Stats:** ${markets.stats}`,
        ].join('\n');
    });
    const header = `**Football Intelligence • High Probability & Market Analytics** • ${fixturesPage.length} match${fixturesPage.length === 1 ? '' : 'es'} (page ${page}/${totalPages})`;
    e.setDescription([header, '', lines.join('\n\n')].join('\n'));
    e.setFooter({ text: BRAND.footer });
    return e;
}
/** League filter select menu shown on the /fixtures league prompt and fixtures view. */
export function buildFixtureLeagueSelectRow(current = 'ALL') {
    const menu = new StringSelectMenuBuilder()
        .setCustomId('cp:fixtures:league')
        .setPlaceholder(`League: ${leagueLabel(current)}`)
        .addOptions(LEAGUE_OPTIONS.map((l) => new StringSelectMenuOptionBuilder()
        .setLabel(l.label)
        .setValue(l.id)
        .setDescription(l.description)
        .setDefault(l.id === current)));
    return new ActionRowBuilder().addComponents(menu);
}
/** Track button for a single match row. */
function buildTrackButton(fixtureId, label) {
    return new ButtonBuilder()
        .setCustomId(`cp:fixtures:track:${fixtureId}`)
        .setLabel(label)
        .setEmoji('⚡')
        .setStyle(ButtonStyle.Secondary);
}
/** Action rows: one track button per match row on the page (max 5 per row). */
export function buildFixtureTrackRows(fixturesPage) {
    const rows = [];
    const chunk = 5;
    for (let i = 0; i < fixturesPage.length; i += chunk) {
        const row = new ActionRowBuilder();
        for (const f of fixturesPage.slice(i, i + chunk)) {
            const label = `Track ${f.homeTeam.name.slice(0, 8)} v ${f.awayTeam.name.slice(0, 8)}`.slice(0, 80);
            row.addComponents(buildTrackButton(f.id, label));
        }
        rows.push(row);
    }
    return rows;
}
/** Pagination buttons: Previous | Page X / Y | Next. */
export function buildFixturePaginationRow(page, totalPages) {
    if (totalPages <= 1)
        return [];
    return [
        new ActionRowBuilder().addComponents(new ButtonBuilder()
            .setCustomId('cp:fixtures:prev')
            .setLabel('◀️ Previous Page')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page <= 1), new ButtonBuilder()
            .setCustomId('cp:fixtures:page')
            .setLabel(`Page ${page} / ${totalPages}`)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true), new ButtonBuilder()
            .setCustomId('cp:fixtures:next')
            .setLabel('Next Page ▶️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page >= totalPages)),
    ];
}
/** Full /fixtures payload: embed + league select + track buttons + pagination. */
export function buildFixturesPayload(fixtures, predictionsByFixture, league, page) {
    const totalPages = Math.max(1, Math.ceil(fixtures.length / FIXTURES_PER_PAGE));
    const clampedPage = Math.min(Math.max(1, page), totalPages);
    const start = (clampedPage - 1) * FIXTURES_PER_PAGE;
    const fixturesPage = fixtures.slice(start, start + FIXTURES_PER_PAGE);
    const components = [
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
export function leaguePickerEmbed() {
    return baseEmbed('Cape Predictor — Select League', `*${BRAND.tagline}*\nChoose a competition below to see today's verified fixtures with multi-market model picks.`);
}
/** Keep the legacy league-select row name working for the help nav. */
export function buildLeagueSelectRow() {
    return buildFixtureLeagueSelectRow('ALL');
}
/* ------------------------------------------------------------------ *
 * /help : navigation buttons
 * ------------------------------------------------------------------ */
export const HELP_BUTTONS = [
    { id: 'cp:nav:fixtures', label: 'Fixtures', emoji: '⚽' },
    { id: 'cp:nav:parlay', label: 'Custom Parlay', emoji: '🎟️' },
    { id: 'cp:nav:live', label: 'Live Tracking', emoji: '📡' },
    { id: 'cp:dashboard', label: 'Web App', emoji: '🚀' },
];
export function buildHelpRow() {
    return new ActionRowBuilder().addComponents(HELP_BUTTONS.map((h) => new ButtonBuilder().setCustomId(h.id).setLabel(h.label).setEmoji(h.emoji).setStyle(ButtonStyle.Secondary)));
}
/** DM-alerts toggle for a user who is tracking a match. */
export function buildDmAlertsRow(userId, enabled = false) {
    return new ActionRowBuilder().addComponents(new ButtonBuilder()
        .setCustomId(`cp:dm:alerts:${userId}`)
        .setLabel(enabled ? 'DM Alerts On' : 'DM Alerts Off')
        .setEmoji('📩')
        .setStyle(enabled ? ButtonStyle.Success : ButtonStyle.Secondary));
}
export function buildHelpEmbed() {
    const e = baseEmbed('Cape Predictor • Command Directory', `*${BRAND.tagline}*\nStatistical football intelligence powered by a Dixon-Coles probability engine and real verified fixture data.`);
    e.addFields({ name: '⚽ Fixtures', value: '`/fixtures` — pick a league, see kickoff times and H/D/A model probabilities.', inline: false }, { name: '📊 Match Analysis', value: '`/analysis` or press **📊 Analyze** — tabbed stats, model probabilities, score matrix and lineups.', inline: false }, { name: '🎟️ Custom Parlay', value: '`/customparlay` — pick your own matches and markets, save the slip and get live leg-hit updates.', inline: false }, { name: '⚡ Auto Parlay', value: '`/generateparlay` — automated statistical parlay: choose legs (5/10/15/20/25), min probability, league and mode.', inline: false }, { name: '📡 Live Tracking', value: '`/livetracking` — select a match and get an auto-refreshing embed.', inline: false }, { name: '🚀 Web App', value: '`/dashboard` — launch the full React dashboard, optionally embedded in Discord.', inline: false }, { name: '⚙️ Settings', value: '`/interval` set broadcast cadence • `/channel` link a channel.', inline: false });
    return e;
}
/** Community match prediction poll embed for /poll. */
export function buildPollEmbed(matchId) {
    const e = new EmbedBuilder()
        .setColor(BRAND.accent)
        .setAuthor({ name: BRAND.author })
        .setTitle('📊 Community Match Prediction')
        .setTimestamp(new Date());
    e.setDescription(`Cast your vote for match **${matchId}**.\n\n` +
        `React with:\n` +
        `🏠 Home Win\n` +
        `🤝 Draw\n` +
        `✈️ Away Win\n\n` +
        `Results tallied after kickoff.`);
    e.setFooter({ text: `${BRAND.footer} • Community predictions, not advice` });
    return e;
}
export function cronForInterval(interval) {
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
export function recalibrateInterval(fixtures, configured) {
    if (fixtures.some((f) => f.status === 'LIVE'))
        return '5m';
    if (fixtures.some((f) => f.status === 'TIMED'))
        return '15m';
    return configured;
}
