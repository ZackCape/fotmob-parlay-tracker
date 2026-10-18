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

/** Dynamic local client date (YYYY-MM-DD), evaluated on mount / call. */
const getTodayString = () => new Date().toISOString().split('T')[0];

/** Header label like "Today, 18 Oct" when the selected date is today. */
const formatDateLabel = (date: string): string => {
  const today = getTodayString();
  if (date === today) {
    const d = new Date();
    return `Today, ${d.getDate()} ${d.toLocaleDateString('en-GB', { month: 'short' })}`;
  }
  return new Date(date + 'T12:00:00Z').toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
};

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
      onDateChange(getTodayString());
    } else if (type === 'saturday') {
      const d = new Date();
      d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7) || 7);
      onDateChange(d.toISOString().split('T')[0]);
    } else if (type === 'sunday') {
      const d = new Date();
      d.setDate(d.getDate() + ((7 - d.getDay() + 7) % 7));
      onDateChange(d.toISOString().split('T')[0]);
    }
  };

  const formattedDate = formatDateLabel(selectedDate);
  const todayStr = getTodayString();
  const tomorrowStr = new Date(Date.now() + 86400000).toISOString().split('T')[0];

  return (
    <div className="bg-[#16181d] border border-[#252932] rounded-2xl p-3.5 shadow-md mb-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        {/* Date Selector with < Today > Navigation */}
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
              <span>{formattedDate}</span>
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
                selectedDate === todayStr
                  ? 'bg-[#00d66c] text-black shadow-sm'
                  : 'bg-[#1c1f26] text-[#8c92a4] hover:text-white hover:bg-[#252932]'
              }`}
            >
              Today
            </button>
            <button
              onClick={() => setSpecialDay('sunday')}
              className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer ${
                selectedDate === tomorrowStr
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
