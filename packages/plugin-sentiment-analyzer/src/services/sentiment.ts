import { Service, type IAgentRuntime, logger, ModelType } from '@elizaos/core';
import type {
  SentimentScore,
  SocialMediaPost,
  ProcessedSentiment,
  ExtractedEntity,
  ExtractedTopic,
} from '../types.ts';

/**
 * SentimentAnalysisService handles the core sentiment scoring functionality
 * Uses LLM models to analyze text sentiment with multiple scoring methods
 */
export class SentimentAnalysisService extends Service {
  static serviceType = 'sentiment-analysis';
  capabilityDescription = 'Analyzes sentiment of social media posts and text content';

  private watchTerms: string[] = ['ai16z', 'elizaos', 'eliza', '@ai16zdao', '@elizaos'];

  constructor(runtime: IAgentRuntime) {
    super(runtime);

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
   */
  async analyzeSentiment(post: SocialMediaPost, searchContext?: string): Promise<ProcessedSentiment> {
    // Use search context from post or parameter
    const effectiveSearchContext = searchContext || post.searchContext;
    logger.debug(`Analyzing sentiment for post ${post.id} from ${post.platform}${effectiveSearchContext ? ` (context: ${effectiveSearchContext})` : ''}`);

    try {
      // Check if post contains watch terms
      const watchTermsFound = this.findWatchTerms(post.content.text);

      // If we fetched this post by searching for specific terms, it's automatically relevant
      // Even if the exact term doesn't appear in the text (could be in hashtags, mentions, etc.)
      if (watchTermsFound.length === 0) {
        logger.debug(
          `Post ${post.id} doesn't contain exact watch terms but was fetched via search - using context attribution`
        );
        
        if (effectiveSearchContext) {
          // Post was fetched for specific term - use that search context
          logger.debug(`Using search context '${effectiveSearchContext}' for post ${post.id}`);
          watchTermsFound.push(effectiveSearchContext);
        } else {
          // Try to infer from post metadata (URLs, usernames, hashtags, etc.)
          const inferredWatchTerms = this.inferWatchTermsFromPost(post);
          if (inferredWatchTerms.length === 0) {
            // Only use ai16z fallback if no other matches found and no search context
            logger.debug(`No context or inference possible, using default fallback for post ${post.id}`);
            inferredWatchTerms.push(this.watchTerms[0] || 'ai16z');
          }
          watchTermsFound.push(...inferredWatchTerms);
        }
      }

      // Analyze sentiment using LLM
      const sentiment = await this.scoreSentiment(post.content.text);

      // Extract entities and topics
      const entities = await this.extractEntities(post.content.text);
      const topics = await this.extractTopics(post.content.text);

      // Calculate influence metrics
      const influence = this.calculateInfluence(post);

      return {
        postId: post.id,
        platform: post.platform,
        processedAt: Date.now(),
        sentiment,
        entities,
        topics,
        watchTermsFound,
        influence,
      };
    } catch (error) {
      logger.error(`Error analyzing sentiment for post ${post.id}:`, error);
      return this.createEmptyResult(post, []);
    }
  }

  /**
   * Batch process sentiment analysis for multiple posts
   */
  async analyzeBatch(posts: SocialMediaPost[]): Promise<ProcessedSentiment[]> {
    logger.info(`Batch analyzing sentiment for ${posts.length} posts`);

    const results: ProcessedSentiment[] = [];
    const batchSize = 5; // Process in smaller batches to avoid rate limits

    for (let i = 0; i < posts.length; i += batchSize) {
      const batch = posts.slice(i, i + batchSize);
      const batchPromises = batch.map((post) => this.analyzeSentiment(post));

      try {
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);

        // Small delay between batches to be respectful to LLM API
        if (i + batchSize < posts.length) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } catch (error) {
        logger.error(`Error in batch ${i}-${i + batchSize}:`, error);
        // Continue with next batch even if one fails
      }
    }

    logger.info(`Completed batch analysis: ${results.length} results`);
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
