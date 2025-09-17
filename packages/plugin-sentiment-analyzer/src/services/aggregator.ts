import { Service, type IAgentRuntime, logger } from '@elizaos/core';
import type {
  ProcessedSentiment,
  SentimentAggregation,
  SentimentReport,
  ExtractedEntity,
  ExtractedTopic,
  SentimentScore,
  CategoryMetrics,
  ContentCategory,
  SocialMediaPost,
} from '../types.ts';
import type { SentimentPersistenceService } from './persistence.ts';

/**
 * SentimentAggregatorService handles aggregation and analysis of processed sentiment data
 * Calculates trends, detects spikes, and generates reports
 */
export class SentimentAggregatorService extends Service {
  static serviceType = 'sentiment-aggregator';
  capabilityDescription = 'Aggregates sentiment data and generates insights and reports';

  private persistenceService: SentimentPersistenceService;

  constructor(runtime: IAgentRuntime) {
    super(runtime);
    this.persistenceService = runtime.getService(
      'sentiment-persistence'
    ) as SentimentPersistenceService;
  }

  static async start(runtime: IAgentRuntime): Promise<SentimentAggregatorService> {
    logger.info('📊 Starting Sentiment Aggregator Service');
    return new SentimentAggregatorService(runtime);
  }

  async stop(): Promise<void> {
    logger.info('📊 Stopping Sentiment Aggregator Service');
  }

  /**
   * Add new processed sentiment data to the aggregator (stores in database)
   */
  async addSentimentData(data: ProcessedSentiment[]): Promise<void> {
    logger.info(`[AGGREGATOR] Storing ${data.length} sentiment records in database`);

    if (!this.persistenceService) {
      logger.error('[AGGREGATOR] Persistence service not available');
      return;
    }

    // Enhanced logging with multi-attribution tracking
    let multiAttributedCount = 0;
    let storedCount = 0;
    const attributionDetails = new Map<string, number>();

    for (const item of data) {
      if (item.watchTermsFound.length > 1) {
        multiAttributedCount++;
      }

      for (const term of item.watchTermsFound) {
        attributionDetails.set(term, (attributionDetails.get(term) || 0) + 1);
      }

      logger.info(
        `[AGGREGATOR] Storing post ${item.postId}: [${item.watchTermsFound.join(', ')}] sentiment=${item.sentiment.score.toFixed(3)}`
      );

      // Store in database
      const memoryId = await this.persistenceService.storeSentimentAnalysis(item);
      if (memoryId) {
        storedCount++;
      }
    }

    logger.info(
      `[AGGREGATOR] Successfully stored ${storedCount}/${data.length} sentiment analyses in database`
    );

    // Enhanced watch term distribution logging
    const totalAttributions = Array.from(attributionDetails.values()).reduce(
      (sum, count) => sum + count,
      0
    );
    logger.info(
      `[AGGREGATOR] Added ${data.length} posts with ${totalAttributions} total attributions (${multiAttributedCount} multi-attributed)`
    );
    logger.info(
      `[AGGREGATOR] New data attribution breakdown: ${Array.from(attributionDetails.entries())
        .map(([term, count]) => `${term}:${count}`)
        .join(', ')}`
    );
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
    logger.info(
      `[AGGREGATOR] Generating aggregation for '${watchTerm}' from ${new Date(startTime).toISOString()} to ${new Date(endTime).toISOString()}`
    );

    if (!this.persistenceService) {
      logger.error('[AGGREGATOR] Persistence service not available for aggregation');
      return this.createEmptyAggregation(watchTerm, startTime, endTime);
    }

    // Check cache first
    const cacheKey = `sentiment-aggregation-${watchTerm}-${startTime}-${endTime}-${this.runtime.agentId}`;
    try {
      const cached = await this.runtime.getCache<SentimentAggregation>(cacheKey);
      if (cached) {
        logger.debug(`[AGGREGATOR] Using cached aggregation for '${watchTerm}'`);
        return cached;
      }
    } catch (error) {
      logger.debug('[AGGREGATOR] Cache lookup failed, proceeding with fresh calculation');
    }

    // Get data from database instead of in-memory storage
    const relevantData = await this.persistenceService.getSentimentAnalysisByTimeRange(
      startTime,
      endTime,
      [watchTerm]
    );

    logger.info(
      `[AGGREGATOR] Retrieved ${relevantData.length} sentiment records for '${watchTerm}' from database`
    );

    // Log sample of what we found for debugging
    const sampleSize = Math.min(5, relevantData.length);
    for (let i = 0; i < sampleSize; i++) {
      const item = relevantData[i];
      logger.info(
        `[AGGREGATOR] Sample post ${item.postId}: watchTerms=[${item.watchTermsFound.join(', ')}], sentiment=${item.sentiment.score.toFixed(3)}, processedAt: ${new Date(item.processedAt).toISOString()}`
      );
    }

    if (relevantData.length === 0) {
      logger.info(
        `[AGGREGATOR] No sentiment data found for '${watchTerm}' in the specified time window`
      );
      return this.createEmptyAggregation(watchTerm, startTime, endTime);
    }

    // Calculate basic metrics
    const totalPosts = relevantData.length;
    const sentimentScores = relevantData.map((item) => item.sentiment.score);
    const avgSentiment =
      sentimentScores.reduce((sum, score) => sum + score, 0) / sentimentScores.length;
    const avgConfidence =
      relevantData.reduce((sum, item) => sum + item.sentiment.confidence, 0) / totalPosts;
    const avgMagnitude =
      relevantData.reduce((sum, item) => sum + item.sentiment.magnitude, 0) / totalPosts;

    // Calculate sentiment distribution
    const sentimentDistribution = {
      positive: relevantData.filter((item) => item.sentiment.score > 0.1).length,
      neutral: relevantData.filter(
        (item) => item.sentiment.score >= -0.1 && item.sentiment.score <= 0.1
      ).length,
      negative: relevantData.filter((item) => item.sentiment.score < -0.1).length,
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
        duration: endTime - startTime,
      },
      watchTerm,
      totalPosts,
      sentimentDistribution,
      overallSentiment: {
        score: avgSentiment,
        confidence: avgConfidence,
        magnitude: avgMagnitude,
      },
      topEntities,
      topTopics,
      influenceMetrics,
      trends,
    };

    // Cache the aggregation for 15 minutes
    try {
      await this.runtime.setCache(cacheKey, aggregation, 15 * 60 * 1000);
      logger.debug(`[AGGREGATOR] Cached aggregation for '${watchTerm}'`);
    } catch (error) {
      logger.warn('[AGGREGATOR] Failed to cache aggregation:', error);
    }

    logger.info(
      `Generated aggregation: ${totalPosts} posts, sentiment: ${avgSentiment.toFixed(3)}`
    );
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
    const startTime = endTime - timeframeHours * 60 * 60 * 1000;
    const previousStart = startTime - timeframeHours * 60 * 60 * 1000;
    const previousEnd = startTime;

    logger.info(`Generating ${reportType} report for ${timeframeHours}h period`);

    if (!this.persistenceService) {
      logger.error('[AGGREGATOR] Persistence service not available for report generation');
      throw new Error('Persistence service not available');
    }

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

    const volumeChange =
      previousVolume > 0 ? ((totalVolume - previousVolume) / previousVolume) * 100 : 0;
    const sentimentChange = weightedSentiment.score - previousSentiment.score;

    // Generate alerts
    const alerts = this.generateAlerts(breakdowns, previousBreakdowns);

    // Generate narratives
    const narratives = this.generateNarratives(breakdowns);

    // Generate category-specific metrics
    const categoryMetrics = await this.generateCategoryMetrics(
      startTime,
      endTime,
      previousStart,
      previousEnd
    );

    const report: SentimentReport = {
      id: `sentiment-report-${Date.now()}` as any,
      generatedAt: Date.now(),
      reportType,
      timeframe: {
        start: startTime,
        end: endTime,
        label: this.formatTimeframe(timeframeHours),
      },
      watchTerms,
      overallMetrics: {
        totalVolume,
        averageSentiment: weightedSentiment,
        volumeChange,
        sentimentChange,
      },
      categoryMetrics,
      breakdowns,
      alerts,
      narratives,
    };

    logger.info(`Generated report: ${totalVolume} total posts, ${alerts.length} alerts`);

    // Store the report in database for historical tracking
    try {
      await this.persistenceService.storeReport(report);
      logger.info('[AGGREGATOR] Report stored successfully in database');
    } catch (error) {
      logger.warn('[AGGREGATOR] Failed to store report in database:', error);
    }

    return report;
  }

  /**
   * Generate category-specific metrics for the report
   */
  private async generateCategoryMetrics(
    startTime: number,
    endTime: number,
    previousStart?: number,
    previousEnd?: number
  ): Promise<{ trading: CategoryMetrics; technology: CategoryMetrics }> {
    logger.info('[AGGREGATOR] Generating category-specific metrics');

    if (!this.persistenceService) {
      logger.error('[AGGREGATOR] Persistence service not available for category metrics');
      return {
        trading: this.createEmptyCategoryMetrics(),
        technology: this.createEmptyCategoryMetrics(),
      };
    }

    // Get sentiment data with tweets for the period
    const sentimentData = await this.persistenceService.getSentimentAnalysisByTimeRange(
      startTime,
      endTime
    );

    const tweets = await this.persistenceService.getTweetsByTimeRange(startTime, endTime);
    const tweetMap = new Map<string, SocialMediaPost>();
    for (const tweet of tweets) {
      tweetMap.set(tweet.id, tweet);
    }

    // Separate by category
    const tradingPosts: Array<{ sentiment: ProcessedSentiment; tweet: SocialMediaPost }> = [];
    const technologyPosts: Array<{ sentiment: ProcessedSentiment; tweet: SocialMediaPost }> = [];
    let spamCount = 0;

    for (const sentiment of sentimentData) {
      const tweet = tweetMap.get(sentiment.postId);
      if (!tweet) continue;

      const category = sentiment.categorization?.category || 'ecosystem';
      const dataPoint = { sentiment, tweet };

      if (category === 'trading') {
        tradingPosts.push(dataPoint);
      } else if (category === 'technology' || category === 'ecosystem') {
        // Map both 'technology' (legacy) and 'ecosystem' (new) to technology posts
        technologyPosts.push(dataPoint);
      } else if (category === 'spam') {
        // Don't include spam in category metrics
        spamCount++;
      } else {
        // Fallback for any unexpected categories - treat as ecosystem
        technologyPosts.push(dataPoint);
      }
    }

    logger.info(
      `[AGGREGATOR] Category distribution: ${tradingPosts.length} trading, ${technologyPosts.length} technology/ecosystem, ${spamCount} spam`
    );

    // Calculate metrics for each category
    const tradingMetrics = await this.calculateCategoryMetrics(
      tradingPosts,
      'trading',
      previousStart,
      previousEnd
    );

    const technologyMetrics = await this.calculateCategoryMetrics(
      technologyPosts,
      'technology',
      previousStart,
      previousEnd
    );

    return {
      trading: tradingMetrics,
      technology: technologyMetrics,
    };
  }

  /**
   * Calculate metrics for a specific category
   */
  private async calculateCategoryMetrics(
    posts: Array<{ sentiment: ProcessedSentiment; tweet: SocialMediaPost }>,
    category: ContentCategory,
    previousStart?: number,
    previousEnd?: number
  ): Promise<CategoryMetrics> {
    if (posts.length === 0) {
      return this.createEmptyCategoryMetrics();
    }

    // Calculate average sentiment
    const sentimentScores = posts.map((p) => p.sentiment.sentiment.score);
    const avgScore =
      sentimentScores.reduce((sum, score) => sum + score, 0) / sentimentScores.length;
    const avgConfidence =
      posts.reduce((sum, p) => sum + p.sentiment.sentiment.confidence, 0) / posts.length;
    const avgMagnitude =
      posts.reduce((sum, p) => sum + p.sentiment.sentiment.magnitude, 0) / posts.length;

    // Deduplicate posts by postId first, keeping the one with highest importance score
    const postMap = new Map<
      string,
      { post: SocialMediaPost; sentiment: ProcessedSentiment; importanceScore: number }
    >();

    for (const p of posts) {
      const importanceScore = this.calculatePostImportance(p.sentiment, p.tweet);
      const existing = postMap.get(p.tweet.id);

      if (!existing || importanceScore > existing.importanceScore) {
        postMap.set(p.tweet.id, {
          post: p.tweet,
          sentiment: p.sentiment,
          importanceScore,
        });
      }
    }

    // Get deduplicated posts and sort by importance
    const rankedPosts = Array.from(postMap.values()).sort(
      (a, b) => b.importanceScore - a.importanceScore
    );

    const topPositivePosts = rankedPosts
      .filter((p) => p.sentiment.sentiment.score > 0.05)
      .slice(0, 3);

    const topNegativePosts = rankedPosts
      .filter((p) => p.sentiment.sentiment.score < -0.05)
      .slice(0, 3);

    // Calculate changes from previous period
    let volumeChange = 0;
    let sentimentChange = 0;

    if (previousStart && previousEnd && this.persistenceService) {
      const previousData = await this.persistenceService.getSentimentAnalysisByTimeRange(
        previousStart,
        previousEnd
      );

      const previousCategoryPosts = previousData.filter((d) => {
        const postCategory = d.categorization?.category || 'ecosystem';
        // Handle both old and new category names
        if (category === 'technology') {
          return postCategory === 'technology' || postCategory === 'ecosystem';
        }
        return postCategory === category;
      });

      if (previousCategoryPosts.length > 0) {
        volumeChange =
          ((posts.length - previousCategoryPosts.length) / previousCategoryPosts.length) * 100;
        const prevAvgSentiment =
          previousCategoryPosts.reduce((sum, p) => sum + p.sentiment.score, 0) /
          previousCategoryPosts.length;
        sentimentChange = avgScore - prevAvgSentiment;
      }
    }

    // Get dominant indicators
    const dominantIndicators = this.extractDominantIndicators(posts, category);

    return {
      totalVolume: posts.length,
      averageSentiment: {
        score: avgScore,
        confidence: avgConfidence,
        magnitude: avgMagnitude,
      },
      volumeChange,
      sentimentChange,
      topPositivePosts,
      topNegativePosts,
      dominantIndicators,
    };
  }

  /**
   * Calculate importance score for a post
   */
  private calculatePostImportance(sentiment: ProcessedSentiment, tweet: SocialMediaPost): number {
    const authorInfluence = sentiment.influence.authorInfluence;
    const sentimentMagnitude = sentiment.sentiment.magnitude;
    const engagementScore = this.calculateEngagementScore(tweet);

    return authorInfluence * 0.6 + sentimentMagnitude * 0.2 + engagementScore * 0.2;
  }

  /**
   * Calculate engagement score from tweet metrics
   */
  private calculateEngagementScore(tweet: SocialMediaPost): number {
    const likes = tweet.metrics.likes || 0;
    const retweets = tweet.metrics.retweets || 0;
    const replies = tweet.metrics.replies || 0;
    const views = tweet.metrics.views || 0;

    const weightedEngagement = likes * 1.0 + retweets * 2.0 + replies * 1.5 + views * 0.01;
    return Math.min(1.0, Math.log10(weightedEngagement + 1) / 4);
  }

  /**
   * Extract dominant topics/themes for a category (replaces indicator extraction)
   */
  private extractDominantIndicators(
    posts: Array<{ sentiment: ProcessedSentiment; tweet: SocialMediaPost }>,
    category: ContentCategory
  ): string[] {
    const topicCounts = new Map<string, number>();

    // Count topic frequency across all posts
    for (const { sentiment } of posts) {
      if (!sentiment.topics || sentiment.topics.length === 0) continue;

      for (const topic of sentiment.topics) {
        // Format topic name for display (e.g., "price_action" -> "price action")
        const formattedTopic = topic.name.replace(/_/g, ' ').toLowerCase().trim();

        topicCounts.set(formattedTopic, (topicCounts.get(formattedTopic) || 0) + 1);
      }
    }

    // Return top 3-5 most common topics as "Key themes"
    return Array.from(topicCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([topic]) => topic);
  }

  /**
   * Create empty category metrics
   */
  private createEmptyCategoryMetrics(): CategoryMetrics {
    return {
      totalVolume: 0,
      averageSentiment: { score: 0, confidence: 0, magnitude: 0 },
      volumeChange: 0,
      sentimentChange: 0,
      topPositivePosts: [],
      topNegativePosts: [],
      dominantIndicators: [],
    };
  }

  /**
   * Aggregate entities from sentiment data
   */
  private aggregateEntities(data: ProcessedSentiment[]): SentimentAggregation['topEntities'] {
    const entityMap = new Map<
      string,
      {
        entity: ExtractedEntity;
        mentions: number;
        sentimentSum: number;
        confidenceSum: number;
        magnitudeSum: number;
      }
    >();

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
            magnitudeSum: entity.sentiment.magnitude,
          });
        }
      }
    }

    // Convert to result format and calculate averages
    const entities = Array.from(entityMap.values()).map((item) => ({
      entity: item.entity,
      mentions: item.mentions,
      avgSentiment: {
        score: item.sentimentSum / item.mentions,
        confidence: item.confidenceSum / item.mentions,
        magnitude: item.magnitudeSum / item.mentions,
      },
    }));

    // Sort by relevance score * mentions and return top 10
    return entities
      .sort((a, b) => b.entity.relevance * b.mentions - a.entity.relevance * a.mentions)
      .slice(0, 10);
  }

  /**
   * Aggregate topics from sentiment data
   */
  private aggregateTopics(data: ProcessedSentiment[]): SentimentAggregation['topTopics'] {
    const topicMap = new Map<
      string,
      {
        topic: ExtractedTopic;
        mentions: number;
        sentimentSum: number;
      }
    >();

    // Collect all topics
    for (const item of data) {
      for (const topic of item.topics) {
        const key = topic.name.toLowerCase();
        const existing = topicMap.get(key);

        if (existing) {
          existing.mentions++;
          existing.sentimentSum += item.sentiment.score; // Use overall post sentiment
          // Merge keywords
          const newKeywords = topic.keywords.filter(
            (k) => !existing.topic.keywords.some((ek) => ek.toLowerCase() === k.toLowerCase())
          );
          existing.topic.keywords.push(...newKeywords);
        } else {
          topicMap.set(key, {
            topic: { ...topic, frequency: 1 },
            mentions: 1,
            sentimentSum: item.sentiment.score,
          });
        }
      }
    }

    // Convert to result format
    const topics = Array.from(topicMap.values()).map((item) => ({
      topic: { ...item.topic, frequency: item.mentions },
      mentions: item.mentions,
      avgSentiment: {
        score: item.sentimentSum / item.mentions,
        confidence: 0.7, // Default confidence for aggregated topics
        magnitude: 0.5, // Default magnitude for aggregated topics
      },
    }));

    // Sort by relevance * mentions and return top 5
    return topics
      .sort((a, b) => b.topic.relevance * b.mentions - a.topic.relevance * a.mentions)
      .slice(0, 5);
  }

  /**
   * Calculate influence metrics from sentiment data
   */
  private calculateInfluenceMetrics(
    data: ProcessedSentiment[]
  ): SentimentAggregation['influenceMetrics'] {
    if (data.length === 0) {
      return {
        totalReach: 0,
        avgViralityScore: 0,
        topInfluencers: [],
      };
    }

    // Estimate total reach (would need actual follower counts)
    const totalReach = data.length * 1000; // Rough estimate

    // Calculate average virality
    const avgViralityScore =
      data.reduce((sum, item) => sum + item.influence.viralityPotential, 0) / data.length;

    // Find top influencers by author influence
    const influencerMap = new Map<
      string,
      {
        username: string;
        influence: number;
        sentimentSum: number;
        posts: number;
      }
    >();

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
          posts: 1,
        });
      }
    }

    const topInfluencers = Array.from(influencerMap.values())
      .filter((influencer) => influencer.influence > 0.3) // Only significant influencers
      .sort((a, b) => b.influence - a.influence)
      .slice(0, 5)
      .map((influencer) => ({
        username: influencer.username,
        influence: influencer.influence,
        sentiment: {
          score: influencer.sentimentSum / influencer.posts,
          confidence: 0.7,
          magnitude: 0.5,
        },
      }));

    return {
      totalReach,
      avgViralityScore,
      topInfluencers,
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
        trendStrength: 0,
      };
    }

    // Get previous period data from database
    const previousData = await this.persistenceService.getSentimentAnalysisByTimeRange(
      previousStart,
      previousEnd,
      [watchTerm]
    );

    if (previousData.length === 0) {
      return {
        sentimentTrend: 'stable',
        volumeTrend: currentData.length > 0 ? 'rising' : 'stable',
        trendStrength: currentData.length > 0 ? 0.5 : 0,
      };
    }

    // Calculate sentiment trends
    const currentAvgSentiment =
      currentData.reduce((sum, item) => sum + item.sentiment.score, 0) / currentData.length;
    const previousAvgSentiment =
      previousData.reduce((sum, item) => sum + item.sentiment.score, 0) / previousData.length;
    const sentimentDiff = currentAvgSentiment - previousAvgSentiment;

    let sentimentTrend: 'rising' | 'falling' | 'stable' = 'stable';
    if (Math.abs(sentimentDiff) > 0.05) {
      // 5% threshold
      sentimentTrend = sentimentDiff > 0 ? 'rising' : 'falling';
    }

    // Calculate volume trends
    const volumeChange = (currentData.length - previousData.length) / previousData.length;
    let volumeTrend: 'rising' | 'falling' | 'stable' = 'stable';
    if (Math.abs(volumeChange) > 0.1) {
      // 10% threshold
      volumeTrend = volumeChange > 0 ? 'rising' : 'falling';
    }

    // Calculate trend strength (0-1)
    const sentimentStrength = Math.min(Math.abs(sentimentDiff) / 0.5, 1); // Normalize to 0-1
    const volumeStrength = Math.min(Math.abs(volumeChange), 1);
    const trendStrength = Math.max(sentimentStrength, volumeStrength);

    return {
      sentimentTrend,
      volumeTrend,
      trendStrength,
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
          data: { current: curr.totalPosts, previous: prev.totalPosts },
        });
      }

      // Sentiment spike alert
      const sentimentDiff = curr.overallSentiment.score - prev.overallSentiment.score;
      if (Math.abs(sentimentDiff) > 0.3) {
        alerts.push({
          type: 'sentiment_spike',
          severity: sentimentDiff > 0 ? 'medium' : 'high',
          message: `${sentimentDiff > 0 ? 'Positive' : 'Negative'} sentiment spike for '${curr.watchTerm}': ${sentimentDiff > 0 ? '+' : ''}${(sentimentDiff * 100).toFixed(1)}% change`,
          data: { sentimentChange: sentimentDiff },
        });
      }

      // Negative trend alert
      if (curr.trends.sentimentTrend === 'falling' && curr.trends.trendStrength > 0.6) {
        alerts.push({
          type: 'negative_trend',
          severity: 'medium',
          message: `Negative sentiment trend detected for '${curr.watchTerm}' (strength: ${(curr.trends.trendStrength * 100).toFixed(0)}%)`,
          data: { trendStrength: curr.trends.trendStrength },
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
      for (const topicData of agg.topTopics.slice(0, 3)) {
        // Top 3 topics
        narratives.push({
          theme: topicData.topic.name,
          posts: topicData.mentions,
          sentiment: topicData.avgSentiment,
          keyPhrases: topicData.topic.keywords,
          evolution: this.determineEvolution(topicData.topic.frequency, agg.totalPosts),
        });
      }
    }

    return narratives.sort((a, b) => b.posts - a.posts); // Sort by post count
  }

  /**
   * Determine narrative evolution based on frequency
   */
  private determineEvolution(
    frequency: number,
    totalPosts: number
  ): 'emerging' | 'growing' | 'declining' | 'stable' {
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

    const weightedScore =
      aggregations.reduce((sum, agg) => sum + agg.overallSentiment.score * agg.totalPosts, 0) /
      totalPosts;

    const weightedConfidence =
      aggregations.reduce((sum, agg) => sum + agg.overallSentiment.confidence * agg.totalPosts, 0) /
      totalPosts;

    const weightedMagnitude =
      aggregations.reduce((sum, agg) => sum + agg.overallSentiment.magnitude * agg.totalPosts, 0) /
      totalPosts;

    return {
      score: weightedScore,
      confidence: weightedConfidence,
      magnitude: weightedMagnitude,
    };
  }

  /**
   * Create empty aggregation for cases with no data
   */
  private createEmptyAggregation(
    watchTerm: string,
    startTime: number,
    endTime: number
  ): SentimentAggregation {
    return {
      timeWindow: {
        start: startTime,
        end: endTime,
        duration: endTime - startTime,
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
        topInfluencers: [],
      },
      trends: {
        sentimentTrend: 'stable',
        volumeTrend: 'stable',
        trendStrength: 0,
      },
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
   * Get current storage statistics
   */
  async getStorageStats(): Promise<{
    totalTweets: number;
    totalSentimentAnalyses: number;
    totalReports: number;
    oldestTweet?: Date;
    newestTweet?: Date;
  }> {
    if (!this.persistenceService) {
      return {
        totalTweets: 0,
        totalSentimentAnalyses: 0,
        totalReports: 0,
      };
    }
    return await this.persistenceService.getStorageStats();
  }

  /**
   * Clean up old data (useful for maintenance)
   */
  async cleanupOldData(retentionDays: number = 30): Promise<void> {
    if (!this.persistenceService) {
      logger.warn('[AGGREGATOR] Persistence service not available for cleanup');
      return;
    }
    await this.persistenceService.cleanupOldData(retentionDays);
    logger.info(`[AGGREGATOR] Initiated cleanup of data older than ${retentionDays} days`);
  }
}
