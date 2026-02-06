'use client'

import { cn } from '@/lib/utils'

interface ConnectionStatusProps {
  isConnected: boolean
  className?: string
}

export function ConnectionStatus({ isConnected, className }: ConnectionStatusProps) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <span
        className={cn(
          'w-2 h-2 rounded-full',
          isConnected ? 'bg-success pulse-green' : 'bg-destructive pulse-red'
        )}
      />
      <span className="text-sm font-medium">
        {isConnected ? 'Connected' : 'Disconnected'}
      </span>
    </div>
  )
}
