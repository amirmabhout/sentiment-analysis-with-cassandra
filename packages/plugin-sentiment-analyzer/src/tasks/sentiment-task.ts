import { type IAgentRuntime, logger, type Task } from '@elizaos/core';
import type { SentimentTaskMetadata, ProcessedSentiment, SocialMediaPost } from '../types.ts';
import type { TrafficAnalyzerService } from '../services/traffic-analyzer';
import type { DynamicSchedulerService } from '../services/dynamic-scheduler';
import type { SentimentPersistenceService } from '../services/persistence';
import type { DiscordReportingService } from '../services/discord-reporting';

/**
 * Task worker for recurring sentiment analysis processing
 * Orchestrates the entire sentiment analysis pipeline
 */
export const sentimentProcessingTask = {
  name: 'SENTIMENT_PROCESSING_TASK',

  validate: async (runtime: IAgentRuntime, message: any, state: any): Promise<boolean> => {
    // Always valid - this is a time-based recurring task
    // Only log validation at trace level to avoid spam
    return true;
  },

  execute: async (runtime: IAgentRuntime, options: any, task?: Task): Promise<void> => {
    const startTime = Date.now();

    try {
      // Get current metadata or initialize
      const metadata = (task?.metadata as SentimentTaskMetadata) || {
        lastProcessedTimestamp: Date.now() - 10 * 60 * 1000, // Default: 10 minutes ago
        watchTerms: ['ai16z', 'elizaos'],
        processingStats: {
          postsProcessed: 0,
          errors: 0,
          avgProcessingTime: 0,
        },
      };

      // Get dynamic scheduler service if available
      const dynamicScheduler = runtime.getService('dynamic-scheduler') as
        | DynamicSchedulerService
        | undefined;
      const trafficAnalyzer = runtime.getService('traffic-analyzer') as
        | TrafficAnalyzerService
        | undefined;

      // Use dynamic interval if available, otherwise fall back to static
      let processingInterval: number;
      if (dynamicScheduler) {
        processingInterval = dynamicScheduler.getCurrentInterval();
        logger.debug(
          `[SentimentTask] Using dynamic interval: ${processingInterval / 60000} minutes`
        );
      } else {
        processingInterval = parseInt(
          (runtime.getSetting('SENTIMENT_PROCESSING_INTERVAL') as string) ||
            process.env.SENTIMENT_PROCESSING_INTERVAL ||
            '300000',
          10
        ); // Default 5 minutes
        logger.debug(
          `[SentimentTask] Using static interval: ${processingInterval / 60000} minutes`
        );
      }

      const timeSinceLastRun = startTime - (metadata.lastProcessedTimestamp || 0);

      if (timeSinceLastRun < processingInterval) {
        // Too early to run, skip silently
        return;
      }

      logger.info(
        `[SentimentTask] Starting sentiment processing cycle (${timeSinceLastRun / 1000 / 60} min since last run)`
      );

      // Get all required services
      const twitterDataService = runtime.getService('twitter-data');
      const sentimentService = runtime.getService('sentiment-analysis');
      const aggregatorService = runtime.getService('sentiment-aggregator');

      if (!sentimentService || !aggregatorService) {
        logger.error('[SentimentTask] Required sentiment services not available');
        return; // Don't throw error, just skip this cycle
      }

      // Check Twitter data service configuration
      if (!twitterDataService) {
        logger.error('[SentimentTask] Twitter Data Service not available');
        logger.error('[SentimentTask] Please configure Twitter API credentials (see logs for options)');
        return; // Skip this cycle if Twitter service not available
      }

      const configStatus = (twitterDataService as any).getConfigurationStatus();
      logger.info(`[SentimentTask] Using ${configStatus.provider} Twitter data provider (compliant: ${configStatus.isCompliant})`);   

      logger.info(
        `[SentimentTask] Processing since ${new Date(metadata.lastProcessedTimestamp).toISOString()}`
      );

      // Step 1: Fetch recent social media posts using Twitter data service
      const posts = await (twitterDataService as any).fetchRecentTweets(
        metadata.lastProcessedTimestamp
      );
      logger.info(`[SentimentTask] Fetched ${posts.length} new posts from ${configStatus.provider} API`);

      // Report fetch statistics to traffic analyzer if available
      if (trafficAnalyzer && twitterDataService) {
        const fetchStats = (twitterDataService as any).getLastFetchStatistics();
        if (fetchStats) {
          trafficAnalyzer.recordFetch(fetchStats);
          logger.debug('[SentimentTask] Reported fetch statistics to traffic analyzer');
        }
      }

      if (posts.length === 0) {
        logger.info('[SentimentTask] No new posts to process');

        // Update timestamp and potentially adjust interval even when no posts
        if (task?.id) {
          const currentMetadata = task.metadata as SentimentTaskMetadata;
          let nextInterval = processingInterval;

          // Adjust interval if using dynamic scheduling
          if (dynamicScheduler && trafficAnalyzer) {
            // Record the empty fetch
            if (twitterDataService) {
              const fetchStats = (twitterDataService as any).getLastFetchStatistics();
              if (fetchStats) {
                trafficAnalyzer.recordFetch(fetchStats);
              }
            }

            const trafficAnalysis = trafficAnalyzer.analyzeTraffic();
            const schedulingDecision = dynamicScheduler.calculateNextInterval(trafficAnalysis);
            nextInterval = schedulingDecision.nextInterval;
          }

          const updatedMetadata = {
            ...currentMetadata,
            lastProcessedTimestamp: startTime,
            ...(dynamicScheduler && { dynamicInterval: nextInterval }),
          };

          await runtime.updateTask(task.id, {
            metadata: updatedMetadata,
            ...(dynamicScheduler && { updateInterval: nextInterval }),
          });
        }

        return;
      }

      // Step 2: Analyze sentiment for all posts
      const processedSentiments = await (sentimentService as any).analyzeBatch(posts);
      logger.info(`[SentimentTask] Processed sentiment for ${processedSentiments.length} posts`);

      // Filter out posts without watch terms
      const relevantSentiments = processedSentiments.filter(
        (sentiment) => sentiment.watchTermsFound.length > 0
      );
      logger.info(
        `[SentimentTask] Found ${relevantSentiments.length} relevant posts with watch terms`
      );

      if (relevantSentiments.length === 0) {
        logger.info('[SentimentTask] No relevant posts found');

        // Update timestamp and potentially adjust interval even when no relevant posts
        if (task?.id) {
          const currentMetadata = task.metadata as SentimentTaskMetadata;
          let nextInterval = processingInterval;

          // Adjust interval if using dynamic scheduling
          if (dynamicScheduler && trafficAnalyzer) {
            const trafficAnalysis = trafficAnalyzer.analyzeTraffic();
            const schedulingDecision = dynamicScheduler.calculateNextInterval(trafficAnalysis);
            nextInterval = schedulingDecision.nextInterval;
          }

          const updatedMetadata = {
            ...currentMetadata,
            lastProcessedTimestamp: startTime,
            ...(dynamicScheduler && { dynamicInterval: nextInterval }),
          };

          await runtime.updateTask(task.id, {
            metadata: updatedMetadata,
            ...(dynamicScheduler && { updateInterval: nextInterval }),
          });
        }

        return;
      }

      // Step 3: Add processed sentiment data to aggregator (silent processing)
      (aggregatorService as any).addSentimentData(relevantSentiments);

      logger.info(
        `[SentimentTask] Processed and stored ${relevantSentiments.length} sentiment records (silent mode)`
      );

      // Step 4: Calculate next interval if using dynamic scheduling
      let nextInterval = processingInterval; // Default to current interval
      if (dynamicScheduler && trafficAnalyzer) {
        const trafficAnalysis = trafficAnalyzer.analyzeTraffic();
        const schedulingDecision = dynamicScheduler.calculateNextInterval(trafficAnalysis);
        nextInterval = schedulingDecision.nextInterval;

        logger.info(
          `[SentimentTask] Dynamic scheduling: Next interval ${nextInterval / 60000} minutes ` +
            `(${schedulingDecision.mode} mode, reason: ${schedulingDecision.reason})`
        );
      }

      // Step 5: Update metadata for next run
      const processingTime = Date.now() - startTime;
      const updatedStats = {
        postsProcessed: metadata.processingStats.postsProcessed + relevantSentiments.length,
        errors: metadata.processingStats.errors, // Will be incremented if errors occur
        avgProcessingTime: (metadata.processingStats.avgProcessingTime + processingTime) / 2,
      };

      const updatedMetadata: SentimentTaskMetadata & { dynamicInterval?: number } = {
        lastProcessedTimestamp: Date.now(),
        watchTerms: metadata.watchTerms,
        processingStats: updatedStats,
        ...(dynamicScheduler && { dynamicInterval: nextInterval }),
      };

      // Update the task metadata if we have a task reference
      if (task?.id) {
        await runtime.updateTask(task.id, {
          metadata: updatedMetadata,
          // Update the updateInterval for dynamic scheduling
          ...(dynamicScheduler && { updateInterval: nextInterval }),
        });
      }

      logger.info(`[SentimentTask] Completed processing cycle in ${processingTime}ms`);
      logger.info(
        `[SentimentTask] Stats - Total processed: ${updatedStats.postsProcessed}, ` +
          `Errors: ${updatedStats.errors}, Avg time: ${updatedStats.avgProcessingTime.toFixed(0)}ms`
      );
    } catch (error) {
      logger.error('[SentimentTask] Error in sentiment processing task:', error);

      // Update error count in metadata if possible
      if (task?.metadata && task.id) {
        const currentMetadata = task.metadata as SentimentTaskMetadata;
        const updatedMetadata = {
          ...currentMetadata,
          processingStats: {
            ...currentMetadata.processingStats,
            errors: currentMetadata.processingStats.errors + 1,
          },
        };

        try {
          await runtime.updateTask(task.id, { metadata: updatedMetadata });
        } catch (updateError) {
          logger.error('[SentimentTask] Failed to update error count:', updateError);
        }
      }

      throw error; // Re-throw to let the task system handle it
    }
  },
};

/**
 * Task worker for generating detailed sentiment reports (runs less frequently)
 */
export const sentimentReportingTask = {
  name: 'SENTIMENT_REPORTING_TASK',

  validate: async (runtime: IAgentRuntime, message: any, state: any): Promise<boolean> => {
    // Always valid - this is a time-based recurring task
    return true;
  },

  execute: async (runtime: IAgentRuntime, options: any, task?: Task): Promise<void> => {
    const startTime = Date.now();

    try {
      // Check if enough time has passed since last report (6 hours)
      const reportInterval = 6 * 60 * 60 * 1000; // 6 hours
      const lastReportTime = task?.metadata?.lastReportTime || 0;
      const timeSinceLastReport = startTime - lastReportTime;

      if (timeSinceLastReport < reportInterval) {
        // Too early to run, skip silently
        return;
      }

      logger.info('[SentimentReportTask] Starting detailed sentiment reporting');

      // Get required services
      const sentimentService = runtime.getService('sentiment-analysis');
      const aggregatorService = runtime.getService('sentiment-aggregator');
      const discordReportingService = runtime.getService(
        'discord-reporting'
      ) as DiscordReportingService;

      if (!sentimentService || !aggregatorService) {
        logger.error('[SentimentReportTask] Required services not available');
        return;
      }

      // Generate detailed report for the last 6 hours
      const watchTerms = (sentimentService as any).getWatchTerms();
      const detailedReport = await (aggregatorService as any).generateReport(
        watchTerms,
        6, // Last 6 hours
        'detailed'
      );

      // Get top sentiment tweets for the same 6-hour period
      const topTweets = await getTopSentimentTweets(runtime, 6);

      logger.info(
        `[SentimentReportTask] Generated detailed report: ` +
          `${detailedReport.overallMetrics.totalVolume} posts, ` +
          `${detailedReport.breakdowns.length} term breakdowns, ` +
          `${detailedReport.alerts.length} alerts, ` +
          `${topTweets.positiveTweets.length} top positive tweets, ` +
          `${topTweets.negativeTweets.length} top negative tweets`
      );

      // Send detailed report with top tweets to Discord if service is available
      if (discordReportingService && discordReportingService.isAvailable()) {
        try {
          await discordReportingService.sendDetailedSentimentReport(detailedReport, topTweets);
          logger.info(
            '[SentimentReportTask] Successfully sent detailed Discord report with top tweets'
          );
        } catch (error) {
          logger.error('[SentimentReportTask] Failed to send detailed Discord report:', error);
        }
      } else {
        logger.warn(
          '[SentimentReportTask] Discord reporting service not available or not configured'
        );
      }

      // Store report in memory for later access
      await runtime.createMemory(
        {
          content: {
            text: `Detailed sentiment report generated: ${detailedReport.overallMetrics.totalVolume} posts analyzed`,
            sentiment_report: detailedReport,
            type: 'sentiment_report',
          },
          roomId: runtime.agentId, // Store in agent's own room
          entityId: runtime.agentId,
          agentId: runtime.agentId,
        },
        'messages'
      );

      // Update task metadata with last report time
      if (task?.id) {
        await runtime.updateTask(task.id, {
          metadata: {
            ...task.metadata,
            lastReportTime: startTime,
          },
        });
      }

      logger.info('[SentimentReportTask] Completed detailed sentiment reporting');
    } catch (error) {
      logger.error('[SentimentReportTask] Error in sentiment reporting task:', error);
      throw error;
    }
  },
};

/**
 * Task worker for generating daily sentiment reports (runs at midnight)
 */
export const sentimentDailyReportingTask = {
  name: 'SENTIMENT_DAILY_REPORTING_TASK',

  validate: async (runtime: IAgentRuntime, message: any, state: any): Promise<boolean> => {
    // Always valid - this is a time-based recurring task
    return true;
  },

  execute: async (runtime: IAgentRuntime, options: any, task?: Task): Promise<void> => {
    const startTime = Date.now();

    try {
      // Check if we should run the daily report (at midnight and not run today)
      const now = new Date();
      const lastReportTime = task?.metadata?.lastDailyReportTime || 0;
      const lastReportDate = new Date(lastReportTime);

      // Check if it's midnight hour (between 00:00 and 01:00)
      const isLateNight = now.getHours() === 0;

      // Check if we haven't run today yet
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const lastReportToday = lastReportDate >= today;

      if (!isLateNight || lastReportToday) {
        // Not midnight time or already ran today, skip silently
        return;
      }

      logger.info('[SentimentDailyReportTask] Starting daily midnight sentiment reporting');

      // Get required services
      const sentimentService = runtime.getService('sentiment-analysis');
      const aggregatorService = runtime.getService('sentiment-aggregator');
      const discordReportingService = runtime.getService(
        'discord-reporting'
      ) as DiscordReportingService;

      if (!sentimentService || !aggregatorService) {
        logger.error('[SentimentDailyReportTask] Required services not available');
        return;
      }

      // Generate detailed report for the last 24 hours
      const watchTerms = (sentimentService as any).getWatchTerms();
      const dailyReport = await (aggregatorService as any).generateReport(
        watchTerms,
        24, // Last 24 hours
        'detailed'
      );

      // Get top sentiment tweets for the same 24-hour period
      const topTweets = await getTopSentimentTweets(runtime, 24);

      logger.info(
        `[SentimentDailyReportTask] Generated daily report: ` +
          `${dailyReport.overallMetrics.totalVolume} posts, ` +
          `${dailyReport.breakdowns.length} term breakdowns, ` +
          `${dailyReport.alerts.length} alerts, ` +
          `${topTweets.positiveTweets.length} top positive tweets, ` +
          `${topTweets.negativeTweets.length} top negative tweets`
      );

      // Send detailed daily report with top tweets to Discord if service is available
      if (discordReportingService && discordReportingService.isAvailable()) {
        try {
          await discordReportingService.sendDetailedSentimentReport(dailyReport, topTweets);
          logger.info(
            '[SentimentDailyReportTask] Successfully sent daily Discord report with top tweets'
          );
        } catch (error) {
          logger.error('[SentimentDailyReportTask] Failed to send daily Discord report:', error);
        }
      } else {
        logger.warn(
          '[SentimentDailyReportTask] Discord reporting service not available or not configured'
        );
      }

      // Store daily report in memory for later access
      await runtime.createMemory(
        {
          content: {
            text: `Daily sentiment report generated: ${dailyReport.overallMetrics.totalVolume} posts analyzed`,
            sentiment_report: dailyReport,
            type: 'daily_sentiment_report',
          },
          roomId: runtime.agentId, // Store in agent's own room
          entityId: runtime.agentId,
          agentId: runtime.agentId,
        },
        'messages'
      );

      // Update task metadata with last daily report time
      if (task?.id) {
        await runtime.updateTask(task.id, {
          metadata: {
            ...task.metadata,
            lastDailyReportTime: startTime,
          },
        });
      }

      logger.info('[SentimentDailyReportTask] Completed daily sentiment reporting');
    } catch (error) {
      logger.error('[SentimentDailyReportTask] Error in daily sentiment reporting task:', error);
      throw error;
    }
  },
};

/**
 * Task worker for sentiment trend analysis (runs weekly)
 */
export const sentimentTrendAnalysisTask = {
  name: 'SENTIMENT_TREND_ANALYSIS_TASK',

  validate: async (runtime: IAgentRuntime, message: any, state: any): Promise<boolean> => {
    // Always valid - this is a time-based recurring task
    return true;
  },

  execute: async (runtime: IAgentRuntime, options: any, task?: Task): Promise<void> => {
    const startTime = Date.now();

    try {
      // Check if enough time has passed since last trend analysis (24 hours)
      const trendInterval = 24 * 60 * 60 * 1000; // 24 hours
      const lastTrendTime = task?.metadata?.lastTrendTime || 0;
      const timeSinceLastTrend = startTime - lastTrendTime;

      if (timeSinceLastTrend < trendInterval) {
        // Too early to run, skip silently
        return;
      }

      logger.info('[SentimentTrendTask] Starting weekly sentiment trend analysis');

      const sentimentService = runtime.getService('sentiment-analysis');
      const aggregatorService = runtime.getService('sentiment-aggregator');

      if (!sentimentService || !aggregatorService) {
        logger.error('[SentimentTrendTask] Required services not available');
        return;
      }

      // Generate weekly trend report
      const watchTerms = (sentimentService as any).getWatchTerms();
      const weeklyReport = await (aggregatorService as any).generateReport(
        watchTerms,
        168, // Last 7 days (168 hours)
        'detailed'
      );

      logger.info(
        `[SentimentTrendTask] Generated weekly trend analysis: ` +
          `${weeklyReport.overallMetrics.totalVolume} posts over 7 days`
      );

      // Generate trend insights
      const insights = generateTrendInsights(weeklyReport);

      // Store trend analysis
      await runtime.createMemory(
        {
          content: {
            text: `Weekly sentiment trend analysis completed`,
            sentiment_trends: weeklyReport,
            trend_insights: insights,
            type: 'trend_analysis',
          },
          roomId: runtime.agentId,
          entityId: runtime.agentId,
          agentId: runtime.agentId,
        },
        'messages'
      );

      // Update task metadata with last trend analysis time
      if (task?.id) {
        await runtime.updateTask(task.id, {
          metadata: {
            ...task.metadata,
            lastTrendTime: startTime,
          },
        });
      }

      logger.info('[SentimentTrendTask] Completed weekly trend analysis');
    } catch (error) {
      logger.error('[SentimentTrendTask] Error in trend analysis task:', error);
      throw error;
    }
  },
};

/**
 * Generate insights from trend data
 */
function generateTrendInsights(weeklyReport: any): any {
  const insights = {
    dominantNarratives: weeklyReport.narratives.slice(0, 3),
    sentimentTrend:
      weeklyReport.overallMetrics.sentimentChange > 0.1
        ? 'improving'
        : weeklyReport.overallMetrics.sentimentChange < -0.1
          ? 'declining'
          : 'stable',
    volumeTrend:
      weeklyReport.overallMetrics.volumeChange > 20
        ? 'increasing'
        : weeklyReport.overallMetrics.volumeChange < -20
          ? 'decreasing'
          : 'stable',
    keyEntities: weeklyReport.breakdowns.flatMap((b: any) => b.topEntities.slice(0, 2)),
    alertSummary: {
      total: weeklyReport.alerts.length,
      highSeverity: weeklyReport.alerts.filter((a: any) => a.severity === 'high').length,
      mediumSeverity: weeklyReport.alerts.filter((a: any) => a.severity === 'medium').length,
    },
  };

  return insights;
}

/**
 * Ranked tweet with importance score for display
 */
interface RankedTweet {
  tweet: SocialMediaPost;
  sentiment: ProcessedSentiment;
  importanceScore: number;
  engagementScore: number;
}

/**
 * Get top positive and negative tweets from the last 24 hours
 */
async function getTopSentimentTweets(
  runtime: IAgentRuntime,
  timeRangeHours: number = 24
): Promise<{ positiveTweets: RankedTweet[]; negativeTweets: RankedTweet[] }> {
  try {
    const persistenceService = runtime.getService(
      'sentiment-persistence'
    ) as SentimentPersistenceService;

    if (!persistenceService) {
      logger.warn('[SentimentTask] Sentiment persistence service not available for top tweets');
      return { positiveTweets: [], negativeTweets: [] };
    }

    const timeRange = timeRangeHours * 60 * 60 * 1000; // Convert to milliseconds
    const endTime = Date.now();
    const startTime = endTime - timeRange;

    // Get sentiment data from the specified time range
    const sentimentResults = await persistenceService.getSentimentAnalysisByTimeRange(
      startTime,
      endTime
    );

    if (sentimentResults.length === 0) {
      logger.debug('[SentimentTask] No sentiment data available for top tweets');
      return { positiveTweets: [], negativeTweets: [] };
    }

    // Get corresponding tweets
    const tweets = await persistenceService.getTweetsByTimeRange(startTime, endTime);
    const tweetMap = new Map<string, SocialMediaPost>();
    for (const tweet of tweets) {
      tweetMap.set(tweet.id, tweet);
    }

    // Create ranked tweets combining sentiment and tweet data
    // Use Map to deduplicate tweets by ID (same tweet may have multiple sentiment entries for different keywords)
    const tweetRankingMap = new Map<string, RankedTweet>();

    for (const sentiment of sentimentResults) {
      const tweet = tweetMap.get(sentiment.postId);
      if (!tweet) continue;

      // Check if we already processed this tweet
      const existingRanking = tweetRankingMap.get(tweet.id);
      if (existingRanking) {
        // Use the sentiment with higher magnitude for better ranking accuracy
        if (sentiment.sentiment.magnitude > existingRanking.sentiment.sentiment.magnitude) {
          // Calculate engagement score from metrics
          const engagementScore = calculateEngagementScore(tweet);

          // Calculate composite importance score
          const importanceScore = calculateImportanceScore(sentiment, engagementScore);

          tweetRankingMap.set(tweet.id, {
            tweet,
            sentiment,
            importanceScore,
            engagementScore,
          });
        }
      } else {
        // First time seeing this tweet, add it
        // Calculate engagement score from metrics
        const engagementScore = calculateEngagementScore(tweet);

        // Calculate composite importance score
        const importanceScore = calculateImportanceScore(sentiment, engagementScore);

        tweetRankingMap.set(tweet.id, {
          tweet,
          sentiment,
          importanceScore,
          engagementScore,
        });
      }
    }

    // Convert map to array for further processing
    const rankedTweets: RankedTweet[] = Array.from(tweetRankingMap.values());

    // Filter and rank positive tweets (score > 0.1, min author influence > 0.1)
    const positiveTweets = rankedTweets
      .filter(
        (rt) => rt.sentiment.sentiment.score > 0.1 && rt.sentiment.influence.authorInfluence > 0.1
      )
      .sort((a, b) => b.importanceScore - a.importanceScore)
      .slice(0, 3); // Top 3

    // Filter and rank negative tweets (score < -0.1, min author influence > 0.1)
    const negativeTweets = rankedTweets
      .filter(
        (rt) => rt.sentiment.sentiment.score < -0.1 && rt.sentiment.influence.authorInfluence > 0.1
      )
      .sort((a, b) => b.importanceScore - a.importanceScore)
      .slice(0, 3); // Top 3

    logger.debug(
      `[SentimentTask] Found ${positiveTweets.length} top positive and ${negativeTweets.length} top negative tweets`
    );

    return { positiveTweets, negativeTweets };
  } catch (error) {
    logger.error('[SentimentTask] Error getting top sentiment tweets:', error);
    return { positiveTweets: [], negativeTweets: [] };
  }
}

/**
 * Calculate engagement score from tweet metrics
 */
function calculateEngagementScore(tweet: SocialMediaPost): number {
  const likes = tweet.metrics.likes || 0;
  const retweets = tweet.metrics.retweets || 0;
  const replies = tweet.metrics.replies || 0;
  const views = tweet.metrics.views || 0;

  // Weight different engagement types
  const weightedEngagement = likes * 1.0 + retweets * 2.0 + replies * 1.5 + views * 0.1;

  // Normalize to 0-1 scale using logarithmic scaling
  const normalized = Math.min(1.0, Math.log10(weightedEngagement + 1) / 4); // log10(10000) ≈ 4

  return normalized;
}

/**
 * Calculate composite importance score for ranking
 * Combines author influence (60%), sentiment magnitude (20%), and engagement (20%)
 */
function calculateImportanceScore(sentiment: ProcessedSentiment, engagementScore: number): number {
  const authorWeight = 0.6;
  const sentimentWeight = 0.2;
  const engagementWeight = 0.2;

  const authorInfluence = sentiment.influence.authorInfluence;
  const sentimentMagnitude = sentiment.sentiment.magnitude;

  const score =
    authorInfluence * authorWeight +
    sentimentMagnitude * sentimentWeight +
    engagementScore * engagementWeight;

  return Math.min(1.0, score);
}
