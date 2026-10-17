import React, { useState } from 'react';
import { MatchAnalysis, MarketPrediction } from '../types';
import { computeOutcomeProbabilities } from '../utils/matchOutcome';
import { X, TrendingUp, AlertTriangle, Shield, Activity, Users, CheckCircle2, Trophy } from 'lucide-react';

interface MatchAnalysisModalProps {
  analysis: MatchAnalysis | null;
  onClose: () => void;
}

export const MatchAnalysisModal: React.FC<MatchAnalysisModalProps> = ({ analysis, onClose }) => {
  const [activeTab, setActiveTab] = useState<'markets' | 'matrix' | 'form' | 'lineups'>('markets');

  if (!analysis) return null;

  const { fixture, homeForm, awayForm, headToHead, dixonColesParameters, scoreMatrix, marketPredictions, injuries, lineups } = analysis;

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
                    {pred.riskFactors.length > 0 && (
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

          {/* TAB 3: FORM & HEAD-TO-HEAD */}
          {activeTab === 'form' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Home Form */}
                <div className="bg-slate-950/70 border border-white/5 rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-extrabold text-white text-sm">{fixture.homeTeam.name} (Home)</span>
                    <div className="flex space-x-1.5">
                      {homeForm.last5Results.map((r, i) => (
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
                      {awayForm.last5Results.map((r, i) => (
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
                      {headToHead.recentMeetings.map((m, idx) => (
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
                  {lineups.home?.startingXI ? (
                    <div className="space-y-1 text-xs">
                      {lineups.home.startingXI.map(p => (
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
                  {lineups.away?.startingXI ? (
                    <div className="space-y-1 text-xs">
                      {lineups.away.startingXI.map(p => (
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
            {analysis.dataQualityNotes.map((note, i) => (
              <div key={i}>• {note}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
