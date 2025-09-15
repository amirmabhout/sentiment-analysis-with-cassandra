import { Service, type IAgentRuntime, logger, ModelType } from '@elizaos/core';
import type {
  SentimentScore,
  SocialMediaPost,
  ProcessedSentiment,
  ExtractedEntity,
  ExtractedTopic,
  CategorizedSentiment,
  ContentCategory,
} from '../types.ts';
import type { SentimentPersistenceService } from './persistence.ts';
import type { SentimentAlertsService } from './sentiment-alerts.ts';

/**
 * SentimentAnalysisService handles the core sentiment scoring functionality
 * Uses LLM models to analyze text sentiment with multiple scoring methods
 */
export class SentimentAnalysisService extends Service {
  static serviceType = 'sentiment-analysis';
  capabilityDescription = 'Analyzes sentiment of social media posts and text content';

  private watchTerms: string[] = ['ai16z', 'elizaos', 'eliza', '@ai16zdao', '@elizaos'];
  private ignoredUsernames: Set<string> = new Set();
  private persistenceService: SentimentPersistenceService;
  private alertsService: SentimentAlertsService;

  constructor(runtime: IAgentRuntime) {
    super(runtime);

    // Get persistence service
    this.persistenceService = runtime.getService(
      'sentiment-persistence'
    ) as SentimentPersistenceService;

    // Get alerts service
    this.alertsService = runtime.getService('sentiment-alerts') as SentimentAlertsService;

    // Load watch terms from environment or runtime settings
    const envWatchTerms =
      (runtime.getSetting('SENTIMENT_WATCH_TERMS') as string) || process.env.SENTIMENT_WATCH_TERMS;
    if (envWatchTerms) {
      try {
        this.watchTerms = envWatchTerms.split(',').map((term: string) => term.trim().toLowerCase());
      } catch (error) {
        logger.warn('Failed to parse SENTIMENT_WATCH_TERMS, using defaults');
      }
    }

    // Load ignored usernames from environment or runtime settings
    const envIgnoredUsernames =
      (runtime.getSetting('SENTIMENT_X_USERNAMES_IGNORE') as string) || 
      process.env.SENTIMENT_X_USERNAMES_IGNORE;
    if (envIgnoredUsernames) {
      try {
        this.ignoredUsernames = new Set(
          envIgnoredUsernames.split(',').map((username: string) => username.trim().toLowerCase())
        );
        logger.info(`[SENTIMENT] Loaded ${this.ignoredUsernames.size} ignored usernames: ${Array.from(this.ignoredUsernames).join(', ')}`);
      } catch (error) {
        logger.warn('Failed to parse SENTIMENT_X_USERNAMES_IGNORE, using empty list');
      }
    }
  }

  static async start(runtime: IAgentRuntime): Promise<SentimentAnalysisService> {
    logger.info('🔍 Starting Sentiment Analysis Service');
    const service = new SentimentAnalysisService(runtime);
    return service;
  }

  async stop(): Promise<void> {
    logger.info('🔍 Stopping Sentiment Analysis Service');
  }

  /**
   * Analyzes sentiment of a single social media post
   * Stores both the original post and the analysis results in the database
   */
  async analyzeSentiment(
    post: SocialMediaPost,
    searchContext?: string
  ): Promise<ProcessedSentiment> {
    logger.debug(
      `[SENTIMENT_ANALYSIS] Starting analysis for post ${post.id} from ${post.platform}`
    );
    logger.debug(
      `[SENTIMENT_ANALYSIS] Post search attribution: searchTerms=${JSON.stringify(post.searchTerms)}, searchContext=${post.searchContext}, source=${post.attributionSource}`
    );

    // Check if username is in ignore list BEFORE processing
    if (this.ignoredUsernames.has(post.author.username.toLowerCase())) {
      logger.info(`[SENTIMENT] Ignoring tweet from blocked user: @${post.author.username}`);
      return this.createEmptyResult(post, []);
    }

    // Store the tweet first (with deduplication)
    let tweetMemoryId = null;
    if (this.persistenceService) {
      try {
        tweetMemoryId = await this.persistenceService.storeTweet(post);
        if (tweetMemoryId) {
          logger.debug(
            `[SENTIMENT_ANALYSIS] Stored tweet ${post.id} with memory ID ${tweetMemoryId}`
          );
        } else {
          logger.debug(`[SENTIMENT_ANALYSIS] Tweet ${post.id} already exists in database`);
        }
      } catch (error) {
        logger.warn(`[SENTIMENT_ANALYSIS] Failed to store tweet ${post.id}:`, error);
      }
    } else {
      logger.warn('[SENTIMENT_ANALYSIS] Persistence service not available for tweet storage');
    }

    try {
      // Perform comprehensive analysis with single LLM call
      const analysis = await this.analyzePostComprehensive(post.content.text);

      // Check if post was classified as spam - if so, skip processing
      if (analysis.categorization.category === 'spam') {
        logger.info(`[SENTIMENT] Detected spam/farming post ${post.id}, skipping sentiment storage`);
        return this.createEmptyResult(post, []);
      }

      // Use LLM-detected watch terms, fallback to search attribution if needed
      let watchTermsFound = analysis.watchTerms;
      let attributionSource: 'llm_analysis' | 'search_terms' | 'search_context' | 'default' =
        'llm_analysis';

      // If LLM didn't find any relevant terms, use search attribution as fallback
      if (watchTermsFound.length === 0) {
        logger.debug(
          `[SENTIMENT_ANALYSIS] LLM found no watch terms for post ${post.id}, using fallback attribution`
        );

        if (post.searchTerms && post.searchTerms.length > 0) {
          watchTermsFound = post.searchTerms;
          attributionSource = 'search_terms';
          logger.debug(`[SENTIMENT_ANALYSIS] Using searchTerms: [${watchTermsFound.join(', ')}]`);
        } else if (post.searchContext) {
          watchTermsFound = [post.searchContext];
          attributionSource = 'search_context';
          logger.debug(`[SENTIMENT_ANALYSIS] Using searchContext: [${watchTermsFound.join(', ')}]`);
        } else {
          // Last resort: default term (with warning)
          const defaultTerm = this.watchTerms[0] || 'ai16z';
          watchTermsFound = [defaultTerm];
          attributionSource = 'default';
          logger.warn(
            `[SENTIMENT_ANALYSIS] No attribution available for post ${post.id}, using default: [${defaultTerm}]`
          );
        }
      } else {
        logger.debug(`[SENTIMENT_ANALYSIS] LLM found watch terms: [${watchTermsFound.join(', ')}]`);
      }

      logger.debug(
        `[SENTIMENT_ANALYSIS] Comprehensive analysis for post ${post.id}: sentiment=${analysis.sentiment.score.toFixed(3)}, category=${analysis.categorization.category}, watchTerms=[${watchTermsFound.join(', ')}], attributionSource=${attributionSource}`
      );

      // Calculate influence metrics
      const influence = this.calculateInfluence(post);

      const processedSentiment: ProcessedSentiment = {
        postId: post.id,
        platform: post.platform,
        processedAt: Date.now(),
        sentiment: analysis.sentiment,
        entities: analysis.entities,
        topics: analysis.topics,
        watchTermsFound,
        influence,
        categorization: analysis.categorization,
      };

      // Store the sentiment analysis results
      if (this.persistenceService) {
        try {
          const analysisMemoryId = await this.persistenceService.storeSentimentAnalysis(
            processedSentiment,
            tweetMemoryId
          );
          if (analysisMemoryId) {
            logger.debug(
              `[SENTIMENT_ANALYSIS] Stored sentiment analysis ${post.id} with memory ID ${analysisMemoryId}`
            );
          }
        } catch (error) {
          logger.warn(`[SENTIMENT_ANALYSIS] Failed to store sentiment analysis ${post.id}:`, error);
        }
      }

      // Evaluate for real-time alerts (non-blocking)
      if (this.alertsService) {
        try {
          this.alertsService.evaluateForAlert(processedSentiment, post).catch((error) => {
            logger.warn(`[SENTIMENT_ANALYSIS] Alert evaluation failed for post ${post.id}:`, error);
          });
        } catch (error) {
          logger.warn(`[SENTIMENT_ANALYSIS] Alert evaluation error for post ${post.id}:`, error);
        }
      } else {
        logger.debug('[SENTIMENT_ANALYSIS] Alerts service not available');
      }

      return processedSentiment;
    } catch (error) {
      logger.error(`Error analyzing sentiment for post ${post.id}:`, error);
      const emptyResult = this.createEmptyResult(post, []);

      // Still try to store the empty result if we have persistence service
      if (this.persistenceService && tweetMemoryId) {
        try {
          await this.persistenceService.storeSentimentAnalysis(emptyResult, tweetMemoryId);
        } catch (storeError) {
          logger.warn(
            `[SENTIMENT_ANALYSIS] Failed to store empty result for ${post.id}:`,
            storeError
          );
        }
      }

      return emptyResult;
    }
  }

  /**
   * Batch process sentiment analysis for multiple posts
   * Stores all posts and analysis results in the database
   */
  async analyzeBatch(posts: SocialMediaPost[]): Promise<ProcessedSentiment[]> {
    logger.info(`Batch analyzing sentiment for ${posts.length} posts`);

    if (!this.persistenceService) {
      logger.warn('[SENTIMENT_ANALYSIS] Persistence service not available for batch processing');
    }

    const results: ProcessedSentiment[] = [];
    const batchSize = 5; // Process in smaller batches to avoid rate limits

    for (let i = 0; i < posts.length; i += batchSize) {
      const batch = posts.slice(i, i + batchSize);
      const batchPromises = batch.map((post) => this.analyzeSentiment(post));

      try {
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);

        // Log batch completion details
        logger.info(
          `Completed batch ${Math.floor(i / batchSize) + 1}: analyzed ${batchResults.length} posts`
        );
        for (const result of batchResults) {
          logger.info(
            `Post ${result.postId}: attributed to [${result.watchTermsFound.join(', ')}], sentiment: ${result.sentiment.score.toFixed(3)}`
          );
        }

        // Small delay between batches to be respectful to LLM API
        if (i + batchSize < posts.length) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } catch (error) {
        logger.error(`Error in batch ${i}-${i + batchSize}:`, error);
        // Continue with next batch even if one fails
      }
    }

    logger.info(`[BATCH_ANALYSIS] Completed batch analysis: ${results.length} results`);

    // Enhanced attribution summary with details
    const attributionSummary = new Map<string, number>();
    const multiAttributedPosts = [];

    for (const result of results) {
      if (result.watchTermsFound.length > 1) {
        multiAttributedPosts.push({
          postId: result.postId,
          terms: result.watchTermsFound,
        });
      }

      for (const term of result.watchTermsFound) {
        attributionSummary.set(term, (attributionSummary.get(term) || 0) + 1);
      }
    }

    logger.info(
      `[BATCH_ANALYSIS] Attribution summary: ${Array.from(attributionSummary.entries())
        .map(([term, count]) => `${term}:${count}`)
        .join(', ')}`
    );

    if (multiAttributedPosts.length > 0) {
      logger.info(
        `[BATCH_ANALYSIS] Posts with multiple attributions (${multiAttributedPosts.length}): ${multiAttributedPosts
          .map((p) => `${p.postId}:[${p.terms.join(',')}]`)
          .slice(0, 5)
          .join(', ')}${multiAttributedPosts.length > 5 ? '...' : ''}`
      );
    }

    // Log total attribution count vs posts processed
    const totalAttributions = Array.from(attributionSummary.values()).reduce(
      (sum, count) => sum + count,
      0
    );
    logger.info(
      `[BATCH_ANALYSIS] Total attributions: ${totalAttributions} across ${results.length} posts (${(totalAttributions / results.length).toFixed(2)} avg per post)`
    );

    if (this.persistenceService) {
      logger.info(
        `[BATCH_ANALYSIS] All ${results.length} posts and sentiment analyses stored in database`
      );
    } else {
      logger.warn(
        '[BATCH_ANALYSIS] Results processed but persistence service unavailable - data not stored'
      );
    }

    return results;
  }

  /**
   * Comprehensive analysis of post using single LLM call
   */
  private async analyzePostComprehensive(text: string): Promise<{
    sentiment: SentimentScore;
    entities: ExtractedEntity[];
    topics: ExtractedTopic[];
    categorization: CategorizedSentiment;
    watchTerms: string[];
  }> {
    const prompt = `<task>Perform comprehensive sentiment and content analysis of this social media post about ai16z/elizaOS ecosystem.</task>

<instructions>
# Analyze this post for sentiment, categorization, topics, and key entities with high accuracy.

# SENTIMENT ANALYSIS:
- Score the overall emotional tone from -1.0 (very negative) to +1.0 (very positive)
- Consider context about ai16z/elizaOS specifically (supportive, critical, curious, etc.)
- Account for sarcasm, irony, and subtle negativity that might mask true sentiment
- Distinguish between technical/factual language vs emotional expressions
- Be aware of community sentiment patterns and crypto-specific language

# SENTIMENT SCALE:
-1.0 to -0.5: Very negative (harsh criticism, anger, disappointment, FUD)
-0.5 to -0.1: Somewhat negative (mild criticism, skepticism, concerns)
-0.1 to +0.1: Neutral (informational, questions, factual observations)
+0.1 to +0.5: Somewhat positive (interest, mild enthusiasm, cautious optimism)
+0.5 to +1.0: Very positive (excitement, strong support, praise, bullish sentiment)

# MAGNITUDE: How intense/strong the emotional content is regardless of direction (0.0 = bland, 1.0 = very intense)

# CATEGORIZATION:
Classify posts into one of three categories based on primary focus:
- trading: trading and speculation aspect on the token price of $AI16Z
- ecosystem: technical and ecosystem discussions around elizaos ecosystem and open source agent framework  
- spam: ticker farming, keyword stuffing, or posts that just list multiple tickers without meaningful content about ai16z/elizaOS

## Spam detection guidelines:
- Look for posts with multiple unrelated tickers (e.g., "$CAMEL $AI16Z $SYRUP $AVAAI #POPE $PI")
- Posts with no actual discussion about ai16z or elizaOS, just ticker mentions for farming
- Generic pumping messages with multiple project tags
- If the post would make sense with ai16z/elizaOS keywords removed, it's likely spam
- Posts that are clearly farming engagement by listing many tokens

## If post has multiple aspects, choose the category that represents the PRIMARY intent and focus. Choose ONLY one category.

TOPICS: Identify 3-5 specific topics/themes as keywords. Use these topic categories:
- Trading: price_action, market_prediction, buy_sell_signals, chart_analysis, profit_loss, trading_strategy
- Ecosystem: development, features, partnerships, adoption, community, governance, integrations, bug_reports, team_updates, technical_discussion

ENTITIES: Extract important people, organizations, products mentioned. Format as "Name:TYPE" where TYPE is PERSON, ORG, PRODUCT, or MISC.
</instructions>

<input>
Post text: "${text}"
</input>

<output>
Respond using ONLY the XML format below. Do not include any text, thinking, or reasoning before or after this XML block.

<analysis>
  <sentiment_score>-1.0 to 1.0</sentiment_score>
  <sentiment_magnitude>0.0 to 1.0</sentiment_magnitude>
  <category>trading|ecosystem|spam</category>
  <topics>topic1,topic2,topic3</topics>
  <entities>Name1:TYPE,Name2:TYPE,Name3:TYPE</entities>
  <reasoning>Brief explanation of sentiment and categorization</reasoning>
</analysis>
</output>`;

    try {
      const response = await this.runtime.useModel(ModelType.TEXT_SMALL, {
        prompt,
        max_tokens: 500,
        temperature: 0.1,
      });

      return this.parseComprehensiveResponse(response, text);
    } catch (error) {
      logger.error('Error in comprehensive post analysis:', error);
      return this.createEmptyAnalysisResult();
    }
  }

  /**
   * Parse comprehensive LLM response into all analysis components
   */
  private parseComprehensiveResponse(
    response: unknown,
    _originalText: string
  ): {
    sentiment: SentimentScore;
    entities: ExtractedEntity[];
    topics: ExtractedTopic[];
    categorization: CategorizedSentiment;
    watchTerms: string[];
  } {
    try {
      const responseStr = String(response);

      // Parse sentiment (simplified - no confidence)
      const sentimentScore = this.extractFloatValue(responseStr, 'sentiment_score', 0, -1, 1);
      const sentimentMagnitude = this.extractFloatValue(
        responseStr,
        'sentiment_magnitude',
        0.5,
        0,
        1
      );

      const sentiment: SentimentScore = {
        score: sentimentScore,
        confidence: 0.8, // Default confidence since we removed the field
        magnitude: sentimentMagnitude,
      };

      // Parse category (trading, ecosystem, or spam)
      const categoryStr = this.extractStringValue(
        responseStr,
        'category',
        'ecosystem'
      ).toLowerCase();
      
      const category = categoryStr as ContentCategory | 'spam';

      // Create categorization with indicators derived from topics
      const topicsStr = this.extractStringValue(responseStr, 'topics', '');
      const topicNames = topicsStr
        ? topicsStr
          .split(',')
          .map((t) => t.trim().toLowerCase())
          .filter((t) => t)
        : [];

      // Simple categorization - let topics speak for themselves
      const categorization: CategorizedSentiment = {
        category,
        categoryConfidence: 0.8,
        // Indicators are now optional - reports use topics directly
      };

      // Create structured topics
      const topics: ExtractedTopic[] = topicNames.map((name) => ({
        name,
        keywords: [name],
        relevance: 0.8,
        frequency: 1,
      }));

      // Parse entities
      const entitiesStr = this.extractStringValue(responseStr, 'entities', '');
      const entities: ExtractedEntity[] = [];
      if (entitiesStr) {
        const entityPairs = entitiesStr.split(',');
        for (const pair of entityPairs) {
          const [text, type] = pair.split(':').map((s) => s.trim());
          if (text && type) {
            entities.push({
              text,
              type: (type.toUpperCase() as ExtractedEntity['type']) || 'MISC',
              relevance: 0.8,
              sentiment: { score: 0, confidence: 0.5, magnitude: 0.3 },
            });
          }
        }
      }

      // No watch terms needed since API already filters
      const watchTerms: string[] = [];

      return {
        sentiment,
        entities,
        topics,
        categorization,
        watchTerms,
      };
    } catch (error) {
      logger.error('Error parsing comprehensive response:', error);
      return this.createEmptyAnalysisResult();
    }
  }

  /**
   * Helper to extract float values from XML response
   */
  private extractFloatValue(
    response: string | unknown,
    tag: string,
    defaultValue: number,
    min?: number,
    max?: number
  ): number {
    const responseStr = String(response);
    const match = responseStr.match(new RegExp(`<${tag}>([-+]?\\d*\\.?\\d+)<\\/${tag}>`));
    let value = match ? parseFloat(match[1]) : defaultValue;
    if (min !== undefined) value = Math.max(min, value);
    if (max !== undefined) value = Math.min(max, value);
    return value;
  }

  /**
   * Helper to extract string values from XML response
   */
  private extractStringValue(
    response: string | unknown,
    tag: string,
    defaultValue: string
  ): string {
    const responseStr = String(response);
    const match = responseStr.match(new RegExp(`<${tag}>(.*?)<\\/${tag}>`));
    return match ? match[1].trim() : defaultValue;
  }

  /**
   * Create empty analysis result for error cases
   */
  private createEmptyAnalysisResult(): {
    sentiment: SentimentScore;
    entities: ExtractedEntity[];
    topics: ExtractedTopic[];
    categorization: CategorizedSentiment;
    watchTerms: string[];
  } {
    return {
      sentiment: { score: 0, confidence: 0, magnitude: 0 },
      entities: [],
      topics: [],
      categorization: {
        category: 'ecosystem',
        categoryConfidence: 0.5,
      },
      watchTerms: [],
    };
  }

  /**
   * Calculate influence metrics for a post
   */
  private calculateInfluence(post: SocialMediaPost): ProcessedSentiment['influence'] {
    // Author influence based on follower count
    const followerCount = post.author.followerCount || 0;
    let authorInfluence = 0;

    if (followerCount > 100000) authorInfluence = 1.0;
    else if (followerCount > 50000) authorInfluence = 0.9;
    else if (followerCount > 10000) authorInfluence = 0.8;
    else if (followerCount > 5000) authorInfluence = 0.6;
    else if (followerCount > 1000) authorInfluence = 0.4;
    else if (followerCount > 100) authorInfluence = 0.2;
    else authorInfluence = 0.1;

    // Virality potential based on engagement
    const likes = post.metrics.likes || 0;
    const retweets = post.metrics.retweets || 0;
    const replies = post.metrics.replies || 0;

    const totalEngagement = likes + retweets * 2 + replies * 1.5;
    let viralityPotential = Math.min(totalEngagement / 100, 1.0); // Normalize to 0-1

    return {
      authorInfluence,
      viralityPotential,
    };
  }

  /**
   * Create empty result for posts that don't match criteria
   */
  private createEmptyResult(post: SocialMediaPost, watchTermsFound: string[]): ProcessedSentiment {
    return {
      postId: post.id,
      platform: post.platform,
      processedAt: Date.now(),
      sentiment: { score: 0, confidence: 0, magnitude: 0 },
      entities: [],
      topics: [],
      watchTermsFound,
      influence: { authorInfluence: 0, viralityPotential: 0 },
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
  setWatchTerms(terms: string[]): void {
    this.watchTerms = terms.map((term) => term.trim().toLowerCase());
    logger.info(`Updated watch terms: ${this.watchTerms.join(', ')}`);
  }
}
