import { Service, type IAgentRuntime, logger } from '@elizaos/core';

/**
 * Interface for tracking fetch statistics
 */
export interface FetchStatistics {
  timestamp: number;
  fetchedCount: number;
  uniqueCount: number;
  duplicateCount: number;
  duplicateRatio: number;
  oldestTweetTime?: number;
  newestTweetTime?: number;
  processingTimeMs: number;
  watchTermsFound: Record<string, number>;
}

/**
 * Interface for traffic analysis results
 */
export interface TrafficAnalysis {
  currentVolume: number;
  duplicateRatio: number;
  trafficVelocity: number; // tweets per minute
  volumeTrend: 'increasing' | 'decreasing' | 'stable' | 'spike' | 'lull';
  missedTweetIndicator: boolean;
  avgFetchInterval: number;
  recommendedInterval: number;
  confidence: number;
}

/**
 * TrafficAnalyzerService monitors and analyzes tweet traffic patterns
 * to provide insights for dynamic scheduling optimization
 */
export class TrafficAnalyzerService extends Service {
  static serviceType = 'traffic-analyzer';
  capabilityDescription = 'Analyzes Twitter traffic patterns for dynamic scheduling optimization';

  private fetchHistory: FetchStatistics[] = [];
  private readonly MAX_HISTORY_SIZE = 20; // Keep last 20 fetches for analysis
  private readonly SPIKE_THRESHOLD = 2.0; // 200% of average
  private readonly LULL_THRESHOLD = 0.3; // 30% of average

  // Traffic pattern thresholds
  private readonly HIGH_DUPLICATE_RATIO = 0.5; // 50% duplicates means we're fetching too often
  private readonly LOW_DUPLICATE_RATIO = 0.1; // 10% duplicates might mean we're missing tweets
  private readonly OPTIMAL_DUPLICATE_RATIO = 0.25; // 25% overlap is healthy

  // Volume analysis windows
  private readonly SHORT_WINDOW = 5; // Last 5 fetches for immediate trends
  private readonly LONG_WINDOW = 15; // Last 15 fetches for overall patterns

  constructor(runtime: IAgentRuntime) {
    super(runtime);
  }

  static async start(runtime: IAgentRuntime): Promise<TrafficAnalyzerService> {
    logger.info('🚀 Starting Traffic Analyzer Service');
    const service = new TrafficAnalyzerService(runtime);
    return service;
  }

  async stop(): Promise<void> {
    logger.info('🛑 Stopping Traffic Analyzer Service');
    this.fetchHistory = [];
  }

  /**
   * Record fetch statistics for analysis
   */
  recordFetch(stats: FetchStatistics): void {
    this.fetchHistory.push(stats);

    // Maintain history size limit
    if (this.fetchHistory.length > this.MAX_HISTORY_SIZE) {
      this.fetchHistory.shift();
    }

    logger.info(
      `[TrafficAnalyzer] Recorded fetch: ${stats.uniqueCount} unique, ` +
        `${stats.duplicateCount} duplicates (${(stats.duplicateRatio * 100).toFixed(1)}%), ` +
        `processing time: ${stats.processingTimeMs}ms`
    );

    // Log watch term distribution
    const termStats = Object.entries(stats.watchTermsFound)
      .map(([term, count]) => `${term}:${count}`)
      .join(', ');
    if (termStats) {
      logger.debug(`[TrafficAnalyzer] Watch term distribution: ${termStats}`);
    }
  }

  /**
   * Analyze current traffic patterns and provide recommendations
   */
  analyzeTraffic(): TrafficAnalysis {
    if (this.fetchHistory.length < 2) {
      // Not enough data for analysis
      return this.getDefaultAnalysis();
    }

    const recentFetches = this.getRecentFetches(this.SHORT_WINDOW);
    const historicalFetches = this.getRecentFetches(this.LONG_WINDOW);

    // Calculate current metrics
    const currentVolume = this.calculateAverageVolume(recentFetches);
    const duplicateRatio = this.calculateAverageDuplicateRatio(recentFetches);
    const trafficVelocity = this.calculateTrafficVelocity(recentFetches);
    const volumeTrend = this.detectVolumeTrend(recentFetches, historicalFetches);
    const missedTweetIndicator = this.detectMissedTweets(recentFetches);
    const avgFetchInterval = this.calculateAverageFetchInterval(recentFetches);

    // Calculate recommended interval based on analysis
    const recommendedInterval = this.calculateRecommendedInterval(
      duplicateRatio,
      volumeTrend,
      trafficVelocity,
      missedTweetIndicator,
      avgFetchInterval
    );

    // Calculate confidence in recommendation (0-1)
    const confidence = this.calculateConfidence();

    const analysis: TrafficAnalysis = {
      currentVolume,
      duplicateRatio,
      trafficVelocity,
      volumeTrend,
      missedTweetIndicator,
      avgFetchInterval,
      recommendedInterval,
      confidence,
    };

    logger.info(
      `[TrafficAnalyzer] Analysis: volume=${currentVolume.toFixed(1)}, ` +
        `duplicates=${(duplicateRatio * 100).toFixed(1)}%, ` +
        `velocity=${trafficVelocity.toFixed(1)} tweets/min, ` +
        `trend=${volumeTrend}, missed=${missedTweetIndicator}, ` +
        `recommended interval=${(recommendedInterval / 60000).toFixed(1)} min`
    );

    return analysis;
  }

  /**
   * Get recent fetch statistics
   */
  private getRecentFetches(windowSize: number): FetchStatistics[] {
    const startIndex = Math.max(0, this.fetchHistory.length - windowSize);
    return this.fetchHistory.slice(startIndex);
  }

  /**
   * Calculate average volume from fetch statistics
   */
  private calculateAverageVolume(fetches: FetchStatistics[]): number {
    if (fetches.length === 0) return 0;
    const totalVolume = fetches.reduce((sum, f) => sum + f.uniqueCount, 0);
    return totalVolume / fetches.length;
  }

  /**
   * Calculate average duplicate ratio
   */
  private calculateAverageDuplicateRatio(fetches: FetchStatistics[]): number {
    if (fetches.length === 0) return 0;
    const totalRatio = fetches.reduce((sum, f) => sum + f.duplicateRatio, 0);
    return totalRatio / fetches.length;
  }

  /**
   * Calculate traffic velocity (tweets per minute)
   */
  private calculateTrafficVelocity(fetches: FetchStatistics[]): number {
    if (fetches.length < 2) return 0;

    const firstFetch = fetches[0];
    const lastFetch = fetches[fetches.length - 1];
    const timeSpanMinutes = (lastFetch.timestamp - firstFetch.timestamp) / 60000;

    if (timeSpanMinutes <= 0) return 0;

    const totalTweets = fetches.reduce((sum, f) => sum + f.uniqueCount, 0);
    return totalTweets / timeSpanMinutes;
  }

  /**
   * Detect volume trend by comparing recent to historical averages
   */
  private detectVolumeTrend(
    recentFetches: FetchStatistics[],
    historicalFetches: FetchStatistics[]
  ): 'increasing' | 'decreasing' | 'stable' | 'spike' | 'lull' {
    if (recentFetches.length < 2 || historicalFetches.length < 5) {
      return 'stable';
    }

    const recentAvg = this.calculateAverageVolume(recentFetches);
    const historicalAvg = this.calculateAverageVolume(historicalFetches);

    if (historicalAvg === 0) return 'stable';

    const ratio = recentAvg / historicalAvg;

    if (ratio >= this.SPIKE_THRESHOLD) {
      return 'spike';
    } else if (ratio <= this.LULL_THRESHOLD) {
      return 'lull';
    } else if (ratio > 1.3) {
      return 'increasing';
    } else if (ratio < 0.7) {
      return 'decreasing';
    } else {
      return 'stable';
    }
  }

  /**
   * Detect if we might be missing tweets based on patterns
   */
  private detectMissedTweets(fetches: FetchStatistics[]): boolean {
    if (fetches.length < 3) return false;

    // Check for very low duplicate ratios consistently
    const avgDuplicateRatio = this.calculateAverageDuplicateRatio(fetches);
    if (avgDuplicateRatio < this.LOW_DUPLICATE_RATIO) {
      logger.debug('[TrafficAnalyzer] Low duplicate ratio suggests possible missed tweets');
      return true;
    }

    // Check for time gaps in tweet timestamps
    for (let i = 1; i < fetches.length; i++) {
      const prevFetch = fetches[i - 1];
      const currFetch = fetches[i];

      if (prevFetch.newestTweetTime && currFetch.oldestTweetTime) {
        const gap = prevFetch.newestTweetTime - currFetch.oldestTweetTime;
        // If there's a significant gap (> 5 minutes) between consecutive fetches
        if (gap > 5 * 60 * 1000) {
          logger.debug(
            '[TrafficAnalyzer] Time gap detected between fetches, possible missed tweets'
          );
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Calculate average interval between fetches
   */
  private calculateAverageFetchInterval(fetches: FetchStatistics[]): number {
    if (fetches.length < 2) return 5 * 60 * 1000; // Default 5 minutes

    let totalInterval = 0;
    let count = 0;

    for (let i = 1; i < fetches.length; i++) {
      const interval = fetches[i].timestamp - fetches[i - 1].timestamp;
      totalInterval += interval;
      count++;
    }

    return count > 0 ? totalInterval / count : 5 * 60 * 1000;
  }

  /**
   * Calculate recommended interval based on traffic analysis
   */
  private calculateRecommendedInterval(
    duplicateRatio: number,
    volumeTrend: 'increasing' | 'decreasing' | 'stable' | 'spike' | 'lull',
    trafficVelocity: number,
    missedTweetIndicator: boolean,
    currentInterval: number
  ): number {
    const NOMINAL_INTERVAL = 30 * 60 * 1000; // 30 minutes
    const MIN_INTERVAL = 60 * 1000; // 1 minute
    const MAX_INTERVAL = 4 * 60 * 60 * 1000; // 4 hours

    let recommendedInterval = currentInterval;

    // Handle traffic spikes - immediate response
    if (volumeTrend === 'spike') {
      recommendedInterval = MIN_INTERVAL;
      logger.info('[TrafficAnalyzer] Traffic spike detected - recommending minimum interval');
      return recommendedInterval;
    }

    // Handle traffic lulls - extend interval
    if (volumeTrend === 'lull') {
      recommendedInterval = Math.min(currentInterval * 2, MAX_INTERVAL);
      logger.info('[TrafficAnalyzer] Traffic lull detected - recommending doubled interval');
      return recommendedInterval;
    }

    // Adjust based on duplicate ratio
    if (duplicateRatio > this.HIGH_DUPLICATE_RATIO) {
      // Too many duplicates, we're fetching too often
      recommendedInterval = Math.min(currentInterval * 1.5, MAX_INTERVAL);
      logger.debug('[TrafficAnalyzer] High duplicate ratio - increasing interval');
    } else if (duplicateRatio < this.LOW_DUPLICATE_RATIO || missedTweetIndicator) {
      // Too few duplicates or missing tweets, fetch more frequently
      recommendedInterval = Math.max(currentInterval * 0.5, MIN_INTERVAL);
      logger.debug('[TrafficAnalyzer] Low duplicate ratio or missed tweets - decreasing interval');
    } else if (Math.abs(duplicateRatio - this.OPTIMAL_DUPLICATE_RATIO) < 0.05) {
      // We're in the optimal range, gradually move toward nominal
      const adjustment = (NOMINAL_INTERVAL - currentInterval) * 0.1;
      recommendedInterval = currentInterval + adjustment;
      logger.debug('[TrafficAnalyzer] Optimal duplicate ratio - adjusting toward nominal');
    }

    // Adjust based on velocity
    if (trafficVelocity > 10) {
      // High velocity, ensure we're not too slow
      recommendedInterval = Math.min(recommendedInterval, 5 * 60 * 1000); // Cap at 5 minutes
    } else if (trafficVelocity < 0.5) {
      // Very low velocity, can afford longer intervals
      recommendedInterval = Math.max(recommendedInterval, NOMINAL_INTERVAL);
    }

    // Apply bounds
    recommendedInterval = Math.max(MIN_INTERVAL, Math.min(MAX_INTERVAL, recommendedInterval));

    // Smooth adjustments to avoid oscillation
    const maxChange = currentInterval * 0.5; // Don't change by more than 50% at once
    const change = recommendedInterval - currentInterval;
    if (Math.abs(change) > maxChange) {
      recommendedInterval = currentInterval + Math.sign(change) * maxChange;
    }

    return Math.round(recommendedInterval);
  }

  /**
   * Calculate confidence in the recommendation (0-1)
   */
  private calculateConfidence(): number {
    // Confidence based on amount of data
    const dataPoints = this.fetchHistory.length;
    const dataConfidence = Math.min(dataPoints / 10, 1.0); // Full confidence at 10+ data points

    // Confidence based on consistency of patterns
    const recentFetches = this.getRecentFetches(this.SHORT_WINDOW);
    if (recentFetches.length < 2) return dataConfidence * 0.5;

    // Check for consistent duplicate ratios
    const duplicateRatios = recentFetches.map((f) => f.duplicateRatio);
    const avgRatio = duplicateRatios.reduce((a, b) => a + b, 0) / duplicateRatios.length;
    const variance =
      duplicateRatios.reduce((sum, r) => sum + Math.pow(r - avgRatio, 2), 0) /
      duplicateRatios.length;
    const consistencyConfidence = Math.max(0, 1 - variance * 2); // Lower confidence with high variance

    return dataConfidence * 0.7 + consistencyConfidence * 0.3;
  }

  /**
   * Get default analysis when insufficient data
   */
  private getDefaultAnalysis(): TrafficAnalysis {
    return {
      currentVolume: 0,
      duplicateRatio: 0,
      trafficVelocity: 0,
      volumeTrend: 'stable',
      missedTweetIndicator: false,
      avgFetchInterval: 5 * 60 * 1000, // 5 minutes default
      recommendedInterval: 30 * 60 * 1000, // 30 minutes nominal
      confidence: 0.1,
    };
  }

  /**
   * Get current statistics for monitoring
   */
  getStatistics(): {
    historySize: number;
    totalFetches: number;
    totalTweets: number;
    avgDuplicateRatio: number;
    avgProcessingTime: number;
    currentAnalysis: TrafficAnalysis;
  } {
    const totalFetches = this.fetchHistory.length;
    const totalTweets = this.fetchHistory.reduce((sum, f) => sum + f.uniqueCount, 0);
    const avgDuplicateRatio =
      totalFetches > 0
        ? this.fetchHistory.reduce((sum, f) => sum + f.duplicateRatio, 0) / totalFetches
        : 0;
    const avgProcessingTime =
      totalFetches > 0
        ? this.fetchHistory.reduce((sum, f) => sum + f.processingTimeMs, 0) / totalFetches
        : 0;

    return {
      historySize: this.MAX_HISTORY_SIZE,
      totalFetches,
      totalTweets,
      avgDuplicateRatio,
      avgProcessingTime,
      currentAnalysis: this.analyzeTraffic(),
    };
  }

  /**
   * Clear history (useful for testing or reset)
   */
  clearHistory(): void {
    this.fetchHistory = [];
    logger.info('[TrafficAnalyzer] Fetch history cleared');
  }
}
