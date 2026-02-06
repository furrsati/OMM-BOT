'use client'

import useSWR from 'swr'
import { fetcher } from '@/lib/api'
import { REFRESH_INTERVALS } from '@/lib/swr'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { MetricCard } from '@/components/metric-card'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { formatAddress, formatNumber, formatPercent, timeAgo } from '@/lib/utils'
import { TrendingUp, TrendingDown, Minus, Activity, Target, Award } from 'lucide-react'

interface Trade {
  id: string
  tokenAddress: string
  entry: {
    price: number
    amount: number
    time: string
  }
  exit: {
    price: number
    amount: number
    time: string
    reason: string
  } | null
  profitLoss: number | null
  profitLossPercent: number | null
  convictionScore: number | null
  outcome: 'WIN' | 'LOSS' | 'BREAKEVEN' | 'EMERGENCY' | null
}

interface TradesResponse {
  success: boolean
  data: Trade[]
}

interface TradeStats {
  totalTrades: number
  winCount: number
  lossCount: number
  winRate: number
  avgWinner: number
  avgLoser: number
  totalPnL: {
    usd: number
    percent: number
  }
  profitFactor: number
}

interface TradeStatsResponse {
  success: boolean
  data: TradeStats
}

const outcomeConfig = {
  WIN: { variant: 'success' as const, icon: TrendingUp, label: 'Win' },
  LOSS: { variant: 'destructive' as const, icon: TrendingDown, label: 'Loss' },
  BREAKEVEN: { variant: 'outline' as const, icon: Minus, label: 'Break Even' },
  EMERGENCY: { variant: 'warning' as const, icon: Activity, label: 'Emergency' },
}

export default function TradesPage() {
  const { data: tradesRes } = useSWR<TradesResponse>(
    '/api/trades',
    fetcher,
    { refreshInterval: REFRESH_INTERVALS.FAST }
  )

  const { data: statsRes } = useSWR<TradeStatsResponse>(
    '/api/trades/stats',
    fetcher,
    { refreshInterval: REFRESH_INTERVALS.FAST }
  )

  const trades = tradesRes?.data || []
  const stats = statsRes?.data

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Trades</h1>
        <p className="text-muted-foreground">View trade history and performance</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Win Rate"
          value={stats ? `${formatNumber(stats.winRate)}%` : '—'}
          subtitle={stats ? `${stats.totalTrades} total trades` : undefined}
          icon={Award}
        />
        <MetricCard
          title="Total P&L"
          value={stats ? `$${formatNumber(stats.totalPnL?.usd || 0)}` : '—'}
          subtitle={stats ? `${formatPercent(stats.totalPnL?.percent || 0)}` : undefined}
          trend={stats && (stats.totalPnL?.usd || 0) >= 0 ? 'up' : 'down'}
          icon={Activity}
        />
        <MetricCard
          title="Profit Factor"
          value={stats ? formatNumber(stats.profitFactor) : '—'}
          icon={Target}
        />
        <MetricCard
          title="Avg Win / Loss"
          value={
            stats
              ? `${formatPercent(stats.avgWinner)} / -${formatNumber(stats.avgLoser)}%`
              : '—'
          }
          icon={TrendingUp}
        />
      </div>

      {/* Trades Table */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Trades</CardTitle>
        </CardHeader>
        <CardContent>
          {trades.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Activity className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No trades yet</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Token</TableHead>
                  <TableHead className="text-right">Entry</TableHead>
                  <TableHead className="text-right">Exit</TableHead>
                  <TableHead className="text-right">P&L</TableHead>
                  <TableHead className="text-right">Conviction</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead className="text-right">Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trades.map((trade) => {
                  const outcome = trade.outcome || 'LOSS'
                  const config = outcomeConfig[outcome] || outcomeConfig.LOSS
                  const OutcomeIcon = config.icon
                  const pnlPercent = trade.profitLossPercent || 0

                  return (
                    <TableRow key={trade.id}>
                      <TableCell>
                        <div>
                          <p className="text-xs text-muted-foreground font-mono">
                            {formatAddress(trade.tokenAddress)}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        ${formatNumber(trade.entry?.price || 0, 6)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {trade.exit ? `$${formatNumber(trade.exit.price, 6)}` : '—'}
                      </TableCell>
                      <TableCell
                        className={`text-right font-mono font-medium ${
                          pnlPercent >= 0 ? 'text-success' : 'text-destructive'
                        }`}
                      >
                        {trade.exit ? formatPercent(pnlPercent) : '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        {trade.convictionScore ? (
                          <Badge
                            variant={
                              trade.convictionScore >= 85
                                ? 'success'
                                : trade.convictionScore >= 70
                                ? 'warning'
                                : 'outline'
                            }
                          >
                            {Math.round(trade.convictionScore)}
                          </Badge>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell>
                        {trade.outcome ? (
                          <Badge variant={config.variant}>
                            <OutcomeIcon className="w-3 h-3 mr-1" />
                            {config.label}
                          </Badge>
                        ) : (
                          <Badge variant="outline">Open</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground text-sm">
                        {trade.exit?.time ? timeAgo(trade.exit.time) : timeAgo(trade.entry?.time)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
