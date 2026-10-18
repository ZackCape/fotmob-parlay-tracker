import {
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder,
  ButtonStyle, StringSelectMenuOptionBuilder, ModalBuilder, TextInputBuilder,
  TextInputStyle, ActionRowBuilder as Row,
} from 'discord.js';
import { MarketType } from '../types/football.js';
import { BRAND } from './brand.js';
import { LEAGUE_OPTIONS } from './leagues.js';

/* ------------------------------------------------------------------ *
 * Custom parlay builder
 *
 * Flow: Select League -> Select Match -> Select Market -> Add Leg.
 *
 * State is keyed by *user* id, not channel id, so two people building slips
 * in the same channel never clobber each other's legs.
 * ------------------------------------------------------------------ */

export interface ParlayLeg {
  fixtureId: string;
  description: string;
  league: string;
  market: MarketType;
  selection: string;
  probability: number;
  /** Confidence band from the model, when available. */
  confidenceLower?: number | null;
  confidenceUpper?: number | null;
  /** Real bookmaker decimal price for this selection, when available. */
  marketOdds?: number | null;
}

export interface CustomParlay {
  ownerId: string;
  legs: ParlayLeg[];
  createdAt: number;
  saved: boolean;
  savedAt: number | null;
  /** Units staked, used for payout maths. */
  stake: number;
}

/** Base stake in currency units. Slips default to 1 unit = $10. */
export const BASE_STAKE_USD = 10;
/** Dollar value of one unit. */
export const UNIT_VALUE_USD = 10;
const MAX_RECOMMENDED_UNITS = 10;

const parlayStore = new Map<string, CustomParlay>();

/** Which league the user is currently filtering matches by. */
const parlayLeague = new Map<string, string>();
/** Fixture selected in the match dropdown, pending a market choice. */
const parlayPendingMatch = new Map<string, string>();
/** Market selected in the market dropdown, pending an Add Leg press. */
const parlayPendingMarket = new Map<string, MarketType>();

export const MAX_LEGS = 10;

export function getParlay(ownerId: string): CustomParlay {
  let p = parlayStore.get(ownerId);
  if (!p) {
    p = { ownerId, legs: [], createdAt: Date.now(), saved: false, savedAt: null, stake: BASE_STAKE_USD };
    parlayStore.set(ownerId, p);
  }
  // A slip that has been saved and then edited is a draft again.
  return p;
}

export function setParlayLeague(ownerId: string, league: string): void {
  parlayLeague.set(ownerId, league);
}

export function getParlayLeague(ownerId: string): string {
  return parlayLeague.get(ownerId) || 'ALL';
}

export function setParlayPendingMatch(ownerId: string, fixtureId: string): void {
  parlayPendingMatch.set(ownerId, fixtureId);
}

export function getParlayPendingMatch(ownerId: string): string | undefined {
  return parlayPendingMatch.get(ownerId);
}

export function setParlayPendingMarket(ownerId: string, market: MarketType): void {
  parlayPendingMarket.set(ownerId, market);
}

export function getParlayPendingMarket(ownerId: string): MarketType | undefined {
  return parlayPendingMarket.get(ownerId);
}

/**
 * Set the stake from user input. Rejects non-numeric, zero and negative
 * values so the payout maths can never produce NaN or a negative stake.
 */
export function setParlayStake(parlay: CustomParlay, raw: unknown): { ok: boolean; reason?: string } {
  const stake = Number(raw);
  if (!Number.isFinite(stake) || stake <= 0) {
    return { ok: false, reason: 'Stake must be a positive number.' };
  }
  if (stake > 1_000_000) {
    return { ok: false, reason: 'Stake is unrealistically large.' };
  }
  parlay.stake = Number(stake.toFixed(2));
  return { ok: true };
}

export function clearParlayPending(ownerId: string): void {
  parlayPendingMatch.delete(ownerId);
  parlayPendingMarket.delete(ownerId);
}

/** Human-readable label for a staged or stored market value. */
export function marketLabel(value: string): string {
  return MARKET_OPTIONS.find((m) => m.value === value)?.label ?? value;
}

export function clearParlay(ownerId: string): CustomParlay {
  const existing = getParlay(ownerId);
  const fresh: CustomParlay = {
    ownerId, legs: [], createdAt: Date.now(), saved: false, savedAt: null,
    stake: existing.stake,
  };
  parlayStore.set(ownerId, fresh);
  clearParlayPending(ownerId);
  return fresh;
}

export const MARKET_OPTIONS: Array<{ value: MarketType; label: string; description: string }> = [
  { value: 'HOME_WIN', label: 'Home Win', description: '1 — home team to win' },
  { value: 'DRAW', label: 'Draw', description: 'X — level after 90 minutes' },
  { value: 'AWAY_WIN', label: 'Away Win', description: '2 — away team to win' },
  { value: 'OVER_2_5', label: 'Over 2.5 Goals', description: 'More than 2.5 total goals' },
  { value: 'UNDER_2_5', label: 'Under 2.5 Goals', description: 'Fewer than 2.5 total goals' },
  { value: 'BTTS_YES', label: 'BTTS Yes', description: 'Both teams to score' },
  { value: 'BTTS_NO', label: 'BTTS No', description: 'Not both teams to score' },
  { value: 'DOUBLE_CHANCE_1X', label: 'Home or Draw', description: 'Double chance 1X' },
];

/* ------------------------------------------------------------------ *
 * Maths
 * ------------------------------------------------------------------ */

/**
 * Combined probability assumes independent legs.
 *
 * Legs on the SAME fixture are not independent (e.g. Home Win + Over 2.5 on
 * one match), so we do not silently multiply them together and overstate the
 * chance. Instead the slip is flagged and the combined figure is suppressed
 * unless every leg is on a distinct fixture.
 */
export function hasCorrelatedLegs(parlay: CustomParlay): boolean {
  const seen = new Set<string>();
  for (const leg of parlay.legs) {
    if (seen.has(leg.fixtureId)) return true;
    seen.add(leg.fixtureId);
  }
  return false;
}

export function parlayCombinedProbability(parlay: CustomParlay): number {
  return parlay.legs.reduce((acc, l) => acc * Math.max(0.0001, l.probability), 1);
}

export function parlayImpliedOdds(parlay: CustomParlay): number | null {
  if (!parlay.legs.length) return null;
  const p = parlayCombinedProbability(parlay);
  return p > 0 ? 1 / p : null;
}

/**
 * Payout **if the slip lands** at the model's fair odds.
 * This is not the expected value - see parlayExpectedValue.
 */
export function parlayExpectedPayout(parlay: CustomParlay): number | null {
  const odds = parlayImpliedOdds(parlay);
  if (odds === null) return null;
  return Number((odds * parlay.stake).toFixed(2));
}

/**
 * Expected value of the slip:
 *
 *   EV = P(win) * payoutIfWin - stake
 *      = p * (p^-1 * stake) - stake
 *      = 0
 *
 * Fair odds are by construction EV-neutral, so this correctly evaluates to
 * zero. Reporting "payout minus stake" here would misrepresent a guaranteed
 * win as an expected return, which is exactly the kind of number that makes a
 * parlay look better than it is.
 */
export function parlayExpectedValue(parlay: CustomParlay): number | null {
  const payout = parlayExpectedPayout(parlay);
  if (payout === null) return null;
  const p = parlayCombinedProbability(parlay);
  return Number((p * payout - parlay.stake).toFixed(2));
}

/**
 * Combined decimal price of the slip using real bookmaker prices, when every
 * leg carries one. Returns null if any leg lacks a market price, so we never
 * present a synthetic "combined odds" figure.
 */
export function parlayMarketOdds(parlay: CustomParlay): number | null {
  if (!parlay.legs.length) return null;
  let product = 1;
  for (const l of parlay.legs) {
    const o = l.marketOdds;
    if (typeof o !== 'number' || !Number.isFinite(o) || o <= 1) return null;
    product *= o;
  }
  return Number(product.toFixed(3));
}

/** Model edge over the market: P(model) * marketOdds - 1. Null when unknown. */
export function parlayEdge(parlay: CustomParlay): number | null {
  const odds = parlayMarketOdds(parlay);
  if (odds === null) return null;
  const p = parlayCombinedProbability(parlay);
  return Number((p * odds - 1).toFixed(4));
}

/**
 * Fractional Kelly stake for a given probability and decimal price.
 * Clamped to [0, 0.25] so one optimistic leg cannot recommend the whole bankroll.
 */
export function kellyFraction(probability: number, decimalOdds: number): number {
  if (!Number.isFinite(probability) || !Number.isFinite(decimalOdds) || decimalOdds <= 1) return 0;
  const f = (probability * decimalOdds - 1) / (decimalOdds - 1);
  return Math.max(0, Math.min(0.25, f));
}

/**
 * Recommended stake from a model edge, expressed in units (1 unit = $10).
 *
 * The flat base is 1 unit; each percent of +EV edge adds a small, capped step,
 * so an 8.2% edge recommends ~1.55 units ($15.50). With no market price the
 * edge is 0 and the base 1-unit stake is recommended.
 */
export function recommendedStakeForEdge(edge: number | null): { units: number; stake: number; edgePct: number } {
  const e = Number.isFinite(edge as number) ? (edge as number) : 0;
  const units = Math.max(1, Math.min(MAX_RECOMMENDED_UNITS, 1 + Math.max(0, e) * 6.7));
  const rounded = Number(units.toFixed(2));
  return { units: rounded, stake: Number((rounded * UNIT_VALUE_USD).toFixed(2)), edgePct: Number((e * 100).toFixed(1)) };
}

/** Full recommended-stake bundle for a slip (edge, units, dollar stake). */
export function recommendedStake(parlay: CustomParlay): {
  units: number;
  stake: number;
  edgePct: number;
  hasMarketOdds: boolean;
  kelly: number;
} {
  const odds = parlayMarketOdds(parlay);
  const edge = parlayEdge(parlay);
  const rec = recommendedStakeForEdge(edge);
  const kelly = odds !== null ? kellyFraction(parlayCombinedProbability(parlay), odds) : 0;
  return { ...rec, hasMarketOdds: odds !== null, kelly: Number(kelly.toFixed(4)) };
}

/** Plain-text slip for the "Copy Text Slip" button. */
export function buildTextSlip(parlay: CustomParlay): string {
  if (!parlay.legs.length) return 'Cape Predictor — empty slip.';
  const lines = parlay.legs.map((l, i) => `${i + 1}. ${l.description} — ${l.selection} (${pct(l.probability)})`);
  const odds = parlayMarketOdds(parlay) ?? parlayImpliedOdds(parlay);
  const combined = parlayCombinedProbability(parlay);
  const rec = recommendedStake(parlay);
  return [
    'CAPE PREDICTOR — CUSTOM PARLAY',
    `Football Intelligence. Smarter Predictions.`,
    '',
    ...lines,
    '',
    `Legs: ${parlay.legs.length}`,
    `Combined odds: ${odds ? `${odds.toFixed(2)}x` : 'N/A'}`,
    `Model win probability: ${pct(combined, 2)}`,
    `Stake: $${parlay.stake.toFixed(2)}`,
    `Payout if every leg lands: $${((odds ?? 0) * parlay.stake).toFixed(2)}`,
    `Recommended stake: $${rec.stake.toFixed(2)} (${rec.units.toFixed(2)} units)`,
    '',
    'Model estimates only — not bookmaker odds, not financial advice.',
  ].join('\n');
}

/* ------------------------------------------------------------------ *
 * Mutations
 * ------------------------------------------------------------------ */
export function addLeg(parlay: CustomParlay, leg: ParlayLeg): { ok: boolean; reason?: string } {
  if (parlay.legs.length >= MAX_LEGS) {
    return { ok: false, reason: `A slip can hold at most ${MAX_LEGS} legs.` };
  }
  if (parlay.legs.some((l) => l.fixtureId === leg.fixtureId && l.market === leg.market)) {
    return { ok: false, reason: 'That market is already on your slip for this match.' };
  }
  if (!Number.isFinite(leg.probability) || leg.probability <= 0 || leg.probability > 1) {
    return { ok: false, reason: 'Model probability unavailable for that selection.' };
  }
  parlay.legs.push(leg);
  parlay.saved = false;
  parlay.savedAt = null;
  return { ok: true };
}

/** Remove a leg by 1-based index as shown in the embed. */
export function removeLeg(parlay: CustomParlay, index1Based: number): { ok: boolean; reason?: string } {
  const idx = index1Based - 1;
  if (!Number.isInteger(idx) || idx < 0 || idx >= parlay.legs.length) {
    return { ok: false, reason: 'That leg does not exist.' };
  }
  parlay.legs.splice(idx, 1);
  parlay.saved = false;
  parlay.savedAt = null;
  return { ok: true };
}

export function saveParlay(parlay: CustomParlay): { ok: boolean; reason?: string } {
  if (!parlay.legs.length) return { ok: false, reason: 'Add at least one leg before saving.' };
  if (hasCorrelatedLegs(parlay)) {
    return {
      ok: false,
      reason: 'Two or more legs are on the same match, so the combined probability would not be meaningful. Keep one selection per match.',
    };
  }
  parlay.saved = true;
  parlay.savedAt = Date.now();
  return { ok: true };
}

/* ------------------------------------------------------------------ *
 * Component builders
 * ------------------------------------------------------------------ */
export function buildParlayLeagueRow(current = 'ALL'): ActionRowBuilder<StringSelectMenuBuilder> {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('cp:parlay:league')
    .setPlaceholder(`League: ${LEAGUE_OPTIONS.find((l) => l.id === current)?.label ?? current} — change…`)
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

export function buildParlayMatchRow(fixtures: any[], current?: string): ActionRowBuilder<StringSelectMenuBuilder> {
  const options = fixtures.slice(0, 25).map((f) => {
    const time = (() => {
      const d = new Date(f.kickoffTime);
      return isNaN(d.getTime()) ? 'TBC' : d.toISOString().slice(11, 16) + ' UTC';
    })();
    return new StringSelectMenuOptionBuilder()
      .setLabel(`${f.homeTeam.name} v ${f.awayTeam.name}`.slice(0, 100))
      .setValue(f.id)
      .setDescription(`${f.league} • ${time}`)
      .setDefault(f.id === current);
  });

  const menu = new StringSelectMenuBuilder()
    .setCustomId('cp:parlay:match')
    .setPlaceholder(options.length ? 'Select a match for your slip…' : 'No verified matches available')
    .addOptions(options.length ? options : [
      new StringSelectMenuOptionBuilder()
        .setLabel('No verified fixtures')
        .setValue('none')
        .setDescription('Providers unavailable right now'),
    ])
    .setDisabled(options.length === 0);

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

export function buildParlayMarketRow(current?: string): ActionRowBuilder<StringSelectMenuBuilder> {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('cp:parlay:market')
    .setPlaceholder(current ? `Market: ${current} — change…` : 'Select a market…')
    .addOptions(
      MARKET_OPTIONS.map((m) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(m.label)
          .setValue(m.value)
          .setDescription(m.description)
          .setDefault(m.value === current)),
    );
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

export function buildParlayActionRows(parlay: CustomParlay): ActionRowBuilder<ButtonBuilder>[] {
  const empty = parlay.legs.length === 0;
  // The manual "Set Stake" button was removed: slips now auto-default to a
  // 1-unit ($10) base stake and the model recommends an edge-scaled amount.
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('cp:parlay:add')
        .setLabel('Add Leg')
        .setEmoji('➕')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(empty),
      new ButtonBuilder()
        .setCustomId('cp:parlay:remove')
        .setLabel('Remove Leg')
        .setEmoji('🗑️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(empty),
      new ButtonBuilder()
        .setCustomId('cp:parlay:copyslip')
        .setLabel('Copy Text Slip')
        .setEmoji('📋')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(empty),
      new ButtonBuilder()
        .setCustomId('cp:parlay:save')
        .setLabel('Save & Share')
        .setEmoji('💾')
        .setStyle(ButtonStyle.Success)
        .setDisabled(empty),
      new ButtonBuilder()
        .setCustomId('cp:parlay:clear')
        .setLabel('Clear')
        .setStyle(ButtonStyle.Danger),
    ),
  ];
}

/** Modal used to set the stake without needing a raw command. */
export function buildStakeModal(stake: number): ModalBuilder {
  return new ModalBuilder()
    .setCustomId('cp:parlay:stake-modal')
    .setTitle('Set Parlay Stake')
    .addComponents(
      new Row<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('stake')
          .setLabel('Stake (units)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('10')
          .setValue(String(stake))
          .setRequired(true)
          .setMinLength(1)
          .setMaxLength(10),
      ),
    );
}

export function buildRemoveLegRow(parlay: CustomParlay): ActionRowBuilder<ButtonBuilder> | null {
  if (!parlay.legs.length) return null;
  // Discord allows at most 5 buttons per row.
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    parlay.legs.slice(0, 5).map((leg, i) =>
      new ButtonBuilder()
        .setCustomId(`cp:parlay:drop:${i + 1}`)
        .setLabel(`Remove ${i + 1}`)
        .setStyle(ButtonStyle.Danger)),
  );
}

/* ------------------------------------------------------------------ *
 * Embeds
 * ------------------------------------------------------------------ */
function pct(v: number, digits = 1): string {
  return `${(v * 100).toFixed(digits)}%`;
}
function fairOdds(p: number): string {
  return p > 0 ? `${(1 / p).toFixed(2)}x` : 'N/A';
}

export function buildParlayEmbed(parlay: CustomParlay, notice?: string): EmbedBuilder {
  const e = new EmbedBuilder()
    .setColor(BRAND.accent)
    .setAuthor({ name: BRAND.author })
    .setTitle('🎟️ Custom Parlay')
    .setTimestamp(new Date());

  const header = notice ? `> ${notice}` : `*${BRAND.tagline}* — build your own slip`;
  e.setDescription(header);

  if (!parlay.legs.length) {
    e.addFields({
      name: 'Your slip',
      value: 'No legs yet.\nPick a **league**, then a **match**, then a **market**, then press **➕ Add Leg**.',
      inline: false,
    });
    e.setFooter({ text: BRAND.footer });
    return e;
  }

  const legsText = parlay.legs
    .map((l, i) => {
      const conf = Number.isFinite(l.confidenceLower as number) && Number.isFinite(l.confidenceUpper as number)
        ? ` • ${pct(l.confidenceLower as number)}–${pct(l.confidenceUpper as number)}` : '';
      return `\`${i + 1}\` **${l.description}**\n     ${l.selection} • model ${pct(l.probability)}${conf} • fair ${fairOdds(l.probability)}`;
    })
    .join('\n')
    .slice(0, 1024);

  e.addFields({ name: `Slip (${parlay.legs.length}/${MAX_LEGS} legs)`, value: legsText, inline: false });

  const correlated = hasCorrelatedLegs(parlay);
  const combined = parlayCombinedProbability(parlay);
  const marketOdds = parlayMarketOdds(parlay);
  const fairOddsValue = parlayImpliedOdds(parlay);
  const displayOdds = marketOdds ?? fairOddsValue;
  const stake = parlay.stake;
  const payout = displayOdds !== null ? Number((displayOdds * stake).toFixed(2)) : null;
  const ev = displayOdds !== null ? Number((combined * displayOdds * stake - stake).toFixed(2)) : null;
  const rec = recommendedStake(parlay);

  const calc = correlated
    ? [
      'Two or more legs are on the **same match**, so a combined probability is not meaningful.',
      'Keep one selection per match to see combined odds.',
    ].join('\n')
    : [
      `Combined Decimal Odds: **${displayOdds !== null ? `${displayOdds.toFixed(2)}x` : 'N/A'}**${marketOdds !== null ? ' *(bookmaker)*' : ' *(model fair)*'}`,
      `Model Win Probability: **${pct(combined, 2)}**`,
      `Estimated Potential Payout: **$${stake.toFixed(2)} → $${payout !== null ? payout.toFixed(2) : 'N/A'}**`,
      `Expected Value: **$${ev !== null ? ev.toFixed(2) : 'N/A'}**${marketOdds === null ? ' *(fair odds are EV-neutral)*' : ''}`,
      '',
      `> **Recommended Stake:** $${rec.stake.toFixed(2)} (${rec.units.toFixed(2)} Units based on ${rec.edgePct.toFixed(1)}% ${rec.edgePct >= 0 ? '+' : ''}EV edge)`,
    ].join('\n');

  e.addFields({ name: 'Combined', value: calc, inline: false });

  const status = parlay.saved
    ? `💾 **Saved**${parlay.savedAt ? ` <t:${Math.floor(parlay.savedAt / 1000)}:R>` : ''}`
    : 'Draft — press **💾 Save Parlay** to keep it';
  e.addFields({ name: 'Status', value: `${status}\n\n*Model estimates only. Not bookmaker odds, not advice, never a guaranteed win.*`, inline: false });

  e.setFooter({ text: BRAND.footer });
  return e;
}

/** Shareable confirmation posted once a slip is saved. */
export function buildSavedParlayEmbed(parlay: CustomParlay): EmbedBuilder {
  const odds = parlayImpliedOdds(parlay);
  const combined = parlayCombinedProbability(parlay);
  const e = new EmbedBuilder()
    .setColor(BRAND.positive)
    .setAuthor({ name: BRAND.author })
    .setTitle('💾 Parlay Saved')
    .setTimestamp(new Date());

  e.setDescription(`Your ${parlay.legs.length}-leg Cape Predictor slip is saved to your account.`);
  e.addFields(
    {
      name: 'Slip',
      value: parlay.legs.map((l, i) => `\`${i + 1}\` ${l.description} — **${l.selection}** (${pct(l.probability)})`).join('\n').slice(0, 1024),
      inline: false,
    },
    {
      name: 'Snapshot',
      value: `Combined **${pct(combined, 2)}** • fair **${odds ? odds.toFixed(2) : 'n/a'}x** • stake **${parlay.stake}**`,
      inline: false,
    },
  );
  e.setFooter({ text: `${BRAND.footer} • Probabilities are point-in-time model estimates` });
  return e;
}

/** Full ephemeral payload for the builder. */
export function buildParlayPayload(
  parlay: CustomParlay,
  fixtures: any[],
  options: { league?: string; notice?: string } = {},
) {
  const league = options.league ?? getParlayLeague(parlay.ownerId);
  const pending = getParlayPendingMatch(parlay.ownerId);
  const components: any[] = [
    buildParlayLeagueRow(league),
    buildParlayMatchRow(fixtures, pending),
    buildParlayMarketRow(),
    ...buildParlayActionRows(parlay),
  ];
  const removeRow = buildRemoveLegRow(parlay);
  if (removeRow) components.push(removeRow);

  return { embeds: [buildParlayEmbed(parlay, options.notice)], components };
}