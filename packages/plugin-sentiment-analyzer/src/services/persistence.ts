import { Service, type IAgentRuntime, logger, asUUID, ModelType } from '@elizaos/core';
import type { UUID, Memory } from '@elizaos/core';
import { v4 } from 'uuid';
import type { SocialMediaPost, ProcessedSentiment, SentimentReport } from '../types.ts';

/**
 * SentimentPersistenceService handles persistent storage of sentiment analysis data
 * Uses ElizaOS standard memory table with proper content structure for compatibility
 */
export class SentimentPersistenceService extends Service {
  static serviceType = 'sentiment-persistence';
  capabilityDescription = 'Provides persistent storage and retrieval for sentiment analysis data';

  constructor(runtime: IAgentRuntime) {
    super(runtime);
  }

  static async start(runtime: IAgentRuntime): Promise<SentimentPersistenceService> {
    logger.info('💾 Starting Sentiment Persistence Service');
    const service = new SentimentPersistenceService(runtime);
    return service;
  }

  async stop(): Promise<void> {
    logger.info('💾 Stopping Sentiment Persistence Service');
  }

  /**
   * Store a social media post with deduplication using ElizaOS standard memory table
   * Returns the memory ID if stored, null if duplicate
   */
  async storeTweet(tweet: SocialMediaPost): Promise<UUID | null> {
    logger.debug(`[PERSISTENCE] Checking for duplicate tweet ${tweet.id} from ${tweet.platform}`);

    try {
      // Check for existing tweet by searching memories with type filter
      const existing = await this.runtime.getMemories({
        tableName: 'tweets', // Use custom tweets table
        roomId: this.runtime.agentId,
        count: 100,
      });

      // Filter by tweetId in metadata since ElizaOS doesn't support direct metadata queries yet
      const duplicateExists = existing.some((memory) => {
        try {
          const metadata =
            typeof memory.metadata === 'string'
              ? JSON.parse(memory.metadata)
              : memory.metadata || {};
          return (
            metadata.type === 'tweet' &&
            metadata.tweetId === tweet.id &&
            metadata.platform === tweet.platform
          );
        } catch {
          return false;
        }
      });

      if (duplicateExists) {
        logger.debug(`[PERSISTENCE] Tweet ${tweet.id} already exists, skipping storage`);
        return null;
      }

      // Store new tweet following ElizaOS pattern (like bootstrap plugin)
      const tweetMemory = {
        id: asUUID(v4()),
        entityId: this.runtime.agentId,
        agentId: this.runtime.agentId,
        content: {
          text: tweet.content.text, // Main text for embedding generation
          tweet, // Full tweet data for retrieval
        },
        roomId: this.runtime.agentId,
        createdAt: tweet.timestamp,
      };

      // Create memory first and capture the returned ID
      const createdMemoryId = await this.runtime.createMemory(tweetMemory, 'tweets', true);

      // Update the memory object with the actual ID from the database (following bootstrap pattern)
      const createdMemory = {
        ...tweetMemory,
        id: createdMemoryId,
        metadata: JSON.stringify({
          type: 'tweet',
          platform: tweet.platform,
          tweetId: tweet.id,
          authorUsername: tweet.author.username,
          searchTerms: tweet.searchTerms?.join(',') || '',
          collectedAt: Date.now(),
          hasMedia: tweet.content.hasMedia,
          isRetweet: tweet.content.isRetweet || false,
          isReply: tweet.content.isReply || false,
        }),
      };

      // Queue embedding generation asynchronously with correct memory object (following bootstrap pattern line 263)
      await this.runtime.queueEmbeddingGeneration(createdMemory, 'low');

      logger.info(`[PERSISTENCE] Stored tweet ${tweet.id} with memory ID ${createdMemoryId}`);
      return createdMemoryId;
    } catch (error) {
      logger.error(`[PERSISTENCE] Error storing tweet ${tweet.id}:`, error);
      return null;
    }
  }

  /**
   * Store processed sentiment analysis with reference to original tweet
   */
  async storeSentimentAnalysis(
    analysis: ProcessedSentiment,
    tweetMemoryId?: UUID | null
  ): Promise<UUID | null> {
    logger.debug(`[PERSISTENCE] Storing sentiment analysis for post ${analysis.postId}`);

    try {
      const sentimentMemory = {
        id: asUUID(v4()),
        entityId: this.runtime.agentId,
        agentId: this.runtime.agentId,
        content: {
          text: `Sentiment analysis for ${analysis.platform} post: ${analysis.sentiment.label} (${analysis.sentiment.score}) - Topics: ${analysis.topics.join(', ')}`, // Main text for embedding generation
          sentiment_analysis: analysis, // Full analysis data for retrieval
        },
        roomId: this.runtime.agentId,
        createdAt: analysis.processedAt,
      };

      // Create memory first and capture the returned ID
      const createdMemoryId = await this.runtime.createMemory(
        sentimentMemory,
        'sentiment_analysis',
        true
      );

      // Update the memory object with the actual ID from the database (following bootstrap pattern)
      const createdMemory = {
        ...sentimentMemory,
        id: createdMemoryId,
        metadata: JSON.stringify({
          type: 'sentiment_analysis',
          tweetId: analysis.postId,
          tweetMemoryId: tweetMemoryId || null,
          platform: analysis.platform,
          sentimentScore: analysis.sentiment.score,
          watchTerms: analysis.watchTermsFound.join(','),
          entityCount: analysis.entities.length,
          topicCount: analysis.topics.length,
          authorInfluence: analysis.influence.authorInfluence,
          viralityPotential: analysis.influence.viralityPotential,
        }),
      };

      // Queue embedding generation asynchronously with correct memory object (following bootstrap pattern)
      await this.runtime.queueEmbeddingGeneration(createdMemory, 'low');

      logger.info(
        `[PERSISTENCE] Stored sentiment analysis ${analysis.postId} with memory ID ${createdMemoryId}`
      );
      return createdMemoryId;
    } catch (error) {
      logger.error(`[PERSISTENCE] Error storing sentiment analysis ${analysis.postId}:`, error);
      return null;
    }
  }

  /**
   * Store sentiment report for historical tracking
   */
  async storeReport(report: SentimentReport): Promise<UUID | null> {
    logger.debug(`[PERSISTENCE] Storing sentiment report ${report.id}`);

    try {
      const reportMemory = {
        id: asUUID(v4()),
        entityId: this.runtime.agentId,
        agentId: this.runtime.agentId,
        content: {
          text: `Sentiment report ${report.reportType}: ${report.overallMetrics.totalVolume} posts, avg sentiment ${report.overallMetrics.averageSentiment.label} (${report.overallMetrics.averageSentiment.score}), watch terms: ${report.watchTerms.join(', ')}`, // Main text for embedding generation
          sentiment_report: report, // Full report data for retrieval
        },
        roomId: this.runtime.agentId,
        createdAt: report.generatedAt,
      };

      // Create memory first and capture the returned ID
      const createdMemoryId = await this.runtime.createMemory(
        reportMemory,
        'sentiment_reports',
        true
      );

      // Update the memory object with the actual ID from the database (following bootstrap pattern)
      const createdMemory = {
        ...reportMemory,
        id: createdMemoryId,
        metadata: JSON.stringify({
          type: 'sentiment_report',
          reportId: report.id,
          reportType: report.reportType,
          timeframeHours: Math.round(
            (report.timeframe.end - report.timeframe.start) / (60 * 60 * 1000)
          ),
          totalPosts: report.overallMetrics.totalVolume,
          alertCount: report.alerts.length,
          watchTerms: report.watchTerms.join(','),
          averageSentiment: report.overallMetrics.averageSentiment.score,
        }),
      };

      // Queue embedding generation asynchronously with correct memory object (following bootstrap pattern)
      await this.runtime.queueEmbeddingGeneration(createdMemory, 'low');

      logger.info(`[PERSISTENCE] Stored report ${report.id} with memory ID ${createdMemoryId}`);
      return createdMemoryId;
    } catch (error) {
      logger.error(`[PERSISTENCE] Error storing report ${report.id}:`, error);
      return null;
    }
  }

  /**
   * Get tweets by time range with optional watch term filtering
   */
  async getTweetsByTimeRange(
    startTime: number,
    endTime: number,
    watchTerms?: string[]
  ): Promise<SocialMediaPost[]> {
    logger.debug(
      `[PERSISTENCE] Querying tweets from ${new Date(startTime).toISOString()} to ${new Date(endTime).toISOString()}`
    );

    try {
      let memories: Memory[];

      if (watchTerms && watchTerms.length > 0) {
        // Use vector search for watch terms
        const searchText = `social media post about ${watchTerms.join(' ')}`;
        const embedding = (await this.runtime.useModel(ModelType.TEXT_EMBEDDING, {
          text: searchText,
        })) as number[];

        memories = await this.runtime.searchMemories({
          tableName: 'tweets',
          embedding: embedding,
          match_threshold: 0.3,
          count: 1000,
        });

        // Filter by time range since ElizaOS doesn't support time filtering in searchMemories yet
        memories = memories.filter((m) => m.createdAt >= startTime && m.createdAt <= endTime);
      } else {
        // Get all tweets in time range
        memories = await this.runtime.getMemories({
          tableName: 'tweets',
          agentId: this.runtime.agentId,
          count: 1000,
        });

        // Filter by time range
        memories = memories.filter((m) => m.createdAt >= startTime && m.createdAt <= endTime);
      }

      const tweets = memories
        .map((memory) => {
          try {
            const content =
              typeof memory.content === 'string' ? JSON.parse(memory.content) : memory.content;
            return content.tweet as SocialMediaPost;
          } catch (error) {
            logger.warn(`[PERSISTENCE] Failed to parse tweet memory ${memory.id}:`, error);
            return null;
          }
        })
        .filter(Boolean) as SocialMediaPost[];

      logger.info(`[PERSISTENCE] Retrieved ${tweets.length} tweets for time range`);
      return tweets;
    } catch (error) {
      logger.error('[PERSISTENCE] Error retrieving tweets by time range:', error);
      return [];
    }
  }

  /**
   * Get sentiment analysis results by time range with optional watch term filtering
   */
  async getSentimentAnalysisByTimeRange(
    startTime: number,
    endTime: number,
    watchTerms?: string[]
  ): Promise<ProcessedSentiment[]> {
    logger.debug(
      `[PERSISTENCE] Querying sentiment analysis from ${new Date(startTime).toISOString()} to ${new Date(endTime).toISOString()}`
    );

    try {
      let memories = await this.runtime.getMemories({
        tableName: 'sentiment_analysis',
        agentId: this.runtime.agentId,
        count: 10000, // Large limit for sentiment data
      });

      // Filter by time range
      memories = memories.filter((m) => m.createdAt >= startTime && m.createdAt <= endTime);

      let sentimentResults = memories
        .map((memory) => {
          try {
            const content =
              typeof memory.content === 'string' ? JSON.parse(memory.content) : memory.content;
            return content.sentiment_analysis as ProcessedSentiment;
          } catch (error) {
            logger.warn(`[PERSISTENCE] Failed to parse sentiment memory ${memory.id}:`, error);
            return null;
          }
        })
        .filter(Boolean) as ProcessedSentiment[];

      // Filter by watch terms if specified
      if (watchTerms && watchTerms.length > 0) {
        sentimentResults = sentimentResults.filter((result) =>
          result.watchTermsFound.some((term) =>
            watchTerms.some((watchTerm) => term.toLowerCase().includes(watchTerm.toLowerCase()))
          )
        );
      }

      logger.info(`[PERSISTENCE] Retrieved ${sentimentResults.length} sentiment analysis results`);
      return sentimentResults;
    } catch (error) {
      logger.error('[PERSISTENCE] Error retrieving sentiment analysis by time range:', error);
      return [];
    }
  }

  /**
   * Search for similar tweets using vector similarity
   */
  async searchSimilarTweets(
    queryText: string,
    limit: number = 10,
    minSimilarity: number = 0.7
  ): Promise<SocialMediaPost[]> {
    logger.debug(`[PERSISTENCE] Searching for tweets similar to: "${queryText}"`);

    try {
      const embedding = (await this.runtime.useModel(ModelType.TEXT_EMBEDDING, {
        text: queryText,
      })) as number[];

      const memories = await this.runtime.searchMemories({
        tableName: 'tweets',
        embedding: embedding,
        match_threshold: minSimilarity,
        count: limit,
      });

      const tweets = memories
        .map((memory) => {
          try {
            const content =
              typeof memory.content === 'string' ? JSON.parse(memory.content) : memory.content;
            return content.tweet as SocialMediaPost;
          } catch (error) {
            logger.warn(`[PERSISTENCE] Failed to parse tweet memory ${memory.id}:`, error);
            return null;
          }
        })
        .filter(Boolean) as SocialMediaPost[];

      logger.info(`[PERSISTENCE] Found ${tweets.length} similar tweets`);
      return tweets;
    } catch (error) {
      logger.error('[PERSISTENCE] Error searching similar tweets:', error);
      return [];
    }
  }

  /**
   * Search sentiment analysis by topic or theme
   */
  async searchSentimentByTopic(
    topic: string,
    limit: number = 50,
    minSimilarity: number = 0.6
  ): Promise<ProcessedSentiment[]> {
    logger.debug(`[PERSISTENCE] Searching sentiment analysis for topic: "${topic}"`);

    try {
      const embedding = (await this.runtime.useModel(ModelType.TEXT_EMBEDDING, {
        text: `sentiment analysis about ${topic}`,
      })) as number[];

      const memories = await this.runtime.searchMemories({
        tableName: 'sentiment_analysis',
        embedding: embedding,
        match_threshold: minSimilarity,
        count: limit,
      });

      const sentimentResults = memories
        .map((memory) => {
          try {
            const content =
              typeof memory.content === 'string' ? JSON.parse(memory.content) : memory.content;
            return content.sentiment_analysis as ProcessedSentiment;
          } catch (error) {
            logger.warn(`[PERSISTENCE] Failed to parse sentiment memory ${memory.id}:`, error);
            return null;
          }
        })
        .filter(Boolean) as ProcessedSentiment[];

      logger.info(`[PERSISTENCE] Found ${sentimentResults.length} sentiment analyses for topic`);
      return sentimentResults;
    } catch (error) {
      logger.error('[PERSISTENCE] Error searching sentiment by topic:', error);
      return [];
    }
  }

  /**
   * Get storage statistics for monitoring
   */
  async getStorageStats(): Promise<{
    totalTweets: number;
    totalSentimentAnalyses: number;
    totalReports: number;
    oldestTweet?: Date;
    newestTweet?: Date;
  }> {
    try {
      const tweetMemories = await this.runtime.getMemories({
        tableName: 'tweets',
        agentId: this.runtime.agentId,
        count: 10000,
      });

      const sentimentMemories = await this.runtime.getMemories({
        tableName: 'sentiment_analysis',
        agentId: this.runtime.agentId,
        count: 10000,
      });

      const reportMemories = await this.runtime.getMemories({
        tableName: 'sentiment_reports',
        agentId: this.runtime.agentId,
        count: 1000,
      });

      const tweetTimes = tweetMemories.map((m) => m.createdAt).sort((a, b) => a - b);

      return {
        totalTweets: tweetMemories.length,
        totalSentimentAnalyses: sentimentMemories.length,
        totalReports: reportMemories.length,
        oldestTweet: tweetTimes.length > 0 ? new Date(tweetTimes[0]) : undefined,
        newestTweet:
          tweetTimes.length > 0 ? new Date(tweetTimes[tweetTimes.length - 1]) : undefined,
      };
    } catch (error) {
      logger.error('[PERSISTENCE] Error getting storage stats:', error);
      return {
        totalTweets: 0,
        totalSentimentAnalyses: 0,
        totalReports: 0,
      };
    }
  }

  /**
   * Clean up old data beyond retention period
   */
  async cleanupOldData(retentionDays: number = 30): Promise<void> {
    const cutoffTime = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    logger.info(
      `[PERSISTENCE] Starting cleanup of data older than ${retentionDays} days (before ${new Date(cutoffTime).toISOString()})`
    );

    try {
      // Note: ElizaOS doesn't currently provide a direct way to delete memories by age
      // This would need to be implemented at the runtime level
      // For now, we'll log what would be cleaned up

      const oldTweets = await this.runtime.getMemories({
        tableName: 'tweets',
        agentId: this.runtime.agentId,
        count: 10000,
      });

      const tweetsToDelete = oldTweets.filter((m) => m.createdAt < cutoffTime);

      logger.info(
        `[PERSISTENCE] Found ${tweetsToDelete.length} tweets older than retention period`
      );
      logger.warn('[PERSISTENCE] Memory cleanup not yet implemented in ElizaOS runtime');
    } catch (error) {
      logger.error('[PERSISTENCE] Error during cleanup:', error);
    }
  }
}
