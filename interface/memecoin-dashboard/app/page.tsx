'use client';

import { useEffect, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

interface BotStatus {
  isRunning: boolean;
  isPaused: boolean;
  tradingEnabled: boolean;
  paperTradingMode: boolean;
  uptime: number;
  startTime: string;
}

interface MarketStatus {
  regime: string;
  reason: string;
  solChange24h: number;
  btcChange24h: number;
}

interface TradingStatus {
  dailyPnL: number;
  openPositions: number;
  losingStreak: number;
  cooldownActive: boolean;
}

interface PositionsStatus {
  open: number;
  totalTrades: number;
  winRate: number;
  totalPnL: number;
}

interface SystemStats {
  bot: BotStatus;
  market: MarketStatus;
  trading: TradingStatus;
  positions: PositionsStatus;
}

function getStatusDisplay(stats: SystemStats | null): { label: string; color: string } {
  if (!stats) return { label: 'UNKNOWN', color: 'bg-zinc-500/20 text-zinc-400' };

  if (stats.bot.isPaused) {
    return { label: 'PAUSED', color: 'bg-yellow-500/20 text-yellow-400' };
  }
  if (stats.bot.isRunning) {
    return { label: 'RUNNING', color: 'bg-green-500/20 text-green-400' };
  }
  return { label: 'STOPPED', color: 'bg-red-500/20 text-red-400' };
}

function getRegimeColor(regime: string): string {
  switch (regime?.toUpperCase()) {
    case 'FULL':
      return 'text-green-400';
    case 'CAUTIOUS':
      return 'text-yellow-400';
    case 'DEFENSIVE':
      return 'text-orange-400';
    case 'PAUSE':
      return 'text-red-400';
    default:
      return 'text-zinc-400';
  }
}

export default function Home() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await fetch(`${API_URL}/status`);
        if (!response.ok) throw new Error('Failed to fetch');
        const data = await response.json();
        if (data.success && data.data) {
          setStats(data.data);
        }
        setError(null);
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to connect to backend API';
        console.error('Error fetching stats:', err);
        setError(errorMessage);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950 text-white">
        <div className="text-center">
          <div className="mx-auto mb-4 h-16 w-16 animate-spin rounded-full border-b-2 border-white"></div>
          <p className="text-zinc-400">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950 text-white">
        <div className="text-center max-w-md">
          <div className="mb-4 text-6xl">⚠️</div>
          <h2 className="mb-2 text-xl font-semibold text-red-400">Connection Error</h2>
          <p className="text-zinc-400 mb-4">{error}</p>
          <div className="bg-zinc-800/50 rounded-lg p-4 text-left">
            <p className="text-sm text-zinc-500 mb-2">Troubleshooting:</p>
            <ul className="text-sm text-zinc-400 list-disc list-inside space-y-1">
              <li>Verify backend is running</li>
              <li>Check API URL: <code className="text-xs bg-zinc-700 px-1 rounded">{API_URL}</code></li>
              <li>Ensure CORS is configured</li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  const statusDisplay = getStatusDisplay(stats);
  const uptime = stats?.bot?.uptime || 0;
  const uptimeHours = Math.floor(uptime / 3600);
  const uptimeMinutes = Math.floor((uptime % 3600) / 60);

  return (
    <div className="min-h-screen bg-gray-950 p-6 text-white">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <header className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-white">Dashboard</h1>
              <p className="text-zinc-500 mt-1">Real-time trading bot overview</p>
            </div>
            <div className="flex items-center gap-4">
              {stats?.bot?.paperTradingMode && (
                <span className="bg-blue-500/20 text-blue-400 px-3 py-1 rounded-full text-sm font-medium">
                  Paper Trading
                </span>
              )}
              <span className={`px-3 py-1 rounded-full text-sm font-medium ${statusDisplay.color}`}>
                {statusDisplay.label}
              </span>
            </div>
          </div>
        </header>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {/* Uptime Card */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-zinc-400">Uptime</h3>
              <span className="text-zinc-600">⏱️</span>
            </div>
            <p className="text-2xl font-bold text-white">
              {uptimeHours}h {uptimeMinutes}m
            </p>
            <p className="text-xs text-zinc-500 mt-1">
              Since {stats?.bot?.startTime ? new Date(stats.bot.startTime).toLocaleTimeString() : 'N/A'}
            </p>
          </div>

          {/* Market Regime Card */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-zinc-400">Market Regime</h3>
              <span className="text-zinc-600">📊</span>
            </div>
            <p className={`text-2xl font-bold ${getRegimeColor(stats?.market?.regime || '')}`}>
              {stats?.market?.regime?.toUpperCase() || 'UNKNOWN'}
            </p>
            <p className="text-xs text-zinc-500 mt-1 truncate" title={stats?.market?.reason}>
              {stats?.market?.reason || 'No data'}
            </p>
          </div>

          {/* Open Positions Card */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-zinc-400">Open Positions</h3>
              <span className="text-zinc-600">📈</span>
            </div>
            <p className="text-2xl font-bold text-white">
              {stats?.positions?.open || 0}
            </p>
            <p className="text-xs text-zinc-500 mt-1">
              Active trades
            </p>
          </div>

          {/* Total P&L Card */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-zinc-400">Total P&L</h3>
              <span className="text-zinc-600">💰</span>
            </div>
            <p className={`text-2xl font-bold ${(stats?.positions?.totalPnL || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {(stats?.positions?.totalPnL || 0) >= 0 ? '+' : ''}
              ${(stats?.positions?.totalPnL || 0).toFixed(2)}
            </p>
            <p className="text-xs text-zinc-500 mt-1">All time</p>
          </div>

          {/* Daily P&L Card */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-zinc-400">Daily P&L</h3>
              <span className="text-zinc-600">📅</span>
            </div>
            <p className={`text-2xl font-bold ${(stats?.trading?.dailyPnL || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {(stats?.trading?.dailyPnL || 0) >= 0 ? '+' : ''}
              ${(stats?.trading?.dailyPnL || 0).toFixed(2)}
            </p>
            <p className="text-xs text-zinc-500 mt-1">Today</p>
          </div>

          {/* Win Rate Card */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-zinc-400">Win Rate</h3>
              <span className="text-zinc-600">🎯</span>
            </div>
            <p className="text-2xl font-bold text-white">
              {((stats?.positions?.winRate || 0) * 100).toFixed(1)}%
            </p>
            <p className="text-xs text-zinc-500 mt-1">
              {stats?.positions?.totalTrades || 0} total trades
            </p>
          </div>

          {/* SOL Change Card */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-zinc-400">SOL 24h</h3>
              <span className="text-zinc-600">◎</span>
            </div>
            <p className={`text-2xl font-bold ${(stats?.market?.solChange24h || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {(stats?.market?.solChange24h || 0) >= 0 ? '+' : ''}
              {(stats?.market?.solChange24h || 0).toFixed(2)}%
            </p>
            <p className="text-xs text-zinc-500 mt-1">Price change</p>
          </div>

          {/* BTC Change Card */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-zinc-400">BTC 24h</h3>
              <span className="text-zinc-600">₿</span>
            </div>
            <p className={`text-2xl font-bold ${(stats?.market?.btcChange24h || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {(stats?.market?.btcChange24h || 0) >= 0 ? '+' : ''}
              {(stats?.market?.btcChange24h || 0).toFixed(2)}%
            </p>
            <p className="text-xs text-zinc-500 mt-1">Price change</p>
          </div>
        </div>

        {/* Status Indicators */}
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Trading Status */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <h3 className="text-sm font-medium text-zinc-400 mb-4">Trading Status</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${stats?.bot?.tradingEnabled ? 'bg-green-400' : 'bg-red-400'}`}></div>
                <span className="text-sm text-zinc-300">Trading {stats?.bot?.tradingEnabled ? 'Enabled' : 'Disabled'}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${stats?.trading?.cooldownActive ? 'bg-yellow-400' : 'bg-zinc-600'}`}></div>
                <span className="text-sm text-zinc-300">Cooldown {stats?.trading?.cooldownActive ? 'Active' : 'Inactive'}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${(stats?.trading?.losingStreak || 0) >= 3 ? 'bg-red-400' : 'bg-zinc-600'}`}></div>
                <span className="text-sm text-zinc-300">Losing Streak: {stats?.trading?.losingStreak || 0}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${stats?.bot?.paperTradingMode ? 'bg-blue-400' : 'bg-zinc-600'}`}></div>
                <span className="text-sm text-zinc-300">{stats?.bot?.paperTradingMode ? 'Paper Mode' : 'Live Mode'}</span>
              </div>
            </div>
          </div>

          {/* Connection Status */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <h3 className="text-sm font-medium text-zinc-400 mb-4">Connection Status</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-zinc-300">API Connection</span>
                <span className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-400"></div>
                  <span className="text-sm text-green-400">Connected</span>
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-zinc-300">API Endpoint</span>
                <code className="text-xs bg-zinc-800 px-2 py-1 rounded text-zinc-400">{API_URL}</code>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-zinc-300">Auto-refresh</span>
                <span className="text-sm text-zinc-400">Every 5 seconds</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
