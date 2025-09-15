import type { UUID } from '@elizaos/core';

/**
 * Sentiment analysis result for a single piece of content
 */
export interface SentimentScore {
  score: number; // -1 (very negative) to +1 (very positive)
  confidence: number; // 0-1 confidence level
  magnitude: number; // 0-1 strength of sentiment
  compound?: number; // Optional compound score
}

/**
 * Extracted entity from content analysis
 */
export interface ExtractedEntity {
  text: string;
  type: 'PERSON' | 'ORG' | 'PRODUCT' | 'LOCATION' | 'MISC';
  relevance: number; // 0-1 relevance score
  sentiment: SentimentScore;
}

/**
 * Extracted topic/theme from content analysis
 */
export interface ExtractedTopic {
  name: string;
  keywords: string[];
  relevance: number; // 0-1 relevance score
  frequency: number; // How often this topic appears
}

/**
 * Social media post data for sentiment analysis
 */
export interface SocialMediaPost {
  id: string;
  platform: 'twitter' | 'discord' | 'telegram';
  author: {
    id: string;
    username: string;
    name?: string;
    followerCount?: number;
  };
  content: {
    text: string;
    url?: string;
    hasMedia: boolean;
    isRetweet?: boolean;
    isReply?: boolean;
  };
  metrics: {
    likes?: number;
    retweets?: number;
    replies?: number;
    views?: number;
  };
  timestamp: number;
  conversationId?: string;
  searchContext?: string; // DEPRECATED: Use searchTerms instead
  searchTerms?: string[]; // All search terms that found this post
  attributionSource?: 'search' | 'text_analysis' | 'inference'; // How the attribution was determined
}

/**
 * Content category for sentiment analysis
 */
export type ContentCategory = 'trading' | 'ecosystem';

/**
 * Category-specific sentiment data
 */
export interface CategorizedSentiment {
  category: ContentCategory;
  categoryConfidence: number; // 0-1 confidence in categorization
  tradingIndicators?: {
    priceDiscussion: boolean;
    marketPrediction: boolean;
    buySellSignal: boolean;
    chartAnalysis: boolean;
    profitLossMention: boolean;
  };
  technologyIndicators?: {
    developmentUpdate: boolean;
    featureDiscussion: boolean;
    technicalAnalysis: boolean;
    integrationMention: boolean;
    bugOrIssueMention: boolean;
  };
  communityIndicators?: {
    partnershipMention: boolean;
    adoptionDiscussion: boolean;
    ecosystemGrowth: boolean;
    communityEvent: boolean;
    governanceDiscussion: boolean;
  };
}

/**
 * Processed sentiment data for a single post
 */
export interface ProcessedSentiment {
  postId: string;
  platform: string;
  processedAt: number;
  sentiment: SentimentScore;
  entities: ExtractedEntity[];
  topics: ExtractedTopic[];
  watchTermsFound: string[];
  influence: {
    authorInfluence: number; // 0-1 based on follower count, engagement
    viralityPotential: number; // 0-1 based on engagement metrics
  };
  categorization?: CategorizedSentiment; // Category classification
}

/**
 * Aggregated sentiment data over a time period
 */
export interface SentimentAggregation {
  timeWindow: {
    start: number;
    end: number;
    duration: number; // in milliseconds
  };
  watchTerm: string;
  totalPosts: number;
  sentimentDistribution: {
    positive: number;
    neutral: number;
    negative: number;
  };
  overallSentiment: SentimentScore;
  topEntities: Array<{
    entity: ExtractedEntity;
    mentions: number;
    avgSentiment: SentimentScore;
  }>;
  topTopics: Array<{
    topic: ExtractedTopic;
    mentions: number;
    avgSentiment: SentimentScore;
  }>;
  influenceMetrics: {
    totalReach: number;
    avgViralityScore: number;
    topInfluencers: Array<{
      username: string;
      influence: number;
      sentiment: SentimentScore;
    }>;
  };
  trends: {
    sentimentTrend: 'rising' | 'falling' | 'stable';
    volumeTrend: 'rising' | 'falling' | 'stable';
    trendStrength: number; // 0-1
  };
}

/**
 * Top voice (author with mention count)
 */
export interface TopVoice {
  username: string;
  name?: string;
  mentionCount: number;
  followerCount?: number;
  averageSentiment?: SentimentScore;
  platforms: string[];
  sampleTweetUrls?: string[]; // URLs to recent tweets from this author
}

/**
 * Top voices report
 */
export interface TopVoicesReport {
  id: string;
  timeframe: {
    start: number;
    end: number;
    label: string;
  };
  totalUniqueAuthors: number;
  totalMentions: number;
  topVoices: TopVoice[];
  generatedAt: number;
}

/**
 * Configuration for sentiment analysis
 */
export interface SentimentAnalysisConfig {
  watchTerms: string[];
  processingInterval: number; // milliseconds
  aggregationWindows: number[]; // different time windows in milliseconds
  thresholds: {
    sentimentAlert: number; // threshold for sentiment alerts
    volumeAlert: number; // threshold for volume alerts
    influenceThreshold: number; // minimum influence to consider
  };
  platforms: {
    twitter: {
      enabled: boolean;
      maxTweetsPerCycle: number;
      searchMode: 'latest' | 'popular' | 'mixed';
    };
  };
  discord: {
    enabled: boolean;
    reportChannelId?: string;
    alertChannelId?: string;
  };
}

/**
 * Category-specific metrics for reports
 */
export interface CategoryMetrics {
  totalVolume: number;
  averageSentiment: SentimentScore;
  volumeChange: number; // percentage change from previous period
  sentimentChange: number; // change in sentiment score
  topPositivePosts: Array<{
    post: SocialMediaPost;
    sentiment: ProcessedSentiment;
    importanceScore: number;
  }>;
  topNegativePosts: Array<{
    post: SocialMediaPost;
    sentiment: ProcessedSentiment;
    importanceScore: number;
  }>;
  dominantIndicators: string[]; // Most common indicators in this category
}

/**
 * Sentiment report data structure
 */
export interface SentimentReport {
  id: UUID;
  generatedAt: number;
  reportType: 'summary' | 'alert' | 'detailed';
  timeframe: {
    start: number;
    end: number;
    label: string; // "Last 24h", "Last week", etc.
  };
  watchTerms: string[];
  overallMetrics: {
    totalVolume: number;
    averageSentiment: SentimentScore;
    volumeChange: number; // percentage change from previous period
    sentimentChange: number; // change in sentiment score
  };
  categoryMetrics?: {
    trading: CategoryMetrics;
    technology: CategoryMetrics;
  };
  breakdowns: SentimentAggregation[];
  alerts: Array<{
    type: 'sentiment_spike' | 'volume_spike' | 'negative_trend';
    severity: 'low' | 'medium' | 'high';
    message: string;
    data: any;
  }>;
  narratives: Array<{
    theme: string;
    posts: number;
    sentiment: SentimentScore;
    keyPhrases: string[];
    evolution: 'emerging' | 'growing' | 'declining' | 'stable';
    category?: ContentCategory; // Category association for narratives
  }>;
  topVoices?: TopVoice[]; // Top voices for the period
}

/**
 * Task metadata for sentiment processing
 */
export interface SentimentTaskMetadata {
  lastProcessedTimestamp: number;
  watchTerms: string[];
  processingStats: {
    postsProcessed: number;
    errors: number;
    avgProcessingTime: number;
  };
}
