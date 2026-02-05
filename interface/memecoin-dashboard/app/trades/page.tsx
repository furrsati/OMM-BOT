'use client';

import { useEffect, useState } from 'react';
import { BarChart3, TrendingUp, TrendingDown, Filter, Download, RefreshCw } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

interface Trade {
  id: string;
  tokenAddress: string;
  tokenName: string;
  tokenSymbol: string;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  entryTime: string;
  exitTime: string;
  pnl: number;
  pnlPercent: number;
  exitReason: string;
  convictionScore: number;
  smartWalletCount: number;
}

interface TradeStats {
  totalTrades: number;
  winRate: number;
  totalPnL: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  bestTrade: number;
  worstTrade: number;
}

type FilterType = 'all' | 'wins' | 'losses';
type TimeFilter = 'all' | 'today' | 'week' | 'month';

export default function TradesPage() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [stats, setStats] = useState<TradeStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>('all');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');

  const fetchTrades = async () => {
    try {
      const response = await fetch(`${API_URL}/trades?filter=${filter}&time=${timeFilter}`);
      if (!response.ok) throw new Error('Failed to fetch');
      const data = await response.json();
      if (data.success) {
        setTrades(data.data?.trades || []);
        setStats(data.data?.stats || null);
      }
      setError(null);
    } catch (err) {
      console.error('Error fetching trades:', err);
      setError('Failed to fetch trade history');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTrades();
  }, [filter, timeFilter]);

  const formatTime = (isoString: string) => {
    return new Date(isoString).toLocaleString();
  };

  const formatUSD = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const exportTrades = () => {
    const csv = [
      ['Token', 'Entry Price', 'Exit Price', 'P&L', 'P&L %', 'Entry Time', 'Exit Time', 'Exit Reason', 'Conviction'].join(','),
      ...trades.map(t => [
        t.tokenSymbol,
        t.entryPrice,
        t.exitPrice,
        t.pnl,
        t.pnlPercent,
        t.entryTime,
        t.exitTime,
        t.exitReason,
        t.convictionScore
      ].join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trades-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950 text-white">
        <div className="text-center">
          <div className="mx-auto mb-4 h-16 w-16 animate-spin rounded-full border-b-2 border-white"></div>
          <p className="text-zinc-400">Loading trade history...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 p-6 text-white">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <header className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-white">Trade History</h1>
              <p className="text-zinc-500 mt-1">View and analyze your completed trades</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={fetchTrades}
                className="flex items-center gap-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 px-4 py-2 transition-colors"
              >
                <RefreshCw className="h-4 w-4" />
                Refresh
              </button>
              <button
                onClick={exportTrades}
                className="flex items-center gap-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 px-4 py-2 transition-colors"
              >
                <Download className="h-4 w-4" />
                Export
              </button>
            </div>
          </div>
        </header>

        {error && (
          <div className="mb-6 rounded-lg bg-red-500/10 border border-red-500/20 p-4">
            <p className="text-red-400">{error}</p>
          </div>
        )}

        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
              <h3 className="text-sm font-medium text-zinc-400 mb-2">Total Trades</h3>
              <p className="text-2xl font-bold text-white">{stats.totalTrades}</p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
              <h3 className="text-sm font-medium text-zinc-400 mb-2">Win Rate</h3>
              <p className={`text-2xl font-bold ${stats.winRate >= 0.4 ? 'text-green-400' : 'text-yellow-400'}`}>
                {(stats.winRate * 100).toFixed(1)}%
              </p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
              <h3 className="text-sm font-medium text-zinc-400 mb-2">Total P&L</h3>
              <p className={`text-2xl font-bold ${stats.totalPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {formatUSD(stats.totalPnL)}
              </p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
              <h3 className="text-sm font-medium text-zinc-400 mb-2">Profit Factor</h3>
              <p className={`text-2xl font-bold ${stats.profitFactor >= 1.5 ? 'text-green-400' : 'text-yellow-400'}`}>
                {stats.profitFactor.toFixed(2)}
              </p>
            </div>
          </div>
        )}

        {/* Additional Stats */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
              <h3 className="text-xs font-medium text-zinc-500 mb-1">Avg Winner</h3>
              <p className="text-lg font-semibold text-green-400">{formatUSD(stats.avgWin)}</p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
              <h3 className="text-xs font-medium text-zinc-500 mb-1">Avg Loser</h3>
              <p className="text-lg font-semibold text-red-400">{formatUSD(stats.avgLoss)}</p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
              <h3 className="text-xs font-medium text-zinc-500 mb-1">Best Trade</h3>
              <p className="text-lg font-semibold text-green-400">{formatUSD(stats.bestTrade)}</p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
              <h3 className="text-xs font-medium text-zinc-500 mb-1">Worst Trade</h3>
              <p className="text-lg font-semibold text-red-400">{formatUSD(stats.worstTrade)}</p>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-4 mb-6">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-zinc-500" />
            <div className="flex rounded-lg bg-zinc-800 p-1">
              {(['all', 'wins', 'losses'] as FilterType[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1 rounded text-sm transition-colors ${
                    filter === f ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="flex rounded-lg bg-zinc-800 p-1">
            {(['all', 'today', 'week', 'month'] as TimeFilter[]).map((t) => (
              <button
                key={t}
                onClick={() => setTimeFilter(t)}
                className={`px-3 py-1 rounded text-sm transition-colors ${
                  timeFilter === t ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'
                }`}
              >
                {t === 'all' ? 'All Time' : t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Trades Table */}
        {trades.length === 0 ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-12 text-center">
            <BarChart3 className="h-12 w-12 text-zinc-600 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-zinc-300 mb-2">No Trades Found</h3>
            <p className="text-zinc-500">Completed trades will appear here.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-zinc-800 text-left">
                    <th className="px-6 py-4 text-sm font-medium text-zinc-400">Token</th>
                    <th className="px-6 py-4 text-sm font-medium text-zinc-400">Entry</th>
                    <th className="px-6 py-4 text-sm font-medium text-zinc-400">Exit</th>
                    <th className="px-6 py-4 text-sm font-medium text-zinc-400">P&L</th>
                    <th className="px-6 py-4 text-sm font-medium text-zinc-400">Exit Reason</th>
                    <th className="px-6 py-4 text-sm font-medium text-zinc-400">Conviction</th>
                    <th className="px-6 py-4 text-sm font-medium text-zinc-400">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((trade) => (
                    <tr key={trade.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          {trade.pnl >= 0 ? (
                            <TrendingUp className="h-4 w-4 text-green-500" />
                          ) : (
                            <TrendingDown className="h-4 w-4 text-red-500" />
                          )}
                          <div>
                            <p className="font-medium text-white">{trade.tokenSymbol}</p>
                            <p className="text-xs text-zinc-500">{trade.tokenName}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <p className="text-zinc-300">${trade.entryPrice.toFixed(8)}</p>
                      </td>
                      <td className="px-6 py-4">
                        <p className="text-zinc-300">${trade.exitPrice.toFixed(8)}</p>
                      </td>
                      <td className="px-6 py-4">
                        <div>
                          <p className={`font-medium ${trade.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {trade.pnl >= 0 ? '+' : ''}{formatUSD(trade.pnl)}
                          </p>
                          <p className={`text-xs ${trade.pnlPercent >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                            {trade.pnlPercent >= 0 ? '+' : ''}{trade.pnlPercent.toFixed(2)}%
                          </p>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          trade.exitReason === 'TAKE_PROFIT' ? 'bg-green-500/20 text-green-400' :
                          trade.exitReason === 'STOP_LOSS' ? 'bg-red-500/20 text-red-400' :
                          trade.exitReason === 'TRAILING_STOP' ? 'bg-yellow-500/20 text-yellow-400' :
                          trade.exitReason === 'EMERGENCY' ? 'bg-red-500/20 text-red-400' :
                          'bg-zinc-500/20 text-zinc-400'
                        }`}>
                          {trade.exitReason.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          trade.convictionScore >= 85 ? 'bg-green-500/20 text-green-400' :
                          trade.convictionScore >= 70 ? 'bg-yellow-500/20 text-yellow-400' :
                          'bg-zinc-500/20 text-zinc-400'
                        }`}>
                          {trade.convictionScore}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div>
                          <p className="text-xs text-zinc-400">{formatTime(trade.exitTime)}</p>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
