/**
 * LEARNING ENGINE - Adaptive Self-Improvement System
 *
 * Barrel export for all Learning Engine modules.
 *
 * The Learning Engine makes the bot smarter over time by:
 * - Level 1 (Pattern Matcher): Remembering what happened and recognizing patterns
 * - Level 2 (Weight Optimizer): Learning what factors matter most
 * - Level 3 (Parameter Tuner): Optimizing numerical trading parameters
 * - Level 4 (Meta-Learner): Evaluating if learning is working
 *
 * Phase 1: SKELETON implementation - structure in place, full logic in Phase 7
 */

export { PatternMatcher } from './pattern-matcher';
export { WeightOptimizer } from './weight-optimizer';
export { ParameterTuner } from './parameter-tuner';
export { MetaLearner } from './meta-learner';
export type { LearningSnapshot, PerformanceMetrics, LearningImpact } from './meta-learner';
