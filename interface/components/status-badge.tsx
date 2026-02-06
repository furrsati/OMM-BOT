'use client'

import { cn } from '@/lib/utils'

type Status = 'running' | 'paused' | 'stopped' | 'error'

interface StatusBadgeProps {
  status: Status
  className?: string
}

const statusConfig: Record<Status, { label: string; color: string; pulse: string }> = {
  running: { label: 'Running', color: 'bg-success', pulse: 'pulse-green' },
  paused: { label: 'Paused', color: 'bg-warning', pulse: 'pulse-yellow' },
  stopped: { label: 'Stopped', color: 'bg-muted-foreground', pulse: '' },
  error: { label: 'Error', color: 'bg-destructive', pulse: 'pulse-red' },
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = statusConfig[status] || statusConfig.stopped

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <span
        className={cn(
          'w-3 h-3 rounded-full',
          config.color,
          config.pulse
        )}
      />
      <span className="text-sm font-medium">{config.label}</span>
    </div>
  )
}
