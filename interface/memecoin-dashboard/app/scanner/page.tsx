"use client"

import { useEffect, useState, useCallback } from "react"
import { cn } from "@/lib/utils"

interface TokenOpportunity {
  id: string
  tokenAddress: string
  tokenName: string
  tokenSymbol: string
  discoveredAt: string
  discoveredVia: string
  smartWallets: {
    addresses: string[]
    total: number
    tier1: number
    tier2: number
    tier3: number
  }
  safety: {
    score: number
    isHoneypot: boolean
    hasMintAuthority: boolean
    hasFreezeAuthority: boolean
  }
  market: {
    price: number
    marketCap: number
    liquidity: number
    holders: number
    volume24h: number
    priceChange1h: number
    priceChange24h: number
  }
  entry: {
    dipFromHigh: number
    athPrice: number
    tokenAgeMinutes: number
    hypePhase: string
  }
  conviction: {
    score: number
    breakdown: Record<string, number>
  }
  status: string
  rejectionReason: string | null
  lastUpdated: string
}

interface ScannerStats {
  total: number
  analyzing: number
  qualified: number
  rejected: number
  entered: number
  avgConviction: number
}

export default function ScannerPage() {
  const [opportunities, setOpportunities] = useState<TokenOpportunity[]>([])
  const [stats, setStats] = useState<ScannerStats>({
    total: 0,
    analyzing: 0,
    qualified: 0,
    rejected: 0,
    entered: 0,
    avgConviction: 0,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newTokenAddress, setNewTokenAddress] = useState("")
  const [analyzing, setAnalyzing] = useState(false)
  const [selectedToken, setSelectedToken] = useState<TokenOpportunity | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/scanner")
      const data = await res.json()

      if (data.success && data.data) {
        setOpportunities(data.data.opportunities || [])
        setStats(data.data.stats || {
          total: 0,
          analyzing: 0,
          qualified: 0,
          rejected: 0,
          entered: 0,
          avgConviction: 0,
        })
      }
      setError(null)
    } catch (err) {
      setError("Failed to fetch scanner data")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 5000)
    return () => clearInterval(interval)
  }, [fetchData])

  const handleAnalyzeToken = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTokenAddress.trim() || newTokenAddress.length !== 44) {
      setError("Invalid token address (must be 44 characters)")
      return
    }

    setAnalyzing(true)
    setError(null)

    try {
      const res = await fetch("/api/scanner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokenAddress: newTokenAddress }),
      })
      const data = await res.json()
      if (data.success) {
        setNewTokenAddress("")
        await fetchData()
      } else {
        setError(data.error || "Failed to analyze token")
      }
    } catch (err) {
      setError("Failed to analyze token")
    } finally {
      setAnalyzing(false)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case "ANALYZING": return "bg-blue-500/20 text-blue-400"
      case "QUALIFIED": return "bg-green-500/20 text-green-400"
      case "REJECTED": return "bg-red-500/20 text-red-400"
      case "ENTERED": return "bg-purple-500/20 text-purple-400"
      default: return "bg-zinc-500/20 text-zinc-400"
    }
  }

  const getConvictionColor = (score: number) => {
    if (score >= 85) return "text-green-400"
    if (score >= 70) return "text-yellow-400"
    if (score >= 50) return "text-orange-400"
    return "text-red-400"
  }

  const getHypePhaseColor = (phase: string) => {
    switch (phase) {
      case "DISCOVERY": return "text-green-400"
      case "EARLY_FOMO": return "text-yellow-400"
      case "PEAK_FOMO": return "text-red-400"
      case "DISTRIBUTION": return "text-orange-400"
      case "DUMP": return "text-red-500"
      default: return "text-zinc-400"
    }
  }

  const formatPrice = (price: number) => {
    if (price < 0.000001) return price.toExponential(2)
    if (price < 0.01) return price.toFixed(8)
    if (price < 1) return price.toFixed(4)
    return price.toFixed(2)
  }

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`
    return num.toFixed(0)
  }

  const formatTime = (dateStr: string) => {
    if (!dateStr) return "-"
    const date = new Date(dateStr)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const minutes = Math.floor(diff / (1000 * 60))
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    return `${Math.floor(hours / 24)}d ago`
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-zinc-400">Loading scanner...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Token Scanner</h1>
        <div className="flex items-center gap-2 text-sm text-zinc-400">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          Scanning...
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-red-400">
          {error}
          <button onClick={() => setError(null)} className="ml-4 text-sm underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Manual Token Analysis */}
      <form onSubmit={handleAnalyzeToken} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
        <div className="flex flex-wrap gap-4">
          <input
            type="text"
            value={newTokenAddress}
            onChange={(e) => setNewTokenAddress(e.target.value)}
            placeholder="Enter token address to analyze..."
            className="flex-1 min-w-[300px] px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white font-mono text-sm placeholder-zinc-500 focus:outline-none focus:border-zinc-600"
          />
          <button
            type="submit"
            disabled={analyzing || !newTokenAddress.trim()}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
          >
            {analyzing ? "Analyzing..." : "Analyze Token"}
          </button>
        </div>
      </form>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <div className="text-sm text-zinc-400">Total</div>
          <div className="text-2xl font-bold text-white">{stats.total}</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <div className="text-sm text-zinc-400">Analyzing</div>
          <div className="text-2xl font-bold text-blue-400">{stats.analyzing}</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <div className="text-sm text-zinc-400">Qualified</div>
          <div className="text-2xl font-bold text-green-400">{stats.qualified}</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <div className="text-sm text-zinc-400">Rejected</div>
          <div className="text-2xl font-bold text-red-400">{stats.rejected}</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <div className="text-sm text-zinc-400">Entered</div>
          <div className="text-2xl font-bold text-purple-400">{stats.entered}</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <div className="text-sm text-zinc-400">Avg Conviction</div>
          <div className={cn("text-2xl font-bold", getConvictionColor(stats.avgConviction))}>
            {stats.avgConviction.toFixed(0)}
          </div>
        </div>
      </div>

      {/* Token Opportunities List */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
        {opportunities.length === 0 ? (
          <div className="text-zinc-500 text-center py-12">
            <div className="text-lg mb-2">No tokens being analyzed</div>
            <div className="text-sm">Tokens will appear here when smart wallets make purchases</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-zinc-800 text-left text-sm text-zinc-400">
                  <th className="px-4 py-3 font-medium">Token</th>
                  <th className="px-4 py-3 font-medium">Smart Wallets</th>
                  <th className="px-4 py-3 font-medium">Safety</th>
                  <th className="px-4 py-3 font-medium">Liquidity</th>
                  <th className="px-4 py-3 font-medium">Dip %</th>
                  <th className="px-4 py-3 font-medium">Conviction</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Age</th>
                </tr>
              </thead>
              <tbody>
                {opportunities.map((opp) => (
                  <tr
                    key={opp.id}
                    onClick={() => setSelectedToken(opp)}
                    className="border-b border-zinc-800/50 hover:bg-zinc-800/30 cursor-pointer"
                  >
                    <td className="px-4 py-3">
                      <div>
                        <div className="font-medium text-white">{opp.tokenSymbol || "???"}</div>
                        <div className="text-xs text-zinc-500 font-mono">
                          {opp.tokenAddress.slice(0, 6)}...{opp.tokenAddress.slice(-4)}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-white font-medium">{opp.smartWallets.total}</span>
                        {opp.smartWallets.tier1 > 0 && (
                          <span className="px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 text-xs rounded">
                            T1: {opp.smartWallets.tier1}
                          </span>
                        )}
                        {opp.smartWallets.tier2 > 0 && (
                          <span className="px-1.5 py-0.5 bg-blue-500/20 text-blue-400 text-xs rounded">
                            T2: {opp.smartWallets.tier2}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          "font-medium",
                          opp.safety.score >= 80 ? "text-green-400" :
                          opp.safety.score >= 60 ? "text-yellow-400" : "text-red-400"
                        )}>
                          {opp.safety.score.toFixed(0)}
                        </span>
                        {opp.safety.isHoneypot && (
                          <span className="px-1.5 py-0.5 bg-red-500/20 text-red-400 text-xs rounded">HP</span>
                        )}
                        {opp.safety.hasMintAuthority && (
                          <span className="px-1.5 py-0.5 bg-orange-500/20 text-orange-400 text-xs rounded">MINT</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-zinc-300">
                      ${formatNumber(opp.market.liquidity)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        opp.entry.dipFromHigh >= 20 ? "text-green-400" :
                        opp.entry.dipFromHigh >= 10 ? "text-yellow-400" : "text-zinc-400"
                      )}>
                        -{opp.entry.dipFromHigh.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("font-bold", getConvictionColor(opp.conviction.score))}>
                        {opp.conviction.score.toFixed(0)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("px-2 py-1 rounded text-xs font-medium", getStatusColor(opp.status))}>
                        {opp.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-zinc-400">
                      {formatTime(opp.discoveredAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Token Details Modal */}
      {selectedToken && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50"
          onClick={() => setSelectedToken(null)}
        >
          <div
            className="bg-zinc-900 border border-zinc-800 rounded-lg max-w-2xl w-full max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 space-y-6">
              {/* Header */}
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-xl font-bold text-white">
                    {selectedToken.tokenName || "Unknown Token"} ({selectedToken.tokenSymbol || "???"})
                  </h2>
                  <div className="text-sm text-zinc-400 font-mono mt-1">
                    {selectedToken.tokenAddress}
                  </div>
                </div>
                <button
                  onClick={() => setSelectedToken(null)}
                  className="text-zinc-400 hover:text-white text-2xl"
                >
                  &times;
                </button>
              </div>

              {/* Status & Conviction */}
              <div className="flex items-center gap-4">
                <span className={cn("px-3 py-1 rounded text-sm font-medium", getStatusColor(selectedToken.status))}>
                  {selectedToken.status}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-zinc-400">Conviction:</span>
                  <span className={cn("text-2xl font-bold", getConvictionColor(selectedToken.conviction.score))}>
                    {selectedToken.conviction.score.toFixed(0)}
                  </span>
                </div>
                {selectedToken.rejectionReason && (
                  <span className="text-red-400 text-sm">
                    Reason: {selectedToken.rejectionReason}
                  </span>
                )}
              </div>

              {/* Smart Wallets */}
              <div className="bg-zinc-800/50 rounded-lg p-4">
                <h3 className="text-sm font-medium text-zinc-400 mb-3">Smart Wallet Activity</h3>
                <div className="grid grid-cols-4 gap-4">
                  <div>
                    <div className="text-2xl font-bold text-white">{selectedToken.smartWallets.total}</div>
                    <div className="text-xs text-zinc-500">Total</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-yellow-400">{selectedToken.smartWallets.tier1}</div>
                    <div className="text-xs text-zinc-500">Tier 1</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-blue-400">{selectedToken.smartWallets.tier2}</div>
                    <div className="text-xs text-zinc-500">Tier 2</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-zinc-400">{selectedToken.smartWallets.tier3}</div>
                    <div className="text-xs text-zinc-500">Tier 3</div>
                  </div>
                </div>
              </div>

              {/* Safety Analysis */}
              <div className="bg-zinc-800/50 rounded-lg p-4">
                <h3 className="text-sm font-medium text-zinc-400 mb-3">Safety Analysis</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-300">Safety Score</span>
                    <span className={cn(
                      "font-bold",
                      selectedToken.safety.score >= 80 ? "text-green-400" :
                      selectedToken.safety.score >= 60 ? "text-yellow-400" : "text-red-400"
                    )}>
                      {selectedToken.safety.score.toFixed(0)}/100
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-300">Honeypot</span>
                    <span className={selectedToken.safety.isHoneypot ? "text-red-400" : "text-green-400"}>
                      {selectedToken.safety.isHoneypot ? "YES" : "No"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-300">Mint Authority</span>
                    <span className={selectedToken.safety.hasMintAuthority ? "text-red-400" : "text-green-400"}>
                      {selectedToken.safety.hasMintAuthority ? "ACTIVE" : "Disabled"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-300">Freeze Authority</span>
                    <span className={selectedToken.safety.hasFreezeAuthority ? "text-orange-400" : "text-green-400"}>
                      {selectedToken.safety.hasFreezeAuthority ? "Active" : "Disabled"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Market Data */}
              <div className="bg-zinc-800/50 rounded-lg p-4">
                <h3 className="text-sm font-medium text-zinc-400 mb-3">Market Data</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-300">Price</span>
                    <span className="text-white font-mono">${formatPrice(selectedToken.market.price)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-300">Market Cap</span>
                    <span className="text-white">${formatNumber(selectedToken.market.marketCap)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-300">Liquidity</span>
                    <span className="text-white">${formatNumber(selectedToken.market.liquidity)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-300">Holders</span>
                    <span className="text-white">{formatNumber(selectedToken.market.holders)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-300">24h Volume</span>
                    <span className="text-white">${formatNumber(selectedToken.market.volume24h)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-300">1h Change</span>
                    <span className={selectedToken.market.priceChange1h >= 0 ? "text-green-400" : "text-red-400"}>
                      {selectedToken.market.priceChange1h >= 0 ? "+" : ""}{selectedToken.market.priceChange1h.toFixed(2)}%
                    </span>
                  </div>
                </div>
              </div>

              {/* Entry Analysis */}
              <div className="bg-zinc-800/50 rounded-lg p-4">
                <h3 className="text-sm font-medium text-zinc-400 mb-3">Entry Analysis</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-300">Dip from High</span>
                    <span className={cn(
                      "font-medium",
                      selectedToken.entry.dipFromHigh >= 20 ? "text-green-400" :
                      selectedToken.entry.dipFromHigh >= 10 ? "text-yellow-400" : "text-zinc-400"
                    )}>
                      -{selectedToken.entry.dipFromHigh.toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-300">Token Age</span>
                    <span className="text-white">{selectedToken.entry.tokenAgeMinutes}m</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-300">ATH Price</span>
                    <span className="text-white font-mono">${formatPrice(selectedToken.entry.athPrice)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-300">Hype Phase</span>
                    <span className={getHypePhaseColor(selectedToken.entry.hypePhase)}>
                      {selectedToken.entry.hypePhase}
                    </span>
                  </div>
                </div>
              </div>

              {/* Conviction Breakdown */}
              {Object.keys(selectedToken.conviction.breakdown).length > 0 && (
                <div className="bg-zinc-800/50 rounded-lg p-4">
                  <h3 className="text-sm font-medium text-zinc-400 mb-3">Conviction Breakdown</h3>
                  <div className="space-y-2">
                    {Object.entries(selectedToken.conviction.breakdown).map(([key, value]) => (
                      <div key={key} className="flex items-center justify-between">
                        <span className="text-zinc-300 capitalize">{key.replace(/_/g, " ")}</span>
                        <span className="text-white">{typeof value === 'number' ? value.toFixed(1) : value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Meta Info */}
              <div className="text-xs text-zinc-500 flex items-center justify-between">
                <span>Discovered via: {selectedToken.discoveredVia}</span>
                <span>Updated: {formatTime(selectedToken.lastUpdated)}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
