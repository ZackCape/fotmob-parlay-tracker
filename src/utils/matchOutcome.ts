export interface OutcomeProbabilities {
  home: number;
  draw: number;
  away: number;
  total: number;
  mostLikely: 'home' | 'draw' | 'away' | 'tie';
  tied: boolean;
}

const EPS = 1e-9;

export function computeOutcomeProbabilities(
  homeRaw: number | null | undefined,
  drawRaw: number | null | undefined,
  awayRaw: number | null | undefined,
): OutcomeProbabilities | null {
  if (homeRaw == null || drawRaw == null || awayRaw == null) return null;
  if (!isFinite(homeRaw) || !isFinite(drawRaw) || !isFinite(awayRaw)) return null;
  if (homeRaw < 0 || drawRaw < 0 || awayRaw < 0) return null;
  const total = homeRaw + drawRaw + awayRaw;
  if (!isFinite(total) || total <= 0) return null;
  const home = homeRaw / total;
  const draw = drawRaw / total;
  const away = awayRaw / total;
  const maxVal = Math.max(home, draw, away);
  const tiedCount = [home, draw, away].filter((v) => Math.abs(v - maxVal) < EPS).length;
  const tied = tiedCount > 1;
  let mostLikely: OutcomeProbabilities['mostLikely'] = 'tie';
  if (!tied) {
    if (maxVal === home) mostLikely = 'home';
    else if (maxVal === away) mostLikely = 'away';
    else mostLikely = 'draw';
  }
  return { home, draw, away, total, mostLikely, tied };
}