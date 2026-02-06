'use client'

import { cn } from '@/lib/utils'

interface TierBadgeProps {
  tier: 1 | 2 | 3
  className?: string
}

const tierConfig = {
  1: { label: 'Tier 1', bg: 'bg-success/10', text: 'text-success', border: 'border-success/20' },
  2: { label: 'Tier 2', bg: 'bg-warning/10', text: 'text-warning', border: 'border-warning/20' },
  3: { label: 'Tier 3', bg: 'bg-muted', text: 'text-muted-foreground', border: 'border-border' },
}

export function TierBadge({ tier, className }: TierBadgeProps) {
  const config = tierConfig[tier] || tierConfig[3]

  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border',
        config.bg,
        config.text,
        config.border,
        className
      )}
    >
      {config.label}
    </span>
  )
}
