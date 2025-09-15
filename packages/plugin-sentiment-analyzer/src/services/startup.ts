import { Service, type IAgentRuntime, logger } from '@elizaos/core';
import {
  sentimentProcessingTask,
  report6hTask,
  reportDailyTask,
  reportWeeklyTopVoicesTask,
  trendAnalysisTask,
} from '../tasks/index.ts';

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
      this.runtime.registerTaskWorker(report6hTask);
      this.runtime.registerTaskWorker(reportDailyTask);
      this.runtime.registerTaskWorker(reportWeeklyTopVoicesTask);
      this.runtime.registerTaskWorker(trendAnalysisTask);

      // Check if tasks already exist to avoid duplicates
      const existingMainTask = await this.runtime.getTasksByName('SENTIMENT_PROCESSING_TASK');
      const existingReport6hTask = await this.runtime.getTasksByName('SENTIMENT_REPORT_6H_TASK');
      const existingDailyReportTask = await this.runtime.getTasksByName('SENTIMENT_REPORT_DAILY_TASK');
      const existingWeeklyTopVoicesTask = await this.runtime.getTasksByName('REPORT_WEEKLY_TOP_VOICES_TASK');
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
      if (existingReport6hTask.length === 0) {
        await this.runtime.createTask({
          name: 'SENTIMENT_REPORT_6H_TASK',
          description: 'Generate 6-hour sentiment reports with top tweets',
          worldId: this.runtime.worldId || '00000000-0000-0000-0000-000000000000',
          roomId: this.runtime.agentId,
          metadata: {
            updatedAt: Date.now(),
            updateInterval: 60000, // Check every 1 minute
            lastReportTime: 0,
          },
          tags: ['queue', 'repeat', 'sentiment', 'reporting'],
        });

        logger.info('✅ Created 6-hour sentiment reporting task');
      }

      // Create comprehensive daily reporting task (at midnight)
      if (existingDailyReportTask.length === 0) {
        await this.runtime.createTask({
          name: 'SENTIMENT_REPORT_DAILY_TASK',
          description: 'Generate comprehensive daily sentiment and top voices reports at midnight',
          worldId: this.runtime.worldId || '00000000-0000-0000-0000-000000000000',
          roomId: this.runtime.agentId,
          metadata: {
            updatedAt: Date.now(),
            updateInterval: 60000, // Check every 1 minute
            lastDailyReportTime: 0,
          },
          tags: ['queue', 'repeat', 'sentiment', 'daily', 'reporting', 'comprehensive'],
        });

        logger.info('✅ Created comprehensive daily reporting task (midnight)');
      }

      // Create weekly top voices reporting task (every Sunday)
      if (existingWeeklyTopVoicesTask.length === 0) {
        await this.runtime.createTask({
          name: 'REPORT_WEEKLY_TOP_VOICES_TASK',
          description: 'Generate comprehensive weekly top voices leaderboard every Sunday',
          worldId: this.runtime.worldId || '00000000-0000-0000-0000-000000000000',
          roomId: this.runtime.agentId,
          metadata: {
            updatedAt: Date.now(),
            updateInterval: 60000, // Check every 1 minute
            lastWeeklyReportTime: 0,
          },
          tags: ['queue', 'repeat', 'top-voices', 'weekly', 'reporting'],
        });

        logger.info('✅ Created weekly top voices reporting task (Sunday)');
      }

      // Create trend analysis task (every 24 hours)
      if (existingTrendTask.length === 0) {
        await this.runtime.createTask({
          name: 'SENTIMENT_TREND_ANALYSIS_TASK',
          description: 'Weekly sentiment trend analysis and pattern detection',
          worldId: this.runtime.worldId || '00000000-0000-0000-0000-000000000000',
          roomId: this.runtime.agentId,
          metadata: {
            updatedAt: Date.now(),
            updateInterval: 60000, // Check every 1 minute
            lastTrendTime: 0,
          },
          tags: ['queue', 'repeat', 'sentiment', 'trends', 'analysis'],
        });

        logger.info('✅ Created sentiment trend analysis task (24 hour interval)');
      }

      logger.info('🎯 All sentiment analysis tasks configured successfully:');
      logger.info('   • Sentiment processing (dynamic intervals)');
      logger.info('   • 6-hour detailed reports');
      logger.info('   • Daily comprehensive reports (midnight)');
      logger.info('   • Weekly top voices leaderboard (Sunday)');
      logger.info('   • Weekly trend analysis (24h intervals)');
    } catch (error) {
      logger.error('❌ Error setting up sentiment analysis tasks:', error);
      throw error;
    }
  }
}
