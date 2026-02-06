'use client'

import useSWR from 'swr'
import { fetcher } from '@/lib/api'
import { REFRESH_INTERVALS } from '@/lib/swr'
import { StatusBadge } from '@/components/status-badge'
import { RegimeBadge } from '@/components/regime-badge'
import { MetricCard } from '@/components/metric-card'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatNumber, formatPercent, timeAgo } from '@/lib/utils'
import {
  TrendingUp,
  Wallet,
  Target,
  Activity,
  Pause,
  Play,
  Power,
  PowerOff,
  AlertTriangle,
  Bell,
  ToggleLeft,
  ToggleRight
} from 'lucide-react'
import { useState } from 'react'

interface StatusResponse {
  success: boolean
  data: {
    bot: {
      isRunning: boolean
      isPaused: boolean
      tradingEnabled: boolean
      paperTradingMode: boolean
      uptime: number
    }
    market: {
      regime: 'FULL' | 'CAUTIOUS' | 'DEFENSIVE' | 'PAUSE'
      solChange24h: number
      btcChange24h: number
    }
    trading: {
      dailyPnL: number
      openPositions: number
      losingStreak: number
      cooldownActive: boolean
    }
    positions: {
      open: number
      totalTrades: number
      winRate: number
      totalPnL: number
    }
  }
}

interface TradeStatsResponse {
  success: boolean
  data: {
    winRate: number
    totalPnL: number
    profitFactor: number
    totalTrades: number
  }
}

interface WalletResponse {
  success: boolean
  data: {
    balance: { sol: number }
    address: string
  }
}

interface AlertsResponse {
  success: boolean
  data: Array<{
    id: string
    level: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
    message: string
    created_at: string
  }>
}

export default function Dashboard() {
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const { data: statusRes, mutate: mutateStatus } = useSWR<StatusResponse>(
    '/api/status',
    fetcher,
    { refreshInterval: REFRESH_INTERVALS.REALTIME }
  )

  const { data: statsRes } = useSWR<TradeStatsResponse>(
    '/api/trades/stats',
    fetcher,
    { refreshInterval: REFRESH_INTERVALS.FAST }
  )

  const { data: walletRes } = useSWR<WalletResponse>(
    '/api/wallet',
    fetcher,
    { refreshInterval: REFRESH_INTERVALS.NORMAL }
  )

  const { data: alertsRes } = useSWR<AlertsResponse>(
    '/api/alerts',
    fetcher,
    { refreshInterval: REFRESH_INTERVALS.FAST }
  )

  const status = statusRes?.data
  const stats = statsRes?.data
  const wallet = walletRes?.data
  const alerts = alertsRes?.data || []

  // Determine bot status for StatusBadge
  const getBotStatus = () => {
    if (!status?.bot) return 'stopped'
    if (!status.bot.isRunning) return 'stopped'
    if (status.bot.isPaused) return 'paused'
    return 'running'
  }

  const handleBotAction = async (action: string) => {
    if (actionLoading) return
    setActionLoading(action)

    try {
      await fetch(`/api/bot/${action}`, { method: 'POST' })
      await mutateStatus()
    } catch (error) {
      console.error(`Failed to ${action} bot:`, error)
    } finally {
      setActionLoading(null)
    }
  }

  const handleConfigUpdate = async (config: { tradingEnabled?: boolean; paperTradingMode?: boolean }) => {
    const key = config.tradingEnabled !== undefined ? 'trading' : 'paper'
    if (actionLoading) return
    setActionLoading(key)

    try {
      await fetch('/api/bot/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      await mutateStatus()
    } catch (error) {
      console.error('Failed to update config:', error)
    } finally {
      setActionLoading(null)
    }
  }

  const recentAlerts = alerts.slice(0, 5)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">Monitor your trading bot</p>
        </div>
        <div className="flex items-center gap-4">
          <StatusBadge status={getBotStatus()} />
          <RegimeBadge regime={status?.market?.regime || 'PAUSE'} />
          {status?.bot?.paperTradingMode && (
            <Badge variant="warning">Paper Trading</Badge>
          )}
          {!status?.bot?.tradingEnabled && (
            <Badge variant="destructive">Trading Disabled</Badge>
          )}
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Win Rate"
          value={stats ? `${formatNumber(stats.winRate)}%` : '—'}
          subtitle={stats ? `${stats.totalTrades} total trades` : undefined}
          icon={TrendingUp}
        />
        <MetricCard
          title="Total P&L"
          value={stats ? `${formatNumber(stats.totalPnL)} SOL` : '—'}
          trend={stats && stats.totalPnL >= 0 ? 'up' : 'down'}
          icon={Activity}
        />
        <MetricCard
          title="Profit Factor"
          value={stats ? formatNumber(stats.profitFactor) : '—'}
          icon={Target}
        />
        <MetricCard
          title="Wallet Balance"
          value={wallet ? `${formatNumber(wallet.balance?.sol || 0)} SOL` : '—'}
          icon={Wallet}
        />
      </div>

      {/* Controls and Status Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Bot Controls */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Bot Controls</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Start/Stop Bot */}
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Bot Power</p>
              <div className="flex gap-2">
                {status?.bot?.isRunning ? (
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => handleBotAction('stop')}
                    disabled={actionLoading !== null}
                  >
                    <PowerOff className="w-4 h-4 mr-2" />
                    {actionLoading === 'stop' ? 'Stopping...' : 'Stop Bot'}
                  </Button>
                ) : (
                  <Button
                    variant="success"
                    className="flex-1"
                    onClick={() => handleBotAction('start')}
                    disabled={actionLoading !== null}
                  >
                    <Power className="w-4 h-4 mr-2" />
                    {actionLoading === 'start' ? 'Starting...' : 'Start Bot'}
                  </Button>
                )}
              </div>
            </div>

            {/* Pause/Resume Trading */}
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Trading</p>
              <div className="flex gap-2">
                {status?.bot?.isPaused ? (
                  <Button
                    variant="success"
                    className="flex-1"
                    onClick={() => handleBotAction('resume')}
                    disabled={actionLoading !== null || !status?.bot?.isRunning}
                  >
                    <Play className="w-4 h-4 mr-2" />
                    {actionLoading === 'resume' ? 'Resuming...' : 'Resume'}
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => handleBotAction('pause')}
                    disabled={actionLoading !== null || !status?.bot?.isRunning}
                  >
                    <Pause className="w-4 h-4 mr-2" />
                    {actionLoading === 'pause' ? 'Pausing...' : 'Pause'}
                  </Button>
                )}
              </div>
            </div>

            {/* Kill Switch */}
            <div className="pt-2 border-t border-border">
              <Button
                variant="destructive"
                className="w-full"
                onClick={() => handleBotAction('kill')}
                disabled={actionLoading !== null}
              >
                <AlertTriangle className="w-4 h-4 mr-2" />
                {actionLoading === 'kill' ? 'Killing...' : 'Emergency Kill Switch'}
              </Button>
              <p className="text-xs text-muted-foreground text-center mt-2">
                Sells all positions and stops everything
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Configuration Toggles */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Trading Enabled Toggle */}
            <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
              <div>
                <p className="font-medium">Trading Enabled</p>
                <p className="text-xs text-muted-foreground">Allow new trade entries</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleConfigUpdate({ tradingEnabled: !status?.bot?.tradingEnabled })}
                disabled={actionLoading !== null}
              >
                {status?.bot?.tradingEnabled ? (
                  <ToggleRight className="w-8 h-8 text-success" />
                ) : (
                  <ToggleLeft className="w-8 h-8 text-muted-foreground" />
                )}
              </Button>
            </div>

            {/* Paper Trading Toggle */}
            <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
              <div>
                <p className="font-medium">Paper Trading</p>
                <p className="text-xs text-muted-foreground">Simulate trades without real money</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleConfigUpdate({ paperTradingMode: !status?.bot?.paperTradingMode })}
                disabled={actionLoading !== null}
              >
                {status?.bot?.paperTradingMode ? (
                  <ToggleRight className="w-8 h-8 text-warning" />
                ) : (
                  <ToggleLeft className="w-8 h-8 text-muted-foreground" />
                )}
              </Button>
            </div>

            {/* Status Summary */}
            <div className="space-y-2 pt-2 border-t border-border">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Open Positions</span>
                <span className="font-mono">{status?.trading?.openPositions ?? 0}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Daily P&L</span>
                <span className={`font-mono ${(status?.trading?.dailyPnL ?? 0) >= 0 ? 'text-success' : 'text-destructive'}`}>
                  {formatPercent(status?.trading?.dailyPnL ?? 0)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Market Regime</span>
                <RegimeBadge regime={status?.market?.regime || 'PAUSE'} />
              </div>
              {status?.trading?.cooldownActive && (
                <div className="flex justify-between text-sm">
                  <span className="text-destructive">Cooldown Active</span>
                  <Badge variant="destructive">Yes</Badge>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Recent Alerts */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Recent Alerts</CardTitle>
            <Bell className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {recentAlerts.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No recent alerts
              </p>
            ) : (
              <div className="space-y-2">
                {recentAlerts.map((alert) => (
                  <div
                    key={alert.id}
                    className="flex items-start gap-2 text-sm"
                  >
                    <Badge
                      variant={
                        alert.level === 'CRITICAL' || alert.level === 'HIGH'
                          ? 'destructive'
                          : alert.level === 'MEDIUM'
                          ? 'warning'
                          : 'outline'
                      }
                      className="text-xs shrink-0"
                    >
                      {alert.level}
                    </Badge>
                    <div className="flex-1 min-w-0">
                      <p className="truncate">{alert.message}</p>
                      <p className="text-xs text-muted-foreground">
                        {timeAgo(alert.created_at)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
