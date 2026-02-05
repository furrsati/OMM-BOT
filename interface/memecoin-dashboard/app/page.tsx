'use client';

import { useEffect, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api';

interface SystemStats {
  status: string;
  uptime: number;
  activeTrades: number;
  totalProfitLoss: number;
  winRate: number;
  totalTrades: number;
}

export default function Home() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await fetch(`${API_URL}/system/status`);
        if (!response.ok) throw new Error('Failed to fetch');
        const data = await response.json();
        setStats(data);
        setError(null);
      } catch (err: any) {
        console.error('Error fetching stats:', err);
        setError(err.message || 'Failed to fetch system stats');
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
      <div className="flex min-h-screen items-center justify-center bg-black text-white">
        <div className="text-center">
          <div className="mx-auto mb-4 h-16 w-16 animate-spin rounded-full border-b-2 border-white"></div>
          <p>Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black text-white">
        <div className="text-center">
          <div className="mb-4 text-xl text-red-500">⚠️ Connection Error</div>
          <p className="text-zinc-400">{error}</p>
          <p className="mt-2 text-sm text-zinc-500">
            Make sure the backend is running on port 3000
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black p-8 text-white">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8">
          <h1 className="mb-2 text-4xl font-bold">🤖 OURMM Trading Bot</h1>
          <p className="text-zinc-400">Meme Coin Trading Dashboard</p>
        </header>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {/* Status Card */}
          <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-6">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-zinc-300">
                System Status
              </h3>
              <span
                className={`rounded-full px-3 py-1 text-sm font-medium ${
                  stats?.status === 'running'
                    ? 'bg-green-500/20 text-green-400'
                    : stats?.status === 'paused'
                      ? 'bg-yellow-500/20 text-yellow-400'
                      : 'bg-red-500/20 text-red-400'
                }`}
              >
                {stats?.status?.toUpperCase()}
              </span>
            </div>
            <p className="mt-4 text-3xl font-bold">
              {stats?.uptime ? Math.floor(stats.uptime / 3600) : 0}h{' '}
              {stats?.uptime ? Math.floor((stats.uptime % 3600) / 60) : 0}m
            </p>
            <p className="text-sm text-zinc-400">Uptime</p>
          </div>

          {/* Active Trades Card */}
          <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-6">
            <h3 className="mb-2 text-lg font-semibold text-zinc-300">
              Active Trades
            </h3>
            <p className="mt-4 text-3xl font-bold">
              {stats?.activeTrades || 0}
            </p>
            <p className="text-sm text-zinc-400">Open Positions</p>
          </div>

          {/* P&L Card */}
          <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-6">
            <h3 className="mb-2 text-lg font-semibold text-zinc-300">
              Total P&L
            </h3>
            <p
              className={`mt-4 text-3xl font-bold ${
                (stats?.totalProfitLoss || 0) >= 0
                  ? 'text-green-400'
                  : 'text-red-400'
              }`}
            >
              {(stats?.totalProfitLoss || 0) >= 0 ? '+' : ''}$
              {(stats?.totalProfitLoss || 0).toFixed(2)}
            </p>
            <p className="text-sm text-zinc-400">All Time</p>
          </div>

          {/* Win Rate Card */}
          <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-6">
            <h3 className="mb-2 text-lg font-semibold text-zinc-300">
              Win Rate
            </h3>
            <p className="mt-4 text-3xl font-bold">
              {((stats?.winRate || 0) * 100).toFixed(1)}%
            </p>
            <p className="text-sm text-zinc-400">Success Rate</p>
          </div>

          {/* Total Trades Card */}
          <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-6">
            <h3 className="mb-2 text-lg font-semibold text-zinc-300">
              Total Trades
            </h3>
            <p className="mt-4 text-3xl font-bold">{stats?.totalTrades || 0}</p>
            <p className="text-sm text-zinc-400">Completed</p>
          </div>

          {/* API Status Card */}
          <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-6">
            <h3 className="mb-2 text-lg font-semibold text-zinc-300">
              API Connection
            </h3>
            <p className="mt-4 text-3xl font-bold text-green-400">✓</p>
            <p className="text-sm text-zinc-400">Connected</p>
          </div>
        </div>

        <footer className="mt-8 text-center text-sm text-zinc-500">
          <p>Dashboard refreshes every 5 seconds</p>
          <p className="mt-1">API: {API_URL}</p>
        </footer>
      </div>
    </div>
  );
}
