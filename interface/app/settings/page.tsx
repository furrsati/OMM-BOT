'use client'

import useSWR from 'swr'
import { fetcher } from '@/lib/api'
import { REFRESH_INTERVALS } from '@/lib/swr'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { formatNumber } from '@/lib/utils'
import { Settings, Brain, Sliders, Shield } from 'lucide-react'

interface LearningWeights {
  smartWallet: number
  tokenSafety: number
  marketConditions: number
  socialSignals: number
  entryQuality: number
}

interface BotSettings {
  convictionThresholds: {
    high: number
    medium: number
    low: number
  }
  positionSizes: {
    high: number
    medium: number
    low: number
  }
  stopLoss: {
    default: number
    earlyDiscovery: number
  }
  takeProfitLevels: number[]
  maxOpenPositions: number
  maxDailyLoss: number
  maxDailyProfit: number
  paperTrading: boolean
}

interface LearningPatterns {
  winPatterns: number
  dangerPatterns: number
  totalTrades: number
}

export default function SettingsPage() {
  const { data: weights } = useSWR<LearningWeights>(
    '/api/learning?endpoint=weights',
    fetcher,
    { refreshInterval: REFRESH_INTERVALS.SLOW }
  )

  const { data: settings } = useSWR<BotSettings>(
    '/api/settings',
    fetcher,
    { refreshInterval: REFRESH_INTERVALS.SLOW }
  )

  const { data: patterns } = useSWR<LearningPatterns>(
    '/api/learning?endpoint=patterns',
    fetcher,
    { refreshInterval: REFRESH_INTERVALS.SLOW }
  )

  const WeightBar = ({
    label,
    value,
    defaultValue,
  }: {
    label: string
    value: number
    defaultValue: number
  }) => {
    const diff = value - defaultValue
    return (
      <div className="space-y-1">
        <div className="flex justify-between text-sm">
          <span>{label}</span>
          <span className="font-mono">
            {formatNumber(value)}%
            {diff !== 0 && (
              <span
                className={`ml-2 text-xs ${
                  diff > 0 ? 'text-success' : 'text-destructive'
                }`}
              >
                ({diff > 0 ? '+' : ''}{formatNumber(diff)})
              </span>
            )}
          </span>
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-success rounded-full transition-all"
            style={{ width: `${Math.min(value, 100)}%` }}
          />
        </div>
      </div>
    )
  }

  const defaultWeights = {
    smartWallet: 30,
    tokenSafety: 25,
    marketConditions: 15,
    socialSignals: 10,
    entryQuality: 20,
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground">Bot configuration and learning engine</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Learning Engine Weights */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Brain className="w-5 h-5" />
              Learning Engine Weights
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {weights ? (
              <>
                <WeightBar
                  label="Smart Wallet Signal"
                  value={weights.smartWallet}
                  defaultValue={defaultWeights.smartWallet}
                />
                <WeightBar
                  label="Token Safety"
                  value={weights.tokenSafety}
                  defaultValue={defaultWeights.tokenSafety}
                />
                <WeightBar
                  label="Market Conditions"
                  value={weights.marketConditions}
                  defaultValue={defaultWeights.marketConditions}
                />
                <WeightBar
                  label="Social Signals"
                  value={weights.socialSignals}
                  defaultValue={defaultWeights.socialSignals}
                />
                <WeightBar
                  label="Entry Quality"
                  value={weights.entryQuality}
                  defaultValue={defaultWeights.entryQuality}
                />
                <p className="text-xs text-muted-foreground pt-2">
                  Weights are automatically adjusted by the learning engine based on trade outcomes.
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">Loading weights...</p>
            )}
          </CardContent>
        </Card>

        {/* Pattern Library */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5" />
              Pattern Library
            </CardTitle>
          </CardHeader>
          <CardContent>
            {patterns ? (
              <div className="space-y-4">
                <div className="flex justify-between p-4 bg-muted rounded-lg">
                  <div>
                    <p className="text-sm text-muted-foreground">Win Patterns</p>
                    <p className="text-2xl font-bold text-success font-mono">
                      {patterns.winPatterns}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Danger Patterns</p>
                    <p className="text-2xl font-bold text-destructive font-mono">
                      {patterns.dangerPatterns}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Total Trades</p>
                    <p className="text-2xl font-bold font-mono">
                      {patterns.totalTrades}
                    </p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Patterns are learned from trade history to improve future decisions.
                </p>
              </div>
            ) : (
              <p className="text-muted-foreground">Loading patterns...</p>
            )}
          </CardContent>
        </Card>

        {/* Conviction Thresholds */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sliders className="w-5 h-5" />
              Conviction Thresholds
            </CardTitle>
          </CardHeader>
          <CardContent>
            {settings ? (
              <div className="space-y-3">
                <div className="flex justify-between py-2 border-b border-border">
                  <span className="text-muted-foreground">High Conviction</span>
                  <span className="font-mono text-success">
                    {settings.convictionThresholds.high}+
                  </span>
                </div>
                <div className="flex justify-between py-2 border-b border-border">
                  <span className="text-muted-foreground">Medium Conviction</span>
                  <span className="font-mono text-warning">
                    {settings.convictionThresholds.medium}–{settings.convictionThresholds.high - 1}
                  </span>
                </div>
                <div className="flex justify-between py-2 border-b border-border">
                  <span className="text-muted-foreground">Low Conviction</span>
                  <span className="font-mono">
                    {settings.convictionThresholds.low}–{settings.convictionThresholds.medium - 1}
                  </span>
                </div>
                <div className="flex justify-between py-2">
                  <span className="text-muted-foreground">No Entry</span>
                  <span className="font-mono text-destructive">
                    &lt; {settings.convictionThresholds.low}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground">Loading thresholds...</p>
            )}
          </CardContent>
        </Card>

        {/* Position Sizing */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="w-5 h-5" />
              Position Sizing
            </CardTitle>
          </CardHeader>
          <CardContent>
            {settings ? (
              <div className="space-y-3">
                <div className="flex justify-between py-2 border-b border-border">
                  <span className="text-muted-foreground">High Conviction Size</span>
                  <span className="font-mono">{settings.positionSizes.high}%</span>
                </div>
                <div className="flex justify-between py-2 border-b border-border">
                  <span className="text-muted-foreground">Medium Conviction Size</span>
                  <span className="font-mono">{settings.positionSizes.medium}%</span>
                </div>
                <div className="flex justify-between py-2 border-b border-border">
                  <span className="text-muted-foreground">Low Conviction Size</span>
                  <span className="font-mono">{settings.positionSizes.low}%</span>
                </div>
                <div className="flex justify-between py-2 border-b border-border">
                  <span className="text-muted-foreground">Max Open Positions</span>
                  <span className="font-mono">{settings.maxOpenPositions}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-border">
                  <span className="text-muted-foreground">Default Stop Loss</span>
                  <span className="font-mono text-destructive">
                    -{settings.stopLoss.default}%
                  </span>
                </div>
                <div className="flex justify-between py-2">
                  <span className="text-muted-foreground">Mode</span>
                  <span className={settings.paperTrading ? 'text-warning' : 'text-success'}>
                    {settings.paperTrading ? 'Paper Trading' : 'Live Trading'}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground">Loading settings...</p>
            )}
          </CardContent>
        </Card>

        {/* Risk Limits */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-destructive" />
              Risk Limits
            </CardTitle>
          </CardHeader>
          <CardContent>
            {settings ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 bg-muted rounded-lg text-center">
                  <p className="text-sm text-muted-foreground">Max Daily Loss</p>
                  <p className="text-xl font-bold text-destructive font-mono">
                    -{settings.maxDailyLoss}%
                  </p>
                </div>
                <div className="p-4 bg-muted rounded-lg text-center">
                  <p className="text-sm text-muted-foreground">Max Daily Profit</p>
                  <p className="text-xl font-bold text-success font-mono">
                    +{settings.maxDailyProfit}%
                  </p>
                </div>
                <div className="p-4 bg-muted rounded-lg text-center">
                  <p className="text-sm text-muted-foreground">Stop Loss</p>
                  <p className="text-xl font-bold font-mono">
                    -{settings.stopLoss.default}%
                  </p>
                </div>
                <div className="p-4 bg-muted rounded-lg text-center">
                  <p className="text-sm text-muted-foreground">Take Profits</p>
                  <p className="text-sm font-mono">
                    {settings.takeProfitLevels.map((tp) => `+${tp}%`).join(', ')}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground">Loading risk limits...</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
