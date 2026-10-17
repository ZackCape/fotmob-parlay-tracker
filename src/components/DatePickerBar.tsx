import React from 'react';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, RefreshCw, Radio } from 'lucide-react';

interface DatePickerBarProps {
  selectedDate: string;
  onDateChange: (date: string) => void;
  selectedLeague: string;
  onLeagueChange: (league: string) => void;
  matchCount: number;
  isLivePolling: boolean;
  onToggleLivePolling: () => void;
  onManualRefresh: () => void;
  isRefreshing: boolean;
  lastSyncedTime: string;
}

export const DatePickerBar: React.FC<DatePickerBarProps> = ({
  selectedDate,
  onDateChange,
  matchCount,
  isLivePolling,
  onToggleLivePolling,
  onManualRefresh,
  isRefreshing,
  lastSyncedTime,
}) => {
  const shiftDay = (days: number) => {
    const current = new Date(selectedDate);
    current.setUTCDate(current.getUTCDate() + days);
    onDateChange(current.toISOString().substring(0, 10));
  };

  const setSpecialDay = (type: 'today' | 'saturday' | 'sunday') => {
    if (type === 'today') {
      onDateChange('2026-10-17');
    } else if (type === 'saturday') {
      onDateChange('2026-10-17');
    } else if (type === 'sunday') {
      onDateChange('2026-10-18');
    }
  };

  const formattedDate = new Date(selectedDate + 'T12:00:00Z').toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

  return (
    <div className="bg-[#16181d] border border-[#252932] rounded-2xl p-3.5 shadow-md mb-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        {/* Date Selector with < Today > FotMob Navigation */}
        <div className="flex items-center space-x-2">
          <div className="flex items-center bg-[#1c1f26] border border-[#252932] rounded-xl p-1">
            <button
              onClick={() => shiftDay(-1)}
              className="p-1.5 hover:bg-[#252932] rounded-lg text-[#8c92a4] hover:text-white transition-colors cursor-pointer"
              title="Previous Day"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <div className="flex items-center px-3 space-x-2 font-bold text-xs sm:text-sm text-white min-w-[130px] justify-center">
              <span>{selectedDate === '2026-10-17' ? 'Today, 17 Oct' : formattedDate}</span>
            </div>

            <button
              onClick={() => shiftDay(1)}
              className="p-1.5 hover:bg-[#252932] rounded-lg text-[#8c92a4] hover:text-white transition-colors cursor-pointer"
              title="Next Day"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Quick Date Chips */}
          <div className="flex items-center space-x-1.5 text-xs">
            <button
              onClick={() => setSpecialDay('today')}
              className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer ${
                selectedDate === '2026-10-17'
                  ? 'bg-[#00d66c] text-black shadow-sm'
                  : 'bg-[#1c1f26] text-[#8c92a4] hover:text-white hover:bg-[#252932]'
              }`}
            >
              Today
            </button>
            <button
              onClick={() => setSpecialDay('sunday')}
              className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer ${
                selectedDate === '2026-10-18'
                  ? 'bg-[#00d66c] text-black shadow-sm'
                  : 'bg-[#1c1f26] text-[#8c92a4] hover:text-white hover:bg-[#252932]'
              }`}
            >
              Tomorrow
            </button>
          </div>
        </div>

        {/* Live Status and Refresh */}
        <div className="flex items-center space-x-2 text-xs">
          <button
            onClick={onToggleLivePolling}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border font-bold transition-all cursor-pointer ${
              isLivePolling
                ? 'bg-[#00d66c]/15 border-[#00d66c]/30 text-[#00d66c]'
                : 'bg-[#1c1f26] border-[#252932] text-[#8c92a4] hover:text-white'
            }`}
          >
            <span className="relative flex h-2 w-2">
              {isLivePolling && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00d66c] opacity-75"></span>
              )}
              <span className={`relative inline-flex rounded-full h-2 w-2 ${isLivePolling ? 'bg-[#00d66c]' : 'bg-[#8c92a4]'}`}></span>
            </span>
            <span>{isLivePolling ? 'Live Sync (30s)' : 'Sync Paused'}</span>
          </button>

          <button
            onClick={onManualRefresh}
            disabled={isRefreshing}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-[#1c1f26] hover:bg-[#252932] border border-[#252932] text-white font-semibold transition-colors disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-[#00d66c]' : 'text-[#8c92a4]'}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>
    </div>
  );
};
