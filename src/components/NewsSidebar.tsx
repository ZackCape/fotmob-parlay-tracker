import React, { useState, useEffect } from 'react';
import { LiveTrackedParlay } from '../types';
import { Newspaper, Zap, MessageSquare, ChevronRight, Activity, Brain, ExternalLink } from 'lucide-react';
import { fetchNews, fetchLearningStats, FootballNewsArticle } from '../api';

interface NewsSidebarProps {
  activeTrackedParlay?: LiveTrackedParlay | null;
  onOpenLiveTracker?: () => void;
  onSimulateTick?: () => void;
  onOpenDiscord?: () => void;
  discordInterval?: string;
}

export const NewsSidebar: React.FC<NewsSidebarProps> = ({
  activeTrackedParlay,
  onOpenLiveTracker,
  onSimulateTick,
  onOpenDiscord,
  discordInterval = '5m',
}) => {
  const [news, setNews] = useState<FootballNewsArticle[]>([]);
  const [loadingNews, setLoadingNews] = useState<boolean>(true);
  const [learningInfo, setLearningInfo] = useState<any>(null);

  useEffect(() => {
    fetchNews()
      .then(res => {
        if (res.articles && res.articles.length > 0) {
          setNews(res.articles);
        }
      })
      .catch(err => console.warn('Could not load real news:', err))
      .finally(() => setLoadingNews(false));

    fetchLearningStats()
      .then(res => {
        if (res && res.teamsTrackedCount !== undefined) {
          setLearningInfo(res);
        }
      })
      .catch(err => console.warn('Could not load learning stats:', err));
  }, []);

  const getTagColor = (tag?: string) => {
    switch (tag) {
      case 'Premier League':
        return 'text-purple-400 bg-purple-500/10 border-purple-500/20';
      case 'La Liga':
        return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
      case 'Ligue 1':
        return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
      case 'Serie A':
        return 'text-sky-400 bg-sky-500/10 border-sky-500/20';
      case 'UEFA Competitions':
        return 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20';
      default:
        return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
    }
  };

  return (
    <aside className="w-full lg:w-80 shrink-0 space-y-4">
      {/* Live Tracked Parlay Mini-Widget */}
      {activeTrackedParlay && (
        <div className="bg-[#16181d] border border-[#00d66c]/40 rounded-2xl p-4 shadow-xl">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00d66c] opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#00d66c]"></span>
              </span>
              <span className="text-xs font-bold text-white uppercase tracking-wider">Live Parlay Motion</span>
            </div>
            <button
              onClick={onOpenLiveTracker}
              className="text-[11px] font-bold text-[#00d66c] hover:underline flex items-center cursor-pointer"
            >
              Expand <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="bg-[#1c1f26] rounded-xl p-3 border border-[#252932] space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#8c92a4]">Hit Progress</span>
              <span className="font-mono font-bold text-[#00d66c]">
                {activeTrackedParlay.legsHitCount} / {activeTrackedParlay.totalLegs} Hit
              </span>
            </div>

            <div className="w-full h-2 bg-[#16181d] rounded-full overflow-hidden">
              <div
                className="h-full bg-[#00d66c] transition-all duration-300"
                style={{ width: `${(activeTrackedParlay.legsHitCount / activeTrackedParlay.totalLegs) * 100}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-xs pt-1">
              <span className="text-[#8c92a4]">Cashout Probability</span>
              <span className="font-mono font-black text-white">
                {(activeTrackedParlay.cashoutProbabilityIndex * 100).toFixed(1)}%
              </span>
            </div>
          </div>

          {onSimulateTick && (
            <button
              onClick={onSimulateTick}
              className="w-full mt-3 py-2 px-3 rounded-xl bg-[#00d66c] hover:bg-[#00b85c] text-black font-extrabold text-xs flex items-center justify-center space-x-1.5 transition-all cursor-pointer"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Simulate Next Tick</span>
            </button>
          )}
        </div>
      )}

      {/* Adaptive Bayesian Machine Learning Engine Status */}
      <div className="bg-[#16181d] border border-[#252932] rounded-2xl p-4 shadow-lg">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center space-x-2">
            <div className="w-7 h-7 rounded-lg bg-[#00d66c]/15 text-[#00d66c] flex items-center justify-center">
              <Brain className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-bold text-white">Adaptive Learning Engine</div>
              <div className="text-[10px] text-[#8c92a4]">Bayesian Parameter Updates</div>
            </div>
          </div>
          <span className="px-2 py-0.5 rounded-full bg-[#00d66c]/15 text-[#00d66c] text-[10px] font-bold border border-[#00d66c]/30">
            ADAPTING
          </span>
        </div>

        <p className="text-[11px] text-[#8c92a4] leading-relaxed">
          The model continuously adapts team attack/defense ratings, xG, corners and cards after <strong className="text-white">every match played</strong>, automatically recalibrating all future predictions.
        </p>

        {learningInfo && (
          <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-[#252932] text-xs">
            <div className="bg-[#1c1f26] rounded-xl p-2 text-center">
              <span className="text-[10px] text-[#8c92a4] block">Tracked Teams</span>
              <span className="font-mono font-bold text-white">{learningInfo.teamsTrackedCount || 100}</span>
            </div>
            <div className="bg-[#1c1f26] rounded-xl p-2 text-center">
              <span className="text-[10px] text-[#8c92a4] block">Match Adaptations</span>
              <span className="font-mono font-bold text-[#00d66c]">{learningInfo.totalLearningEvents || 0}</span>
            </div>
          </div>
        )}
      </div>

      {/* 24/7 Discord Bot Live Status */}
      <div className="bg-[#16181d] border border-[#252932] rounded-2xl p-4 shadow-lg">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center space-x-2">
            <div className="w-7 h-7 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center">
              <MessageSquare className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-bold text-white">Discord 24/7 Alerts</div>
              <div className="text-[10px] text-[#8c92a4]">Interval: every {discordInterval}</div>
            </div>
          </div>
          <span className="px-2 py-0.5 rounded-full bg-[#00d66c]/15 text-[#00d66c] text-[10px] font-bold border border-[#00d66c]/30">
            ONLINE
          </span>
        </div>

        <p className="text-[11px] text-[#8c92a4] leading-relaxed">
          Link to any Discord channel with <code className="text-white bg-[#1c1f26] px-1 py-0.5 rounded text-[10px]">/channel</code> to get 5m/15m/30m/45m/1h updates even when PC is off.
        </p>

        <button
          onClick={onOpenDiscord}
          className="w-full mt-3 py-2 px-3 rounded-xl bg-[#1c1f26] hover:bg-[#252932] text-white border border-[#252932] font-semibold text-xs flex items-center justify-center space-x-1 transition-all cursor-pointer"
        >
          <span>Configure Bot & Channel</span>
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Real News Feed scraped directly from FootballDatabase.eu */}
      <div className="bg-[#16181d] border border-[#252932] rounded-2xl p-4 shadow-lg">
        <div className="flex items-center justify-between pb-3 border-b border-[#252932]">
          <div className="flex items-center space-x-2">
            <Newspaper className="w-4 h-4 text-[#00d66c]" />
            <span className="text-xs font-bold text-white uppercase tracking-wider">Verified Football News</span>
          </div>
          <span className="text-[10px] text-[#8c92a4]">FootballDatabase.eu</span>
        </div>

        <div className="divide-y divide-[#252932] mt-1">
          {loadingNews ? (
            <div className="py-6 text-center text-[#8c92a4] text-xs">
              <div className="w-5 h-5 border-2 border-[#00d66c] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              Loading verified stories...
            </div>
          ) : (
            news.map(item => (
              <a
                key={item.id}
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="py-3 group block hover:bg-[#1c1f26]/40 -mx-2 px-2 rounded-xl transition-all"
              >
                <div className="flex items-center justify-between space-x-2 mb-1">
                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded border uppercase ${getTagColor(item.tag)}`}>
                    {item.tag || 'Football'}
                  </span>
                  <div className="flex items-center space-x-1 text-[10px] text-[#8c92a4]">
                    <span>{item.publishedAt}</span>
                    <ExternalLink className="w-2.5 h-2.5 opacity-60 group-hover:opacity-100" />
                  </div>
                </div>
                <h4 className="text-xs font-semibold text-white group-hover:text-[#00d66c] transition-colors leading-snug">
                  {item.title}
                </h4>
                <div className="text-[10px] text-[#8c92a4] mt-1">
                  <span>{item.source}</span>
                </div>
              </a>
            ))
          )}
        </div>
      </div>
    </aside>
  );
};
