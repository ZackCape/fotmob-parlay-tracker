import {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} from 'discord.js';
import { MatchAnalysis, MarketPrediction, Lineup } from '../types/football.js';
import { BRAND } from './brand.js';

/* ------------------------------------------------------------------ *
 * Tabbed match-analysis embeds
 *
 * Mirrors the web dashboard's MatchAnalysisModal: every panel available on
 * the dashboard is reachable in Discord through a button-driven tab bar.
 * ------------------------------------------------------------------ */

export type AnalysisTab = 'stats' | 'probabilities' | 'matrix' | 'lineups';

export const ANALYSIS_TABS: Array<{ id: AnalysisTab; label: string; emoji: string }> = [
  { id: 'stats', label: 'Stats', emoji: '📊' },
  { id: 'probabilities', label: 'Probabilities', emoji: '🎯' },
  { id: 'matrix', label: 'Score Matrix', emoji: '⚽' },
  { id: 'lineups', label: 'Lineups & Form', emoji: '📋' },
];

/** Format a possibly-null provider statistic without ever inventing a zero. */
function stat(value: unknown, digits = 0): string {
  if (value === null || value === undefined || value === '') return 'N/A';
  const n = Number(value);
  if (!Number.isFinite(n)) return 'N/A';
  return digits ? n.toFixed(digits) : String(Math.round(n));
}

function pct(value: unknown, digits = 1): string {
  if (value === null || value === undefined) return 'N/A';
  const n = Number(value);
  if (!Number.isFinite(n)) return 'N/A';
  // Accept either a 0-1 fraction or an already-scaled percentage.
  const scaled = n <= 1 ? n * 100 : n;
  return `${scaled.toFixed(digits)}%`;
}

function fairOdds(probability: unknown): string {
  const n = Number(probability);
  if (!Number.isFinite(n) || n <= 0) return 'N/A';
  return `${(1 / n).toFixed(2)}x`;
}

/** Text progress bar, e.g. 55% -> 11 blocks. */
function bar(ratio: number, width = 10): string {
  const filled = Math.max(0, Math.min(width, Math.round(ratio * width)));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function teamNames(analysis: MatchAnalysis): string {
  return `${analysis.fixture.homeTeam.name} vs ${analysis.fixture.awayTeam.name}`;
}

/* ------------------------------------------------------------------ *
 * Tab 1: Match statistics
 * ------------------------------------------------------------------ */
export function buildStatsTab(analysis: MatchAnalysis): EmbedBuilder {
  const s = analysis.fixture.statistics;
  const home = analysis.fixture.homeTeam.name;
  const away = analysis.fixture.awayTeam.name;

  const e = new EmbedBuilder()
    .setColor(BRAND.accent)
    .setAuthor({ name: BRAND.author })
    .setTitle(`Match Stats • ${home} vs ${away}`)
    .setTimestamp(new Date());

  if (!s) {
    e.setDescription(
      'No match statistics are published for this fixture yet.\n' +
      'Cape Predictor shows N/A rather than estimating — check back once the match is under way.',
    );
    e.setFooter({ text: BRAND.footer });
    return e;
  }

  const possessionHome = s.possessionHome;
  const possessionAway = s.possessionAway;

  if (Number.isFinite(Number(possessionHome)) && possessionHome !== null) {
    const ratio = Math.max(0, Math.min(1, Number(possessionHome) / 100));
    e.setDescription(
      `**Possession**\n` +
      `${bar(ratio)}\n` +
      `\`${home}\` **${stat(possessionHome)}%**   **${stat(possessionAway)}%** \`${away}\``,
    );
  } else {
    e.setDescription(`**Possession** — N/A (not published yet)\n\`${home}\` vs \`${away}\``);
  }

  // A compact side-by-side stat grid. Inline fields render three per row.
  e.addFields(
    {
      name: 'Shots',
      value: `${stat(s.shotsHome)} — ${stat(s.shotsAway)}`,
      inline: true,
    },
    {
      name: 'Shots on Target',
      value: `${stat(s.shotsOnTargetHome)} — ${stat(s.shotsOnTargetAway)}`,
      inline: true,
    },
    {
      name: 'Expected Goals (xG)',
      value: `${stat(s.xgHome, 2)} — ${stat(s.xgAway, 2)}`,
      inline: true,
    },
    {
      name: 'Corners',
      value: `${stat(s.cornersHome)} — ${stat(s.cornersAway)}`,
      inline: true,
    },
    {
      name: 'Fouls',
      value: `${stat(s.foulsHome)} — ${stat(s.foulsAway)}`,
      inline: true,
    },
    {
      name: 'Cards',
      value: `🟨 ${stat(s.yellowCardsHome)} — ${stat(s.yellowCardsAway)}   🟥 ${stat(s.redCardsHome)} — ${stat(s.redCardsAway)}`,
      inline: true,
    },
  );

  e.setFooter({ text: `${BRAND.footer} • ${home} — ${away}` });
  return e;
}

/* ------------------------------------------------------------------ *
 * Tab 2: Model probabilities
 * ------------------------------------------------------------------ */
export function buildProbabilitiesTab(
  analysis: MatchAnalysis,
  marketOdds?: { home: number | null; draw: number | null; away: number | null } | null,
): EmbedBuilder {
  const e = new EmbedBuilder()
    .setColor(BRAND.accent)
    .setAuthor({ name: BRAND.author })
    .setTitle(`Model Probabilities • ${teamNames(analysis)}`)
    .setTimestamp(new Date());

  const preds: MarketPrediction[] = analysis.marketPredictions || [];
  const oneXTwo = (['HOME_WIN', 'DRAW', 'AWAY_WIN'] as const)
    .map((m) => preds.find((p) => p.market === m))
    .filter((p): p is MarketPrediction => !!p);

  if (!oneXTwo.length) {
    e.setDescription('No 1X2 market predictions are available for this fixture.');
    e.setFooter({ text: BRAND.footer });
    return e;
  }

  // Identify the model's most likely outcome; ties are shown explicitly rather
  // than silently picking the first market.
  const maxProb = Math.max(...oneXTwo.map((p) => p.estimatedProbability));
  const leaders = oneXTwo.filter((p) => Math.abs(p.estimatedProbability - maxProb) < 1e-9);

  const lines = oneXTwo.map((p) => {
    const isLeader = leaders.some((l) => l.market === p.market);
    const conf = Number.isFinite(p.confidenceLower) && Number.isFinite(p.confidenceUpper)
      ? `\n     confidence ${pct(p.confidenceLower)}–${pct(p.confidenceUpper)}`
      : '';
    return `${isLeader ? '⭐ ' : '   '}\`${p.selection}\` **${pct(p.estimatedProbability)}**  •  fair **${fairOdds(p.estimatedProbability)}**${conf}`;
  });

  e.setDescription(lines.join('\n'));

  const dc = analysis.dixonColesParameters;
  if (dc) {
    e.addFields({
      name: 'Dixon-Coles model',
      value:
        `Home xG **${stat(dc.homeExpectedGoals, 2)}**  •  Away xG **${stat(dc.awayExpectedGoals, 2)}**\n` +
        `Attack H **${stat(dc.homeAttackStrength, 2)}** / A **${stat(dc.awayAttackStrength, 2)}**\n` +
        `Defence H **${stat(dc.homeDefenseWeakness, 2)}** / A **${stat(dc.awayDefenseWeakness, 2)}**\n` +
        `Home advantage **${stat(dc.homeAdvantage, 2)}**`,
      inline: false,
    });
  }

  // Market value comparison is only rendered when bookmaker odds were actually
  // retrieved - never invented.
  const h = oneXTwo.find((p) => p.market === 'HOME_WIN')?.estimatedProbability ?? null;
  const d = oneXTwo.find((p) => p.market === 'DRAW')?.estimatedProbability ?? null;
  const a = oneXTwo.find((p) => p.market === 'AWAY_WIN')?.estimatedProbability ?? null;

  if (marketOdds && marketOdds.home && marketOdds.draw && marketOdds.away) {
    const overround = (1 / marketOdds.home) + (1 / marketOdds.draw) + (1 / marketOdds.away);
    const rows: Array<[string, number | null, number | null, number | null]> = [
      ['1 (Home)', h, marketOdds.home, 1 / marketOdds.home / overround],
      ['X (Draw)', d, marketOdds.draw, 1 / marketOdds.draw / overround],
      ['2 (Away)', a, marketOdds.away, 1 / marketOdds.away / overround],
    ];
    e.addFields({
      name: 'Value vs market',
      value:
        '`Pick    Model    Market   Edge`\n' +
        rows.map(([label, model, odds, normalized]) => {
          if (model === null || normalized === null) return `${label}   N/A`;
          const edge = (model - normalized) * 100;
          const sign = edge >= 0 ? '+' : '';
          return `${label.padEnd(6)} ${pct(model).padStart(6)}  ${odds!.toFixed(2).padStart(6)}  ${sign}${edge.toFixed(1)}%`;
        }).join('\n') +
        `\nOverround **${pct(overround)}**`,
      inline: false,
    });
  } else {
    e.addFields({
      name: 'Value vs market',
      value: 'Bookmaker odds unavailable for this fixture — edge not computed rather than estimated.',
      inline: false,
    });
  }

  e.setFooter({ text: `${BRAND.footer} • Model estimates, not a guarantee` });
  return e;
}

/* ------------------------------------------------------------------ *
 * Tab 3: Score matrix (top exact scores)
 * ------------------------------------------------------------------ */
export function buildScoreMatrixTab(analysis: MatchAnalysis, topN = 5): EmbedBuilder {
  const matrix = analysis.scoreMatrix || [];
  const e = new EmbedBuilder()
    .setColor(BRAND.accent)
    .setAuthor({ name: BRAND.author })
    .setTitle(`Score Matrix • ${teamNames(analysis)}`)
    .setTimestamp(new Date());

  const scored = matrix
    .filter((r) => Number.isFinite(r.probability) && r.probability > 0)
    .sort((a, b) => b.probability - a.probability);

  if (!scored.length) {
    e.setDescription('No score matrix is available for this fixture.');
    e.setFooter({ text: BRAND.footer });
    return e;
  }

  const top = scored.slice(0, topN);
  const lines = top.map((r, i) =>
    `\`${i + 1}\` **${r.homeScore}-${r.awayScore}**  ${pct(r.probability, 2)}  ${fairOdds(r.probability)}`,
  );
  const covered = top.reduce((sum, r) => sum + r.probability, 0);

  e.setDescription(lines.join('\n'));
  e.addFields({
    name: 'Coverage',
    value:
      `Top ${top.length} scorelines cover **${pct(covered, 1)}** of the modelled distribution.\n` +
      `Expected goals: **${stat(analysis.dixonColesParameters?.homeExpectedGoals, 2)}** — **${stat(analysis.dixonColesParameters?.awayExpectedGoals, 2)}**`,
    inline: false,
  });
  e.setFooter({ text: BRAND.footer });
  return e;
}

/* ------------------------------------------------------------------ *
 * Tab 4: Lineups & form
 * ------------------------------------------------------------------ */
function lineupBlock(lineup: Lineup | null | undefined, label: string): string {
  if (!lineup || !lineup.startingXI || lineup.startingXI.length === 0) {
    return `**${label}**\nStarting XI not published.`;
  }
  const xi = lineup.startingXI
    .map((p) => `\`${p.number || '-'}\` ${p.name}${p.position ? ` (${p.position})` : ''}`)
    .join('\n');
  const subs = lineup.substitutes && lineup.substitutes.length
    ? `\n*Subs:* ${lineup.substitutes.map((p) => p.name).join(', ').slice(0, 400)}`
    : '';
  const coach = lineup.coach ? `\n*Coach:* ${lineup.coach}` : '';
  return `**${label}**${lineup.formation ? ` _(${lineup.formation})_` : ''}\n${xi}${subs}${coach}`;
}

function formBlock(results: Array<'W' | 'D' | 'L'> | null | undefined): string {
  if (!results || results.length === 0) return 'No recent results published.';
  const glyphs = results.map((r) => (r === 'W' ? '🟢' : r === 'D' ? '🟡' : '🔴'));
  const wins = results.filter((r) => r === 'W').length;
  const draws = results.filter((r) => r === 'D').length;
  const losses = results.filter((r) => r === 'L').length;
  return `${glyphs.join('')}  ${wins}W ${draws}D ${losses}L`;
}

export function buildLineupsTab(analysis: MatchAnalysis): EmbedBuilder {
  const e = new EmbedBuilder()
    .setColor(BRAND.accent)
    .setAuthor({ name: BRAND.author })
    .setTitle(`Lineups & Form • ${teamNames(analysis)}`)
    .setTimestamp(new Date());

  e.addFields(
    {
      name: `${analysis.fixture.homeTeam.name} • Form`,
      value: formBlock(analysis.homeForm?.last5Results),
      inline: true,
    },
    {
      name: `${analysis.fixture.awayTeam.name} • Form`,
      value: formBlock(analysis.awayForm?.last5Results),
      inline: true,
    },
  );

  e.addFields({
    name: 'Starting XI',
    value:
      `${lineupBlock(analysis.lineups?.home, analysis.fixture.homeTeam.name)}\n\n` +
      `${lineupBlock(analysis.lineups?.away, analysis.fixture.awayTeam.name)}`,
    inline: false,
  });

  if (analysis.injuries && analysis.injuries.length) {
    e.addFields({
      name: 'Injuries',
      value: analysis.injuries
        .slice(0, 10)
        .map((i) => `${i.player} — ${i.status}${i.reason ? ` (${i.reason})` : ''}`)
        .join('\n')
        .slice(0, 1024),
      inline: false,
    });
  }

  e.setFooter({ text: BRAND.footer });
  return e;
}

/* ------------------------------------------------------------------ *
 * Tab dispatcher + tab bar
 * ------------------------------------------------------------------ */
export function buildAnalysisEmbed(
  analysis: MatchAnalysis,
  tab: AnalysisTab = 'stats',
  marketOdds?: { home: number | null; draw: number | null; away: number | null } | null,
): EmbedBuilder {
  switch (tab) {
    case 'probabilities': return buildProbabilitiesTab(analysis, marketOdds);
    case 'matrix': return buildScoreMatrixTab(analysis);
    case 'lineups': return buildLineupsTab(analysis);
    case 'stats':
    default: return buildStatsTab(analysis);
  }
}

/**
 * Tab bar. The active tab is rendered as `Primary` and disabled so a user
 * cannot "re-render" the panel they are already looking at.
 */
export function buildAnalysisTabRow(fixtureId: string, active: AnalysisTab): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    ANALYSIS_TABS.map((t) =>
      new ButtonBuilder()
        .setCustomId(`cp:tab:${fixtureId}:${t.id}`)
        .setLabel(t.label)
        .setEmoji(t.emoji)
        .setStyle(t.id === active ? ButtonStyle.Primary : ButtonStyle.Secondary)
        .setDisabled(t.id === active),
    ),
  );
}

/** Secondary actions beneath the tab bar. */
export function buildAnalysisActionRow(
  fixtureId: string,
  options: { tracked?: boolean } = {},
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`cp:track:${fixtureId}`)
      .setLabel(options.tracked ? 'Tracking' : 'Track Live')
      .setEmoji('⚡')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!!options.tracked),
    new ButtonBuilder()
      .setLabel('Web Dashboard')
      .setEmoji('🚀')
      .setStyle(ButtonStyle.Link)
      .setURL(process.env.PUBLIC_URL || 'https://football-analytics-bot-0zwd.onrender.com'),
  );
}

/** Full payload for an analysis panel: embed + tab bar + actions. */
export function buildAnalysisPayload(
  analysis: MatchAnalysis,
  tab: AnalysisTab = 'stats',
  options: { marketOdds?: { home: number | null; draw: number | null; away: number | null } | null; tracked?: boolean } = {},
) {
  return {
    embeds: [buildAnalysisEmbed(analysis, tab, options.marketOdds)],
    components: [
      buildAnalysisTabRow(analysis.fixture.id, tab),
      buildAnalysisActionRow(analysis.fixture.id, { tracked: options.tracked }),
    ],
  };
}