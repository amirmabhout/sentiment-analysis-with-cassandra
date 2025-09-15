import {
  type Action,
  type ActionResult,
  type Content,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  type State,
  logger,
  ModelType,
} from '@elizaos/core';
import type { SocialMediaPost, ProcessedSentiment } from '../types.ts';
import type { SentimentPersistenceService } from '../services/persistence.ts';

/**
 * Interface for search parameters
 */
interface SearchParams {
  query: string;
  limit?: number;
  sentiment_filter?: 'positive' | 'negative' | 'neutral';
  date_range?: {
    start?: Date;
    end?: Date;
  };
  watch_terms?: string[];
  threshold?: number;
}

/**
 * Interface for search results
 */
interface TweetSearchResult {
  tweet: SocialMediaPost;
  sentiment?: ProcessedSentiment;
  similarity_score: number;
  relevance_score?: number;
}

/**
 * Action for searching tweets using vector similarity search
 * Similar to SEARCH_MESSAGES but specialized for tweet content
 */
export const searchTweetsAction: Action = {
  name: 'SEARCH_TWEETS',
  similes: ['FIND_TWEETS', 'SEARCH_POSTS', 'LOOK_FOR_TWEETS', 'TWEET_SEARCH'],
  description:
    'Search through stored tweets using vector similarity search based on content, sentiment, and topics',

  validate: async (runtime: IAgentRuntime, message: Memory, state?: State): Promise<boolean> => {
    logger.debug('[SearchTweets] Validating search tweets action');

    const text = message.content.text?.toLowerCase() || '';

    // Check if the message is asking for tweet search
    const searchKeywords = ['search', 'find', 'look for', 'show me', 'get', 'retrieve'];

    const tweetKeywords = ['tweet', 'post', 'message', 'content', 'social media'];

    const hasSearchKeyword = searchKeywords.some((keyword) => text.includes(keyword));
    const hasTweetKeyword = tweetKeywords.some((keyword) => text.includes(keyword));

    // Also validate if asking about specific topics or sentiment
    const topicKeywords = ['ai16z', 'elizaos', 'sentiment', 'positive', 'negative'];
    const hasTopicKeyword = topicKeywords.some((keyword) => text.includes(keyword));

    const isValid = (hasSearchKeyword && hasTweetKeyword) || (hasSearchKeyword && hasTopicKeyword);

    if (isValid) {
      logger.info('[SearchTweets] Tweet search action validated');
    } else {
      logger.debug('[SearchTweets] Message does not match tweet search criteria');
    }

    return isValid;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    _options?: any,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    logger.info('[SearchTweets] Executing tweet search');

    try {
      // Parse search parameters from the message
      const searchParams = parseSearchQuery(message.content.text || '');
      logger.info(`[SearchTweets] Search parameters: ${JSON.stringify(searchParams)}`);

      // Generate embedding for the search query
      const embeddingModel = runtime.getModel(ModelType.TEXT_EMBEDDING);
      if (!embeddingModel) {
        throw new Error('No embedding model available');
      }

      const queryEmbedding = await runtime.useModel(ModelType.TEXT_EMBEDDING, {
        text: message.content.text || '',
      });

      if (!queryEmbedding || !Array.isArray(queryEmbedding)) {
        throw new Error('Failed to generate embedding for search query');
      }

      // Search tweets using vector similarity
      const searchResults = await searchTweetsByEmbedding(runtime, queryEmbedding, searchParams);

      if (searchResults.length === 0) {
        const noResultsMsg = `No tweets found matching your search: "${searchParams.query}"`;

        if (callback) {
          await callback({
            text: noResultsMsg,
          });
        }

        return {
          success: true,
          text: noResultsMsg,
          values: {
            query: searchParams.query,
            results_count: 0,
          },
          data: {
            search_params: searchParams,
            results: [],
          },
        };
      }

      // Format results for response
      const formattedResults = formatSearchResults(searchResults, searchParams.query);

      if (callback) {
        await callback({
          text: formattedResults.summary,
        });
      }

      return {
        success: true,
        text: formattedResults.summary,
        values: {
          query: searchParams.query,
          results_count: searchResults.length,
          top_similarity: searchResults[0]?.similarity_score || 0,
        },
        data: {
          search_params: searchParams,
          results: searchResults,
          formatted_results: formattedResults,
        },
      };
    } catch (error) {
      logger.error('[SearchTweets] Error executing tweet search:', error);

      const errorMsg = `Unable to search tweets: ${error instanceof Error ? error.message : 'Unknown error'}`;

      if (callback) {
        await callback({
          text: errorMsg,
          error: true,
        });
      }

      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        text: errorMsg,
      };
    }
  },
};

/**
 * Parse search query and extract parameters
 */
function parseSearchQuery(query: string): SearchParams {
  const lowerQuery = query.toLowerCase();

  // Extract main search terms (remove command words)
  let cleanQuery = query;
  const commandWords = [
    'search',
    'find',
    'look for',
    'show me',
    'get',
    'retrieve',
    'tweets',
    'posts',
  ];
  commandWords.forEach((word) => {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    cleanQuery = cleanQuery.replace(regex, '').trim();
  });

  // Clean up extra spaces
  cleanQuery = cleanQuery.replace(/\s+/g, ' ').trim();

  const params: SearchParams = {
    query: cleanQuery || query, // Fallback to original if cleaning resulted in empty string
    limit: 10, // Default limit
  };

  // Extract sentiment filter
  if (lowerQuery.includes('positive')) {
    params.sentiment_filter = 'positive';
  } else if (lowerQuery.includes('negative')) {
    params.sentiment_filter = 'negative';
  } else if (lowerQuery.includes('neutral')) {
    params.sentiment_filter = 'neutral';
  }

  // Extract watch terms
  const watchTerms: string[] = [];
  if (lowerQuery.includes('ai16z')) watchTerms.push('ai16z');
  if (lowerQuery.includes('elizaos')) watchTerms.push('elizaos');
  if (watchTerms.length > 0) {
    params.watch_terms = watchTerms;
  }

  // Extract limit if specified
  const limitMatch = lowerQuery.match(/(?:top|first|last|show)\s+(\d+)/);
  if (limitMatch) {
    params.limit = Math.min(parseInt(limitMatch[1], 10), 50); // Cap at 50
  }

  return params;
}

/**
 * Search tweets using vector similarity search
 */
async function searchTweetsByEmbedding(
  runtime: IAgentRuntime,
  queryEmbedding: number[],
  params: SearchParams
): Promise<TweetSearchResult[]> {
  logger.debug(`[SearchTweets] Searching with embedding vector of length ${queryEmbedding.length}`);

  // Search in the tweets table using vector similarity
  const memories = await runtime.searchMemories({
    embedding: queryEmbedding,
    match_threshold: params.threshold || 0.6,
    count: params.limit || 10,
    tableName: 'tweets',
    query: params.query, // Use parsed query for reranking (keeps search intent)
    roomId: runtime.agentId,
  });

  logger.info(`[SearchTweets] Found ${memories.length} similar tweets`);

  // Convert memories to search results
  const results: TweetSearchResult[] = [];

  for (const memory of memories) {
    try {
      logger.debug(`[SearchTweets] Processing memory ${memory.id} with type: ${memory.type}`);

      // Check if this memory is actually a tweet using the type column
      if (memory.type !== 'tweets') {
        logger.debug(
          `[SearchTweets] Skipping memory ${memory.id} - not a tweet (type: ${memory.type})`
        );
        continue;
      }

      // Extract tweet data from memory content
      const tweet = memory.content.tweet as SocialMediaPost;
      if (!tweet) {
        logger.warn('[SearchTweets] Memory missing tweet data, skipping');
        continue;
      }

      // Try to get sentiment data if available
      let sentimentData: ProcessedSentiment | undefined;
      try {
        const persistenceService = runtime.getService(
          'sentiment-persistence'
        ) as SentimentPersistenceService;
        if (persistenceService) {
          const sentimentResults = await persistenceService.getSentimentAnalysisByTimeRange(
            tweet.timestamp - 1000,
            tweet.timestamp + 1000,
            params.watch_terms
          );
          sentimentData = sentimentResults.find((s) => s.postId === tweet.id);
        }
      } catch (error) {
        logger.debug('[SearchTweets] Could not retrieve sentiment data:', error);
      }

      results.push({
        tweet,
        sentiment: sentimentData,
        similarity_score: memory.similarity || 0,
        relevance_score: (memory as any).relevance_score,
      });
    } catch (error) {
      logger.error('[SearchTweets] Error processing search result:', error as string);
    }
  }

  // Sort by similarity score (higher is better)
  results.sort((a, b) => b.similarity_score - a.similarity_score);

  return results.slice(0, params.limit || 10);
}

/**
 * Format search results for display
 */
function formatSearchResults(
  results: TweetSearchResult[],
  query: string
): {
  summary: string;
  detailed: string;
} {
  const resultCount = results.length;

  let summary = `🔍 **Search Results for: "${query}"**\n\n`;
  summary += `Found ${resultCount} relevant tweet${resultCount !== 1 ? 's' : ''}:\n\n`;

  let detailed = summary;

  results.forEach((result, index) => {
    const { tweet, sentiment, similarity_score } = result;

    // Format tweet info
    const author = `@${tweet.author.username}`;
    const followers = formatFollowerCount(tweet.author.followerCount || 0);
    const date = new Date(tweet.timestamp).toLocaleDateString();
    const similarity = (similarity_score * 100).toFixed(0);

    // Format sentiment if available
    let sentimentInfo = '';
    if (sentiment) {
      const score = sentiment.sentiment.score;
      const emoji = score > 0.1 ? '😊' : score < -0.1 ? '😕' : '😐';
      sentimentInfo = ` | Sentiment: ${emoji} ${score > 0 ? '+' : ''}${score.toFixed(2)}`;
    }

    // Truncate tweet content
    const content = truncateText(tweet.content.text, 150);

    summary += `**${index + 1}.** ${author} (${followers}) - ${date}\n`;
    summary += `   Similarity: ${similarity}%${sentimentInfo}\n`;
    summary += `   "${content}"\n\n`;
  });

  if (resultCount === 0) {
    summary += 'Try adjusting your search terms or removing filters.\n';
  }

  return {
    summary,
    detailed: summary, // For now, same as summary
  };
}

/**
 * Format follower count for display
 */
function formatFollowerCount(count: number): string {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M followers`;
  } else if (count >= 1000) {
    return `${(count / 1000).toFixed(0)}K followers`;
  }
  return `${count} followers`;
}

/**
 * Truncate text to specified length with ellipsis
 */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength - 3) + '...';
}
