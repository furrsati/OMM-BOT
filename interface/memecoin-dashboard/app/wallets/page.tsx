"use client"

import { useEffect, useState, useCallback } from "react"
import { cn } from "@/lib/utils"

interface SmartWallet {
  id: string
  address: string
  tier: number
  score: number
  winRate: number
  avgReturn: number
  tokensEntered: number
  lastActive: string
  isCrowded: boolean
}

export default function WalletsPage() {
  const [wallets, setWallets] = useState<SmartWallet[]>([])
  const [loading, setLoading] = useState(true)
  const [newAddress, setNewAddress] = useState("")
  const [newTier, setNewTier] = useState(2)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchWallets = useCallback(async () => {
    try {
      const res = await fetch("/api/smart-wallets")
      const data = await res.json()
      if (data.success && data.data) {
        setWallets(data.data)
      }
    } catch (err) {
      console.error("Failed to fetch wallets:", err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchWallets()
  }, [fetchWallets])

  const handleAddWallet = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newAddress.trim()) return

    setAdding(true)
    setError(null)
    try {
      const res = await fetch("/api/smart-wallets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: newAddress, tier: newTier }),
      })
      const data = await res.json()
      if (data.success) {
        setNewAddress("")
        await fetchWallets()
      } else {
        setError(data.error || "Failed to add wallet")
      }
    } catch (err) {
      setError("Failed to add wallet")
    } finally {
      setAdding(false)
    }
  }

  const handleDeleteWallet = async (id: string) => {
    try {
      const res = await fetch(`/api/smart-wallets/${id}`, {
        method: "DELETE",
      })
      const data = await res.json()
      if (data.success) {
        await fetchWallets()
      }
    } catch (err) {
      console.error("Failed to delete wallet:", err)
    }
  }

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "-"
    const date = new Date(dateStr)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const hours = Math.floor(diff / (1000 * 60 * 60))
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    return `${days}d ago`
  }

  const getTierColor = (tier: number) => {
    switch (tier) {
      case 1: return "bg-yellow-500/20 text-yellow-400"
      case 2: return "bg-blue-500/20 text-blue-400"
      case 3: return "bg-zinc-500/20 text-zinc-400"
      default: return "bg-zinc-500/20 text-zinc-400"
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
      <h1 className="text-2xl font-bold text-white">Smart Wallets</h1>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-red-400">
          {error}
          <button onClick={() => setError(null)} className="ml-4 text-sm underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Add Wallet Form */}
      <form onSubmit={handleAddWallet} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
        <div className="flex flex-wrap gap-4">
          <input
            type="text"
            value={newAddress}
            onChange={(e) => setNewAddress(e.target.value)}
            placeholder="Wallet address..."
            className="flex-1 min-w-[300px] px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-600"
          />
          <select
            value={newTier}
            onChange={(e) => setNewTier(Number(e.target.value))}
            className="px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white focus:outline-none focus:border-zinc-600"
          >
            <option value={1}>Tier 1</option>
            <option value={2}>Tier 2</option>
            <option value={3}>Tier 3</option>
          </select>
          <button
            type="submit"
            disabled={adding || !newAddress.trim()}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
          >
            {adding ? "Adding..." : "Add Wallet"}
          </button>
        </div>
      </form>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <div className="text-sm text-zinc-400">Total Wallets</div>
          <div className="text-2xl font-bold text-white">{wallets.length}</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <div className="text-sm text-zinc-400">Tier 1</div>
          <div className="text-2xl font-bold text-yellow-400">
            {wallets.filter(w => w.tier === 1).length}
          </div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <div className="text-sm text-zinc-400">Avg Win Rate</div>
          <div className="text-2xl font-bold text-white">
            {wallets.length > 0
              ? (wallets.reduce((sum, w) => sum + w.winRate, 0) / wallets.length).toFixed(1)
              : 0}%
          </div>
        </div>
      </div>

      {/* Wallets Table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
        {wallets.length === 0 ? (
          <div className="text-zinc-500 text-center py-12">No smart wallets tracked</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-zinc-800 text-left text-sm text-zinc-400">
                  <th className="px-4 py-3 font-medium">Address</th>
                  <th className="px-4 py-3 font-medium">Tier</th>
                  <th className="px-4 py-3 font-medium">Score</th>
                  <th className="px-4 py-3 font-medium">Win Rate</th>
                  <th className="px-4 py-3 font-medium">Avg Return</th>
                  <th className="px-4 py-3 font-medium">Tokens</th>
                  <th className="px-4 py-3 font-medium">Last Active</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {wallets.map((wallet) => (
                  <tr key={wallet.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm text-white">
                          {wallet.address.slice(0, 6)}...{wallet.address.slice(-4)}
                        </span>
                        {wallet.isCrowded && (
                          <span className="px-2 py-0.5 bg-orange-500/20 text-orange-400 text-xs rounded">
                            Crowded
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("px-2 py-1 rounded text-xs font-medium", getTierColor(wallet.tier))}>
                        Tier {wallet.tier}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-300">{wallet.score}</td>
                    <td className="px-4 py-3 text-zinc-300">{wallet.winRate.toFixed(1)}%</td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        wallet.avgReturn >= 0 ? "text-green-400" : "text-red-400"
                      )}>
                        {wallet.avgReturn >= 0 ? "+" : ""}{wallet.avgReturn.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-300">{wallet.tokensEntered}</td>
                    <td className="px-4 py-3 text-sm text-zinc-400">
                      {formatDate(wallet.lastActive)}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleDeleteWallet(wallet.id)}
                        className="px-3 py-1 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded text-sm transition-colors"
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
