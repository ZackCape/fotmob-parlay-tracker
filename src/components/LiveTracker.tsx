import React, { useState, useEffect, useRef } from 'react';
import {
  liveStreamClient,
  LiveStreamEvent,
} from '../services/liveStreamClient';
import {
  Activity,
  Zap,
  Radio,
  Flame,
  AlertTriangle,
  Clock,
  ShieldAlert,
  CheckCircle,
  TrendingUp,
  X,
  Volume2,
} from 'lucide-react';

interface TimelineItem {
  id: string;
  minute: number | string;
  type: string;
  team?: string;
  detail: string;
  timestamp: number;
}

interface MatchTrackState {
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  minute: number;
  status: string;
  homeScore: number;
  awayScore: number;
  momentum: number;
  momentumHistory: Array<{ minute: number; score: number }>;
  pressureSqueezeActive: boolean;
  pressureAlert?: {
    dominantTeam: 'home' | 'away';
    momentumScore: number;
    recommendedMarkets: string[];
    urgency: 'HIGH' | 'EXTREME';
    reason: string;
  };
  inPlayOdds?: {
    market: string;
    takenOdds: number;
    liveOdds: number;
    iClvPercent: number;
  };
  timeline: TimelineItem[];
}

export const LiveTracker: React.FC = () => {
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [matches, setMatches] = useState<MatchTrackState[]>([]);
  const [selectedFixtureId, setSelectedFixtureId] = useState<string>('');
  const [toast, setToast] = useState<LiveStreamEvent | null>(null);
  const toastTimeoutRef = useRef<any>(null);

  // Subscribe to live SSE events and connection status
  useEffect(() => {
    const unsubStatus = liveStreamClient.onStatusChange((connected) => {
      setIsConnected(connected);
    });

    const unsubEvents = liveStreamClient.subscribe((event) => {
      handleIncomingLiveEvent(event);
    });

    // Initial fetch of active matches
    liveStreamClient.fetchLiveMatches().then((activeList) => {
      if (Array.isArray(activeList) && activeList.length > 0) {
        const formatted: MatchTrackState[] = activeList.map((m: any) => ({
          fixtureId: m.fixtureId,
          homeTeam: m.homeTeam,
          awayTeam: m.awayTeam,
          minute: m.minute || 45,
          status: m.status || 'LIVE',
          homeScore: m.stats?.homeScore ?? 0,
          awayScore: m.stats?.awayScore ?? 0,
          momentum: m.momentum || 0,
          momentumHistory: m.momentumHistory || [],
          pressureSqueezeActive: m.pressureSqueezeActive || false,
          pressureAlert: m.activePressureAlert,
          inPlayOdds: m.inPlayOdds,
          timeline: m.timeline || [],
        }));
        setMatches(formatted);
        if (formatted[0]) {
          setSelectedFixtureId(formatted[0].fixtureId);
        }
      }
    });

    return () => {
      unsubStatus();
      unsubEvents();
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    };
  }, []);

  const handleIncomingLiveEvent = (event: LiveStreamEvent) => {
    // Show non-intrusive live toast
    setToast(event);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => {
      setToast(null);
    }, 4500);

    // Update match state in memory
    setMatches((prevMatches) => {
      const idx = prevMatches.findIndex((m) => m.fixtureId === event.fixtureId);
      if (idx >= 0) {
        const current = prevMatches[idx];
        const updatedHistory = event.momentumHistory || [
          ...current.momentumHistory,
          { minute: Number(event.minute) || current.minute, score: event.momentum ?? current.momentum },
        ];

        const updatedTimeline = [...current.timeline];
        if (event.timelineEntry) {
          updatedTimeline.push({
            id: event.timelineEntry.id,
            minute: event.timelineEntry.minute,
            type: event.timelineEntry.type,
            team: event.timelineEntry.team,
            detail: event.timelineEntry.detail,
            timestamp: Date.now(),
          });
        }

        const updated: MatchTrackState = {
          ...current,
          minute: Number(event.minute) || current.minute,
          homeScore: event.homeScore !== null ? event.homeScore : current.homeScore,
          awayScore: event.awayScore !== null ? event.awayScore : current.awayScore,
          momentum: event.momentum !== undefined ? event.momentum : current.momentum,
          momentumHistory: updatedHistory.slice(-25),
          pressureSqueezeActive: event.type === 'PRESSURE_SQUEEZE' || (event.pressureSqueeze ? true : current.pressureSqueezeActive),
          pressureAlert: event.pressureSqueeze || current.pressureAlert,
          inPlayOdds: event.inPlayOdds || current.inPlayOdds,
          timeline: updatedTimeline,
        };

        const copy = [...prevMatches];
        copy[idx] = updated;
        return copy;
      } else {
        // New match event
        const newMatch: MatchTrackState = {
          fixtureId: event.fixtureId,
          homeTeam: event.homeTeam,
          awayTeam: event.awayTeam,
          minute: Number(event.minute) || 1,
          status: 'LIVE',
          homeScore: event.homeScore || 0,
          awayScore: event.awayScore || 0,
          momentum: event.momentum || 0,
          momentumHistory: event.momentumHistory || [{ minute: Number(event.minute) || 1, score: event.momentum || 0 }],
          pressureSqueezeActive: event.type === 'PRESSURE_SQUEEZE',
          pressureAlert: event.pressureSqueeze,
          inPlayOdds: event.inPlayOdds,
          timeline: event.timelineEntry ? [{
            id: event.timelineEntry.id,
            minute: event.timelineEntry.minute,
            type: event.timelineEntry.type,
            team: event.timelineEntry.team,
            detail: event.timelineEntry.detail,
            timestamp: Date.now(),
          }] : [],
        };
        if (!selectedFixtureId) setSelectedFixtureId(newMatch.fixtureId);
        return [...prevMatches, newMatch];
      }
    });
  };

  const selectedMatch =
    matches.find((m) => m.fixtureId === selectedFixtureId) ||
    matches[0] || {
      fixtureId: 'demo-match-1',
      homeTeam: 'Arsenal',
      awayTeam: 'Chelsea',
      minute: 82,
      status: 'LIVE',
      homeScore: 1,
      awayScore: 1,
      momentum: 68,
      momentumHistory: [
        { minute: 60, score: 10 },
        { minute: 65, score: 25 },
        { minute: 70, score: 15 },
        { minute: 75, score: 45 },
        { minute: 78, score: 62 },
        { minute: 82, score: 68 },
      ],
      pressureSqueezeActive: true,
      pressureAlert: {
        dominantTeam: 'home' as const,
        momentumScore: 68,
        recommendedMarkets: ['OVER_2_5_GOALS', 'NEXT_GOAL_HOME', 'NEXT_CORNER_HOME'],
        urgency: 'HIGH' as const,
        reason: 'Arsenal applying late-game siege (+68 momentum) at 82\'. Heavy shot & corner surge in final 15 minutes.',
      },
      inPlayOdds: {
        market: 'Match Winner (Arsenal)',
        takenOdds: 2.30,
        liveOdds: 1.65,
        iClvPercent: 39.39,
      },
      timeline: [
        { id: 't1', minute: 23, type: 'GOAL', team: 'away', detail: 'Chelsea goal (N. Jackson)', timestamp: 1 },
        { id: 't2', minute: 45, type: 'HT', detail: 'Halftime whistle (0 - 1)', timestamp: 2 },
        { id: 't3', minute: 58, type: 'GOAL', team: 'home', detail: 'Arsenal goal (B. Saka)', timestamp: 3 },
        { id: 't4', minute: 71, type: 'RED_CARD', team: 'away', detail: 'Red Card shown to Chelsea defender', timestamp: 4 },
        { id: 't5', minute: 79, type: 'PRESSURE_SQUEEZE', team: 'home', detail: 'The Pressure Squeeze detected (Arsenal 75\'+ siege)', timestamp: 5 },
      ],
    };

  // Helper for rendering SVG waveform
  const renderWaveform = (history: Array<{ minute: number; score: number }>) => {
    if (!history || history.length === 0) {
      return (
        <div className="flex items-center justify-center h-32 text-slate-500 text-xs">
          Awaiting live in-play momentum data...
        </div>
      );
    }

    const width = 600;
    const height = 120;
    const midY = height / 2;

    const points = history.map((pt, idx) => {
      const x = (idx / Math.max(1, history.length - 1)) * width;
      // Invert score: positive momentum goes up (towards 0), negative goes down (towards height)
      const y = midY - (pt.score / 100) * (height / 2 - 10);
      return `${x},${y}`;
    });

    const pathD = `M 0,${midY} L ${points.join(' L ')} L ${width},${midY}`;

    return (
      <div className="relative w-full h-36 bg-slate-950/80 rounded-xl p-3 border border-slate-800 overflow-hidden">
        <div className="absolute top-2 left-3 flex items-center space-x-2 text-[10px] text-blue-400 font-bold uppercase tracking-wider">
          <TrendingUp className="w-3 h-3 text-blue-400" />
          <span>Home Advantage (+100)</span>
        </div>
        <div className="absolute bottom-2 left-3 flex items-center space-x-2 text-[10px] text-emerald-400 font-bold uppercase tracking-wider">
          <TrendingUp className="w-3 h-3 text-emerald-400 rotate-180" />
          <span>Away Advantage (-100)</span>
        </div>

        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full" preserveAspectRatio="none">
          {/* Neutral Centerline */}
          <line x1="0" y1={midY} x2={width} y2={midY} stroke="#334155" strokeDasharray="4 4" strokeWidth="1" />

          {/* Area fill */}
          <path d={pathD} fill="url(#momentumGradient)" opacity="0.35" />

          {/* Wave line */}
          <path
            d={`M ${points.join(' L ')}`}
            fill="none"
            stroke={selectedMatch.momentum >= 0 ? '#3b82f6' : '#10b981'}
            strokeWidth="2.5"
            strokeLinecap="round"
          />

          {/* Gradients */}
          <defs>
            <linearGradient id="momentumGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.8" />
              <stop offset="50%" stopColor="#64748b" stopOpacity="0.1" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0.8" />
            </linearGradient>
          </defs>
        </svg>

        {/* Current score badge */}
        <div
          className={`absolute top-2 right-3 px-2 py-0.5 rounded text-xs font-black border ${
            selectedMatch.momentum > 0
              ? 'bg-blue-500/20 text-blue-300 border-blue-500/40'
              : selectedMatch.momentum < 0
              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
              : 'bg-slate-700/50 text-slate-300 border-slate-600'
          }`}
        >
          {selectedMatch.momentum > 0
            ? `+${selectedMatch.momentum} Home Pressure`
            : selectedMatch.momentum < 0
            ? `${selectedMatch.momentum} Away Pressure`
            : '0 Balanced'}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Top Status Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4 shadow-xl">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 rounded-xl bg-blue-600/10 border border-blue-500/20 text-blue-400">
            <Radio className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-base font-black text-white uppercase tracking-wider">Live Command Center</h2>
              <span className="px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30 text-[10px] font-bold">
                SUB-SECOND SSE
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Live momentum waveforms, in-play CLV shifts, and final-15min Pressure Squeeze radar.
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2 text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800">
            <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
            <span className={isConnected ? 'text-emerald-400' : 'text-rose-400'}>
              {isConnected ? 'Stream Active' : 'Connecting...'}
            </span>
          </div>

          {/* Fixture Selector if multiple matches */}
          {matches.length > 1 && (
            <select
              value={selectedFixtureId}
              onChange={(e) => setSelectedFixtureId(e.target.value)}
              className="bg-slate-950 border border-slate-700 text-white text-xs rounded-lg px-3 py-1.5 font-semibold focus:outline-none focus:border-blue-500"
            >
              {matches.map((m) => (
                <option key={m.fixtureId} value={m.fixtureId}>
                  {m.homeTeam} vs {m.awayTeam} ({m.minute}&apos;)
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Main Grid: Active Match Radar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Momentum Waveform & Pressure Alert */}
        <div className="lg:col-span-2 space-y-6">
          {/* Active Match Header Card */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl relative overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-4">
              <div className="flex items-center space-x-2">
                <Clock className="w-4 h-4 text-slate-400" />
                <span className="text-xs font-bold text-slate-300">
                  Match Minute: <span className="text-white font-mono">{selectedMatch.minute}&apos;</span>
                </span>
                <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-[10px] font-bold">
                  {selectedMatch.status}
                </span>
              </div>
              <div className="text-xs text-slate-400 font-medium">Cape Predictor In-Play Engine</div>
            </div>

            {/* Scoreboard */}
            <div className="flex items-center justify-between px-4 py-2">
              <div className="text-center w-1/3">
                <div className="text-base sm:text-lg font-black text-white truncate">{selectedMatch.homeTeam}</div>
                <div className="text-[11px] text-slate-400 font-semibold">Home</div>
              </div>

              <div className="w-1/3 flex flex-col items-center justify-center">
                <div className="text-2xl sm:text-3xl font-black text-white tracking-widest font-mono">
                  {selectedMatch.homeScore} - {selectedMatch.awayScore}
                </div>
              </div>

              <div className="text-center w-1/3">
                <div className="text-base sm:text-lg font-black text-white truncate">{selectedMatch.awayTeam}</div>
                <div className="text-[11px] text-slate-400 font-semibold">Away</div>
              </div>
            </div>

            {/* Momentum Waveform */}
            <div className="mt-5 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-300 flex items-center space-x-1.5">
                  <Activity className="w-3.5 h-3.5 text-blue-400" />
                  <span>Real-Time Momentum Swing Waveform</span>
                </span>
                <span className="text-[11px] text-slate-400">Rolling 25-pt decay</span>
              </div>
              {renderWaveform(selectedMatch.momentumHistory)}
            </div>

            {/* In-Play CLV (iCLV) Card */}
            {selectedMatch.inPlayOdds && (
              <div className="mt-5 p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between text-xs">
                <div>
                  <div className="text-slate-400 text-[11px]">Tracked Market Position</div>
                  <div className="font-bold text-white">{selectedMatch.inPlayOdds.market}</div>
                </div>
                <div className="flex items-center space-x-4">
                  <div className="text-right">
                    <div className="text-slate-400 text-[10px]">Taken Odds / Live</div>
                    <div className="font-mono text-white font-bold">
                      {selectedMatch.inPlayOdds.takenOdds.toFixed(2)}x → {selectedMatch.inPlayOdds.liveOdds.toFixed(2)}x
                    </div>
                  </div>
                  <div
                    className={`px-2.5 py-1 rounded-lg font-bold font-mono ${
                      selectedMatch.inPlayOdds.iClvPercent >= 0
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                    }`}
                  >
                    iCLV: {selectedMatch.inPlayOdds.iClvPercent >= 0 ? '+' : ''}
                    {selectedMatch.inPlayOdds.iClvPercent.toFixed(1)}%
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Late-Game Pressure Squeeze Banner */}
          {selectedMatch.pressureSqueezeActive && selectedMatch.pressureAlert && (
            <div className="bg-gradient-to-r from-amber-500/20 via-orange-500/15 to-amber-500/20 border-2 border-amber-500/50 rounded-2xl p-5 shadow-2xl animate-pulse">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center space-x-3">
                  <div className="p-3 rounded-xl bg-amber-500 text-slate-950 shadow-lg">
                    <Flame className="w-6 h-6 animate-bounce" />
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="text-sm font-black text-amber-300 uppercase tracking-wider">
                        Late-Game Pressure Squeeze Radar
                      </span>
                      <span className="px-2 py-0.5 rounded bg-amber-400 text-slate-950 text-[10px] font-black uppercase">
                        {selectedMatch.pressureAlert.urgency} INTENSITY
                      </span>
                    </div>
                    <p className="text-xs text-amber-100/90 mt-1">{selectedMatch.pressureAlert.reason}</p>
                  </div>
                </div>
              </div>

              {/* Actionable Market Recommendations */}
              <div className="mt-4 pt-3 border-t border-amber-500/30 flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-bold text-amber-200">Recommended Markets:</span>
                {selectedMatch.pressureAlert.recommendedMarkets.map((mkt) => (
                  <span
                    key={mkt}
                    className="px-2.5 py-1 rounded-lg bg-amber-400/20 text-amber-200 border border-amber-400/40 text-xs font-mono font-bold"
                  >
                    ⚡ {mkt.replace(/_/g, ' ')}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Col: Chronological Incident Timeline */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col h-full">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
            <div className="flex items-center space-x-2">
              <Zap className="w-4 h-4 text-blue-400" />
              <h3 className="text-sm font-black text-white uppercase tracking-wider">Incident Timeline</h3>
            </div>
            <span className="text-[10px] text-slate-400 font-semibold">{selectedMatch.timeline.length} events</span>
          </div>

          <div className="flex-1 overflow-y-auto space-y-3 pr-1 max-h-[500px]">
            {selectedMatch.timeline.length === 0 ? (
              <div className="text-center py-12 text-slate-500 text-xs">
                No match incidents recorded yet. Live micro-loop is listening for goals, cards & VAR reviews.
              </div>
            ) : (
              selectedMatch.timeline.map((item) => {
                const isVAR = item.type === 'VAR_ROLLBACK' || item.type === 'DISALLOWED_GOAL';
                const isGoal = item.type === 'GOAL';
                const isRed = item.type === 'RED_CARD';
                const isPressure = item.type === 'PRESSURE_SQUEEZE';

                return (
                  <div
                    key={item.id}
                    className={`p-3 rounded-xl border transition-all ${
                      isVAR
                        ? 'bg-rose-500/15 border-rose-500/40 text-rose-200'
                        : isGoal
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                        : isRed
                        ? 'bg-rose-600/10 border-rose-600/30 text-rose-300'
                        : isPressure
                        ? 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                        : 'bg-slate-950 border-slate-800 text-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-mono font-bold">{item.minute}&apos;</span>
                      <span
                        className={`text-[10px] font-black uppercase px-1.5 py-0.5 rounded ${
                          isVAR
                            ? 'bg-rose-500 text-white'
                            : isGoal
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : isRed
                            ? 'bg-rose-500/20 text-rose-400'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {item.type.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <div className="text-xs font-semibold leading-snug">{item.detail}</div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Floating Live Event Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 max-w-sm bg-slate-900 border-2 border-blue-500 rounded-2xl p-4 shadow-2xl z-50 animate-bounce">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center space-x-2.5">
              <div className="p-2 rounded-lg bg-blue-500 text-white">
                <Volume2 className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-black text-blue-400 uppercase tracking-wider">
                  Live Event: {toast.type}
                </div>
                <div className="text-xs font-bold text-white mt-0.5">
                  {toast.homeTeam} vs {toast.awayTeam} ({toast.minute}&apos;)
                </div>
                <div className="text-[11px] text-slate-300 mt-1">{toast.detail}</div>
              </div>
            </div>
            <button
              onClick={() => setToast(null)}
              className="text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
