import React, { useState, useEffect, useRef } from 'react';
import { Search, X, Trophy, Calendar, Globe } from 'lucide-react';

interface SearchModalProps {
  open: boolean;
  onClose: () => void;
  fixtures?: any[];
  leagues?: any[];
  onNavigate?: (target: string) => void;
}

/**
 * Global search overlay triggered by Cmd/Ctrl+K. Instantly filters teams,
 * fixtures and leagues across all 19 supported competitions.
 */
export const SearchModal: React.FC<SearchModalProps> = ({ open, onClose, fixtures = [], leagues = [], onNavigate }) => {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const q = query.trim().toLowerCase();
  const results: Array<{ type: string; label: string; sub: string; target: string }> = [];

  if (q.length >= 2) {
    for (const fx of fixtures) {
      const home = fx?.homeTeam?.name ?? '';
      const away = fx?.awayTeam?.name ?? '';
      const league = fx?.league ?? '';
      if (home.toLowerCase().includes(q) || away.toLowerCase().includes(q) || league.toLowerCase().includes(q)) {
        results.push({ type: 'Match', label: `${home} vs ${away}`, sub: league, target: `match:${fx.id}` });
      }
    }
    for (const lg of leagues) {
      const name = lg?.name ?? lg?.label ?? '';
      if (name.toLowerCase().includes(q)) {
        results.push({ type: 'League', label: name, sub: lg?.country ?? '', target: `league:${lg.id ?? name}` });
      }
    }
  }

  const grouped = results.slice(0, 20);

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-20 px-4 bg-black/70 backdrop-blur-md" onClick={onClose}>
      <div
        className="w-full max-w-xl bg-slate-950/95 backdrop-blur-md border border-emerald-500/30 rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-emerald-500/20">
          <Search className="w-5 h-5 text-emerald-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search teams, fixtures, leagues..."
            className="flex-1 bg-transparent text-white text-sm outline-none placeholder:text-slate-500"
          />
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {q.length < 2 && (
            <div className="px-4 py-6 text-xs text-slate-500 text-center">
              Type at least 2 characters to search across all 19 competitions.
            </div>
          )}
          {q.length >= 2 && grouped.length === 0 && (
            <div className="px-4 py-6 text-xs text-slate-500 text-center">
              No matches found for "{query}".
            </div>
          )}
          {grouped.map((r, i) => (
            <button
              key={i}
              onClick={() => { onNavigate?.(r.target); onClose(); }}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-emerald-500/10 transition-colors text-left border-b border-white/5"
            >
              {r.type === 'Match' ? <Calendar className="w-4 h-4 text-emerald-400" /> : r.type === 'League' ? <Globe className="w-4 h-4 text-cyan-400" /> : <Trophy className="w-4 h-4 text-amber-400" />}
              <div className="flex-1 min-w-0">
                <div className="text-sm text-white font-semibold truncate">{r.label}</div>
                <div className="text-[10px] text-slate-500 uppercase">{r.type} · {r.sub}</div>
              </div>
            </button>
          ))}
        </div>
        <div className="px-4 py-2 bg-slate-950/50 border-t border-emerald-500/10 text-[10px] text-slate-500 flex items-center justify-between">
          <span>Esc to close</span>
          <span>Cmd/Ctrl + K to open</span>
        </div>
      </div>
    </div>
  );
};

export default SearchModal;
