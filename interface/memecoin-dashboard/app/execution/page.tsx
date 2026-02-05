'use client';

import { useEffect, useState } from 'react';
import { Activity, RefreshCw, Server, Zap, Clock, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

interface RpcNode {
  name: string;
  url: string;
  status: 'healthy' | 'degraded' | 'down';
  latency: number;
  isPrimary: boolean;
  lastCheck: string;
  successRate: number;
}

interface ExecutionStats {
  avgLatency: number;
  successRate: number;
  totalTransactions: number;
  failedTransactions: number;
  retriesUsed: number;
  avgPriorityFee: number;
  avgSlippage: number;
}

interface RecentTransaction {
  id: string;
  type: 'buy' | 'sell' | 'emergency';
  tokenSymbol: string;
  status: 'success' | 'failed' | 'pending';
  latency: number;
  slippage: number;
  priorityFee: number;
  retries: number;
  timestamp: string;
  signature?: string;
  error?: string;
}

interface NetworkStatus {
  tps: number;
  congestionLevel: 'low' | 'medium' | 'high' | 'critical';
  avgBlockTime: number;
  currentSlot: number;
}

export default function ExecutionPage() {
  const [rpcNodes, setRpcNodes] = useState<RpcNode[]>([]);
  const [stats, setStats] = useState<ExecutionStats | null>(null);
  const [transactions, setTransactions] = useState<RecentTransaction[]>([]);
  const [network, setNetwork] = useState<NetworkStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      const response = await fetch(`${API_URL}/execution`);
      if (!response.ok) throw new Error('Failed to fetch');
      const result = await response.json();
      if (result.success) {
        setRpcNodes(result.data?.rpcNodes || []);
        setStats(result.data?.stats || null);
        setTransactions(result.data?.recentTransactions || []);
        setNetwork(result.data?.network || null);
      }
      setError(null);
    } catch (err) {
      console.error('Error fetching execution data:', err);
      setError('Failed to fetch execution data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  const testRpcNode = async (nodeName: string) => {
    try {
      const response = await fetch(`${API_URL}/execution/rpc/${encodeURIComponent(nodeName)}/test`, {
        method: 'POST',
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error);
      await fetchData();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to test RPC node';
      setError(message);
    }
  };

  const switchPrimaryRpc = async (nodeName: string) => {
    try {
      const response = await fetch(`${API_URL}/execution/rpc/primary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeName }),
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error);
      await fetchData();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to switch RPC';
      setError(message);
    }
  };

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString();
  };

  const getCongestionColor = (level: string) => {
    switch (level) {
      case 'low': return 'text-green-400';
      case 'medium': return 'text-yellow-400';
      case 'high': return 'text-orange-400';
      case 'critical': return 'text-red-400';
      default: return 'text-zinc-400';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'healthy':
      case 'success':
        return <CheckCircle className="h-4 w-4 text-green-400" />;
      case 'degraded':
      case 'pending':
        return <AlertTriangle className="h-4 w-4 text-yellow-400" />;
      case 'down':
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-400" />;
      default:
        return <Activity className="h-4 w-4 text-zinc-400" />;
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950 text-white">
        <div className="text-center">
          <div className="mx-auto mb-4 h-16 w-16 animate-spin rounded-full border-b-2 border-white"></div>
          <p className="text-zinc-400">Loading execution data...</p>
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
                <Activity className="h-8 w-8 text-blue-400" />
                Execution & Infrastructure
              </h1>
              <p className="text-zinc-500 mt-1">Monitor RPC nodes, network status, and transaction performance</p>
            </div>
            <button
              onClick={fetchData}
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

        {/* Network Status */}
        {network && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 mb-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Zap className="h-5 w-5 text-yellow-400" />
              Solana Network Status
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-4 rounded-lg bg-zinc-800/50">
                <p className="text-sm text-zinc-500 mb-1">TPS</p>
                <p className="text-2xl font-bold text-white">{network.tps.toLocaleString()}</p>
              </div>
              <div className="p-4 rounded-lg bg-zinc-800/50">
                <p className="text-sm text-zinc-500 mb-1">Congestion</p>
                <p className={`text-2xl font-bold ${getCongestionColor(network.congestionLevel)}`}>
                  {network.congestionLevel.toUpperCase()}
                </p>
              </div>
              <div className="p-4 rounded-lg bg-zinc-800/50">
                <p className="text-sm text-zinc-500 mb-1">Block Time</p>
                <p className="text-2xl font-bold text-white">{network.avgBlockTime}ms</p>
              </div>
              <div className="p-4 rounded-lg bg-zinc-800/50">
                <p className="text-sm text-zinc-500 mb-1">Current Slot</p>
                <p className="text-2xl font-bold text-white">{network.currentSlot.toLocaleString()}</p>
              </div>
            </div>
          </div>
        )}

        {/* Execution Stats */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="h-4 w-4 text-zinc-500" />
                <h3 className="text-sm font-medium text-zinc-400">Avg Latency</h3>
              </div>
              <p className={`text-2xl font-bold ${stats.avgLatency < 500 ? 'text-green-400' : stats.avgLatency < 1000 ? 'text-yellow-400' : 'text-red-400'}`}>
                {stats.avgLatency}ms
              </p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
              <h3 className="text-sm font-medium text-zinc-400 mb-2">Success Rate</h3>
              <p className={`text-2xl font-bold ${stats.successRate >= 95 ? 'text-green-400' : stats.successRate >= 85 ? 'text-yellow-400' : 'text-red-400'}`}>
                {stats.successRate.toFixed(1)}%
              </p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
              <h3 className="text-sm font-medium text-zinc-400 mb-2">Avg Priority Fee</h3>
              <p className="text-2xl font-bold text-white">{stats.avgPriorityFee.toFixed(4)} SOL</p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
              <h3 className="text-sm font-medium text-zinc-400 mb-2">Avg Slippage</h3>
              <p className={`text-2xl font-bold ${stats.avgSlippage < 3 ? 'text-green-400' : stats.avgSlippage < 5 ? 'text-yellow-400' : 'text-red-400'}`}>
                {stats.avgSlippage.toFixed(2)}%
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* RPC Nodes */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Server className="h-5 w-5 text-zinc-400" />
              RPC Nodes
            </h2>
            <div className="space-y-3">
              {rpcNodes.map((node) => (
                <div
                  key={node.name}
                  className={`p-4 rounded-lg border ${
                    node.isPrimary ? 'border-green-500/30 bg-green-500/5' : 'border-zinc-800 bg-zinc-800/50'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(node.status)}
                      <span className="font-medium text-white">{node.name}</span>
                      {node.isPrimary && (
                        <span className="px-2 py-0.5 rounded text-xs bg-green-500/20 text-green-400">Primary</span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => testRpcNode(node.name)}
                        className="px-2 py-1 rounded text-xs bg-zinc-700 hover:bg-zinc-600 transition-colors"
                      >
                        Test
                      </button>
                      {!node.isPrimary && node.status === 'healthy' && (
                        <button
                          onClick={() => switchPrimaryRpc(node.name)}
                          className="px-2 py-1 rounded text-xs bg-blue-600 hover:bg-blue-700 transition-colors"
                        >
                          Set Primary
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <p className="text-zinc-500">Latency</p>
                      <p className={`font-medium ${node.latency < 100 ? 'text-green-400' : node.latency < 300 ? 'text-yellow-400' : 'text-red-400'}`}>
                        {node.latency}ms
                      </p>
                    </div>
                    <div>
                      <p className="text-zinc-500">Success Rate</p>
                      <p className="font-medium text-white">{node.successRate.toFixed(1)}%</p>
                    </div>
                    <div>
                      <p className="text-zinc-500">Last Check</p>
                      <p className="font-medium text-zinc-300">{formatTime(node.lastCheck)}</p>
                    </div>
                  </div>
                </div>
              ))}

              {rpcNodes.length === 0 && (
                <p className="text-center text-zinc-500 py-8">No RPC nodes configured.</p>
              )}
            </div>
          </div>

          {/* Recent Transactions */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
            <h2 className="text-lg font-semibold mb-4">Recent Transactions</h2>
            <div className="space-y-3 max-h-[500px] overflow-y-auto">
              {transactions.map((tx) => (
                <div key={tx.id} className={`p-3 rounded-lg ${
                  tx.status === 'success' ? 'bg-green-500/5 border border-green-500/20' :
                  tx.status === 'failed' ? 'bg-red-500/5 border border-red-500/20' :
                  'bg-yellow-500/5 border border-yellow-500/20'
                }`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(tx.status)}
                      <span className={`px-2 py-0.5 rounded text-xs ${
                        tx.type === 'buy' ? 'bg-green-500/20 text-green-400' :
                        tx.type === 'sell' ? 'bg-blue-500/20 text-blue-400' :
                        'bg-red-500/20 text-red-400'
                      }`}>
                        {tx.type.toUpperCase()}
                      </span>
                      <span className="font-medium text-white">{tx.tokenSymbol}</span>
                    </div>
                    <span className="text-xs text-zinc-500">{formatTime(tx.timestamp)}</span>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-xs">
                    <div>
                      <p className="text-zinc-500">Latency</p>
                      <p className="text-zinc-300">{tx.latency}ms</p>
                    </div>
                    <div>
                      <p className="text-zinc-500">Slippage</p>
                      <p className="text-zinc-300">{tx.slippage.toFixed(2)}%</p>
                    </div>
                    <div>
                      <p className="text-zinc-500">Fee</p>
                      <p className="text-zinc-300">{tx.priorityFee.toFixed(5)}</p>
                    </div>
                    <div>
                      <p className="text-zinc-500">Retries</p>
                      <p className="text-zinc-300">{tx.retries}</p>
                    </div>
                  </div>
                  {tx.error && (
                    <p className="text-xs text-red-400 mt-2">{tx.error}</p>
                  )}
                  {tx.signature && (
                    <a
                      href={`https://solscan.io/tx/${tx.signature}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-400 hover:underline mt-1 block"
                    >
                      View on Solscan
                    </a>
                  )}
                </div>
              ))}

              {transactions.length === 0 && (
                <p className="text-center text-zinc-500 py-8">No recent transactions.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
