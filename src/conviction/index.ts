/**
 * Conviction Module - Entry Decision System
 *
 * Exports:
 * - SignalAggregator: Combines signals from all sources
 * - ConvictionScorer: Calculates 0-100 conviction score
 * - EntryDecisionEngine: Makes final go/no-go decisions
 * - SignalTracker: Monitors opportunities in real-time
 */

export { SignalAggregator } from './signal-aggregator';
export type {
  SmartWalletSignal,
  EntryQualitySignal,
  SocialSignal,
  MarketContextSignal,
  AggregatedSignal
} from './signal-aggregator';

export { ConvictionScorer } from './conviction-scorer';
export type { ConvictionScore } from './conviction-scorer';

export { EntryDecisionEngine } from './entry-decision';
export type { EntryDecision } from './entry-decision';

export { SignalTracker } from './signal-tracker';
export type { TrackedOpportunity } from './signal-tracker';
