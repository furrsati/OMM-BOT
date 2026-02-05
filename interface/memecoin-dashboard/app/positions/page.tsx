'use client';

import { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, RefreshCw, X, DollarSign, Clock, Target } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

interface Position {
  id: string;
  tokenAddress: string;
  tokenName: string;
  tokenSymbol: string;
  entryPrice: number;
  currentPrice: number;
  quantity: number;
  entryTime: string;
  pnl: number;
  pnlPercent: number;
  stopLoss: number;
  takeProfit: number[];
  convictionScore: number;
  smartWalletCount: number;
}

export default function PositionsPage() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [closingPosition, setClosingPosition] = useState<string | null>(null);

  const fetchPositions = async () => {
    try {
      const response = await fetch(`${API_URL}/positions`);
      if (!response.ok) throw new Error('Failed to fetch');
      const data = await response.json();
      if (data.success) {
        setPositions(data.data || []);
      }
      setError(null);
    } catch (err) {
      console.error('Error fetching positions:', err);
      setError('Failed to fetch positions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPositions();
    const interval = setInterval(fetchPositions, 5000);
    return () => clearInterval(interval);
  }, []);

  const closePosition = async (positionId: string) => {
    setClosingPosition(positionId);
    try {
      const response = await fetch(`${API_URL}/positions/${positionId}/close`, {
        method: 'POST',
      });
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to close position');
      }
      await fetchPositions();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to close position';
      setError(message);
    } finally {
      setClosingPosition(null);
    }
  };

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);

    if (diffHours > 0) {
      return `${diffHours}h ${diffMins % 60}m ago`;
    }
    return `${diffMins}m ago`;
  };

  const formatUSD = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950 text-white">
        <div className="text-center">
          <div className="mx-auto mb-4 h-16 w-16 animate-spin rounded-full border-b-2 border-white"></div>
          <p className="text-zinc-400">Loading positions...</p>
        </div>
      </div>
    );
  }

  const totalPnl = positions.reduce((sum, p) => sum + p.pnl, 0);
  const totalValue = positions.reduce((sum, p) => sum + (p.currentPrice * p.quantity), 0);

  return (
    <div className="min-h-screen bg-gray-950 p-6 text-white">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <header className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-white">Open Positions</h1>
              <p className="text-zinc-500 mt-1">Monitor and manage your active trades</p>
            </div>
            <button
              onClick={fetchPositions}
              className="flex items-center gap-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 px-4 py-2 transition-colors"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
          </div>
        </header>

        {error && (
          <div className="mb-6 rounded-lg bg-red-500/10 border border-red-500/20 p-4">
            <p className="text-red-400">{error}</p>
          </div>
        )}

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-zinc-400">Open Positions</h3>
              <TrendingUp className="h-5 w-5 text-zinc-600" />
            </div>
            <p className="text-2xl font-bold text-white">{positions.length}</p>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-zinc-400">Total Value</h3>
              <DollarSign className="h-5 w-5 text-zinc-600" />
            </div>
            <p className="text-2xl font-bold text-white">{formatUSD(totalValue)}</p>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-zinc-400">Unrealized P&L</h3>
              {totalPnl >= 0 ? (
                <TrendingUp className="h-5 w-5 text-green-500" />
              ) : (
                <TrendingDown className="h-5 w-5 text-red-500" />
              )}
            </div>
            <p className={`text-2xl font-bold ${totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {totalPnl >= 0 ? '+' : ''}{formatUSD(totalPnl)}
            </p>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-zinc-400">Avg Conviction</h3>
              <Target className="h-5 w-5 text-zinc-600" />
            </div>
            <p className="text-2xl font-bold text-white">
              {positions.length > 0
                ? Math.round(positions.reduce((sum, p) => sum + p.convictionScore, 0) / positions.length)
                : 0}
            </p>
          </div>
        </div>

        {/* Positions Table */}
        {positions.length === 0 ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-12 text-center">
            <TrendingUp className="h-12 w-12 text-zinc-600 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-zinc-300 mb-2">No Open Positions</h3>
            <p className="text-zinc-500">The bot will open positions when good opportunities are detected.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-zinc-800 text-left">
                  <th className="px-6 py-4 text-sm font-medium text-zinc-400">Token</th>
                  <th className="px-6 py-4 text-sm font-medium text-zinc-400">Entry Price</th>
                  <th className="px-6 py-4 text-sm font-medium text-zinc-400">Current Price</th>
                  <th className="px-6 py-4 text-sm font-medium text-zinc-400">P&L</th>
                  <th className="px-6 py-4 text-sm font-medium text-zinc-400">Duration</th>
                  <th className="px-6 py-4 text-sm font-medium text-zinc-400">Conviction</th>
                  <th className="px-6 py-4 text-sm font-medium text-zinc-400">Actions</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((position) => (
                  <tr key={position.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                    <td className="px-6 py-4">
                      <div>
                        <p className="font-medium text-white">{position.tokenSymbol}</p>
                        <p className="text-xs text-zinc-500">{position.tokenName}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-zinc-300">${position.entryPrice.toFixed(8)}</p>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-zinc-300">${position.currentPrice.toFixed(8)}</p>
                    </td>
                    <td className="px-6 py-4">
                      <div>
                        <p className={`font-medium ${position.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {position.pnl >= 0 ? '+' : ''}{formatUSD(position.pnl)}
                        </p>
                        <p className={`text-xs ${position.pnlPercent >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                          {position.pnlPercent >= 0 ? '+' : ''}{position.pnlPercent.toFixed(2)}%
                        </p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 text-zinc-400">
                        <Clock className="h-4 w-4" />
                        <span className="text-sm">{formatTime(position.entryTime)}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        position.convictionScore >= 85 ? 'bg-green-500/20 text-green-400' :
                        position.convictionScore >= 70 ? 'bg-yellow-500/20 text-yellow-400' :
                        'bg-zinc-500/20 text-zinc-400'
                      }`}>
                        {position.convictionScore}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <button
                        onClick={() => closePosition(position.id)}
                        disabled={closingPosition === position.id}
                        className="flex items-center gap-1 rounded bg-red-600/20 hover:bg-red-600/40 text-red-400 px-3 py-1.5 text-sm transition-colors disabled:opacity-50"
                      >
                        {closingPosition === position.id ? (
                          <RefreshCw className="h-4 w-4 animate-spin" />
                        ) : (
                          <X className="h-4 w-4" />
                        )}
                        Close
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Position Details Cards (for mobile) */}
        <div className="mt-6 space-y-4 lg:hidden">
          {positions.map((position) => (
            <div key={position.id} className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="font-semibold text-white">{position.tokenSymbol}</p>
                  <p className="text-xs text-zinc-500">{position.tokenName}</p>
                </div>
                <span className={`px-2 py-1 rounded text-xs font-medium ${
                  position.pnlPercent >= 0 ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                }`}>
                  {position.pnlPercent >= 0 ? '+' : ''}{position.pnlPercent.toFixed(2)}%
                </span>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm mb-4">
                <div>
                  <p className="text-zinc-500">Entry</p>
                  <p className="text-zinc-300">${position.entryPrice.toFixed(8)}</p>
                </div>
                <div>
                  <p className="text-zinc-500">Current</p>
                  <p className="text-zinc-300">${position.currentPrice.toFixed(8)}</p>
                </div>
                <div>
                  <p className="text-zinc-500">P&L</p>
                  <p className={position.pnl >= 0 ? 'text-green-400' : 'text-red-400'}>
                    {formatUSD(position.pnl)}
                  </p>
                </div>
                <div>
                  <p className="text-zinc-500">Duration</p>
                  <p className="text-zinc-300">{formatTime(position.entryTime)}</p>
                </div>
              </div>
              <button
                onClick={() => closePosition(position.id)}
                disabled={closingPosition === position.id}
                className="w-full flex items-center justify-center gap-2 rounded bg-red-600/20 hover:bg-red-600/40 text-red-400 px-3 py-2 text-sm transition-colors disabled:opacity-50"
              >
                {closingPosition === position.id ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <X className="h-4 w-4" />
                )}
                Close Position
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
