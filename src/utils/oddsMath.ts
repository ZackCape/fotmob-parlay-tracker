export interface OddsComparison {
  homeOdds: number | null;
  drawOdds: number | null;
  awayOdds: number | null;
  impliedHome: number | null;
  impliedDraw: number | null;
  impliedAway: number | null;
  overround: number | null;
  normalizedHome: number | null;
  normalizedDraw: number | null;
  normalizedAway: number | null;
  fairOddsHome: number | null;
  fairOddsDraw: number | null;
  fairOddsAway: number | null;
  diffHome: number | null;
  diffDraw: number | null;
  diffAway: number | null;
}

function safeNum(v: any): number | null {
  const n = Number(v);
  if (!isFinite(n) || n <= 0) return null;
  return n;
}

export function computeOddsComparison(
  homeOdds: any, drawOdds: any, awayOdds: any,
  modelHome: number | null, modelDraw: number | null, modelAway: number | null,
): OddsComparison {
  const h = safeNum(homeOdds);
  const d = safeNum(drawOdds);
  const a = safeNum(awayOdds);
  const impliedHome = h ? 1 / h : null;
  const impliedDraw = d ? 1 / d : null;
  const impliedAway = a ? 1 / a : null;
  let overround: number | null = null;
  if (impliedHome !== null && impliedDraw !== null && impliedAway !== null) {
    overround = impliedHome + impliedDraw + impliedAway;
  }
  let normalizedHome: number | null = null;
  let normalizedDraw: number | null = null;
  let normalizedAway: number | null = null;
  if (overround && overround > 0 && impliedHome !== null && impliedDraw !== null && impliedAway !== null) {
    normalizedHome = impliedHome / overround;
    normalizedDraw = impliedDraw / overround;
    normalizedAway = impliedAway / overround;
  }
  const fairOddsHome = modelHome && modelHome > 0 ? 1 / modelHome : null;
  const fairOddsDraw = modelDraw && modelDraw > 0 ? 1 / modelDraw : null;
  const fairOddsAway = modelAway && modelAway > 0 ? 1 / modelAway : null;
  const diffHome = (modelHome !== null && normalizedHome !== null) ? (modelHome - normalizedHome) * 100 : null;
  const diffDraw = (modelDraw !== null && normalizedDraw !== null) ? (modelDraw - normalizedDraw) * 100 : null;
  const diffAway = (modelAway !== null && normalizedAway !== null) ? (modelAway - normalizedAway) * 100 : null;
  return {
    homeOdds: h, drawOdds: d, awayOdds: a,
    impliedHome, impliedDraw, impliedAway,
    overround,
    normalizedHome, normalizedDraw, normalizedAway,
    fairOddsHome, fairOddsDraw, fairOddsAway,
    diffHome, diffDraw, diffAway,
  };
}