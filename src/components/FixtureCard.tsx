import React from 'react';
import { Fixture } from '../types';
import { Clock, TrendingUp, AlertTriangle, ArrowRight, Shield } from 'lucide-react';

interface FixtureCardProps {
  fixture: Fixture;
  onSelect: (fixture: Fixture) => void;
}

export const FixtureCard: React.FC<FixtureCardProps> = ({ fixture, onSelect }) => {
  const hasInjuries = fixture.injuries && fixture.injuries.length > 0;
  const isFinished = fixture.status === 'FINISHED';
  const isLive = fixture.status === 'LIVE';

  const kickoffFormatted = fixture.kickoffTime
    ? new Date(fixture.kickoffTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : '15:00';

  // League badge configuration with World Cup & European colors
  const getLeagueBadge = () => {
    switch (fixture.league) {
      case 'EPL':
        return { label: 'Premier League', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', style: 'bg-purple-500/20 text-purple-300 border-purple-500/30' };
      case 'CHAMPIONSHIP':
        return { label: 'Championship', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', style: 'bg-sky-500/20 text-sky-300 border-sky-500/30' };
      case 'LALIGA':
        return { label: 'La Liga', flag: '🇪🇸', style: 'bg-amber-500/20 text-amber-300 border-amber-500/30' };
      case 'LIGUE1':
        return { label: 'Ligue 1', flag: '🇫🇷', style: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' };
      case 'CHAMPIONS_LEAGUE':
        return { label: 'Champions League', flag: '🏆', style: 'bg-gradient-to-r from-blue-600/30 to-indigo-600/30 text-indigo-200 border-indigo-400/40' };
      case 'EUROPA_LEAGUE':
        return { label: 'Europa League', flag: '🏆', style: 'bg-orange-500/20 text-orange-300 border-orange-500/30' };
      case 'CONFERENCE_LEAGUE':
        return { label: 'Conference League', flag: '🏆', style: 'bg-teal-500/20 text-teal-300 border-teal-500/30' };
      default:
        return { label: fixture.league, flag: '⚽', style: 'bg-slate-800 text-slate-300 border-slate-700' };
    }
  };

  const badge = getLeagueBadge();

  return (
    <div
      className={`relative overflow-hidden rounded-3xl backdrop-blur-md bg-gradient-to-b from-slate-900/90 via-slate-900/70 to-slate-950/90 border p-5 sm:p-6 transition-all duration-300 hover:shadow-2xl hover:-translate-y-1 group flex flex-col justify-between ${
        isLive
          ? 'border-rose-500/60 shadow-rose-950/30'
          : 'border-white/10 hover:border-amber-400/40 hover:shadow-amber-500/5'
      }`}
    >
      {/* Subtle World Cup glow overlay */}
      <div className="absolute top-0 right-0 -mr-12 -mt-12 w-32 h-32 rounded-full bg-gradient-to-br from-amber-500/10 to-transparent blur-2xl pointer-events-none group-hover:from-amber-400/20 transition-all duration-500" />

      <div>
        {/* Header: Competition Badge & Status */}
        <div className="flex items-center justify-between text-xs mb-4 relative z-10">
          <div className="flex items-center space-x-2">
            <span
              className={`inline-flex items-center space-x-1.5 px-3 py-1 rounded-full font-bold text-[11px] tracking-wide border shadow-sm ${badge.style}`}
            >
              <span>{badge.flag}</span>
              <span>{badge.label}</span>
            </span>
          </div>

          <div className="flex items-center space-x-1.5 font-mono text-xs">
            {isLive ? (
              <span className="flex items-center space-x-1.5 px-3 py-1 rounded-full bg-rose-500/25 border border-rose-500/40 text-rose-300 font-extrabold text-[11px] animate-pulse">
                <span className="h-2 w-2 rounded-full bg-rose-500" />
                <span>LIVE</span>
              </span>
            ) : isFinished ? (
              <span className="text-slate-400 font-bold px-2.5 py-0.5 rounded-full bg-slate-800/80 text-[11px]">
                FT
              </span>
            ) : (
              <div className="flex items-center space-x-1.5 text-slate-300 bg-slate-950/60 px-3 py-1 rounded-full border border-white/5">
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                <span className="font-semibold">{kickoffFormatted}</span>
              </div>
            )}
          </div>
        </div>

        {/* Teams & Scores Showcase */}
        <div className="space-y-3.5 my-4">
          {/* Home Team */}
          <div className="flex items-center justify-between p-2 rounded-2xl bg-slate-950/40 border border-white/5 group-hover:border-white/10 transition-colors">
            <div className="flex items-center space-x-3 truncate">
              <img
                src={fixture.homeTeam.logo}
                alt={fixture.homeTeam.name}
                className="w-8 h-8 object-contain shrink-0 rounded-full p-0.5 bg-slate-900 border border-white/10"
                onError={e => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
              <span className="font-bold text-sm sm:text-base text-white group-hover:text-amber-200 transition-colors truncate">
                {fixture.homeTeam.name}
              </span>
            </div>

            {isFinished || isLive ? (
              <span
                className={`font-mono text-lg font-black px-3 py-0.5 rounded-xl shrink-0 ${
                  isLive
                    ? 'bg-rose-500/30 text-rose-300 border border-rose-500/40'
                    : 'bg-slate-800 text-white'
                }`}
              >
                {fixture.homeScore ?? 0}
              </span>
            ) : fixture.expectedHomeGoals !== null && fixture.expectedHomeGoals !== undefined ? (
              <span className="text-[11px] text-amber-300/90 font-mono font-bold bg-amber-500/10 px-2.5 py-1 rounded-xl border border-amber-500/20 shrink-0">
                xG {fixture.expectedHomeGoals}
              </span>
            ) : null}
          </div>

          {/* Away Team */}
          <div className="flex items-center justify-between p-2 rounded-2xl bg-slate-950/40 border border-white/5 group-hover:border-white/10 transition-colors">
            <div className="flex items-center space-x-3 truncate">
              <img
                src={fixture.awayTeam.logo}
                alt={fixture.awayTeam.name}
                className="w-8 h-8 object-contain shrink-0 rounded-full p-0.5 bg-slate-900 border border-white/10"
                onError={e => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
              <span className="font-bold text-sm sm:text-base text-white group-hover:text-amber-200 transition-colors truncate">
                {fixture.awayTeam.name}
              </span>
            </div>

            {isFinished || isLive ? (
              <span
                className={`font-mono text-lg font-black px-3 py-0.5 rounded-xl shrink-0 ${
                  isLive
                    ? 'bg-rose-500/30 text-rose-300 border border-rose-500/40'
                    : 'bg-slate-800 text-white'
                }`}
              >
                {fixture.awayScore ?? 0}
              </span>
            ) : fixture.expectedAwayGoals !== null && fixture.expectedAwayGoals !== undefined ? (
              <span className="text-[11px] text-amber-300/90 font-mono font-bold bg-amber-500/10 px-2.5 py-1 rounded-xl border border-amber-500/20 shrink-0">
                xG {fixture.expectedAwayGoals}
              </span>
            ) : null}
          </div>
        </div>

        {/* Stadium & Meta */}
        <div className="text-[11px] text-slate-400 mb-4 truncate flex items-center space-x-1.5">
          <Shield className="w-3.5 h-3.5 text-amber-400/80 shrink-0" />
          <span className="truncate">{fixture.venue || fixture.homeTeam.stadium}</span>
        </div>

        {/* Top Statistical Model Pick Pill */}
        {fixture.topPrediction && (
          <div className="rounded-2xl p-3 mb-4 bg-gradient-to-r from-amber-500/10 via-slate-900 to-amber-500/5 border border-amber-500/25">
            <div className="flex items-center justify-between text-[11px] mb-1">
              <span className="text-amber-300 font-bold flex items-center space-x-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-amber-400" />
                <span>Calibrated Prediction</span>
              </span>
              <span className="font-mono font-extrabold text-amber-300 bg-amber-500/20 px-2 py-0.5 rounded-full border border-amber-500/30">
                {(fixture.topPrediction.estimatedProbability * 100).toFixed(1)}%
              </span>
            </div>
            <div className="text-xs font-extrabold text-white truncate">
              {fixture.topPrediction.selection}
            </div>
          </div>
        )}

        {/* Missing Players Notice */}
        {hasInjuries && (
          <div className="flex items-center space-x-2 text-[11px] text-amber-300 bg-amber-500/15 px-3 py-1.5 rounded-2xl border border-amber-500/30 mb-4">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-400" />
            <span className="truncate font-medium">{fixture.injuries!.length} player absences reported</span>
          </div>
        )}
      </div>

      {/* Action CTA Button */}
      <button
        onClick={() => onSelect(fixture)}
        className="w-full flex items-center justify-center space-x-2 py-2.5 px-4 rounded-2xl bg-gradient-to-r from-slate-800 to-slate-800/80 hover:from-amber-500 hover:to-yellow-500 text-slate-200 hover:text-slate-950 text-xs font-bold transition-all duration-200 shadow-md active:scale-98"
      >
        <span>Detailed Match Intelligence</span>
        <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
      </button>
    </div>
  );
};
