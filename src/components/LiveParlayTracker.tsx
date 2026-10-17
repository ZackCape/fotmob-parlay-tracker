import React, { useState, useEffect } from 'react';
import { LiveTrackedParlay, LiveTrackedLeg } from '../types';
import { fetchLiveTrackedParlays, simulateLiveTick, generateParlay, trackParlay } from '../api';
import { Activity, Zap, Play, CheckCircle2, XCircle, Clock, TrendingUp, AlertCircle, ArrowRight, ShieldCheck, Flame } from 'lucide-react';

interface LiveParlayTrackerProps {
  initialTrackedParlay?: LiveTrackedParlay | null;
  onSelectFixture?: (fixtureId: string) => void;
}

export const LiveParlayTracker: React.FC<LiveParlayTrackerProps> = ({ initialTrackedParlay, onSelectFixture }) => {
  const [trackedParlay, setTrackedParlay] = useState<LiveTrackedParlay | null>(initialTrackedParlay || null);
  const [loading, setLoading] = useState<boolean>(false);
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [allTracked, setAllTracked] = useState<LiveTrackedParlay[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Load existing live parlays on mount
  useEffect(() => {
    loadLiveParlays();
  }, []);

  useEffect(() => {
    if (initialTrackedParlay) {
      setTrackedParlay(initialTrackedParlay);
    }
  }, [initialTrackedParlay]);

  const loadLiveParlays = async () => {
    try {
      const res = await fetchLiveTrackedParlays();
      if (res.activeParlays && res.activeParlays.length > 0) {
        setAllTracked(res.activeParlays);
        if (!trackedParlay) {
          setTrackedParlay(res.activeParlays[0]);
        }
      }
    } catch (err: any) {
      console.warn('Could not load live parlays:', err);
    }
  };

  const handleSimulateTick = async () => {
    if (!trackedParlay) return;
    setIsSimulating(true);
    try {
      const updated = await simulateLiveTick(trackedParlay.parlayId);
      setTrackedParlay(updated);
      setAllTracked(prev => prev.map(p => p.parlayId === updated.parlayId ? updated : p));
    } catch (err: any) {
      setError(err.message || 'Simulation tick failed');
    } finally {
      setIsSimulating(false);
    }
  };

  const handleGenerateAndTrackDemo = async (mode: 'ANTI_CORRELATED' | 'SAME_GAME_PARLAY') => {
    setLoading(true);
    setError(null);
    try {
      const p = await generateParlay({
        date: '2026-10-17',
        legsCount: 5,
        mode,
        minProbability: 0.58,
      });
      const live = await trackParlay(p);
      setTrackedParlay(live);
      setAllTracked(prev => [live, ...prev.filter(x => x.parlayId !== live.parlayId)]);
    } catch (err: any) {
      setError(err.message || 'Failed to initialize live parlay');
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'HIT':
        return <span className="px-2 py-0.5 rounded-full bg-[#00d66c]/20 text-[#00d66c] text-[10px] font-black border border-[#00d66c]/30">HIT ✅</span>;
      case 'LIVE_WINNING':
        return <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-black border border-emerald-500/30">WINNING 🔥</span>;
      case 'LIVE_IN_PROGRESS':
        return <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-black border border-amber-500/30">IN PLAY ⏳</span>;
      case 'MISS':
        return <span className="px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 text-[10px] font-black border border-rose-500/30">BUST ❌</span>;
      default:
        return <span className="px-2 py-0.5 rounded-full bg-[#252932] text-[#8c92a4] text-[10px] font-bold">UPCOMING</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Tracker Header */}
      <div className="bg-[#16181d] border border-[#252932] rounded-3xl p-6 shadow-xl relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center space-x-3.5">
            <div className="w-12 h-12 rounded-2xl bg-[#00d66c]/20 border border-[#00d66c]/30 flex items-center justify-center text-[#00d66c]">
              <Activity className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-xl font-black text-white">Live Match Parlay Tracker</h2>
                <span className="flex items-center space-x-1 px-2.5 py-0.5 rounded-full bg-[#00d66c]/15 text-[#00d66c] text-[10px] font-extrabold border border-[#00d66c]/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#00d66c] animate-ping" />
                  <span>24/7 ACTIVE</span>
                </span>
              </div>
              <p className="text-xs text-[#8c92a4] mt-0.5">
                Real-time minute ticker, live score tracking, SGP stacked legs & dynamic cashout probability.
              </p>
            </div>
          </div>

          {/* Quick Simulation Trigger */}
          {trackedParlay && (
            <div className="flex items-center space-x-3">
              <button
                onClick={handleSimulateTick}
                disabled={isSimulating}
                className="flex items-center space-x-2 px-4 py-2.5 rounded-xl bg-[#00d66c] hover:bg-[#00b85c] text-black font-extrabold text-xs transition-all shadow-lg shadow-[#00d66c]/20 active:scale-95 disabled:opacity-50 cursor-pointer"
                title="Advance match minutes and trigger simulated live events"
              >
                <Zap className={`w-4 h-4 ${isSimulating ? 'animate-spin' : ''}`} />
                <span>{isSimulating ? 'Advancing Clock...' : '⚡ Simulate Match Motion (Next Tick)'}</span>
              </button>
            </div>
          )}
        </div>

        {error && (
          <div className="mt-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs">
            {error}
          </div>
        )}
      </div>

      {!trackedParlay ? (
        /* Empty State / Quick Starter */
        <div className="bg-[#16181d] border border-[#252932] rounded-3xl p-8 text-center space-y-4 shadow-xl">
          <div className="w-16 h-16 rounded-full bg-[#1c1f26] border border-[#252932] flex items-center justify-center mx-auto text-[#00d66c]">
            <Play className="w-8 h-8 ml-1" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">No Parlay Currently Being Tracked</h3>
            <p className="text-xs text-[#8c92a4] max-w-md mx-auto mt-1">
              Select any generated parlay from the Parlay Builder, or start a live tracking session right now to watch minute-by-minute motion.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <button
              onClick={() => handleGenerateAndTrackDemo('SAME_GAME_PARLAY')}
              disabled={loading}
              className="px-5 py-2.5 rounded-xl bg-[#00d66c] hover:bg-[#00b85c] text-black font-extrabold text-xs transition-all shadow-md shadow-[#00d66c]/20 cursor-pointer"
            >
              {loading ? 'Generating...' : '🔥 Track Same-Game Parlay (SGP)'}
            </button>
            <button
              onClick={() => handleGenerateAndTrackDemo('ANTI_CORRELATED')}
              disabled={loading}
              className="px-5 py-2.5 rounded-xl bg-[#1c1f26] hover:bg-[#252932] text-white border border-[#252932] font-bold text-xs transition-all cursor-pointer"
            >
              🛡️ Track Standard 5-Leg Parlay
            </button>
          </div>
        </div>
      ) : (
        /* Tracked Parlay Active Display */
        <div className="space-y-6">
          {/* Main Metrics Card */}
          <div className="bg-[#16181d] border border-[#252932] rounded-3xl p-6 shadow-xl">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pb-6 border-b border-[#252932]">
              <div>
                <div className="text-[10px] text-[#8c92a4] uppercase font-bold tracking-wider">Parlay ID</div>
                <div className="text-sm font-mono font-bold text-white truncate">{trackedParlay.parlayId.substring(0, 16)}...</div>
              </div>
              <div>
                <div className="text-[10px] text-[#8c92a4] uppercase font-bold tracking-wider">Overall Status</div>
                <div className="text-sm font-black font-mono">
                  {trackedParlay.overallStatus === 'WON' ? (
                    <span className="text-[#00d66c]">PARLAY WON 🏆</span>
                  ) : trackedParlay.overallStatus === 'BUSTED' ? (
                    <span className="text-rose-400">BUSTED ❌</span>
                  ) : (
                    <span className="text-amber-300">ACTIVE IN PLAY ⚡</span>
                  )}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-[#8c92a4] uppercase font-bold tracking-wider">Legs Progress</div>
                <div className="text-sm font-black text-white font-mono">
                  <span className="text-[#00d66c]">{trackedParlay.legsHitCount} Hit</span>
                  <span className="text-[#8c92a4]"> / {trackedParlay.totalLegs} Total</span>
                  {trackedParlay.legsMissedCount > 0 && (
                    <span className="text-rose-400"> ({trackedParlay.legsMissedCount} Miss)</span>
                  )}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-[#8c92a4] uppercase font-bold tracking-wider">Cashout Equity Index</div>
                <div className="text-xl font-black text-[#00d66c] font-mono">
                  {(trackedParlay.cashoutProbabilityIndex * 100).toFixed(1)}%
                </div>
              </div>
            </div>

            {/* Cashout Index Visual Bar */}
            <div className="mt-4">
              <div className="flex items-center justify-between text-xs mb-1.5 font-bold">
                <span className="text-[#8c92a4]">Cashout Probability Momentum</span>
                <span className="text-white font-mono">{(trackedParlay.cashoutProbabilityIndex * 100).toFixed(1)}%</span>
              </div>
              <div className="w-full h-2.5 bg-[#1c1f26] rounded-full overflow-hidden border border-[#252932]">
                <div
                  className="h-full bg-gradient-to-r from-amber-500 via-[#00d66c] to-[#00ea77] transition-all duration-500 rounded-full"
                  style={{ width: `${Math.min(100, Math.max(5, trackedParlay.cashoutProbabilityIndex * 100))}%` }}
                />
              </div>
            </div>
          </div>

          {/* Leg-by-leg Motion Breakdown */}
          <div className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-xs font-bold text-[#8c92a4] uppercase tracking-wider">
                Live Legs Motion ({trackedParlay.liveLegs.length} Legs)
              </h3>
              <span className="text-xs text-[#8c92a4]">Last sync: {new Date(trackedParlay.lastUpdated).toLocaleTimeString()}</span>
            </div>

            <div className="grid grid-cols-1 gap-3">
              {trackedParlay.liveLegs.map((leg: LiveTrackedLeg, idx: number) => {
                const isHit = leg.liveStatus === 'HIT';
                const isMiss = leg.liveStatus === 'MISS';
                const isLive = leg.matchStatus === 'LIVE';

                return (
                  <div
                    key={`${leg.fixtureId}-${leg.market}-${idx}`}
                    className={`bg-[#16181d] border rounded-2xl p-4 sm:p-5 transition-all shadow-md ${
                      isHit
                        ? 'border-[#00d66c]/40 bg-[#16181d]'
                        : isMiss
                        ? 'border-rose-500/40'
                        : isLive
                        ? 'border-amber-500/30'
                        : 'border-[#252932]'
                    }`}
                  >
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                      {/* Left info */}
                      <div className="flex items-start space-x-3.5">
                        {/* Minute Pill */}
                        <div className="shrink-0 text-center">
                          {isLive ? (
                            <div className="px-2.5 py-1 rounded-lg bg-rose-500/20 border border-rose-500/40 text-rose-300 font-mono font-black text-xs animate-pulse">
                              {leg.currentMatchMinute ? `${leg.currentMatchMinute}'` : "LIVE"}
                            </div>
                          ) : leg.matchStatus === 'FINISHED' ? (
                            <div className="px-2.5 py-1 rounded-lg bg-[#252932] text-[#8c92a4] font-mono font-bold text-xs">
                              FT
                            </div>
                          ) : (
                            <div className="px-2.5 py-1 rounded-lg bg-[#1c1f26] text-white font-mono font-semibold text-xs border border-[#252932]">
                              {leg.kickoff ? new Date(leg.kickoff).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '15:00'}
                            </div>
                          )}
                          <div className="text-[10px] text-[#8c92a4] font-mono mt-1 font-bold">{leg.liveScore || '0-0'}</div>
                        </div>

                        {/* Match & Market Details */}
                        <div>
                          <div className="flex items-center space-x-2">
                            <span className="text-sm font-bold text-white">{leg.fixtureDescription}</span>
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#1c1f26] text-[#8c92a4] border border-[#252932]">
                              {leg.league}
                            </span>
                          </div>

                          <div className="text-sm font-extrabold text-[#00d66c] mt-0.5">
                            {leg.selection}
                          </div>

                          <div className="text-xs text-[#8c92a4] mt-1 flex items-center space-x-3">
                            <span>Target: <strong className="text-white">{leg.targetMetric}</strong></span>
                            {leg.liveStatValue && (
                              <span>Current: <strong className="text-[#00d66c]">{leg.liveStatValue}</strong></span>
                            )}
                          </div>

                          {leg.note && (
                            <div className="text-[11px] text-[#8c92a4] italic mt-1 bg-[#1c1f26]/60 px-2.5 py-1 rounded-lg border border-[#252932]/50 inline-block">
                              {leg.note}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Right: Status & Progress */}
                      <div className="flex md:flex-col items-end justify-between md:justify-center shrink-0 space-y-2 min-w-[140px]">
                        <div>{getStatusBadge(leg.liveStatus)}</div>

                        <div className="w-full md:w-36">
                          <div className="flex justify-between text-[10px] text-[#8c92a4] font-mono mb-1">
                            <span>Progress</span>
                            <span className="text-white font-bold">{Math.round(leg.progressPercent)}%</span>
                          </div>
                          <div className="h-2 w-full bg-[#1c1f26] rounded-full overflow-hidden border border-[#252932]">
                            <div
                              className={`h-full transition-all duration-500 rounded-full ${
                                isHit
                                  ? 'bg-[#00d66c]'
                                  : isMiss
                                  ? 'bg-rose-500'
                                  : 'bg-amber-400'
                              }`}
                              style={{ width: `${Math.min(100, Math.max(0, leg.progressPercent))}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
