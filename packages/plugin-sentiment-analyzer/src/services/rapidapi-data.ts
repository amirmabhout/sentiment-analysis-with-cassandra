import { Service, type IAgentRuntime, logger } from '@elizaos/core';
import type { SocialMediaPost } from '../types.ts';

/**
 * RapidAPI-based data service for sentiment analysis
 * Fetches real Twitter data through RapidAPI Twitter v2 endpoint instead of MCP server
 * Uses twitter241.p.rapidapi.com for Latest tweets with enhanced user profiling
 */
export class RapidAPIDataService extends Service {
  static serviceType = 'rapidapi-data';
  capabilityDescription =
    'Fetches real Twitter data through RapidAPI for sentiment analysis with user profiling';

  private watchTerms: string[] = ['ai16z', 'elizaos'];
  private lastFetchTimestamp: number = 0;
  private processedTweetIds: Set<string> = new Set();
  private maxTweetsPerCycle = 20; // RapidAPI limit is 20
  private lastCursor: string | null = null;

  // RapidAPI configuration
  private rapidApiKey: string = '';
  private rapidApiHost: string = 'twitter241.p.rapidapi.com';
  private rapidApiAppName: string = '';

  constructor(runtime: IAgentRuntime) {
    super(runtime);
    this.loadConfiguration();
  }

  static async start(runtime: IAgentRuntime): Promise<RapidAPIDataService> {
    logger.info('🚀 Starting RapidAPI Data Service for Twitter data fetching');
    const service = new RapidAPIDataService(runtime);
    return service;
  }

  async stop(): Promise<void> {
    logger.info('🚀 Stopping RapidAPI Data Service');
    this.processedTweetIds.clear();
  }

  private loadConfiguration(): void {
    // Load RapidAPI credentials
    this.rapidApiKey =
      (this.runtime.getSetting('RAPIDAPI_API_KEY') as string) || process.env.RAPIDAPI_API_KEY || '';

    const rapidApiHost =
      (this.runtime.getSetting('RAPIDAPI_X_HOST') as string) || process.env.RAPIDAPI_X_HOST;
    if (rapidApiHost) {
      this.rapidApiHost = rapidApiHost;
    }

    this.rapidApiAppName =
      (this.runtime.getSetting('RAPIDAPI_APP_NAME') as string) ||
      process.env.RAPIDAPI_APP_NAME ||
      'default-application_11000772';

    if (!this.rapidApiKey) {
      logger.error('RapidAPI key not found in environment variables');
      throw new Error('RAPIDAPI_API_KEY is required');
    }

    // Load watch terms
    const envWatchTerms =
      (this.runtime.getSetting('SENTIMENT_WATCH_TERMS') as string) ||
      process.env.SENTIMENT_WATCH_TERMS;
    if (envWatchTerms) {
      try {
        this.watchTerms = envWatchTerms.split(',').map((term: string) => term.trim());
      } catch (error) {
        logger.warn('Failed to parse SENTIMENT_WATCH_TERMS, using defaults');
      }
    }

    // Load max tweets per cycle (fixed at 20 for RapidAPI)
    const maxTweets =
      (this.runtime.getSetting('TWITTER_MAX_TWEETS_PER_CYCLE') as string) ||
      process.env.TWITTER_MAX_TWEETS_PER_CYCLE;
    if (maxTweets) {
      const parsed = parseInt(maxTweets, 10);
      // RapidAPI has a fixed limit of 20, but we can respect user preference if lower
      this.maxTweetsPerCycle = Math.min(parsed || 20, 20);
    }

    logger.info(
      `RapidAPI Data Config - Watch terms: ${this.watchTerms.join(', ')}, Max tweets: ${this.maxTweetsPerCycle}, Host: ${this.rapidApiHost}`
    );

    // In development, start with a clean slate for better testing
    if (process.env.NODE_ENV === 'development') {
      logger.info('Development mode: Starting with cleared processed tweet cache');
      this.processedTweetIds.clear();
    }
  }

  /**
   * Fetch recent tweets using RapidAPI Twitter v2 search endpoint
   * Supports cursor-based pagination and enhanced user profiling
   */
  async fetchRecentTweets(sinceTimestamp?: number): Promise<SocialMediaPost[]> {
    const cutoffTimestamp = this.calculateCutoffTimestamp(sinceTimestamp);

    logger.info(
      `Fetching tweets since ${new Date(cutoffTimestamp).toISOString()} via RapidAPI (${process.env.NODE_ENV || 'production'} mode)`
    );

    try {
      const allPosts: SocialMediaPost[] = [];

      // Search for mentions of each watch term
      for (const term of this.watchTerms) {
        try {
          logger.info(`Searching for: ${term}`);

          const posts = await this.searchTwitterForTerm(term, cutoffTimestamp);
          allPosts.push(...posts);

          logger.info(`Found ${posts.length} posts for term: ${term}`);

          // Small delay to be respectful to the API
          await new Promise((resolve) => setTimeout(resolve, 2000));
        } catch (error) {
          logger.error(`Error searching for ${term}:`, error);
          // Continue with other terms even if one fails
        }
      }

      // Remove duplicates and limit total results
      const uniquePosts = this.deduplicatePosts(allPosts);
      const limitedPosts = uniquePosts.slice(0, this.maxTweetsPerCycle);

      // Update last fetch timestamp
      this.lastFetchTimestamp = Date.now();

      logger.info(`Fetched ${limitedPosts.length} unique tweets from RapidAPI`);
      return limitedPosts;
    } catch (error) {
      logger.error('Error fetching tweets from RapidAPI:', error);
      return [];
    }
  }

  /**
   * Calculate the cutoff timestamp based on environment and configuration
   * In development: Use relaxed time window to ensure tweets are available for testing
   * In production: Use proper incremental processing based on last processed timestamp
   */
  private calculateCutoffTimestamp(sinceTimestamp?: number): number {
    const isDevelopment = process.env.NODE_ENV === 'development';

    if (isDevelopment) {
      // Development: Use longer time window to ensure data availability for testing
      const devTimeWindow = parseInt(
        process.env.SENTIMENT_DEV_TIME_WINDOW || '216000000', // 60 hours default
        10
      );
      const cutoff = Date.now() - devTimeWindow;
      logger.debug(
        `Development mode: Using relaxed cutoff timestamp (${devTimeWindow / 1000 / 60 / 60} hours ago)`
      );
      return cutoff;
    }

    // Production: Use proper incremental processing
    const cutoff = sinceTimestamp || this.lastFetchTimestamp || Date.now() - 10 * 60 * 1000;
    logger.debug('Production mode: Using incremental processing cutoff timestamp');
    return cutoff;
  }

  /**
   * Search Twitter for a specific term using RapidAPI
   */
  private async searchTwitterForTerm(
    term: string,
    cutoffTimestamp: number
  ): Promise<SocialMediaPost[]> {
    const url = `https://${this.rapidApiHost}/search-v2`;

    const params = new URLSearchParams({
      type: 'Latest',
      count: this.maxTweetsPerCycle.toString(),
      query: term,
    });

    // Add cursor if we have one from previous request
    if (this.lastCursor) {
      params.append('cursor', this.lastCursor);
    }

    const headers = {
      'x-rapidapi-key': this.rapidApiKey,
      'x-rapidapi-host': this.rapidApiHost,
      'User-Agent': `${this.rapidApiAppName}/1.0`,
    };

    logger.debug(`Making RapidAPI request: ${url}?${params.toString()}`);

    const response = await fetch(`${url}?${params.toString()}`, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(
        `RapidAPI request failed: ${response.status} ${response.statusText} - ${errorText}`
      );
      throw new Error(`RapidAPI request failed: ${response.status}`);
    }

    const data = await response.json();
    logger.debug(
      `RapidAPI response received - hasCursor: ${!!data.cursor}, hasResult: ${!!data.result}, hasTimeline: ${!!data.result?.timeline}`
    );

    // Update cursor for next request
    if (data.cursor?.bottom) {
      this.lastCursor = data.cursor.bottom;
      logger.debug(`Updated cursor: ${this.lastCursor}`);
    }

    // Transform API response to SocialMediaPost format
    return this.transformTwitterAPIResponse(data, term, cutoffTimestamp);
  }

  /**
   * Transform Twitter API v2 response to SocialMediaPost format with enhanced user profiling
   */
  private transformTwitterAPIResponse(
    apiResponse: any,
    searchTerm: string,
    cutoffTimestamp: number
  ): SocialMediaPost[] {
    const posts: SocialMediaPost[] = [];

    try {
      logger.debug(`Processing Twitter API response for term: ${searchTerm}`);

      // Navigate through the complex Twitter API v2 structure
      const timeline = apiResponse.result?.timeline;
      if (!timeline || !timeline.instructions) {
        logger.warn('No timeline instructions found in API response');
        return posts;
      }

      // Find TimelineAddEntries instruction
      const addEntriesInstruction = timeline.instructions.find(
        (instruction: any) => instruction.type === 'TimelineAddEntries'
      );

      if (!addEntriesInstruction || !addEntriesInstruction.entries) {
        logger.warn('No TimelineAddEntries instruction found');
        return posts;
      }

      logger.info(
        `Processing ${addEntriesInstruction.entries.length} entries for term: ${searchTerm}`
      );

      // Track parsing statistics
      let processedCount = 0;
      let successfulCount = 0;
      let cursorEntries = 0;
      let nonTweetEntries = 0;

      // Process each timeline entry
      for (const entry of addEntriesInstruction.entries) {
        try {
          processedCount++;

          // Skip cursor entries
          if (entry.entryId?.startsWith('cursor-')) {
            cursorEntries++;
            logger.debug(`Skipping cursor entry: ${entry.entryId}`);
            continue;
          }

          // Check if it's a tweet entry
          if (entry.content?.itemContent?.itemType === 'TimelineTweet') {
            logger.debug(`Processing TimelineTweet entry: ${entry.entryId}`);
            const post = this.transformTweetEntry(entry, searchTerm, cutoffTimestamp);
            if (post) {
              posts.push(post);
              successfulCount++;
              logger.debug(`✓ Successfully transformed tweet ${post.id}`);
            } else {
              logger.debug(`✗ Failed to transform tweet entry: ${entry.entryId}`);
            }
          } else {
            nonTweetEntries++;
            logger.debug(
              `Skipping non-tweet entry: ${entry.entryId}, type: ${entry.content?.itemContent?.itemType}`
            );
          }
        } catch (error) {
          logger.warn(`Failed to transform entry ${entry.entryId}:`, String(error));
        }
      }

      // Log transformation summary
      logger.info(
        `Transformation summary for ${searchTerm}: ` +
          `${successfulCount}/${processedCount} entries transformed. ` +
          `Skipped: ${cursorEntries} cursors, ${nonTweetEntries} non-tweets.`
      );
    } catch (error) {
      logger.error(`Error transforming Twitter API response for ${searchTerm}:`, String(error));
    }

    logger.info(`Transformed ${posts.length} posts for term: ${searchTerm}`);
    return posts;
  }

  /**
   * Transform a single tweet entry with enhanced user profiling and robust error handling
   */
  private transformTweetEntry(
    entry: any,
    searchTerm: string,
    cutoffTimestamp: number
  ): SocialMediaPost | null {
    try {
      logger.debug(`Processing tweet entry: ${entry.entryId}`);

      // Skip cursor entries
      if (entry.entryId?.startsWith('cursor-')) {
        logger.debug(`Skipping cursor entry: ${entry.entryId}`);
        return null;
      }

      const tweetData = entry.content?.itemContent?.tweet_results?.result;
      if (!tweetData) {
        logger.debug(`No tweet_results.result found for entry: ${entry.entryId}`);
        return null;
      }

      // Handle TweetWithVisibilityResults wrapper
      const tweet =
        tweetData?.__typename === 'TweetWithVisibilityResults' ? tweetData.tweet : tweetData;
      if (!tweet) {
        logger.debug(`No tweet data found after unwrapping for entry: ${entry.entryId}`);
        return null;
      }

      // Extract tweet ID with multiple fallbacks
      const tweetId = tweet.rest_id || tweet.id || entry.entryId?.replace('tweet-', '');
      if (!tweetId) {
        logger.debug(`No tweet ID found for entry: ${entry.entryId}`);
        return null;
      }

      // Extract tweet text with comprehensive fallbacks
      const text =
        tweet.legacy?.full_text ||
        tweet.full_text ||
        tweet.note_tweet?.note_tweet_results?.result?.text ||
        tweet.text ||
        tweet.legacy?.text ||
        '';

      if (!text || text.length === 0) {
        logger.debug(`No tweet text found for tweet: ${tweetId}`);
        return null;
      }

      // Extract timestamp with fallbacks
      const createdAt = tweet.legacy?.created_at || tweet.created_at;
      const timestamp = this.parseTwitterTimestamp(createdAt);

      if (!timestamp) {
        logger.debug(`No valid timestamp found for tweet: ${tweetId}, createdAt: ${createdAt}`);
        // Use current time as fallback instead of failing
      }

      // Skip if too old (only if we have a valid timestamp)
      if (timestamp && timestamp < cutoffTimestamp) {
        logger.info(
          `Tweet too old, skipping: ${tweetId}, tweet time: ${new Date(timestamp).toISOString()}, cutoff: ${new Date(cutoffTimestamp).toISOString()}`
        );
        return null;
      }

      // Skip if already processed
      if (this.processedTweetIds.has(tweetId)) {
        logger.info(
          `Tweet already processed, skipping: ${tweetId} (${this.processedTweetIds.size} total processed tweets in cache)`
        );
        return null;
      }

      // Extract user information with enhanced profiling and fallbacks
      const userResult = tweet.core?.user_results?.result;
      if (!userResult) {
        logger.debug(`No user data found for tweet: ${tweetId}`);
        // Don't fail - create minimal user data
      }

      // Extract user fields with comprehensive fallbacks
      const userId = userResult?.rest_id || userResult?.id || `user_${tweetId}`;

      const username =
        userResult?.core?.screen_name ||
        userResult?.legacy?.screen_name ||
        userResult?.screen_name ||
        `user_${userId}`;

      const displayName =
        userResult?.core?.name || userResult?.legacy?.name || userResult?.name || username;

      const userDescription = userResult?.legacy?.description || userResult?.description || '';

      // Enhanced user metrics for influence scoring with fallbacks
      const followerCount = userResult?.legacy?.followers_count || userResult?.followers_count || 0;

      const followingCount =
        userResult?.legacy?.friends_count ||
        userResult?.friends_count ||
        userResult?.following_count ||
        0;

      const isVerified =
        userResult?.legacy?.verified ||
        userResult?.is_blue_verified ||
        userResult?.verified ||
        false;

      const statusesCount =
        userResult?.legacy?.statuses_count ||
        userResult?.statuses_count ||
        userResult?.tweet_count ||
        0;

      // Extract engagement metrics with fallbacks
      const likes =
        tweet.legacy?.favorite_count ||
        tweet.favorite_count ||
        tweet.public_metrics?.like_count ||
        0;

      const retweets =
        tweet.legacy?.retweet_count ||
        tweet.retweet_count ||
        tweet.public_metrics?.retweet_count ||
        0;

      const replies =
        tweet.legacy?.reply_count || tweet.reply_count || tweet.public_metrics?.reply_count || 0;

      const views = tweet.views?.count
        ? parseInt(tweet.views.count)
        : tweet.public_metrics?.impression_count || 0;

      // Check for media with fallbacks
      const hasMedia = !!(
        tweet.legacy?.extended_entities?.media ||
        tweet.legacy?.entities?.media ||
        tweet.attachments?.media ||
        tweet.entities?.media
      );

      // Check if it's a retweet or reply with fallbacks
      const isRetweet = !!(
        tweet.legacy?.retweeted_status ||
        tweet.retweeted_status ||
        tweet.referenced_tweets?.some((ref: any) => ref.type === 'retweeted')
      );

      const isReply = !!(
        tweet.legacy?.in_reply_to_status_id_str ||
        tweet.in_reply_to_status_id ||
        tweet.referenced_tweets?.some((ref: any) => ref.type === 'replied_to')
      );

      // Build URL with fallback username
      const tweetUrl = `https://twitter.com/${username}/status/${tweetId}`;

      // Use current time if no timestamp available
      const finalTimestamp = timestamp || Date.now();

      logger.debug(
        `Successfully transformed tweet: ${tweetId}, text length: ${text.length}, user: ${username}`
      );

      const post: SocialMediaPost = {
        id: tweetId,
        platform: 'twitter',
        author: {
          id: userId,
          username: username,
          name: displayName,
          followerCount: followerCount,
          // Add additional user profiling data as metadata
          ...(userDescription && { description: userDescription }),
          ...(followingCount && { followingCount }),
          ...(isVerified && { verified: isVerified }),
          ...(statusesCount && { statusesCount }),
        },
        content: {
          text: text,
          url: tweetUrl,
          hasMedia: hasMedia,
          isRetweet: isRetweet,
          isReply: isReply,
        },
        metrics: {
          likes: likes,
          retweets: retweets,
          replies: replies,
          views: views,
        },
        timestamp: finalTimestamp,
        conversationId:
          tweet.legacy?.conversation_id_str || tweet.conversation_id || `conv_${tweetId}`,
        searchContext: searchTerm, // Keep for backward compatibility
        searchTerms: [searchTerm], // Initialize with the search term that found this post
        attributionSource: 'search', // This post was found via search
      };

      this.processedTweetIds.add(tweetId);
      logger.debug(`Tweet ${tweetId} processed successfully for term: ${searchTerm}`);
      return post;
    } catch (error) {
      logger.warn(`Error transforming tweet entry ${entry.entryId}:`, String(error));
      return null;
    }
  }

  /**
   * Parse Twitter timestamp format
   */
  private parseTwitterTimestamp(timestamp: string): number | null {
    if (!timestamp) return null;

    try {
      // Twitter format: "Mon Sep 08 08:59:55 +0000 2025"
      const date = new Date(timestamp);
      return date.getTime();
    } catch (error) {
      logger.debug('Failed to parse Twitter timestamp:', timestamp);
      return null;
    }
  }

  /**
   * Remove duplicate posts based on ID while merging attribution data
   * This handles cases where the same post is found by multiple search terms
   */
  private deduplicatePosts(posts: SocialMediaPost[]): SocialMediaPost[] {
    const postMap = new Map<string, SocialMediaPost>();

    for (const post of posts) {
      const existingPost = postMap.get(post.id);

      if (existingPost) {
        // Merge search terms and contexts from duplicate posts
        const mergedPost = this.mergePostAttributions(existingPost, post);
        postMap.set(post.id, mergedPost);

        logger.info(
          `[DEDUPLICATION] Merged attributions for post ${post.id}: ` +
            `${JSON.stringify(existingPost.searchTerms || [existingPost.searchContext])} + ` +
            `${JSON.stringify(post.searchTerms || [post.searchContext])} = ` +
            `${JSON.stringify(mergedPost.searchTerms)}`
        );
      } else {
        // First time seeing this post - ensure it has proper searchTerms array
        const initializedPost = {
          ...post,
          searchTerms: post.searchTerms || (post.searchContext ? [post.searchContext] : []),
          attributionSource: post.attributionSource || ('search' as const),
        };
        postMap.set(post.id, initializedPost);
      }
    }

    const deduplicated = Array.from(postMap.values());

    // Enhanced logging for deduplication results
    logger.info(
      `[DEDUPLICATION] Processed ${posts.length} posts → ${deduplicated.length} unique posts ` +
        `(${posts.length - deduplicated.length} duplicates merged)`
    );

    // Log attribution distribution after deduplication
    const attributionCounts = new Map<string, number>();
    for (const post of deduplicated) {
      for (const term of post.searchTerms || []) {
        attributionCounts.set(term, (attributionCounts.get(term) || 0) + 1);
      }
    }

    logger.info(
      `[DEDUPLICATION] Final attribution distribution: ` +
        `${Array.from(attributionCounts.entries())
          .map(([term, count]) => `${term}:${count}`)
          .join(', ')}`
    );

    return deduplicated;
  }

  /**
   * Merge attribution data from duplicate posts
   */
  private mergePostAttributions(
    existingPost: SocialMediaPost,
    newPost: SocialMediaPost
  ): SocialMediaPost {
    // Collect all search terms from both posts
    const existingTerms =
      existingPost.searchTerms || (existingPost.searchContext ? [existingPost.searchContext] : []);
    const newTerms = newPost.searchTerms || (newPost.searchContext ? [newPost.searchContext] : []);

    // Merge and deduplicate search terms
    const allTerms = [...existingTerms, ...newTerms];
    const uniqueTerms = [...new Set(allTerms.filter((term) => term && term.trim()))];

    // Keep the existing post as base, but update attribution data
    return {
      ...existingPost,
      searchTerms: uniqueTerms,
      attributionSource: 'search', // Multi-term posts are always from search
      // Keep the original searchContext for backward compatibility
      searchContext: existingPost.searchContext || newPost.searchContext,
    };
  }

  /**
   * Get current watch terms
   */
  getWatchTerms(): string[] {
    return [...this.watchTerms];
  }

  /**
   * Update watch terms
   */
  updateWatchTerms(terms: string[]): void {
    this.watchTerms = terms;
    logger.info(`Updated RapidAPI watch terms: ${terms.join(', ')}`);
  }

  /**
   * Clear processed tweet cache and cursor
   */
  clearProcessedTweets(): void {
    this.processedTweetIds.clear();
    this.lastFetchTimestamp = 0;
    this.lastCursor = null;
    logger.info('Cleared processed tweet cache and cursor');
  }

  /**
   * Check if RapidAPI is configured
   */
  isRapidAPIConfigured(): boolean {
    return !!(this.rapidApiKey && this.rapidApiHost);
  }

  /**
   * Get RapidAPI configuration status
   */
  getRapidAPIStatus(): { configured: boolean; host: string; hasKey: boolean } {
    return {
      configured: this.isRapidAPIConfigured(),
      host: this.rapidApiHost,
      hasKey: !!this.rapidApiKey,
    };
  }

  /**
   * Get statistics about recent RapidAPI data activity
   */
  async getTwitterStats(): Promise<{
    totalTweets: number;
    tweetsPerWatchTerm: Record<string, number>;
    avgEngagement: number;
    topAuthors: Array<{ username: string; posts: number }>;
    lastCursor: string | null;
  }> {
    return {
      totalTweets: this.processedTweetIds.size,
      tweetsPerWatchTerm: this.watchTerms.reduce(
        (acc, term) => {
          acc[term] = Math.floor(this.processedTweetIds.size / this.watchTerms.length);
          return acc;
        },
        {} as Record<string, number>
      ),
      avgEngagement: 25.5, // Would need to track actual engagement from fetched data
      topAuthors: [], // Would need to track actual authors from fetched data
      lastCursor: this.lastCursor,
    };
  }

  /**
   * Clear the processed tweets cache - useful for development and testing
   */
  clearProcessedCache(): void {
    const previousSize = this.processedTweetIds.size;
    this.processedTweetIds.clear();
    logger.info(`Cleared processed tweet cache (was ${previousSize} tweets)`);

    if (process.env.NODE_ENV === 'development') {
      logger.info('Development mode: Processed tweet cache cleared for fresh testing');
    }
  }
}
