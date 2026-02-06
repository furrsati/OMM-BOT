"use client"

import { useEffect, useState, useCallback } from "react"
import { cn } from "@/lib/utils"

interface Weight {
  name: string
  currentWeight: number
  defaultWeight: number
  isLocked: boolean
}

interface LearningData {
  stats: {
    totalTrades: number
    tradesAnalyzed: number
    lastOptimization: string | null
    nextOptimization: number
    totalAdjustments: number
    driftFromBaseline: number
    learningMode: string
  }
  weights: Weight[]
  parameters: {
    name: string
    category: string
    currentValue: number
    defaultValue: number
    minValue: number
    maxValue: number
    isLocked: boolean
  }[]
  winPatterns: { pattern: string; matchCount: number; avgReturn: number }[]
  dangerPatterns: { pattern: string; matchCount: number }[]
}

export default function LearningPage() {
  const [data, setData] = useState<LearningData | null>(null)
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<string>("active")
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/learning")
      const result = await res.json()
      if (result.success && result.data) {
        setData(result.data)
        setMode(result.data.stats?.learningMode || "active")
      }
    } catch (err) {
      console.error("Failed to fetch learning data:", err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleModeChange = async (newMode: string) => {
    setActionLoading("mode")
    try {
      const res = await fetch("/api/learning/mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: newMode }),
      })
      const result = await res.json()
      if (result.success) {
        setMode(newMode)
        await fetchData()
      }
    } catch (err) {
      console.error("Failed to change mode:", err)
    } finally {
      setActionLoading(null)
    }
  }

  const handleLockWeight = async (name: string, lock: boolean) => {
    setActionLoading(`lock-${name}`)
    try {
      const action = lock ? "lock" : "unlock"
      const res = await fetch(`/api/learning/weight/${encodeURIComponent(name)}/${action}`, {
        method: "POST",
      })
      if (res.ok) {
        await fetchData()
      }
    } catch (err) {
      console.error("Failed to toggle lock:", err)
    } finally {
      setActionLoading(null)
    }
  }

  const handleResetWeight = async (name: string) => {
    setActionLoading(`reset-${name}`)
    try {
      const res = await fetch(`/api/learning/weight/${encodeURIComponent(name)}/reset`, {
        method: "POST",
      })
      if (res.ok) {
        await fetchData()
      }
    } catch (err) {
      console.error("Failed to reset weight:", err)
    } finally {
      setActionLoading(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-zinc-400">Loading...</div>
      </div>
    )
  }

  const defaultWeights = [
    { name: "SmartWallet", currentWeight: 30, defaultWeight: 30, isLocked: false },
    { name: "TokenSafety", currentWeight: 25, defaultWeight: 25, isLocked: false },
    { name: "MarketConditions", currentWeight: 15, defaultWeight: 15, isLocked: false },
    { name: "SocialSignals", currentWeight: 10, defaultWeight: 10, isLocked: false },
    { name: "EntryQuality", currentWeight: 20, defaultWeight: 20, isLocked: false },
  ]

  const weights = data?.weights?.length ? data.weights : defaultWeights

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Learning Engine</h1>

      {/* Mode Selector */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-medium text-white">Learning Mode</h2>
            <p className="text-sm text-zinc-400">Control how the engine learns from trades</p>
          </div>
          <div className="flex gap-2">
            {["active", "shadow", "paused"].map((m) => (
              <button
                key={m}
                onClick={() => handleModeChange(m)}
                disabled={actionLoading === "mode"}
                className={cn(
                  "px-4 py-2 rounded-lg font-medium text-sm transition-colors",
                  mode === m
                    ? m === "active"
                      ? "bg-green-600 text-white"
                      : m === "shadow"
                      ? "bg-blue-600 text-white"
                      : "bg-red-600 text-white"
                    : "bg-zinc-800 text-zinc-400 hover:text-white"
                )}
              >
                {m.charAt(0).toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <div className="text-sm text-zinc-400">Trades Analyzed</div>
          <div className="text-2xl font-bold text-white">{data?.stats?.tradesAnalyzed || 0}</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <div className="text-sm text-zinc-400">Next Optimization</div>
          <div className="text-2xl font-bold text-white">{data?.stats?.nextOptimization || 50} trades</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <div className="text-sm text-zinc-400">Total Adjustments</div>
          <div className="text-2xl font-bold text-white">{data?.stats?.totalAdjustments || 0}</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <div className="text-sm text-zinc-400">Drift from Baseline</div>
          <div className={cn(
            "text-2xl font-bold",
            (data?.stats?.driftFromBaseline || 0) > 30 ? "text-orange-400" : "text-white"
          )}>
            {(data?.stats?.driftFromBaseline || 0).toFixed(1)}%
          </div>
        </div>
      </div>

      {/* Category Weights */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
        <h2 className="text-lg font-medium text-white mb-4">Category Weights</h2>
        <div className="space-y-4">
          {weights.map((weight) => (
            <div key={weight.name} className="flex items-center gap-4">
              <div className="w-32 text-sm text-zinc-300">{weight.name}</div>
              <div className="flex-1">
                <div className="relative h-4 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className={cn(
                      "absolute h-full rounded-full transition-all",
                      weight.isLocked ? "bg-zinc-600" : "bg-blue-500"
                    )}
                    style={{ width: `${weight.currentWeight * 2.5}%` }}
                  />
                </div>
              </div>
              <div className="w-16 text-right text-sm font-medium text-white">
                {weight.currentWeight}%
              </div>
              <div className="w-20 text-right text-xs text-zinc-500">
                (def: {weight.defaultWeight}%)
              </div>
              <button
                onClick={() => handleLockWeight(weight.name, !weight.isLocked)}
                disabled={actionLoading?.startsWith("lock")}
                className={cn(
                  "px-3 py-1 rounded text-xs font-medium transition-colors",
                  weight.isLocked
                    ? "bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30"
                    : "bg-zinc-700 text-zinc-400 hover:text-white"
                )}
              >
                {weight.isLocked ? "Locked" : "Lock"}
              </button>
              <button
                onClick={() => handleResetWeight(weight.name)}
                disabled={actionLoading?.startsWith("reset")}
                className="px-3 py-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded text-xs font-medium transition-colors"
              >
                Reset
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Patterns */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <h2 className="text-lg font-medium text-white mb-4">Win Patterns</h2>
          {data?.winPatterns && data.winPatterns.length > 0 ? (
            <div className="space-y-2">
              {data.winPatterns.slice(0, 5).map((p, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span className="text-zinc-300">{p.pattern}</span>
                  <div className="flex items-center gap-4">
                    <span className="text-zinc-500">{p.matchCount} matches</span>
                    <span className="text-green-400">+{p.avgReturn.toFixed(1)}%</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-zinc-500 text-sm">No patterns recorded yet</div>
          )}
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <h2 className="text-lg font-medium text-white mb-4">Danger Patterns</h2>
          {data?.dangerPatterns && data.dangerPatterns.length > 0 ? (
            <div className="space-y-2">
              {data.dangerPatterns.slice(0, 5).map((p, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span className="text-zinc-300">{p.pattern}</span>
                  <span className="text-red-400">{p.matchCount} detected</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-zinc-500 text-sm">No danger patterns recorded yet</div>
          )}
        </div>
      </div>
    </div>
  )
}
