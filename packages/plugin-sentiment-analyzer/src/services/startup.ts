import { Service, type IAgentRuntime, logger } from '@elizaos/core';
import {
  sentimentProcessingTask,
  sentimentReportingTask,
  sentimentDailyReportingTask,
  sentimentTrendAnalysisTask,
} from '../tasks/sentiment-task.ts';

/**
 * StartupService handles plugin initialization and task setup
 */
export class StartupService extends Service {
  static serviceType = 'sentiment-startup';
  capabilityDescription = 'Initializes sentiment analysis tasks and configuration';

  constructor(runtime: IAgentRuntime) {
    super(runtime);
  }

  static async start(runtime: IAgentRuntime): Promise<StartupService> {
    logger.info('🚀 Starting Sentiment Analysis Startup Service');
    const service = new StartupService(runtime);
    await service.setupTasks();
    return service;
  }

  async stop(): Promise<void> {
    logger.info('🚀 Stopping Sentiment Analysis Startup Service');
  }

  private async setupTasks(): Promise<void> {
    logger.info('🚀 Setting up sentiment analysis recurring tasks');

    try {
      // Register task workers
      this.runtime.registerTaskWorker(sentimentProcessingTask);
      this.runtime.registerTaskWorker(sentimentReportingTask);
      this.runtime.registerTaskWorker(sentimentDailyReportingTask);
      this.runtime.registerTaskWorker(sentimentTrendAnalysisTask);

      // Check if tasks already exist to avoid duplicates
      const existingMainTask = await this.runtime.getTasksByName('SENTIMENT_PROCESSING_TASK');
      const existingReportTask = await this.runtime.getTasksByName('SENTIMENT_REPORTING_TASK');
      const existingDailyReportTask = await this.runtime.getTasksByName(
        'SENTIMENT_DAILY_REPORTING_TASK'
      );
      const existingTrendTask = await this.runtime.getTasksByName('SENTIMENT_TREND_ANALYSIS_TASK');

      // Create main processing task (every 5 minutes by default, but can be configured)
      if (existingMainTask.length === 0) {
        const processingInterval = parseInt(
          (this.runtime.getSetting('SENTIMENT_PROCESSING_INTERVAL') as string) ||
            process.env.SENTIMENT_PROCESSING_INTERVAL ||
            '300000',
          10
        ); // 5 minutes default

        // Calculate initial timestamp for first run data population
        const firstRunHours = parseInt(
          (this.runtime.getSetting('SENTIMENT_FIRST_RUN_HOURS') as string) ||
            process.env.SENTIMENT_FIRST_RUN_HOURS ||
            '6',
          10
        );
        const bootstrapMode =
          (this.runtime.getSetting('SENTIMENT_BOOTSTRAP_MODE') as string) ||
          process.env.SENTIMENT_BOOTSTRAP_MODE ||
          'auto';

        // Use longer initial window for first run to populate historical data
        let initialTimestamp: number;
        if (bootstrapMode === 'auto' || bootstrapMode === 'force') {
          // Use first-run window for enhanced data population
          initialTimestamp = Date.now() - firstRunHours * 60 * 60 * 1000;
          logger.info(
            `First run: Setting initial timestamp to ${firstRunHours}h ago for enhanced data population`
          );
        } else {
          // Use standard interval-based timing
          initialTimestamp = Date.now() - processingInterval;
          logger.info('Standard run: Using interval-based initial timestamp');
        }

        await this.runtime.createTask({
          name: 'SENTIMENT_PROCESSING_TASK',
          description: 'Recurring sentiment analysis processing of social media streams',
          worldId: this.runtime.worldId || '00000000-0000-0000-0000-000000000000',
          roomId: this.runtime.agentId,
          metadata: {
            updatedAt: Date.now(),
            updateInterval: processingInterval,
            actualProcessingInterval: processingInterval,
            lastProcessedTimestamp: initialTimestamp,
            watchTerms: (
              (this.runtime.getSetting('SENTIMENT_WATCH_TERMS') as string) ||
              process.env.SENTIMENT_WATCH_TERMS ||
              'ai16z,elizaos'
            )
              .split(',')
              .map((t) => t.trim()),
            processingStats: {
              postsProcessed: 0,
              errors: 0,
              avgProcessingTime: 0,
            },
          },
          tags: ['queue', 'repeat', 'sentiment'],
        });

        logger.info(
          `✅ Created sentiment processing task with ${processingInterval / 1000 / 60} minute interval`
        );
      } else {
        logger.info('✅ Sentiment processing task already exists');
      }

      // Create 6-hour reporting task (every 6 hours)
      if (existingReportTask.length === 0) {
        await this.runtime.createTask({
          name: 'SENTIMENT_REPORTING_TASK',
          description: 'Generate 6-hour sentiment reports',
          worldId: this.runtime.worldId || '00000000-0000-0000-0000-000000000000',
          roomId: this.runtime.agentId,
          metadata: {
            updatedAt: Date.now(),
            updateInterval: 60000, // Check every 1 minute
            actualReportInterval: 6 * 60 * 60 * 1000, // But only report every 6 hours
            lastReportTime: 0,
          },
          tags: ['queue', 'repeat', 'sentiment', 'reporting'],
        });

        logger.info('✅ Created sentiment reporting task (6 hour interval)');
      }

      // Create daily reporting task (at midnight)
      if (existingDailyReportTask.length === 0) {
        await this.runtime.createTask({
          name: 'SENTIMENT_DAILY_REPORTING_TASK',
          description: 'Generate daily sentiment reports at midnight',
          worldId: this.runtime.worldId || '00000000-0000-0000-0000-000000000000',
          roomId: this.runtime.agentId,
          metadata: {
            updatedAt: Date.now(),
            updateInterval: 60000, // Check every 1 minute
            lastDailyReportTime: 0,
          },
          tags: ['queue', 'repeat', 'sentiment', 'daily', 'reporting'],
        });

        logger.info('✅ Created daily sentiment reporting task (midnight)');
      }

      // Create trend analysis task (every 24 hours)
      if (existingTrendTask.length === 0) {
        await this.runtime.createTask({
          name: 'SENTIMENT_TREND_ANALYSIS_TASK',
          description: 'Weekly sentiment trend analysis and insights',
          worldId: this.runtime.worldId || '00000000-0000-0000-0000-000000000000',
          roomId: this.runtime.agentId,
          metadata: {
            updatedAt: Date.now(),
            updateInterval: 60000, // Check every 1 minute
            actualTrendInterval: 24 * 60 * 60 * 1000, // But only analyze trends every 24 hours
            lastTrendTime: 0,
          },
          tags: ['queue', 'repeat', 'sentiment', 'trends'],
        });

        logger.info('✅ Created sentiment trend analysis task (24 hour interval)');
      }

      logger.info('🎯 All sentiment analysis tasks configured successfully');
    } catch (error) {
      logger.error('❌ Error setting up sentiment analysis tasks:', error);
      throw error;
    }
  }
}
