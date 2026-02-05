'use client';

import { useEffect, useState, useCallback } from 'react';
import { Power, Pause, Play, AlertTriangle, RefreshCw, Zap, Search } from 'lucide-react';
import { API_URL } from '@/lib/api';

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

type ActionType = 'start' | 'stop' | 'pause' | 'resume' | 'kill' | 'config' | 'regime' | null;

export default function ControlsPage() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<ActionType>(null);
  const [actionStatus, setActionStatus] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [confirmKill, setConfirmKill] = useState(false);

  const fetchStats = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/status`, {
        cache: 'no-store',
      });
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
  }, []);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 3000); // Poll every 3 seconds for faster updates
    return () => clearInterval(interval);
  }, [fetchStats]);

  const executeAction = async (action: ActionType, body?: object) => {
    if (!action || actionLoading) return;

    setActionLoading(action);
    setError(null);

    // Set appropriate status message
    const statusMessages: Record<string, string> = {
      start: 'Starting bot...',
      stop: 'Stopping bot...',
      pause: 'Pausing bot...',
      resume: 'Resuming bot...',
      kill: 'Emergency shutdown in progress...',
      config: 'Updating configuration...',
      regime: 'Setting market regime...',
    };
    setActionStatus(statusMessages[action] || 'Processing...');

    try {
      const controller = new AbortController();
      // Kill action needs longer timeout
      const timeoutMs = action === 'kill' ? 30000 : 15000;
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(`${API_URL}/bot/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || `Failed to ${action}`);
      }

      // Update status message on success
      const successMessages: Record<string, string> = {
        start: 'Bot started! Scanning for tokens...',
        stop: 'Bot stopped successfully',
        pause: 'Bot paused',
        resume: 'Bot resumed! Scanning for tokens...',
        kill: 'Emergency shutdown complete',
        config: 'Configuration updated',
        regime: 'Market regime updated',
      };
      setActionStatus(successMessages[action] || 'Done');

      // Fetch updated stats immediately
      await fetchStats();

      // Brief delay to show success message
      await new Promise(resolve => setTimeout(resolve, 500));

    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        setError(`${action} timed out. Please try again.`);
      } else {
        const message = err instanceof Error ? err.message : `Failed to ${action}`;
        setError(message);
      }
    } finally {
      setActionLoading(null);
      setActionStatus('');
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

  // Check if any action is loading to disable all controls
  const isAnyActionLoading = actionLoading !== null;

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

        {/* Global Loading Overlay */}
        {isAnyActionLoading && (
          <div className="mb-6 rounded-lg bg-blue-500/10 border border-blue-500/30 p-4">
            <div className="flex items-center gap-3">
              <RefreshCw className="h-5 w-5 animate-spin text-blue-400" />
              <p className="text-blue-400 font-medium">{actionStatus}</p>
            </div>
          </div>
        )}

        {error && (
          <div className="mb-6 rounded-lg bg-red-500/10 border border-red-500/20 p-4">
            <p className="text-red-400">{error}</p>
          </div>
        )}

        {/* Active Status Banner - Shows when bot is running */}
        {isRunning && !isPaused && !isAnyActionLoading && (
          <div className="mb-6 rounded-lg bg-green-500/10 border border-green-500/30 p-4">
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="h-5 w-5 text-green-400" />
                <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-green-400 animate-ping" />
              </div>
              <div>
                <p className="text-green-400 font-medium">Bot Active - Scanning for tokens</p>
                <p className="text-green-400/70 text-sm">Monitoring smart wallets and market conditions</p>
              </div>
            </div>
          </div>
        )}

        {/* Paused Banner */}
        {isRunning && isPaused && !isAnyActionLoading && (
          <div className="mb-6 rounded-lg bg-yellow-500/10 border border-yellow-500/30 p-4">
            <div className="flex items-center gap-3">
              <Pause className="h-5 w-5 text-yellow-400" />
              <div>
                <p className="text-yellow-400 font-medium">Bot Paused</p>
                <p className="text-yellow-400/70 text-sm">Monitoring active but new entries disabled</p>
              </div>
            </div>
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
                disabled={isAnyActionLoading}
                className="flex items-center justify-center gap-3 rounded-lg bg-green-600 hover:bg-green-700 disabled:bg-green-800 disabled:opacity-50 disabled:cursor-not-allowed p-4 transition-all duration-200"
              >
                {actionLoading === 'start' ? (
                  <RefreshCw className="h-6 w-6 animate-spin" />
                ) : (
                  <Power className="h-6 w-6" />
                )}
                <span className="font-semibold">
                  {actionLoading === 'start' ? 'Starting...' : 'Start Bot'}
                </span>
              </button>
            ) : (
              <button
                onClick={handleStop}
                disabled={isAnyActionLoading}
                className="flex items-center justify-center gap-3 rounded-lg bg-red-600 hover:bg-red-700 disabled:bg-red-800 disabled:opacity-50 disabled:cursor-not-allowed p-4 transition-all duration-200"
              >
                {actionLoading === 'stop' ? (
                  <RefreshCw className="h-6 w-6 animate-spin" />
                ) : (
                  <Power className="h-6 w-6" />
                )}
                <span className="font-semibold">
                  {actionLoading === 'stop' ? 'Stopping...' : 'Stop Bot'}
                </span>
              </button>
            )}

            {/* Pause/Resume Button */}
            {isRunning && !isPaused ? (
              <button
                onClick={handlePause}
                disabled={isAnyActionLoading}
                className="flex items-center justify-center gap-3 rounded-lg bg-yellow-600 hover:bg-yellow-700 disabled:bg-yellow-800 disabled:opacity-50 disabled:cursor-not-allowed p-4 transition-all duration-200"
              >
                {actionLoading === 'pause' ? (
                  <RefreshCw className="h-6 w-6 animate-spin" />
                ) : (
                  <Pause className="h-6 w-6" />
                )}
                <span className="font-semibold">
                  {actionLoading === 'pause' ? 'Pausing...' : 'Pause Bot'}
                </span>
              </button>
            ) : isRunning && isPaused ? (
              <button
                onClick={handleResume}
                disabled={isAnyActionLoading}
                className="flex items-center justify-center gap-3 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed p-4 transition-all duration-200"
              >
                {actionLoading === 'resume' ? (
                  <RefreshCw className="h-6 w-6 animate-spin" />
                ) : (
                  <Play className="h-6 w-6" />
                )}
                <span className="font-semibold">
                  {actionLoading === 'resume' ? 'Resuming...' : 'Resume Bot'}
                </span>
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
              disabled={isAnyActionLoading}
              className={`flex items-center justify-center gap-3 rounded-lg p-4 transition-all duration-200 ${
                confirmKill
                  ? 'bg-red-600 hover:bg-red-700 animate-pulse'
                  : 'bg-zinc-800 hover:bg-red-600'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {actionLoading === 'kill' ? (
                <RefreshCw className="h-6 w-6 animate-spin" />
              ) : (
                <AlertTriangle className="h-6 w-6" />
              )}
              <span className="font-semibold">
                {actionLoading === 'kill'
                  ? 'Shutting down...'
                  : confirmKill
                    ? 'Confirm Kill'
                    : 'Kill Switch'}
              </span>
            </button>
          </div>

          {confirmKill && !isAnyActionLoading && (
            <p className="text-center text-yellow-400 text-sm mt-4 animate-pulse">
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
                disabled={isAnyActionLoading}
                className={`relative w-14 h-7 rounded-full transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${
                  paperMode ? 'bg-blue-600' : 'bg-zinc-700'
                }`}
              >
                {actionLoading === 'config' ? (
                  <span className="absolute inset-0 flex items-center justify-center">
                    <RefreshCw className="h-4 w-4 animate-spin text-white" />
                  </span>
                ) : (
                  <span className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-transform duration-200 ${
                    paperMode ? 'left-8' : 'left-1'
                  }`} />
                )}
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
                disabled={isAnyActionLoading}
                className={`relative w-14 h-7 rounded-full transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${
                  tradingEnabled ? 'bg-green-600' : 'bg-zinc-700'
                }`}
              >
                {actionLoading === 'config' ? (
                  <span className="absolute inset-0 flex items-center justify-center">
                    <RefreshCw className="h-4 w-4 animate-spin text-white" />
                  </span>
                ) : (
                  <span className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-transform duration-200 ${
                    tradingEnabled ? 'left-8' : 'left-1'
                  }`} />
                )}
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
            {actionLoading === 'regime' ? (
              <RefreshCw className="h-5 w-5 animate-spin text-zinc-400" />
            ) : (
              <Zap className="h-5 w-5 text-zinc-500" />
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {['FULL', 'CAUTIOUS', 'DEFENSIVE', 'PAUSE'].map((regime) => (
              <button
                key={regime}
                onClick={() => handleSetRegime(regime)}
                disabled={isAnyActionLoading}
                className={`rounded-lg p-3 text-sm font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${
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
              <div className={`w-4 h-4 rounded-full mx-auto mb-2 ${
                isRunning ? 'bg-green-400' : 'bg-red-400'
              } ${isRunning && !isPaused ? 'animate-pulse' : ''}`} />
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
