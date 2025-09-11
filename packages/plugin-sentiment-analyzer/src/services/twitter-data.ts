import { Service, type IAgentRuntime, logger } from '@elizaos/core';
import type { SocialMediaPost } from '../types.ts';
import type { FetchStatistics } from './traffic-analyzer';

/**
 * Unified Twitter Data Service that intelligently chooses between official and third-party APIs
 * 
 * This service provides legal compliance by preferring official Twitter API when available,
 * while falling back to RapidAPI for educational/research purposes when explicitly configured.
 * 
 * Environment Variable Priority:
 * 1. If TWITTER_BEARER_TOKEN is set -> Use Official Twitter API v2
 * 2. If RAPIDAPI_API_KEY is set -> Use RapidAPI (with legal warnings)
 * 3. If neither -> Fail with clear instructions
 */
export class TwitterDataService extends Service {
  static serviceType = 'twitter-data';
  capabilityDescription = 'Unified Twitter data service supporting both official API and third-party services';

  private dataProvider: 'official' | 'rapidapi' | null = null;
  private watchTerms: string[] = ['ai16z', 'elizaos'];
  private lastFetchTimestamp: number = 0;
  private processedTweetIds: Set<string> = new Set();
  private maxTweetsPerCycle = 50;
  private lastFetchStats?: FetchStatistics;

  // Official Twitter API configuration
  private twitterBearerToken: string = '';
  private twitterApiKey: string = '';
  private twitterApiSecretKey: string = '';

  // RapidAPI configuration (fallback)
  private rapidApiKey: string = '';
  private rapidApiHost: string = 'twitter241.p.rapidapi.com';
  private rapidApiAppName: string = '';
  private lastCursor: string | null = null;

  constructor(runtime: IAgentRuntime) {
    super(runtime);
    this.loadConfiguration();
  }

  static async start(runtime: IAgentRuntime): Promise<TwitterDataService> {
    logger.info('🚀 Starting Unified Twitter Data Service');
    const service = new TwitterDataService(runtime);
    return service;
  }

  async stop(): Promise<void> {
    logger.info('🚀 Stopping Unified Twitter Data Service');
    this.processedTweetIds.clear();
  }

  private loadConfiguration(): void {
    // Check for official Twitter API credentials first
    const runtimeTwitterBearerToken = this.runtime.getSetting('TWITTER_BEARER_TOKEN') as string;
    this.twitterBearerToken = 
      (runtimeTwitterBearerToken && runtimeTwitterBearerToken.trim()) ? runtimeTwitterBearerToken : 
      (process.env.TWITTER_BEARER_TOKEN || '');
    
    const runtimeTwitterApiKey = this.runtime.getSetting('TWITTER_API_KEY') as string;
    this.twitterApiKey = 
      (runtimeTwitterApiKey && runtimeTwitterApiKey.trim()) ? runtimeTwitterApiKey : 
      (process.env.TWITTER_API_KEY || '');
    
    const runtimeTwitterApiSecretKey = this.runtime.getSetting('TWITTER_API_SECRET_KEY') as string;
    this.twitterApiSecretKey = 
      (runtimeTwitterApiSecretKey && runtimeTwitterApiSecretKey.trim()) ? runtimeTwitterApiSecretKey : 
      (process.env.TWITTER_API_SECRET_KEY || '');

    // Check for RapidAPI credentials as fallback
    const runtimeRapidApiKey = this.runtime.getSetting('RAPIDAPI_API_KEY') as string;
    this.rapidApiKey =
      (runtimeRapidApiKey && runtimeRapidApiKey.trim()) ? runtimeRapidApiKey : 
      (process.env.RAPIDAPI_API_KEY || '');

    const runtimeRapidApiHost = this.runtime.getSetting('RAPIDAPI_X_HOST') as string;
    const rapidApiHost = 
      (runtimeRapidApiHost && runtimeRapidApiHost.trim()) ? runtimeRapidApiHost : 
      process.env.RAPIDAPI_X_HOST;
    if (rapidApiHost) {
      this.rapidApiHost = rapidApiHost;
    }

    const runtimeRapidApiAppName = this.runtime.getSetting('RAPIDAPI_APP_NAME') as string;
    this.rapidApiAppName =
      (runtimeRapidApiAppName && runtimeRapidApiAppName.trim()) ? runtimeRapidApiAppName :
      (process.env.RAPIDAPI_APP_NAME || 'default-application_11000772');

    // Determine which data provider to use
    if (this.twitterBearerToken || (this.twitterApiKey && this.twitterApiSecretKey)) {
      this.dataProvider = 'official';
      logger.info('✅ Official Twitter API credentials found - using official API (recommended for compliance)');
      logger.info('🔒 This configuration complies with Twitter Terms of Service');
    } else if (this.rapidApiKey) {
      this.dataProvider = 'rapidapi';
      logger.warn('⚠️  Using RapidAPI as fallback - LEGAL WARNING:');
      logger.warn('⚠️  Third-party Twitter services may violate Twitter Terms of Service');
      logger.warn('⚠️  Your Twitter account may be suspended');
      logger.warn('⚠️  This configuration is for educational/research purposes only');
      logger.warn('⚠️  Consider upgrading to official Twitter API for production use');
    } else {
      this.dataProvider = null;
      logger.error('❌ No Twitter API credentials found');
      logger.error('📋 To use official Twitter API (recommended):');
      logger.error('   Set TWITTER_BEARER_TOKEN or (TWITTER_API_KEY + TWITTER_API_SECRET_KEY)');
      logger.error('📋 To use RapidAPI (educational/research only):');
      logger.error('   Set RAPIDAPI_API_KEY and RAPIDAPI_X_HOST');
      logger.error('⚠️  WARNING: RapidAPI usage may violate Twitter Terms of Service');
      throw new Error('Twitter API credentials required - see logs for configuration options');
    }

    // Load common configuration
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

    const maxTweets =
      (this.runtime.getSetting('TWITTER_MAX_TWEETS_PER_CYCLE') as string) ||
      process.env.TWITTER_MAX_TWEETS_PER_CYCLE;
    if (maxTweets) {
      const parsed = parseInt(maxTweets, 10);
      // Official API can handle more, RapidAPI is limited to 20
      const maxAllowed = this.dataProvider === 'rapidapi' ? 20 : 100;
      this.maxTweetsPerCycle = Math.min(parsed || maxAllowed, maxAllowed);
    }

    logger.info(
      `Twitter Data Service Config - Provider: ${this.dataProvider}, Watch terms: ${this.watchTerms.join(', ')}, Max tweets: ${this.maxTweetsPerCycle}`
    );

    if (process.env.NODE_ENV === 'development') {
      logger.info('Development mode: Starting with cleared processed tweet cache');
      this.processedTweetIds.clear();
    }
  }

  /**
   * Get the last fetch statistics
   */
  getLastFetchStatistics(): FetchStatistics | undefined {
    return this.lastFetchStats;
  }

  /**
   * Fetch recent tweets using the configured provider
   */
  async fetchRecentTweets(sinceTimestamp?: number): Promise<SocialMediaPost[]> {
    if (!this.dataProvider) {
      logger.error('No Twitter data provider configured');
      return [];
    }

    const fetchStartTime = Date.now();
    const cutoffTimestamp = this.calculateCutoffTimestamp(sinceTimestamp);

    logger.info(
      `Fetching tweets since ${new Date(cutoffTimestamp).toISOString()} via ${this.dataProvider} API`
    );

    try {
      let allPosts: SocialMediaPost[] = [];
      
      if (this.dataProvider === 'official') {
        allPosts = await this.fetchViaOfficialAPI(cutoffTimestamp);
      } else if (this.dataProvider === 'rapidapi') {
        allPosts = await this.fetchViaRapidAPI(cutoffTimestamp);
      }

      // Common post-processing
      const totalFetched = allPosts.length;
      const uniquePosts = this.deduplicatePosts(allPosts);
      const limitedPosts = uniquePosts.slice(0, this.maxTweetsPerCycle);

      // Calculate statistics
      const duplicateCount = totalFetched - uniquePosts.length;
      const duplicateRatio = totalFetched > 0 ? duplicateCount / totalFetched : 0;

      let oldestTweetTime: number | undefined;
      let newestTweetTime: number | undefined;
      if (limitedPosts.length > 0) {
        const timestamps = limitedPosts.map((p) => p.timestamp).filter((t) => t);
        if (timestamps.length > 0) {
          oldestTweetTime = Math.min(...timestamps);
          newestTweetTime = Math.max(...timestamps);
        }
      }

      // Create fetch statistics
      this.lastFetchStats = {
        timestamp: Date.now(),
        fetchedCount: totalFetched,
        uniqueCount: uniquePosts.length,
        duplicateCount,
        duplicateRatio,
        oldestTweetTime,
        newestTweetTime,
        processingTimeMs: Date.now() - fetchStartTime,
        watchTermsFound: this.watchTerms.reduce((acc, term) => {
          acc[term] = limitedPosts.filter(post => 
            post.searchTerms?.includes(term) || post.searchContext === term
          ).length;
          return acc;
        }, {} as Record<string, number>),
        cursorUsed: this.dataProvider === 'rapidapi' && this.lastCursor !== null,
      };

      this.lastFetchTimestamp = Date.now();

      logger.info(
        `Fetched ${limitedPosts.length} unique tweets via ${this.dataProvider} ` +
        `(${totalFetched} total, ${duplicateCount} duplicates, ${(duplicateRatio * 100).toFixed(1)}% dup rate)`
      );
      
      return limitedPosts;
    } catch (error) {
      logger.error(`Error fetching tweets from ${this.dataProvider}:`, error);
      return [];
    }
  }

  /**
   * Fetch tweets using official Twitter API v2
   */
  private async fetchViaOfficialAPI(cutoffTimestamp: number): Promise<SocialMediaPost[]> {
    logger.info('📡 Using Official Twitter API v2 (compliant with ToS)');
    const allPosts: SocialMediaPost[] = [];
    
    for (const term of this.watchTerms) {
      try {
        logger.info(`Searching official Twitter API for: ${term}`);
        
        // Use Twitter API v2 recent search endpoint
        const query = encodeURIComponent(`${term} -is:retweet lang:en`);
        const maxResults = Math.min(this.maxTweetsPerCycle, 100); // API limit is 100
        
        let url = `https://api.twitter.com/2/tweets/search/recent?query=${query}&max_results=${maxResults}`;
        url += '&tweet.fields=created_at,public_metrics,context_annotations,lang,referenced_tweets';
        url += '&user.fields=username,name,description,public_metrics,verified';
        url += '&expansions=author_id';
        
        // Add time filter
        if (cutoffTimestamp > 0) {
          const startTime = new Date(cutoffTimestamp).toISOString();
          url += `&start_time=${startTime}`;
        }

        const headers: Record<string, string> = {};
        if (this.twitterBearerToken) {
          headers.Authorization = `Bearer ${this.twitterBearerToken}`;
        } else if (this.twitterApiKey && this.twitterApiSecretKey) {
          // Use OAuth 1.0a if we have API keys
          // This is a simplified version - in production you'd want proper OAuth signing
          logger.warn('OAuth 1.0a not fully implemented - use Bearer token for best results');
          continue;
        }

        const response = await fetch(url, { headers });
        
        if (!response.ok) {
          const errorText = await response.text();
          logger.error(`Official Twitter API request failed: ${response.status} ${response.statusText} - ${errorText}`);
          continue;
        }

        const data = await response.json();
        const posts = this.transformOfficialAPIResponse(data, term, cutoffTimestamp);
        allPosts.push(...posts);
        
        logger.info(`Found ${posts.length} posts for term: ${term} via official API`);
        
        // Rate limiting: Twitter API v2 allows 300 requests per 15min window
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
        
      } catch (error) {
        logger.error(`Error searching official API for ${term}:`, error);
      }
    }
    
    return allPosts;
  }

  /**
   * Fetch tweets using RapidAPI (fallback with legal warnings)
   */
  private async fetchViaRapidAPI(cutoffTimestamp: number): Promise<SocialMediaPost[]> {
    logger.warn('📡 Using RapidAPI (third-party) - ⚠️  LEGAL RISK: May violate Twitter ToS');
    const allPosts: SocialMediaPost[] = [];
    
    for (const term of this.watchTerms) {
      try {
        logger.info(`Searching RapidAPI for: ${term}`);
        const posts = await this.searchRapidAPIForTerm(term, cutoffTimestamp);
        allPosts.push(...posts);
        logger.info(`Found ${posts.length} posts for term: ${term} via RapidAPI`);
        
        // Be more conservative with RapidAPI rate limiting
        await new Promise(resolve => setTimeout(resolve, 3000)); // 3 second delay
        
      } catch (error) {
        logger.error(`Error searching RapidAPI for ${term}:`, error);
      }
    }
    
    return allPosts;
  }

  /**
   * Transform official Twitter API v2 response to SocialMediaPost format
   */
  private transformOfficialAPIResponse(
    apiResponse: any,
    searchTerm: string,
    cutoffTimestamp: number
  ): SocialMediaPost[] {
    const posts: SocialMediaPost[] = [];
    
    try {
      const tweets = apiResponse.data || [];
      const users = apiResponse.includes?.users || [];
      
      // Create user lookup map
      const userMap = new Map();
      for (const user of users) {
        userMap.set(user.id, user);
      }
      
      logger.info(`Processing ${tweets.length} tweets from official API for term: ${searchTerm}`);
      
      for (const tweet of tweets) {
        try {
          const user = userMap.get(tweet.author_id);
          if (!user) {
            logger.debug(`No user data found for tweet: ${tweet.id}`);
            continue;
          }
          
          const timestamp = new Date(tweet.created_at).getTime();
          
          // Skip if too old
          if (timestamp < cutoffTimestamp) {
            continue;
          }
          
          // Skip if already processed
          if (this.processedTweetIds.has(tweet.id)) {
            continue;
          }
          
          const post: SocialMediaPost = {
            id: tweet.id,
            platform: 'twitter',
            author: {
              id: user.id,
              username: user.username,
              name: user.name,
              followerCount: user.public_metrics?.followers_count || 0,
              description: user.description || '',
              followingCount: user.public_metrics?.following_count || 0,
              verified: user.verified || false,
              statusesCount: user.public_metrics?.tweet_count || 0,
            },
            content: {
              text: tweet.text,
              url: `https://twitter.com/${user.username}/status/${tweet.id}`,
              hasMedia: false, // Would need to check attachments
              isRetweet: tweet.referenced_tweets?.some((ref: any) => ref.type === 'retweeted') || false,
              isReply: tweet.referenced_tweets?.some((ref: any) => ref.type === 'replied_to') || false,
            },
            metrics: {
              likes: tweet.public_metrics?.like_count || 0,
              retweets: tweet.public_metrics?.retweet_count || 0,
              replies: tweet.public_metrics?.reply_count || 0,
              views: tweet.public_metrics?.impression_count || 0,
            },
            timestamp,
            conversationId: tweet.conversation_id || `conv_${tweet.id}`,
            searchContext: searchTerm,
            searchTerms: [searchTerm],
            attributionSource: 'search' as const,
          };
          
          posts.push(post);
          this.processedTweetIds.add(tweet.id);
          
        } catch (error) {
          logger.warn(`Error processing tweet ${tweet.id}:`, error);
        }
      }
      
    } catch (error) {
      logger.error(`Error transforming official API response for ${searchTerm}:`, error);
    }
    
    return posts;
  }

  /**
   * Search RapidAPI for a specific term (reusing existing RapidAPI logic)
   */
  private async searchRapidAPIForTerm(
    term: string,
    cutoffTimestamp: number
  ): Promise<SocialMediaPost[]> {
    const url = `https://${this.rapidApiHost}/search-v2`;

    const params = new URLSearchParams({
      type: 'Latest',
      count: Math.min(this.maxTweetsPerCycle, 20).toString(), // RapidAPI limit is 20
      query: term,
    });

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
    
    if (data.cursor?.bottom) {
      this.lastCursor = data.cursor.bottom;
      logger.debug(`Updated cursor: ${this.lastCursor}`);
    }

    // Reuse the existing RapidAPI transformation logic
    return this.transformRapidAPIResponse(data, term, cutoffTimestamp);
  }

  /**
   * Transform RapidAPI response with comprehensive logging and parsing
   */
  private transformRapidAPIResponse(
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
            const post = this.transformRapidAPITweetEntry(entry, searchTerm, cutoffTimestamp);
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
   * Transform a single RapidAPI tweet entry with enhanced parsing and debugging
   */
  private transformRapidAPITweetEntry(
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

      // Skip if too old (only for Official API - RapidAPI relies on deduplication)
      if (timestamp && cutoffTimestamp > 0 && timestamp < cutoffTimestamp) {
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
   * Calculate cutoff timestamp for fetching
   */
  private calculateCutoffTimestamp(sinceTimestamp?: number): number {
    const isDevelopment = process.env.NODE_ENV === 'development';
    const isFirstRun = this.isFirstRun();
    
    // For RapidAPI, we don't need time filtering since it always returns latest tweets
    // and we rely on processedTweetIds for deduplication
    if (this.dataProvider === 'rapidapi') {
      logger.debug('[TwitterData] RapidAPI provider: Using minimal cutoff timestamp (relying on deduplication)');
      return 0; // Effectively disable time-based filtering for RapidAPI
    }
    
    // For Official API, use proper time-based filtering since it supports it
    if (isDevelopment) {
      const devTimeWindow = parseInt(process.env.SENTIMENT_DEV_TIME_WINDOW || '21600000', 10);
      return Date.now() - devTimeWindow;
    }
    
    if (isFirstRun) {
      const firstRunHours = parseInt(process.env.SENTIMENT_FIRST_RUN_HOURS || '6', 10);
      return Date.now() - (firstRunHours * 60 * 60 * 1000);
    }
    
    return sinceTimestamp || this.lastFetchTimestamp || Date.now() - 10 * 60 * 1000;
  }

  /**
   * Remove duplicate posts and merge attribution data
   */
  private deduplicatePosts(posts: SocialMediaPost[]): SocialMediaPost[] {
    const postMap = new Map<string, SocialMediaPost>();

    for (const post of posts) {
      const existingPost = postMap.get(post.id);
      if (existingPost) {
        // Merge search terms
        const existingTerms = existingPost.searchTerms || [existingPost.searchContext].filter(Boolean);
        const newTerms = post.searchTerms || [post.searchContext].filter(Boolean);
        const mergedTerms = [...new Set([...existingTerms, ...newTerms])];
        
        postMap.set(post.id, {
          ...existingPost,
          searchTerms: mergedTerms,
        });
      } else {
        postMap.set(post.id, {
          ...post,
          searchTerms: post.searchTerms || [post.searchContext].filter(Boolean),
        });
      }
    }

    return Array.from(postMap.values());
  }

  /**
   * Check if this is the first run
   */
  private isFirstRun(): boolean {
    return this.processedTweetIds.size === 0 && this.lastFetchTimestamp === 0;
  }

  /**
   * Get current configuration status
   */
  getConfigurationStatus(): {
    provider: string;
    isOfficialAPI: boolean;
    isCompliant: boolean;
    watchTerms: string[];
    maxTweetsPerCycle: number;
  } {
    return {
      provider: this.dataProvider || 'none',
      isOfficialAPI: this.dataProvider === 'official',
      isCompliant: this.dataProvider === 'official',
      watchTerms: [...this.watchTerms],
      maxTweetsPerCycle: this.maxTweetsPerCycle,
    };
  }

  /**
   * Get watch terms
   */
  getWatchTerms(): string[] {
    return [...this.watchTerms];
  }

  /**
   * Update watch terms
   */
  updateWatchTerms(terms: string[]): void {
    this.watchTerms = terms;
    logger.info(`Updated Twitter Data Service watch terms: ${terms.join(', ')}`);
  }

  /**
   * Clear processed tweet cache
   */
  clearProcessedTweets(): void {
    this.processedTweetIds.clear();
    this.lastFetchTimestamp = 0;
    this.lastCursor = null;
    logger.info('Cleared processed tweet cache and cursor');
  }
}