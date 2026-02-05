'use client';

import { useEffect, useState } from 'react';
import { Users, Plus, Trash2, RefreshCw, Star, TrendingUp, TrendingDown, Eye, EyeOff, Copy, Check } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

interface SmartWallet {
  id: string;
  address: string;
  tier: 1 | 2 | 3;
  score: number;
  winRate: number;
  avgReturn: number;
  totalTrades: number;
  lastActive: string;
  isCrowded: boolean;
  addedAt: string;
  notes?: string;
}

export default function WalletsPage() {
  const [wallets, setWallets] = useState<SmartWallet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newWalletAddress, setNewWalletAddress] = useState('');
  const [newWalletTier, setNewWalletTier] = useState<1 | 2 | 3>(2);
  const [newWalletNotes, setNewWalletNotes] = useState('');
  const [addingWallet, setAddingWallet] = useState(false);
  const [deletingWallet, setDeletingWallet] = useState<string | null>(null);
  const [showAddresses, setShowAddresses] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const [filterTier, setFilterTier] = useState<0 | 1 | 2 | 3>(0);

  const fetchWallets = async () => {
    try {
      const response = await fetch(`${API_URL}/smart-wallets`);
      if (!response.ok) throw new Error('Failed to fetch');
      const data = await response.json();
      if (data.success) {
        setWallets(data.data || []);
      }
      setError(null);
    } catch (err) {
      console.error('Error fetching wallets:', err);
      setError('Failed to fetch smart wallets');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWallets();
  }, []);

  const addWallet = async () => {
    if (!newWalletAddress.trim()) return;

    setAddingWallet(true);
    try {
      const response = await fetch(`${API_URL}/smart-wallets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: newWalletAddress.trim(),
          tier: newWalletTier,
          notes: newWalletNotes.trim() || undefined,
        }),
      });
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to add wallet');
      }
      await fetchWallets();
      setShowAddModal(false);
      setNewWalletAddress('');
      setNewWalletNotes('');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to add wallet';
      setError(message);
    } finally {
      setAddingWallet(false);
    }
  };

  const deleteWallet = async (walletId: string) => {
    setDeletingWallet(walletId);
    try {
      const response = await fetch(`${API_URL}/smart-wallets/${walletId}`, {
        method: 'DELETE',
      });
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to delete wallet');
      }
      await fetchWallets();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete wallet';
      setError(message);
    } finally {
      setDeletingWallet(null);
    }
  };

  const updateWalletTier = async (walletId: string, tier: 1 | 2 | 3) => {
    try {
      const response = await fetch(`${API_URL}/smart-wallets/${walletId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier }),
      });
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to update wallet');
      }
      await fetchWallets();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update wallet';
      setError(message);
    }
  };

  const copyAddress = (address: string) => {
    navigator.clipboard.writeText(address);
    setCopiedAddress(address);
    setTimeout(() => setCopiedAddress(null), 2000);
  };

  const formatAddress = (address: string, show: boolean) => {
    if (show) return address;
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  };

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
  };

  const filteredWallets = filterTier === 0
    ? wallets
    : wallets.filter(w => w.tier === filterTier);

  const tierCounts = {
    1: wallets.filter(w => w.tier === 1).length,
    2: wallets.filter(w => w.tier === 2).length,
    3: wallets.filter(w => w.tier === 3).length,
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950 text-white">
        <div className="text-center">
          <div className="mx-auto mb-4 h-16 w-16 animate-spin rounded-full border-b-2 border-white"></div>
          <p className="text-zinc-400">Loading smart wallets...</p>
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
              <h1 className="text-3xl font-bold text-white">Smart Wallets</h1>
              <p className="text-zinc-500 mt-1">Manage your alpha wallet watchlist</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowAddresses(!showAddresses)}
                className="flex items-center gap-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 px-4 py-2 transition-colors"
              >
                {showAddresses ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                {showAddresses ? 'Hide' : 'Show'} Addresses
              </button>
              <button
                onClick={fetchWallets}
                className="flex items-center gap-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 px-4 py-2 transition-colors"
              >
                <RefreshCw className="h-4 w-4" />
                Refresh
              </button>
              <button
                onClick={() => setShowAddModal(true)}
                className="flex items-center gap-2 rounded-lg bg-green-600 hover:bg-green-700 px-4 py-2 transition-colors"
              >
                <Plus className="h-4 w-4" />
                Add Wallet
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <h3 className="text-sm font-medium text-zinc-400 mb-2">Total Wallets</h3>
            <p className="text-2xl font-bold text-white">{wallets.length}</p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <h3 className="text-sm font-medium text-zinc-400 mb-2">Tier 1 (Elite)</h3>
            <p className="text-2xl font-bold text-green-400">{tierCounts[1]}</p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <h3 className="text-sm font-medium text-zinc-400 mb-2">Tier 2 (Strong)</h3>
            <p className="text-2xl font-bold text-yellow-400">{tierCounts[2]}</p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <h3 className="text-sm font-medium text-zinc-400 mb-2">Tier 3 (Promising)</h3>
            <p className="text-2xl font-bold text-zinc-400">{tierCounts[3]}</p>
          </div>
        </div>

        {/* Filter */}
        <div className="flex gap-2 mb-6">
          {[0, 1, 2, 3].map((tier) => (
            <button
              key={tier}
              onClick={() => setFilterTier(tier as 0 | 1 | 2 | 3)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                filterTier === tier
                  ? tier === 0 ? 'bg-zinc-700 text-white' :
                    tier === 1 ? 'bg-green-600 text-white' :
                    tier === 2 ? 'bg-yellow-600 text-white' :
                    'bg-zinc-600 text-white'
                  : 'bg-zinc-800 text-zinc-400 hover:text-white'
              }`}
            >
              {tier === 0 ? 'All' : `Tier ${tier}`}
            </button>
          ))}
        </div>

        {/* Wallets List */}
        {filteredWallets.length === 0 ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-12 text-center">
            <Users className="h-12 w-12 text-zinc-600 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-zinc-300 mb-2">No Smart Wallets</h3>
            <p className="text-zinc-500 mb-4">Add wallets to start tracking alpha signals.</p>
            <button
              onClick={() => setShowAddModal(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-green-600 hover:bg-green-700 px-4 py-2 transition-colors"
            >
              <Plus className="h-4 w-4" />
              Add Your First Wallet
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredWallets.map((wallet) => (
              <div
                key={wallet.id}
                className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 hover:bg-zinc-900/70 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="flex items-center gap-1">
                        {[1, 2, 3].map((t) => (
                          <button
                            key={t}
                            onClick={() => updateWalletTier(wallet.id, t as 1 | 2 | 3)}
                            className={`transition-colors ${
                              t <= wallet.tier
                                ? wallet.tier === 1 ? 'text-green-400' :
                                  wallet.tier === 2 ? 'text-yellow-400' :
                                  'text-zinc-400'
                                : 'text-zinc-700 hover:text-zinc-500'
                            }`}
                          >
                            <Star className="h-4 w-4" fill={t <= wallet.tier ? 'currentColor' : 'none'} />
                          </button>
                        ))}
                      </div>
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        wallet.tier === 1 ? 'bg-green-500/20 text-green-400' :
                        wallet.tier === 2 ? 'bg-yellow-500/20 text-yellow-400' :
                        'bg-zinc-500/20 text-zinc-400'
                      }`}>
                        Tier {wallet.tier}
                      </span>
                      {wallet.isCrowded && (
                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-500/20 text-red-400">
                          Crowded
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mb-3">
                      <code className="text-sm text-zinc-300 font-mono">
                        {formatAddress(wallet.address, showAddresses)}
                      </code>
                      <button
                        onClick={() => copyAddress(wallet.address)}
                        className="text-zinc-500 hover:text-white transition-colors"
                      >
                        {copiedAddress === wallet.address ? (
                          <Check className="h-4 w-4 text-green-400" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                      <div>
                        <p className="text-zinc-500">Score</p>
                        <p className="font-medium text-white">{wallet.score}</p>
                      </div>
                      <div>
                        <p className="text-zinc-500">Win Rate</p>
                        <p className={`font-medium ${wallet.winRate >= 0.5 ? 'text-green-400' : 'text-yellow-400'}`}>
                          {(wallet.winRate * 100).toFixed(1)}%
                        </p>
                      </div>
                      <div>
                        <p className="text-zinc-500">Avg Return</p>
                        <p className={`font-medium flex items-center gap-1 ${wallet.avgReturn >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {wallet.avgReturn >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                          {wallet.avgReturn >= 0 ? '+' : ''}{(wallet.avgReturn * 100).toFixed(1)}%
                        </p>
                      </div>
                      <div>
                        <p className="text-zinc-500">Trades</p>
                        <p className="font-medium text-white">{wallet.totalTrades}</p>
                      </div>
                      <div>
                        <p className="text-zinc-500">Last Active</p>
                        <p className="font-medium text-zinc-300">{formatTime(wallet.lastActive)}</p>
                      </div>
                    </div>
                    {wallet.notes && (
                      <p className="text-xs text-zinc-500 mt-2 italic">{wallet.notes}</p>
                    )}
                  </div>
                  <button
                    onClick={() => deleteWallet(wallet.id)}
                    disabled={deletingWallet === wallet.id}
                    className="text-zinc-500 hover:text-red-400 transition-colors p-2"
                  >
                    {deletingWallet === wallet.id ? (
                      <RefreshCw className="h-5 w-5 animate-spin" />
                    ) : (
                      <Trash2 className="h-5 w-5" />
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Add Wallet Modal */}
        {showAddModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6 w-full max-w-md mx-4">
              <h2 className="text-xl font-bold mb-4">Add Smart Wallet</h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-zinc-400 mb-2">Wallet Address</label>
                  <input
                    type="text"
                    value={newWalletAddress}
                    onChange={(e) => setNewWalletAddress(e.target.value)}
                    placeholder="Enter Solana wallet address..."
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-600"
                  />
                </div>

                <div>
                  <label className="block text-sm text-zinc-400 mb-2">Tier</label>
                  <div className="flex gap-2">
                    {[1, 2, 3].map((tier) => (
                      <button
                        key={tier}
                        onClick={() => setNewWalletTier(tier as 1 | 2 | 3)}
                        className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                          newWalletTier === tier
                            ? tier === 1 ? 'bg-green-600 text-white' :
                              tier === 2 ? 'bg-yellow-600 text-white' :
                              'bg-zinc-600 text-white'
                            : 'bg-zinc-800 text-zinc-400 hover:text-white'
                        }`}
                      >
                        Tier {tier}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm text-zinc-400 mb-2">Notes (optional)</label>
                  <input
                    type="text"
                    value={newWalletNotes}
                    onChange={(e) => setNewWalletNotes(e.target.value)}
                    placeholder="Add notes about this wallet..."
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
                  onClick={addWallet}
                  disabled={!newWalletAddress.trim() || addingWallet}
                  className="flex-1 py-2 rounded-lg bg-green-600 hover:bg-green-700 disabled:bg-green-800 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                >
                  {addingWallet && <RefreshCw className="h-4 w-4 animate-spin" />}
                  Add Wallet
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
