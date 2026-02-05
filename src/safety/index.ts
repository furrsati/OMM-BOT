/**
 * Safety Module - Contract Analysis & Honeypot Detection
 *
 * Exports:
 * - ContractAnalyzer: Token contract safety analysis
 * - HoneypotDetector: Buy/sell simulation honeypot detection
 * - BlacklistManager: Known rugger database management
 * - SafetyScorer: Aggregated safety scoring (0-100)
 */

export { ContractAnalyzer } from './contract-analyzer';
export type { ContractAnalysis } from './contract-analyzer';

export { HoneypotDetector } from './honeypot-detector';
export type { HoneypotAnalysis } from './honeypot-detector';

export { BlacklistManager } from './blacklist-manager';
export type { BlacklistCheckResult } from './blacklist-manager';

export { SafetyScorer } from './safety-scorer';
export type { SafetyAnalysis } from './safety-scorer';
