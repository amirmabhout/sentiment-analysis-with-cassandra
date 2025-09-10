import { type Plugin, type IAgentRuntime, logger } from '@elizaos/core';

import * as actions from './actions/index.ts';
import * as providers from './providers/index.ts';
import {
  SentimentPersistenceService,
  SentimentAnalysisService,
  RapidAPIDataService,
  SentimentAggregatorService,
  StartupService,
  TrafficAnalyzerService,
  DynamicSchedulerService,
  SentimentAlertsService,
  DiscordReportingService,
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
    TrafficAnalyzerService, // Traffic analysis for dynamic scheduling
    DynamicSchedulerService, // Dynamic interval management
    DiscordReportingService, // Discord integration for sentiment reports
    SentimentAnalysisService,
    SentimentAlertsService, // Real-time alerts for high-importance negative sentiment
    RapidAPIDataService, // Real Twitter data via RapidAPI
    SentimentAggregatorService,
  ],

  // Actions that users can trigger
  actions: [
    actions.sentimentReportAction,
    actions.processSentimentAction,
    actions.searchTweetsAction,
  ],

  // Providers that supply context to conversations
  providers: [
    providers.sentimentDataProvider,
    providers.sentimentTrendsProvider,
    providers.topSentimentTweetsProvider,
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
        '300000', // 5 minutes (fallback for when dynamic scheduling is disabled)
      SENTIMENT_NOMINAL_INTERVAL:
        config.SENTIMENT_NOMINAL_INTERVAL || process.env.SENTIMENT_NOMINAL_INTERVAL || '1800000', // 30 minutes nominal
      SENTIMENT_MIN_INTERVAL:
        config.SENTIMENT_MIN_INTERVAL || process.env.SENTIMENT_MIN_INTERVAL || '60000', // 1 minute minimum
      SENTIMENT_MAX_INTERVAL:
        config.SENTIMENT_MAX_INTERVAL || process.env.SENTIMENT_MAX_INTERVAL || '14400000', // 4 hours maximum
      TWITTER_MAX_TWEETS_PER_CYCLE:
        config.TWITTER_MAX_TWEETS_PER_CYCLE || process.env.TWITTER_MAX_TWEETS_PER_CYCLE || '50',
      SENTIMENT_MAX_HISTORY:
        config.SENTIMENT_MAX_HISTORY || process.env.SENTIMENT_MAX_HISTORY || '10000',
      DISCORD_REPORT_CHANNEL: config.DISCORD_REPORT_CHANNEL || process.env.DISCORD_REPORT_CHANNEL,
      // Enhanced startup data population settings (all optional)
      SENTIMENT_FIRST_RUN_HOURS:
        config.SENTIMENT_FIRST_RUN_HOURS || process.env.SENTIMENT_FIRST_RUN_HOURS || '6', // 6 hours of initial data
      SENTIMENT_BOOTSTRAP_MODE:
        config.SENTIMENT_BOOTSTRAP_MODE || process.env.SENTIMENT_BOOTSTRAP_MODE || 'auto', // auto-detect first run
      SENTIMENT_DEV_TIME_WINDOW:
        config.SENTIMENT_DEV_TIME_WINDOW || process.env.SENTIMENT_DEV_TIME_WINDOW || '21600000', // 6 hours in ms for dev mode
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
      `Dynamic scheduling enabled: Nominal ${parseInt(sentimentConfig.SENTIMENT_NOMINAL_INTERVAL, 10) / 1000 / 60}min, ` +
        `Min ${parseInt(sentimentConfig.SENTIMENT_MIN_INTERVAL, 10) / 1000 / 60}min, ` +
        `Max ${parseInt(sentimentConfig.SENTIMENT_MAX_INTERVAL, 10) / 1000 / 60}min`
    );
    logger.info(
      `Enhanced startup: First run data window ${sentimentConfig.SENTIMENT_FIRST_RUN_HOURS}h, ` +
        `Bootstrap mode: ${sentimentConfig.SENTIMENT_BOOTSTRAP_MODE}`
    );
  },
};

export default sentimentAnalyzerPlugin;
