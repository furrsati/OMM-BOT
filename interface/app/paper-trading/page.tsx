'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { fetcher, apiPost } from '@/lib/api'
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
import { formatAddress, formatNumber, formatPercent, formatDuration, cn } from '@/lib/utils'
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  Target,
  Clock,
  AlertTriangle,
  Play,
  Pause,
  RotateCcw,
  X,
  CheckCircle,
  XCircle,
  Activity,
  DollarSign,
  Percent,
  BarChart3,
  Terminal,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'

interface PaperWalletResponse {
  success: boolean
  data: {
    balance: {
      initial: number
      current: number
      reserved: number
      available: number
      usd: number | null
    }
    performance: {
      totalTrades: number
      winningTrades: number
      losingTrades: number
      breakevenTrades: number
      winRate: string
      totalPnlSol: number
      totalPnlPercent: number
      bestTrade: { pnlPercent: number; token: string | null }
      worstTrade: { pnlPercent: number; token: string | null }
    }
    streaks: {
      current: number
      longestWin: number
      longestLoss: number
    }
    daily: {
      pnlSol: number
      pnlPercent: number
      trades: number
      resetAt: string
    }
    settings: {
      maxPositionSize: number
      maxOpenPositions: number
      maxDailyLoss: number
      maxDailyProfit: number
    }
    status: {
      isActive: boolean
      isPaused: boolean
      pauseReason: string | null
      lastTradeAt: string | null
    }
  }
}

interface PaperPosition {
  id: number
  tradeId: number
  token: { address: string; name: string; symbol: string }
  entry: {
    price: number
    amountSol: number
    amountTokens: number
    time: string
    conviction: number
    level: string
    type: string
  }
  current: {
    price: number
    highestPrice: number
    lowestPrice: number
    remainingTokens: number
  }
  pnl: {
    unrealizedSol: number
    unrealizedPercent: number
    unrealizedUsd: number
    realizedSol: number
    realizedUsd: number
  }
  stopLoss: {
    price: number
    percent: number
    trailingActive: boolean
    trailingPrice: number | null
    trailingPercent: number | null
  }
  takeProfit: {
    tp1Hit: boolean
    tp2Hit: boolean
    tp3Hit: boolean
    tp4Hit: boolean
  }
}

interface PaperTrade {
  id: number
  token: { address: string; name: string; symbol: string }
  entry: {
    price: number
    amountSol: number
    time: string
    conviction: number
    level: string
    type: string
  }
  exit: {
    price: number
    amountSol: number
    time: string
    reason: string
  } | null
  pnl: { sol: number; percent: number; usd: number }
  status: string
  outcome: string | null
}

interface PaperEvent {
  id: number
  tradeId: number
  type: string
  message: string
  severity: 'INFO' | 'WARNING' | 'SUCCESS' | 'DANGER'
  timestamp: string
}

export default function PaperTradingPage() {
  const [closingToken, setClosingToken] = useState<string | null>(null)
  const [isResetting, setIsResetting] = useState(false)
  const [isPausingResuming, setIsPausingResuming] = useState(false)
  const [showAllEvents, setShowAllEvents] = useState(false)

  // Fetch paper wallet data
  const { data: walletRes, mutate: mutateWallet } = useSWR<PaperWalletResponse>(
    '/api/paper-trading/wallet',
    fetcher,
    { refreshInterval: REFRESH_INTERVALS.SLOW }
  )

  // Fetch paper positions
  const { data: positionsRes, mutate: mutatePositions } = useSWR<{
    success: boolean
    data: { positions: PaperPosition[]; count: number }
  }>('/api/paper-trading/positions', fetcher, {
    refreshInterval: REFRESH_INTERVALS.REALTIME,
  })

  // Fetch paper trades
  const { data: tradesRes } = useSWR<{
    success: boolean
    data: PaperTrade[]
  }>('/api/paper-trading/trades?limit=20', fetcher, {
    refreshInterval: REFRESH_INTERVALS.SLOW,
  })

  // Fetch events for console
  const { data: eventsRes, mutate: mutateEvents } = useSWR<{
    success: boolean
    data: PaperEvent[]
  }>('/api/paper-trading/events?limit=50', fetcher, {
    refreshInterval: REFRESH_INTERVALS.REALTIME,
  })

  const wallet = walletRes?.data
  const positions = positionsRes?.data?.positions || []
  const trades = tradesRes?.data || []
  const events = eventsRes?.data || []

  const handleClosePosition = async (tokenAddress: string) => {
    if (closingToken) return
    setClosingToken(tokenAddress)

    try {
      await apiPost(`/paper-trading/positions/${tokenAddress}/close`)
      await mutatePositions()
      await mutateWallet()
      await mutateEvents()
    } catch (error) {
      console.error('Failed to close position:', error)
    } finally {
      setClosingToken(null)
    }
  }

  const handleReset = async () => {
    if (isResetting) return
    if (!confirm('Reset paper wallet? This will close all positions and clear history.')) return

    setIsResetting(true)
    try {
      await apiPost('/paper-trading/reset', { initialBalance: 10 })
      await mutateWallet()
      await mutatePositions()
      await mutateEvents()
    } catch (error) {
      console.error('Failed to reset:', error)
    } finally {
      setIsResetting(false)
    }
  }

  const handlePauseResume = async () => {
    if (isPausingResuming) return
    setIsPausingResuming(true)

    try {
      if (wallet?.status.isPaused) {
        await apiPost('/paper-trading/resume')
      } else {
        await apiPost('/paper-trading/pause', { reason: 'Manual pause' })
      }
      await mutateWallet()
    } catch (error) {
      console.error('Failed to pause/resume:', error)
    } finally {
      setIsPausingResuming(false)
    }
  }

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'SUCCESS':
        return 'text-success'
      case 'DANGER':
        return 'text-destructive'
      case 'WARNING':
        return 'text-warning'
      default:
        return 'text-muted-foreground'
    }
  }

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'SUCCESS':
        return <CheckCircle className="w-4 h-4" />
      case 'DANGER':
        return <XCircle className="w-4 h-4" />
      case 'WARNING':
        return <AlertTriangle className="w-4 h-4" />
      default:
        return <Activity className="w-4 h-4" />
    }
  }

  const totalUnrealizedPnl = positions.reduce((sum, p) => sum + p.pnl.unrealizedPercent, 0)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Terminal className="w-6 h-6" />
            Paper Trading
          </h1>
          <p className="text-muted-foreground">
            Simulated trading without real execution
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={wallet?.status.isPaused ? 'default' : 'outline'}
            size="sm"
            onClick={handlePauseResume}
            disabled={isPausingResuming}
          >
            {wallet?.status.isPaused ? (
              <>
                <Play className="w-4 h-4 mr-1" /> Resume
              </>
            ) : (
              <>
                <Pause className="w-4 h-4 mr-1" /> Pause
              </>
            )}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleReset}
            disabled={isResetting}
          >
            <RotateCcw className="w-4 h-4 mr-1" />
            {isResetting ? 'Resetting...' : 'Reset'}
          </Button>
        </div>
      </div>

      {/* Status Banner */}
      {wallet?.status.isPaused && (
        <div className="bg-warning/10 border border-warning/30 rounded-lg p-4 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-warning" />
          <div>
            <p className="font-medium text-warning">Paper Trading Paused</p>
            <p className="text-sm text-muted-foreground">
              {wallet.status.pauseReason || 'Trading is paused'}
            </p>
          </div>
        </div>
      )}

      {/* Wallet Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Balance</p>
                <p className="text-2xl font-bold font-mono">
                  {formatNumber(wallet?.balance.current || 10, 4)} SOL
                </p>
                <p className="text-xs text-muted-foreground">
                  Available: {formatNumber(wallet?.balance.available || 10, 4)} SOL
                </p>
              </div>
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                <Wallet className="w-6 h-6 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total P&L</p>
                <p
                  className={cn(
                    'text-2xl font-bold font-mono',
                    (wallet?.performance.totalPnlSol || 0) >= 0
                      ? 'text-success'
                      : 'text-destructive'
                  )}
                >
                  {(wallet?.performance.totalPnlSol || 0) >= 0 ? '+' : ''}
                  {formatNumber(wallet?.performance.totalPnlSol || 0, 4)} SOL
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatPercent(wallet?.performance.totalPnlPercent || 0)} from start
                </p>
              </div>
              <div
                className={cn(
                  'w-12 h-12 rounded-full flex items-center justify-center',
                  (wallet?.performance.totalPnlSol || 0) >= 0
                    ? 'bg-success/10'
                    : 'bg-destructive/10'
                )}
              >
                {(wallet?.performance.totalPnlSol || 0) >= 0 ? (
                  <TrendingUp className="w-6 h-6 text-success" />
                ) : (
                  <TrendingDown className="w-6 h-6 text-destructive" />
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Win Rate</p>
                <p className="text-2xl font-bold font-mono">
                  {wallet?.performance.winRate || '0.0'}%
                </p>
                <p className="text-xs text-muted-foreground">
                  {wallet?.performance.winningTrades || 0}W /{' '}
                  {wallet?.performance.losingTrades || 0}L
                </p>
              </div>
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                <Percent className="w-6 h-6 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Streak</p>
                <p
                  className={cn(
                    'text-2xl font-bold font-mono',
                    (wallet?.streaks.current || 0) > 0
                      ? 'text-success'
                      : (wallet?.streaks.current || 0) < 0
                      ? 'text-destructive'
                      : ''
                  )}
                >
                  {(wallet?.streaks.current || 0) > 0 ? '+' : ''}
                  {wallet?.streaks.current || 0}
                </p>
                <p className="text-xs text-muted-foreground">
                  Best: {wallet?.streaks.longestWin || 0}W / Worst:{' '}
                  {wallet?.streaks.longestLoss || 0}L
                </p>
              </div>
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                <BarChart3 className="w-6 h-6 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Open Positions (2/3 width) */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Target className="w-5 h-5" />
                Open Positions
                <Badge variant="outline">{positions.length}</Badge>
              </CardTitle>
              {positions.length > 0 && (
                <div
                  className={cn(
                    'text-sm font-mono font-medium',
                    totalUnrealizedPnl >= 0 ? 'text-success' : 'text-destructive'
                  )}
                >
                  {formatPercent(totalUnrealizedPnl)} unrealized
                </div>
              )}
            </CardHeader>
            <CardContent>
              {positions.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Target className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>No open paper positions</p>
                  <p className="text-sm">Trades will appear here when signals are detected</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Token</TableHead>
                      <TableHead className="text-right">Entry</TableHead>
                      <TableHead className="text-right">Current</TableHead>
                      <TableHead className="text-right">P&L</TableHead>
                      <TableHead className="text-right">TP/SL</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {positions.map((position) => (
                      <TableRow key={position.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{position.token.symbol}</p>
                            <p className="text-xs text-muted-foreground font-mono">
                              {formatAddress(position.token.address)}
                            </p>
                            <Badge variant="outline" className="text-xs mt-1">
                              {position.entry.level}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <p className="font-mono text-sm">
                            ${formatNumber(position.entry.price, 8)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatNumber(position.entry.amountSol, 4)} SOL
                          </p>
                        </TableCell>
                        <TableCell className="text-right">
                          <p className="font-mono text-sm">
                            ${formatNumber(position.current.price, 8)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            ATH: ${formatNumber(position.current.highestPrice, 8)}
                          </p>
                        </TableCell>
                        <TableCell
                          className={cn(
                            'text-right font-mono font-medium',
                            position.pnl.unrealizedPercent >= 0
                              ? 'text-success'
                              : 'text-destructive'
                          )}
                        >
                          <p>{formatPercent(position.pnl.unrealizedPercent)}</p>
                          <p className="text-xs opacity-75">
                            {position.pnl.unrealizedSol >= 0 ? '+' : ''}
                            {formatNumber(position.pnl.unrealizedSol, 4)} SOL
                          </p>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex gap-1 justify-end">
                            {position.takeProfit.tp1Hit && (
                              <Badge variant="success" className="text-xs">
                                TP1
                              </Badge>
                            )}
                            {position.takeProfit.tp2Hit && (
                              <Badge variant="success" className="text-xs">
                                TP2
                              </Badge>
                            )}
                            {position.takeProfit.tp3Hit && (
                              <Badge variant="success" className="text-xs">
                                TP3
                              </Badge>
                            )}
                            {position.takeProfit.tp4Hit && (
                              <Badge variant="success" className="text-xs">
                                TP4
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            SL: {position.stopLoss.trailingActive ? 'Trailing' : 'Fixed'}{' '}
                            {formatPercent(-position.stopLoss.percent)}
                          </p>
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => handleClosePosition(position.token.address)}
                            disabled={closingToken === position.token.address}
                          >
                            {closingToken === position.token.address ? (
                              '...'
                            ) : (
                              <X className="w-4 h-4" />
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

          {/* Recent Trades */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="w-5 h-5" />
                Recent Trades
              </CardTitle>
            </CardHeader>
            <CardContent>
              {trades.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p>No trade history yet</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Token</TableHead>
                      <TableHead className="text-right">Entry</TableHead>
                      <TableHead className="text-right">Exit</TableHead>
                      <TableHead className="text-right">P&L</TableHead>
                      <TableHead className="text-right">Outcome</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {trades.slice(0, 10).map((trade) => (
                      <TableRow key={trade.id}>
                        <TableCell>
                          <p className="font-medium">{trade.token.symbol}</p>
                          <p className="text-xs text-muted-foreground">
                            {trade.entry.type}
                          </p>
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          ${formatNumber(trade.entry.price, 8)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {trade.exit ? (
                            <>
                              ${formatNumber(trade.exit.price, 8)}
                              <p className="text-xs text-muted-foreground">
                                {trade.exit.reason}
                              </p>
                            </>
                          ) : (
                            <Badge variant="outline">Open</Badge>
                          )}
                        </TableCell>
                        <TableCell
                          className={cn(
                            'text-right font-mono font-medium',
                            trade.pnl.percent >= 0 ? 'text-success' : 'text-destructive'
                          )}
                        >
                          {formatPercent(trade.pnl.percent)}
                        </TableCell>
                        <TableCell className="text-right">
                          {trade.outcome === 'WIN' && (
                            <Badge variant="success">WIN</Badge>
                          )}
                          {trade.outcome === 'LOSS' && (
                            <Badge variant="destructive">LOSS</Badge>
                          )}
                          {trade.outcome === 'BREAKEVEN' && (
                            <Badge variant="outline">BE</Badge>
                          )}
                          {!trade.outcome && trade.status === 'OPEN' && (
                            <Badge variant="outline">OPEN</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Event Console (1/3 width) */}
        <div className="lg:col-span-1">
          <Card className="h-full">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="flex items-center gap-2">
                <Terminal className="w-5 h-5" />
                Console
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAllEvents(!showAllEvents)}
              >
                {showAllEvents ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </Button>
            </CardHeader>
            <CardContent>
              <div
                className={cn(
                  'space-y-2 overflow-y-auto font-mono text-xs',
                  showAllEvents ? 'max-h-[600px]' : 'max-h-[400px]'
                )}
              >
                {events.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Terminal className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p>No events yet</p>
                  </div>
                ) : (
                  events.map((event) => (
                    <div
                      key={event.id}
                      className={cn(
                        'p-2 rounded border-l-2 bg-muted/30',
                        event.severity === 'SUCCESS' && 'border-l-success',
                        event.severity === 'DANGER' && 'border-l-destructive',
                        event.severity === 'WARNING' && 'border-l-warning',
                        event.severity === 'INFO' && 'border-l-muted-foreground'
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <span className={getSeverityColor(event.severity)}>
                          {getSeverityIcon(event.severity)}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className={cn('break-words', getSeverityColor(event.severity))}>
                            {event.message}
                          </p>
                          <p className="text-muted-foreground mt-1">
                            {new Date(event.timestamp).toLocaleTimeString()}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Daily Stats */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="w-5 h-5" />
            Today&apos;s Performance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Daily P&L</p>
              <p
                className={cn(
                  'text-xl font-bold font-mono',
                  (wallet?.daily.pnlSol || 0) >= 0 ? 'text-success' : 'text-destructive'
                )}
              >
                {(wallet?.daily.pnlSol || 0) >= 0 ? '+' : ''}
                {formatNumber(wallet?.daily.pnlSol || 0, 4)} SOL
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Daily P&L %</p>
              <p
                className={cn(
                  'text-xl font-bold font-mono',
                  (wallet?.daily.pnlPercent || 0) >= 0 ? 'text-success' : 'text-destructive'
                )}
              >
                {formatPercent(wallet?.daily.pnlPercent || 0)}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Trades Today</p>
              <p className="text-xl font-bold font-mono">{wallet?.daily.trades || 0}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Trades</p>
              <p className="text-xl font-bold font-mono">
                {wallet?.performance.totalTrades || 0}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
