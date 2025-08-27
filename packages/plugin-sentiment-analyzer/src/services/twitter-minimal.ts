import { Service, type IAgentRuntime, logger } from '@elizaos/core';
import type { SocialMediaPost } from '../types.ts';

/**
 * Minimal Twitter search service for sentiment analysis
 * Only implements search functionality without authentication
 * Uses public/guest endpoints when possible
 */
export class TwitterMinimalService extends Service {
  static serviceType = 'twitter-minimal';
  capabilityDescription = 'Minimal Twitter search for sentiment analysis without authentication';

  private watchTerms: string[] = ['ai16z', 'elizaos'];
  private lastFetchTimestamp: number = 0;
  private processedTweetIds: Set<string> = new Set();
  private maxTweetsPerCycle = 3;

  constructor(runtime: IAgentRuntime) {
    super(runtime);
    this.loadConfiguration();
  }

  static async start(runtime: IAgentRuntime): Promise<TwitterMinimalService> {
    logger.info('🐦 Starting Twitter Minimal Service (no auth required)');
    const service = new TwitterMinimalService(runtime);
    return service;
  }

  async stop(): Promise<void> {
    logger.info('🐦 Stopping Twitter Minimal Service');
    this.processedTweetIds.clear();
  }

  private loadConfiguration(): void {
    // Load watch terms
    const envWatchTerms = this.runtime.getSetting('SENTIMENT_WATCH_TERMS') as string || 
                         process.env.SENTIMENT_WATCH_TERMS;
    if (envWatchTerms) {
      try {
        this.watchTerms = envWatchTerms.split(',').map((term: string) => term.trim());
      } catch (error) {
        logger.warn('Failed to parse SENTIMENT_WATCH_TERMS, using defaults');
      }
    }

    // Load max tweets per cycle
    const maxTweets = this.runtime.getSetting('TWITTER_MAX_TWEETS_PER_CYCLE') as string || 
                     process.env.TWITTER_MAX_TWEETS_PER_CYCLE;
    if (maxTweets) {
      this.maxTweetsPerCycle = parseInt(maxTweets, 10) || 3;
    }

    logger.info(`Twitter Minimal Config - Watch terms: ${this.watchTerms.join(', ')}, Max tweets: ${this.maxTweetsPerCycle}`);
  }

  /**
   * Fetch recent tweets using web scraping approach (no API auth required)
   * This is a mock implementation for now - in production you might use:
   * 1. Public Twitter RSS feeds
   * 2. Alternative APIs like Nitter
   * 3. Web scraping with puppeteer
   */
  async fetchRecentTweets(sinceTimestamp?: number): Promise<SocialMediaPost[]> {
    const cutoffTimestamp = sinceTimestamp || this.lastFetchTimestamp || (Date.now() - 10 * 60 * 1000); // Default: 10 minutes ago
    
    logger.info(`Fetching tweets since ${new Date(cutoffTimestamp).toISOString()} (mock implementation)`);

    // For now, return mock data to avoid authentication issues
    // In production, this would use alternative methods to get Twitter data
    const mockPosts: SocialMediaPost[] = this.generateMockTweets(cutoffTimestamp);
    
    // Update last fetch timestamp
    this.lastFetchTimestamp = Date.now();
    
    logger.info(`Fetched ${mockPosts.length} mock tweets for sentiment analysis`);
    return mockPosts;
  }

  /**
   * Generate mock tweets for testing sentiment analysis functionality
   * This simulates real Twitter data without requiring API access
   */
  private generateMockTweets(sinceTimestamp: number): SocialMediaPost[] {
    const posts: SocialMediaPost[] = [];
    const now = Date.now();

    // Only generate new mock tweets if enough time has passed
    if (now - sinceTimestamp < 5 * 60 * 1000) {
      return posts; // Too soon, no new tweets
    }

    const mockTweets = [
      {
        content: 'Really excited about the latest ai16z developments! The future looks bright 🚀',
        sentiment: 'positive',
        engagement: { likes: 45, retweets: 12, replies: 8 }
      },
      {
        content: 'elizaOS is making some interesting progress, curious to see where this goes',
        sentiment: 'neutral',
        engagement: { likes: 23, retweets: 5, replies: 3 }
      },
      {
        content: 'Having some issues with the latest ai16z update, hoping for a fix soon',
        sentiment: 'negative',
        engagement: { likes: 12, retweets: 2, replies: 15 }
      },
      {
        content: 'The elizaOS community is really growing, love to see the collaboration',
        sentiment: 'positive',
        engagement: { likes: 67, retweets: 18, replies: 9 }
      },
      {
        content: 'ai16z partnerships are looking promising for the ecosystem',
        sentiment: 'positive',
        engagement: { likes: 34, retweets: 8, replies: 4 }
      }
    ];

    // Generate a few random mock tweets based on current time
    const tweetCount = Math.min(this.maxTweetsPerCycle, Math.floor(Math.random() * 3) + 1);
    
    for (let i = 0; i < tweetCount; i++) {
      const mockTweet = mockTweets[Math.floor(Math.random() * mockTweets.length)];
      const tweetId = `mock_${now}_${i}`;
      
      // Skip if we've already processed this mock tweet pattern
      if (this.processedTweetIds.has(tweetId)) {
        continue;
      }

      const post: SocialMediaPost = {
        id: tweetId,
        platform: 'twitter',
        author: {
          id: `mock_user_${i}`,
          username: `user${i}`,
          name: `Mock User ${i}`,
          followerCount: Math.floor(Math.random() * 10000) + 100
        },
        content: {
          text: mockTweet.content,
          url: `https://twitter.com/user${i}/status/${tweetId}`,
          hasMedia: Math.random() > 0.7,
          isRetweet: false,
          isReply: Math.random() > 0.8
        },
        metrics: mockTweet.engagement,
        timestamp: now - Math.floor(Math.random() * 10 * 60 * 1000), // Last 10 minutes
        conversationId: `conv_${tweetId}`
      };

      posts.push(post);
      this.processedTweetIds.add(tweetId);
    }

    return posts;
  }

  /**
   * Get statistics about recent Twitter activity (mock implementation)
   */
  async getTwitterStats(): Promise<{
    totalTweets: number;
    tweetsPerWatchTerm: Record<string, number>;
    avgEngagement: number;
    topAuthors: Array<{ username: string; posts: number }>;
  }> {
    return {
      totalTweets: this.processedTweetIds.size,
      tweetsPerWatchTerm: {
        'ai16z': Math.floor(this.processedTweetIds.size * 0.6),
        'elizaos': Math.floor(this.processedTweetIds.size * 0.4)
      },
      avgEngagement: 25.5,
      topAuthors: [
        { username: 'user1', posts: 3 },
        { username: 'user2', posts: 2 }
      ]
    };
  }

  /**
   * Update watch terms
   */
  updateWatchTerms(terms: string[]): void {
    this.watchTerms = terms;
    logger.info(`Updated Twitter watch terms: ${terms.join(', ')}`);
  }

  /**
   * Get current watch terms
   */
  getWatchTerms(): string[] {
    return [...this.watchTerms];
  }

  /**
   * Clear processed tweet cache
   */
  clearProcessedTweets(): void {
    this.processedTweetIds.clear();
    this.lastFetchTimestamp = 0;
    logger.info('Cleared processed tweet cache');
  }

  /**
   * Check if service is available (always true for mock service)
   */
  isTwitterAvailable(): boolean {
    return true;
  }
}