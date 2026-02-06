"use client"

import { useEffect, useState, useCallback } from "react"
import { cn } from "@/lib/utils"

interface BlacklistEntry {
  id: string
  address: string
  type: string
  reason: string
  addedAt: string
  rugCount: number
}

interface SafetyCheck {
  token: string
  score: number
  passed: boolean
  checks: {
    name: string
    passed: boolean
    points: number
  }[]
}

export default function SafetyPage() {
  const [blacklist, setBlacklist] = useState<BlacklistEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [newAddress, setNewAddress] = useState("")
  const [newReason, setNewReason] = useState("")
  const [newType, setNewType] = useState("deployer")
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [checkToken, setCheckToken] = useState("")
  const [checking, setChecking] = useState(false)
  const [checkResult, setCheckResult] = useState<SafetyCheck | null>(null)

  const fetchBlacklist = useCallback(async () => {
    try {
      const res = await fetch("/api/safety/blacklist")
      const data = await res.json()
      if (data.success && data.data) {
        setBlacklist(data.data)
      }
    } catch (err) {
      console.error("Failed to fetch blacklist:", err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchBlacklist()
  }, [fetchBlacklist])

  const handleAddToBlacklist = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newAddress.trim()) return

    setAdding(true)
    setError(null)
    try {
      const res = await fetch("/api/safety/blacklist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: newAddress,
          type: newType,
          reason: newReason || "Manual addition",
        }),
      })
      const data = await res.json()
      if (data.success) {
        setNewAddress("")
        setNewReason("")
        await fetchBlacklist()
      } else {
        setError(data.error || "Failed to add to blacklist")
      }
    } catch (err) {
      setError("Failed to add to blacklist")
    } finally {
      setAdding(false)
    }
  }

  const handleRemoveFromBlacklist = async (id: string) => {
    try {
      const res = await fetch(`/api/safety/blacklist/${id}`, {
        method: "DELETE",
      })
      const data = await res.json()
      if (data.success) {
        await fetchBlacklist()
      }
    } catch (err) {
      console.error("Failed to remove from blacklist:", err)
    }
  }

  const handleCheckToken = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!checkToken.trim()) return

    setChecking(true)
    setCheckResult(null)
    try {
      const res = await fetch("/api/safety/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokenAddress: checkToken }),
      })
      const data = await res.json()
      if (data.success && data.data) {
        setCheckResult(data.data)
      } else {
        setError(data.error || "Failed to check token")
      }
    } catch (err) {
      setError("Failed to check token")
    } finally {
      setChecking(false)
    }
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
      <h1 className="text-2xl font-bold text-white">Safety & Blacklist</h1>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-red-400">
          {error}
          <button onClick={() => setError(null)} className="ml-4 text-sm underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Token Safety Checker */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
        <h2 className="text-lg font-medium text-white mb-4">Token Safety Checker</h2>
        <form onSubmit={handleCheckToken} className="flex gap-4">
          <input
            type="text"
            value={checkToken}
            onChange={(e) => setCheckToken(e.target.value)}
            placeholder="Token contract address..."
            className="flex-1 px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-600"
          />
          <button
            type="submit"
            disabled={checking || !checkToken.trim()}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
          >
            {checking ? "Checking..." : "Check Safety"}
          </button>
        </form>

        {checkResult && (
          <div className="mt-4 p-4 bg-zinc-800 rounded-lg">
            <div className="flex items-center justify-between mb-4">
              <div className="text-white font-medium">Safety Score: {checkResult.score}</div>
              <div className={cn(
                "px-3 py-1 rounded font-medium text-sm",
                checkResult.passed
                  ? "bg-green-500/20 text-green-400"
                  : "bg-red-500/20 text-red-400"
              )}>
                {checkResult.passed ? "PASSED" : "FAILED"}
              </div>
            </div>
            <div className="space-y-2">
              {checkResult.checks?.map((check, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span className="text-zinc-300">{check.name}</span>
                  <div className="flex items-center gap-2">
                    <span className={check.passed ? "text-green-400" : "text-red-400"}>
                      {check.passed ? "+" : ""}{check.points}
                    </span>
                    <span className={cn(
                      "w-5 h-5 flex items-center justify-center rounded-full text-xs",
                      check.passed ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
                    )}>
                      {check.passed ? "✓" : "✕"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Add to Blacklist */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
        <h2 className="text-lg font-medium text-white mb-4">Add to Blacklist</h2>
        <form onSubmit={handleAddToBlacklist} className="space-y-4">
          <div className="flex flex-wrap gap-4">
            <input
              type="text"
              value={newAddress}
              onChange={(e) => setNewAddress(e.target.value)}
              placeholder="Address to blacklist..."
              className="flex-1 min-w-[300px] px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-600"
            />
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value)}
              className="px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white focus:outline-none focus:border-zinc-600"
            >
              <option value="deployer">Deployer</option>
              <option value="contract">Contract</option>
              <option value="wallet">Wallet</option>
            </select>
          </div>
          <div className="flex gap-4">
            <input
              type="text"
              value={newReason}
              onChange={(e) => setNewReason(e.target.value)}
              placeholder="Reason (optional)..."
              className="flex-1 px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-600"
            />
            <button
              type="submit"
              disabled={adding || !newAddress.trim()}
              className="px-6 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
            >
              {adding ? "Adding..." : "Add to Blacklist"}
            </button>
          </div>
        </form>
      </div>

      {/* Blacklist Table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
        <div className="p-4 border-b border-zinc-800">
          <h2 className="text-lg font-medium text-white">Blacklist ({blacklist.length})</h2>
        </div>
        {blacklist.length === 0 ? (
          <div className="text-zinc-500 text-center py-12">No entries in blacklist</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-zinc-800 text-left text-sm text-zinc-400">
                  <th className="px-4 py-3 font-medium">Address</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Reason</th>
                  <th className="px-4 py-3 font-medium">Rugs</th>
                  <th className="px-4 py-3 font-medium">Added</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {blacklist.map((entry) => (
                  <tr key={entry.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                    <td className="px-4 py-3">
                      <span className="font-mono text-sm text-white">
                        {entry.address.slice(0, 8)}...{entry.address.slice(-6)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        "px-2 py-1 rounded text-xs font-medium",
                        entry.type === "deployer"
                          ? "bg-red-500/20 text-red-400"
                          : entry.type === "contract"
                          ? "bg-orange-500/20 text-orange-400"
                          : "bg-zinc-500/20 text-zinc-400"
                      )}>
                        {entry.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-zinc-300">{entry.reason}</td>
                    <td className="px-4 py-3 text-sm text-red-400">{entry.rugCount || 0}</td>
                    <td className="px-4 py-3 text-sm text-zinc-400">
                      {entry.addedAt ? new Date(entry.addedAt).toLocaleDateString() : "-"}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleRemoveFromBlacklist(entry.id)}
                        className="px-3 py-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded text-sm transition-colors"
                      >
                        Remove
                      </button>
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
