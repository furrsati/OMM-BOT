'use client'

import { useState, useCallback } from 'react'
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
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Info,
  Search,
  RefreshCw,
  ChevronDown,
} from 'lucide-react'

interface LogEntry {
  id: string
  level: 'info' | 'warning' | 'error' | 'debug'
  category: string
  message: string
  data: Record<string, unknown>
  timestamp: string
}

interface LogsResponse {
  success: boolean
  data: LogEntry[]
}

interface CategoriesResponse {
  success: boolean
  data: string[]
}

const levelConfig = {
  info: {
    variant: 'outline' as const,
    icon: Info,
    label: 'Info',
    className: 'text-blue-400 border-blue-400/50',
  },
  warning: {
    variant: 'warning' as const,
    icon: AlertTriangle,
    label: 'Warning',
    className: 'text-yellow-400 border-yellow-400/50',
  },
  error: {
    variant: 'destructive' as const,
    icon: AlertCircle,
    label: 'Error',
    className: 'text-red-400 border-red-400/50',
  },
  debug: {
    variant: 'outline' as const,
    icon: Info,
    label: 'Debug',
    className: 'text-gray-400 border-gray-400/50',
  },
}

export default function LogsPage() {
  const [level, setLevel] = useState<string>('')
  const [category, setCategory] = useState<string>('')
  const [search, setSearch] = useState<string>('')
  const [searchInput, setSearchInput] = useState<string>('')
  const [limit, setLimit] = useState(100)
  const [isGeneratingTestLogs, setIsGeneratingTestLogs] = useState(false)

  const queryParams = new URLSearchParams()
  if (level) queryParams.append('level', level)
  if (category) queryParams.append('category', category)
  if (search) queryParams.append('search', search)
  queryParams.append('limit', limit.toString())

  const { data: logsRes, mutate, isLoading } = useSWR<LogsResponse>(
    `/api/logs?${queryParams.toString()}`,
    fetcher,
    { refreshInterval: REFRESH_INTERVALS.NORMAL }
  )

  const { data: categoriesRes } = useSWR<CategoriesResponse>(
    '/api/logs/categories',
    fetcher
  )

  const logs = logsRes?.data || []
  const categories = categoriesRes?.data || []

  const handleSearch = useCallback(() => {
    setSearch(searchInput)
  }, [searchInput])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch()
    }
  }

  const handleLoadMore = () => {
    setLimit((prev) => prev + 100)
  }

  const handleGenerateTestLogs = async () => {
    setIsGeneratingTestLogs(true)
    try {
      const res = await fetch('/api/logs/test', { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        await mutate() // Refresh logs
      }
    } catch (error) {
      console.error('Failed to generate test logs:', error)
    } finally {
      setIsGeneratingTestLogs(false)
    }
  }

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp)
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  const infoCount = logs.filter((l) => l.level === 'info').length
  const warningCount = logs.filter((l) => l.level === 'warning').length
  const errorCount = logs.filter((l) => l.level === 'error').length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Activity Logs</h1>
          <p className="text-muted-foreground">
            Monitor all bot activity and events
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Badge variant="outline" className="text-blue-400 border-blue-400/50">
            <Info className="w-3 h-3 mr-1" />
            {infoCount} Info
          </Badge>
          <Badge
            variant="outline"
            className="text-yellow-400 border-yellow-400/50"
          >
            <AlertTriangle className="w-3 h-3 mr-1" />
            {warningCount} Warnings
          </Badge>
          <Badge variant="outline" className="text-red-400 border-red-400/50">
            <AlertCircle className="w-3 h-3 mr-1" />
            {errorCount} Errors
          </Badge>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-4 flex-wrap">
            {/* Level Filter */}
            <select
              value={level}
              onChange={(e) => setLevel(e.target.value)}
              className="h-10 px-3 rounded-lg border border-border bg-background text-sm min-w-[120px]"
            >
              <option value="">All Levels</option>
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="error">Error</option>
              <option value="debug">Debug</option>
            </select>

            {/* Category Filter */}
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="h-10 px-3 rounded-lg border border-border bg-background text-sm min-w-[150px]"
            >
              <option value="">All Categories</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>

            {/* Search */}
            <div className="flex gap-2 flex-1 min-w-[250px]">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search messages..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="pl-10"
                />
              </div>
              <Button onClick={handleSearch} variant="outline">
                Search
              </Button>
            </div>

            {/* Generate Test Logs */}
            <Button
              onClick={handleGenerateTestLogs}
              variant="outline"
              disabled={isGeneratingTestLogs}
              title="Generate sample logs to test the logging system"
            >
              {isGeneratingTestLogs ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Activity className="w-4 h-4 mr-2" />
                  Test Logs
                </>
              )}
            </Button>

            {/* Refresh */}
            <Button
              onClick={() => mutate()}
              variant="outline"
              disabled={isLoading}
            >
              <RefreshCw
                className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`}
              />
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Logs Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="w-5 h-5" />
            Bot Activity Log
            <span className="text-sm text-muted-foreground font-normal">
              ({logs.length} entries)
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Activity className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No logs found</p>
              <p className="text-sm mt-1">
                {search || level || category
                  ? 'Try adjusting your filters'
                  : 'Waiting for bot activity...'}
              </p>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[150px]">Time</TableHead>
                    <TableHead className="w-[100px]">Level</TableHead>
                    <TableHead className="w-[120px]">Category</TableHead>
                    <TableHead>Message</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => {
                    const config = levelConfig[log.level] || levelConfig.info
                    const LevelIcon = config.icon

                    return (
                      <TableRow key={log.id}>
                        <TableCell className="font-mono text-sm text-muted-foreground">
                          {formatTimestamp(log.timestamp)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={config.className}>
                            <LevelIcon className="w-3 h-3 mr-1" />
                            {config.label}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="font-mono text-xs">
                            {log.category}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-[500px]">
                          <p className="truncate">{log.message}</p>
                          {log.data && Object.keys(log.data).length > 0 && (
                            <details className="mt-1">
                              <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                                View details
                              </summary>
                              <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-auto max-h-[200px]">
                                {JSON.stringify(log.data, null, 2)}
                              </pre>
                            </details>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>

              {/* Load More */}
              <div className="mt-4 text-center">
                <Button onClick={handleLoadMore} variant="outline">
                  <ChevronDown className="w-4 h-4 mr-2" />
                  Load More
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
