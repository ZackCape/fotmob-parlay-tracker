import React, { useState } from 'react';
import { StatisticalParlay, ParlayLegCount, ParlayMode, LiveTrackedParlay } from '../types';
import { generateParlay, trackParlay } from '../api';
import { Layers, AlertCircle, ShieldAlert, CheckCircle2, TrendingUp, HelpCircle, Trophy, Zap, Activity, AlertTriangle } from 'lucide-react';

interface ParlayBuilderProps {
  selectedDate: string;
  selectedLeague: string;
  onTrackLive?: (liveParlay: LiveTrackedParlay) => void;
}

export const ParlayBuilder: React.FC<ParlayBuilderProps> = ({ selectedDate, selectedLeague, onTrackLive }) => {
  const [legsCount, setLegsCount] = useState<ParlayLegCount>(5);
  const [minProb, setMinProb] = useState<number>(0.60);
  const [mode, setMode] = useState<ParlayMode>('SAME_GAME_PARLAY');
  const [parlay, setParlay] = useState<StatisticalParlay | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [trackingLoading, setTrackingLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [bestAvailableLoading, setBestAvailableLoading] = useState<boolean>(false);
  const [tomorrowLoading, setTomorrowLoading] = useState<boolean>(false);

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await generateParlay({
        date: selectedDate,
        legsCount,
        mode,
        minProbability: minProb,
        leagueFilter: selectedLeague,
      });
      setParlay(result);
    } catch (err: any) {
      setError(err.message || 'Failed to generate parlay');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateTomorrow = async () => {
    setTomorrowLoading(true);
    setError(null);
    try {
      const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      const result = await generateParlay({
        date: tomorrow,
        legsCount,
        mode,
        minProbability: minProb,
        leagueFilter: selectedLeague,
      });
      setParlay(result);
    } catch (err: any) {
      setError(err.message || 'Failed to generate tomorrow\'s slate');
    } finally {
      setTomorrowLoading(false);
    }
  };

  const handleGenerateBestAvailable = async () => {
    if (!parlay) return;
    const target = (parlay.actualLegsCount && parlay.actualLegsCount > 0 ? parlay.actualLegsCount : parlay.legs.length) || 1;
    setBestAvailableLoading(true);
    setError(null);
    try {
      const result = await generateParlay({
        date: selectedDate,
        legsCount: target as ParlayLegCount,
        mode,
        minProbability: minProb,
        leagueFilter: selectedLeague,
      });
      setParlay(result);
    } catch (err: any) {
      setError(err.message || 'Failed to scale down the slip');
    } finally {
      setBestAvailableLoading(false);
    }
  };

  const handleTrackParlay = async () => {
    if (!parlay) return;
    setTrackingLoading(true);
    setError(null);
    try {
      const live = await trackParlay(parlay);
      if (onTrackLive) {
        onTrackLive(live);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to initiate live tracking');
    } finally {
      setTrackingLoading(false);
    }
  };

  const legCounts: ParlayLegCount[] = [5, 10, 15, 20, 25];

  return (
    <div className="space-y-6">
      {/* Configuration Card */}
      <div className="bg-[#16181d] border border-[#252932] rounded-3xl p-6 sm:p-8 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div className="flex items-center space-x-3.5">
            <div className="p-3 rounded-2xl bg-[#00d66c]/20 border border-[#00d66c]/30 text-[#00d66c]">
              <Layers className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-xl font-black text-white">Statistical Parlay & SGP Engine</h2>
                <span className="text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full bg-[#00d66c]/20 text-[#00d66c] border border-[#00d66c]/30">
                  Live Verified Feed
                </span>
              </div>
              <p className="text-xs text-[#8c92a4] mt-0.5">
                Build Poisson & Dixon-Coles validated parlays across European competitions.
              </p>
            </div>
          </div>
        </div>

        {/* Mode Selector (Anti-Correlated vs Same-Game Parlay vs Correlated Allowed) */}
        <div className="mb-6 p-4 rounded-2xl bg-[#1c1f26] border border-[#252932]">
          <label className="block text-xs font-bold text-white uppercase tracking-wider mb-2">
            Correlation & Stacking Mode
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setMode('SAME_GAME_PARLAY')}
              className={`p-3 rounded-xl text-left transition-all border cursor-pointer ${
                mode === 'SAME_GAME_PARLAY'
                  ? 'bg-[#00d66c]/15 border-[#00d66c] text-white shadow-sm'
                  : 'bg-[#16181d] border-[#252932] text-[#8c92a4] hover:text-white'
              }`}
            >
              <div className="font-extrabold text-xs text-[#00d66c]">🔥 Same-Game Parlay (SGP)</div>
              <div className="text-[11px] text-[#8c92a4] mt-1">
                Allows stacking Over 0.5 Goals + Over 5.5 Corners + Cards on the same match with copula adjustment.
              </div>
            </button>

            <button
              type="button"
              onClick={() => setMode('ANTI_CORRELATED')}
              className={`p-3 rounded-xl text-left transition-all border cursor-pointer ${
                mode === 'ANTI_CORRELATED'
                  ? 'bg-[#00d66c]/15 border-[#00d66c] text-white shadow-sm'
                  : 'bg-[#16181d] border-[#252932] text-[#8c92a4] hover:text-white'
              }`}
            >
              <div className="font-extrabold text-xs text-white">🛡️ Strict Anti-Correlated</div>
              <div className="text-[11px] text-[#8c92a4] mt-1">
                Strictly 1 leg per fixture across separate matches to maximize statistical independence.
              </div>
            </button>

            <button
              type="button"
              onClick={() => setMode('CORRELATED_ALLOWED')}
              className={`p-3 rounded-xl text-left transition-all border cursor-pointer ${
                mode === 'CORRELATED_ALLOWED'
                  ? 'bg-[#00d66c]/15 border-[#00d66c] text-white shadow-sm'
                  : 'bg-[#16181d] border-[#252932] text-[#8c92a4] hover:text-white'
              }`}
            >
              <div className="font-extrabold text-xs text-white">⚡ Correlated Allowed</div>
              <div className="text-[11px] text-[#8c92a4] mt-1">
                Unrestricted correlation across all matches without mutual exclusion guards.
              </div>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Target Legs Count Selector */}
          <div>
            <label className="block text-xs font-bold text-[#8c92a4] uppercase tracking-wider mb-2">
              Leg Combination Size
            </label>
            <div className="grid grid-cols-5 gap-1.5 bg-[#1c1f26] p-1.5 rounded-2xl border border-[#252932]">
              {legCounts.map(count => (
                <button
                  key={count}
                  type="button"
                  onClick={() => setLegsCount(count)}
                  className={`py-2 text-xs font-extrabold rounded-xl transition-all cursor-pointer ${
                    legsCount === count
                      ? 'bg-[#00d66c] text-black shadow-md'
                      : 'text-[#8c92a4] hover:text-white hover:bg-[#252932]'
                  }`}
                >
                  {count}L
                </button>
              ))}
            </div>
          </div>

          {/* Probability Threshold Slider */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold text-[#8c92a4] uppercase tracking-wider">
                Minimum Leg Probability
              </label>
              <span className="font-mono text-xs font-black text-[#00d66c] bg-[#00d66c]/20 px-2.5 py-0.5 rounded-full border border-[#00d66c]/30">
                {(minProb * 100).toFixed(0)}%
              </span>
            </div>
            <input
              type="range"
              min="0.52"
              max="0.80"
              step="0.02"
              value={minProb}
              onChange={e => setMinProb(parseFloat(e.target.value))}
              className="w-full accent-[#00d66c] bg-[#1c1f26] rounded-lg cursor-pointer h-2"
            />
            <div className="flex justify-between text-[10px] text-[#8c92a4] mt-1 font-mono">
              <span>52% (High Volatility)</span>
              <span>65% (Balanced)</span>
              <span>80% (Conservative)</span>
            </div>
          </div>

          {/* Action CTA */}
          <div className="flex items-end">
            <button
              onClick={handleGenerate}
              disabled={loading}
              className="w-full py-3 px-5 rounded-2xl bg-[#00d66c] hover:bg-[#00b85c] text-black font-black text-sm shadow-xl shadow-[#00d66c]/20 disabled:opacity-50 transition-all flex items-center justify-center space-x-2 active:scale-98 cursor-pointer"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-black/40 border-t-black rounded-full animate-spin" />
                  <span>Computing Optimal SGP Legs...</span>
                </>
              ) : (
                <>
                  <TrendingUp className="w-4 h-4" />
                  <span>Generate {legsCount}-Leg Parlay</span>
                </>
              )}
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-4 p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs">
            {error}
          </div>
        )}

        {parlay && (parlay.status === 'INSUFFICIENT_SELECTIONS' || parlay.legs.length === 0) && (
          <div className="mt-4 space-y-3">
            <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/25 text-amber-200 text-xs flex items-start space-x-3">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-400" />
              <p className="leading-relaxed">
                ⚠️ Insufficient Upcoming Matches Remaining Today — Most matches for today have already started or finished. The pre-kickoff filter excluded them to protect your slip.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleGenerateTomorrow}
                disabled={tomorrowLoading}
                className="py-2.5 px-4 rounded-2xl bg-[#00d66c]/15 border border-[#00d66c]/30 text-[#00d66c] font-bold text-xs flex items-center space-x-2 hover:bg-[#00d66c]/25 disabled:opacity-50 transition-all cursor-pointer"
              >
                {tomorrowLoading ? <div className="w-3.5 h-3.5 border-2 border-[#00d66c]/40 border-t-[#00d66c] rounded-full animate-spin" /> : <span>📅</span>}
                <span>Generate for Tomorrow's Slate</span>
              </button>
              {parlay.legs.length > 0 && (
                <button
                  type="button"
                  onClick={handleGenerateBestAvailable}
                  disabled={bestAvailableLoading}
                  className="py-2.5 px-4 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-300 font-bold text-xs flex items-center space-x-2 hover:bg-amber-500/25 disabled:opacity-50 transition-all cursor-pointer"
                >
                  {bestAvailableLoading ? <div className="w-3.5 h-3.5 border-2 border-amber-400/40 border-t-amber-400 rounded-full animate-spin" /> : <span>⚡</span>}
                  <span>Generate Best Available ({parlay.actualLegsCount || parlay.legs.length} Legs)</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Generated Parlay Showcase */}
      {parlay && (
        <div className="space-y-6">
          {/* Main Card */}
          <div className="rounded-3xl bg-[#16181d] border border-[#252932] p-6 sm:p-8 shadow-2xl">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-6 border-b border-[#252932]">
              <div>
                <div className="flex items-center space-x-3 mb-1.5">
                  <span className="text-xl sm:text-2xl font-black text-white">
                    {parlay.actualLegsCount}-Leg {mode === 'SAME_GAME_PARLAY' ? 'Same-Game Parlay (SGP)' : 'Statistical Parlay'}
                  </span>
                  <span
                    className={`text-[10px] font-extrabold uppercase px-3 py-1 rounded-full ${
                      parlay.status === 'SUFFICIENT_SELECTIONS'
                        ? 'bg-[#00d66c]/20 text-[#00d66c] border border-[#00d66c]/30'
                        : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    }`}
                  >
                    {parlay.status === 'SUFFICIENT_SELECTIONS' ? 'Validated Complete' : 'Max Available'}
                  </span>
                </div>
                <p className="text-xs text-[#8c92a4] leading-relaxed max-w-2xl">{parlay.message}</p>
              </div>

              {/* Combined Probability, Compound Odds, and Track Live CTA */}
              <div className="flex flex-col sm:flex-row items-center gap-4">
                <div className="flex items-center gap-5 bg-[#1c1f26] p-4 rounded-2xl border border-[#252932] shrink-0">
                  <div>
                    <div className="text-[10px] text-[#8c92a4] uppercase font-bold tracking-wider">Combined Prob</div>
                    <div className="text-2xl font-black text-[#00d66c] font-mono">
                      {(parlay.combinedProbability * 100).toFixed(parlay.combinedProbability < 0.001 ? 4 : 2)}%
                    </div>
                  </div>
                  <div className="h-10 w-px bg-[#252932]" />
                  <div>
                    <div className="text-[10px] text-[#8c92a4] uppercase font-bold tracking-wider">Compound Odds</div>
                    <div className="text-2xl font-black text-white font-mono">
                      {parlay.compoundOddsDecimal.toLocaleString()}x
                    </div>
                  </div>
                </div>

                {/* Direct 1-Click Track Live Match Feature */}
                <button
                  onClick={handleTrackParlay}
                  disabled={trackingLoading}
                  className="w-full sm:w-auto py-3.5 px-5 rounded-2xl bg-[#00d66c] hover:bg-[#00b85c] text-black font-black text-xs uppercase tracking-wider flex items-center justify-center space-x-2 shadow-lg shadow-[#00d66c]/25 active:scale-95 transition-all cursor-pointer"
                >
                  <Activity className={`w-4 h-4 ${trackingLoading ? 'animate-spin' : ''}`} />
                  <span>{trackingLoading ? 'Initializing Live Tracker...' : '🎯 Track Parlay Live'}</span>
                </button>
              </div>
            </div>

            {/* Assumptions & Integrity Guarantees */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6 text-xs">
              <div className="bg-[#1c1f26] p-4 rounded-2xl border border-[#252932]">
                <div className="flex items-center space-x-2 font-bold text-[#00d66c] mb-1.5">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Correlation Logic</span>
                </div>
                <p className="text-[#8c92a4] text-[11px] leading-relaxed">{parlay.correlationExplanation}</p>
              </div>

              <div className="bg-[#1c1f26] p-4 rounded-2xl border border-[#252932]">
                <div className="flex items-center space-x-2 font-bold text-sky-400 mb-1.5">
                  <HelpCircle className="w-4 h-4" />
                  <span>Independence Assumptions</span>
                </div>
                <p className="text-[#8c92a4] text-[11px] leading-relaxed">{parlay.independenceAssumptions}</p>
              </div>
            </div>

            {/* Warning Alert */}
            <div className="mt-4 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/25 text-amber-200 text-xs flex items-start space-x-3">
              <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5 text-amber-400" />
              <p className="leading-relaxed">{parlay.riskWarning}</p>
            </div>
          </div>

          {/* Leg Breakdown List */}
          <div className="space-y-3">
            <h3 className="text-xs font-black text-[#8c92a4] uppercase tracking-wider">
              Leg Breakdown ({parlay.legs.length} Selected Legs)
            </h3>

            <div className="grid grid-cols-1 gap-3">
              {parlay.legs.map((leg, index) => (
                <div
                  key={`${leg.fixtureId}-${leg.market}-${index}`}
                  className="rounded-2xl bg-[#16181d] border border-[#252932] p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:border-[#00d66c]/40 transition-colors"
                >
                  <div className="flex items-start space-x-3.5">
                    <span className="w-7 h-7 rounded-full bg-[#00d66c]/20 text-[#00d66c] border border-[#00d66c]/30 flex items-center justify-center text-xs font-mono font-black shrink-0">
                      {index + 1}
                    </span>
                    <div>
                      <div className="flex items-center space-x-2 text-xs mb-1">
                        <span className="font-bold text-white text-sm">{leg.fixtureDescription}</span>
                        <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-[#1c1f26] text-[#8c92a4]">
                          {leg.league}
                        </span>
                      </div>
                      <div className="text-sm font-extrabold text-[#00d66c]">{leg.selection}</div>
                      <div className="text-[11px] text-[#8c92a4] mt-1 flex flex-wrap gap-x-4 gap-y-1">
                        <span>Sample: {leg.sampleSize} matches</span>
                        <span>Goals avg: {leg.supportingStatistics.homeGoalAverageLast5} vs {leg.supportingStatistics.awayGoalAverageLast5}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex md:flex-col items-center md:items-end justify-between shrink-0">
                    <div className="text-[10px] text-[#8c92a4] uppercase font-bold">Calibrated Prob</div>
                    <div className="text-lg font-black text-white font-mono">
                      {(leg.estimatedProbability * 100).toFixed(1)}%
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
