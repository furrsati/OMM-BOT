'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { fetcher } from '@/lib/api'
import { REFRESH_INTERVALS } from '@/lib/swr'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { formatAddress, formatNumber, timeAgo } from '@/lib/utils'
import {
  Scan,
  AlertCircle,
  CheckCircle,
  XCircle,
  Loader2,
  Plus,
  ExternalLink,
} from 'lucide-react'

interface TokenOpportunity {
  id: string
  tokenAddress: string
  tokenName: string
  tokenSymbol: string
  safetyScore: number
  convictionScore: number
  smartWalletCount: number
  status: 'ANALYZING' | 'QUALIFIED' | 'REJECTED' | 'ENTERED' | 'EXPIRED'
  rejectReason?: string
  createdAt: string
  updatedAt: string
}

interface ScannerResponse {
  success: boolean
  data: {
    opportunities: TokenOpportunity[]
    stats: {
      total: number
      analyzing: number
      qualified: number
      rejected: number
      entered: number
      avgConviction: number
    }
  }
}

const statusConfig = {
  ANALYZING: {
    variant: 'outline' as const,
    icon: Loader2,
    label: 'Analyzing',
    animate: true,
  },
  QUALIFIED: {
    variant: 'success' as const,
    icon: CheckCircle,
    label: 'Qualified',
    animate: false,
  },
  REJECTED: {
    variant: 'destructive' as const,
    icon: XCircle,
    label: 'Rejected',
    animate: false,
  },
  ENTERED: {
    variant: 'success' as const,
    icon: CheckCircle,
    label: 'Entered',
    animate: false,
  },
  EXPIRED: {
    variant: 'outline' as const,
    icon: AlertCircle,
    label: 'Expired',
    animate: false,
  },
}

export default function ScannerPage() {
  const [tokenAddress, setTokenAddress] = useState('')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analyzeResult, setAnalyzeResult] = useState<{
    success: boolean
    message?: string
  } | null>(null)

  const { data: scannerRes, mutate } = useSWR<ScannerResponse>(
    '/api/scanner',
    fetcher,
    { refreshInterval: REFRESH_INTERVALS.REALTIME }
  )

  const opportunities = scannerRes?.data?.opportunities || []

  const analyzing = opportunities.filter((o) => o.status === 'ANALYZING')
  const qualified = opportunities.filter((o) => o.status === 'QUALIFIED')
  const rejected = opportunities.filter((o) => o.status === 'REJECTED')
  const entered = opportunities.filter((o) => o.status === 'ENTERED')

  const handleAnalyze = async () => {
    if (!tokenAddress.trim() || isAnalyzing) return
    if (tokenAddress.length !== 44) {
      setAnalyzeResult({ success: false, message: 'Invalid address (must be 44 characters)' })
      return
    }

    setIsAnalyzing(true)
    setAnalyzeResult(null)

    try {
      const res = await fetch('/api/scanner/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenAddress }),
      })
      const data = await res.json()

      if (data.success) {
        setAnalyzeResult({ success: true, message: 'Token added to analysis queue' })
        setTokenAddress('')
        await mutate()
      } else {
        setAnalyzeResult({ success: false, message: data.error || 'Analysis failed' })
      }
    } catch {
      setAnalyzeResult({ success: false, message: 'Failed to analyze token' })
    } finally {
      setIsAnalyzing(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Token Scanner</h1>
          <p className="text-muted-foreground">Monitor token opportunities</p>
        </div>
        <div className="flex items-center gap-4">
          <Badge variant="outline" className="text-lg px-3 py-1">
            {opportunities.length} Total
          </Badge>
          <Badge variant="outline">
            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            {analyzing.length} Analyzing
          </Badge>
          <Badge variant="success">
            <CheckCircle className="w-3 h-3 mr-1" />
            {qualified.length} Qualified
          </Badge>
          <Badge variant="destructive">
            <XCircle className="w-3 h-3 mr-1" />
            {rejected.length} Rejected
          </Badge>
        </div>
      </div>

      {/* Manual Analysis */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Analyze Token Manually</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            <Input
              placeholder="Token address (44 characters)..."
              value={tokenAddress}
              onChange={(e) => setTokenAddress(e.target.value)}
              className="flex-1 font-mono"
              maxLength={44}
            />
            <Button onClick={handleAnalyze} disabled={isAnalyzing || !tokenAddress.trim()}>
              {isAnalyzing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4 mr-2" />
                  Analyze
                </>
              )}
            </Button>
          </div>
          {analyzeResult && (
            <p
              className={`mt-2 text-sm ${
                analyzeResult.success ? 'text-success' : 'text-destructive'
              }`}
            >
              {analyzeResult.message}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Opportunities Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Scan className="w-5 h-5" />
            Active Opportunities
            <span className="text-sm text-muted-foreground font-normal">
              ({opportunities.length} tokens)
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {opportunities.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Scan className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No token opportunities detected</p>
              <p className="text-sm mt-1">
                Waiting for smart wallet signals or manually analyze a token above
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Token</TableHead>
                  <TableHead className="text-right">Safety</TableHead>
                  <TableHead className="text-right">Conviction</TableHead>
                  <TableHead className="text-right">Smart Wallets</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {opportunities.map((opportunity) => {
                  const config = statusConfig[opportunity.status] || statusConfig.ANALYZING
                  const StatusIcon = config.icon

                  return (
                    <TableRow key={opportunity.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div>
                            <p className="font-medium">
                              {opportunity.tokenSymbol || opportunity.tokenName || 'Unknown'}
                            </p>
                            <div className="flex items-center gap-1">
                              <p className="text-xs text-muted-foreground font-mono">
                                {formatAddress(opportunity.tokenAddress)}
                              </p>
                              <a
                                href={`https://solscan.io/token/${opportunity.tokenAddress}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-muted-foreground hover:text-foreground"
                              >
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge
                          variant={
                            opportunity.safetyScore >= 80
                              ? 'success'
                              : opportunity.safetyScore >= 60
                              ? 'warning'
                              : 'destructive'
                          }
                        >
                          {formatNumber(opportunity.safetyScore, 0)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge
                          variant={
                            opportunity.convictionScore >= 85
                              ? 'success'
                              : opportunity.convictionScore >= 70
                              ? 'warning'
                              : 'outline'
                          }
                        >
                          {formatNumber(opportunity.convictionScore, 0)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {opportunity.smartWalletCount}
                      </TableCell>
                      <TableCell>
                        <Badge variant={config.variant}>
                          <StatusIcon
                            className={`w-3 h-3 mr-1 ${
                              config.animate ? 'animate-spin' : ''
                            }`}
                          />
                          {config.label}
                        </Badge>
                        {opportunity.rejectReason && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {opportunity.rejectReason}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground text-sm">
                        {timeAgo(opportunity.updatedAt)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Entered Tokens */}
      {entered.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-success">
              Recently Entered ({entered.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {entered.map((token) => (
                <Badge key={token.id} variant="success">
                  {token.tokenSymbol || formatAddress(token.tokenAddress)} (
                  {formatNumber(token.convictionScore, 0)})
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
