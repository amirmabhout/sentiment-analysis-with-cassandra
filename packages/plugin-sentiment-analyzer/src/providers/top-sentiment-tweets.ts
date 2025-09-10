import {
  type Provider,
  type ProviderResult,
  type IAgentRuntime,
  type Memory,
  type State,
  logger,
} from '@elizaos/core';
import type { ProcessedSentiment, SocialMediaPost } from '../types.ts';
import type { SentimentPersistenceService } from '../services/persistence.ts';

/**
 * Ranked tweet with importance score for display
 */
interface RankedTweet {
  tweet: SocialMediaPost;
  sentiment: ProcessedSentiment;
  importanceScore: number;
  engagementScore: number;
}

/**
 * Provider that supplies top-ranked positive and negative sentiment tweets
 * Ranks by composite importance: author influence + sentiment magnitude + engagement
 */
export const topSentimentTweetsProvider: Provider = {
  name: 'TOP_SENTIMENT_TWEETS',
  description:
    'Provides top 10 positive and negative sentiment tweets ranked by author importance and engagement',

  get: async (runtime: IAgentRuntime, _message: Memory, _state: State): Promise<ProviderResult> => {
    logger.debug('[TopSentimentTweetsProvider] Getting top sentiment tweets');

    try {
      const persistenceService = runtime.getService(
        'sentiment-persistence'
      ) as SentimentPersistenceService;

      if (!persistenceService) {
        logger.warn('[TopSentimentTweetsProvider] Sentiment persistence service not available');
        return {
          text: 'Top sentiment tweets data is currently unavailable.',
          values: {},
          data: {},
        };
      }

      // Get sentiment data from the last 24 hours for sufficient sample size
      const timeRange = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
      const endTime = Date.now();
      const startTime = endTime - timeRange;

      // Retrieve sentiment analysis results
      const sentimentResults = await persistenceService.getSentimentAnalysisByTimeRange(
        startTime,
        endTime
      );

      if (sentimentResults.length === 0) {
        logger.debug('[TopSentimentTweetsProvider] No sentiment data available in time range');
        return {
          text: 'No recent sentiment data available. The system needs time to collect and analyze tweets.',
          values: {
            hasData: false,
            totalTweets: 0,
          },
          data: {
            timeRange: { start: startTime, end: endTime },
          },
        };
      }

      // Get corresponding tweets for the sentiment data
      const tweets = await persistenceService.getTweetsByTimeRange(startTime, endTime);
      const tweetMap = new Map<string, SocialMediaPost>();
      for (const tweet of tweets) {
        tweetMap.set(tweet.id, tweet);
      }

      // Create ranked tweets combining sentiment and tweet data
      const rankedTweets: RankedTweet[] = [];

      for (const sentiment of sentimentResults) {
        const tweet = tweetMap.get(sentiment.postId);
        if (!tweet) continue;

        // Calculate engagement score from metrics
        const engagementScore = calculateEngagementScore(tweet);

        // Calculate composite importance score
        const importanceScore = calculateImportanceScore(sentiment, engagementScore);

        rankedTweets.push({
          tweet,
          sentiment,
          importanceScore,
          engagementScore,
        });
      }

      // Filter and rank positive tweets (score > 0.1)
      const positiveTweets = rankedTweets
        .filter(
          (rt) => rt.sentiment.sentiment.score > 0.1 && rt.sentiment.influence.authorInfluence > 0.1
        )
        .sort((a, b) => b.importanceScore - a.importanceScore)
        .slice(0, 10);

      // Filter and rank negative tweets (score < -0.1)
      const negativeTweets = rankedTweets
        .filter(
          (rt) =>
            rt.sentiment.sentiment.score < -0.1 && rt.sentiment.influence.authorInfluence > 0.1
        )
        .sort((a, b) => b.importanceScore - a.importanceScore)
        .slice(0, 10);

      // Format the context for the agent
      const contextText = formatTopTweetsContext(
        positiveTweets,
        negativeTweets,
        sentimentResults.length
      );

      return {
        text: contextText,
        values: {
          hasData: true,
          totalTweets: sentimentResults.length,
          positiveCount: positiveTweets.length,
          negativeCount: negativeTweets.length,
          timeRangeHours: timeRange / (60 * 60 * 1000),
          topPositiveScore:
            positiveTweets.length > 0 ? positiveTweets[0].sentiment.sentiment.score : 0,
          topNegativeScore:
            negativeTweets.length > 0 ? negativeTweets[0].sentiment.sentiment.score : 0,
        },
        data: {
          positiveTweets,
          negativeTweets,
          totalAnalyzed: sentimentResults.length,
          timeRange: { start: startTime, end: endTime },
          timestamp: Date.now(),
        },
      };
    } catch (error) {
      logger.error(
        '[TopSentimentTweetsProvider] Error getting top sentiment tweets:',
        error as string
      );

      return {
        text: 'Unable to retrieve top sentiment tweets due to a system error.',
        values: {
          error: true,
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
        },
        data: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  },
};

/**
 * Calculate engagement score from tweet metrics
 * Normalizes engagement to 0-1 scale
 */
function calculateEngagementScore(tweet: SocialMediaPost): number {
  const likes = tweet.metrics.likes || 0;
  const retweets = tweet.metrics.retweets || 0;
  const replies = tweet.metrics.replies || 0;
  const views = tweet.metrics.views || 0;

  // Weight different engagement types
  const weightedEngagement = likes * 1.0 + retweets * 2.0 + replies * 1.5 + views * 0.1;

  // Normalize to 0-1 scale using logarithmic scaling to handle wide ranges
  const normalized = Math.min(1.0, Math.log10(weightedEngagement + 1) / 4); // log10(10000) ≈ 4

  return normalized;
}

/**
 * Calculate composite importance score for ranking
 * Combines author influence (60%), sentiment magnitude (20%), and engagement (20%)
 */
function calculateImportanceScore(sentiment: ProcessedSentiment, engagementScore: number): number {
  const authorWeight = 0.6;
  const sentimentWeight = 0.2;
  const engagementWeight = 0.2;

  const authorInfluence = sentiment.influence.authorInfluence;
  const sentimentMagnitude = sentiment.sentiment.magnitude;

  const score =
    authorInfluence * authorWeight +
    sentimentMagnitude * sentimentWeight +
    engagementScore * engagementWeight;

  return Math.min(1.0, score);
}

/**
 * Format top tweets into readable context for the agent
 */
function formatTopTweetsContext(
  positiveTweets: RankedTweet[],
  negativeTweets: RankedTweet[],
  totalTweets: number
): string {
  let context = `## Top Influential Sentiment Tweets (Last 24h)\n\n`;
  context += `*Analyzed ${totalTweets} tweets, ranked by author influence + engagement + sentiment strength*\n\n`;

  // Top Positive Tweets Section
  if (positiveTweets.length > 0) {
    context += `### 🟢 Top ${positiveTweets.length} Most Positive (Ranked by Importance)\n\n`;

    positiveTweets.forEach((rankedTweet, index) => {
      const { tweet, sentiment } = rankedTweet;
      const authorInfo = formatAuthorInfo(tweet);
      const sentimentInfo = formatSentimentInfo(sentiment);
      const engagementInfo = formatEngagementInfo(tweet);
      const importance = (rankedTweet.importanceScore * 100).toFixed(0);

      context += `**${index + 1}.** ${authorInfo}\n`;
      context += `   ${sentimentInfo} | ${engagementInfo} | Importance: ${importance}%\n`;
      context += `   "${truncateText(tweet.content.text, 100)}"\n\n`;
    });
  } else {
    context += `### 🟢 Positive Tweets\nNo highly positive tweets from influential accounts found.\n\n`;
  }

  // Top Negative Tweets Section
  if (negativeTweets.length > 0) {
    context += `### 🔴 Top ${negativeTweets.length} Most Negative (Ranked by Importance)\n\n`;

    negativeTweets.forEach((rankedTweet, index) => {
      const { tweet, sentiment } = rankedTweet;
      const authorInfo = formatAuthorInfo(tweet);
      const sentimentInfo = formatSentimentInfo(sentiment);
      const engagementInfo = formatEngagementInfo(tweet);
      const importance = (rankedTweet.importanceScore * 100).toFixed(0);

      context += `**${index + 1}.** ${authorInfo}\n`;
      context += `   ${sentimentInfo} | ${engagementInfo} | Importance: ${importance}%\n`;
      context += `   "${truncateText(tweet.content.text, 100)}"\n\n`;
    });
  } else {
    context += `### 🔴 Negative Tweets\nNo highly negative tweets from influential accounts found.\n\n`;
  }

  // Analysis Summary
  context += `### 📊 Analysis Summary\n`;
  context += `• **Total analyzed:** ${totalTweets} tweets\n`;
  context += `• **Positive highlights:** ${positiveTweets.length} important positive tweets\n`;
  context += `• **Negative highlights:** ${negativeTweets.length} important negative tweets\n`;

  if (positiveTweets.length > 0 || negativeTweets.length > 0) {
    context += `\n**Context for Responses:**\n`;

    if (positiveTweets.length > negativeTweets.length) {
      context += `• More positive influential sentiment - highlight positive momentum\n`;
    } else if (negativeTweets.length > positiveTweets.length) {
      context += `• More negative influential sentiment - acknowledge concerns, provide balanced view\n`;
    } else {
      context += `• Balanced influential sentiment - focus on factual information\n`;
    }

    if (positiveTweets.length > 0 && positiveTweets[0].sentiment.sentiment.score > 0.7) {
      context += `• Strong positive sentiment from top influencers - celebrate achievements\n`;
    }

    if (negativeTweets.length > 0 && negativeTweets[0].sentiment.sentiment.score < -0.7) {
      context += `• Strong negative sentiment from top influencers - address concerns directly\n`;
    }
  }

  return context;
}

/**
 * Format author information with influence indicators
 */
function formatAuthorInfo(tweet: SocialMediaPost): string {
  const followerCount = tweet.author.followerCount || 0;
  const username = tweet.author.username;

  let followerText = '';
  if (followerCount >= 1000000) {
    followerText = `${(followerCount / 1000000).toFixed(1)}M followers`;
  } else if (followerCount >= 1000) {
    followerText = `${(followerCount / 1000).toFixed(0)}K followers`;
  } else {
    followerText = `${followerCount} followers`;
  }

  return `@${username} (${followerText})`;
}

/**
 * Format sentiment information with visual indicators
 */
function formatSentimentInfo(sentiment: ProcessedSentiment): string {
  const score = sentiment.sentiment.score;
  const confidence = sentiment.sentiment.confidence;

  let emoji = '😐';
  if (score > 0.5) emoji = '🤩';
  else if (score > 0.2) emoji = '😊';
  else if (score < -0.5) emoji = '😤';
  else if (score < -0.2) emoji = '😕';

  return `${emoji} ${score > 0 ? '+' : ''}${score.toFixed(2)} (${(confidence * 100).toFixed(0)}% confident)`;
}

/**
 * Format engagement metrics
 */
function formatEngagementInfo(tweet: SocialMediaPost): string {
  const parts: string[] = [];

  if (tweet.metrics.likes && tweet.metrics.likes > 0) {
    parts.push(`${formatNumber(tweet.metrics.likes)} likes`);
  }
  if (tweet.metrics.retweets && tweet.metrics.retweets > 0) {
    parts.push(`${formatNumber(tweet.metrics.retweets)} RTs`);
  }
  if (tweet.metrics.views && tweet.metrics.views > 0) {
    parts.push(`${formatNumber(tweet.metrics.views)} views`);
  }

  return parts.length > 0 ? parts.join(', ') : 'No engagement data';
}

/**
 * Format numbers for display (1000 -> 1K, 1000000 -> 1M)
 */
function formatNumber(num: number): string {
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)}M`;
  } else if (num >= 1000) {
    return `${(num / 1000).toFixed(0)}K`;
  }
  return num.toString();
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
