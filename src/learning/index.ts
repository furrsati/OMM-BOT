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
 * - Learning Scheduler: Coordinates all learning cycles
 *
 * Phase 7: COMPLETE IMPLEMENTATION
 */

export { PatternMatcher } from './pattern-matcher';
export { WeightOptimizer } from './weight-optimizer';
export { ParameterTuner } from './parameter-tuner';
export { MetaLearner } from './meta-learner';
export { LearningScheduler } from './learning-scheduler';
export type { LearningSnapshot, PerformanceMetrics, LearningImpact } from './meta-learner';
export type { LearningSchedulerStatus } from './learning-scheduler';
