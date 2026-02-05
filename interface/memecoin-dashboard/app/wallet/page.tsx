'use client';

import { useEffect, useState } from 'react';
import { Wallet, RefreshCw, Copy, Check, ExternalLink, ArrowUpRight, ArrowDownRight, Send, Download } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

interface WalletBalance {
  sol: number;
  solUsd: number;
  tokens: TokenBalance[];
  totalValueUsd: number;
}

interface TokenBalance {
  mint: string;
  symbol: string;
  name: string;
  balance: number;
  valueUsd: number;
  priceUsd: number;
  change24h: number;
}

interface WalletTransaction {
  signature: string;
  type: 'send' | 'receive' | 'swap' | 'trade';
  amount: number;
  token: string;
  timestamp: string;
  status: 'success' | 'failed';
}

interface WalletInfo {
  address: string;
  balance: WalletBalance;
  recentTransactions: WalletTransaction[];
  dailyPnL: number;
  weeklyPnL: number;
  allTimePnL: number;
}

export default function WalletPage() {
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [sweeping, setSweeping] = useState(false);

  const fetchWallet = async () => {
    try {
      const response = await fetch(`${API_URL}/wallet`);
      if (!response.ok) throw new Error('Failed to fetch');
      const result = await response.json();
      if (result.success) {
        setWallet(result.data);
      }
      setError(null);
    } catch (err) {
      console.error('Error fetching wallet:', err);
      setError('Failed to fetch wallet data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWallet();
    const interval = setInterval(fetchWallet, 15000);
    return () => clearInterval(interval);
  }, []);

  const copyAddress = () => {
    if (wallet?.address) {
      navigator.clipboard.writeText(wallet.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const sweepProfits = async () => {
    if (!confirm('Sweep profits to cold storage? This will transfer excess SOL to your configured cold wallet.')) return;

    setSweeping(true);
    try {
      const response = await fetch(`${API_URL}/wallet/sweep`, {
        method: 'POST',
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error);
      await fetchWallet();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to sweep profits';
      setError(message);
    } finally {
      setSweeping(false);
    }
  };

  const formatUsd = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleString();
  };

  const truncateAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950 text-white">
        <div className="text-center">
          <div className="mx-auto mb-4 h-16 w-16 animate-spin rounded-full border-b-2 border-white"></div>
          <p className="text-zinc-400">Loading wallet...</p>
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
                <Wallet className="h-8 w-8 text-green-400" />
                Bot Wallet
              </h1>
              <p className="text-zinc-500 mt-1">Trading wallet balance and transactions</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={fetchWallet}
                className="flex items-center gap-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 px-4 py-2 transition-colors"
              >
                <RefreshCw className="h-4 w-4" />
                Refresh
              </button>
              <button
                onClick={sweepProfits}
                disabled={sweeping}
                className="flex items-center gap-2 rounded-lg bg-green-600 hover:bg-green-700 px-4 py-2 transition-colors disabled:opacity-50"
              >
                {sweeping ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Sweep Profits
              </button>
            </div>
          </div>
        </header>

        {error && (
          <div className="mb-6 rounded-lg bg-red-500/10 border border-red-500/20 p-4">
            <p className="text-red-400">{error}</p>
          </div>
        )}

        {wallet && (
          <>
            {/* Wallet Address */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 mb-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-zinc-500 mb-1">Wallet Address</p>
                  <div className="flex items-center gap-3">
                    <code className="text-lg font-mono text-white">{truncateAddress(wallet.address)}</code>
                    <button
                      onClick={copyAddress}
                      className="text-zinc-500 hover:text-white transition-colors"
                    >
                      {copied ? <Check className="h-5 w-5 text-green-400" /> : <Copy className="h-5 w-5" />}
                    </button>
                    <a
                      href={`https://solscan.io/account/${wallet.address}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-zinc-500 hover:text-white transition-colors"
                    >
                      <ExternalLink className="h-5 w-5" />
                    </a>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm text-zinc-500 mb-1">Total Value</p>
                  <p className="text-3xl font-bold text-white">{formatUsd(wallet.balance.totalValueUsd)}</p>
                </div>
              </div>
            </div>

            {/* P&L Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
                <h3 className="text-sm font-medium text-zinc-400 mb-2">Daily P&L</h3>
                <p className={`text-2xl font-bold ${wallet.dailyPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {wallet.dailyPnL >= 0 ? '+' : ''}{formatUsd(wallet.dailyPnL)}
                </p>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
                <h3 className="text-sm font-medium text-zinc-400 mb-2">Weekly P&L</h3>
                <p className={`text-2xl font-bold ${wallet.weeklyPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {wallet.weeklyPnL >= 0 ? '+' : ''}{formatUsd(wallet.weeklyPnL)}
                </p>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
                <h3 className="text-sm font-medium text-zinc-400 mb-2">All-Time P&L</h3>
                <p className={`text-2xl font-bold ${wallet.allTimePnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {wallet.allTimePnL >= 0 ? '+' : ''}{formatUsd(wallet.allTimePnL)}
                </p>
              </div>
            </div>

            {/* Balances */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 mb-6">
              <h2 className="text-lg font-semibold mb-4">Balances</h2>

              {/* SOL Balance */}
              <div className="flex items-center justify-between p-4 rounded-lg bg-zinc-800/50 mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-green-400 flex items-center justify-center font-bold text-white">
                    ◎
                  </div>
                  <div>
                    <p className="font-medium text-white">SOL</p>
                    <p className="text-sm text-zinc-500">Solana</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-bold text-white">{wallet.balance.sol.toFixed(4)} SOL</p>
                  <p className="text-sm text-zinc-400">{formatUsd(wallet.balance.solUsd)}</p>
                </div>
              </div>

              {/* Token Balances */}
              {wallet.balance.tokens.length > 0 ? (
                <div className="space-y-2">
                  {wallet.balance.tokens.map((token) => (
                    <div key={token.mint} className="flex items-center justify-between p-3 rounded-lg bg-zinc-800/30 hover:bg-zinc-800/50 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center text-xs font-bold text-white">
                          {token.symbol.slice(0, 2)}
                        </div>
                        <div>
                          <p className="font-medium text-white">{token.symbol}</p>
                          <p className="text-xs text-zinc-500">{token.name}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-medium text-white">{token.balance.toLocaleString()}</p>
                        <div className="flex items-center gap-2">
                          <p className="text-sm text-zinc-400">{formatUsd(token.valueUsd)}</p>
                          <span className={`text-xs ${token.change24h >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {token.change24h >= 0 ? '+' : ''}{token.change24h.toFixed(1)}%
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center text-zinc-500 py-4">No token holdings</p>
              )}
            </div>

            {/* Recent Transactions */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
              <h2 className="text-lg font-semibold mb-4">Recent Transactions</h2>

              {wallet.recentTransactions.length > 0 ? (
                <div className="space-y-2">
                  {wallet.recentTransactions.map((tx) => (
                    <div key={tx.signature} className="flex items-center justify-between p-3 rounded-lg bg-zinc-800/30">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                          tx.type === 'receive' ? 'bg-green-500/20 text-green-400' :
                          tx.type === 'send' ? 'bg-red-500/20 text-red-400' :
                          'bg-blue-500/20 text-blue-400'
                        }`}>
                          {tx.type === 'receive' ? <ArrowDownRight className="h-4 w-4" /> :
                           tx.type === 'send' ? <ArrowUpRight className="h-4 w-4" /> :
                           <Send className="h-4 w-4" />}
                        </div>
                        <div>
                          <p className="font-medium text-white capitalize">{tx.type}</p>
                          <p className="text-xs text-zinc-500">{formatTime(tx.timestamp)}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={`font-medium ${tx.type === 'receive' ? 'text-green-400' : 'text-white'}`}>
                          {tx.type === 'receive' ? '+' : ''}{tx.amount.toFixed(4)} {tx.token}
                        </p>
                        <a
                          href={`https://solscan.io/tx/${tx.signature}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-400 hover:underline"
                        >
                          View
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center text-zinc-500 py-8">No recent transactions</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
