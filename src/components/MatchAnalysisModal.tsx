import React, { useState } from 'react';
import { MatchAnalysis, MarketPrediction } from '../types';
import { computeOutcomeProbabilities } from '../utils/matchOutcome';
import { computeOddsComparison } from '../utils/oddsMath';
import { X, TrendingUp, AlertTriangle, Shield, Activity, Users, CheckCircle2, Trophy, BarChart3, AlertCircle } from 'lucide-react';

interface MatchAnalysisModalProps {
  analysis: MatchAnalysis | null;
  onClose: () => void;
}

const EMPTY_FORM: any = {
  matchesPlayed: 0, wins: 0, draws: 0, losses: 0, goalsScored: 0, goalsConceded: 0,
  cleanSheets: 0, failedToScore: 0, avgShots: null, avgShotsOnTarget: null, avgCorners: null,
  avgYellowCards: null, avgXg: null, last5Results: [], recentFixtures: [],
};
const EMPTY_H2H: any = { totalMeetings: 0, homeWins: 0, draws: 0, awayWins: 0, avgGoals: 0, recentMeetings: [] };
const EMPTY_DC: any = {
  homeExpectedGoals: 0, awayExpectedGoals: 0, homeAttackStrength: 0, homeDefenseWeakness: 0,
  awayAttackStrength: 0, awayDefenseWeakness: 0, homeAdvantage: 0,
};
const EMPTY_MATRIX: any[] = [];
const EMPTY_PREDICTIONS: any[] = [];
const EMPTY_LINEUPS: any = { home: null, away: null };

export const MatchAnalysisModal: React.FC<MatchAnalysisModalProps> = ({ analysis, onClose }) => {
  const [activeTab, setActiveTab] = useState<'markets' | 'stats' | 'matrix' | 'form' | 'lineups'>('markets');
  const [oddsData, setOddsData] = useState<any>(null);
  const [oddsLoading, setOddsLoading] = useState<boolean>(false);

  React.useEffect(() => {
    let cancelled = false;
    setOddsLoading(true);
    const params = new URLSearchParams({
      fixtureId: fixture.id,
      date: fixture.date,
      league: fixture.league,
    });
    const homePred = analysis.marketPredictions?.find(p => p.market === 'HOME_WIN');
    const drawPred = analysis.marketPredictions?.find(p => p.market === 'DRAW');
    const awayPred = analysis.marketPredictions?.find(p => p.market === 'AWAY_WIN');
    if (homePred) params.set('modelHome', String(homePred.estimatedProbability));
    if (drawPred) params.set('modelDraw', String(drawPred.estimatedProbability));
    if (awayPred) params.set('modelAway', String(awayPred.estimatedProbability));
    fetch(`/api/odds?${params.toString()}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setOddsData(d); })
      .catch(() => { if (!cancelled) setOddsData({ available: false, reason: 'error' }); })
      .finally(() => { if (!cancelled) setOddsLoading(false); });
    return () => { cancelled = true; };
  }, [fixture.id]);

  if (!analysis || !analysis.fixture) return null;

  const {
    fixture,
    homeForm = EMPTY_FORM,
    awayForm = EMPTY_FORM,
    headToHead = EMPTY_H2H,
    dixonColesParameters = EMPTY_DC,
    scoreMatrix = EMPTY_MATRIX,
    marketPredictions = EMPTY_PREDICTIONS,
    injuries = null,
    lineups = EMPTY_LINEUPS,
  } = analysis ?? ({} as any);

  // Adapter data may be partially populated; never trust missing collections.
  const dataQualityNotes: string[] = Array.isArray(analysis?.dataQualityNotes) ? analysis.dataQualityNotes : [];
  const homeXI = lineups?.home?.startingXI ?? [];
  const awayXI = lineups?.away?.startingXI ?? [];
  const homeSubs = lineups?.home?.substitutes ?? [];
  const awaySubs = lineups?.away?.substitutes ?? [];
  const homeLast5 = homeForm?.last5Results ?? [];
  const awayLast5 = awayForm?.last5Results ?? [];
  const h2hMeetings = headToHead?.recentMeetings ?? [];

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-6">
      <div className="relative bg-slate-900 border border-white/10 rounded-2xl w-full max-w-5xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        
        {/* Header with Trophy Gold Styling */}
        <div className="p-5 sm:p-6 bg-slate-950 border-b border-white/10 flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2.5">
              <img src={fixture.homeTeam.logo} alt={fixture.homeTeam.name} className="w-9 h-9 object-contain rounded-full p-0.5 bg-slate-900 border border-white/10" />
              <span className="font-extrabold text-base sm:text-xl text-white">{fixture.homeTeam.name}</span>
            </div>
            <span className="text-amber-400 font-black text-sm">vs</span>
            <div className="flex items-center space-x-2.5">
              <img src={fixture.awayTeam.logo} alt={fixture.awayTeam.name} className="w-9 h-9 object-contain rounded-full p-0.5 bg-slate-900 border border-white/10" />
              <span className="font-extrabold text-base sm:text-xl text-white">{fixture.awayTeam.name}</span>
            </div>
            <span className="hidden sm:inline-block text-[11px] font-black uppercase px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
              {fixture.league}
            </span>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-full hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quick Highlights Bar */}
        <div className="px-6 py-3.5 bg-slate-950/80 border-b border-white/5 flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
          <div className="flex items-center space-x-4 text-slate-300">
            <div>
              <span className="text-slate-500">Venue:</span> <span className="font-semibold text-white">{fixture.venue}</span>
            </div>
            <div>
              <span className="text-slate-500">Kickoff:</span> <span className="font-semibold text-white font-mono">{fixture.kickoffTime.substring(0, 10)}</span>
            </div>
            <div>
              <span className="text-slate-500">Feed:</span> <span className="text-amber-400 font-semibold">{fixture.dataSource}</span>
            </div>
          </div>

          <div className="flex items-center space-x-3 font-mono">
            <span className="bg-amber-500/10 px-3 py-1 rounded-xl border border-amber-500/25 text-amber-300 font-bold">
              Home xG: {dixonColesParameters.homeExpectedGoals}
            </span>
            <span className="bg-sky-500/10 px-3 py-1 rounded-xl border border-sky-500/25 text-sky-300 font-bold">
              Away xG: {dixonColesParameters.awayExpectedGoals}
            </span>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="px-6 border-b border-white/10 flex space-x-6 text-xs sm:text-sm font-bold shrink-0 bg-slate-950/50">
          <button
            onClick={() => setActiveTab('markets')}
            className={`py-3.5 border-b-2 transition-colors flex items-center space-x-2 ${
              activeTab === 'markets' ? 'border-amber-400 text-amber-300' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <TrendingUp className="w-4 h-4 text-amber-400" />
            <span>Market Predictions ({marketPredictions.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('stats')}
            className={`py-3.5 border-b-2 transition-colors flex items-center space-x-2 ${
              activeTab === 'stats' ? 'border-blue-400 text-blue-300' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            <span>Match Stats</span>
          </button>

          <button
            onClick={() => setActiveTab('matrix')}
            className={`py-3.5 border-b-2 transition-colors flex items-center space-x-2 ${
              activeTab === 'matrix' ? 'border-amber-400 text-amber-300' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Activity className="w-4 h-4 text-amber-400" />
            <span>Scoreline Heatmap</span>
          </button>
          <button
            onClick={() => setActiveTab('form')}
            className={`py-3.5 border-b-2 transition-colors flex items-center space-x-2 ${
              activeTab === 'form' ? 'border-amber-400 text-amber-300' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Shield className="w-4 h-4 text-amber-400" />
            <span>Form & Head-to-Head</span>
          </button>
          <button
            onClick={() => setActiveTab('lineups')}
            className={`py-3.5 border-b-2 transition-colors flex items-center space-x-2 ${
              activeTab === 'lineups' ? 'border-amber-400 text-amber-300' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Users className="w-4 h-4 text-amber-400" />
            <span>Injuries & Lineups</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-6">

          {/* MATCH OUTCOME PROBABILITIES */}
          {(() => {
            const homePred = marketPredictions.find(p => p.market === 'HOME_WIN');
            const drawPred = marketPredictions.find(p => p.market === 'DRAW');
            const awayPred = marketPredictions.find(p => p.market === 'AWAY_WIN');
            const res = computeOutcomeProbabilities(
              homePred?.estimatedProbability,
              drawPred?.estimatedProbability,
              awayPred?.estimatedProbability,
            );
            if (!res) return null;
            const rows = [
              { label: `${fixture.homeTeam.name} Win`, value: res.home, color: 'bg-blue-500', key: 'home' as const },
              { label: 'Draw', value: res.draw, color: 'bg-slate-400', key: 'draw' as const },
              { label: `${fixture.awayTeam.name} Win`, value: res.away, color: 'bg-sky-500', key: 'away' as const },
            ];
            const mostLikelyLabel = res.tied
              ? 'Tied highest probability'
              : res.mostLikely === 'home'
              ? `${fixture.homeTeam.name} Win`
              : res.mostLikely === 'away'
              ? `${fixture.awayTeam.name} Win`
              : 'Draw';
            return (
              <div className="bg-slate-950/70 border border-white/10 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-white">Match Outcome (Predicted)</span>
                  <span className="text-xs text-slate-400">
                    {res.tied ? 'Tied highest probability' : `Most likely: ${mostLikelyLabel}`}
                  </span>
                </div>
                {rows.map((r, i) => {
                  const isTop = !res.tied && res.mostLikely === r.key;
                  return (
                    <div key={i} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className={`font-semibold ${isTop ? 'text-white' : 'text-slate-300'}`}>{r.label}</span>
                        <span className={`font-mono font-bold ${isTop ? 'text-blue-300' : 'text-slate-400'}`}>
                          {(r.value * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                        <div className={`${r.color} h-1.5 rounded-full transition-all`} style={{ width: `${Math.min(100, r.value * 100)}%` }} />
                      </div>
                    </div>
                  );
                })}
                <p className="text-[10px] text-slate-500">
                  Model estimates, not guaranteed results. Probabilities are calibrated and may not sum to exactly 100% after rounding.
                </p>
              </div>
            );
          })()}

          {/* ODDS & MARKET */}
          {oddsLoading && (
            <div className="text-xs text-slate-400">Loading odds...</div>
          )}
          {!oddsLoading && oddsData && oddsData.available && (
            <div className="bg-slate-950/70 border border-white/10 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-white">Odds & Market (1X2)</span>
                <span className="text-[10px] text-slate-400">
                  {oddsData.bookmaker?.title || 'Bookmaker'} · {oddsData.odds?.preMatch ? 'Pre-match' : 'Live'} · Updated {oddsData.bookmaker?.lastUpdate ? new Date(oddsData.bookmaker.lastUpdate).toLocaleString() : 'n/a'}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  { label: `${fixture.homeTeam.name}`, odds: oddsData.homeOdds, model: oddsData.comparison?.diffHome, fair: oddsData.comparison?.fairOddsHome },
                  { label: 'Draw', odds: oddsData.drawOdds, model: oddsData.comparison?.diffDraw, fair: oddsData.comparison?.fairOddsDraw },
                  { label: `${fixture.awayTeam.name}`, odds: oddsData.awayOdds, model: oddsData.comparison?.diffAway, fair: oddsData.comparison?.fairOddsAway },
                ].map((r, i) => (
                  <div key={i} className="bg-slate-900/60 rounded-xl p-3 space-y-1">
                    <div className="text-[10px] text-slate-400 truncate">{r.label}</div>
                    <div className="font-mono font-bold text-white">{r.odds != null ? Number(r.odds).toFixed(2) : 'n/a'}</div>
                    <div className="text-[10px] text-slate-500">Fair: {r.fair != null ? Number(r.fair).toFixed(2) : 'n/a'}</div>
                    <div className="text-[10px] text-slate-500">
                      {r.model != null ? `${r.model > 0 ? '+' : ''}${r.model.toFixed(1)}pp` : ''}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-slate-500">
                Bookmaker odds are market data, not Cape Predictor predictions. Differences are model-vs-market signals, not guaranteed edges.
              </p>
            </div>
          )}
          {!oddsLoading && oddsData && !oddsData.available && (
            <div className="text-xs text-slate-400 bg-slate-950/70 border border-white/10 rounded-2xl p-3">
              Odds unavailable: {oddsData.reason || 'unknown'}.
            </div>
          )}

          {/* TAB 1: MARKET PREDICTIONS */}
          {activeTab === 'markets' && (
            <div className="space-y-4">
              <div className="bg-gradient-to-r from-amber-500/10 via-slate-900 to-amber-500/5 border border-amber-500/20 rounded-2xl p-3.5 text-xs text-amber-200/90 flex items-center justify-between">
                <span>
                  <strong>Strict Non-Betting-Odds Methodology:</strong> Probabilities derived exclusively from attack intensity, defense vulnerability, Dixon-Coles low-score correction, and Bayesian shrinkage.
                </span>
                <span className="font-mono text-[11px] font-bold bg-amber-500/20 px-2.5 py-0.5 rounded-full text-amber-300">
                  Calibrated
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {marketPredictions.map(pred => (
                  <div
                    key={pred.id}
                    className="bg-slate-950/70 border border-white/5 rounded-2xl p-4 flex flex-col justify-between hover:border-amber-400/30 transition-colors shadow-sm"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] text-amber-300/80 uppercase font-black tracking-wider">
                          {pred.marketLabel}
                        </span>
                        <div className="flex items-center space-x-1 font-mono text-amber-400 font-black text-sm">
                          <span>{(pred.estimatedProbability * 100).toFixed(1)}%</span>
                        </div>
                      </div>

                      <div className="font-extrabold text-white text-base mb-2">{pred.selection}</div>

                      {/* Probability Bar */}
                      <div className="w-full bg-slate-800 rounded-full h-2 mb-3 overflow-hidden">
                        <div
                          className="bg-gradient-to-r from-blue-600 to-blue-400 h-2 rounded-full"
                          style={{ width: `${Math.min(100, pred.estimatedProbability * 100)}%` }}
                        />
                      </div>

                      {/* Supporting Stats */}
                      <div className="text-[11px] text-slate-400 space-y-1 mb-3">
                        <div>
                          <span className="text-slate-500">Sample size:</span> {pred.sampleSize} matches
                        </div>
                        <div>
                          <span className="text-slate-500">95% Confidence:</span> [{(pred.confidenceLower * 100).toFixed(1)}% - {(pred.confidenceUpper * 100).toFixed(1)}%]
                        </div>
                        <div>
                          <span className="text-slate-500">Home/Away Goals:</span> {pred.supportingStatistics.homeGoalAverageLast5} vs {pred.supportingStatistics.awayGoalAverageLast5}
                        </div>
                      </div>
                    </div>

                    {/* Risk Factors */}
                    {(pred.riskFactors?.length ?? 0) > 0 && (
                      <div className="border-t border-white/5 pt-2 text-[10px] text-amber-300/90 flex items-start space-x-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" />
                        <span>{pred.riskFactors.join(' • ')}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 2: SCORELINE HEATMAP */}
          {activeTab === 'matrix' && (
            <div className="space-y-4">
              <p className="text-xs text-slate-300 leading-relaxed">
                Joint scoreline probability distribution calculated via Dixon-Coles bivariate Poisson with low-score correlation adjustment factor <span className="font-mono text-amber-400 font-bold">ρ = -0.11</span>.
              </p>

              <div className="overflow-x-auto rounded-2xl border border-white/10">
                <table className="w-full border-collapse text-center text-xs">
                  <thead>
                    <tr>
                      <th className="p-3 border border-white/5 bg-slate-950 font-bold text-amber-300">Home \ Away</th>
                      {[0, 1, 2, 3, 4].map(a => (
                        <th key={a} className="p-3 border border-white/5 bg-slate-950 font-mono font-bold text-slate-200">
                          {fixture.awayTeam.code} {a}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[0, 1, 2, 3, 4].map(h => (
                      <tr key={h}>
                        <th className="p-3 border border-white/5 bg-slate-950 font-mono font-bold text-slate-200">
                          {fixture.homeTeam.code} {h}
                        </th>
                        {[0, 1, 2, 3, 4].map(a => {
                          const cell = scoreMatrix.find(c => c.homeScore === h && c.awayScore === a);
                          const prob = cell ? cell.probability : 0;
                          const intensity = Math.min(1, prob * 6);
                          return (
                            <td
                              key={a}
                              className="p-3.5 border border-white/5 font-mono font-extrabold transition-colors"
                              style={{
                                backgroundColor: `rgba(245, 158, 11, ${intensity * 0.35})`,
                                color: prob > 0.08 ? '#fef08a' : '#cbd5e1',
                              }}
                            >
                              {(prob * 100).toFixed(1)}%
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB: MATCH STATISTICS (actual provider data) */}
          {activeTab === 'stats' && (
            <div className="space-y-4">
              {fixture.statistics ? (
                <>
                  {/* Possession */}
                  <div className="bg-slate-950/70 border border-white/10 rounded-2xl p-4">
                    <div className="text-sm font-bold text-white mb-3">Possession</div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono font-bold text-white text-sm w-12 text-right">
                        {fixture.statistics.possessionHome ?? '-'}%
                      </span>
                      <div className="flex-1 h-2.5 bg-slate-800 rounded-full overflow-hidden flex">
                        <div
                          className="bg-blue-500 h-full"
                          style={{ width: `${fixture.statistics.possessionHome ?? 0}%` }}
                        />
                        <div
                          className="bg-slate-500 h-full flex-1"
                          style={{ width: `${100 - (fixture.statistics.possessionHome ?? 0)}%` }}
                        />
                      </div>
                      <span className="font-mono font-bold text-white text-sm w-12">
                        {fixture.statistics.possessionAway ?? '-'}%
                      </span>
                    </div>
                  </div>

                  {/* Stat rows */}
                  <div className="bg-slate-950/70 border border-white/10 rounded-2xl overflow-hidden">
                    {[
                      { label: 'Total shots', home: fixture.statistics.shotsHome, away: fixture.statistics.shotsAway },
                      { label: 'Shots on target', home: fixture.statistics.shotsOnTargetHome, away: fixture.statistics.shotsOnTargetAway },
                      { label: 'xG', home: fixture.statistics.xgHome, away: fixture.statistics.xgAway },
                      { label: 'Corners', home: fixture.statistics.cornersHome, away: fixture.statistics.cornersAway },
                      { label: 'Fouls', home: fixture.statistics.foulsHome, away: fixture.statistics.foulsAway },
                      { label: 'Yellow cards', home: fixture.statistics.yellowCardsHome, away: fixture.statistics.yellowCardsAway },
                      { label: 'Red cards', home: fixture.statistics.redCardsHome, away: fixture.statistics.redCardsAway },
                    ].map((row) => {
                      const hv = row.home ?? 0;
                      const av = row.away ?? 0;
                      const total = hv + av;
                      const hp = total > 0 ? (hv / total) * 100 : 50;
                      return (
                        <div key={row.label} className="px-4 py-2.5 border-b border-white/5 last:border-b-0">
                          <div className="flex items-center justify-between text-xs mb-1.5">
                            <span className="font-mono font-bold text-white w-10">{row.home ?? '-'}</span>
                            <span className="text-slate-400">{row.label}</span>
                            <span className="font-mono font-bold text-white w-10 text-right">{row.away ?? '-'}</span>
                          </div>
                          <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden flex">
                            <div className="bg-blue-500 h-full" style={{ width: `${hp}%` }} />
                            <div className="bg-slate-600 h-full flex-1" style={{ width: `${100 - hp}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-slate-500">
                    Actual match statistics from {fixture.dataSource}. Model probabilities are shown in Market Predictions.
                  </p>
                </>
              ) : (
                <div className="bg-slate-950/70 border border-white/10 rounded-2xl p-6 text-center">
                  <AlertCircle className="w-6 h-6 mx-auto mb-2 text-slate-500" />
                  <p className="text-sm text-slate-300 font-semibold">Match statistics unavailable</p>
                  <p className="text-xs text-slate-500 mt-1">
                    The provider has not published statistics for this match yet.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: FORM & HEAD-TO-HEAD */}
          {activeTab === 'form' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Home Form */}
                <div className="bg-slate-950/70 border border-white/5 rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-extrabold text-white text-sm">{fixture.homeTeam.name} (Home)</span>
                    <div className="flex space-x-1.5">
                      {homeLast5.map((r, i) => (
                        <span
                          key={i}
                          className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-[10px] ${
                            r === 'W' ? 'bg-emerald-600 text-white' : r === 'D' ? 'bg-amber-600 text-white' : 'bg-rose-600 text-white'
                          }`}
                        >
                          {r}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs text-slate-300">
                    <div>Goals Scored: <span className="font-mono text-white font-bold">{homeForm.goalsScored}</span></div>
                    <div>Goals Conceded: <span className="font-mono text-white font-bold">{homeForm.goalsConceded}</span></div>
                    <div>Clean Sheets: <span className="font-mono text-white font-bold">{homeForm.cleanSheets}</span></div>
                    <div>Avg Shots on Target: <span className="font-mono text-white font-bold">{homeForm.avgShotsOnTarget ?? 'N/A'}</span></div>
                    <div>Avg Corners: <span className="font-mono text-white font-bold">{homeForm.avgCorners ?? 'N/A'}</span></div>
                    <div>Avg Yellow Cards: <span className="font-mono text-white font-bold">{homeForm.avgYellowCards ?? 'N/A'}</span></div>
                  </div>
                </div>

                {/* Away Form */}
                <div className="bg-slate-950/70 border border-white/5 rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-extrabold text-white text-sm">{fixture.awayTeam.name} (Away)</span>
                    <div className="flex space-x-1.5">
                      {awayLast5.map((r, i) => (
                        <span
                          key={i}
                          className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-[10px] ${
                            r === 'W' ? 'bg-emerald-600 text-white' : r === 'D' ? 'bg-amber-600 text-white' : 'bg-rose-600 text-white'
                          }`}
                        >
                          {r}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs text-slate-300">
                    <div>Goals Scored: <span className="font-mono text-white font-bold">{awayForm.goalsScored}</span></div>
                    <div>Goals Conceded: <span className="font-mono text-white font-bold">{awayForm.goalsConceded}</span></div>
                    <div>Clean Sheets: <span className="font-mono text-white font-bold">{awayForm.cleanSheets}</span></div>
                    <div>Avg Shots on Target: <span className="font-mono text-white font-bold">{awayForm.avgShotsOnTarget ?? 'N/A'}</span></div>
                    <div>Avg Corners: <span className="font-mono text-white font-bold">{awayForm.avgCorners ?? 'N/A'}</span></div>
                    <div>Avg Yellow Cards: <span className="font-mono text-white font-bold">{awayForm.avgYellowCards ?? 'N/A'}</span></div>
                  </div>
                </div>
              </div>

              {/* Head-to-Head */}
              <div className="bg-slate-950/70 border border-white/5 rounded-2xl p-5">
                <h4 className="font-extrabold text-white text-sm mb-3">Head-to-Head Records</h4>
                {headToHead.totalMeetings > 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs text-slate-300 mb-3">
                      Over last {headToHead.totalMeetings} meetings: {fixture.homeTeam.name} won {headToHead.homeWins}, {headToHead.draws} draws, {fixture.awayTeam.name} won {headToHead.awayWins}. Avg goals: {headToHead.avgGoals}.
                    </p>
                    <div className="divide-y divide-white/5">
                      {h2hMeetings.map((m, idx) => (
                        <div key={idx} className="py-2 flex items-center justify-between text-xs">
                          <span className="text-slate-500 font-mono">{m.date}</span>
                          <span className="font-semibold text-slate-200">{m.homeTeam} vs {m.awayTeam}</span>
                          <span className="font-mono font-bold text-amber-300 bg-slate-900 px-2.5 py-0.5 rounded-full">{m.score}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 italic">No head-to-head records found in recent seasons.</p>
                )}
              </div>
            </div>
          )}

          {/* TAB 4: INJURIES & LINEUPS */}
          {activeTab === 'lineups' && (
            <div className="space-y-6">
              {/* Injuries */}
              <div className="bg-slate-950/70 border border-white/5 rounded-2xl p-5">
                <h4 className="font-extrabold text-white text-sm mb-3 flex items-center space-x-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  <span>Reported Injuries & Suspensions</span>
                </h4>
                {injuries && injuries.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {injuries.map((inj, i) => (
                      <div key={i} className="bg-slate-900/90 border border-white/5 p-3 rounded-2xl flex items-center justify-between">
                        <div>
                          <div className="font-bold text-white text-xs">{inj.player}</div>
                          <div className="text-[11px] text-slate-400">{inj.teamName} • {inj.reason}</div>
                        </div>
                        <span
                          className={`text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-full ${
                            inj.status === 'OUT' ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                          }`}
                        >
                          {inj.status}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">No major injuries or suspensions reported for this fixture.</p>
                )}
              </div>

              {/* Lineups */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-slate-950/70 border border-white/5 rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-extrabold text-white text-sm">{fixture.homeTeam.name} Lineup</span>
                    <span className="text-[10px] text-amber-300 font-mono bg-amber-500/15 px-2.5 py-0.5 rounded-full border border-amber-500/25">
                      {lineups.home?.formation || '4-3-3'}
                    </span>
                  </div>
                  {homeXI.length > 0 ? (
                    <div className="space-y-1 text-xs">
                      {homeXI.map(p => (
                        <div key={p.id} className="flex items-center justify-between py-1 border-b border-white/5 text-slate-300">
                          <span><span className="font-mono text-amber-400 mr-2">#{p.number}</span>{p.name}</span>
                          <span className="text-slate-500 text-[10px] uppercase font-mono">{p.position}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500 italic">Confirmed XI announced 1 hour prior to kickoff.</p>
                  )}
                </div>

                <div className="bg-slate-950/70 border border-white/5 rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-extrabold text-white text-sm">{fixture.awayTeam.name} Lineup</span>
                    <span className="text-[10px] text-amber-300 font-mono bg-amber-500/15 px-2.5 py-0.5 rounded-full border border-amber-500/25">
                      {lineups.away?.formation || '4-2-3-1'}
                    </span>
                  </div>
                  {awayXI.length > 0 ? (
                    <div className="space-y-1 text-xs">
                      {awayXI.map(p => (
                        <div key={p.id} className="flex items-center justify-between py-1 border-b border-white/5 text-slate-300">
                          <span><span className="font-mono text-amber-400 mr-2">#{p.number}</span>{p.name}</span>
                          <span className="text-slate-500 text-[10px] uppercase font-mono">{p.position}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500 italic">Confirmed XI announced 1 hour prior to kickoff.</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Data Quality & Integrity Footer */}
          <div className="bg-slate-950 p-4 rounded-2xl border border-white/5 text-[11px] text-slate-400 space-y-1">
            <div className="font-bold text-amber-300">Data Integrity Policy:</div>
            {dataQualityNotes.map((note, i) => (
              <div key={i}>• {note}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
