'use client';

import { useEffect, useState } from 'react';
import { Bell, RefreshCw, Check, CheckCheck, Trash2, Filter, AlertTriangle, Info, AlertCircle, XCircle } from 'lucide-react';
import { API_URL } from '@/lib/api';

interface Alert {
  id: string;
  level: 'info' | 'warning' | 'error' | 'critical';
  title: string;
  message: string;
  category: string;
  timestamp: string;
  acknowledged: boolean;
  data?: Record<string, unknown>;
}

type FilterLevel = 'all' | 'info' | 'warning' | 'error' | 'critical';

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterLevel, setFilterLevel] = useState<FilterLevel>('all');
  const [showAcknowledged, setShowAcknowledged] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchAlerts = async () => {
    try {
      const response = await fetch(`${API_URL}/alerts`);
      if (!response.ok) throw new Error('Failed to fetch');
      const result = await response.json();
      if (result.success) {
        setAlerts(result.data || []);
      }
      setError(null);
    } catch (err) {
      console.error('Error fetching alerts:', err);
      setError('Failed to fetch alerts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 10000);
    return () => clearInterval(interval);
  }, []);

  const acknowledgeAlert = async (alertId: string) => {
    setActionLoading(alertId);
    try {
      const response = await fetch(`${API_URL}/alerts/${alertId}/acknowledge`, {
        method: 'POST',
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error);
      await fetchAlerts();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to acknowledge alert';
      setError(message);
    } finally {
      setActionLoading(null);
    }
  };

  const acknowledgeAll = async () => {
    setActionLoading('all');
    try {
      const response = await fetch(`${API_URL}/alerts/acknowledge-all`, {
        method: 'POST',
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error);
      await fetchAlerts();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to acknowledge alerts';
      setError(message);
    } finally {
      setActionLoading(null);
    }
  };

  const deleteAlert = async (alertId: string) => {
    setActionLoading(`delete-${alertId}`);
    try {
      const response = await fetch(`${API_URL}/alerts/${alertId}`, {
        method: 'DELETE',
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error);
      await fetchAlerts();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete alert';
      setError(message);
    } finally {
      setActionLoading(null);
    }
  };

  const clearAll = async () => {
    if (!confirm('Are you sure you want to delete all alerts?')) return;

    setActionLoading('clear');
    try {
      const response = await fetch(`${API_URL}/alerts/clear`, {
        method: 'DELETE',
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error);
      await fetchAlerts();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to clear alerts';
      setError(message);
    } finally {
      setActionLoading(null);
    }
  };

  const filteredAlerts = alerts
    .filter(alert => filterLevel === 'all' || alert.level === filterLevel)
    .filter(alert => showAcknowledged || !alert.acknowledged);

  const unacknowledgedCount = alerts.filter(a => !a.acknowledged).length;
  const criticalCount = alerts.filter(a => a.level === 'critical' && !a.acknowledged).length;

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
  };

  const getLevelIcon = (level: string) => {
    switch (level) {
      case 'info': return <Info className="h-5 w-5 text-blue-400" />;
      case 'warning': return <AlertTriangle className="h-5 w-5 text-yellow-400" />;
      case 'error': return <AlertCircle className="h-5 w-5 text-red-400" />;
      case 'critical': return <XCircle className="h-5 w-5 text-red-500" />;
      default: return <Bell className="h-5 w-5 text-zinc-400" />;
    }
  };

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'info': return 'border-blue-500/30 bg-blue-500/5';
      case 'warning': return 'border-yellow-500/30 bg-yellow-500/5';
      case 'error': return 'border-red-500/30 bg-red-500/5';
      case 'critical': return 'border-red-500/50 bg-red-500/10';
      default: return 'border-zinc-800 bg-zinc-900/50';
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950 text-white">
        <div className="text-center">
          <div className="mx-auto mb-4 h-16 w-16 animate-spin rounded-full border-b-2 border-white"></div>
          <p className="text-zinc-400">Loading alerts...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 p-6 text-white">
      <div className="mx-auto max-w-5xl">
        {/* Header */}
        <header className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                <Bell className="h-8 w-8 text-yellow-400" />
                Alerts
                {unacknowledgedCount > 0 && (
                  <span className="px-2 py-1 rounded-full text-sm bg-red-500 text-white">
                    {unacknowledgedCount}
                  </span>
                )}
              </h1>
              <p className="text-zinc-500 mt-1">System notifications and warnings</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={fetchAlerts}
                className="flex items-center gap-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 px-4 py-2 transition-colors"
              >
                <RefreshCw className="h-4 w-4" />
                Refresh
              </button>
              <button
                onClick={acknowledgeAll}
                disabled={actionLoading === 'all' || unacknowledgedCount === 0}
                className="flex items-center gap-2 rounded-lg bg-green-600 hover:bg-green-700 px-4 py-2 transition-colors disabled:opacity-50"
              >
                <CheckCheck className="h-4 w-4" />
                Ack All
              </button>
              <button
                onClick={clearAll}
                disabled={actionLoading === 'clear' || alerts.length === 0}
                className="flex items-center gap-2 rounded-lg bg-red-600 hover:bg-red-700 px-4 py-2 transition-colors disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
                Clear
              </button>
            </div>
          </div>
        </header>

        {error && (
          <div className="mb-6 rounded-lg bg-red-500/10 border border-red-500/20 p-4">
            <p className="text-red-400">{error}</p>
          </div>
        )}

        {/* Critical Alert Banner */}
        {criticalCount > 0 && (
          <div className="mb-6 rounded-lg bg-red-500/20 border border-red-500/50 p-4 flex items-center gap-3">
            <XCircle className="h-6 w-6 text-red-500 animate-pulse" />
            <div>
              <p className="font-semibold text-red-400">{criticalCount} Critical Alert{criticalCount > 1 ? 's' : ''}</p>
              <p className="text-sm text-red-300/70">Immediate attention required</p>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-4 mb-6">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-zinc-500" />
            <div className="flex rounded-lg bg-zinc-800 p-1">
              {(['all', 'critical', 'error', 'warning', 'info'] as FilterLevel[]).map((level) => (
                <button
                  key={level}
                  onClick={() => setFilterLevel(level)}
                  className={`px-3 py-1 rounded text-sm transition-colors ${
                    filterLevel === level ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  {level.charAt(0).toUpperCase() + level.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer">
            <input
              type="checkbox"
              checked={showAcknowledged}
              onChange={(e) => setShowAcknowledged(e.target.checked)}
              className="rounded bg-zinc-800 border-zinc-700"
            />
            Show acknowledged
          </label>
        </div>

        {/* Alerts List */}
        {filteredAlerts.length === 0 ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-12 text-center">
            <Bell className="h-12 w-12 text-zinc-600 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-zinc-300 mb-2">No Alerts</h3>
            <p className="text-zinc-500">You&apos;re all caught up! No alerts to display.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredAlerts.map((alert) => (
              <div
                key={alert.id}
                className={`rounded-xl border p-4 transition-colors ${getLevelColor(alert.level)} ${
                  alert.acknowledged ? 'opacity-60' : ''
                }`}
              >
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 mt-0.5">
                    {getLevelIcon(alert.level)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-white">{alert.title}</h3>
                      <span className="text-xs text-zinc-500 px-2 py-0.5 rounded bg-zinc-800">
                        {alert.category}
                      </span>
                      {alert.acknowledged && (
                        <span className="text-xs text-green-400 flex items-center gap-1">
                          <Check className="h-3 w-3" /> Acknowledged
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-zinc-300 mb-2">{alert.message}</p>
                    <p className="text-xs text-zinc-500">{formatTime(alert.timestamp)}</p>
                  </div>
                  <div className="flex gap-1">
                    {!alert.acknowledged && (
                      <button
                        onClick={() => acknowledgeAlert(alert.id)}
                        disabled={actionLoading === alert.id}
                        className="p-2 rounded text-zinc-500 hover:text-green-400 hover:bg-green-400/10 transition-colors"
                        title="Acknowledge"
                      >
                        {actionLoading === alert.id ? (
                          <RefreshCw className="h-4 w-4 animate-spin" />
                        ) : (
                          <Check className="h-4 w-4" />
                        )}
                      </button>
                    )}
                    <button
                      onClick={() => deleteAlert(alert.id)}
                      disabled={actionLoading === `delete-${alert.id}`}
                      className="p-2 rounded text-zinc-500 hover:text-red-400 hover:bg-red-400/10 transition-colors"
                      title="Delete"
                    >
                      {actionLoading === `delete-${alert.id}` ? (
                        <RefreshCw className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
