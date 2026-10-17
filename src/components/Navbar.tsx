import React, { useState } from 'react';
import { Activity, Search, Calendar, Layers, BarChart3, History, Cpu, MessageSquare, Zap } from 'lucide-react';
import { SystemStatus } from '../types';

interface NavbarProps {
  activeTab: 'fixtures' | 'parlays' | 'livetracker' | 'performance' | 'history' | 'discord';
  onTabChange: (tab: 'fixtures' | 'parlays' | 'livetracker' | 'performance' | 'history' | 'discord') => void;
  status: SystemStatus | null;
  onOpenStatus: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  onTabChange,
  status,
  onOpenStatus,
  searchQuery,
  onSearchChange,
}) => {
  return (
    <header className="sticky top-0 z-40 bg-[#0d0e11]/95 backdrop-blur-md border-b border-[#252932] shadow-sm">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-16 gap-4">
          {/* Cape Predictor Logo & Brand */}
          <div className="flex items-center space-x-3 shrink-0 cursor-pointer" onClick={() => onTabChange('fixtures')}>
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 rounded-full bg-[#00d66c] flex items-center justify-center font-black text-black text-sm shadow-md shadow-[#00d66c]/20">
                ⚡
              </div>
              <div className="flex flex-col leading-none">
                <span className="text-base font-black tracking-tight text-white font-sans">
                  Cape Predictor
                </span>
                <span className="text-[9px] font-semibold text-[#00d66c] tracking-wide">
                  Football Intelligence. Smarter Predictions.
                </span>
              </div>
            </div>
          </div>

          {/* Search Pill */}
          <div className="hidden md:flex items-center flex-1 max-w-md mx-4">
            <div className="relative w-full">
              <Search className="w-4 h-4 text-[#8c92a4] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search teams, matches, leagues..."
                value={searchQuery}
                onChange={e => onSearchChange(e.target.value)}
                className="w-full bg-[#1c1f26] border border-[#252932] focus:border-[#00d66c] text-white text-xs rounded-full pl-9 pr-4 py-2 focus:outline-none placeholder-[#8c92a4] transition-colors"
              />
            </div>
          </div>

          {/* Navigation Items */}
          <nav className="flex items-center space-x-1 overflow-x-auto no-scrollbar">
            <button
              onClick={() => onTabChange('fixtures')}
              className={`flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                activeTab === 'fixtures'
                  ? 'bg-[#1c1f26] text-[#00d66c]'
                  : 'text-[#8c92a4] hover:text-white hover:bg-[#1c1f26]/60'
              }`}
            >
              <Calendar className="w-4 h-4" />
              <span>Matches</span>
            </button>

            <button
              onClick={() => onTabChange('parlays')}
              className={`flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                activeTab === 'parlays'
                  ? 'bg-[#1c1f26] text-[#00d66c]'
                  : 'text-[#8c92a4] hover:text-white hover:bg-[#1c1f26]/60'
              }`}
            >
              <Layers className="w-4 h-4" />
              <span>Parlay & SGP</span>
            </button>

            <button
              onClick={() => onTabChange('livetracker')}
              className={`flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                activeTab === 'livetracker'
                  ? 'bg-[#1c1f26] text-[#00d66c]'
                  : 'text-[#8c92a4] hover:text-white hover:bg-[#1c1f26]/60'
              }`}
            >
              <Activity className="w-4 h-4 text-[#00d66c] animate-pulse" />
              <span>Live Tracker</span>
              <span className="w-1.5 h-1.5 rounded-full bg-[#00d66c]" />
            </button>

            <button
              onClick={() => onTabChange('performance')}
              className={`flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                activeTab === 'performance'
                  ? 'bg-[#1c1f26] text-[#00d66c]'
                  : 'text-[#8c92a4] hover:text-white hover:bg-[#1c1f26]/60'
              }`}
            >
              <BarChart3 className="w-4 h-4" />
              <span className="hidden sm:inline">Model</span>
            </button>

            <button
              onClick={() => onTabChange('discord')}
              className={`flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                activeTab === 'discord'
                  ? 'bg-[#1c1f26] text-[#00d66c]'
                  : 'text-[#8c92a4] hover:text-white hover:bg-[#1c1f26]/60'
              }`}
            >
              <MessageSquare className="w-4 h-4" />
              <span>Discord</span>
            </button>
          </nav>

          {/* Quick Health & Engine Trigger */}
          <div className="flex items-center space-x-2 shrink-0">
            <button
              onClick={onOpenStatus}
              className="flex items-center space-x-2 px-3 py-1.5 rounded-xl bg-[#1c1f26] hover:bg-[#252932] border border-[#252932] text-xs transition-colors cursor-pointer"
              title="System & 24/7 API Status"
            >
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00d66c] opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#00d66c]"></span>
              </span>
              <span className="text-[#8c92a4] text-[11px] font-mono hidden xl:inline">
                24/7 Engine
              </span>
              <Cpu className="w-3.5 h-3.5 text-[#8c92a4]" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
