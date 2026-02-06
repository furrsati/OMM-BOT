'use client'

import { Badge } from '@/components/ui/badge'

type Regime = 'FULL' | 'CAUTIOUS' | 'DEFENSIVE' | 'PAUSE'

interface RegimeBadgeProps {
  regime: Regime
}

const regimeConfig: Record<Regime, { variant: 'success' | 'warning' | 'destructive' | 'outline'; label: string }> = {
  FULL: { variant: 'success', label: 'Full Trading' },
  CAUTIOUS: { variant: 'warning', label: 'Cautious' },
  DEFENSIVE: { variant: 'destructive', label: 'Defensive' },
  PAUSE: { variant: 'outline', label: 'Paused' },
}

export function RegimeBadge({ regime }: RegimeBadgeProps) {
  const config = regimeConfig[regime] || regimeConfig.PAUSE

  return (
    <Badge variant={config.variant}>
      {config.label}
    </Badge>
  )
}
