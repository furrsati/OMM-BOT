'use client';

import { useEffect, useState } from 'react';
import { Power, Pause, Play, AlertTriangle, RefreshCw, Zap } from 'lucide-react';

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
}

interface SystemStats {
  bot: BotStatus;
  market: MarketStatus;
}

export default function ControlsPage() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmKill, setConfirmKill] = useState(false);

  const fetchStats = async () => {
    try {
      const response = await fetch(`${API_URL}/status`);
      if (!response.ok) throw new Error('Failed to fetch');
      const data = await response.json();
      if (data.success && data.data) {
        setStats(data.data);
      }
      setError(null);
    } catch (err) {
      console.error('Error fetching stats:', err);
      setError('Failed to connect to backend API');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, []);

  const executeAction = async (action: string, body?: object) => {
    setActionLoading(action);
    try {
      const response = await fetch(`${API_URL}/bot/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || `Failed to ${action}`);
      }
      await fetchStats();
    } catch (err) {
      const message = err instanceof Error ? err.message : `Failed to ${action}`;
      setError(message);
    } finally {
      setActionLoading(null);
      setConfirmKill(false);
    }
  };

  const handleStart = () => executeAction('start');
  const handleStop = () => executeAction('stop');
  const handlePause = () => executeAction('pause');
  const handleResume = () => executeAction('resume');
  const handleKillSwitch = () => {
    if (confirmKill) {
      executeAction('kill');
    } else {
      setConfirmKill(true);
      setTimeout(() => setConfirmKill(false), 5000);
    }
  };
  const handleTogglePaperTrading = () => {
    executeAction('config', { paperTradingMode: !stats?.bot?.paperTradingMode });
  };
  const handleToggleTrading = () => {
    executeAction('config', { tradingEnabled: !stats?.bot?.tradingEnabled });
  };
  const handleSetRegime = (regime: string) => {
    executeAction('regime', { regime });
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950 text-white">
        <div className="text-center">
          <div className="mx-auto mb-4 h-16 w-16 animate-spin rounded-full border-b-2 border-white"></div>
          <p className="text-zinc-400">Loading controls...</p>
        </div>
      </div>
    );
  }

  const isRunning = stats?.bot?.isRunning || false;
  const isPaused = stats?.bot?.isPaused || false;
  const paperMode = stats?.bot?.paperTradingMode || false;
  const tradingEnabled = stats?.bot?.tradingEnabled || false;
  const currentRegime = stats?.market?.regime || 'UNKNOWN';

  return (
    <div className="min-h-screen bg-gray-950 p-6 text-white">
      <div className="mx-auto max-w-4xl">
        {/* Header */}
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-white">Bot Controls</h1>
          <p className="text-zinc-500 mt-1">Start, stop, and manage your trading bot</p>
        </header>

        {error && (
          <div className="mb-6 rounded-lg bg-red-500/10 border border-red-500/20 p-4">
            <p className="text-red-400">{error}</p>
          </div>
        )}

        {/* Main Control Panel */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 mb-6">
          <h2 className="text-lg font-semibold mb-6">Power Controls</h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Start/Stop Button */}
            {!isRunning ? (
              <button
                onClick={handleStart}
                disabled={actionLoading === 'start'}
                className="flex items-center justify-center gap-3 rounded-lg bg-green-600 hover:bg-green-700 disabled:bg-green-800 disabled:cursor-not-allowed p-4 transition-colors"
              >
                {actionLoading === 'start' ? (
                  <RefreshCw className="h-6 w-6 animate-spin" />
                ) : (
                  <Power className="h-6 w-6" />
                )}
                <span className="font-semibold">Start Bot</span>
              </button>
            ) : (
              <button
                onClick={handleStop}
                disabled={actionLoading === 'stop'}
                className="flex items-center justify-center gap-3 rounded-lg bg-red-600 hover:bg-red-700 disabled:bg-red-800 disabled:cursor-not-allowed p-4 transition-colors"
              >
                {actionLoading === 'stop' ? (
                  <RefreshCw className="h-6 w-6 animate-spin" />
                ) : (
                  <Power className="h-6 w-6" />
                )}
                <span className="font-semibold">Stop Bot</span>
              </button>
            )}

            {/* Pause/Resume Button */}
            {isRunning && !isPaused ? (
              <button
                onClick={handlePause}
                disabled={actionLoading === 'pause'}
                className="flex items-center justify-center gap-3 rounded-lg bg-yellow-600 hover:bg-yellow-700 disabled:bg-yellow-800 disabled:cursor-not-allowed p-4 transition-colors"
              >
                {actionLoading === 'pause' ? (
                  <RefreshCw className="h-6 w-6 animate-spin" />
                ) : (
                  <Pause className="h-6 w-6" />
                )}
                <span className="font-semibold">Pause Bot</span>
              </button>
            ) : isRunning && isPaused ? (
              <button
                onClick={handleResume}
                disabled={actionLoading === 'resume'}
                className="flex items-center justify-center gap-3 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed p-4 transition-colors"
              >
                {actionLoading === 'resume' ? (
                  <RefreshCw className="h-6 w-6 animate-spin" />
                ) : (
                  <Play className="h-6 w-6" />
                )}
                <span className="font-semibold">Resume Bot</span>
              </button>
            ) : (
              <div className="flex items-center justify-center gap-3 rounded-lg bg-zinc-800 p-4 text-zinc-500">
                <Pause className="h-6 w-6" />
                <span className="font-semibold">Pause (Stopped)</span>
              </div>
            )}

            {/* Kill Switch */}
            <button
              onClick={handleKillSwitch}
              disabled={actionLoading === 'kill'}
              className={`flex items-center justify-center gap-3 rounded-lg p-4 transition-colors ${
                confirmKill
                  ? 'bg-red-600 hover:bg-red-700 animate-pulse'
                  : 'bg-zinc-800 hover:bg-red-600'
              } disabled:cursor-not-allowed`}
            >
              {actionLoading === 'kill' ? (
                <RefreshCw className="h-6 w-6 animate-spin" />
              ) : (
                <AlertTriangle className="h-6 w-6" />
              )}
              <span className="font-semibold">
                {confirmKill ? 'Confirm Kill' : 'Kill Switch'}
              </span>
            </button>
          </div>

          {confirmKill && (
            <p className="text-center text-yellow-400 text-sm mt-4">
              Click again to confirm emergency shutdown (sells all positions)
            </p>
          )}
        </div>

        {/* Trading Mode Controls */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          {/* Paper Trading Toggle */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
            <h2 className="text-lg font-semibold mb-4">Trading Mode</h2>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-zinc-300">Paper Trading Mode</p>
                <p className="text-xs text-zinc-500 mt-1">
                  {paperMode ? 'Simulated trades only' : 'Real trades with real money'}
                </p>
              </div>
              <button
                onClick={handleTogglePaperTrading}
                disabled={actionLoading === 'config'}
                className={`relative w-14 h-7 rounded-full transition-colors ${
                  paperMode ? 'bg-blue-600' : 'bg-zinc-700'
                }`}
              >
                <span className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-transform ${
                  paperMode ? 'left-8' : 'left-1'
                }`} />
              </button>
            </div>
          </div>

          {/* Trading Enabled Toggle */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
            <h2 className="text-lg font-semibold mb-4">Trading Status</h2>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-zinc-300">Trading Enabled</p>
                <p className="text-xs text-zinc-500 mt-1">
                  {tradingEnabled ? 'Bot can execute trades' : 'Trading is disabled'}
                </p>
              </div>
              <button
                onClick={handleToggleTrading}
                disabled={actionLoading === 'config'}
                className={`relative w-14 h-7 rounded-full transition-colors ${
                  tradingEnabled ? 'bg-green-600' : 'bg-zinc-700'
                }`}
              >
                <span className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-transform ${
                  tradingEnabled ? 'left-8' : 'left-1'
                }`} />
              </button>
            </div>
          </div>
        </div>

        {/* Market Regime Override */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">Market Regime Override</h2>
              <p className="text-xs text-zinc-500 mt-1">
                Current: <span className="text-zinc-300">{currentRegime}</span>
              </p>
            </div>
            <Zap className="h-5 w-5 text-zinc-500" />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {['FULL', 'CAUTIOUS', 'DEFENSIVE', 'PAUSE'].map((regime) => (
              <button
                key={regime}
                onClick={() => handleSetRegime(regime)}
                disabled={actionLoading === 'regime'}
                className={`rounded-lg p-3 text-sm font-medium transition-colors ${
                  currentRegime === regime
                    ? regime === 'FULL' ? 'bg-green-600 text-white' :
                      regime === 'CAUTIOUS' ? 'bg-yellow-600 text-white' :
                      regime === 'DEFENSIVE' ? 'bg-orange-600 text-white' :
                      'bg-red-600 text-white'
                    : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                }`}
              >
                {regime}
              </button>
            ))}
          </div>
          <p className="text-xs text-zinc-500 mt-3">
            Override the automatic market regime detection. Use with caution.
          </p>
        </div>

        {/* Current Status Summary */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
          <h2 className="text-lg font-semibold mb-4">Current Status</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center p-4 rounded-lg bg-zinc-800/50">
              <div className={`w-4 h-4 rounded-full mx-auto mb-2 ${isRunning ? 'bg-green-400' : 'bg-red-400'}`} />
              <p className="text-sm text-zinc-400">Bot Status</p>
              <p className="font-semibold">{isRunning ? 'Running' : 'Stopped'}</p>
            </div>
            <div className="text-center p-4 rounded-lg bg-zinc-800/50">
              <div className={`w-4 h-4 rounded-full mx-auto mb-2 ${isPaused ? 'bg-yellow-400' : 'bg-zinc-600'}`} />
              <p className="text-sm text-zinc-400">Paused</p>
              <p className="font-semibold">{isPaused ? 'Yes' : 'No'}</p>
            </div>
            <div className="text-center p-4 rounded-lg bg-zinc-800/50">
              <div className={`w-4 h-4 rounded-full mx-auto mb-2 ${paperMode ? 'bg-blue-400' : 'bg-zinc-600'}`} />
              <p className="text-sm text-zinc-400">Mode</p>
              <p className="font-semibold">{paperMode ? 'Paper' : 'Live'}</p>
            </div>
            <div className="text-center p-4 rounded-lg bg-zinc-800/50">
              <div className={`w-4 h-4 rounded-full mx-auto mb-2 ${tradingEnabled ? 'bg-green-400' : 'bg-red-400'}`} />
              <p className="text-sm text-zinc-400">Trading</p>
              <p className="font-semibold">{tradingEnabled ? 'Enabled' : 'Disabled'}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
