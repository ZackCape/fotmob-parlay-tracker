import React from 'react';
import { SystemStatus } from '../types';
import { X, CheckCircle2, AlertCircle, Database, Shield, Radio, RefreshCw } from 'lucide-react';

interface StatusModalProps {
  status: SystemStatus | null;
  onClose: () => void;
}

export const StatusModal: React.FC<StatusModalProps> = ({ status, onClose }) => {
  if (!status) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="relative bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-5 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Radio className="w-5 h-5 text-emerald-400" />
            <h3 className="font-bold text-white text-base">System Architecture & Data Health</h3>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-white rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 text-xs">
          {/* Active Provider */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
            <div className="flex items-center justify-between mb-2">
              <span className="font-semibold text-slate-300">Active Live Adapter</span>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                {status.providers.primary.isAvailable ? 'CONNECTED' : 'STANDBY'}
              </span>
            </div>
            <div className="text-sm font-bold text-white">{status.providers.primary.providerName}</div>
            <p className="text-slate-400 mt-1">{status.providers.primary.details}</p>
            {status.providers.primary.rateLimitRemaining !== undefined && (
              <div className="mt-2 text-slate-500 font-mono">
                Requests Remaining: {status.providers.primary.rateLimitRemaining}
              </div>
            )}
          </div>

          {/* Fallback Provider */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
            <div className="flex items-center justify-between mb-2">
              <span className="font-semibold text-slate-300">Verified Fallback & Historical Engine</span>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30">
                ACTIVE
              </span>
            </div>
            <div className="text-sm font-bold text-white">{status.providers.fallback.providerName}</div>
            <p className="text-slate-400 mt-1">{status.providers.fallback.details}</p>
          </div>

          {/* Database & Persistence */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center space-x-2 font-semibold text-slate-300">
                <Database className="w-4 h-4 text-emerald-400" />
                <span>Persistence Storage</span>
              </div>
              <span className="font-mono text-emerald-400 font-bold">
                {status.database.configured ? 'PostgreSQL 16' : 'Active Local Store'}
              </span>
            </div>
            <p className="text-slate-400 mt-1">{status.database.type}</p>
          </div>

          {/* Caching & Competitions */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
              <div className="text-slate-500 uppercase font-semibold text-[10px]">In-Memory Cache</div>
              <div className="font-mono text-base font-bold text-white mt-1">
                {status.caching.activeEntries} Entries
              </div>
              <div className="text-[10px] text-slate-500">TTL: {status.caching.ttlMinutes}m</div>
            </div>

            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
              <div className="text-slate-500 uppercase font-semibold text-[10px]">Supported Leagues</div>
              <div className="font-mono text-base font-bold text-white mt-1">
                44 Teams Total
              </div>
              <div className="text-[10px] text-slate-500">20 EPL + 24 Championship</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
