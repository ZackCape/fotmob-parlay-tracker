import React, { useEffect, useState } from 'react';
import { ModelPerformanceReport } from '../types';
import { fetchModelPerformance } from '../api';
import { BarChart3, CheckCircle2, TrendingUp, HelpCircle, Activity } from 'lucide-react';

export const ModelPerformance: React.FC = () => {
  const [report, setReport] = useState<ModelPerformanceReport | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    fetchModelPerformance()
      .then(res => setReport(res))
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12 text-slate-400">
        <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mr-3" />
        <span>Loading model performance metrics...</span>
      </div>
    );
  }

  if (!report) return null;

  return (
    <div className="space-y-6">
      {/* Title */}
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Statistical Prediction Engine Performance</h2>
        <p className="text-xs text-slate-400">
          Rigorous out-of-sample backtesting metrics, Brier scores, log loss, and probability calibration reliability.
        </p>
      </div>

      {/* Primary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Brier Score */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
            <span className="font-semibold uppercase tracking-wider">Brier Score</span>
            <span className="text-[10px] bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded border border-emerald-500/20 font-mono">
              0.0 = Perfect
            </span>
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold text-white font-mono mb-2">
            {report.overallBrierScore}
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Measures mean squared error of probabilistic predictions. Lower is superior (0.25 represents an uninformative 50/50 baseline).
          </p>
        </div>

        {/* Log Loss */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
            <span className="font-semibold uppercase tracking-wider">Log Loss (Cross-Entropy)</span>
            <span className="text-[10px] bg-sky-500/10 text-sky-400 px-2 py-0.5 rounded border border-sky-500/20 font-mono">
              Calibrated
            </span>
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold text-white font-mono mb-2">
            {report.overallLogLoss}
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Penalizes overconfident false predictions exponentially. Reflects honest epistemic uncertainty.
          </p>
        </div>

        {/* Empirical Hit Rate */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
            <span className="font-semibold uppercase tracking-wider">Overall Hit Rate</span>
            <span className="text-[10px] bg-purple-500/10 text-purple-400 px-2 py-0.5 rounded border border-purple-500/20 font-mono">
              Empirical
            </span>
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold text-emerald-400 font-mono mb-2">
            {(report.overallHitRate * 100).toFixed(1)}%
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Proportion of evaluated binary market predictions correctly validated against official full-time scorelines.
          </p>
        </div>
      </div>

      {/* Calibration Reliability Diagram */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-bold text-white">Probability Calibration Curve (Reliability Diagram)</h3>
            <p className="text-xs text-slate-400">
              When the engine predicts an event with 70% probability, does it occur 70% of the time in reality?
            </p>
          </div>
          <div className="text-[11px] text-slate-400 font-mono hidden sm:block">
            Target: Observed = Predicted
          </div>
        </div>

        <div className="space-y-4">
          {report.calibrationBuckets.map((bucket, idx) => {
            const predPct = (bucket.predictedMean * 100).toFixed(1);
            const obsPct = (bucket.observedFrequency * 100).toFixed(1);
            const delta = (bucket.observedFrequency - bucket.predictedMean) * 100;

            return (
              <div key={idx} className="bg-slate-950 p-4 rounded-xl border border-slate-800/80">
                <div className="flex items-center justify-between text-xs mb-2">
                  <span className="font-bold text-white">{bucket.bucketLabel} Predicted Bucket</span>
                  <div className="flex items-center space-x-3 text-xs font-mono">
                    <span className="text-slate-400">Predicted: <strong className="text-white">{predPct}%</strong></span>
                    <span className="text-slate-400">Observed: <strong className="text-emerald-400">{obsPct}%</strong></span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${Math.abs(delta) < 2 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
                      {delta > 0 ? `+${delta.toFixed(1)}%` : `${delta.toFixed(1)}%`}
                    </span>
                  </div>
                </div>

                {/* Progress Visualizer */}
                <div className="relative w-full bg-slate-800 rounded-full h-3 overflow-hidden">
                  {/* Predicted Mean Marker */}
                  <div
                    className="absolute top-0 bottom-0 bg-sky-500/40 rounded-full"
                    style={{ width: `${bucket.predictedMean * 100}%` }}
                  />
                  {/* Observed Frequency Bar */}
                  <div
                    className="absolute top-0 bottom-0 bg-emerald-500 rounded-full"
                    style={{ width: `${bucket.observedFrequency * 100}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* League Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Premier League */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <span className="font-bold text-white text-sm">Premier League (EPL)</span>
            <span className="text-xs px-2 py-0.5 rounded bg-purple-500/20 text-purple-400 font-mono">
              20 Clubs
            </span>
          </div>
          <div className="grid grid-cols-2 gap-4 text-xs">
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
              <div className="text-slate-500 text-[10px] uppercase font-semibold">Brier Score</div>
              <div className="text-xl font-bold font-mono text-white mt-1">
                {report.leagueBreakdown.EPL.brierScore}
              </div>
            </div>
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
              <div className="text-slate-500 text-[10px] uppercase font-semibold">Hit Rate</div>
              <div className="text-xl font-bold font-mono text-emerald-400 mt-1">
                {(report.leagueBreakdown.EPL.hitRate * 100).toFixed(1)}%
              </div>
            </div>
          </div>
        </div>

        {/* Championship */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <span className="font-bold text-white text-sm">EFL Championship</span>
            <span className="text-xs px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 font-mono">
              24 Clubs
            </span>
          </div>
          <div className="grid grid-cols-2 gap-4 text-xs">
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
              <div className="text-slate-500 text-[10px] uppercase font-semibold">Brier Score</div>
              <div className="text-xl font-bold font-mono text-white mt-1">
                {report.leagueBreakdown.CHAMPIONSHIP.brierScore}
              </div>
            </div>
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
              <div className="text-slate-500 text-[10px] uppercase font-semibold">Hit Rate</div>
              <div className="text-xl font-bold font-mono text-emerald-400 mt-1">
                {(report.leagueBreakdown.CHAMPIONSHIP.hitRate * 100).toFixed(1)}%
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
