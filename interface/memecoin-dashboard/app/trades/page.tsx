"use client"

import { useEffect, useState, useCallback } from "react"
import { cn } from "@/lib/utils"

interface Trade {
  id: string
  tokenSymbol: string
  tokenName: string
  entryPrice: number
  exitPrice: number
  pnl: number
  pnlPercent: number
  exitReason: string
  entryTime: string
  exitTime: string
  convictionScore: number
}

interface Stats {
  totalTrades: number
  winRate: number
  totalPnL: number
  avgWin: number
  avgLoss: number
  profitFactor: number
}

export default function TradesPage() {
  const [trades, setTrades] = useState<Trade[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<"all" | "wins" | "losses">("all")

  const fetchTrades = useCallback(async () => {
    try {
      const res = await fetch("/api/trades")
      const data = await res.json()
      if (data.success && data.data) {
        setTrades(data.data.trades || [])
        setStats(data.data.stats || null)
      }
    } catch (err) {
      console.error("Failed to fetch trades:", err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTrades()
  }, [fetchTrades])

  const filteredTrades = trades.filter((trade) => {
    if (filter === "wins") return trade.pnl > 0
    if (filter === "losses") return trade.pnl < 0
    return true
  })

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "-"
    const date = new Date(dateStr)
    return date.toLocaleDateString() + " " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-zinc-400">Loading...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Trade History</h1>

      {/* Stats Row */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
            <div className="text-sm text-zinc-400">Total Trades</div>
            <div className="text-xl font-bold text-white">{stats.totalTrades}</div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
            <div className="text-sm text-zinc-400">Win Rate</div>
            <div className="text-xl font-bold text-white">{(stats.winRate * 100).toFixed(1)}%</div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
            <div className="text-sm text-zinc-400">Total P&L</div>
            <div className={cn(
              "text-xl font-bold",
              stats.totalPnL >= 0 ? "text-green-400" : "text-red-400"
            )}>
              ${stats.totalPnL.toFixed(2)}
            </div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
            <div className="text-sm text-zinc-400">Avg Win</div>
            <div className="text-xl font-bold text-green-400">+{stats.avgWin.toFixed(1)}%</div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
            <div className="text-sm text-zinc-400">Avg Loss</div>
            <div className="text-xl font-bold text-red-400">{stats.avgLoss.toFixed(1)}%</div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
            <div className="text-sm text-zinc-400">Profit Factor</div>
            <div className="text-xl font-bold text-white">{stats.profitFactor.toFixed(2)}</div>
          </div>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex gap-2">
        {(["all", "wins", "losses"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "px-4 py-2 rounded-lg font-medium text-sm transition-colors",
              filter === f
                ? "bg-zinc-700 text-white"
                : "bg-zinc-800/50 text-zinc-400 hover:text-white"
            )}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Trades Table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
        {filteredTrades.length === 0 ? (
          <div className="text-zinc-500 text-center py-12">No trades found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-zinc-800 text-left text-sm text-zinc-400">
                  <th className="px-4 py-3 font-medium">Token</th>
                  <th className="px-4 py-3 font-medium">Entry</th>
                  <th className="px-4 py-3 font-medium">Exit</th>
                  <th className="px-4 py-3 font-medium">P&L</th>
                  <th className="px-4 py-3 font-medium">Exit Reason</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {filteredTrades.map((trade) => (
                  <tr key={trade.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">{trade.tokenSymbol}</div>
                      <div className="text-xs text-zinc-500">{trade.tokenName}</div>
                    </td>
                    <td className="px-4 py-3 text-zinc-300">
                      ${trade.entryPrice.toFixed(6)}
                    </td>
                    <td className="px-4 py-3 text-zinc-300">
                      ${trade.exitPrice.toFixed(6)}
                    </td>
                    <td className="px-4 py-3">
                      <div className={cn(
                        "font-medium",
                        trade.pnl >= 0 ? "text-green-400" : "text-red-400"
                      )}>
                        {trade.pnl >= 0 ? "+" : ""}{trade.pnlPercent.toFixed(2)}%
                      </div>
                      <div className={cn(
                        "text-xs",
                        trade.pnl >= 0 ? "text-green-400/70" : "text-red-400/70"
                      )}>
                        ${trade.pnl.toFixed(2)}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        "px-2 py-1 rounded text-xs font-medium",
                        trade.exitReason === "TAKE_PROFIT" || trade.exitReason === "WIN"
                          ? "bg-green-500/20 text-green-400"
                          : trade.exitReason === "STOP_LOSS" || trade.exitReason === "LOSS"
                          ? "bg-red-500/20 text-red-400"
                          : "bg-zinc-700 text-zinc-300"
                      )}>
                        {trade.exitReason}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-zinc-400">
                      {formatDate(trade.exitTime || trade.entryTime)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
