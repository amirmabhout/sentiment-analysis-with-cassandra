import { type Plugin, type IAgentRuntime, logger } from '@elizaos/core';

import * as actions from './actions/index.ts';
import * as providers from './providers/index.ts';
import {
  SentimentPersistenceService,
  SentimentAnalysisService,
  RapidAPIDataService,
  SentimentAggregatorService,
  StartupService,
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
    SentimentPersistenceService, // Must be second to provide storage foundation
    SentimentAnalysisService,
    RapidAPIDataService, // Real Twitter data via RapidAPI
    SentimentAggregatorService,
  ],

  // Actions that users can trigger
  actions: [actions.sentimentReportAction, actions.processSentimentAction],

  // Providers that supply context to conversations
  providers: [
    providers.sentimentDataProvider,
    providers.sentimentTrendsProvider,
    providers.actionsProvider,
  ],

  // Initialize the plugin
  async init(config: Record<string, string>): Promise<void> {
    logger.info('🔍 Initializing Sentiment Analyzer Plugin');

    // Validate required environment variables
    const requiredLLMVars = [
      'OPENAI_API_KEY', // For LLM sentiment analysis
      'ANTHROPIC_API_KEY', // Alternative LLM provider
      'GOOGLE_GENERATIVE_AI_API_KEY', // Alternative LLM provider (Google plugin)
    ];

    const missingLLMVars = requiredLLMVars.filter(
      (varName) => !config[varName] && !process.env[varName]
    );

    if (missingLLMVars.length === requiredLLMVars.length) {
      logger.warn('⚠️ No LLM API keys found - sentiment analysis will not work properly');
      logger.warn(
        'Please set one of: OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_GENERATIVE_AI_API_KEY'
      );
    }

    // Validate RapidAPI configuration - REQUIRED
    const hasRapidApiKey = config.RAPIDAPI_API_KEY || process.env.RAPIDAPI_API_KEY;
    const hasRapidApiHost = config.RAPIDAPI_X_HOST || process.env.RAPIDAPI_X_HOST;

    if (!hasRapidApiKey || !hasRapidApiHost) {
      logger.error('❌ RapidAPI configuration incomplete - sentiment analysis will not work');
      logger.error('REQUIRED: Set RAPIDAPI_API_KEY and RAPIDAPI_X_HOST environment variables');
      logger.error('Optional: Set RAPIDAPI_APP_NAME for custom app identification');
      throw new Error('RapidAPI configuration required for sentiment analysis plugin');
    }

    logger.info('✅ RapidAPI configuration found - sentiment analysis ready');

    // Set up configuration with defaults
    const sentimentConfig = {
      SENTIMENT_WATCH_TERMS:
        config.SENTIMENT_WATCH_TERMS || process.env.SENTIMENT_WATCH_TERMS || 'ai16z,elizaos',
      SENTIMENT_PROCESSING_INTERVAL:
        config.SENTIMENT_PROCESSING_INTERVAL ||
        process.env.SENTIMENT_PROCESSING_INTERVAL ||
        '300000', // 5 minutes
      TWITTER_MAX_TWEETS_PER_CYCLE:
        config.TWITTER_MAX_TWEETS_PER_CYCLE || process.env.TWITTER_MAX_TWEETS_PER_CYCLE || '50',
      SENTIMENT_MAX_HISTORY:
        config.SENTIMENT_MAX_HISTORY || process.env.SENTIMENT_MAX_HISTORY || '10000',
      DISCORD_REPORT_CHANNEL: config.DISCORD_REPORT_CHANNEL || process.env.DISCORD_REPORT_CHANNEL,
    };

    // Set environment variables for services to use
    for (const [key, value] of Object.entries(sentimentConfig)) {
      if (value && !process.env[key]) {
        process.env[key] = value;
      }
    }

    logger.info('✅ Sentiment Analyzer Plugin configuration loaded');
    logger.info(`Watch terms: ${sentimentConfig.SENTIMENT_WATCH_TERMS}`);
    logger.info(
      `Processing interval: ${parseInt(sentimentConfig.SENTIMENT_PROCESSING_INTERVAL, 10) / 1000 / 60} minutes`
    );
  },
};

export default sentimentAnalyzerPlugin;
