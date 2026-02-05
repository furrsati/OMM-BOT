'use client';

import { useEffect, useState } from 'react';
import {
  Search,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  TrendingUp,
  TrendingDown,
  Users,
  Shield,
  Zap,
  Eye,
  DollarSign,
} from 'lucide-react';
import { API_URL } from '@/lib/api';

interface TokenOpportunity {
  id: string;
  tokenAddress: string;
  tokenName: string;
  tokenSymbol: string;
  discoveredAt: string;
  discoveredVia: string;
  smartWallets: {
    addresses: string[];
    total: number;
    tier1: number;
    tier2: number;
    tier3: number;
  };
  safety: {
    score: number;
    isHoneypot: boolean;
    hasMintAuthority: boolean;
    hasFreezeAuthority: boolean;
  };
  market: {
    price: number;
    marketCap: number;
    liquidity: number;
    holders: number;
    volume24h: number;
    priceChange1h: number;
    priceChange24h: number;
  };
  entry: {
    dipFromHigh: number;
    athPrice: number;
    tokenAgeMinutes: number;
    hypePhase: string;
  };
  conviction: {
    score: number;
    breakdown: Record<string, number>;
  };
  status: string;
  rejectionReason?: string;
  lastUpdated: string;
}

interface ScannerStats {
  total: number;
  analyzing: number;
  qualified: number;
  rejected: number;
  entered: number;
  avgConviction: number;
}

export default function ScannerPage() {
  const [opportunities, setOpportunities] = useState<TokenOpportunity[]>([]);
  const [stats, setStats] = useState<ScannerStats>({
    total: 0,
    analyzing: 0,
    qualified: 0,
    rejected: 0,
    entered: 0,
    avgConviction: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [analyzeAddress, setAnalyzeAddress] = useState('');
  const [analyzing, setAnalyzing] = useState(false);

  const fetchScanner = async () => {
    try {
      const response = await fetch(`${API_URL}/scanner`);
      if (!response.ok) throw new Error('Failed to fetch');
      const data = await response.json();
      if (data.success) {
        setOpportunities(data.data.opportunities || []);
        setStats(data.data.stats || {});
      }
      setError(null);
    } catch (err) {
      console.error('Error fetching scanner:', err);
      setError('Failed to fetch scanner data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchScanner();
    const interval = setInterval(fetchScanner, 5000);
    return () => clearInterval(interval);
  }, []);

  const analyzeToken = async () => {
    if (!analyzeAddress || analyzeAddress.length !== 44) {
      setError('Please enter a valid Solana token address');
      return;
    }

    setAnalyzing(true);
    try {
      const response = await fetch(`${API_URL}/scanner`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenAddress: analyzeAddress }),
      });
      const data = await response.json();
      if (data.success) {
        setAnalyzeAddress('');
        await fetchScanner();
      } else {
        setError(data.error || 'Failed to analyze token');
      }
    } catch (err) {
      setError('Failed to submit token for analysis');
    } finally {
      setAnalyzing(false);
    }
  };

  const filteredOpportunities = opportunities.filter((opp) => {
    if (filter === 'all') return true;
    return opp.status.toLowerCase() === filter.toLowerCase();
  });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'ANALYZING':
        return <Clock className="h-4 w-4 text-yellow-400 animate-pulse" />;
      case 'QUALIFIED':
        return <CheckCircle className="h-4 w-4 text-green-400" />;
      case 'REJECTED':
        return <XCircle className="h-4 w-4 text-red-400" />;
      case 'ENTERED':
        return <Zap className="h-4 w-4 text-blue-400" />;
      default:
        return <Eye className="h-4 w-4 text-zinc-400" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ANALYZING':
        return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      case 'QUALIFIED':
        return 'bg-green-500/20 text-green-400 border-green-500/30';
      case 'REJECTED':
        return 'bg-red-500/20 text-red-400 border-red-500/30';
      case 'ENTERED':
        return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      default:
        return 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30';
    }
  };

  const getConvictionColor = (score: number) => {
    if (score >= 85) return 'text-green-400';
    if (score >= 70) return 'text-yellow-400';
    if (score >= 50) return 'text-orange-400';
    return 'text-red-400';
  };

  const formatPrice = (price: number) => {
    if (price < 0.00001) return price.toExponential(2);
    return price.toFixed(8);
  };

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toFixed(0);
  };

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${Math.floor(diffHours / 24)}d ago`;
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950 text-white">
        <div className="text-center">
          <div className="mx-auto mb-4 h-16 w-16 animate-spin rounded-full border-b-2 border-white"></div>
          <p className="text-zinc-400">Loading scanner...</p>
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
              <h1 className="text-3xl font-bold text-white">Token Scanner</h1>
              <p className="text-zinc-500 mt-1">
                Real-time view of tokens the bot is analyzing
              </p>
            </div>
            <button
              onClick={fetchScanner}
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

        {/* Manual Analysis Input */}
        <div className="mb-6 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <div className="flex gap-4">
            <div className="flex-1">
              <input
                type="text"
                value={analyzeAddress}
                onChange={(e) => setAnalyzeAddress(e.target.value)}
                placeholder="Enter token address to analyze..."
                className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
              />
            </div>
            <button
              onClick={analyzeToken}
              disabled={analyzing}
              className="flex items-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-500 px-6 py-2 transition-colors disabled:opacity-50"
            >
              {analyzing ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              Analyze
            </button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-zinc-400">Total</h3>
              <Eye className="h-4 w-4 text-zinc-600" />
            </div>
            <p className="text-2xl font-bold text-white">{stats.total}</p>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-zinc-400">Analyzing</h3>
              <Clock className="h-4 w-4 text-yellow-500" />
            </div>
            <p className="text-2xl font-bold text-yellow-400">{stats.analyzing}</p>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-zinc-400">Qualified</h3>
              <CheckCircle className="h-4 w-4 text-green-500" />
            </div>
            <p className="text-2xl font-bold text-green-400">{stats.qualified}</p>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-zinc-400">Rejected</h3>
              <XCircle className="h-4 w-4 text-red-500" />
            </div>
            <p className="text-2xl font-bold text-red-400">{stats.rejected}</p>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-zinc-400">Entered</h3>
              <Zap className="h-4 w-4 text-blue-500" />
            </div>
            <p className="text-2xl font-bold text-blue-400">{stats.entered}</p>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-zinc-400">Avg Conviction</h3>
              <TrendingUp className="h-4 w-4 text-zinc-600" />
            </div>
            <p className={`text-2xl font-bold ${getConvictionColor(stats.avgConviction)}`}>
              {stats.avgConviction.toFixed(0)}
            </p>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-2 mb-6">
          {['all', 'analyzing', 'qualified', 'rejected', 'entered'].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                filter === f
                  ? 'bg-blue-600 text-white'
                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        {/* Token Opportunities List */}
        {filteredOpportunities.length === 0 ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-12 text-center">
            <Search className="h-12 w-12 text-zinc-600 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-zinc-300 mb-2">No Tokens Found</h3>
            <p className="text-zinc-500">
              The bot will automatically scan tokens when smart wallets make moves.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredOpportunities.map((opp) => (
              <div
                key={opp.id}
                className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 hover:bg-zinc-900/70 transition-colors"
              >
                {/* Header Row */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-semibold text-white">{opp.tokenSymbol}</h3>
                        <span className={`px-2 py-0.5 rounded text-xs font-medium border ${getStatusColor(opp.status)}`}>
                          {getStatusIcon(opp.status)}
                          <span className="ml-1">{opp.status}</span>
                        </span>
                      </div>
                      <p className="text-sm text-zinc-500">{opp.tokenName}</p>
                      <p className="text-xs text-zinc-600 font-mono mt-1">
                        {opp.tokenAddress.slice(0, 8)}...{opp.tokenAddress.slice(-8)}
                      </p>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className={`text-3xl font-bold ${getConvictionColor(opp.conviction.score)}`}>
                      {opp.conviction.score.toFixed(0)}
                    </div>
                    <p className="text-xs text-zinc-500">Conviction Score</p>
                  </div>
                </div>

                {/* Rejection Reason */}
                {opp.status === 'REJECTED' && opp.rejectionReason && (
                  <div className="mb-4 px-3 py-2 rounded bg-red-500/10 border border-red-500/20">
                    <div className="flex items-center gap-2 text-red-400 text-sm">
                      <AlertTriangle className="h-4 w-4" />
                      <span>{opp.rejectionReason}</span>
                    </div>
                  </div>
                )}

                {/* Info Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                  {/* Smart Wallets */}
                  <div className="p-3 rounded-lg bg-zinc-800/50">
                    <div className="flex items-center gap-2 text-zinc-400 text-xs mb-1">
                      <Users className="h-3 w-3" />
                      Smart Wallets
                    </div>
                    <div className="text-lg font-semibold text-white">
                      {opp.smartWallets.total}
                      <span className="text-xs text-zinc-500 ml-2">
                        T1:{opp.smartWallets.tier1} T2:{opp.smartWallets.tier2}
                      </span>
                    </div>
                  </div>

                  {/* Safety Score */}
                  <div className="p-3 rounded-lg bg-zinc-800/50">
                    <div className="flex items-center gap-2 text-zinc-400 text-xs mb-1">
                      <Shield className="h-3 w-3" />
                      Safety
                    </div>
                    <div className={`text-lg font-semibold ${opp.safety.score >= 60 ? 'text-green-400' : opp.safety.score >= 40 ? 'text-yellow-400' : 'text-red-400'}`}>
                      {opp.safety.score.toFixed(0)}
                      {opp.safety.isHoneypot && (
                        <span className="text-xs text-red-500 ml-2">HONEYPOT</span>
                      )}
                    </div>
                  </div>

                  {/* Liquidity */}
                  <div className="p-3 rounded-lg bg-zinc-800/50">
                    <div className="flex items-center gap-2 text-zinc-400 text-xs mb-1">
                      <DollarSign className="h-3 w-3" />
                      Liquidity
                    </div>
                    <div className="text-lg font-semibold text-white">
                      ${formatNumber(opp.market.liquidity)}
                    </div>
                  </div>

                  {/* Dip From High */}
                  <div className="p-3 rounded-lg bg-zinc-800/50">
                    <div className="flex items-center gap-2 text-zinc-400 text-xs mb-1">
                      <TrendingDown className="h-3 w-3" />
                      Dip From High
                    </div>
                    <div className="text-lg font-semibold text-orange-400">
                      -{opp.entry.dipFromHigh.toFixed(1)}%
                    </div>
                  </div>
                </div>

                {/* Bottom Row */}
                <div className="flex items-center justify-between text-xs text-zinc-500">
                  <div className="flex items-center gap-4">
                    <span>Price: ${formatPrice(opp.market.price)}</span>
                    <span>MCap: ${formatNumber(opp.market.marketCap)}</span>
                    <span>Holders: {formatNumber(opp.market.holders)}</span>
                    <span>Age: {opp.entry.tokenAgeMinutes}m</span>
                    <span
                      className={`px-2 py-0.5 rounded ${
                        opp.entry.hypePhase === 'DISCOVERY'
                          ? 'bg-green-500/20 text-green-400'
                          : opp.entry.hypePhase === 'EARLY_FOMO'
                          ? 'bg-yellow-500/20 text-yellow-400'
                          : 'bg-red-500/20 text-red-400'
                      }`}
                    >
                      {opp.entry.hypePhase}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span>Discovered {formatTime(opp.discoveredAt)}</span>
                    <span className="text-zinc-600">via {opp.discoveredVia}</span>
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
