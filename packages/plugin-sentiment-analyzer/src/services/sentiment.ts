import { Service, type IAgentRuntime, logger, ModelType } from '@elizaos/core';
import type {
  SentimentScore,
  SocialMediaPost,
  ProcessedSentiment,
  ExtractedEntity,
  ExtractedTopic,
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
      let watchTermsFound: string[] = [];

      // STEP 1: Use search terms as primary attribution (highest priority)
      if (post.searchTerms && post.searchTerms.length > 0) {
        watchTermsFound.push(...post.searchTerms);
        logger.debug(
          `[SENTIMENT_ANALYSIS] Primary attribution from searchTerms: [${watchTermsFound.join(', ')}]`
        );
      } else if (post.searchContext) {
        // Backward compatibility - use searchContext if searchTerms not available
        watchTermsFound.push(post.searchContext);
        logger.debug(
          `[SENTIMENT_ANALYSIS] Primary attribution from searchContext: [${post.searchContext}]`
        );
      }

      // STEP 2: Add secondary attribution via text analysis
      const textBasedTerms = this.findWatchTerms(post.content.text);
      if (textBasedTerms.length > 0) {
        // Add any additional terms found via text analysis that aren't already included
        const newTerms = textBasedTerms.filter((term) => !watchTermsFound.includes(term));
        if (newTerms.length > 0) {
          watchTermsFound.push(...newTerms);
          logger.debug(
            `[SENTIMENT_ANALYSIS] Secondary attribution from text analysis: [${newTerms.join(', ')}]`
          );
        }
      }

      // STEP 3: Try inference if we still have no attributions
      if (watchTermsFound.length === 0) {
        logger.debug(
          `[SENTIMENT_ANALYSIS] No primary or secondary attribution found, attempting inference`
        );
        const inferredTerms = this.inferWatchTermsFromPost(post);
        if (inferredTerms.length > 0) {
          watchTermsFound.push(...inferredTerms);
          logger.debug(`[SENTIMENT_ANALYSIS] Inference attribution: [${inferredTerms.join(', ')}]`);
        } else {
          // Last resort: use default term
          const defaultTerm = this.watchTerms[0] || 'ai16z';
          watchTermsFound.push(defaultTerm);
          logger.debug(
            `[SENTIMENT_ANALYSIS] Fallback attribution to default term: [${defaultTerm}]`
          );
        }
      }

      // Remove duplicates and clean up
      watchTermsFound = [...new Set(watchTermsFound.filter((term) => term && term.trim()))];
      logger.debug(
        `[SENTIMENT_ANALYSIS] Final attribution for post ${post.id}: [${watchTermsFound.join(', ')}]`
      );

      // Analyze sentiment using LLM
      const sentiment = await this.scoreSentiment(post.content.text);

      // Extract entities and topics
      const entities = await this.extractEntities(post.content.text);
      const topics = await this.extractTopics(post.content.text);

      // Calculate influence metrics
      const influence = this.calculateInfluence(post);

      const processedSentiment: ProcessedSentiment = {
        postId: post.id,
        platform: post.platform,
        processedAt: Date.now(),
        sentiment,
        entities,
        topics,
        watchTermsFound,
        influence,
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
    let storedInDb = 0;

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
   * Uses LLM to score sentiment of text
   */
  private async scoreSentiment(text: string): Promise<SentimentScore> {
    const prompt = `Analyze the sentiment of this social media post about ai16z or elizaOS. 
Provide a detailed sentiment analysis in the following XML format:

<sentiment>
  <score>-1.0 to 1.0</score>
  <confidence>0.0 to 1.0</confidence>
  <magnitude>0.0 to 1.0</magnitude>
  <reasoning>Brief explanation of the sentiment analysis</reasoning>
</sentiment>

Text to analyze: "${text}"

Consider:
- Overall emotional tone (positive/negative/neutral)
- Context about ai16z/elizaOS (supportive, critical, curious, etc.)
- Sarcasm or irony that might affect true sentiment
- Technical vs emotional language
- Community sentiment patterns

Score meanings:
- -1.0 to -0.5: Very negative (criticism, anger, disappointment)
- -0.5 to -0.1: Somewhat negative (mild criticism, skepticism)
- -0.1 to 0.1: Neutral (informational, questions, factual)
- 0.1 to 0.5: Somewhat positive (interest, mild enthusiasm)
- 0.5 to 1.0: Very positive (excitement, strong support, praise)

Confidence: How certain you are about the sentiment classification
Magnitude: How strong/intense the emotional content is regardless of direction`;

    try {
      const response = await this.runtime.useModel(ModelType.TEXT_SMALL, {
        prompt,
        max_tokens: 200,
        temperature: 0.1, // Low temperature for consistent analysis
      });

      return this.parseSentimentResponse(response);
    } catch (error) {
      logger.error('Error getting sentiment from LLM:', error);
      return {
        score: 0,
        confidence: 0,
        magnitude: 0,
      };
    }
  }

  /**
   * Parse LLM response into sentiment score object
   */
  private parseSentimentResponse(response: unknown): SentimentScore {
    try {
      const responseStr = String(response);
      // Extract values using regex patterns
      const scoreMatch = responseStr.match(/<score>([-+]?\d*\.?\d+)<\/score>/);
      const confidenceMatch = responseStr.match(/<confidence>(\d*\.?\d+)<\/confidence>/);
      const magnitudeMatch = responseStr.match(/<magnitude>(\d*\.?\d+)<\/magnitude>/);

      const score = scoreMatch ? parseFloat(scoreMatch[1]) : 0;
      const confidence = confidenceMatch ? parseFloat(confidenceMatch[1]) : 0;
      const magnitude = magnitudeMatch ? parseFloat(magnitudeMatch[1]) : 0;

      // Validate and clamp values
      return {
        score: Math.max(-1, Math.min(1, score)),
        confidence: Math.max(0, Math.min(1, confidence)),
        magnitude: Math.max(0, Math.min(1, magnitude)),
      };
    } catch (error) {
      logger.error('Error parsing sentiment response:', error);
      return { score: 0, confidence: 0, magnitude: 0 };
    }
  }

  /**
   * Extract entities from text using LLM
   */
  private async extractEntities(text: string): Promise<ExtractedEntity[]> {
    const prompt = `Extract key entities from this social media post about ai16z/elizaOS.
Focus on important people, organizations, products, and concepts mentioned.

Provide response in XML format:
<entities>
  <entity>
    <text>entity name</text>
    <type>PERSON|ORG|PRODUCT|LOCATION|MISC</type>
    <relevance>0.0 to 1.0</relevance>
  </entity>
</entities>

Text: "${text}"

Guidelines:
- Only extract entities relevant to ai16z/elizaOS ecosystem
- Include people (developers, influencers, team members)
- Include organizations and projects
- Include product names and technical terms
- Rate relevance based on importance to the ai16z/elizaOS narrative
- Maximum 5 most important entities`;

    try {
      const response = await this.runtime.useModel(ModelType.TEXT_SMALL, {
        prompt,
        max_tokens: 300,
        temperature: 0.2,
      });

      return await this.parseEntitiesResponse(response, text);
    } catch (error) {
      logger.error('Error extracting entities:', error);
      return [];
    }
  }

  /**
   * Parse entities response from LLM
   */
  private async parseEntitiesResponse(
    response: unknown,
    originalText: string
  ): Promise<ExtractedEntity[]> {
    const entities: ExtractedEntity[] = [];

    try {
      const responseStr = String(response);
      // Find all entity blocks
      const entityPattern = /<entity>[\s\S]*?<\/entity>/g;
      const entityMatches = responseStr.match(entityPattern);

      if (!entityMatches) return entities;

      for (const entityMatch of entityMatches) {
        const textMatch = entityMatch.match(/<text>(.*?)<\/text>/);
        const typeMatch = entityMatch.match(/<type>(.*?)<\/type>/);
        const relevanceMatch = entityMatch.match(/<relevance>(.*?)<\/relevance>/);

        if (textMatch && typeMatch) {
          const entityText = textMatch[1].trim();
          const entityType = typeMatch[1].trim() as ExtractedEntity['type'];
          const relevance = relevanceMatch ? parseFloat(relevanceMatch[1]) : 0.5;

          // Get sentiment for this specific entity context
          const entitySentiment = await this.getEntitySentiment(entityText, originalText);

          entities.push({
            text: entityText,
            type: entityType,
            relevance: Math.max(0, Math.min(1, relevance)),
            sentiment: entitySentiment,
          });
        }
      }
    } catch (error) {
      logger.error('Error parsing entities response:', error);
    }

    return entities.slice(0, 5); // Limit to top 5 entities
  }

  /**
   * Get sentiment specifically for how an entity is mentioned
   */
  private async getEntitySentiment(entity: string, fullText: string): Promise<SentimentScore> {
    // For now, return neutral sentiment - could be enhanced with more specific analysis
    return {
      score: 0,
      confidence: 0.5,
      magnitude: 0.3,
    };
  }

  /**
   * Extract topics from text using LLM
   */
  private async extractTopics(text: string): Promise<ExtractedTopic[]> {
    const prompt = `Identify key topics and themes in this social media post about ai16z/elizaOS.

Provide response in XML format:
<topics>
  <topic>
    <name>topic name</name>
    <keywords>keyword1,keyword2,keyword3</keywords>
    <relevance>0.0 to 1.0</relevance>
  </topic>
</topics>

Text: "${text}"

Focus on:
- Technical topics (development, features, updates)
- Business topics (partnerships, funding, adoption)
- Community topics (events, discussions, sentiment)
- Product topics (use cases, comparisons, reviews)
- Market topics (price, trading, speculation)

Rate relevance based on how central the topic is to the post's main message.
Maximum 3 most important topics.`;

    try {
      const response = await this.runtime.useModel(ModelType.TEXT_SMALL, {
        prompt,
        max_tokens: 250,
        temperature: 0.3,
      });

      return this.parseTopicsResponse(response);
    } catch (error) {
      logger.error('Error extracting topics:', error);
      return [];
    }
  }

  /**
   * Parse topics response from LLM
   */
  private parseTopicsResponse(response: unknown): ExtractedTopic[] {
    const topics: ExtractedTopic[] = [];

    try {
      const responseStr = String(response);
      const topicPattern = /<topic>[\s\S]*?<\/topic>/g;
      const topicMatches = responseStr.match(topicPattern);

      if (!topicMatches) return topics;

      for (const topicMatch of topicMatches) {
        const nameMatch = topicMatch.match(/<name>(.*?)<\/name>/);
        const keywordsMatch = topicMatch.match(/<keywords>(.*?)<\/keywords>/);
        const relevanceMatch = topicMatch.match(/<relevance>(.*?)<\/relevance>/);

        if (nameMatch) {
          const name = nameMatch[1].trim();
          const keywordStr = keywordsMatch ? keywordsMatch[1].trim() : '';
          const keywords = keywordStr ? keywordStr.split(',').map((k) => k.trim()) : [];
          const relevance = relevanceMatch ? parseFloat(relevanceMatch[1]) : 0.5;

          topics.push({
            name,
            keywords,
            relevance: Math.max(0, Math.min(1, relevance)),
            frequency: 1, // Will be calculated properly during aggregation
          });
        }
      }
    } catch (error) {
      logger.error('Error parsing topics response:', error);
    }

    return topics.slice(0, 3); // Limit to top 3 topics
  }

  /**
   * Find watch terms in text with enhanced matching for case variations and common patterns
   */
  private findWatchTerms(text: string): string[] {
    const lowerText = text.toLowerCase();
    const matchedTerms: string[] = [];

    for (const term of this.watchTerms) {
      const termLower = term.toLowerCase();

      // Direct match (existing logic)
      if (lowerText.includes(termLower)) {
        matchedTerms.push(term);
        continue;
      }

      // Enhanced matching for common variations
      const variations = this.generateTermVariations(termLower);
      for (const variation of variations) {
        if (lowerText.includes(variation)) {
          matchedTerms.push(term);
          break; // Only add the term once
        }
      }
    }

    return [...new Set(matchedTerms)]; // Remove duplicates
  }

  /**
   * Generate common variations of a watch term for better matching
   */
  private generateTermVariations(term: string): string[] {
    const variations = [term]; // Include the original term

    // Add hashtag and ticker symbol versions
    variations.push(`#${term}`);
    variations.push(`$${term}`);
    variations.push(`@${term}`);

    // Add case variations if not all lowercase
    if (term !== term.toLowerCase()) {
      variations.push(term.toUpperCase());
      variations.push(term.charAt(0).toUpperCase() + term.slice(1).toLowerCase());
    }

    // Add common patterns for specific terms
    if (term === 'elizaos') {
      variations.push('eliza os', 'eliza-os', 'elizaOS', 'ElizaOS', 'ELIZAOS');
    }

    if (term === 'ai16z') {
      variations.push('AI16Z', 'ai16z', 'AI16z');
    }

    // Add space-separated version for compound terms
    if (term.length > 4 && !term.includes(' ')) {
      // Try to split camelCase or add spaces
      const spaced = term.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
      if (spaced !== term) {
        variations.push(spaced);
      }
    }

    return variations;
  }

  /**
   * Infer watch terms from post context (URL, hashtags, etc.)
   * Used when exact text matching fails but the post was fetched via search
   */
  private inferWatchTermsFromPost(post: SocialMediaPost): string[] {
    const inferredTerms: string[] = [];

    // Check URL for watch terms
    if (post.content.url) {
      const lowerUrl = post.content.url.toLowerCase();
      for (const term of this.watchTerms) {
        if (lowerUrl.includes(term.toLowerCase())) {
          inferredTerms.push(term);
        }
      }
    }

    // Check author username for watch terms
    const lowerUsername = post.author.username.toLowerCase();
    for (const term of this.watchTerms) {
      if (lowerUsername.includes(term.toLowerCase())) {
        inferredTerms.push(term);
      }
    }

    // Look for partial matches or variations
    const lowerText = post.content.text.toLowerCase();
    for (const term of this.watchTerms) {
      const termLower = term.toLowerCase();
      // Check for hashtag versions
      if (lowerText.includes(`#${termLower}`) || lowerText.includes(`$${termLower}`)) {
        inferredTerms.push(term);
      }
      // Check for partial matches (e.g., "ai16" matching "ai16z")
      if (termLower.length > 3 && lowerText.includes(termLower.slice(0, -1))) {
        inferredTerms.push(term);
      }
    }

    return [...new Set(inferredTerms)]; // Remove duplicates
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
