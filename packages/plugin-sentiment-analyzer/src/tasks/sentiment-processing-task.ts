import { type IAgentRuntime, logger, type Task } from '@elizaos/core';
import type { SentimentTaskMetadata, ProcessedSentiment } from '../types.ts';
import type { TrafficAnalyzerService } from '../services/traffic-analyzer';
import type { DynamicSchedulerService } from '../services/dynamic-scheduler';

/**
 * Core Sentiment Processing Task
 * 
 * This task handles the continuous processing of social media posts:
 * - Fetches new tweets from Twitter API
 * - Analyzes sentiment using LLM models
 * - Stores results in the database
 * - Manages dynamic scheduling based on traffic patterns
 * 
 * Runs every 5 minutes (or dynamically adjusted interval)
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
          `[SentimentProcessing] Using dynamic interval: ${processingInterval / 60000} minutes`
        );
      } else {
        processingInterval = parseInt(
          (runtime.getSetting('SENTIMENT_PROCESSING_INTERVAL') as string) ||
            process.env.SENTIMENT_PROCESSING_INTERVAL ||
            '300000',
          10
        ); // Default 5 minutes
        logger.debug(
          `[SentimentProcessing] Using static interval: ${processingInterval / 60000} minutes`
        );
      }

      const timeSinceLastRun = startTime - (metadata.lastProcessedTimestamp || 0);

      if (timeSinceLastRun < processingInterval) {
        // Too early to run, skip silently
        return;
      }

      logger.info(
        `[SentimentProcessing] Starting processing cycle (${timeSinceLastRun / 1000 / 60} min since last run)`
      );

      // Get all required services
      const twitterDataService = runtime.getService('twitter-data');
      const sentimentService = runtime.getService('sentiment-analysis');
      const aggregatorService = runtime.getService('sentiment-aggregator');

      if (!sentimentService || !aggregatorService) {
        logger.error('[SentimentProcessing] Required sentiment services not available');
        return; // Don't throw error, just skip this cycle
      }

      // Check Twitter data service configuration
      if (!twitterDataService) {
        logger.error('[SentimentProcessing] Twitter Data Service not available');
        logger.error(
          '[SentimentProcessing] Please configure Twitter API credentials (see logs for options)'
        );
        return; // Skip this cycle if Twitter service not available
      }

      const configStatus = (twitterDataService as any).getConfigurationStatus();
      logger.info(
        `[SentimentProcessing] Using ${configStatus.provider} Twitter data provider (compliant: ${configStatus.isCompliant})`
      );

      logger.info(
        `[SentimentProcessing] Processing since ${new Date(metadata.lastProcessedTimestamp).toISOString()}`
      );

      // Step 1: Fetch new Twitter data for sentiment analysis
      const maxTweets = parseInt(
        (runtime.getSetting('TWITTER_MAX_TWEETS_PER_CYCLE') as string) ||
          process.env.TWITTER_MAX_TWEETS_PER_CYCLE ||
          '50',
        10
      );

      const tweets = await (twitterDataService as any).fetchRecentTweets(
        metadata.lastProcessedTimestamp
      );

      if (tweets.length === 0) {
        logger.debug('[SentimentProcessing] No new tweets found for processing');

        // Update metadata even when no tweets found
        const updatedMetadata: SentimentTaskMetadata = {
          lastProcessedTimestamp: Date.now(),
          watchTerms: metadata.watchTerms,
          processingStats: metadata.processingStats,
        };

        if (task?.id) {
          await runtime.updateTask(task.id, { metadata: updatedMetadata });
        }
        return;
      }

      logger.info(`[SentimentProcessing] Processing ${tweets.length} new tweets`);

      // Step 2: Analyze sentiment for each tweet
      const sentimentPromises = tweets.map(async (tweet) => {
        try {
          const sentiment = await (sentimentService as any).analyzeSentiment(tweet);
          return sentiment;
        } catch (error) {
          logger.error(`[SentimentProcessing] Error analyzing tweet ${tweet.id}:`, error);
          return null;
        }
      });

      const sentimentResults = await Promise.all(sentimentPromises);
      const relevantSentiments: ProcessedSentiment[] = sentimentResults.filter(
        (result): result is ProcessedSentiment => result !== null
      );

      if (relevantSentiments.length === 0) {
        logger.info('[SentimentProcessing] No relevant sentiments to process');
        return;
      }

      // Step 3: Store sentiment data (this will trigger aggregation)
      (aggregatorService as any).addSentimentData(relevantSentiments);

      logger.info(
        `[SentimentProcessing] Processed and stored ${relevantSentiments.length} sentiment records`
      );

      // Step 4: Calculate next interval if using dynamic scheduling
      let nextInterval = processingInterval; // Default to current interval
      if (dynamicScheduler && trafficAnalyzer) {
        const trafficAnalysis = trafficAnalyzer.analyzeTraffic();
        const schedulingDecision = dynamicScheduler.calculateNextInterval(trafficAnalysis);
        nextInterval = schedulingDecision.nextInterval;

        logger.info(
          `[SentimentProcessing] Dynamic scheduling: Next interval ${nextInterval / 60000} minutes ` +
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

      logger.info(`[SentimentProcessing] Completed processing cycle in ${processingTime}ms`);
      logger.info(
        `[SentimentProcessing] Stats - Total processed: ${updatedStats.postsProcessed}, ` +
          `Errors: ${updatedStats.errors}, Avg time: ${updatedStats.avgProcessingTime.toFixed(0)}ms`
      );
    } catch (error) {
      logger.error('[SentimentProcessing] Error in sentiment processing task:', error);

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
          logger.error('[SentimentProcessing] Failed to update error count:', updateError);
        }
      }

      throw error; // Re-throw to let the task system handle it
    }
  },
};