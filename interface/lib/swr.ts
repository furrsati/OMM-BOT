import { SWRConfiguration } from 'swr'
import { fetcher } from './api'

export const swrConfig: SWRConfiguration = {
  fetcher,
  revalidateOnFocus: false,
  revalidateOnReconnect: true,
  refreshInterval: 0,
  dedupingInterval: 2000,
}

// Preset refresh intervals
export const REFRESH_INTERVALS = {
  REALTIME: 5000,    // 5s - for positions, status
  FAST: 10000,       // 10s - for trades, alerts
  NORMAL: 30000,     // 30s - for wallets, scanner
  SLOW: 60000,       // 60s - for settings, metrics
}
