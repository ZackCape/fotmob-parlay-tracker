import React from 'react';
import { League } from '../types';
import { Trophy, Flame, Zap, Shield } from 'lucide-react';

interface TopLeaguesSidebarProps {
  selectedLeague: string;
  onSelectLeague: (league: string) => void;
  leagueMatchCounts: Record<string, number>;
  liveMatchCount: number;
  onFilterLiveOnly?: () => void;
  filterLiveOnly?: boolean;
}

export const TopLeaguesSidebar: React.FC<TopLeaguesSidebarProps> = ({
  selectedLeague,
  onSelectLeague,
  leagueMatchCounts,
  liveMatchCount,
  onFilterLiveOnly,
  filterLiveOnly,
}) => {
  const topLeagues: Array<{ id: string; name: string; country: string; flag: string }> = [
    { id: 'ALL', name: 'All Matches', country: 'Global', flag: '🌍' },
    { id: 'EPL', name: 'Premier League', country: 'England', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿' },
    { id: 'CHAMPIONS_LEAGUE', name: 'Champions League', country: 'Europe', flag: '⭐️' },
    { id: 'LALIGA', name: 'LaLiga', country: 'Spain', flag: '🇪🇸' },
    { id: 'LIGUE1', name: 'Ligue 1', country: 'France', flag: '🇫🇷' },
    { id: 'BUNDESLIGA', name: 'Bundesliga', country: 'Germany', flag: '🇩🇪' },
    { id: 'BUNDESLIGA2', name: 'Bundesliga 2', country: 'Germany', flag: '🇩🇪' },
    { id: 'EUROPA_LEAGUE', name: 'Europa League', country: 'Europe', flag: '🏆' },
    { id: 'CONFERENCE_LEAGUE', name: 'Conference League', country: 'Europe', flag: '🛡️' },
    { id: 'CHAMPIONSHIP', name: 'Championship', country: 'England', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿' },
  ];

  return (
    <aside className="w-full lg:w-64 shrink-0 space-y-4">
      {/* Top Leagues Card */}
      <div className="bg-[#16181d] border border-[#252932] rounded-2xl p-3 shadow-lg">
        <div className="px-3 py-2 text-xs font-bold text-[#8c92a4] uppercase tracking-wider flex items-center justify-between">
          <span>Top leagues</span>
          <Trophy className="w-3.5 h-3.5 text-[#00d66c]" />
        </div>

        <nav className="space-y-1 mt-1">
          {topLeagues.map(league => {
            const isSelected = selectedLeague === league.id && !filterLiveOnly;
            const count = league.id === 'ALL'
              ? Object.values(leagueMatchCounts).reduce((a, b) => a + b, 0)
              : (leagueMatchCounts[league.id] || 0);

            return (
              <button
                key={league.id}
                onClick={() => onSelectLeague(league.id)}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition-all group ${
                  isSelected
                    ? 'bg-[#1c1f26] text-white border-l-4 border-[#00d66c] shadow-sm'
                    : 'text-[#8c92a4] hover:text-white hover:bg-[#1c1f26]/60'
                }`}
              >
                <div className="flex items-center space-x-2.5 truncate">
                  <span className="text-sm shrink-0">{league.flag}</span>
                  <div className="text-left truncate">
                    <div className="truncate font-medium text-white group-hover:text-[#00d66c] transition-colors">
                      {league.name}
                    </div>
                    {league.id !== 'ALL' && (
                      <div className="text-[10px] text-[#8c92a4]">{league.country}</div>
                    )}
                  </div>
                </div>

                {count > 0 && (
                  <span
                    className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded-full ${
                      isSelected
                        ? 'bg-[#00d66c]/20 text-[#00d66c]'
                        : 'bg-[#252932] text-[#8c92a4] group-hover:text-white'
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Quick Filters */}
      <div className="bg-[#16181d] border border-[#252932] rounded-2xl p-3 shadow-lg">
        <div className="px-3 py-2 text-xs font-bold text-[#8c92a4] uppercase tracking-wider">
          Quick filters
        </div>

        <div className="space-y-1 mt-1">
          <button
            onClick={onFilterLiveOnly}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all ${
              filterLiveOnly
                ? 'bg-rose-500/20 text-rose-300 border-l-4 border-rose-500'
                : 'text-[#8c92a4] hover:text-white hover:bg-[#1c1f26]/60'
            }`}
          >
            <div className="flex items-center space-x-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
              </span>
              <span>Live Matches Now</span>
            </div>
            {liveMatchCount > 0 && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 font-mono">
                {liveMatchCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* European Integrity Badge */}
      <div className="bg-gradient-to-br from-[#16181d] to-[#1c1f26] border border-[#252932] rounded-2xl p-4 text-xs text-[#8c92a4]">
        <div className="flex items-center space-x-2 text-white font-bold mb-1">
          <Shield className="w-4 h-4 text-[#00d66c]" />
          <span>Fast Sync</span>
        </div>
        <p className="text-[11px] leading-relaxed">
          Poisson & Dixon-Coles model recalibrated across 7 top leagues with live match state tracking.
        </p>
      </div>
    </aside>
  );
};
