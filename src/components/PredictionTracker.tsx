import React, { useEffect, useState } from 'react';
import { MarketPrediction } from '../types';
import { fetchHistoricalPredictions } from '../api';
import { Search, Filter, CheckCircle2, XCircle, Clock } from 'lucide-react';

export const PredictionTracker: React.FC = () => {
  const [predictions, setPredictions] = useState<MarketPrediction[]>([]);
  const [filtered, setFiltered] = useState<MarketPrediction[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [search, setSearch] = useState<string>('');
  const [outcomeFilter, setOutcomeFilter] = useState<'ALL' | 'HIT' | 'MISS' | 'PENDING'>('ALL');

  useEffect(() => {
    fetchHistoricalPredictions()
      .then(res => {
        setPredictions(res.predictions || []);
        setFiltered(res.predictions || []);
      })
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    let list = [...predictions];
    if (outcomeFilter !== 'ALL') {
      list = list.filter(p => p.actualOutcome === outcomeFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        p => p.fixtureDescription.toLowerCase().includes(q) || p.selection.toLowerCase().includes(q)
      );
    }
    setFiltered(list);
  }, [search, outcomeFilter, predictions]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12 text-slate-400">
        <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mr-3" />
        <span>Loading historical prediction records...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Historical Prediction Tracking</h2>
        <p className="text-xs text-slate-400">
          Audited log of model predictions evaluated against recorded match results.
        </p>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute left-3 top-3 text-slate-500" />
          <input
            type="text"
            placeholder="Search teams or markets..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
          />
        </div>

        <div className="flex items-center space-x-2 w-full sm:w-auto">
          <Filter className="w-4 h-4 text-slate-500 hidden sm:block" />
          <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs w-full sm:w-auto justify-between">
            <button
              onClick={() => setOutcomeFilter('ALL')}
              className={`px-3 py-1 rounded font-medium ${outcomeFilter === 'ALL' ? 'bg-slate-800 text-white' : 'text-slate-400'}`}
            >
              All ({predictions.length})
            </button>
            <button
              onClick={() => setOutcomeFilter('HIT')}
              className={`px-3 py-1 rounded font-medium ${outcomeFilter === 'HIT' ? 'bg-emerald-600 text-white' : 'text-slate-400'}`}
            >
              Hits ({predictions.filter(p => p.actualOutcome === 'HIT').length})
            </button>
            <button
              onClick={() => setOutcomeFilter('MISS')}
              className={`px-3 py-1 rounded font-medium ${outcomeFilter === 'MISS' ? 'bg-rose-600 text-white' : 'text-slate-400'}`}
            >
              Misses ({predictions.filter(p => p.actualOutcome === 'MISS').length})
            </button>
            <button
              onClick={() => setOutcomeFilter('PENDING')}
              className={`px-3 py-1 rounded font-medium ${outcomeFilter === 'PENDING' ? 'bg-amber-600 text-white' : 'text-slate-400'}`}
            >
              Pending ({predictions.filter(p => p.actualOutcome === 'PENDING').length})
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950 border-b border-slate-800 text-slate-400 uppercase font-semibold text-[10px]">
              <tr>
                <th className="py-3 px-4">Fixture</th>
                <th className="py-3 px-4">League</th>
                <th className="py-3 px-4">Market & Selection</th>
                <th className="py-3 px-4">Calibrated Prob</th>
                <th className="py-3 px-4">Sample Size</th>
                <th className="py-3 px-4">Outcome</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filtered.map(pred => (
                <tr key={pred.id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="py-3 px-4 font-medium text-white max-w-xs truncate">
                    {pred.fixtureDescription}
                  </td>
                  <td className="py-3 px-4">
                    <span
                      className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${
                        pred.league === 'EPL' ? 'bg-purple-500/20 text-purple-400' : 'bg-blue-500/20 text-blue-400'
                      }`}
                    >
                      {pred.league}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <div className="font-semibold text-slate-200">{pred.selection}</div>
                    <div className="text-[10px] text-slate-500">{pred.marketLabel}</div>
                  </td>
                  <td className="py-3 px-4 font-mono font-bold text-white">
                    {(pred.estimatedProbability * 100).toFixed(1)}%
                  </td>
                  <td className="py-3 px-4 text-slate-400 font-mono">
                    N = {pred.sampleSize}
                  </td>
                  <td className="py-3 px-4">
                    {pred.actualOutcome === 'HIT' ? (
                      <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>HIT</span>
                      </span>
                    ) : pred.actualOutcome === 'MISS' ? (
                      <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30">
                        <XCircle className="w-3 h-3" />
                        <span>MISS</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">
                        <Clock className="w-3 h-3" />
                        <span>PENDING</span>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
