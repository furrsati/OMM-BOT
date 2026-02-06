"use client"

import { useEffect, useState, useCallback, useRef } from "react"
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

type BackendStatus = "online" | "offline" | "connecting"

export default function Dashboard() {
  const [status, setStatus] = useState<BotStatus | null>(null)
  const [positions, setPositions] = useState<Position[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [backendStatus, setBackendStatus] = useState<BackendStatus>("connecting")
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const consecutiveFailures = useRef(0)

  const fetchData = useCallback(async () => {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 6000)

      const [statusRes, positionsRes] = await Promise.all([
        fetch("/api/status", { signal: controller.signal }),
        fetch("/api/positions", { signal: controller.signal }),
      ])

      clearTimeout(timeoutId)

      const statusData = await statusRes.json()
      const positionsData = await positionsRes.json()

      // Check if backend is offline
      if (statusData.isOffline || !statusData.success) {
        consecutiveFailures.current++
        if (consecutiveFailures.current >= 2) {
          setBackendStatus("offline")
        }
        setError(statusData.error || "Backend unavailable")
        return
      }

      // Backend is online
      consecutiveFailures.current = 0
      setBackendStatus("online")
      setLastUpdate(new Date())

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
          totalPnL: d.positions?.totalPnL ?? d.performance?.totalPnL ?? 0,
          winRate: d.positions?.winRate ?? d.performance?.winRate ?? 0,
          openPositions: d.positions?.open ?? d.performance?.openPositions ?? 0,
          solPrice: d.market?.solPrice ?? 0,
          solChange24h: d.market?.solChange24h ?? 0,
          btcChange24h: d.market?.btcChange24h ?? 0,
        })
      }

      if (positionsData.success && positionsData.data) {
        setPositions(positionsData.data)
      }

      setError(null)
    } catch (err: any) {
      consecutiveFailures.current++
      if (consecutiveFailures.current >= 2) {
        setBackendStatus("offline")
      }
      if (err.name === "AbortError") {
        setError("Request timed out - backend may be slow or unavailable")
      } else {
        setError("Failed to connect to backend")
      }
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
    // Don't allow actions if backend is offline
    if (backendStatus === "offline") {
      setError("Cannot perform action - backend is offline")
      return
    }

    setActionLoading(action)
    setError(null)

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), action === "kill" ? 30000 : 8000)

      const res = await fetch(`/api/bot/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)
      const data = await res.json()

      if (data.success) {
        // Refresh data immediately after successful action
        await fetchData()
      } else if (data.isOffline) {
        setBackendStatus("offline")
        setError("Backend is offline - cannot perform action")
      } else {
        setError(data.error || `Failed to ${action}`)
      }
    } catch (err: any) {
      if (err.name === "AbortError") {
        setError(`Action timed out - the ${action} command may still be processing`)
      } else {
        setError(`Failed to ${action} - check if backend is running`)
      }
    } finally {
      setActionLoading(null)
    }
  }

  const handleClosePosition = async (id: string) => {
    if (backendStatus === "offline") {
      setError("Cannot close position - backend is offline")
      return
    }

    try {
      const res = await fetch(`/api/positions/${id}/close`, {
        method: "POST",
      })
      const data = await res.json()
      if (data.success) {
        await fetchData()
      } else {
        setError(data.error || "Failed to close position")
      }
    } catch (err) {
      setError("Failed to close position")
    }
  }

  const handleConfigChange = async (key: string, value: boolean) => {
    if (backendStatus === "offline") {
      setError("Cannot update config - backend is offline")
      return
    }

    try {
      const res = await fetch("/api/bot/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      })
      const data = await res.json()
      if (data.success) {
        await fetchData()
      } else {
        setError(data.error || "Failed to update config")
      }
    } catch (err) {
      setError("Failed to update config")
    }
  }

  const getBackendStatusColor = () => {
    switch (backendStatus) {
      case "online": return "bg-green-500"
      case "offline": return "bg-red-500"
      case "connecting": return "bg-yellow-500 animate-pulse"
    }
  }

  const getBackendStatusText = () => {
    switch (backendStatus) {
      case "online": return "Backend Online"
      case "offline": return "Backend Offline"
      case "connecting": return "Connecting..."
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        <div className="text-zinc-400">Connecting to backend...</div>
      </div>
    )
  }

  const getStatusColor = () => {
    if (backendStatus === "offline") return "bg-zinc-600"
    if (!status) return "bg-zinc-600"
    if (!status.isRunning) return "bg-red-500"
    if (status.isPaused) return "bg-yellow-500"
    if (!status.tradingEnabled) return "bg-blue-500"
    return "bg-green-500"
  }

  const getStatusText = () => {
    if (backendStatus === "offline") return "Offline"
    if (!status) return "Unknown"
    if (!status.isRunning) return "Stopped"
    if (status.isPaused) return "Paused"
    if (!status.tradingEnabled) return "Running (Trading Off)"
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

  const controlsDisabled = backendStatus === "offline" || actionLoading !== null

  return (
    <div className="space-y-6">
      {/* Backend Status Banner */}
      {backendStatus === "offline" && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-red-500" />
              <div>
                <div className="text-red-400 font-medium">Backend Offline</div>
                <div className="text-red-400/70 text-sm">
                  Cannot connect to trading bot. Check if the backend is running.
                </div>
              </div>
            </div>
            <button
              onClick={fetchData}
              className="px-3 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded text-sm transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Error Message */}
      {error && backendStatus !== "offline" && (
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4 text-yellow-400">
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
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <div className={cn("w-2 h-2 rounded-full", getBackendStatusColor())} />
            <span>{getBackendStatusText()}</span>
            {lastUpdate && backendStatus === "online" && (
              <span className="text-zinc-600">
                (updated {Math.floor((Date.now() - lastUpdate.getTime()) / 1000)}s ago)
              </span>
            )}
          </div>
        </div>
        <button
          onClick={() => handleBotAction("kill")}
          disabled={controlsDisabled}
          className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
        >
          {actionLoading === "kill" ? (
            <span className="flex items-center gap-2">
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Killing...
            </span>
          ) : (
            "KILL SWITCH"
          )}
        </button>
      </div>

      {/* Bot Controls */}
      <div className={cn(
        "bg-zinc-900 border rounded-lg p-4",
        backendStatus === "offline" ? "border-zinc-700 opacity-60" : "border-zinc-800"
      )}>
        {/* Status Summary */}
        {status && backendStatus === "online" && (
          <div className="flex items-center gap-4 mb-4 pb-4 border-b border-zinc-800">
            <div className="flex items-center gap-2">
              <span className="text-sm text-zinc-500">Bot:</span>
              <span className={cn(
                "text-sm font-medium px-2 py-0.5 rounded",
                status.isRunning
                  ? status.isPaused
                    ? "bg-yellow-500/20 text-yellow-400"
                    : "bg-green-500/20 text-green-400"
                  : "bg-red-500/20 text-red-400"
              )}>
                {status.isRunning ? (status.isPaused ? "Paused" : "Running") : "Stopped"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-zinc-500">Trading:</span>
              <span className={cn(
                "text-sm font-medium px-2 py-0.5 rounded",
                status.tradingEnabled
                  ? "bg-green-500/20 text-green-400"
                  : "bg-red-500/20 text-red-400"
              )}>
                {status.tradingEnabled ? "Enabled" : "Disabled"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-zinc-500">Mode:</span>
              <span className={cn(
                "text-sm font-medium px-2 py-0.5 rounded",
                status.paperTradingMode
                  ? "bg-blue-500/20 text-blue-400"
                  : "bg-orange-500/20 text-orange-400"
              )}>
                {status.paperTradingMode ? "Paper" : "LIVE"}
              </span>
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex gap-2">
            <button
              onClick={() => handleBotAction("start")}
              disabled={controlsDisabled || status?.isRunning}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
            >
              {actionLoading === "start" ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Starting...
                </span>
              ) : (
                "Start"
              )}
            </button>
            <button
              onClick={() => handleBotAction("stop")}
              disabled={controlsDisabled || !status?.isRunning}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
            >
              {actionLoading === "stop" ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Stopping...
                </span>
              ) : (
                "Stop"
              )}
            </button>
            <button
              onClick={() => handleBotAction(status?.isPaused ? "resume" : "pause")}
              disabled={controlsDisabled || !status?.isRunning}
              className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
            >
              {actionLoading === "pause" || actionLoading === "resume" ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ...
                </span>
              ) : status?.isPaused ? (
                "Resume"
              ) : (
                "Pause"
              )}
            </button>
          </div>

          <div className="flex items-center gap-4 ml-auto">
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <span>Paper Trading:</span>
              <button
                onClick={() => handleConfigChange("paperTradingMode", !status?.paperTradingMode)}
                disabled={controlsDisabled}
                className={cn(
                  "relative w-12 h-6 rounded-full transition-colors disabled:opacity-50",
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
                disabled={controlsDisabled}
                className={cn(
                  "relative w-12 h-6 rounded-full transition-colors disabled:opacity-50",
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
                    disabled={controlsDisabled}
                    className="px-3 py-1 bg-red-600/20 hover:bg-red-600/30 disabled:opacity-50 text-red-400 rounded text-sm transition-colors"
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
