import React, { useState, useEffect } from 'react';
import { fetchDiscordStatus, triggerDiscordBroadcast, configureDiscord } from '../api';
import { Radio, Send, CheckCircle2, AlertCircle, Clock, ShieldCheck, Terminal, Bot, Server, Settings, Zap } from 'lucide-react';

export const DiscordBotPanel: React.FC = () => {
  const [status, setStatus] = useState<{
    botEnabled: boolean;
    botReady: boolean;
    botTag?: string | null;
    guildsCount?: number;
    webhookConfigured: boolean;
    hourlyScheduleActive: boolean;
    lastBroadcastTime: string | null;
    activeChannelId?: string | null;
    updateInterval?: string;
  } | null>(null);

  const [channelIdInput, setChannelIdInput] = useState<string>('');
  const [intervalInput, setIntervalInput] = useState<string>('5m');
  const [isSavingConfig, setIsSavingConfig] = useState<boolean>(false);
  const [configSuccess, setConfigSuccess] = useState<string | null>(null);

  const [loading, setLoading] = useState<boolean>(true);
  const [triggering, setTriggering] = useState<boolean>(false);
  const [broadcastResult, setBroadcastResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    loadStatus();
  }, []);

  const loadStatus = async () => {
    try {
      const res = await fetchDiscordStatus();
      setStatus(res);
      if (res.activeChannelId) setChannelIdInput(res.activeChannelId);
      if (res.updateInterval) setIntervalInput(res.updateInterval);
    } catch (err) {
      console.warn(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveConfig = async () => {
    setIsSavingConfig(true);
    setConfigSuccess(null);
    try {
      const res = await configureDiscord({
        channelId: channelIdInput.trim() || undefined,
        interval: intervalInput,
      });
      setConfigSuccess(res.message || 'Discord configuration saved successfully!');
      await loadStatus();
    } catch (err: any) {
      alert(`Error saving configuration: ${err.message}`);
    } finally {
      setIsSavingConfig(false);
    }
  };

  const handleTestBroadcast = async () => {
    setTriggering(true);
    setBroadcastResult(null);
    try {
      const res = await triggerDiscordBroadcast();
      setBroadcastResult(res);
      await loadStatus();
    } catch (err: any) {
      setBroadcastResult({ success: false, message: err.message });
    } finally {
      setTriggering(false);
    }
  };

  const intervals = ['5m', '15m', '30m', '45m', '1h'];

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header Banner */}
      <div className="bg-[#16181d] border border-[#252932] rounded-3xl p-6 sm:p-8 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-center space-x-4">
            <div className="w-14 h-14 rounded-2xl bg-[#00d66c]/20 border border-[#00d66c]/30 flex items-center justify-center text-[#00d66c] font-black text-2xl">
              🤖
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">Discord Analytics Bot</h2>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-[#00d66c]/20 text-[#00d66c] border border-[#00d66c]/30">
                  24/7 Engine
                </span>
              </div>
              <p className="text-xs text-[#8c92a4] mt-1">
                Automated multi-interval updates (5m/15m/30m/45m/1h) on odds, team news, SGP parlays & live parlay motion.
              </p>
            </div>
          </div>

          <button
            onClick={handleTestBroadcast}
            disabled={triggering}
            className="flex items-center justify-center space-x-2 px-5 py-3 rounded-2xl bg-[#00d66c] hover:bg-[#00b85c] text-black font-extrabold text-xs sm:text-sm shadow-xl shadow-[#00d66c]/20 transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
          >
            {triggering ? (
              <>
                <div className="w-4 h-4 border-2 border-black/40 border-t-black rounded-full animate-spin" />
                <span>Broadcasting to Discord...</span>
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                <span>Trigger Live Broadcast Now</span>
              </>
            )}
          </button>
        </div>

        {broadcastResult && (
          <div
            className={`mt-4 p-3.5 rounded-2xl text-xs flex items-center space-x-2 ${
              broadcastResult.success
                ? 'bg-[#00d66c]/20 border border-[#00d66c]/30 text-[#00d66c]'
                : 'bg-amber-500/20 border border-amber-500/30 text-amber-300'
            }`}
          >
            {broadcastResult.success ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 text-[#00d66c]" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
            )}
            <span>{broadcastResult.message}</span>
          </div>
        )}
      </div>

      {/* Channel Linking & Interval Configuration */}
      <div className="bg-[#16181d] border border-[#252932] rounded-3xl p-6 sm:p-7 shadow-lg">
        <h3 className="font-bold text-white text-base mb-4 flex items-center space-x-2">
          <Settings className="w-4 h-4 text-[#00d66c]" />
          <span>Channel Linking & Dynamic Interval (5m / 15m / 30m / 45m / 1h)</span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Channel ID */}
          <div>
            <label className="block text-xs font-bold text-[#8c92a4] uppercase tracking-wider mb-2">
              Specific Channel ID
            </label>
            <input
              type="text"
              placeholder="e.g. 123456789012345678"
              value={channelIdInput}
              onChange={e => setChannelIdInput(e.target.value)}
              className="w-full bg-[#1c1f26] border border-[#252932] focus:border-[#00d66c] text-white text-xs rounded-xl px-3.5 py-2.5 focus:outline-none font-mono"
            />
            <p className="text-[11px] text-[#8c92a4] mt-1">
              Right-click your desired Discord channel ➔ <strong>Copy Channel ID</strong> (or run <code className="text-[#00d66c]">/channel</code> in chat).
            </p>
          </div>

          {/* Interval Selector */}
          <div>
            <label className="block text-xs font-bold text-[#8c92a4] uppercase tracking-wider mb-2">
              Update Frequency Interval
            </label>
            <div className="grid grid-cols-5 gap-2">
              {intervals.map(iv => (
                <button
                  key={iv}
                  type="button"
                  onClick={() => setIntervalInput(iv)}
                  className={`py-2 text-xs font-extrabold rounded-xl transition-all cursor-pointer ${
                    intervalInput === iv
                      ? 'bg-[#00d66c] text-black shadow-md'
                      : 'bg-[#1c1f26] border border-[#252932] text-[#8c92a4] hover:text-white'
                  }`}
                >
                  {iv}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-[#8c92a4] mt-1">
              Currently running: <strong className="text-white">every {status?.updateInterval || '5m'}</strong>.
            </p>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between">
          <button
            onClick={handleSaveConfig}
            disabled={isSavingConfig}
            className="py-2.5 px-6 rounded-xl bg-[#00d66c] hover:bg-[#00b85c] text-black font-extrabold text-xs transition-all cursor-pointer disabled:opacity-50"
          >
            {isSavingConfig ? 'Saving...' : '💾 Save Channel & Interval'}
          </button>

          {configSuccess && (
            <span className="text-xs text-[#00d66c] font-bold flex items-center space-x-1">
              <CheckCircle2 className="w-4 h-4" />
              <span>{configSuccess}</span>
            </span>
          )}
        </div>
      </div>

      {/* Grid Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Webhook Status */}
        <div className="bg-[#16181d] border border-[#252932] rounded-2xl p-5 shadow-lg">
          <div className="flex items-center justify-between text-xs mb-3">
            <span className="font-semibold text-[#8c92a4] uppercase tracking-wider text-[10px]">Discord Webhook</span>
            <span
              className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                status?.webhookConfigured
                  ? 'bg-[#00d66c]/20 text-[#00d66c] border border-[#00d66c]/30'
                  : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
              }`}
            >
              {status?.webhookConfigured ? 'CONNECTED' : 'STANDBY'}
            </span>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            {status?.webhookConfigured
              ? 'Webhook is configured in .env and active for automated broadcasts.'
              : 'Add your Discord Webhook URL to .env to receive automated updates.'}
          </p>
        </div>

        {/* Bot Client Status */}
        <div className="bg-[#16181d] border border-[#252932] rounded-2xl p-5 shadow-lg">
          <div className="flex items-center justify-between text-xs mb-3">
            <span className="font-semibold text-[#8c92a4] uppercase tracking-wider text-[10px]">Bot Client (24/7)</span>
            <span
              className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                status?.botReady
                  ? 'bg-[#00d66c]/20 text-[#00d66c] border border-[#00d66c]/30'
                  : 'bg-slate-800 text-[#8c92a4]'
              }`}
            >
              {status?.botReady ? 'ONLINE 🟢' : 'CONNECTING'}
            </span>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed mb-3">
            {status?.botReady ? (
              <span>
                Connected as <strong className="text-[#00d66c]">{status.botTag}</strong> in {status.guildsCount} server(s).
              </span>
            ) : (
              <span>Token configured in <code className="text-[#00d66c]">.env</code>. Ready for server invitation.</span>
            )}
          </p>
          <a
            href="https://discord.com/oauth2/authorize?client_id=1560911275502870638&permissions=274877991936&scope=bot"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center space-x-1.5 text-[11px] font-bold text-[#00d66c] hover:underline"
          >
            <span>👉 Add Bot to Discord Server</span>
          </a>
        </div>

        {/* Schedule */}
        <div className="bg-[#16181d] border border-[#252932] rounded-2xl p-5 shadow-lg">
          <div className="flex items-center justify-between text-xs mb-3">
            <span className="font-semibold text-[#8c92a4] uppercase tracking-wider text-[10px]">Update Interval</span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-400 border border-sky-500/30">
              EVERY {status?.updateInterval || '5m'}
            </span>
          </div>
          <div className="flex items-center space-x-2 text-xs text-slate-300">
            <Clock className="w-3.5 h-3.5 text-[#00d66c]" />
            <span>Last Broadcast: {status?.lastBroadcastTime ? new Date(status.lastBroadcastTime).toLocaleTimeString() : 'Pending trigger'}</span>
          </div>
        </div>
      </div>

      {/* Supported Bot Commands Showcase */}
      <div className="bg-[#16181d] border border-[#252932] rounded-3xl p-6 sm:p-7">
        <h3 className="font-bold text-white text-base mb-3 flex items-center space-x-2">
          <Terminal className="w-4 h-4 text-[#00d66c]" />
          <span>Discord Bot Commands (`/info`)</span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div className="p-3 bg-[#1c1f26] rounded-xl border border-[#252932]">
            <div className="font-mono font-bold text-[#00d66c]">/info</div>
            <div className="text-[#8c92a4] mt-1">Displays all working commands and step-by-step instructions for channel linking and interval selection.</div>
          </div>

          <div className="p-3 bg-[#1c1f26] rounded-xl border border-[#252932]">
            <div className="font-mono font-bold text-[#00d66c]">/channel [target] [interval]</div>
            <div className="text-[#8c92a4] mt-1">Links the bot to send automated updates directly into that channel with 5m/15m/30m/45m/1h frequency.</div>
          </div>

          <div className="p-3 bg-[#1c1f26] rounded-xl border border-[#252932]">
            <div className="font-mono font-bold text-[#00d66c]">/interval [frequency]</div>
            <div className="text-[#8c92a4] mt-1">Change interval on the fly (options: 5m, 15m, 30m, 45m, 1h).</div>
          </div>

          <div className="p-3 bg-[#1c1f26] rounded-xl border border-[#252932]">
            <div className="font-mono font-bold text-[#00d66c]">/sgp [match]</div>
            <div className="text-[#8c92a4] mt-1">Generates a Same-Game Parlay stacking Over 0.5 Goals, Corners & Cards for a specific fixture.</div>
          </div>

          <div className="p-3 bg-[#1c1f26] rounded-xl border border-[#252932]">
            <div className="font-mono font-bold text-[#00d66c]">/track [parlayId]</div>
            <div className="text-[#8c92a4] mt-1">Pulls up real-time minute-by-minute motion for your active parlay.</div>
          </div>

          <div className="p-3 bg-[#1c1f26] rounded-xl border border-[#252932]">
            <div className="font-mono font-bold text-[#00d66c]">/parlay [mode] [legs]</div>
            <div className="text-[#8c92a4] mt-1">Generates 5 to 25-leg parlays in Anti-Correlated or Same-Game Parlay mode.</div>
          </div>
        </div>
      </div>
    </div>
  );
};
