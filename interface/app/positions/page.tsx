'use client'

import useSWR from 'swr'
import { fetcher } from '@/lib/api'
import { REFRESH_INTERVALS } from '@/lib/swr'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { formatAddress, formatNumber, formatPercent, formatDuration } from '@/lib/utils'
import { Target, X } from 'lucide-react'
import { useState } from 'react'

interface Position {
  id: string
  tokenAddress: string
  tokenName: string
  tokenSymbol: string
  entry: {
    price: number
    amount: number
    time: string
    conviction: number
  }
  current: {
    price: number | null
    highestPrice: number | null
  }
  stopLoss: {
    price: number | null
    trailingActive: boolean
  }
  takeProfit: {
    tp30Hit: boolean
    tp60Hit: boolean
    tp100Hit: boolean
    tp200Hit: boolean
  }
  remainingAmount: number
  pnl: {
    percent: number
    usd: number
  }
  smartWallets: string[]
  status: string
  updatedAt: string
}

interface PositionsResponse {
  success: boolean
  data: {
    positions: Position[]
    count: number
  }
}

export default function PositionsPage() {
  const [closingId, setClosingId] = useState<string | null>(null)

  const { data: positionsRes, mutate } = useSWR<PositionsResponse>(
    '/api/positions',
    fetcher,
    { refreshInterval: REFRESH_INTERVALS.REALTIME }
  )

  const positions = positionsRes?.data?.positions || []

  const handleClosePosition = async (id: string) => {
    if (closingId) return
    setClosingId(id)

    try {
      await fetch(`/api/positions/${id}/close`, { method: 'POST' })
      await mutate()
    } catch (error) {
      console.error('Failed to close position:', error)
    } finally {
      setClosingId(null)
    }
  }

  const totalPnLPercent = positions.reduce((sum, p) => sum + (p.pnl?.percent || 0), 0)
  const openCount = positions.length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Positions</h1>
          <p className="text-muted-foreground">Manage open positions</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-sm text-muted-foreground">Total P&L</p>
            <p
              className={`text-lg font-bold font-mono ${
                totalPnLPercent >= 0 ? 'text-success' : 'text-destructive'
              }`}
            >
              {formatPercent(totalPnLPercent)}
            </p>
          </div>
          <Badge variant="outline" className="text-lg px-4 py-2">
            <Target className="w-4 h-4 mr-2" />
            {openCount} Open
          </Badge>
        </div>
      </div>

      {/* Positions Table */}
      <Card>
        <CardHeader>
          <CardTitle>Open Positions</CardTitle>
        </CardHeader>
        <CardContent>
          {positions.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Target className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No open positions</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Token</TableHead>
                  <TableHead className="text-right">Entry</TableHead>
                  <TableHead className="text-right">Current</TableHead>
                  <TableHead className="text-right">P&L</TableHead>
                  <TableHead className="text-right">Size</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                  <TableHead className="text-right">Conviction</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {positions.map((position) => (
                  <TableRow key={position.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">
                          {position.tokenSymbol || 'Unknown'}
                        </p>
                        <p className="text-xs text-muted-foreground font-mono">
                          {formatAddress(position.tokenAddress)}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      ${formatNumber(position.entry?.price || 0, 6)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {position.current?.price
                        ? `$${formatNumber(position.current.price, 6)}`
                        : '—'}
                    </TableCell>
                    <TableCell
                      className={`text-right font-mono font-medium ${
                        (position.pnl?.percent || 0) >= 0 ? 'text-success' : 'text-destructive'
                      }`}
                    >
                      {formatPercent(position.pnl?.percent || 0)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatNumber(position.remainingAmount || position.entry?.amount || 0, 4)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {position.entry?.time
                        ? formatDuration(Date.now() - new Date(position.entry.time).getTime())
                        : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {position.entry?.conviction ? (
                        <Badge
                          variant={
                            position.entry.conviction >= 85
                              ? 'success'
                              : position.entry.conviction >= 70
                              ? 'warning'
                              : 'outline'
                          }
                        >
                          {Math.round(position.entry.conviction)}
                        </Badge>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleClosePosition(position.id)}
                        disabled={closingId === position.id}
                      >
                        {closingId === position.id ? (
                          'Closing...'
                        ) : (
                          <>
                            <X className="w-4 h-4 mr-1" />
                            Close
                          </>
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
