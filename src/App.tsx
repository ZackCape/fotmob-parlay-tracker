import React, { useState, useEffect, useCallback } from 'react';
import { Navbar } from './components/Navbar';
import { TopLeaguesSidebar } from './components/TopLeaguesSidebar';
import { DatePickerBar } from './components/DatePickerBar';
import { LeagueAccordionGroup } from './components/LeagueAccordionGroup';
import { MatchAnalysisModal } from './components/MatchAnalysisModal';
import { ParlayBuilder } from './components/ParlayBuilder';
import { LiveParlayTracker } from './components/LiveParlayTracker';
import { NewsSidebar } from './components/NewsSidebar';
import { ModelPerformance } from './components/ModelPerformance';
import { PredictionTracker } from './components/PredictionTracker';
import { DiscordBotPanel } from './components/DiscordBotPanel';
import { StatusModal } from './components/StatusModal';
import { Fixture, MatchAnalysis, SystemStatus, LiveTrackedParlay } from './types';
import { fetchFixtures, fetchMatchAnalysis, fetchSystemStatus, fetchLiveTrackedParlays, simulateLiveTick } from './api';
import { AlertCircle, RefreshCw } from 'lucide-react';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'fixtures' | 'parlays' | 'livetracker' | 'performance' | 'history' | 'discord'>('fixtures');
  const [selectedDate, setSelectedDate] = useState<string>('2026-10-17'); // Saturday matchday default
  const [selectedLeague, setSelectedLeague] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterLiveOnly, setFilterLiveOnly] = useState<boolean>(false);

  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [loadingFixtures, setLoadingFixtures] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [fixtureError, setFixtureError] = useState<string | null>(null);
  const [isLivePolling, setIsLivePolling] = useState<boolean>(true);
  const [lastSyncedTime, setLastSyncedTime] = useState<string>('Just now');

  const [selectedFixtureAnalysis, setSelectedFixtureAnalysis] = useState<MatchAnalysis | null>(null);
  const [loadingAnalysis, setLoadingAnalysis] = useState<boolean>(false);

  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [isStatusOpen, setIsStatusOpen] = useState<boolean>(false);

  // Live Parlay Tracker state
  const [activeTrackedParlay, setActiveTrackedParlay] = useState<LiveTrackedParlay | null>(null);

  // Load system status and existing live parlays
  useEffect(() => {
    fetchSystemStatus()
      .then(res => setSystemStatus(res))
      .catch(err => console.warn('Could not fetch status:', err));

    fetchLiveTrackedParlays()
      .then(res => {
        if (res.activeParlays && res.activeParlays.length > 0) {
          setActiveTrackedParlay(res.activeParlays[0]);
        }
      })
      .catch(err => console.warn('Could not fetch live parlays:', err));
  }, []);

  const loadFixtures = useCallback(async (showLoadingSpinner: boolean = true) => {
    if (showLoadingSpinner) setLoadingFixtures(true);
    setIsRefreshing(true);
    setFixtureError(null);

    try {
      const res = await fetchFixtures(selectedDate, selectedLeague);
      setFixtures(res.fixtures || []);
      const now = new Date();
      setLastSyncedTime(`${now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`);
    } catch (err: any) {
      setFixtureError(err.message || 'Failed to load fixtures');
    } finally {
      if (showLoadingSpinner) setLoadingFixtures(false);
      setIsRefreshing(false);
    }
  }, [selectedDate, selectedLeague]);

  // Initial fetch on date / league change
  useEffect(() => {
    loadFixtures(true);
  }, [loadFixtures]);

  // Background Live Polling Timer (Every 30 seconds if live polling is enabled)
  useEffect(() => {
    if (!isLivePolling) return;

    const interval = setInterval(() => {
      loadFixtures(false);
    }, 30000);

    return () => clearInterval(interval);
  }, [isLivePolling, loadFixtures]);

  const handleSelectFixture = async (fx: Fixture) => {
    setLoadingAnalysis(true);
    try {
      const analysis = await fetchMatchAnalysis(fx.id);
      setSelectedFixtureAnalysis(analysis);
    } catch (err: any) {
      alert(`Could not load match analysis: ${err.message}`);
    } finally {
      setLoadingAnalysis(false);
    }
  };

  const handleSimulateTick = async () => {
    if (!activeTrackedParlay) return;
    try {
      const updated = await simulateLiveTick(activeTrackedParlay.parlayId);
      setActiveTrackedParlay(updated);
    } catch (err: any) {
      console.warn('Simulation tick error:', err);
    }
  };

  // Compute match count per league
  const leagueMatchCounts = fixtures.reduce<Record<string, number>>((acc, f) => {
    acc[f.league] = (acc[f.league] || 0) + 1;
    return acc;
  }, {});

  const liveMatches = fixtures.filter(f => f.status === 'LIVE');

  // Filter fixtures by search query and live-only toggle
  const filteredFixtures = fixtures.filter(f => {
    if (filterLiveOnly && f.status !== 'LIVE') return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchHome = f.homeTeam.name.toLowerCase().includes(q);
      const matchAway = f.awayTeam.name.toLowerCase().includes(q);
      const matchLeague = f.league.toLowerCase().includes(q);
      if (!matchHome && !matchAway && !matchLeague) return false;
    }
    return true;
  });

  return (
    <div className="min-h-screen bg-[#0d0e11] text-white flex flex-col justify-between selection:bg-[#00d66c] selection:text-black">
      <div>
        {/* Top Cape Predictor Header */}
        <Navbar
          activeTab={activeTab}
          onTabChange={setActiveTab}
          status={systemStatus}
          onOpenStatus={() => setIsStatusOpen(true)}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
        />

        {/* Cape Predictor Desktop 3-Column Layout */}
        <main className="max-w-[1600px] mx-auto px-3 sm:px-6 py-6">
          <div className="flex flex-col lg:flex-row gap-6">
            {/* COLUMN 1: Top Leagues Sidebar */}
            <TopLeaguesSidebar
              selectedLeague={selectedLeague}
              onSelectLeague={(league) => {
                setSelectedLeague(league);
                setFilterLiveOnly(false);
              }}
              leagueMatchCounts={leagueMatchCounts}
              liveMatchCount={liveMatches.length}
              filterLiveOnly={filterLiveOnly}
              onFilterLiveOnly={() => setFilterLiveOnly(!filterLiveOnly)}
            />

            {/* COLUMN 2: Central Dynamic Feed */}
            <div className="flex-1 min-w-0 space-y-4">
              {/* Center Content Switcher Based on Active Tab */}
              {activeTab === 'fixtures' && (
                <div>
                  {/* Date Navigation Bar */}
                  <DatePickerBar
                    selectedDate={selectedDate}
                    onDateChange={setSelectedDate}
                    selectedLeague={selectedLeague}
                    onLeagueChange={setSelectedLeague}
                    matchCount={filteredFixtures.length}
                    isLivePolling={isLivePolling}
                    onToggleLivePolling={() => setIsLivePolling(!isLivePolling)}
                    onManualRefresh={() => loadFixtures(false)}
                    isRefreshing={isRefreshing}
                    lastSyncedTime={lastSyncedTime}
                  />

                  {loadingFixtures ? (
                    <div className="flex flex-col items-center justify-center py-20 text-[#8c92a4]">
                      <div className="w-8 h-8 border-3 border-[#00d66c] border-t-transparent rounded-full animate-spin mb-3" />
                      <p className="text-xs font-semibold text-white">Syncing live match stats from European engines...</p>
                    </div>
                  ) : fixtureError ? (
                    <div className="bg-rose-500/10 border border-rose-500/20 rounded-2xl p-6 text-center text-rose-400">
                      <AlertCircle className="w-8 h-8 mx-auto mb-2" />
                      <p className="font-semibold text-sm">{fixtureError}</p>
                    </div>
                  ) : (
                    /* Grouped League Accordions */
                    <LeagueAccordionGroup
                      fixtures={filteredFixtures}
                      onSelectFixture={handleSelectFixture}
                      selectedLeagueFilter={selectedLeague}
                    />
                  )}
                </div>
              )}

              {/* TAB 2: PARLAY & SGP BUILDER */}
              {activeTab === 'parlays' && (
                <ParlayBuilder
                  selectedDate={selectedDate}
                  selectedLeague={selectedLeague}
                  onTrackLive={(live) => {
                    setActiveTrackedParlay(live);
                    setActiveTab('livetracker');
                  }}
                />
              )}

              {/* TAB 3: LIVE MATCH PARLAY TRACKER */}
              {activeTab === 'livetracker' && (
                <LiveParlayTracker
                  initialTrackedParlay={activeTrackedParlay}
                  onSelectFixture={(id) => {
                    const fx = fixtures.find(f => f.id === id);
                    if (fx) handleSelectFixture(fx);
                  }}
                />
              )}

              {/* TAB 4: DISCORD BOT PANEL */}
              {activeTab === 'discord' && <DiscordBotPanel />}

              {/* TAB 5: MODEL PERFORMANCE & CALIBRATION */}
              {activeTab === 'performance' && <ModelPerformance />}

              {/* TAB 6: HISTORICAL PREDICTIONS */}
              {activeTab === 'history' && <PredictionTracker />}
            </div>

            {/* COLUMN 3: Right News & Live Motion Tracker Sidebar */}
            <NewsSidebar
              activeTrackedParlay={activeTrackedParlay}
              onOpenLiveTracker={() => setActiveTab('livetracker')}
              onSimulateTick={handleSimulateTick}
              onOpenDiscord={() => setActiveTab('discord')}
            />
          </div>
        </main>
      </div>

      {/* Match Analysis Modal */}
      {selectedFixtureAnalysis && (
        <MatchAnalysisModal
          analysis={selectedFixtureAnalysis}
          onClose={() => setSelectedFixtureAnalysis(null)}
        />
      )}

      {/* System Status Modal */}
      {isStatusOpen && (
        <StatusModal status={systemStatus} onClose={() => setIsStatusOpen(false)} />
      )}

      {/* Footer */}
      <footer className="border-t border-[#252932] bg-[#0d0e11] mt-12 py-6 text-xs text-[#8c92a4]">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-[#00d66c]" />
            <span>Cape Predictor • 7 Top European Leagues • Zero Bookmaker Odds Biases</span>
          </div>
          <div className="flex items-center space-x-4">
            <span>24/7 Discord Uptime</span>
            <span>•</span>
            <span className="text-[#00d66c] font-mono">Dixon-Coles & Poisson Copula</span>
          </div>
        </div>
      </footer>
    </div>
  );
};
