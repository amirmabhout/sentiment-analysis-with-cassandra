import { Service, type IAgentRuntime, logger } from '@elizaos/core';
import type { 
  ProcessedSentiment, 
  SentimentAggregation, 
  SentimentReport, 
  ExtractedEntity, 
  ExtractedTopic,
  SentimentScore 
} from '../types.ts';

/**
 * SentimentAggregatorService handles aggregation and analysis of processed sentiment data
 * Calculates trends, detects spikes, and generates reports
 */
export class SentimentAggregatorService extends Service {
  static serviceType = 'sentiment-aggregator';
  capabilityDescription = 'Aggregates sentiment data and generates insights and reports';

  private sentimentHistory: ProcessedSentiment[] = [];
  private maxHistorySize = 10000; // Keep last 10k processed sentiments

  constructor(runtime: IAgentRuntime) {
    super(runtime);
    
    // Load max history size from config
    const maxSize = this.runtime.getSetting('SENTIMENT_MAX_HISTORY') as string || 
                   process.env.SENTIMENT_MAX_HISTORY;
    if (maxSize) {
      this.maxHistorySize = parseInt(maxSize, 10) || 10000;
    }
  }

  static async start(runtime: IAgentRuntime): Promise<SentimentAggregatorService> {
    logger.info('📊 Starting Sentiment Aggregator Service');
    return new SentimentAggregatorService(runtime);
  }

  async stop(): Promise<void> {
    logger.info('📊 Stopping Sentiment Aggregator Service');
  }

  /**
   * Add new processed sentiment data to the aggregator
   */
  addSentimentData(data: ProcessedSentiment[]): void {
    this.sentimentHistory.push(...data);
    
    // Keep only the most recent entries to manage memory
    if (this.sentimentHistory.length > this.maxHistorySize) {
      this.sentimentHistory = this.sentimentHistory.slice(-this.maxHistorySize);
    }

    logger.debug(`Added ${data.length} sentiment records, total history: ${this.sentimentHistory.length}`);
  }

  /**
   * Generate sentiment aggregation for a specific time window and watch term
   */
  async generateAggregation(
    watchTerm: string,
    startTime: number,
    endTime: number,
    previousPeriodStart?: number,
    previousPeriodEnd?: number
  ): Promise<SentimentAggregation> {
    logger.info(`Generating aggregation for '${watchTerm}' from ${new Date(startTime).toISOString()} to ${new Date(endTime).toISOString()}`);

    // Filter data for the time window and watch term
    const relevantData = this.sentimentHistory.filter(item => 
      item.processedAt >= startTime && 
      item.processedAt <= endTime && 
      item.watchTermsFound.some(term => term.toLowerCase().includes(watchTerm.toLowerCase()))
    );

    if (relevantData.length === 0) {
      logger.info(`No sentiment data found for '${watchTerm}' in the specified time window`);
      return this.createEmptyAggregation(watchTerm, startTime, endTime);
    }

    // Calculate basic metrics
    const totalPosts = relevantData.length;
    const sentimentScores = relevantData.map(item => item.sentiment.score);
    const avgSentiment = sentimentScores.reduce((sum, score) => sum + score, 0) / sentimentScores.length;
    const avgConfidence = relevantData.reduce((sum, item) => sum + item.sentiment.confidence, 0) / totalPosts;
    const avgMagnitude = relevantData.reduce((sum, item) => sum + item.sentiment.magnitude, 0) / totalPosts;

    // Calculate sentiment distribution
    const sentimentDistribution = {
      positive: relevantData.filter(item => item.sentiment.score > 0.1).length,
      neutral: relevantData.filter(item => item.sentiment.score >= -0.1 && item.sentiment.score <= 0.1).length,
      negative: relevantData.filter(item => item.sentiment.score < -0.1).length
    };

    // Aggregate entities
    const topEntities = this.aggregateEntities(relevantData);
    
    // Aggregate topics
    const topTopics = this.aggregateTopics(relevantData);

    // Calculate influence metrics
    const influenceMetrics = this.calculateInfluenceMetrics(relevantData);

    // Calculate trends (if previous period data is provided)
    const trends = await this.calculateTrends(
      relevantData, 
      watchTerm, 
      previousPeriodStart, 
      previousPeriodEnd
    );

    const aggregation: SentimentAggregation = {
      timeWindow: {
        start: startTime,
        end: endTime,
        duration: endTime - startTime
      },
      watchTerm,
      totalPosts,
      sentimentDistribution,
      overallSentiment: {
        score: avgSentiment,
        confidence: avgConfidence,
        magnitude: avgMagnitude
      },
      topEntities,
      topTopics,
      influenceMetrics,
      trends
    };

    logger.info(`Generated aggregation: ${totalPosts} posts, sentiment: ${avgSentiment.toFixed(3)}`);
    return aggregation;
  }

  /**
   * Generate comprehensive sentiment report
   */
  async generateReport(
    watchTerms: string[],
    timeframeHours: number = 24,
    reportType: 'summary' | 'alert' | 'detailed' = 'summary'
  ): Promise<SentimentReport> {
    const endTime = Date.now();
    const startTime = endTime - (timeframeHours * 60 * 60 * 1000);
    const previousStart = startTime - (timeframeHours * 60 * 60 * 1000);
    const previousEnd = startTime;

    logger.info(`Generating ${reportType} report for ${timeframeHours}h period`);

    // Generate aggregations for each watch term
    const breakdowns: SentimentAggregation[] = [];
    for (const term of watchTerms) {
      const aggregation = await this.generateAggregation(
        term, 
        startTime, 
        endTime, 
        previousStart, 
        previousEnd
      );
      breakdowns.push(aggregation);
    }

    // Calculate overall metrics
    const totalVolume = breakdowns.reduce((sum, b) => sum + b.totalPosts, 0);
    const weightedSentiment = this.calculateWeightedSentiment(breakdowns);

    // Calculate changes from previous period
    const previousBreakdowns: SentimentAggregation[] = [];
    for (const term of watchTerms) {
      const prevAggregation = await this.generateAggregation(term, previousStart, previousEnd);
      previousBreakdowns.push(prevAggregation);
    }

    const previousVolume = previousBreakdowns.reduce((sum, b) => sum + b.totalPosts, 0);
    const previousSentiment = this.calculateWeightedSentiment(previousBreakdowns);

    const volumeChange = previousVolume > 0 ? ((totalVolume - previousVolume) / previousVolume) * 100 : 0;
    const sentimentChange = weightedSentiment.score - previousSentiment.score;

    // Generate alerts
    const alerts = this.generateAlerts(breakdowns, previousBreakdowns);

    // Generate narratives
    const narratives = this.generateNarratives(breakdowns);

    const report: SentimentReport = {
      id: `sentiment-report-${Date.now()}` as any,
      generatedAt: Date.now(),
      reportType,
      timeframe: {
        start: startTime,
        end: endTime,
        label: this.formatTimeframe(timeframeHours)
      },
      watchTerms,
      overallMetrics: {
        totalVolume,
        averageSentiment: weightedSentiment,
        volumeChange,
        sentimentChange
      },
      breakdowns,
      alerts,
      narratives
    };

    logger.info(`Generated report: ${totalVolume} total posts, ${alerts.length} alerts`);
    return report;
  }

  /**
   * Aggregate entities from sentiment data
   */
  private aggregateEntities(data: ProcessedSentiment[]): SentimentAggregation['topEntities'] {
    const entityMap = new Map<string, {
      entity: ExtractedEntity;
      mentions: number;
      sentimentSum: number;
      confidenceSum: number;
      magnitudeSum: number;
    }>();

    // Collect all entities
    for (const item of data) {
      for (const entity of item.entities) {
        const key = `${entity.type}:${entity.text.toLowerCase()}`;
        const existing = entityMap.get(key);

        if (existing) {
          existing.mentions++;
          existing.sentimentSum += entity.sentiment.score;
          existing.confidenceSum += entity.sentiment.confidence;
          existing.magnitudeSum += entity.sentiment.magnitude;
        } else {
          entityMap.set(key, {
            entity: { ...entity },
            mentions: 1,
            sentimentSum: entity.sentiment.score,
            confidenceSum: entity.sentiment.confidence,
            magnitudeSum: entity.sentiment.magnitude
          });
        }
      }
    }

    // Convert to result format and calculate averages
    const entities = Array.from(entityMap.values()).map(item => ({
      entity: item.entity,
      mentions: item.mentions,
      avgSentiment: {
        score: item.sentimentSum / item.mentions,
        confidence: item.confidenceSum / item.mentions,
        magnitude: item.magnitudeSum / item.mentions
      }
    }));

    // Sort by relevance score * mentions and return top 10
    return entities
      .sort((a, b) => (b.entity.relevance * b.mentions) - (a.entity.relevance * a.mentions))
      .slice(0, 10);
  }

  /**
   * Aggregate topics from sentiment data
   */
  private aggregateTopics(data: ProcessedSentiment[]): SentimentAggregation['topTopics'] {
    const topicMap = new Map<string, {
      topic: ExtractedTopic;
      mentions: number;
      sentimentSum: number;
    }>();

    // Collect all topics
    for (const item of data) {
      for (const topic of item.topics) {
        const key = topic.name.toLowerCase();
        const existing = topicMap.get(key);

        if (existing) {
          existing.mentions++;
          existing.sentimentSum += item.sentiment.score; // Use overall post sentiment
          // Merge keywords
          const newKeywords = topic.keywords.filter(k => 
            !existing.topic.keywords.some(ek => ek.toLowerCase() === k.toLowerCase())
          );
          existing.topic.keywords.push(...newKeywords);
        } else {
          topicMap.set(key, {
            topic: { ...topic, frequency: 1 },
            mentions: 1,
            sentimentSum: item.sentiment.score
          });
        }
      }
    }

    // Convert to result format
    const topics = Array.from(topicMap.values()).map(item => ({
      topic: { ...item.topic, frequency: item.mentions },
      mentions: item.mentions,
      avgSentiment: {
        score: item.sentimentSum / item.mentions,
        confidence: 0.7, // Default confidence for aggregated topics
        magnitude: 0.5   // Default magnitude for aggregated topics
      }
    }));

    // Sort by relevance * mentions and return top 5
    return topics
      .sort((a, b) => (b.topic.relevance * b.mentions) - (a.topic.relevance * a.mentions))
      .slice(0, 5);
  }

  /**
   * Calculate influence metrics from sentiment data
   */
  private calculateInfluenceMetrics(data: ProcessedSentiment[]): SentimentAggregation['influenceMetrics'] {
    if (data.length === 0) {
      return {
        totalReach: 0,
        avgViralityScore: 0,
        topInfluencers: []
      };
    }

    // Estimate total reach (would need actual follower counts)
    const totalReach = data.length * 1000; // Rough estimate

    // Calculate average virality
    const avgViralityScore = data.reduce((sum, item) => 
      sum + item.influence.viralityPotential, 0) / data.length;

    // Find top influencers by author influence
    const influencerMap = new Map<string, {
      username: string;
      influence: number;
      sentimentSum: number;
      posts: number;
    }>();

    for (const item of data) {
      const platform = item.platform;
      // We'd need to get actual usernames from the post data
      const username = `user_${item.postId.substring(0, 8)}`; // Placeholder
      
      const existing = influencerMap.get(username);
      if (existing) {
        existing.posts++;
        existing.sentimentSum += item.sentiment.score;
        existing.influence = Math.max(existing.influence, item.influence.authorInfluence);
      } else {
        influencerMap.set(username, {
          username,
          influence: item.influence.authorInfluence,
          sentimentSum: item.sentiment.score,
          posts: 1
        });
      }
    }

    const topInfluencers = Array.from(influencerMap.values())
      .filter(influencer => influencer.influence > 0.3) // Only significant influencers
      .sort((a, b) => b.influence - a.influence)
      .slice(0, 5)
      .map(influencer => ({
        username: influencer.username,
        influence: influencer.influence,
        sentiment: {
          score: influencer.sentimentSum / influencer.posts,
          confidence: 0.7,
          magnitude: 0.5
        }
      }));

    return {
      totalReach,
      avgViralityScore,
      topInfluencers
    };
  }

  /**
   * Calculate trend information by comparing with previous period
   */
  private async calculateTrends(
    currentData: ProcessedSentiment[],
    watchTerm: string,
    previousStart?: number,
    previousEnd?: number
  ): Promise<SentimentAggregation['trends']> {
    // Default to stable if no previous period provided
    if (!previousStart || !previousEnd) {
      return {
        sentimentTrend: 'stable',
        volumeTrend: 'stable',
        trendStrength: 0
      };
    }

    // Get previous period data
    const previousData = this.sentimentHistory.filter(item =>
      item.processedAt >= previousStart && 
      item.processedAt <= previousEnd &&
      item.watchTermsFound.some(term => term.toLowerCase().includes(watchTerm.toLowerCase()))
    );

    if (previousData.length === 0) {
      return {
        sentimentTrend: 'stable',
        volumeTrend: currentData.length > 0 ? 'rising' : 'stable',
        trendStrength: currentData.length > 0 ? 0.5 : 0
      };
    }

    // Calculate sentiment trends
    const currentAvgSentiment = currentData.reduce((sum, item) => sum + item.sentiment.score, 0) / currentData.length;
    const previousAvgSentiment = previousData.reduce((sum, item) => sum + item.sentiment.score, 0) / previousData.length;
    const sentimentDiff = currentAvgSentiment - previousAvgSentiment;

    let sentimentTrend: 'rising' | 'falling' | 'stable' = 'stable';
    if (Math.abs(sentimentDiff) > 0.05) { // 5% threshold
      sentimentTrend = sentimentDiff > 0 ? 'rising' : 'falling';
    }

    // Calculate volume trends
    const volumeChange = (currentData.length - previousData.length) / previousData.length;
    let volumeTrend: 'rising' | 'falling' | 'stable' = 'stable';
    if (Math.abs(volumeChange) > 0.1) { // 10% threshold
      volumeTrend = volumeChange > 0 ? 'rising' : 'falling';
    }

    // Calculate trend strength (0-1)
    const sentimentStrength = Math.min(Math.abs(sentimentDiff) / 0.5, 1); // Normalize to 0-1
    const volumeStrength = Math.min(Math.abs(volumeChange), 1);
    const trendStrength = Math.max(sentimentStrength, volumeStrength);

    return {
      sentimentTrend,
      volumeTrend,
      trendStrength
    };
  }

  /**
   * Generate alerts based on sentiment data
   */
  private generateAlerts(
    current: SentimentAggregation[], 
    previous: SentimentAggregation[]
  ): SentimentReport['alerts'] {
    const alerts: SentimentReport['alerts'] = [];

    for (let i = 0; i < current.length; i++) {
      const curr = current[i];
      const prev = previous[i];

      // Volume spike alert
      if (curr.totalPosts > prev.totalPosts * 2) {
        alerts.push({
          type: 'volume_spike',
          severity: 'high',
          message: `Volume spike detected for '${curr.watchTerm}': ${curr.totalPosts} posts (${Math.round(((curr.totalPosts - prev.totalPosts) / prev.totalPosts) * 100)}% increase)`,
          data: { current: curr.totalPosts, previous: prev.totalPosts }
        });
      }

      // Sentiment spike alert
      const sentimentDiff = curr.overallSentiment.score - prev.overallSentiment.score;
      if (Math.abs(sentimentDiff) > 0.3) {
        alerts.push({
          type: 'sentiment_spike',
          severity: sentimentDiff > 0 ? 'medium' : 'high',
          message: `${sentimentDiff > 0 ? 'Positive' : 'Negative'} sentiment spike for '${curr.watchTerm}': ${sentimentDiff > 0 ? '+' : ''}${(sentimentDiff * 100).toFixed(1)}% change`,
          data: { sentimentChange: sentimentDiff }
        });
      }

      // Negative trend alert
      if (curr.trends.sentimentTrend === 'falling' && curr.trends.trendStrength > 0.6) {
        alerts.push({
          type: 'negative_trend',
          severity: 'medium',
          message: `Negative sentiment trend detected for '${curr.watchTerm}' (strength: ${(curr.trends.trendStrength * 100).toFixed(0)}%)`,
          data: { trendStrength: curr.trends.trendStrength }
        });
      }
    }

    return alerts;
  }

  /**
   * Generate narrative analysis from sentiment data
   */
  private generateNarratives(aggregations: SentimentAggregation[]): SentimentReport['narratives'] {
    const narratives: SentimentReport['narratives'] = [];

    for (const agg of aggregations) {
      // Create narratives from top topics
      for (const topicData of agg.topTopics.slice(0, 3)) { // Top 3 topics
        narratives.push({
          theme: topicData.topic.name,
          posts: topicData.mentions,
          sentiment: topicData.avgSentiment,
          keyPhrases: topicData.topic.keywords,
          evolution: this.determineEvolution(topicData.topic.frequency, agg.totalPosts)
        });
      }
    }

    return narratives.sort((a, b) => b.posts - a.posts); // Sort by post count
  }

  /**
   * Determine narrative evolution based on frequency
   */
  private determineEvolution(frequency: number, totalPosts: number): 'emerging' | 'growing' | 'declining' | 'stable' {
    const ratio = frequency / totalPosts;
    
    if (ratio > 0.3) return 'growing';
    if (ratio > 0.1) return 'stable';
    if (frequency > 1) return 'emerging';
    return 'declining';
  }

  /**
   * Calculate weighted sentiment across multiple aggregations
   */
  private calculateWeightedSentiment(aggregations: SentimentAggregation[]): SentimentScore {
    if (aggregations.length === 0) {
      return { score: 0, confidence: 0, magnitude: 0 };
    }

    const totalPosts = aggregations.reduce((sum, agg) => sum + agg.totalPosts, 0);
    if (totalPosts === 0) {
      return { score: 0, confidence: 0, magnitude: 0 };
    }

    const weightedScore = aggregations.reduce((sum, agg) => 
      sum + (agg.overallSentiment.score * agg.totalPosts), 0) / totalPosts;
    
    const weightedConfidence = aggregations.reduce((sum, agg) => 
      sum + (agg.overallSentiment.confidence * agg.totalPosts), 0) / totalPosts;
    
    const weightedMagnitude = aggregations.reduce((sum, agg) => 
      sum + (agg.overallSentiment.magnitude * agg.totalPosts), 0) / totalPosts;

    return {
      score: weightedScore,
      confidence: weightedConfidence,
      magnitude: weightedMagnitude
    };
  }

  /**
   * Create empty aggregation for cases with no data
   */
  private createEmptyAggregation(watchTerm: string, startTime: number, endTime: number): SentimentAggregation {
    return {
      timeWindow: {
        start: startTime,
        end: endTime,
        duration: endTime - startTime
      },
      watchTerm,
      totalPosts: 0,
      sentimentDistribution: { positive: 0, neutral: 0, negative: 0 },
      overallSentiment: { score: 0, confidence: 0, magnitude: 0 },
      topEntities: [],
      topTopics: [],
      influenceMetrics: {
        totalReach: 0,
        avgViralityScore: 0,
        topInfluencers: []
      },
      trends: {
        sentimentTrend: 'stable',
        volumeTrend: 'stable',
        trendStrength: 0
      }
    };
  }

  /**
   * Format timeframe for human reading
   */
  private formatTimeframe(hours: number): string {
    if (hours < 24) {
      return `Last ${hours}h`;
    } else if (hours === 24) {
      return 'Last 24h';
    } else if (hours <= 168) {
      return `Last ${Math.round(hours / 24)}d`;
    } else {
      return `Last ${Math.round(hours / 168)}w`;
    }
  }

  /**
   * Get current sentiment history size
   */
  getHistorySize(): number {
    return this.sentimentHistory.length;
  }

  /**
   * Clear sentiment history (useful for testing)
   */
  clearHistory(): void {
    this.sentimentHistory = [];
    logger.info('Cleared sentiment history');
  }
}