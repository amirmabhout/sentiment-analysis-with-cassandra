import { type Action, type ActionResult, type IAgentRuntime, logger } from '@elizaos/core';

/**
 * Action to manually trigger sentiment processing
 * Useful for immediate processing without waiting for intervals
 */
export const processSentimentAction: Action = {
  name: 'PROCESS_SENTIMENT',
  description: 'Manually trigger sentiment analysis processing cycle',

  validate: async (runtime: IAgentRuntime, message: any): Promise<boolean> => {
    const text = message.content?.text?.toLowerCase() || '';

    // Check for various trigger phrases, including underscore/dash variations
    const triggers = [
      'process sentiment',
      'process_sentiment',
      'analyze sentiment',
      'analyze_sentiment',
      'run sentiment',
      'run_sentiment',
      'sentiment now',
      'start sentiment',
      'fetch sentiment',
      'update sentiment',
    ];

    return triggers.some((trigger) => text.includes(trigger));
  },

  handler: async (
    runtime: IAgentRuntime,
    message: any,
    state: any,
    options: any,
    callback: any
  ): Promise<ActionResult> => {
    logger.info('[PROCESS_SENTIMENT] Manual sentiment processing triggered');

    try {
      // Get all required services
      const rapidApiDataService = runtime.getService('rapidapi-data');
      const sentimentService = runtime.getService('sentiment-analysis');
      const aggregatorService = runtime.getService('sentiment-aggregator');

      // Validate services
      if (!sentimentService || !aggregatorService) {
        const error = 'Required sentiment services not available';
        logger.error(`[PROCESS_SENTIMENT] ${error}`);

        await callback({
          text: `❌ Cannot process sentiment: ${error}`,
          action: 'PROCESS_SENTIMENT',
        });

        return {
          success: false,
          error: new Error(error),
        };
      }

      if (!rapidApiDataService || !(rapidApiDataService as any).isRapidAPIConfigured()) {
        const error = 'RapidAPI service not configured';
        logger.error(`[PROCESS_SENTIMENT] ${error}`);

        await callback({
          text: `❌ Cannot process sentiment: ${error}. Please ensure RAPIDAPI_API_KEY and RAPIDAPI_X_HOST are set.`,
          action: 'PROCESS_SENTIMENT',
        });

        return {
          success: false,
          error: new Error(error),
        };
      }

      // Notify user that processing is starting
      await callback({
        text: '🔄 Starting sentiment analysis processing...',
        action: 'PROCESS_SENTIMENT',
      });

      // Step 1: Fetch recent social media posts
      const startTime = Date.now();
      logger.info(`[PROCESS_SENTIMENT] Starting data fetch phase...`);
      const posts = await (rapidApiDataService as any).fetchRecentTweets(
        Date.now() - 10 * 60 * 1000
      );
      logger.info(`[PROCESS_SENTIMENT] Fetch phase complete: ${posts.length} posts from RapidAPI`);

      // Log post attribution distribution after fetch
      if (posts.length > 0) {
        const fetchAttributionCounts = new Map<string, number>();
        let postsWithMultipleSearchTerms = 0;

        for (const post of posts) {
          const terms = post.searchTerms || (post.searchContext ? [post.searchContext] : []);
          if (terms.length > 1) postsWithMultipleSearchTerms++;

          for (const term of terms) {
            fetchAttributionCounts.set(term, (fetchAttributionCounts.get(term) || 0) + 1);
          }
        }

        logger.info(
          `[PROCESS_SENTIMENT] Post fetch attribution: ${Array.from(
            fetchAttributionCounts.entries()
          )
            .map(([term, count]) => `${term}:${count}`)
            .join(', ')}`
        );
        logger.info(
          `[PROCESS_SENTIMENT] Posts with multiple search terms: ${postsWithMultipleSearchTerms}/${posts.length}`
        );
      }

      if (posts.length === 0) {
        await callback({
          text: '📊 No new posts found to process.',
          action: 'PROCESS_SENTIMENT',
        });

        return {
          success: true,
          text: 'No posts to process',
          values: { postsProcessed: 0 },
        };
      }

      // Step 2: Analyze sentiment
      logger.info(`[PROCESS_SENTIMENT] Starting sentiment analysis phase...`);
      const processedSentiments = await (sentimentService as any).analyzeBatch(posts);
      logger.info(
        `[PROCESS_SENTIMENT] Sentiment analysis phase complete: ${processedSentiments.length} posts analyzed`
      );

      // Filter relevant sentiments
      const relevantSentiments = processedSentiments.filter(
        (sentiment: any) => sentiment.watchTermsFound.length > 0
      );

      if (relevantSentiments.length === 0) {
        await callback({
          text: `📊 Processed ${posts.length} posts but none contained watch terms.`,
          action: 'PROCESS_SENTIMENT',
        });

        return {
          success: true,
          text: 'No relevant posts found',
          values: {
            postsProcessed: posts.length,
            relevantPosts: 0,
          },
        };
      }

      // Step 3: Add to aggregator
      (aggregatorService as any).addSentimentData(relevantSentiments);

      // Step 4: Generate summary
      const watchTerms = (sentimentService as any).getWatchTerms();
      const report = await (aggregatorService as any).generateReport(watchTerms, 1, 'summary');

      const processingTime = Date.now() - startTime;

      // Enhanced final statistics
      const termCounts = new Map<string, number>();
      let multiAttributedSentiments = 0;
      const totalAttributions = relevantSentiments.reduce((total: number, sentiment: any) => {
        if (sentiment.watchTermsFound.length > 1) {
          multiAttributedSentiments++;
        }
        sentiment.watchTermsFound.forEach((term: string) => {
          termCounts.set(term, (termCounts.get(term) || 0) + 1);
        });
        return total + sentiment.watchTermsFound.length;
      }, 0);

      const termSummary = Array.from(termCounts.entries())
        .map(([term, count]) => `${term}: ${count}`)
        .join(', ');

      logger.info(`[PROCESS_SENTIMENT] Final attribution statistics:`);
      logger.info(
        `[PROCESS_SENTIMENT] - Posts with multiple attributions: ${multiAttributedSentiments}/${relevantSentiments.length}`
      );
      logger.info(
        `[PROCESS_SENTIMENT] - Total attributions: ${totalAttributions} (${(totalAttributions / relevantSentiments.length).toFixed(2)} avg per post)`
      );
      logger.info(`[PROCESS_SENTIMENT] - Term breakdown: ${termSummary}`);

      // Send success message
      await callback({
        text:
          `✅ Sentiment processing completed!\n` +
          `📊 Processed ${posts.length} posts, found ${relevantSentiments.length} relevant\n` +
          `🏷️ Watch terms: ${termSummary}\n` +
          `💭 Overall sentiment: ${report.overallMetrics.averageSentiment.score.toFixed(3)}\n` +
          `⏱️ Processing time: ${(processingTime / 1000).toFixed(1)}s`,
        action: 'PROCESS_SENTIMENT',
      });

      logger.info(
        `[PROCESS_SENTIMENT] Completed: ${relevantSentiments.length} relevant posts, ` +
          `sentiment: ${report.overallMetrics.averageSentiment.score.toFixed(3)}, ` +
          `time: ${processingTime}ms`
      );

      return {
        success: true,
        text: 'Sentiment processing completed successfully',
        values: {
          postsProcessed: posts.length,
          relevantPosts: relevantSentiments.length,
          overallSentiment: report.overallMetrics.averageSentiment.score,
          processingTime,
          termBreakdown: Object.fromEntries(termCounts),
        },
        data: {
          actionName: 'PROCESS_SENTIMENT',
          report,
        },
      };
    } catch (error) {
      logger.error('[PROCESS_SENTIMENT] Error during processing:', error);

      await callback({
        text: `❌ Error during sentiment processing: ${error instanceof Error ? error.message : String(error)}`,
        action: 'PROCESS_SENTIMENT',
        error: true,
      });

      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  },
};
