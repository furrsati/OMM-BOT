"use client"

import { useEffect, useState, useCallback } from "react"
import { cn } from "@/lib/utils"

interface BotStatus {
  isRunning: boolean
  isPaused: boolean
  tradingEnabled: boolean
  paperTradingMode: boolean
  uptime: number
  marketRegime: string
  dailyPnL: number
  totalPnL: number
  winRate: number
  openPositions: number
  solPrice: number
  solChange24h: number
  btcChange24h: number
}

interface Position {
  id: string
  tokenAddress: string
  tokenName: string
  tokenSymbol: string
  entryPrice: number
  currentPrice: number
  quantity: number
  pnl: number
  pnlPercent: number
  convictionScore: number
  smartWalletCount: number
}

export default function Dashboard() {
  const [status, setStatus] = useState<BotStatus | null>(null)
  const [positions, setPositions] = useState<Position[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const [statusRes, positionsRes] = await Promise.all([
        fetch("/api/status"),
        fetch("/api/positions"),
      ])

      const statusData = await statusRes.json()
      const positionsData = await positionsRes.json()

      if (statusData.success && statusData.data) {
        const d = statusData.data
        setStatus({
          isRunning: d.bot?.isRunning ?? false,
          isPaused: d.bot?.isPaused ?? false,
          tradingEnabled: d.bot?.tradingEnabled ?? false,
          paperTradingMode: d.bot?.paperTradingMode ?? true,
          uptime: d.bot?.uptime ?? 0,
          marketRegime: d.market?.regime ?? "UNKNOWN",
          dailyPnL: d.trading?.dailyPnL ?? 0,
          totalPnL: d.performance?.totalPnL ?? 0,
          winRate: d.performance?.winRate ?? 0,
          openPositions: d.performance?.openPositions ?? 0,
          solPrice: d.market?.solPrice ?? 0,
          solChange24h: d.market?.solChange24h ?? 0,
          btcChange24h: d.market?.btcChange24h ?? 0,
        })
      }

      if (positionsData.success && positionsData.data) {
        setPositions(positionsData.data)
      }

      setError(null)
    } catch (err) {
      setError("Failed to fetch data")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 5000)
    return () => clearInterval(interval)
  }, [fetchData])

  const handleBotAction = async (action: string) => {
    setActionLoading(action)
    try {
      const res = await fetch(`/api/bot/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (data.success) {
        await fetchData()
      } else {
        setError(data.error || `Failed to ${action}`)
      }
    } catch (err) {
      setError(`Failed to ${action}`)
    } finally {
      setActionLoading(null)
    }
  }

  const handleClosePosition = async (id: string) => {
    try {
      const res = await fetch(`/api/positions/${id}/close`, {
        method: "POST",
      })
      const data = await res.json()
      if (data.success) {
        await fetchData()
      }
    } catch (err) {
      setError("Failed to close position")
    }
  }

  const handleConfigChange = async (key: string, value: boolean) => {
    try {
      const res = await fetch("/api/bot/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      })
      const data = await res.json()
      if (data.success) {
        await fetchData()
      }
    } catch (err) {
      setError("Failed to update config")
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-zinc-400">Loading...</div>
      </div>
    )
  }

  const getStatusColor = () => {
    if (!status) return "bg-zinc-600"
    if (!status.isRunning) return "bg-red-500"
    if (status.isPaused) return "bg-yellow-500"
    return "bg-green-500"
  }

  const getStatusText = () => {
    if (!status) return "Offline"
    if (!status.isRunning) return "Stopped"
    if (status.isPaused) return "Paused"
    return "Running"
  }

  const getRegimeColor = (regime: string) => {
    switch (regime) {
      case "FULL": return "text-green-400"
      case "CAUTIOUS": return "text-yellow-400"
      case "DEFENSIVE": return "text-orange-400"
      case "PAUSE": return "text-red-400"
      default: return "text-zinc-400"
    }
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-red-400">
          {error}
          <button onClick={() => setError(null)} className="ml-4 text-sm underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Header with Status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <div className="flex items-center gap-2">
            <div className={cn("w-3 h-3 rounded-full", getStatusColor())} />
            <span className="text-zinc-300">{getStatusText()}</span>
          </div>
        </div>
        <button
          onClick={() => handleBotAction("kill")}
          disabled={actionLoading === "kill"}
          className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
        >
          {actionLoading === "kill" ? "..." : "KILL SWITCH"}
        </button>
      </div>

      {/* Bot Controls */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex gap-2">
            <button
              onClick={() => handleBotAction("start")}
              disabled={actionLoading !== null || status?.isRunning}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
            >
              {actionLoading === "start" ? "..." : "Start"}
            </button>
            <button
              onClick={() => handleBotAction("stop")}
              disabled={actionLoading !== null || !status?.isRunning}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
            >
              {actionLoading === "stop" ? "..." : "Stop"}
            </button>
            <button
              onClick={() => handleBotAction(status?.isPaused ? "resume" : "pause")}
              disabled={actionLoading !== null || !status?.isRunning}
              className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
            >
              {actionLoading === "pause" || actionLoading === "resume"
                ? "..."
                : status?.isPaused
                ? "Resume"
                : "Pause"}
            </button>
          </div>

          <div className="flex items-center gap-4 ml-auto">
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <span>Paper Trading:</span>
              <button
                onClick={() => handleConfigChange("paperTradingMode", !status?.paperTradingMode)}
                className={cn(
                  "relative w-12 h-6 rounded-full transition-colors",
                  status?.paperTradingMode ? "bg-blue-600" : "bg-zinc-700"
                )}
              >
                <div
                  className={cn(
                    "absolute top-1 w-4 h-4 rounded-full bg-white transition-transform",
                    status?.paperTradingMode ? "left-7" : "left-1"
                  )}
                />
              </button>
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <span>Trading:</span>
              <button
                onClick={() => handleConfigChange("tradingEnabled", !status?.tradingEnabled)}
                className={cn(
                  "relative w-12 h-6 rounded-full transition-colors",
                  status?.tradingEnabled ? "bg-green-600" : "bg-zinc-700"
                )}
              >
                <div
                  className={cn(
                    "absolute top-1 w-4 h-4 rounded-full bg-white transition-transform",
                    status?.tradingEnabled ? "left-7" : "left-1"
                  )}
                />
              </button>
            </label>
          </div>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <div className="text-sm text-zinc-400">Daily P&L</div>
          <div className={cn(
            "text-2xl font-bold",
            (status?.dailyPnL ?? 0) >= 0 ? "text-green-400" : "text-red-400"
          )}>
            {(status?.dailyPnL ?? 0) >= 0 ? "+" : ""}${(status?.dailyPnL ?? 0).toFixed(2)}
          </div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <div className="text-sm text-zinc-400">Total P&L</div>
          <div className={cn(
            "text-2xl font-bold",
            (status?.totalPnL ?? 0) >= 0 ? "text-green-400" : "text-red-400"
          )}>
            {(status?.totalPnL ?? 0) >= 0 ? "+" : ""}${(status?.totalPnL ?? 0).toFixed(2)}
          </div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <div className="text-sm text-zinc-400">Win Rate</div>
          <div className="text-2xl font-bold text-white">
            {(status?.winRate ?? 0).toFixed(1)}%
          </div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <div className="text-sm text-zinc-400">Open Positions</div>
          <div className="text-2xl font-bold text-white">
            {status?.openPositions ?? positions.length}
          </div>
        </div>
      </div>

      {/* Market Conditions */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
        <div className="flex flex-wrap items-center gap-6">
          <div>
            <span className="text-sm text-zinc-400">Regime: </span>
            <span className={cn("font-medium", getRegimeColor(status?.marketRegime ?? ""))}>
              {status?.marketRegime ?? "UNKNOWN"}
            </span>
          </div>
          <div>
            <span className="text-sm text-zinc-400">SOL: </span>
            <span className="text-white font-medium">
              ${(status?.solPrice ?? 0).toFixed(2)}
            </span>
            <span className={cn(
              "ml-2 text-sm",
              (status?.solChange24h ?? 0) >= 0 ? "text-green-400" : "text-red-400"
            )}>
              {(status?.solChange24h ?? 0) >= 0 ? "+" : ""}{(status?.solChange24h ?? 0).toFixed(2)}%
            </span>
          </div>
          <div>
            <span className="text-sm text-zinc-400">BTC 24h: </span>
            <span className={cn(
              "font-medium",
              (status?.btcChange24h ?? 0) >= 0 ? "text-green-400" : "text-red-400"
            )}>
              {(status?.btcChange24h ?? 0) >= 0 ? "+" : ""}{(status?.btcChange24h ?? 0).toFixed(2)}%
            </span>
          </div>
        </div>
      </div>

      {/* Open Positions */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
        <h2 className="text-lg font-semibold text-white mb-4">Open Positions</h2>
        {positions.length === 0 ? (
          <div className="text-zinc-500 text-center py-8">No open positions</div>
        ) : (
          <div className="space-y-3">
            {positions.map((pos) => (
              <div
                key={pos.id}
                className="flex items-center justify-between bg-zinc-800/50 rounded-lg p-4"
              >
                <div className="flex items-center gap-4">
                  <div>
                    <div className="font-medium text-white">{pos.tokenSymbol}</div>
                    <div className="text-sm text-zinc-400">{pos.tokenName}</div>
                  </div>
                  <div className="text-sm text-zinc-400">
                    Conv: {pos.convictionScore}
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  <div className="text-right">
                    <div className={cn(
                      "font-medium",
                      pos.pnlPercent >= 0 ? "text-green-400" : "text-red-400"
                    )}>
                      {pos.pnlPercent >= 0 ? "+" : ""}{pos.pnlPercent.toFixed(2)}%
                    </div>
                    <div className={cn(
                      "text-sm",
                      pos.pnl >= 0 ? "text-green-400" : "text-red-400"
                    )}>
                      ${pos.pnl.toFixed(2)}
                    </div>
                  </div>
                  <button
                    onClick={() => handleClosePosition(pos.id)}
                    className="px-3 py-1 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded text-sm transition-colors"
                  >
                    Close
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
