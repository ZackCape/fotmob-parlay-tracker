import React from 'react';
import { Calendar, Layers, Activity, BarChart3 } from 'lucide-react';

interface MobileBottomNavProps {
  activeTab: string;
  onNavigate: (tab: string) => void;
}

/**
 * Sticky mobile toolbar for small viewports. Gives one-tap access to Matches,
 * Parlay Builder, Live Tracker and Analytics without scrolling back to the top.
 */
export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({ activeTab, onNavigate }) => {
  const items = [
    { id: 'matches', label: 'Matches', icon: Calendar },
    { id: 'parlay', label: 'Parlay', icon: Layers },
    { id: 'live', label: 'Live', icon: Activity },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  ];

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-slate-950/95 backdrop-blur-md border-t border-emerald-500/20 px-2 py-1.5 flex items-center justify-around">
      {items.map(({ id, label, icon: Icon }) => {
        const active = activeTab === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onNavigate(id)}
            className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-xl transition-colors ${
              active ? 'text-emerald-400' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            <Icon className={`w-5 h-5 ${active ? 'drop-shadow-[0_0_6px_rgba(16,185,129,0.6)]' : ''}`} />
            <span className="text-[10px] font-bold uppercase tracking-wider">{label}</span>
          </button>
        );
      })}
    </nav>
  );
};

export default MobileBottomNav;
