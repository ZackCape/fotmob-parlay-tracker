/**
 * Cape Predictor brand constants.
 *
 * Kept in its own module so the embed builders, the interaction layer and the
 * bot itself can all share one source of truth without circular imports.
 *
 * Palette: dark navy/charcoal surfaces with a restrained blue accent.
 */
export const BRAND = {
  /** Embed author line shown on every Cape Predictor embed. */
  author: 'Cape Predictor • Football Intelligence',
  /** Product tagline. */
  tagline: 'Smarter Predictions',
  /** Restrained blue accent (0x2563EB). */
  accent: 0x2563EB,
  positive: 0x16A34A,
  negative: 0xDC2626,
  neutral: 0x6B7280,
  /** Embed footer crediting the probability engine. */
  footer: 'Cape Predictor Engine • Powered by Dixon-Coles Probability Engine',
} as const;

export default BRAND;