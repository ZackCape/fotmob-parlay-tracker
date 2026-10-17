import React from 'react';
import { Fixture } from '../types';
import { Clock, TrendingUp, AlertTriangle, ChevronRight, Zap } from 'lucide-react';

interface CapeMatchRowProps {
  fixture: Fixture;
  onSelect: (fixture: Fixture) => void;
}

export const CapeMatchRow: React.FC<CapeMatchRowProps> = ({ fixture, onSelect }) => {
  const isLive = fixture.status === 'LIVE';
  const isFinished = fixture.status === 'FINISHED';

  const kickoff = fixture.kickoffTime
    ? new Date(fixture.kickoffTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : '15:00';

  const hasInjuries = fixture.injuries && fixture.injuries.length > 0;

  return (
    <div
      onClick={() => onSelect(fixture)}
      className="group flex flex-col sm:flex-row sm:items-center justify-between p-3.5 hover:bg-[#1c1f26] transition-colors border-b border-[#252932]/70 last:border-b-0 cursor-pointer"
    >
      {/* Time / Status Column */}
      <div className="flex items-center sm:w-24 shrink-0 space-x-2 mb-2 sm:mb-0">
        {isLive ? (
          <span className="flex items-center space-x-1.5 px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-400 font-mono font-bold text-[11px]">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
            <span>LIVE</span>
          </span>
        ) : isFinished ? (
          <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-mono font-bold text-[11px]">
            FT
          </span>
        ) : (
          <span className="text-white font-mono font-semibold text-xs flex items-center space-x-1">
            <Clock className="w-3 h-3 text-[#8c92a4]" />
            <span>{kickoff}</span>
          </span>
        )}
        {fixture.fallbackReason && (
          <span className="text-[9px] text-amber-400/80 font-mono" title={fixture.fallbackReason}>
            fallback
          </span>
        )}
        {/archive|calendar|historical|offline/i.test(fixture.dataSource || '') && (
          <span className="text-[9px] text-amber-400/90 font-mono px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20" title={fixture.dataSource}>
            OFFLINE DATA
          </span>
        )}
      </div>

      {/* Match Teams & Score Column */}
      <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-4 my-1 sm:my-0">
        {/* Home Team */}
        <div className="flex items-center justify-between sm:justify-start space-x-2.5">
          <div className="flex items-center space-x-2.5 truncate">
            <img
              src={fixture.homeTeam.logo}
              alt={fixture.homeTeam.name}
              className="w-5 h-5 object-contain shrink-0"
              onError={e => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
            <span className="text-xs sm:text-sm font-semibold text-white group-hover:text-[#00d66c] transition-colors truncate">
              {fixture.homeTeam.name}
            </span>
          </div>
          <span className="font-mono font-black text-sm text-white px-2">
            {fixture.homeScore !== null ? fixture.homeScore : '-'}
          </span>
        </div>

        {/* Away Team */}
        <div className="flex items-center justify-between sm:justify-start space-x-2.5">
          <div className="flex items-center space-x-2.5 truncate">
            <img
              src={fixture.awayTeam.logo}
              alt={fixture.awayTeam.name}
              className="w-5 h-5 object-contain shrink-0"
              onError={e => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
            <span className="text-xs sm:text-sm font-semibold text-white group-hover:text-[#00d66c] transition-colors truncate">
              {fixture.awayTeam.name}
            </span>
          </div>
          <span className="font-mono font-black text-sm text-white px-2">
            {fixture.awayScore !== null ? fixture.awayScore : '-'}
          </span>
        </div>
      </div>

      {/* Prediction & Action Column */}
      <div className="flex items-center justify-between sm:justify-end space-x-3 shrink-0 pt-2 sm:pt-0">
        {fixture.topPrediction && (
          <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-[#1c1f26] border border-[#252932] group-hover:border-[#00d66c]/40 transition-colors">
            <TrendingUp className="w-3 h-3 text-[#00d66c]" />
            <span className="text-[11px] font-bold text-[#00d66c] truncate max-w-[140px]">
              {fixture.topPrediction.selection}
            </span>
            <span className="text-[11px] font-mono font-black text-white ml-1">
              {(fixture.topPrediction.estimatedProbability * 100).toFixed(0)}%
            </span>
          </div>
        )}

        {hasInjuries && (
          <span
            className="text-amber-400 text-xs"
            title={`${fixture.injuries?.length} key player injuries reported`}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
          </span>
        )}

        <button
          onClick={(e) => {
            e.stopPropagation();
            onSelect(fixture);
          }}
          className="text-xs font-bold text-[#8c92a4] group-hover:text-white px-2.5 py-1 rounded-lg hover:bg-[#252932] flex items-center space-x-1 transition-colors"
        >
          <span>Analysis</span>
          <ChevronRight className="w-3.5 h-3.5 text-[#00d66c]" />
        </button>
      </div>
    </div>
  );
};
