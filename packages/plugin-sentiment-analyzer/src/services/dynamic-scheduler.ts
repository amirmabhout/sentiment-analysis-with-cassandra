import { Service, type IAgentRuntime, logger } from '@elizaos/core';
import type { TrafficAnalysis } from './traffic-analyzer';

/**
 * Scheduling configuration parameters
 */
export interface SchedulingConfig {
  nominalInterval: number;
  minInterval: number;
  maxInterval: number;
  burstModeThreshold: number;
  costPerApiCall: number;
  enablePredictive: boolean;
}

/**
 * Scheduling decision with reasoning
 */
export interface SchedulingDecision {
  nextInterval: number;
  reason: string;
  confidence: number;
  costSavings: number;
  mode: 'normal' | 'burst' | 'idle' | 'recovery';
}

/**
 * DynamicSchedulerService manages intelligent interval scheduling
 * based on traffic patterns and optimization goals
 */
export class DynamicSchedulerService extends Service {
  static serviceType = 'dynamic-scheduler';
  capabilityDescription = 'Manages dynamic scheduling intervals based on traffic patterns';

  private schedulingConfig: SchedulingConfig;
  private currentInterval: number;
  private lastSchedulingDecision?: SchedulingDecision;
  private schedulingHistory: SchedulingDecision[] = [];
  private readonly MAX_HISTORY = 50;

  // Performance tracking
  private apiCallsSaved = 0;
  private totalApiCalls = 0;
  private costSaved = 0;

  // Scheduling modes
  private currentMode: 'normal' | 'burst' | 'idle' | 'recovery' = 'normal';
  private modeStartTime?: number;
  private consecutiveIdleCycles = 0;
  private consecutiveBurstCycles = 0;

  // Recovery management
  private gapRecoveryNeeded = false;

  constructor(runtime: IAgentRuntime) {
    super(runtime);
    this.schedulingConfig = this.loadConfiguration();
    this.currentInterval = this.schedulingConfig.nominalInterval;
  }

  static async start(runtime: IAgentRuntime): Promise<DynamicSchedulerService> {
    logger.info('🚀 Starting Dynamic Scheduler Service');
    const service = new DynamicSchedulerService(runtime);
    service.logConfiguration();
    return service;
  }

  async stop(): Promise<void> {
    logger.info('🛑 Stopping Dynamic Scheduler Service');
    this.logPerformanceStats();
  }

  private loadConfiguration(): SchedulingConfig {
    // Load from environment or use defaults
    const nominalIntervalSetting =
      (this.runtime.getSetting('SENTIMENT_NOMINAL_INTERVAL') as string) ||
      process.env.SENTIMENT_NOMINAL_INTERVAL ||
      '1800000'; // 30 minutes
    const nominalInterval = parseInt(String(nominalIntervalSetting), 10);

    const minIntervalSetting =
      (this.runtime.getSetting('SENTIMENT_MIN_INTERVAL') as string) ||
      process.env.SENTIMENT_MIN_INTERVAL ||
      '60000'; // 1 minute
    const minInterval = parseInt(String(minIntervalSetting), 10);

    const maxIntervalSetting =
      (this.runtime.getSetting('SENTIMENT_MAX_INTERVAL') as string) ||
      process.env.SENTIMENT_MAX_INTERVAL ||
      '14400000'; // 4 hours
    const maxInterval = parseInt(String(maxIntervalSetting), 10);

    const burstThresholdSetting =
      (this.runtime.getSetting('SENTIMENT_BURST_THRESHOLD') as string) ||
      process.env.SENTIMENT_BURST_THRESHOLD ||
      '2.0'; // 200% of normal traffic
    const burstModeThreshold = parseFloat(String(burstThresholdSetting));

    const costPerCallSetting =
      (this.runtime.getSetting('RAPIDAPI_COST_PER_CALL') as string) ||
      process.env.RAPIDAPI_COST_PER_CALL ||
      '0.001'; // Default $0.001 per call
    const costPerApiCall = parseFloat(String(costPerCallSetting));

    const enablePredictiveSetting =
      (this.runtime.getSetting('SENTIMENT_ENABLE_PREDICTIVE') as string) ||
      process.env.SENTIMENT_ENABLE_PREDICTIVE ||
      'true';
    const enablePredictive = String(enablePredictiveSetting).toLowerCase() === 'true';

    return {
      nominalInterval,
      minInterval,
      maxInterval,
      burstModeThreshold,
      costPerApiCall,
      enablePredictive,
    };
  }

  private logConfiguration(): void {
    logger.info(
      `[DynamicScheduler] Configuration: ` +
        `Nominal=${this.schedulingConfig.nominalInterval / 60000}min, ` +
        `Min=${this.schedulingConfig.minInterval / 60000}min, ` +
        `Max=${this.schedulingConfig.maxInterval / 60000}min, ` +
        `BurstThreshold=${this.schedulingConfig.burstModeThreshold}x, ` +
        `Predictive=${this.schedulingConfig.enablePredictive}`
    );
  }

  /**
   * Calculate next scheduling interval based on traffic analysis
   */
  calculateNextInterval(trafficAnalysis: TrafficAnalysis): SchedulingDecision {
    // Determine scheduling mode
    const newMode = this.determineSchedulingMode(trafficAnalysis);
    if (newMode !== this.currentMode) {
      this.transitionMode(newMode);
    }

    let nextInterval: number;
    let reason: string;
    let costSavings = 0;

    switch (this.currentMode) {
      case 'burst':
        nextInterval = this.handleBurstMode(trafficAnalysis);
        reason = 'Burst mode: High traffic detected, using minimum interval for real-time coverage';
        break;

      case 'idle':
        nextInterval = this.handleIdleMode(trafficAnalysis);
        reason = 'Idle mode: Low activity detected, extending interval to save API calls';
        costSavings = this.calculateCostSavings(this.currentInterval, nextInterval);
        break;

      case 'recovery':
        nextInterval = this.handleRecoveryMode(trafficAnalysis);
        reason = 'Recovery mode: Filling gaps in tweet coverage with aggressive fetching';
        break;

      case 'normal':
      default:
        nextInterval = this.handleNormalMode(trafficAnalysis);
        reason = this.generateNormalModeReason(trafficAnalysis, nextInterval);
        costSavings = this.calculateCostSavings(this.currentInterval, nextInterval);
        break;
    }

    // Apply safety bounds
    nextInterval = Math.max(
      this.schedulingConfig.minInterval,
      Math.min(this.schedulingConfig.maxInterval, nextInterval)
    );

    // Apply smoothing to prevent oscillation
    nextInterval = this.applySmoothingFilter(nextInterval);

    // Create decision
    const decision: SchedulingDecision = {
      nextInterval,
      reason,
      confidence: trafficAnalysis.confidence,
      costSavings,
      mode: this.currentMode,
    };

    // Record decision
    this.recordDecision(decision);
    this.currentInterval = nextInterval;

    // Log decision
    logger.info(
      `[DynamicScheduler] Decision: ${(nextInterval / 60000).toFixed(1)}min ` +
        `(mode=${this.currentMode}, confidence=${(trafficAnalysis.confidence * 100).toFixed(0)}%) - ${reason}`
    );

    // Update performance metrics
    this.updatePerformanceMetrics(decision);

    return decision;
  }

  /**
   * Determine which scheduling mode to use based on traffic
   */
  private determineSchedulingMode(
    analysis: TrafficAnalysis
  ): 'normal' | 'burst' | 'idle' | 'recovery' {
    // Check for burst conditions
    if (analysis.volumeTrend === 'spike' || analysis.trafficVelocity > 20) {
      this.consecutiveBurstCycles++;
      this.consecutiveIdleCycles = 0;
      if (this.consecutiveBurstCycles >= 2) {
        return 'burst';
      }
    } else {
      this.consecutiveBurstCycles = 0;
    }

    // Check for idle conditions
    if (analysis.volumeTrend === 'lull' || analysis.trafficVelocity < 0.5) {
      this.consecutiveIdleCycles++;
      this.consecutiveBurstCycles = 0;
      if (this.consecutiveIdleCycles >= 3) {
        return 'idle';
      }
    } else {
      this.consecutiveIdleCycles = 0;
    }

    // Check for recovery needs
    if (analysis.missedTweetIndicator && analysis.duplicateRatio < 0.05) {
      this.gapRecoveryNeeded = true;
      return 'recovery';
    }

    // Check if we can exit recovery mode
    if (this.currentMode === 'recovery' && analysis.duplicateRatio > 0.2) {
      this.gapRecoveryNeeded = false;
      logger.info('[DynamicScheduler] Exiting recovery mode - gap filled');
    }

    return 'normal';
  }

  /**
   * Handle mode transitions
   */
  private transitionMode(newMode: 'normal' | 'burst' | 'idle' | 'recovery'): void {
    if (this.currentMode !== newMode) {
      logger.info(`[DynamicScheduler] Mode transition: ${this.currentMode} → ${newMode}`);
      this.currentMode = newMode;
      this.modeStartTime = Date.now();
    }
  }

  /**
   * Handle burst mode scheduling
   */
  private handleBurstMode(_analysis: TrafficAnalysis): number {
    // In burst mode, use minimum interval but gradually increase if sustained
    const burstDuration = this.modeStartTime ? Date.now() - this.modeStartTime : 0;

    if (burstDuration < 5 * 60 * 1000) {
      // First 5 minutes: aggressive minimum interval
      return this.schedulingConfig.minInterval;
    } else if (burstDuration < 15 * 60 * 1000) {
      // 5-15 minutes: slightly relaxed
      return this.schedulingConfig.minInterval * 2;
    } else {
      // After 15 minutes: gradually increase to prevent API exhaustion
      return Math.min(this.schedulingConfig.minInterval * 3, 5 * 60 * 1000);
    }
  }

  /**
   * Handle idle mode scheduling
   */
  private handleIdleMode(_analysis: TrafficAnalysis): number {
    // In idle mode, progressively extend intervals
    const idleDuration = this.modeStartTime ? Date.now() - this.modeStartTime : 0;
    const baseInterval = this.schedulingConfig.nominalInterval;

    if (idleDuration < 30 * 60 * 1000) {
      // First 30 minutes: 2x nominal
      return Math.min(baseInterval * 2, this.schedulingConfig.maxInterval);
    } else if (idleDuration < 2 * 60 * 60 * 1000) {
      // 30 min - 2 hours: 3x nominal
      return Math.min(baseInterval * 3, this.schedulingConfig.maxInterval);
    } else {
      // After 2 hours: maximum interval
      return this.schedulingConfig.maxInterval;
    }
  }

  /**
   * Handle recovery mode scheduling
   */
  private handleRecoveryMode(_analysis: TrafficAnalysis): number {
    // Recovery mode: aggressive fetching to fill gaps
    const recoveryDuration = this.modeStartTime ? Date.now() - this.modeStartTime : 0;

    if (recoveryDuration < 10 * 60 * 1000) {
      // First 10 minutes: minimum interval
      return this.schedulingConfig.minInterval;
    } else {
      // After 10 minutes: slightly relaxed but still aggressive
      return Math.min(this.schedulingConfig.minInterval * 1.5, 2 * 60 * 1000);
    }
  }

  /**
   * Handle normal mode scheduling with sophisticated logic
   */
  private handleNormalMode(analysis: TrafficAnalysis): number {
    let targetInterval = this.currentInterval;

    // Primary adjustment based on duplicate ratio
    if (analysis.duplicateRatio > 0.5) {
      // Too many duplicates - increase interval
      targetInterval *= 1.5;
      logger.debug('[DynamicScheduler] High duplicates - increasing interval by 50%');
    } else if (analysis.duplicateRatio < 0.1) {
      // Too few duplicates - decrease interval
      targetInterval *= 0.5;
      logger.debug('[DynamicScheduler] Low duplicates - decreasing interval by 50%');
    } else if (analysis.duplicateRatio >= 0.2 && analysis.duplicateRatio <= 0.3) {
      // Optimal range - gradually converge to nominal
      const convergenceFactor = 0.1;
      targetInterval =
        targetInterval * (1 - convergenceFactor) +
        this.schedulingConfig.nominalInterval * convergenceFactor;
      logger.debug('[DynamicScheduler] Optimal duplicates - converging to nominal');
    }

    // Secondary adjustment based on volume trend
    switch (analysis.volumeTrend) {
      case 'increasing':
        targetInterval *= 0.8;
        logger.debug('[DynamicScheduler] Increasing volume - reducing interval by 20%');
        break;
      case 'decreasing':
        targetInterval *= 1.2;
        logger.debug('[DynamicScheduler] Decreasing volume - increasing interval by 20%');
        break;
    }

    // Tertiary adjustment based on velocity
    if (analysis.trafficVelocity > 10) {
      // High velocity - cap at 5 minutes
      targetInterval = Math.min(targetInterval, 5 * 60 * 1000);
      logger.debug('[DynamicScheduler] High velocity - capping at 5 minutes');
    } else if (analysis.trafficVelocity < 1) {
      // Low velocity - ensure at least nominal
      targetInterval = Math.max(targetInterval, this.schedulingConfig.nominalInterval);
      logger.debug('[DynamicScheduler] Low velocity - ensuring at least nominal');
    }

    // Apply predictive adjustments if enabled
    if (this.schedulingConfig.enablePredictive) {
      targetInterval = this.applyPredictiveAdjustments(targetInterval, analysis);
    }

    return targetInterval;
  }

  /**
   * Apply predictive adjustments based on time patterns
   */
  private applyPredictiveAdjustments(interval: number, _analysis: TrafficAnalysis): number {
    const hour = new Date().getHours();
    const dayOfWeek = new Date().getDay();

    // Simple time-based patterns (can be enhanced with ML later)
    let timeFactor = 1.0;

    // Weekday patterns
    if (dayOfWeek >= 1 && dayOfWeek <= 5) {
      // Business hours: more active
      if (hour >= 9 && hour <= 17) {
        timeFactor = 0.8; // Reduce interval by 20%
      }
      // Late night: less active
      else if (hour >= 0 && hour <= 6) {
        timeFactor = 1.5; // Increase interval by 50%
      }
    }
    // Weekend patterns
    else {
      // Generally less corporate activity
      timeFactor = 1.2;
    }

    const predictedInterval = interval * timeFactor;

    if (timeFactor !== 1.0) {
      logger.debug(
        `[DynamicScheduler] Predictive adjustment: ${timeFactor}x based on ` +
          `hour=${hour}, day=${dayOfWeek}`
      );
    }

    return predictedInterval;
  }

  /**
   * Apply smoothing filter to prevent oscillation
   */
  private applySmoothingFilter(targetInterval: number): number {
    // Don't allow changes greater than 50% in a single step
    const maxChangeRatio = 0.5;
    const maxChange = this.currentInterval * maxChangeRatio;
    const change = targetInterval - this.currentInterval;

    if (Math.abs(change) > maxChange) {
      const smoothedInterval = this.currentInterval + Math.sign(change) * maxChange;
      logger.debug(
        `[DynamicScheduler] Smoothing applied: ${(targetInterval / 60000).toFixed(1)}min → ` +
          `${(smoothedInterval / 60000).toFixed(1)}min`
      );
      return smoothedInterval;
    }

    return targetInterval;
  }

  /**
   * Generate reason for normal mode decisions
   */
  private generateNormalModeReason(analysis: TrafficAnalysis, interval: number): string {
    const reasons: string[] = [];

    if (analysis.duplicateRatio > 0.5) {
      reasons.push('high duplicate ratio');
    } else if (analysis.duplicateRatio < 0.1) {
      reasons.push('low duplicate ratio');
    } else if (analysis.duplicateRatio >= 0.2 && analysis.duplicateRatio <= 0.3) {
      reasons.push('optimal duplicate ratio');
    }

    if (analysis.volumeTrend !== 'stable') {
      reasons.push(`${analysis.volumeTrend} volume trend`);
    }

    if (analysis.trafficVelocity > 10) {
      reasons.push('high traffic velocity');
    } else if (analysis.trafficVelocity < 1) {
      reasons.push('low traffic velocity');
    }

    const changePercent = (
      ((interval - this.currentInterval) / this.currentInterval) *
      100
    ).toFixed(0);
    const changeDirection = interval > this.currentInterval ? 'increased' : 'decreased';

    return `Normal mode: Interval ${changeDirection} by ${Math.abs(parseInt(changePercent))}% due to ${reasons.join(', ')}`;
  }

  /**
   * Calculate cost savings from interval changes
   */
  private calculateCostSavings(oldInterval: number, newInterval: number): number {
    if (newInterval <= oldInterval) return 0;

    // Calculate calls saved per hour
    const oldCallsPerHour = 3600000 / oldInterval;
    const newCallsPerHour = 3600000 / newInterval;
    const callsSavedPerHour = oldCallsPerHour - newCallsPerHour;

    return callsSavedPerHour * this.schedulingConfig.costPerApiCall;
  }

  /**
   * Record scheduling decision for history
   */
  private recordDecision(decision: SchedulingDecision): void {
    this.schedulingHistory.push(decision);
    this.lastSchedulingDecision = decision;

    if (this.schedulingHistory.length > this.MAX_HISTORY) {
      this.schedulingHistory.shift();
    }
  }

  /**
   * Update performance metrics
   */
  private updatePerformanceMetrics(decision: SchedulingDecision): void {
    this.totalApiCalls++;

    // Track API calls saved
    if (decision.nextInterval > this.schedulingConfig.nominalInterval) {
      const callsSaved =
        (decision.nextInterval - this.schedulingConfig.nominalInterval) /
        this.schedulingConfig.nominalInterval;
      this.apiCallsSaved += callsSaved;
      this.costSaved += decision.costSavings;
    }
  }

  /**
   * Log performance statistics
   */
  private logPerformanceStats(): void {
    const savingsPercent =
      this.totalApiCalls > 0 ? ((this.apiCallsSaved / this.totalApiCalls) * 100).toFixed(1) : '0';

    logger.info(
      `[DynamicScheduler] Performance Stats: ` +
        `Total calls=${this.totalApiCalls}, ` +
        `Calls saved=${this.apiCallsSaved.toFixed(0)} (${savingsPercent}%), ` +
        `Cost saved=$${this.costSaved.toFixed(4)}`
    );
  }

  /**
   * Get current scheduling status
   */
  getStatus(): {
    currentInterval: number;
    currentMode: string;
    lastDecision?: SchedulingDecision;
    performanceStats: {
      totalApiCalls: number;
      apiCallsSaved: number;
      costSaved: number;
      savingsPercent: number;
    };
  } {
    return {
      currentInterval: this.currentInterval,
      currentMode: this.currentMode,
      lastDecision: this.lastSchedulingDecision,
      performanceStats: {
        totalApiCalls: this.totalApiCalls,
        apiCallsSaved: Math.round(this.apiCallsSaved),
        costSaved: this.costSaved,
        savingsPercent:
          this.totalApiCalls > 0 ? (this.apiCallsSaved / this.totalApiCalls) * 100 : 0,
      },
    };
  }

  /**
   * Get current interval in milliseconds
   */
  getCurrentInterval(): number {
    return this.currentInterval;
  }

  /**
   * Force a specific mode (useful for testing or manual override)
   */
  forceMode(mode: 'normal' | 'burst' | 'idle' | 'recovery'): void {
    logger.info(`[DynamicScheduler] Forcing mode: ${mode}`);
    this.transitionMode(mode);
  }

  /**
   * Reset to default state
   */
  reset(): void {
    this.currentInterval = this.schedulingConfig.nominalInterval;
    this.currentMode = 'normal';
    this.schedulingHistory = [];
    this.lastSchedulingDecision = undefined;
    this.consecutiveIdleCycles = 0;
    this.consecutiveBurstCycles = 0;
    this.gapRecoveryNeeded = false;
    logger.info('[DynamicScheduler] Reset to default state');
  }
}
