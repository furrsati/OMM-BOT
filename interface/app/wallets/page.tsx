'use client'

import useSWR from 'swr'
import { fetcher } from '@/lib/api'
import { REFRESH_INTERVALS } from '@/lib/swr'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TierBadge } from '@/components/tier-badge'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { formatAddress, formatNumber, timeAgo } from '@/lib/utils'
import { Wallet, Plus, Trash2, ExternalLink } from 'lucide-react'
import { useState } from 'react'

interface RecentToken {
  token: string
  multiplier: number
  isWinner: boolean
}

interface SmartWallet {
  id: string
  address: string
  tier: 1 | 2 | 3
  score: number
  winRate: number
  avgReturn: number
  tokensEntered: number
  tokensWon: number
  bestPick: number
  recentTokens: RecentToken[]
  lastActive: string
  isCrowded: boolean
  notes: string
}

interface WalletsResponse {
  success: boolean
  data: SmartWallet[]
}

export default function WalletsPage() {
  const [newAddress, setNewAddress] = useState('')
  const [newTier, setNewTier] = useState<1 | 2 | 3>(2)
  const [adding, setAdding] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const { data: walletsRes, mutate } = useSWR<WalletsResponse>(
    '/api/wallets',
    fetcher,
    { refreshInterval: REFRESH_INTERVALS.NORMAL }
  )

  const wallets = walletsRes?.data || []

  const handleAddWallet = async () => {
    if (!newAddress.trim() || adding) return
    setAdding(true)

    try {
      await fetch('/api/wallets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: newAddress, tier: newTier }),
      })
      setNewAddress('')
      await mutate()
    } catch (error) {
      console.error('Failed to add wallet:', error)
    } finally {
      setAdding(false)
    }
  }

  const handleDeleteWallet = async (id: string) => {
    if (deletingId) return
    setDeletingId(id)

    try {
      await fetch(`/api/wallets/${id}`, { method: 'DELETE' })
      await mutate()
    } catch (error) {
      console.error('Failed to delete wallet:', error)
    } finally {
      setDeletingId(null)
    }
  }

  const tier1 = wallets.filter((w) => w.tier === 1)
  const tier2 = wallets.filter((w) => w.tier === 2)
  const tier3 = wallets.filter((w) => w.tier === 3)

  const WalletTable = ({
    walletsList,
    title,
    tier,
  }: {
    walletsList: SmartWallet[]
    title: string
    tier: 1 | 2 | 3
  }) => (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">{title}</CardTitle>
          <TierBadge tier={tier} />
        </div>
        <span className="text-sm text-muted-foreground">
          {walletsList.length} wallets
        </span>
      </CardHeader>
      <CardContent>
        {walletsList.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No {title.toLowerCase()} wallets
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Address</TableHead>
                <TableHead className="text-right">Score</TableHead>
                <TableHead className="text-right">Win Rate</TableHead>
                <TableHead className="text-right">Avg Peak</TableHead>
                <TableHead className="text-right">Best Pick</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
                <TableHead>Recent Picks</TableHead>
                <TableHead className="text-right">Last Active</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {walletsList.map((wallet) => (
                <TableRow key={wallet.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm">
                        {formatAddress(wallet.address, 6)}
                      </span>
                      <a
                        href={`https://solscan.io/account/${wallet.address}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                      {wallet.isCrowded && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-500">
                          Crowded
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatNumber(wallet.score, 0)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    <span className={wallet.winRate >= 0.4 ? 'text-success' : wallet.winRate >= 0.2 ? 'text-yellow-500' : 'text-muted-foreground'}>
                      {formatNumber(wallet.winRate * 100, 0)}%
                    </span>
                    <span className="text-xs text-muted-foreground ml-1">
                      ({wallet.tokensWon || 0}/{wallet.tokensEntered || 0})
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    <span className={wallet.avgReturn >= 2 ? 'text-success' : 'text-muted-foreground'}>
                      {wallet.avgReturn > 0 ? `${formatNumber(wallet.avgReturn, 1)}x` : '—'}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    <span className={wallet.bestPick >= 5 ? 'text-success' : wallet.bestPick >= 2 ? 'text-yellow-500' : 'text-muted-foreground'}>
                      {wallet.bestPick > 0 ? `${formatNumber(wallet.bestPick, 1)}x` : '—'}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {wallet.tokensEntered || 0}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1 flex-wrap max-w-[200px]">
                      {(wallet.recentTokens || []).slice(0, 3).map((token, i) => (
                        <span
                          key={i}
                          className={`text-xs px-1.5 py-0.5 rounded font-mono ${
                            token.isWinner
                              ? 'bg-success/20 text-success'
                              : 'bg-muted text-muted-foreground'
                          }`}
                          title={`${token.token}: ${token.multiplier}x`}
                        >
                          {token.token?.slice(0, 4) || '?'} {token.multiplier}x
                        </span>
                      ))}
                      {(!wallet.recentTokens || wallet.recentTokens.length === 0) && (
                        <span className="text-xs text-muted-foreground">No data yet</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground text-sm">
                    {wallet.lastActive ? timeAgo(wallet.lastActive) : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => handleDeleteWallet(wallet.id)}
                      disabled={deletingId === wallet.id}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Smart Wallets</h1>
          <p className="text-muted-foreground">Manage tracked alpha wallets</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Wallet className="w-4 h-4" />
          {wallets.length} total wallets
        </div>
      </div>

      {/* Add Wallet */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add Wallet</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            <Input
              placeholder="Wallet address..."
              value={newAddress}
              onChange={(e) => setNewAddress(e.target.value)}
              className="flex-1 font-mono"
            />
            <select
              value={newTier}
              onChange={(e) => setNewTier(Number(e.target.value) as 1 | 2 | 3)}
              className="h-10 px-3 rounded-lg border border-border bg-background text-sm"
            >
              <option value={1}>Tier 1</option>
              <option value={2}>Tier 2</option>
              <option value={3}>Tier 3</option>
            </select>
            <Button onClick={handleAddWallet} disabled={adding || !newAddress.trim()}>
              <Plus className="w-4 h-4 mr-2" />
              {adding ? 'Adding...' : 'Add'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Wallet Tables by Tier */}
      <WalletTable walletsList={tier1} title="Tier 1" tier={1} />
      <WalletTable walletsList={tier2} title="Tier 2" tier={2} />
      <WalletTable walletsList={tier3} title="Tier 3" tier={3} />
    </div>
  )
}
