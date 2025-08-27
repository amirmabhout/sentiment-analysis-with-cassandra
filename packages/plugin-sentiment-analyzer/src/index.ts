import { type Plugin, type IAgentRuntime, logger } from '@elizaos/core';

import * as actions from './actions/index.ts';
import * as providers from './providers/index.ts';
import { 
  SentimentAnalysisService, 
  TwitterMinimalService, 
  SentimentAggregatorService,
  StartupService 
} from './services/index.ts';

export * from './types.ts';
export * from './services/index.ts';
export * from './actions/index.ts';
export * from './providers/index.ts';

/**
 * Sentiment Analyzer Plugin for ElizaOS
 * 
 * This plugin provides comprehensive sentiment analysis capabilities for tracking
 * social media sentiment around ai16z and elizaOS. It includes:
 * 
 * - Real-time Twitter stream monitoring
 * - Sentiment scoring using LLM models
 * - Entity and topic extraction
 * - Trend analysis and aggregation
 * - Discord reporting and alerts
 * - Recurring automated processing
 * 
 * The plugin integrates with existing Twitter and Discord plugins to provide
 * a complete sentiment tracking solution.
 */
export const sentimentAnalyzerPlugin: Plugin = {
  name: 'sentiment-analyzer',
  description: 'Comprehensive sentiment analysis for ai16z and elizaOS social media monitoring',
  
  // Services that handle the core functionality
  services: [
    StartupService, // Must be first to initialize tasks
    SentimentAnalysisService,
    TwitterMinimalService, // Replaced TwitterStreamService to avoid auth issues
    SentimentAggregatorService
  ],

  // Actions that users can trigger
  actions: [
    actions.sentimentReportAction
  ],

  // Providers that supply context to conversations
  providers: [
    providers.sentimentDataProvider,
    providers.sentimentTrendsProvider
  ],

  // Initialize the plugin
  async init(config: Record<string, string>): Promise<void> {
    logger.info('🔍 Initializing Sentiment Analyzer Plugin');

    // Validate required environment variables
    const requiredEnvVars = [
      'OPENAI_API_KEY', // For LLM sentiment analysis
      'ANTHROPIC_API_KEY', // Alternative LLM provider
      'GOOGLE_GENAI_API_KEY' // Alternative LLM provider
    ];

    const missingVars = requiredEnvVars.filter(varName => 
      !config[varName] && !process.env[varName]
    );

    if (missingVars.length === requiredEnvVars.length) {
      logger.warn('⚠️ No LLM API keys found - sentiment analysis will not work properly');
      logger.warn('Please set one of: OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_GENAI_API_KEY');
    }

    // Set up configuration with defaults
    const sentimentConfig = {
      SENTIMENT_WATCH_TERMS: config.SENTIMENT_WATCH_TERMS || process.env.SENTIMENT_WATCH_TERMS || 'ai16z,elizaos',
      SENTIMENT_PROCESSING_INTERVAL: config.SENTIMENT_PROCESSING_INTERVAL || process.env.SENTIMENT_PROCESSING_INTERVAL || '300000', // 5 minutes
      TWITTER_MAX_TWEETS_PER_CYCLE: config.TWITTER_MAX_TWEETS_PER_CYCLE || process.env.TWITTER_MAX_TWEETS_PER_CYCLE || '50',
      SENTIMENT_MAX_HISTORY: config.SENTIMENT_MAX_HISTORY || process.env.SENTIMENT_MAX_HISTORY || '10000',
      DISCORD_REPORT_CHANNEL: config.DISCORD_REPORT_CHANNEL || process.env.DISCORD_REPORT_CHANNEL
    };

    // Set environment variables for services to use
    for (const [key, value] of Object.entries(sentimentConfig)) {
      if (value && !process.env[key]) {
        process.env[key] = value;
      }
    }

    logger.info('✅ Sentiment Analyzer Plugin configuration loaded');
    logger.info(`Watch terms: ${sentimentConfig.SENTIMENT_WATCH_TERMS}`);
    logger.info(`Processing interval: ${parseInt(sentimentConfig.SENTIMENT_PROCESSING_INTERVAL, 10) / 1000 / 60} minutes`);
  }
};

export default sentimentAnalyzerPlugin;