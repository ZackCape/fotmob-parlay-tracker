import React from 'react';
import { LiveTrackedParlay } from '../types';
import { Newspaper, Zap, MessageSquare, ChevronRight, Activity, Bell } from 'lucide-react';

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
  const newsItems = [
    {
      id: 'news-1',
      title: 'Haaland and De Bruyne confirmed ready for weekend Premier League clash',
      tag: 'Premier League',
      tagColor: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
      time: '12m ago',
      source: 'FotMob Wire',
      image: 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?auto=format&fit=crop&w=400&q=80',
    },
    {
      id: 'news-2',
      title: 'Mbappé and Vinicius Jr attacking momentum reaches 3.4 expected goals per 90',
      tag: 'LaLiga',
      tagColor: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
      time: '34m ago',
      source: 'DeepMind Analytics',
      image: 'https://images.unsplash.com/photo-1522778119026-d647f0596c20?auto=format&fit=crop&w=400&q=80',
    },
    {
      id: 'news-3',
      title: 'Champions League knockout spots: Model projects Bayern & Arsenal at 92% qualification',
      tag: 'UCL',
      tagColor: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20',
      time: '1h ago',
      source: 'UEFA StatEngine',
      image: 'https://images.unsplash.com/photo-1518091043644-c1d4457512c6?auto=format&fit=crop&w=400&q=80',
    },
    {
      id: 'news-4',
      title: 'Ligue 1 high pressing analysis: PSG & Lille corner rates surge past 6.8 average',
      tag: 'Ligue 1',
      tagColor: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
      time: '2h ago',
      source: 'Opta / FotMob Sync',
      image: 'https://images.unsplash.com/photo-1574629810360-7efbbe195018?auto=format&fit=crop&w=400&q=80',
    },
  ];

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
              className="text-[11px] font-bold text-[#00d66c] hover:underline flex items-center"
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

      {/* News Feed */}
      <div className="bg-[#16181d] border border-[#252932] rounded-2xl p-4 shadow-lg">
        <div className="flex items-center justify-between pb-3 border-b border-[#252932]">
          <div className="flex items-center space-x-2">
            <Newspaper className="w-4 h-4 text-[#00d66c]" />
            <span className="text-xs font-bold text-white uppercase tracking-wider">Top stories</span>
          </div>
          <span className="text-[10px] text-[#8c92a4]">FotMob News</span>
        </div>

        <div className="divide-y divide-[#252932] mt-1">
          {newsItems.map(item => (
            <div key={item.id} className="py-3 group cursor-pointer">
              <div className="flex items-center space-x-2 mb-1">
                <span className={`text-[9px] font-bold px-2 py-0.5 rounded border uppercase ${item.tagColor}`}>
                  {item.tag}
                </span>
                <span className="text-[10px] text-[#8c92a4]">{item.time}</span>
              </div>
              <h4 className="text-xs font-semibold text-white group-hover:text-[#00d66c] transition-colors leading-snug">
                {item.title}
              </h4>
              <div className="text-[10px] text-[#8c92a4] mt-1 flex items-center space-x-1">
                <span>{item.source}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
};
