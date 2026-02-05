'use client';

import { useEffect, useState } from 'react';
import { Brain, RefreshCw, TrendingUp, TrendingDown, RotateCcw, Lock, Unlock, Info } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

interface CategoryWeight {
  name: string;
  weight: number;
  defaultWeight: number;
  predictivePower: number;
  isLocked: boolean;
}

interface ParameterValue {
  name: string;
  category: string;
  currentValue: number;
  defaultValue: number;
  minValue: number;
  maxValue: number;
  lastAdjusted: string | null;
  adjustmentReason: string | null;
  isLocked: boolean;
}

interface LearningStats {
  totalTrades: number;
  tradesAnalyzed: number;
  lastOptimization: string | null;
  nextOptimization: number;
  totalAdjustments: number;
  driftFromBaseline: number;
  learningMode: 'active' | 'shadow' | 'paused';
}

interface PatternMatch {
  pattern: string;
  matchCount: number;
  winRate: number;
  avgReturn: number;
}

interface LearningData {
  stats: LearningStats;
  weights: CategoryWeight[];
  parameters: ParameterValue[];
  dangerPatterns: PatternMatch[];
  winPatterns: PatternMatch[];
}

export default function LearningPage() {
  const [data, setData] = useState<LearningData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      const response = await fetch(`${API_URL}/learning`);
      if (!response.ok) throw new Error('Failed to fetch');
      const result = await response.json();
      if (result.success) {
        setData(result.data);
      }
      setError(null);
    } catch (err) {
      console.error('Error fetching learning data:', err);
      setError('Failed to fetch learning engine data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  const toggleLock = async (type: 'weight' | 'parameter', name: string, currentLocked: boolean) => {
    setActionLoading(`${type}-${name}`);
    try {
      const response = await fetch(`${API_URL}/learning/${type}/${encodeURIComponent(name)}/lock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locked: !currentLocked }),
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error);
      await fetchData();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to toggle lock';
      setError(message);
    } finally {
      setActionLoading(null);
    }
  };

  const resetToDefault = async (type: 'weight' | 'parameter', name: string) => {
    setActionLoading(`reset-${type}-${name}`);
    try {
      const response = await fetch(`${API_URL}/learning/${type}/${encodeURIComponent(name)}/reset`, {
        method: 'POST',
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error);
      await fetchData();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to reset';
      setError(message);
    } finally {
      setActionLoading(null);
    }
  };

  const setLearningMode = async (mode: 'active' | 'shadow' | 'paused') => {
    setActionLoading(`mode-${mode}`);
    try {
      const response = await fetch(`${API_URL}/learning/mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error);
      await fetchData();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to change mode';
      setError(message);
    } finally {
      setActionLoading(null);
    }
  };

  const revertToSnapshot = async () => {
    if (!confirm('Are you sure you want to revert to the previous snapshot? This cannot be undone.')) return;

    setActionLoading('revert');
    try {
      const response = await fetch(`${API_URL}/learning/revert`, { method: 'POST' });
      const result = await response.json();
      if (!result.success) throw new Error(result.error);
      await fetchData();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to revert';
      setError(message);
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950 text-white">
        <div className="text-center">
          <div className="mx-auto mb-4 h-16 w-16 animate-spin rounded-full border-b-2 border-white"></div>
          <p className="text-zinc-400">Loading learning engine...</p>
        </div>
      </div>
    );
  }

  const stats = data?.stats;
  const weights = data?.weights || [];
  const parameters = data?.parameters || [];

  return (
    <div className="min-h-screen bg-gray-950 p-6 text-white">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <header className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                <Brain className="h-8 w-8 text-purple-400" />
                Learning Engine
              </h1>
              <p className="text-zinc-500 mt-1">Monitor and control the adaptive learning system</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={fetchData}
                className="flex items-center gap-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 px-4 py-2 transition-colors"
              >
                <RefreshCw className="h-4 w-4" />
                Refresh
              </button>
              <button
                onClick={revertToSnapshot}
                disabled={actionLoading === 'revert'}
                className="flex items-center gap-2 rounded-lg bg-yellow-600 hover:bg-yellow-700 px-4 py-2 transition-colors disabled:opacity-50"
              >
                <RotateCcw className="h-4 w-4" />
                Revert
              </button>
            </div>
          </div>
        </header>

        {error && (
          <div className="mb-6 rounded-lg bg-red-500/10 border border-red-500/20 p-4">
            <p className="text-red-400">{error}</p>
          </div>
        )}

        {/* Stats Overview */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <h3 className="text-sm font-medium text-zinc-400 mb-2">Trades Analyzed</h3>
            <p className="text-2xl font-bold text-white">{stats?.tradesAnalyzed || 0}</p>
            <p className="text-xs text-zinc-500 mt-1">of {stats?.totalTrades || 0} total</p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <h3 className="text-sm font-medium text-zinc-400 mb-2">Next Optimization</h3>
            <p className="text-2xl font-bold text-white">{stats?.nextOptimization || 0}</p>
            <p className="text-xs text-zinc-500 mt-1">trades until next cycle</p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <h3 className="text-sm font-medium text-zinc-400 mb-2">Total Adjustments</h3>
            <p className="text-2xl font-bold text-white">{stats?.totalAdjustments || 0}</p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <h3 className="text-sm font-medium text-zinc-400 mb-2">Baseline Drift</h3>
            <p className={`text-2xl font-bold ${(stats?.driftFromBaseline || 0) > 30 ? 'text-yellow-400' : 'text-green-400'}`}>
              {(stats?.driftFromBaseline || 0).toFixed(1)}%
            </p>
          </div>
        </div>

        {/* Learning Mode */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Learning Mode</h2>
          <div className="flex gap-3">
            {(['active', 'shadow', 'paused'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setLearningMode(mode)}
                disabled={actionLoading?.startsWith('mode-')}
                className={`flex-1 py-3 rounded-lg text-sm font-medium transition-colors ${
                  stats?.learningMode === mode
                    ? mode === 'active' ? 'bg-green-600 text-white' :
                      mode === 'shadow' ? 'bg-yellow-600 text-white' :
                      'bg-red-600 text-white'
                    : 'bg-zinc-800 text-zinc-400 hover:text-white'
                }`}
              >
                {mode === 'active' && 'Active (Auto-adjust)'}
                {mode === 'shadow' && 'Shadow (Observe only)'}
                {mode === 'paused' && 'Paused (No learning)'}
              </button>
            ))}
          </div>
          <p className="text-xs text-zinc-500 mt-3">
            <Info className="h-3 w-3 inline mr-1" />
            Active mode applies adjustments automatically. Shadow mode calculates but doesn&apos;t apply. Paused stops all learning.
          </p>
        </div>

        {/* Category Weights */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Category Weights</h2>
          <p className="text-sm text-zinc-500 mb-4">
            These weights determine how much each category contributes to the conviction score.
          </p>

          <div className="space-y-4">
            {weights.map((weight) => {
              const diff = weight.weight - weight.defaultWeight;
              return (
                <div key={weight.name} className="flex items-center gap-4">
                  <div className="w-48">
                    <p className="text-sm font-medium text-zinc-300">{weight.name}</p>
                    <p className="text-xs text-zinc-500">
                      Default: {weight.defaultWeight}% | Power: {(weight.predictivePower * 100).toFixed(0)}%
                    </p>
                  </div>
                  <div className="flex-1">
                    <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          diff > 0 ? 'bg-green-500' : diff < 0 ? 'bg-red-500' : 'bg-blue-500'
                        }`}
                        style={{ width: `${weight.weight}%` }}
                      />
                    </div>
                  </div>
                  <div className="w-20 text-right">
                    <span className="text-lg font-bold text-white">{weight.weight}%</span>
                    {diff !== 0 && (
                      <span className={`text-xs ml-1 ${diff > 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {diff > 0 ? '+' : ''}{diff}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => toggleLock('weight', weight.name, weight.isLocked)}
                      disabled={actionLoading === `weight-${weight.name}`}
                      className={`p-2 rounded transition-colors ${
                        weight.isLocked ? 'text-yellow-400 bg-yellow-400/10' : 'text-zinc-500 hover:text-white'
                      }`}
                      title={weight.isLocked ? 'Unlock' : 'Lock'}
                    >
                      {weight.isLocked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
                    </button>
                    <button
                      onClick={() => resetToDefault('weight', weight.name)}
                      disabled={actionLoading === `reset-weight-${weight.name}` || weight.weight === weight.defaultWeight}
                      className="p-2 rounded text-zinc-500 hover:text-white transition-colors disabled:opacity-30"
                      title="Reset to default"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Key Parameters */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Optimized Parameters</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {parameters.slice(0, 8).map((param) => {
              const diff = param.currentValue - param.defaultValue;
              const range = param.maxValue - param.minValue;
              const position = ((param.currentValue - param.minValue) / range) * 100;

              return (
                <div key={param.name} className="p-4 rounded-lg bg-zinc-800/50">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="text-sm font-medium text-zinc-300">{param.name}</p>
                      <p className="text-xs text-zinc-500">{param.category}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-bold text-white">
                        {param.currentValue}
                        {param.name.includes('%') || param.name.includes('Rate') ? '%' : ''}
                      </span>
                      {diff !== 0 && (
                        <span className={`text-xs ${diff > 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {diff > 0 ? <TrendingUp className="h-3 w-3 inline" /> : <TrendingDown className="h-3 w-3 inline" />}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="relative h-2 bg-zinc-700 rounded-full mb-2">
                    <div
                      className="absolute h-full bg-purple-500 rounded-full"
                      style={{ width: `${position}%` }}
                    />
                    <div
                      className="absolute w-1 h-4 bg-zinc-400 rounded -top-1"
                      style={{ left: `${((param.defaultValue - param.minValue) / range) * 100}%` }}
                      title={`Default: ${param.defaultValue}`}
                    />
                  </div>

                  <div className="flex items-center justify-between text-xs text-zinc-500">
                    <span>{param.minValue}</span>
                    <span>Default: {param.defaultValue}</span>
                    <span>{param.maxValue}</span>
                  </div>

                  {param.adjustmentReason && (
                    <p className="text-xs text-zinc-500 mt-2 italic">{param.adjustmentReason}</p>
                  )}

                  <div className="flex gap-1 mt-2">
                    <button
                      onClick={() => toggleLock('parameter', param.name, param.isLocked)}
                      disabled={actionLoading === `parameter-${param.name}`}
                      className={`p-1.5 rounded text-xs transition-colors ${
                        param.isLocked ? 'text-yellow-400 bg-yellow-400/10' : 'text-zinc-500 hover:text-white'
                      }`}
                    >
                      {param.isLocked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
                    </button>
                    <button
                      onClick={() => resetToDefault('parameter', param.name)}
                      disabled={actionLoading === `reset-parameter-${param.name}` || param.currentValue === param.defaultValue}
                      className="p-1.5 rounded text-xs text-zinc-500 hover:text-white transition-colors disabled:opacity-30"
                    >
                      <RotateCcw className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Pattern Libraries */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Win Patterns */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
            <h2 className="text-lg font-semibold mb-4 text-green-400">Win Patterns</h2>
            <div className="space-y-3">
              {(data?.winPatterns || []).slice(0, 5).map((pattern, i) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-green-500/10">
                  <div>
                    <p className="text-sm text-zinc-300">{pattern.pattern}</p>
                    <p className="text-xs text-zinc-500">{pattern.matchCount} matches</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-green-400">{(pattern.winRate * 100).toFixed(0)}%</p>
                    <p className="text-xs text-zinc-500">+{(pattern.avgReturn * 100).toFixed(1)}% avg</p>
                  </div>
                </div>
              ))}
              {(!data?.winPatterns || data.winPatterns.length === 0) && (
                <p className="text-zinc-500 text-sm">No win patterns identified yet.</p>
              )}
            </div>
          </div>

          {/* Danger Patterns */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
            <h2 className="text-lg font-semibold mb-4 text-red-400">Danger Patterns</h2>
            <div className="space-y-3">
              {(data?.dangerPatterns || []).slice(0, 5).map((pattern, i) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-red-500/10">
                  <div>
                    <p className="text-sm text-zinc-300">{pattern.pattern}</p>
                    <p className="text-xs text-zinc-500">{pattern.matchCount} matches</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-red-400">{(pattern.winRate * 100).toFixed(0)}%</p>
                    <p className="text-xs text-zinc-500">{(pattern.avgReturn * 100).toFixed(1)}% avg</p>
                  </div>
                </div>
              ))}
              {(!data?.dangerPatterns || data.dangerPatterns.length === 0) && (
                <p className="text-zinc-500 text-sm">No danger patterns identified yet.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
