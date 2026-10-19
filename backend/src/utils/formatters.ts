/**
 * Null-safe number formatting helper.
 *
 * Returns `fallback` when the value is undefined, null, or NaN, otherwise
 * formats it with the requested number of digits.
 */
export function safeToFixed(
  val: number | undefined | null,
  digits: number = 2,
  fallback: string = 'N/A',
): string {
  if (val === undefined || val === null || isNaN(val)) {
    return fallback;
  }
  return val.toFixed(digits);
}
