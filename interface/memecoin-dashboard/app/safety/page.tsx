'use client';

import { useEffect, useState } from 'react';
import { Shield, Plus, Trash2, RefreshCw, AlertTriangle, CheckCircle, XCircle, Search } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

interface BlacklistEntry {
  id: string;
  address: string;
  type: 'deployer' | 'associated' | 'contract';
  reason: string;
  addedAt: string;
  rugCount: number;
}

interface SafetyCheck {
  name: string;
  status: 'pass' | 'fail' | 'warning';
  details: string;
  points: number;
}

interface RecentRejection {
  tokenAddress: string;
  tokenName: string;
  reason: string;
  timestamp: string;
  safetyScore: number;
}

interface SafetyStats {
  totalBlacklisted: number;
  hardRejectsToday: number;
  tokensScanned: number;
  avgSafetyScore: number;
}

export default function SafetyPage() {
  const [blacklist, setBlacklist] = useState<BlacklistEntry[]>([]);
  const [recentRejections, setRecentRejections] = useState<RecentRejection[]>([]);
  const [stats, setStats] = useState<SafetyStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [newAddress, setNewAddress] = useState('');
  const [newType, setNewType] = useState<'deployer' | 'associated' | 'contract'>('deployer');
  const [newReason, setNewReason] = useState('');
  const [addingEntry, setAddingEntry] = useState(false);
  const [deletingEntry, setDeletingEntry] = useState<string | null>(null);
  const [checkingToken, setCheckingToken] = useState(false);
  const [tokenToCheck, setTokenToCheck] = useState('');
  const [checkResult, setCheckResult] = useState<{ checks: SafetyCheck[]; score: number; passed: boolean } | null>(null);

  const fetchData = async () => {
    try {
      const response = await fetch(`${API_URL}/safety`);
      if (!response.ok) throw new Error('Failed to fetch');
      const result = await response.json();
      if (result.success) {
        setBlacklist(result.data?.blacklist || []);
        setRecentRejections(result.data?.recentRejections || []);
        setStats(result.data?.stats || null);
      }
      setError(null);
    } catch (err) {
      console.error('Error fetching safety data:', err);
      setError('Failed to fetch safety data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const addToBlacklist = async () => {
    if (!newAddress.trim() || !newReason.trim()) return;

    setAddingEntry(true);
    try {
      const response = await fetch(`${API_URL}/safety/blacklist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: newAddress.trim(),
          type: newType,
          reason: newReason.trim(),
        }),
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error);
      await fetchData();
      setShowAddModal(false);
      setNewAddress('');
      setNewReason('');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to add to blacklist';
      setError(message);
    } finally {
      setAddingEntry(false);
    }
  };

  const removeFromBlacklist = async (entryId: string) => {
    setDeletingEntry(entryId);
    try {
      const response = await fetch(`${API_URL}/safety/blacklist/${entryId}`, {
        method: 'DELETE',
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error);
      await fetchData();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to remove from blacklist';
      setError(message);
    } finally {
      setDeletingEntry(null);
    }
  };

  const checkToken = async () => {
    if (!tokenToCheck.trim()) return;

    setCheckingToken(true);
    setCheckResult(null);
    try {
      const response = await fetch(`${API_URL}/safety/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenAddress: tokenToCheck.trim() }),
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error);
      setCheckResult(result.data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to check token';
      setError(message);
    } finally {
      setCheckingToken(false);
    }
  };

  const filteredBlacklist = blacklist.filter(entry =>
    entry.address.toLowerCase().includes(searchQuery.toLowerCase()) ||
    entry.reason.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatTime = (isoString: string) => {
    return new Date(isoString).toLocaleString();
  };

  const truncateAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950 text-white">
        <div className="text-center">
          <div className="mx-auto mb-4 h-16 w-16 animate-spin rounded-full border-b-2 border-white"></div>
          <p className="text-zinc-400">Loading safety data...</p>
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
              <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                <Shield className="h-8 w-8 text-green-400" />
                Safety & Risk Management
              </h1>
              <p className="text-zinc-500 mt-1">Manage blacklists and token safety checks</p>
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
                onClick={() => setShowAddModal(true)}
                className="flex items-center gap-2 rounded-lg bg-red-600 hover:bg-red-700 px-4 py-2 transition-colors"
              >
                <Plus className="h-4 w-4" />
                Add to Blacklist
              </button>
            </div>
          </div>
        </header>

        {error && (
          <div className="mb-6 rounded-lg bg-red-500/10 border border-red-500/20 p-4">
            <p className="text-red-400">{error}</p>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <h3 className="text-sm font-medium text-zinc-400 mb-2">Blacklisted Addresses</h3>
            <p className="text-2xl font-bold text-red-400">{stats?.totalBlacklisted || 0}</p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <h3 className="text-sm font-medium text-zinc-400 mb-2">Hard Rejects Today</h3>
            <p className="text-2xl font-bold text-yellow-400">{stats?.hardRejectsToday || 0}</p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <h3 className="text-sm font-medium text-zinc-400 mb-2">Tokens Scanned</h3>
            <p className="text-2xl font-bold text-white">{stats?.tokensScanned || 0}</p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <h3 className="text-sm font-medium text-zinc-400 mb-2">Avg Safety Score</h3>
            <p className={`text-2xl font-bold ${(stats?.avgSafetyScore || 0) >= 70 ? 'text-green-400' : 'text-yellow-400'}`}>
              {stats?.avgSafetyScore?.toFixed(0) || 0}
            </p>
          </div>
        </div>

        {/* Token Safety Checker */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Token Safety Checker</h2>
          <div className="flex gap-3">
            <input
              type="text"
              value={tokenToCheck}
              onChange={(e) => setTokenToCheck(e.target.value)}
              placeholder="Enter token contract address..."
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-600"
            />
            <button
              onClick={checkToken}
              disabled={checkingToken || !tokenToCheck.trim()}
              className="flex items-center gap-2 rounded-lg bg-green-600 hover:bg-green-700 px-6 py-2 transition-colors disabled:opacity-50"
            >
              {checkingToken ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Check
            </button>
          </div>

          {checkResult && (
            <div className="mt-4 p-4 rounded-lg bg-zinc-800/50">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  {checkResult.passed ? (
                    <CheckCircle className="h-6 w-6 text-green-400" />
                  ) : (
                    <XCircle className="h-6 w-6 text-red-400" />
                  )}
                  <span className={`text-lg font-semibold ${checkResult.passed ? 'text-green-400' : 'text-red-400'}`}>
                    {checkResult.passed ? 'PASSED' : 'FAILED'}
                  </span>
                </div>
                <span className="text-2xl font-bold text-white">Score: {checkResult.score}</span>
              </div>

              <div className="space-y-2">
                {checkResult.checks.map((check, i) => (
                  <div key={i} className="flex items-center justify-between p-2 rounded bg-zinc-800">
                    <div className="flex items-center gap-2">
                      {check.status === 'pass' && <CheckCircle className="h-4 w-4 text-green-400" />}
                      {check.status === 'fail' && <XCircle className="h-4 w-4 text-red-400" />}
                      {check.status === 'warning' && <AlertTriangle className="h-4 w-4 text-yellow-400" />}
                      <span className="text-sm text-zinc-300">{check.name}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-zinc-500">{check.details}</span>
                      <span className={`text-sm font-medium ${check.points >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {check.points >= 0 ? '+' : ''}{check.points}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Blacklist */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Blacklist</h2>
              <span className="text-sm text-zinc-500">{filteredBlacklist.length} entries</span>
            </div>

            <div className="mb-4">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search blacklist..."
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-600"
              />
            </div>

            <div className="space-y-2 max-h-96 overflow-y-auto">
              {filteredBlacklist.map((entry) => (
                <div key={entry.id} className="flex items-center justify-between p-3 rounded-lg bg-zinc-800/50">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <code className="text-sm text-zinc-300">{truncateAddress(entry.address)}</code>
                      <span className={`px-2 py-0.5 rounded text-xs ${
                        entry.type === 'deployer' ? 'bg-red-500/20 text-red-400' :
                        entry.type === 'contract' ? 'bg-yellow-500/20 text-yellow-400' :
                        'bg-zinc-500/20 text-zinc-400'
                      }`}>
                        {entry.type}
                      </span>
                      {entry.rugCount > 0 && (
                        <span className="text-xs text-red-400">{entry.rugCount} rugs</span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-500 truncate mt-1">{entry.reason}</p>
                  </div>
                  <button
                    onClick={() => removeFromBlacklist(entry.id)}
                    disabled={deletingEntry === entry.id}
                    className="text-zinc-500 hover:text-red-400 transition-colors p-2"
                  >
                    {deletingEntry === entry.id ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </button>
                </div>
              ))}

              {filteredBlacklist.length === 0 && (
                <p className="text-center text-zinc-500 py-8">No blacklist entries found.</p>
              )}
            </div>
          </div>

          {/* Recent Rejections */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
            <h2 className="text-lg font-semibold mb-4">Recent Hard Rejects</h2>

            <div className="space-y-3 max-h-96 overflow-y-auto">
              {recentRejections.map((rejection, i) => (
                <div key={i} className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-zinc-300">{rejection.tokenName || truncateAddress(rejection.tokenAddress)}</span>
                    <span className="text-sm text-red-400">Score: {rejection.safetyScore}</span>
                  </div>
                  <p className="text-sm text-red-400 mb-1">{rejection.reason}</p>
                  <p className="text-xs text-zinc-500">{formatTime(rejection.timestamp)}</p>
                </div>
              ))}

              {recentRejections.length === 0 && (
                <p className="text-center text-zinc-500 py-8">No recent rejections.</p>
              )}
            </div>
          </div>
        </div>

        {/* Add to Blacklist Modal */}
        {showAddModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6 w-full max-w-md mx-4">
              <h2 className="text-xl font-bold mb-4">Add to Blacklist</h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-zinc-400 mb-2">Address</label>
                  <input
                    type="text"
                    value={newAddress}
                    onChange={(e) => setNewAddress(e.target.value)}
                    placeholder="Enter wallet or contract address..."
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-600"
                  />
                </div>

                <div>
                  <label className="block text-sm text-zinc-400 mb-2">Type</label>
                  <div className="flex gap-2">
                    {(['deployer', 'associated', 'contract'] as const).map((type) => (
                      <button
                        key={type}
                        onClick={() => setNewType(type)}
                        className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                          newType === type
                            ? 'bg-red-600 text-white'
                            : 'bg-zinc-800 text-zinc-400 hover:text-white'
                        }`}
                      >
                        {type.charAt(0).toUpperCase() + type.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm text-zinc-400 mb-2">Reason</label>
                  <input
                    type="text"
                    value={newReason}
                    onChange={(e) => setNewReason(e.target.value)}
                    placeholder="Why is this address blacklisted?"
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-600"
                  />
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={addToBlacklist}
                  disabled={!newAddress.trim() || !newReason.trim() || addingEntry}
                  className="flex-1 py-2 rounded-lg bg-red-600 hover:bg-red-700 disabled:bg-red-800 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                >
                  {addingEntry && <RefreshCw className="h-4 w-4 animate-spin" />}
                  Add to Blacklist
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
